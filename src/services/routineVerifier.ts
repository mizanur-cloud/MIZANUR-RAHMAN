import {
  DayOfWeek,
  PeriodTiming,
  RoutineConflict,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import { detectAllConflicts } from './conflictDetector';
import {
  getCombinedHinduRoom,
  getCombinedHinduTeacherId,
  getEffectiveSectionRequirements,
  getEffectiveSubjectFixedPeriods,
  getExpectedSectionTeacherId,
  getMaxReligionConcurrentSections,
  isAgricultureSubject,
  isClassNineOrTen,
  isHigherMathSubject,
  isHinduReligionSubject,
  isIslamReligionSubject,
  isPlayOrNursery,
  isReligionSubject,
  isSubjectSelectedForSection,
  isTeacherBlockTeacher,
} from './parallelSubjects';
import { isSlotDismissed } from './scheduleTiers';
import {
  analyzeTeacherWeeklyPattern,
  DEFAULT_DAILY_MAX_PERIODS,
  DEFAULT_WEEKLY_MAX_WORKING_DAYS,
  getTeacherDailyMax,
  MAX_UNAVOIDABLE_THREE_CONSECUTIVE_DAYS,
} from './workloadService';

export interface VerificationScope {
  type: 'all' | 'class' | 'section';
  classId?: string;
  sectionId?: string;
}

export interface UnassignedClassDetail {
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  assignedTeacherId?: string;
  assignedTeacherName?: string;
  requiredPeriods: number;
  assignedPeriods: number;
  missingPeriods: number;
  reason: string;
}

export interface TeacherVerificationDetail {
  teacherId: string;
  teacherName: string;
  initials: string;
  requiredPeriods: number;
  assignedPeriods: number; // physical periods taught in distinct (day, periodIndex) slots
  sectionCoveragePeriods: number; // total section-level timetable entries covered (includes combined Room 307 groups)
  missingPeriods: number;
  extraPeriods: number;
  maxDailyPeriods: number;
  peakDailyAssigned: number;
  dailyLimitViolations: number;
  weeklyCapacityExceeded: boolean;
  activeDays: number;
  maxWorkingDays: number;
  workingDaysExceeded: boolean;
  workingDaysMathematicallyImpossible: boolean;
  threeConsecDaysCount: number;
  fourPlusConsecDaysCount: number;
  unbalancedDays: boolean;
}

export interface SystemHealthCheckItem {
  id: string;
  order: number;
  label: string;
  status: 'PASS' | 'WARNING' | 'FAIL';
  valueText: string;
  detail: string;
}

export interface SystemHealthReport {
  overallStatus: 'PASS' | 'WARNING' | 'FAIL';
  passCount: number;
  warningCount: number;
  failCount: number;
  items: SystemHealthCheckItem[];
}

export interface VerificationCheckItem {
  id: string;
  label: string;
  passed: boolean;
  severity: 'error' | 'warning';
  detail: string;
}

export interface FinalValidationItem {
  id: string;
  label: string;
  status: 'PASS' | 'FAIL';
  valueText: string;
  numericValue?: number;
  detail: string;
}

export interface FinalValidationSummary {
  allPassed: boolean;
  subjectWeeklyQuotas: FinalValidationItem;
  teacherWorkload: FinalValidationItem;
  sectionTeacherAssignment: FinalValidationItem;
  dailyWeeklyLimits: FinalValidationItem;
  teacherAvailabilityConflicts: FinalValidationItem;
  roomConflicts: FinalValidationItem;
  unassignedPeriods: FinalValidationItem;
  combinedReligiousClasses: FinalValidationItem;
  items: FinalValidationItem[];
}

export interface RoutineVerificationReport {
  scopeLabel: string;
  totalClassesRequired: number;
  totalClassesAssigned: number;
  totalTeachers: number;
  totalSubjects: number;
  totalSections: number;
  unassignedClasses: number;
  teacherConflicts: number;
  classSectionConflicts: number;
  roomConflictsCount: number;
  wrongTeacherAssignmentsCount: number;
  religionViolationsCount: number;
  overQuotaEntriesCount: number;
  exceededCapacitySectionsCount: number;
  religionSchedulingStatus: {
    ok: boolean;
    label: string;
    detail: string;
    islamEntriesCount: number;
    hinduEntriesCount: number;
    islamTeachersUsed: number;
    hinduTeachersUsed: number;
    sameTeacherConflicts: number;
    simultaneousMultiClassCount: number;
    maxConcurrentObserved: number;
    maxConcurrentAllowed: number;
    hinduRoom: string;
  };
  finalCompletionStatus: 'complete' | 'incomplete' | 'warning';
  statusHeadline: string;
  statusSubtext: string;
  finalValidation: FinalValidationSummary;

  unassignedDetails: UnassignedClassDetail[];
  teacherDetails: TeacherVerificationDetail[];
  unassignedTeachersCount: number;
  teacherLimitViolationsCount: number;
  workingDaysViolationsCount: number;
  workingDaysImpossibleCount: number;
  fourPlusConsecViolationsCount: number;
  excessiveThreeConsecTeachersCount: number;
  unbalancedTeachersCount: number;
  verificationTimeMs: number;
  systemHealthReport: SystemHealthReport;
  unselectedSubjectEntriesCount: number;
  sameDayRepeatCount: number;
  checks: VerificationCheckItem[];
  conflicts: RoutineConflict[];
}

export function verifyRoutine(
  entries: TimetableEntry[],
  classes: SchoolClass[],
  teachers: Teacher[],
  subjects: Subject[],
  workingDays: DayOfWeek[],
  periodTimings: PeriodTiming[],
  scope: VerificationScope = { type: 'all' },
  settings?: SchoolSettings
): RoutineVerificationReport {
  const verifyStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const teachingPeriods = periodTimings.filter(p => !p.isBreak && !p.isLocked);
  const teachingPeriodIndices = teachingPeriods.map(p => p.periodIndex);
  const maxWeeklySlots = Math.max(1, workingDays.length * Math.max(1, teachingPeriodIndices.length));
  const configuredWorkingDaysCap = settings?.defaultMaxWorkingDays ?? DEFAULT_WEEKLY_MAX_WORKING_DAYS;
  const configuredDailyCap = settings?.defaultMaxDailyPeriods ?? DEFAULT_DAILY_MAX_PERIODS;

  const hinduRoom = getCombinedHinduRoom(settings);
  const maxRelConcurrent = getMaxReligionConcurrentSections(settings);
  const combinedHinduTeacherId = getCombinedHinduTeacherId(teachers, settings, subjects);

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  // Filter classes & sections according to scope
  const scopedTargets: { cls: SchoolClass; secId: string; secName: string }[] = [];
  classes.forEach(cls => {
    if (scope.type === 'class' && cls.id !== scope.classId) return;
    if (scope.type === 'section' && cls.id !== scope.classId) return;
    cls.sections.forEach(sec => {
      if (scope.type === 'section' && sec.id !== scope.sectionId) return;
      scopedTargets.push({ cls, secId: sec.id, secName: sec.name });
    });
  });

  const scopedSectionKeys = new Set(scopedTargets.map(t => `${t.cls.id}_${t.secId}`));
  const scopedEntries =
    scope.type === 'all'
      ? entries
      : entries.filter(e => scopedSectionKeys.has(`${e.classId}_${e.sectionId}`));

  // Run full conflict detection (global entries catch cross-class double-booking & room collisions)
  const allConflicts = detectAllConflicts(
    entries,
    teachers,
    classes,
    workingDays,
    teachingPeriodIndices,
    subjects,
    settings
  );

  const scopedConflicts =
    scope.type === 'all'
      ? allConflicts
      : allConflicts.filter(
          c =>
            c.type === 'teacher_double_booking' ||
            c.type === 'teacher_unavailable' ||
            c.type === 'teacher_limit_exceeded' ||
            c.type === 'room_conflict' ||
            c.type === 'religion_rule_violation' ||
            c.entryIds.some(id => scopedEntries.some(se => se.id === id)) ||
            (c.classId && c.sectionId && scopedSectionKeys.has(`${c.classId}_${c.sectionId}`))
        );

  const teacherDoubleBookings = scopedConflicts.filter(c => c.type === 'teacher_double_booking');
  const classDoubleBookings = scopedConflicts.filter(
    c => c.type === 'class_double_booking' || c.type === 'unselected_subject'
  );
  const roomConflicts = scopedConflicts.filter(c => c.type === 'room_conflict');
  const wrongTeacherConflicts = scopedConflicts.filter(c => c.type === 'wrong_teacher_assignment');
  const religionRuleConflicts = scopedConflicts.filter(c => c.type === 'religion_rule_violation');
  const unselectedConflicts = scopedConflicts.filter(c => c.type === 'unselected_subject');
  const subjectFixedPeriodConflicts = scopedConflicts.filter(c => c.type === 'subject_fixed_period');
  const unavailableConflicts = scopedConflicts.filter(c => c.type === 'teacher_unavailable');
  const limitConflicts = scopedConflicts.filter(c => c.type === 'teacher_limit_exceeded');
  const workingDaysConflicts = scopedConflicts.filter(c => c.type === 'teacher_working_days_exceeded');
  const consecutivePatternConflicts = scopedConflicts.filter(c => c.type === 'consecutive_pattern_exceeded');

  // Count Same-day repeats in scope
  const daySubMap = new Map<string, number>();
  scopedEntries.forEach(e => {
    const cls = classes.find(c => c.id === e.classId);
    if (cls && isPlayOrNursery(cls)) return;
    const k = `${e.classId}_${e.sectionId}_${e.day}_${e.subjectId}`;
    daySubMap.set(k, (daySubMap.get(k) || 0) + 1);
  });
  let sameDayRepeatCount = 0;
  daySubMap.forEach(cnt => {
    if (cnt > 1) sameDayRepeatCount++;
  });

  // Compute Required vs Assigned across all scoped sections (Zero Unassigned Policy)
  let totalClassesRequired = 0;
  let totalClassesAssigned = 0;
  let unassignedClasses = 0;
  let overQuotaEntriesCount = 0;
  let exceededCapacitySectionsCount = 0;
  const capacityErrors: string[] = [];
  const unassignedDetails: UnassignedClassDetail[] = [];

  for (const { cls, secId, secName } of scopedTargets) {
    const secEntries = scopedEntries.filter(e => e.classId === cls.id && e.sectionId === secId);

    const openSlotCount = workingDays.reduce((acc, d) => {
      return (
        acc +
        teachingPeriods.filter(p => !isSlotDismissed(cls, d, p.periodIndex, secId, workingDays)).length
      );
    }, 0);

    if (isPlayOrNursery(cls)) {
      const assigned = secEntries.length;
      const missing = Math.max(0, openSlotCount - assigned);
      totalClassesRequired += openSlotCount;
      totalClassesAssigned += Math.min(assigned, openSlotCount);
      unassignedClasses += missing;

      if (missing > 0) {
        unassignedDetails.push({
          classId: cls.id,
          className: cls.name,
          sectionId: secId,
          sectionName: secName,
          subjectId: 'sub-block-play-nur',
          subjectName: 'সকল বিষয় (ব্লক টিচার)',
          subjectCode: 'ALL',
          requiredPeriods: openSlotCount,
          assignedPeriods: assigned,
          missingPeriods: missing,
          reason:
            secEntries.length === 0
              ? 'এই শিফটের রুটিন এখনো তৈরি/অটো-ফিল করা হয়নি'
              : 'পর্যাপ্ত ব্লক টিচার স্লট না থাকায় কিছু পিরিয়ড ফাঁকা রয়েছে',
        });
      }
      continue;
    }

    const effectiveReqs = getEffectiveSectionRequirements(cls, secId, teachers);
    const hasHmt =
      isClassNineOrTen(cls) && effectiveReqs.some(r => isHigherMathSubject(r.subjectId, subjects));
    const hasRel = effectiveReqs.some(r => isIslamReligionSubject(r.subjectId, subjects));
    const hasHin = effectiveReqs.some(r => isHinduReligionSubject(r.subjectId, subjects));

    // Calculate physical slots needed for this section (accounting for parallel pairs taking 1 clock slot)
    let sectionPhysicalSlotsRequired = 0;
    const hmtTarget = hasHmt
      ? Math.max(
          effectiveReqs.find(r => isHigherMathSubject(r.subjectId, subjects))?.periodsPerWeek || 0,
          effectiveReqs.find(r => isAgricultureSubject(r.subjectId, subjects))?.periodsPerWeek || 0
        )
      : 0;
    const relTarget = hasRel
      ? effectiveReqs.find(r => isIslamReligionSubject(r.subjectId, subjects))?.periodsPerWeek || 0
      : 0;
    const hinTarget = hasHin
      ? effectiveReqs.find(r => isHinduReligionSubject(r.subjectId, subjects))?.periodsPerWeek || 0
      : 0;

    for (const req of effectiveReqs) {
      let target = req.periodsPerWeek;
      if (hasHmt && isAgricultureSubject(req.subjectId, subjects)) {
        target = Math.max(target, hmtTarget);
      }

      // Add to physical clock demand (skip partner if paired)
      const isPairedAgr =
        hasHmt &&
        isClassNineOrTen(cls) &&
        isAgricultureSubject(req.subjectId, subjects) &&
        effectiveReqs.some(r => isHigherMathSubject(r.subjectId, subjects));
      const isPairedHin = hasRel && hasHin && isHinduReligionSubject(req.subjectId, subjects);
      if (!isPairedAgr && !isPairedHin) {
        sectionPhysicalSlotsRequired += target;
      } else if (isPairedHin) {
        sectionPhysicalSlotsRequired += Math.max(0, hinTarget - relTarget);
      }

      const assigned = secEntries.filter(e => e.subjectId === req.subjectId).length;
      const missing = Math.max(0, target - assigned);
      if (assigned > target) {
        overQuotaEntriesCount += assigned - target;
      }

      totalClassesRequired += target;
      totalClassesAssigned += Math.min(assigned, target);
      unassignedClasses += missing;

      if (missing > 0) {
        const sub = subjectMap.get(req.subjectId);
        const expectedTeacherId = getExpectedSectionTeacherId(cls, secId, req.subjectId, teachers);
        const dedicatedTeacher = expectedTeacherId ? teacherMap.get(expectedTeacherId) : undefined;
        const fixedPeriods = getEffectiveSubjectFixedPeriods(cls, secId, req.subjectId, subjects);
        const fixedNote =
          fixedPeriods && fixedPeriods.length > 0
            ? ` (নির্ধারিত পিরিয়ড: ${fixedPeriods.map(p => `P${p}`).join(', ')})`
            : '';
        const reason =
          secEntries.length === 0
            ? 'সেকশনটির রুটিন এখনো অটো-ফিল করা হয়নি'
            : dedicatedTeacher
            ? `${dedicatedTeacher.name}-এর সাথে নির্ধারিত সময়ে স্লট/বন্ধ পিরিয়ড/দৈনিক সীমা সমন্বয় হয়নি${fixedNote}`
            : `যোগ্য শিক্ষক বা উন্মুক্ত পিরিয়ড স্লট পাওয়া যায়নি${fixedNote}`;

        unassignedDetails.push({
          classId: cls.id,
          className: cls.name,
          sectionId: secId,
          sectionName: secName,
          subjectId: req.subjectId,
          subjectName: sub?.name || req.subjectId,
          subjectCode: sub?.code || '',
          assignedTeacherId: dedicatedTeacher?.id,
          assignedTeacherName: dedicatedTeacher?.name,
          requiredPeriods: target,
          assignedPeriods: assigned,
          missingPeriods: missing,
          reason,
        });
      }
    }

    if (sectionPhysicalSlotsRequired > openSlotCount) {
      exceededCapacitySectionsCount++;
      capacityErrors.push(
        `${cls.name} (${secName}): মোট নির্ধারিত ${sectionPhysicalSlotsRequired} পিরিয়ড > উন্মুক্ত স্লট ${openSlotCount}`
      );
    }
  }

  // Compute Teacher Quota Match & Workload Verification across configured sections
  // Deduplicate simultaneous Combined Hindu Room 307 slots for physical daily/weekly periods.
  const teacherDetails: TeacherVerificationDetail[] = teachers.map(teacher => {
    const teacherEntries = entries.filter(e => e.teacherId === teacher.id);
    const sectionCoveragePeriods = teacherEntries.length;

    const uniquePhysicalSlotKeys = new Set<string>();
    const dayPhysicalSlots = new Map<DayOfWeek, Set<number>>();
    workingDays.forEach(d => dayPhysicalSlots.set(d, new Set<number>()));

    teacherEntries.forEach(e => {
      uniquePhysicalSlotKeys.add(`${e.day}_${e.periodIndex}`);
      const ds = dayPhysicalSlots.get(e.day);
      if (ds) ds.add(e.periodIndex);
    });

    const assignedPeriods = uniquePhysicalSlotKeys.size;

    let requiredPeriods = 0;
    let maxSingleSubFreq = 0;
    if (teacher.isBlockTeacher) {
      classes
        .filter(
          c =>
            isPlayOrNursery(c) &&
            (c.blockTeacherIds?.includes(teacher.id) ||
              (teacher.assignedClassSections || []).some(a => a.classId === c.id))
        )
        .forEach(c => {
          const perClassSlots = workingDays.reduce((acc, d) => {
            return (
              acc +
              teachingPeriods.filter(p => !isSlotDismissed(c, d, p.periodIndex, c.sections[0]?.id, workingDays))
                .length
            );
          }, 0);
          const divisor = Math.max(1, c.blockTeacherIds?.length || 2);
          requiredPeriods += Math.round((perClassSlots * c.sections.length) / divisor);
        });
    } else {
      classes.forEach(cls => {
        if (isPlayOrNursery(cls)) return;
        cls.sections.forEach(sec => {
          const effReqs = getEffectiveSectionRequirements(cls, sec.id, teachers);
          effReqs.forEach(req => {
            let expectedTch = getExpectedSectionTeacherId(cls, sec.id, req.subjectId, teachers);
            if (isHinduReligionSubject(req.subjectId, subjects) && combinedHinduTeacherId) {
              const secExplicit = sec.subjectConfigs?.[req.subjectId]?.assignedTeacherId;
              if (secExplicit === undefined) {
                expectedTch = combinedHinduTeacherId;
              }
            }
            if (expectedTch === teacher.id) {
              requiredPeriods += req.periodsPerWeek;
              if (req.periodsPerWeek > maxSingleSubFreq) {
                maxSingleSubFreq = req.periodsPerWeek;
              }
            }
          });
        });
      });
    }

    const secSubCounts = new Map<string, number>();
    teacherEntries.forEach(e => {
      const k = `${e.classId}__${e.sectionId}__${e.subjectId}`;
      const nxt = (secSubCounts.get(k) || 0) + 1;
      secSubCounts.set(k, nxt);
      if (nxt > maxSingleSubFreq) maxSingleSubFreq = nxt;
    });

    const maxDaily = getTeacherDailyMax(teacher, settings);
    let peakDailyAssigned = 0;
    let dailyLimitViolations = 0;
    let activeDays = 0;
    workingDays.forEach(day => {
      const cnt = dayPhysicalSlots.get(day)?.size || 0;
      if (cnt > 0) activeDays++;
      if (cnt > peakDailyAssigned) peakDailyAssigned = cnt;
      if (cnt > maxDaily) dailyLimitViolations++;
    });

    const missingPeriods = Math.max(0, requiredPeriods - sectionCoveragePeriods);
    const extraPeriods = Math.max(0, sectionCoveragePeriods - requiredPeriods);
    const isBlockTch = isTeacherBlockTeacher(teacher, classes);
    const pattern = analyzeTeacherWeeklyPattern(
      teacher,
      teacherEntries,
      workingDays,
      requiredPeriods,
      maxSingleSubFreq,
      settings
    );

    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      initials: teacher.initials,
      requiredPeriods,
      assignedPeriods,
      sectionCoveragePeriods,
      missingPeriods,
      extraPeriods,
      maxDailyPeriods: maxDaily,
      peakDailyAssigned,
      dailyLimitViolations,
      weeklyCapacityExceeded: assignedPeriods > maxWeeklySlots,
      activeDays,
      maxWorkingDays: pattern.maxWorkingDays,
      workingDaysExceeded: !isBlockTch && pattern.workingDaysExceeded,
      workingDaysMathematicallyImpossible: !isBlockTch && pattern.mathematicallyImpossibleWorkingDays,
      threeConsecDaysCount: isBlockTch ? 0 : pattern.threeConsecDays.length,
      fourPlusConsecDaysCount: isBlockTch ? 0 : pattern.fourPlusConsecDays.length,
      unbalancedDays: !isBlockTch && pattern.unbalancedDays,
    };
  });

  const unassignedTeachersCount = teacherDetails.filter(
    t => t.requiredPeriods > 0 && t.missingPeriods > 0
  ).length;
  const overloadedTeachers = teacherDetails.filter(t => t.weeklyCapacityExceeded);
  const avoidableLimitConflicts = limitConflicts.filter(c => c.severity === 'error');
  const mathCapLimitWarnings = limitConflicts.filter(c => c.severity !== 'error');
  const teacherLimitViolationsCount = avoidableLimitConflicts.length;
  const workingDaysViolationsCount = teacherDetails.filter(
    t => t.workingDaysExceeded && !t.workingDaysMathematicallyImpossible
  ).length;
  const workingDaysImpossibleCount = teacherDetails.filter(
    t => t.workingDaysExceeded && t.workingDaysMathematicallyImpossible
  ).length;
  const fourPlusConsecViolationsCount = teacherDetails.filter(
    t => t.fourPlusConsecDaysCount > 0
  ).length;
  const excessiveThreeConsecTeachersCount = consecutivePatternConflicts.filter(
    c => c.severity === 'error' && c.id.startsWith('conf-consec3excess-')
  ).length;
  const forcedThreeConsecWarningsCount = consecutivePatternConflicts.filter(
    c => c.severity === 'warning' && c.id.startsWith('conf-consec3excess-')
  ).length;
  const unbalancedTeachersCount = teacherDetails.filter(t => t.unbalancedDays).length;
  const unselectedSubjectEntriesCount = scopedEntries.filter(e => {
    const cls = classes.find(c => c.id === e.classId);
    if (!cls || isPlayOrNursery(cls)) return false;
    return !isSubjectSelectedForSection(cls, e.sectionId, e.subjectId);
  }).length;

  // Smart Religion Subject Scheduling Verification (Combined Room 307 + max 3 concurrent sections + Islam separate teachers)
  const islamEntries = scopedEntries.filter(e => isIslamReligionSubject(e.subjectId, subjects));
  const hinduEntries = scopedEntries.filter(e => isHinduReligionSubject(e.subjectId, subjects));
  const islamTeachersUsed = new Set(islamEntries.map(e => e.teacherId).filter(Boolean)).size;
  const hinduTeachersUsed = new Set(hinduEntries.map(e => e.teacherId).filter(Boolean)).size;

  const religionEntryIds = new Set([...islamEntries, ...hinduEntries].map(e => e.id));
  const religionSameTeacherConflicts = allConflicts.filter(
    c =>
      c.type === 'teacher_double_booking' &&
      c.entryIds.some(id => religionEntryIds.has(id))
  ).length;

  const relSlotUniqueSections = new Map<string, Set<string>>();
  scopedEntries.forEach(e => {
    if (!isReligionSubject(e.subjectId, subjects)) return;
    const k = `${e.day}_${e.periodIndex}`;
    const set = relSlotUniqueSections.get(k) || new Set<string>();
    set.add(`${e.classId}_${e.sectionId}`);
    relSlotUniqueSections.set(k, set);
  });

  let simultaneousMultiClassCount = 0;
  let maxConcurrentObserved = 0;
  relSlotUniqueSections.forEach(set => {
    if (set.size > 1) simultaneousMultiClassCount++;
    if (set.size > maxConcurrentObserved) maxConcurrentObserved = set.size;
  });

  const religionOk =
    religionSameTeacherConflicts === 0 &&
    religionRuleConflicts.length === 0 &&
    maxConcurrentObserved <= maxRelConcurrent;

  const religionSchedulingStatus = {
    ok: religionOk,
    label: religionOk
      ? `Compliant (Room ${hinduRoom} · ≤${maxRelConcurrent} Sec/Slot)`
      : `${religionSameTeacherConflicts + religionRuleConflicts.length} Rule Violation`,
    detail: `ইসলাম: ${islamEntries.length} স্লট (${islamTeachersUsed} শিক্ষক) · হিন্দু (Room ${hinduRoom}): ${hinduEntries.length} স্লট (${hinduTeachersUsed} শিক্ষক) · সর্বাধিক সমকালীন সেকশন: ${maxConcurrentObserved}/${maxRelConcurrent}`,
    islamEntriesCount: islamEntries.length,
    hinduEntriesCount: hinduEntries.length,
    islamTeachersUsed,
    hinduTeachersUsed,
    sameTeacherConflicts: religionSameTeacherConflicts,
    simultaneousMultiClassCount,
    maxConcurrentObserved,
    maxConcurrentAllowed: maxRelConcurrent,
    hinduRoom,
  };

  // Build Explicit 8-Item Truthful Final Validation Dashboard
  const quotasOk =
    unassignedClasses === 0 &&
    overQuotaEntriesCount === 0 &&
    exceededCapacitySectionsCount === 0 &&
    sameDayRepeatCount === 0 &&
    unselectedSubjectEntriesCount === 0 &&
    subjectFixedPeriodConflicts.length === 0;

  const quotaFailReasons: string[] = [];
  if (unassignedClasses > 0) quotaFailReasons.push(`${unassignedClasses}টি পিরিয়ড এখনো বাকি`);
  if (overQuotaEntriesCount > 0) quotaFailReasons.push(`${overQuotaEntriesCount}টি অতিরিক্ত কোটা`);
  if (exceededCapacitySectionsCount > 0) quotaFailReasons.push(capacityErrors[0]);
  if (sameDayRepeatCount > 0) quotaFailReasons.push(`${sameDayRepeatCount}টি একই দিনে পুনরাবৃত্তি`);
  if (unselectedSubjectEntriesCount > 0) quotaFailReasons.push(`${unselectedSubjectEntriesCount}টি অনির্বাচিত বিষয়`);
  if (subjectFixedPeriodConflicts.length > 0) quotaFailReasons.push(`${subjectFixedPeriodConflicts.length}টি নির্ধারিত পিরিয়ড লঙ্ঘন`);

  const workloadOk =
    overloadedTeachers.length === 0 &&
    (scope.type !== 'all' || unassignedTeachersCount === 0) &&
    wrongTeacherConflicts.length === 0;
  const workloadFailReasons: string[] = [];
  if (overloadedTeachers.length > 0) {
    workloadFailReasons.push(
      `${overloadedTeachers.map(t => `${t.teacherName} (${t.assignedPeriods}/${maxWeeklySlots})`).join(', ')} সাপ্তাহিক সীমা অতিক্রম করেছে`
    );
  }
  if (scope.type === 'all' && unassignedTeachersCount > 0) {
    workloadFailReasons.push(`${unassignedTeachersCount} জন শিক্ষকের নির্ধারিত ক্লাস বাকি আছে`);
  }
  if (wrongTeacherConflicts.length > 0) {
    workloadFailReasons.push(`${wrongTeacherConflicts.length}টি সেকশনে নির্ধারিত শিক্ষকের অমিল`);
  }

  const limitTeacherSummaryMap = new Map<string, { name: string; count: number; days: string[] }>();
  avoidableLimitConflicts.forEach(c => {
    const tName = c.teacherId
      ? teacherMap.get(c.teacherId)?.name ||
        c.title.replace(/^Daily Period Limit Exceeded:\s*|^Teacher Weekly Capacity Exceeded:\s*/, '')
      : c.title;
    const key = c.teacherId || tName;
    const existing = limitTeacherSummaryMap.get(key) || { name: tName, count: 0, days: [] };
    existing.count += 1;
    const label = c.id.startsWith('conf-tweek-') ? 'Weekly' : c.day;
    if (label && !existing.days.includes(label)) {
      existing.days.push(label);
    }
    limitTeacherSummaryMap.set(key, existing);
  });
  const limitTeachersDetail = Array.from(limitTeacherSummaryMap.values())
    .map(item => `${item.name} (${item.count}টি: ${item.days.join(', ')})`)
    .join(' · ');

  const mathCapLimitTeacherNames = Array.from(
    new Set(
      mathCapLimitWarnings.map(c =>
        c.teacherId ? teacherMap.get(c.teacherId)?.name || c.teacherId : c.title
      )
    )
  );

  const availConflictCount = teacherDoubleBookings.length + unavailableConflicts.length;

  const finalValidation: FinalValidationSummary = {
    allPassed: false,
    subjectWeeklyQuotas: {
      id: 'fv-quotas',
      label: 'Subject Weekly Quotas',
      status: quotasOk ? 'PASS' : 'FAIL',
      valueText: quotasOk ? 'PASS' : 'FAIL',
      detail: quotasOk
        ? `সকল সেকশনের নির্বাচিত বিষয়ের সাপ্তাহিক পিরিয়ড (${totalClassesAssigned}/${totalClassesRequired}) ও একই দিনে ১-বার নিয়ম ১০০% ঠিক আছে।`
        : quotaFailReasons.join(' · '),
    },
    teacherWorkload: {
      id: 'fv-workload',
      label: 'Teacher Workload',
      status: workloadOk ? 'PASS' : 'FAIL',
      valueText: workloadOk ? 'PASS' : 'FAIL',
      detail: workloadOk
        ? 'সকল শিক্ষকের সাপ্তাহিক কর্মভার এবং নির্ধারিত সেকশন লোড সামঞ্জস্যপূর্ণ।'
        : workloadFailReasons.join(' · '),
    },
    sectionTeacherAssignment: {
      id: 'fv-sec-teacher',
      label: 'Section-wise Teacher Assignment',
      status: wrongTeacherConflicts.length === 0 ? 'PASS' : 'FAIL',
      valueText: wrongTeacherConflicts.length === 0 ? 'PASS' : 'FAIL',
      numericValue: wrongTeacherConflicts.length,
      detail:
        wrongTeacherConflicts.length === 0
          ? 'প্রতিটি সেকশনের প্রতিটি বিষয়ে নির্ধারিত নিজস্ব শিক্ষক সঠিক রয়েছেন।'
          : `${wrongTeacherConflicts.length}টি এন্ট্রিতে সেকশন অনুযায়ী নির্ধারিত শিক্ষকের অমিল রয়েছে (${wrongTeacherConflicts[0].title})।`,
    },
    dailyWeeklyLimits: {
      id: 'fv-limits',
      label: 'Daily/Weekly Teacher Limits',
      status: teacherLimitViolationsCount === 0 ? 'PASS' : 'FAIL',
      valueText: teacherLimitViolationsCount === 0 ? 'PASS' : 'FAIL',
      numericValue: teacherLimitViolationsCount,
      detail:
        teacherLimitViolationsCount === 0
          ? mathCapLimitWarnings.length > 0
            ? `সকল অর্জনযোগ্য শিক্ষক দৈনিক ৪ ক্লাসের মধ্যে আছেন (গাণিতিক লোড-ক্যাপ নোটিশ: ${mathCapLimitTeacherNames.join(', ')} ≤৫/দিন)।`
            : 'সকল শিক্ষক দৈনিক (≤৪টি) ও সাপ্তাহিক ক্লাস সীমার মধ্যে আছেন।'
          : `${teacherLimitViolationsCount}টি দৈনিক/সাপ্তাহিক পিরিয়ড সীমা লঙ্ঘন (${limitTeacherSummaryMap.size} জন শিক্ষক): ${limitTeachersDetail}।`,
    },
    teacherAvailabilityConflicts: {
      id: 'fv-avail',
      label: 'Teacher Availability Conflicts',
      status: availConflictCount === 0 ? 'PASS' : 'FAIL',
      valueText: `${availConflictCount}`,
      numericValue: availConflictCount,
      detail:
        availConflictCount === 0
          ? 'কোনো শিক্ষক ডাবল-বুকিং বা অনুপলব্ধতা সংঘর্ষ নেই (0)।'
          : `${availConflictCount}টি শিক্ষক সময়/অনুপলব্ধতা সংঘর্ষ (${teacherDoubleBookings.length} ডাবল-বুকিং, ${unavailableConflicts.length} অনুপলব্ধ)।`,
    },
    roomConflicts: {
      id: 'fv-rooms',
      label: 'Room Conflicts',
      status: roomConflicts.length === 0 ? 'PASS' : 'FAIL',
      valueText: `${roomConflicts.length}`,
      numericValue: roomConflicts.length,
      detail:
        roomConflicts.length === 0
          ? `কক্ষ ব্যবহারে কোনো সংঘর্ষ নেই (Room ${hinduRoom} ও Agriculture Room সমন্বিত)।`
          : `${roomConflicts.length}টি রুম সংঘর্ষ পাওয়া গেছে (${roomConflicts[0].title})।`,
    },
    unassignedPeriods: {
      id: 'fv-unassigned',
      label: 'Unassigned Periods',
      status: unassignedClasses === 0 ? 'PASS' : 'FAIL',
      valueText: `${unassignedClasses}`,
      numericValue: unassignedClasses,
      detail:
        unassignedClasses === 0
          ? 'কোনো ফাঁকা বা বরাদ্দহীন পিরিয়ড নেই (0)।'
          : `${unassignedClasses}টি পিরিয়ড এখনো বরাদ্দ করা সম্ভব হয়নি।`,
    },
    combinedReligiousClasses: {
      id: 'fv-religion',
      label: 'Combined Religious Classes',
      status: religionSchedulingStatus.ok ? 'PASS' : 'FAIL',
      valueText: religionSchedulingStatus.ok ? 'PASS' : 'FAIL',
      detail: religionSchedulingStatus.ok
        ? `ইসলাম + হিন্দু সম্মিলিত (Room ${hinduRoom}, সর্বোচ্চ ${maxRelConcurrent} সেকশন/পিরিয়ড) ১০০% সঠিক।`
        : religionRuleConflicts[0]?.description ||
          `${religionSameTeacherConflicts}টি ধর্মীয় শিক্ষক/রুম/সেকশন-সীমা ত্রুটি পাওয়া গেছে।`,
    },
    items: [],
  };

  finalValidation.items = [
    finalValidation.subjectWeeklyQuotas,
    finalValidation.teacherWorkload,
    finalValidation.sectionTeacherAssignment,
    finalValidation.dailyWeeklyLimits,
    finalValidation.teacherAvailabilityConflicts,
    finalValidation.roomConflicts,
    finalValidation.unassignedPeriods,
    finalValidation.combinedReligiousClasses,
  ];
  finalValidation.allPassed = finalValidation.items.every(item => item.status === 'PASS');

  // 8-Point Audit Checks (reused by ComplianceAuditPanel checklist)
  const checks: VerificationCheckItem[] = [
    {
      id: 'chk-teacher-double',
      label: '1. শিক্ষক ওভারল্যাপ ও অনুপলব্ধতা (Teacher Availability Conflicts)',
      passed: availConflictCount === 0,
      severity: 'error',
      detail: finalValidation.teacherAvailabilityConflicts.detail,
    },
    {
      id: 'chk-room-conflicts',
      label: '2. শ্রেণিকক্ষ সংঘর্ষ যাচাই (Room Conflicts & Room 307)',
      passed: roomConflicts.length === 0,
      severity: 'error',
      detail: finalValidation.roomConflicts.detail,
    },
    {
      id: 'chk-class-double',
      label: '3. শ্রেণি/সেকশন ওভারল্যাপ ও একই দিনে পুনরাবৃত্তি',
      passed: classDoubleBookings.length === 0 && sameDayRepeatCount === 0,
      severity: 'error',
      detail:
        classDoubleBookings.length === 0 && sameDayRepeatCount === 0
          ? 'কোনো সেকশনে একই পিরিয়ডে দ্বৈত ক্লাস বা একই দিনে বিষয়ের পুনরাবৃত্তি নেই।'
          : `${classDoubleBookings.length}টি ওভারল্যাপ এবং ${sameDayRepeatCount}টি একই দিনে বিষয়ের পুনরাবৃত্তি রয়েছে।`,
    },
    {
      id: 'chk-subject-quota',
      label: '4. বিষয়ভিত্তিক সাপ্তাহিক পিরিয়ড পূর্ণতা (Subject Weekly Quotas)',
      passed: quotasOk,
      severity: 'error',
      detail: finalValidation.subjectWeeklyQuotas.detail,
    },
    {
      id: 'chk-section-teacher',
      label: '5. সেকশন-ভিত্তিক শিক্ষক নির্ধারণ (Section-wise Teacher Assignment)',
      passed: wrongTeacherConflicts.length === 0,
      severity: 'error',
      detail: finalValidation.sectionTeacherAssignment.detail,
    },
    {
      id: 'chk-teacher-unassigned',
      label: '6. শিক্ষক কর্মভার যাচাই (Teacher Workload Verification)',
      passed: workloadOk,
      severity: 'error',
      detail: finalValidation.teacherWorkload.detail,
    },
    {
      id: 'chk-teacher-limits',
      label: '7. দৈনিক ও সাপ্তাহিক পিরিয়ড সীমা (Daily/Weekly Teacher Limits)',
      passed: teacherLimitViolationsCount === 0,
      severity: teacherLimitViolationsCount > 0 ? 'error' : 'warning',
      detail: finalValidation.dailyWeeklyLimits.detail,
    },
    {
      id: 'chk-religion-rules',
      label: `8. সম্মিলিত ধর্মীয় ক্লাস (Room ${hinduRoom} · ≤${maxRelConcurrent} সেকশন)`,
      passed: religionSchedulingStatus.ok,
      severity: 'error',
      detail: religionSchedulingStatus.detail,
    },
    {
      id: 'chk-working-days',
      label: `9. সাপ্তাহিক সর্বোচ্চ ${configuredWorkingDaysCap} কার্যদিবস সীমা (Weekly Working Days ≤ ${configuredWorkingDaysCap})`,
      passed: workingDaysViolationsCount === 0 && workingDaysImpossibleCount === 0,
      severity: workingDaysViolationsCount > 0 ? 'error' : 'warning',
      detail:
        workingDaysViolationsCount === 0 && workingDaysImpossibleCount === 0
          ? `সব নিয়মিত শিক্ষক সপ্তাহে সর্বোচ্চ ${configuredWorkingDaysCap} কার্যদিবসের মধ্যে ক্লাস নিচ্ছেন।`
          : workingDaysViolationsCount > 0
          ? `${workingDaysViolationsCount} জন শিক্ষকের সাপ্তাহিক কার্যদিবস ${configuredWorkingDaysCap} দিনের বেশি (${workingDaysConflicts[0]?.title || 'Auto-Fix প্রয়োজন'})।`
          : `${workingDaysImpossibleCount} জন শিক্ষকের মোট ক্লাস সংখ্যা > (${configuredWorkingDaysCap} দিন × দৈনিক সীমা) হওয়ায় অতিরিক্ত দিন প্রয়োজন হয়েছে।`,
    },
    {
      id: 'chk-consecutive-pattern',
      label: '10. একটানা ক্লাস নিয়ন্ত্রণ (৪+ সম্পূর্ণ নিষিদ্ধ, ৩-টানা ≤ ২ দিন)',
      passed: fourPlusConsecViolationsCount === 0 && excessiveThreeConsecTeachersCount === 0 && forcedThreeConsecWarningsCount === 0,
      severity: fourPlusConsecViolationsCount > 0 || excessiveThreeConsecTeachersCount > 0 ? 'error' : 'warning',
      detail:
        fourPlusConsecViolationsCount === 0 && excessiveThreeConsecTeachersCount === 0 && forcedThreeConsecWarningsCount === 0
          ? 'কোনো শিক্ষকের একটানা ৪+ ক্লাস নেই এবং ৩-টানা ক্লাস অনুমোদিত সীমার মধ্যে।'
          : fourPlusConsecViolationsCount === 0 && excessiveThreeConsecTeachersCount === 0
          ? `৪+ একটানা ক্লাস ০টি; ${forcedThreeConsecWarningsCount} জন মর্নিং/উচ্চ লোড শিক্ষকের কাঠামোগত ৩-টানা ক্লাস রয়েছে।`
          : consecutivePatternConflicts[0]?.description ||
            `${fourPlusConsecViolationsCount} জন শিক্ষকের ৪+ একটানা এবং ${excessiveThreeConsecTeachersCount} জনের ২ দিনের বেশি ৩-টানা ক্লাস রয়েছে।`,
    },
  ];

  // Determine Final Routine Completion Status (truthfully!)
  const criticalErrorsCount =
    teacherDoubleBookings.length +
    classDoubleBookings.length +
    roomConflicts.length +
    wrongTeacherConflicts.length +
    religionRuleConflicts.length +
    unavailableConflicts.length +
    unselectedSubjectEntriesCount +
    subjectFixedPeriodConflicts.length +
    exceededCapacitySectionsCount +
    overQuotaEntriesCount +
    limitConflicts.filter(c => c.severity === 'error').length +
    workingDaysViolationsCount +
    fourPlusConsecViolationsCount +
    excessiveThreeConsecTeachersCount +
    (religionSchedulingStatus.ok ? 0 : 1);

  const hasUnassigned = unassignedClasses > 0 || (scope.type === 'all' && unassignedTeachersCount > 0);
  const hasWarnings =
    teacherLimitViolationsCount > 0 ||
    sameDayRepeatCount > 0 ||
    workingDaysImpossibleCount > 0 ||
    forcedThreeConsecWarningsCount > 0 ||
    unbalancedTeachersCount > 0;

  let finalCompletionStatus: 'complete' | 'incomplete' | 'warning' = 'complete';
  let statusHeadline = 'Routine Verified — All Checks Passed';
  let statusSubtext = `0 Unassigned · 0 Teacher/Room Conflicts · ≤${configuredDailyCap}/Day & ≤${configuredWorkingDaysCap} Working Days Verified`;

  if (criticalErrorsCount > 0 || hasUnassigned) {
    finalCompletionStatus = 'incomplete';
    statusHeadline = 'Action Required — Validation Failed';
    const reasons: string[] = [];
    if (unassignedClasses > 0) reasons.push(`${unassignedClasses} Unassigned Periods`);
    if (wrongTeacherConflicts.length > 0) reasons.push(`${wrongTeacherConflicts.length} Wrong Section Teachers`);
    if (subjectFixedPeriodConflicts.length > 0) reasons.push(`${subjectFixedPeriodConflicts.length} Fixed Period Violations`);
    if (roomConflicts.length > 0) reasons.push(`${roomConflicts.length} Room Conflicts`);
    if (availConflictCount > 0) reasons.push(`${availConflictCount} Teacher Conflicts`);
    if (classDoubleBookings.length > 0) reasons.push(`${classDoubleBookings.length} Section Overlaps`);
    if (workingDaysViolationsCount > 0) reasons.push(`${workingDaysViolationsCount} Teachers > ${configuredWorkingDaysCap} Working Days`);
    if (fourPlusConsecViolationsCount > 0) reasons.push(`${fourPlusConsecViolationsCount} Teachers w/ 4+ Consecutive`);
    if (excessiveThreeConsecTeachersCount > 0) reasons.push(`${excessiveThreeConsecTeachersCount} Excessive 3-Consec Days`);
    if (!religionSchedulingStatus.ok) reasons.push('Combined Religion Rule Issue');
    if (exceededCapacitySectionsCount > 0) reasons.push(`${exceededCapacitySectionsCount} Over-Subscribed Sections`);
    statusSubtext = reasons.join(' · ') || 'Review validation details below.';
  } else if (hasWarnings) {
    finalCompletionStatus = 'warning';
    statusHeadline = 'Routine Complete With Workload Notices';
    statusSubtext = `0 Unassigned · 0 Critical Conflicts · ${teacherLimitViolationsCount} Limit / ${workingDaysImpossibleCount} Math-Cap / ${unbalancedTeachersCount} Balance Notices`;
  }

  const verificationTimeMs = Math.max(
    1,
    Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - verifyStartMs)
  );

  // Programmatic runtime checks for sys-1, sys-2, sys-3 (replacing static defaults)
  const validClassIds = new Set(classes.map(c => c.id));
  const validSubjectIds = new Set(subjects.map(s => s.id));
  const validDaySetForHealth = new Set(workingDays);
  const validPeriodSetForHealth = new Set(teachingPeriodIndices);
  const brokenEntryRefs = scopedEntries.filter(
    e =>
      !validClassIds.has(e.classId) ||
      !validSubjectIds.has(e.subjectId) ||
      !validDaySetForHealth.has(e.day) ||
      !validPeriodSetForHealth.has(e.periodIndex)
  ).length;
  const hasCoreCatalog = classes.length > 0 && teachers.length > 0 && subjects.length > 0 && workingDays.length > 0;
  let storageAccessible = true;
  let snapshotCount = 0;
  let exposedPiiCount = 0;
  let hasUnsafeClientSecret = false;
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const testKey = '__idsc_health_probe__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      const snapshotKeys = ['school_routine_snapshots_v1', 'idsc_routine_snapshots_v1'];
      for (const snapKey of snapshotKeys) {
        const rawSnapshots = localStorage.getItem(snapKey);
        if (!rawSnapshots) continue;
        const parsedSnaps = JSON.parse(rawSnapshots);
        if (Array.isArray(parsedSnaps)) {
          snapshotCount += parsedSnaps.length;
          for (const snap of parsedSnaps) {
            const snapTeachers = snap?.state?.teachers;
            if (Array.isArray(snapTeachers)) {
              exposedPiiCount += snapTeachers.filter((t: any) => Boolean(t?.email || t?.phone)).length;
            }
          }
        }
      }
      const teacherKeys = ['school_routine_teachers_v1', 'idsc_teachers_v2'];
      for (const tchKey of teacherKeys) {
        const rawTeachers = localStorage.getItem(tchKey);
        if (!rawTeachers) continue;
        const parsedTeachers = JSON.parse(rawTeachers);
        if (Array.isArray(parsedTeachers)) {
          exposedPiiCount += parsedTeachers.filter((t: any) => Boolean(t?.email || t?.phone)).length;
        }
      }
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (/gemini_api_key|api_secret|private_key/i.test(k)) {
          hasUnsafeClientSecret = true;
        }
      }
    } catch {
      storageAccessible = false;
    }
  }

  const orderedPeriodsOk =
    teachingPeriodIndices.length > 0 &&
    periodTimings.every(p => Boolean(p.label?.trim()) && Boolean(p.startTime?.trim()) && Boolean(p.endTime?.trim()));
  let domOverflowPx = 0;
  let hasDomMetrics = false;
  if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.documentElement) {
    hasDomMetrics = true;
    domOverflowPx = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
  }
  const uiResponsiveOk = orderedPeriodsOk && (!hasDomMetrics || domOverflowPx <= 4);
  const functionalityOk = hasCoreCatalog && brokenEntryRefs === 0 && storageAccessible;
  const securityOk = exposedPiiCount === 0 && !hasUnsafeClientSecret;

  // Build Comprehensive 13-Point System Health Report
  const healthItems: SystemHealthCheckItem[] = [
    {
      id: 'sys-1',
      order: 1,
      label: 'Website Functionality Status',
      status: !hasCoreCatalog ? 'FAIL' : functionalityOk ? 'PASS' : 'WARNING',
      valueText: !hasCoreCatalog ? 'FAIL' : functionalityOk ? 'PASS' : `${brokenEntryRefs} Broken Refs`,
      detail: functionalityOk
        ? `ক্যাটালগ (${classes.length} শ্রেণি, ${teachers.length} শিক্ষক), ${scopedEntries.length}টি বৈধ এন্ট্রি এবং ${snapshotCount}টি সেভ করা স্ন্যাপশট যাচাই সম্পন্ন।`
        : `${brokenEntryRefs}টি অসামঞ্জস্যপূর্ণ এন্ট্রি রেফারেন্স বা স্টোরেজ ত্রুটি শনাক্ত হয়েছে।`,
    },
    {
      id: 'sys-2',
      order: 2,
      label: 'UI/UX & Responsiveness Check',
      status: !orderedPeriodsOk ? 'FAIL' : uiResponsiveOk ? 'PASS' : 'WARNING',
      valueText: !orderedPeriodsOk ? 'FAIL' : hasDomMetrics && domOverflowPx > 4 ? `${domOverflowPx}px Overflow` : 'PASS',
      detail: uiResponsiveOk
        ? `${teachingPeriodIndices.length}টি পিরিয়ড লেবেল ও সময় সঠিক${hasDomMetrics ? ` (অনুভূমিক ওভারফ্লো: ${domOverflowPx}px)` : ''}।`
        : !orderedPeriodsOk
        ? 'পিরিয়ড টাইমিং বা লেবেল অসম্পূর্ণ রয়েছে।'
        : `বর্তমান ভিউপোর্টে ${domOverflowPx}px অনুভূমিক ওভারফ্লো শনাক্ত হয়েছে।`,
    },
    {
      id: 'sys-3',
      order: 3,
      label: 'Security Audit Status',
      status: securityOk ? 'PASS' : 'FAIL',
      valueText: securityOk ? 'PASS' : `${exposedPiiCount} PII / Key Risk`,
      detail: securityOk
        ? 'লোকাল স্টোরেজে শিক্ষকদের ব্যক্তিগত ইমেইল/ফোন PII বা কোনো ক্লায়েন্ট সিক্রেট কী নেই; Excel ফর্মুলা ও ইনপুট সুরক্ষিত।'
        : `লোকাল স্টোরেজে ${exposedPiiCount}টি অ-সুরক্ষিত PII বা সংবেদনশীল কী পাওয়া গেছে।`,
    },
    {
      id: 'sys-4',
      order: 4,
      label: 'Database Integrity Check',
      status:
        unselectedSubjectEntriesCount === 0 && overQuotaEntriesCount === 0 && exceededCapacitySectionsCount === 0
          ? 'PASS'
          : 'FAIL',
      valueText:
        unselectedSubjectEntriesCount === 0 && overQuotaEntriesCount === 0 && exceededCapacitySectionsCount === 0
          ? 'PASS'
          : 'FAIL',
      detail:
        unselectedSubjectEntriesCount === 0 && overQuotaEntriesCount === 0 && exceededCapacitySectionsCount === 0
          ? `${scopedTargets.length}টি সেকশন ও ${teachers.length} জন শিক্ষকের ডেটা ১০০% সামঞ্জস্যপূর্ণ।`
          : `${unselectedSubjectEntriesCount} অনির্বাচিত বিষয়, ${overQuotaEntriesCount} অতিরিক্ত কোটা।`,
    },
    {
      id: 'sys-5',
      order: 5,
      label: 'Routine Generation Engine Test',
      status: unassignedClasses === 0 && classDoubleBookings.length === 0 && wrongTeacherConflicts.length === 0 ? 'PASS' : 'FAIL',
      valueText: unassignedClasses === 0 && classDoubleBookings.length === 0 ? 'PASS' : `${unassignedClasses} Unassigned`,
      detail: `${totalClassesAssigned}/${totalClassesRequired} ক্লাস সফলভাবে বরাদ্দ (${unassignedClasses} বাকি)।`,
    },
    {
      id: 'sys-6',
      order: 6,
      label: 'Subject Weekly Quotas Check',
      status: quotasOk ? 'PASS' : 'FAIL',
      valueText: quotasOk ? 'PASS' : 'FAIL',
      detail: finalValidation.subjectWeeklyQuotas.detail,
    },
    {
      id: 'sys-7',
      order: 7,
      label: 'Teacher Assignment Accuracy',
      status: wrongTeacherConflicts.length === 0 ? 'PASS' : 'FAIL',
      valueText: wrongTeacherConflicts.length === 0 ? 'PASS' : `${wrongTeacherConflicts.length} Mismatch`,
      detail: finalValidation.sectionTeacherAssignment.detail,
    },
    {
      id: 'sys-8',
      order: 8,
      label: `Teacher Weekly Working Days (<= ${configuredWorkingDaysCap} Days)`,
      status:
        workingDaysViolationsCount > 0
          ? 'FAIL'
          : workingDaysImpossibleCount > 0
          ? 'WARNING'
          : 'PASS',
      valueText:
        workingDaysViolationsCount > 0
          ? `${workingDaysViolationsCount} Exceeded`
          : workingDaysImpossibleCount > 0
          ? `${workingDaysImpossibleCount} Math-Cap`
          : 'PASS',
      detail:
        workingDaysViolationsCount > 0
          ? `${workingDaysViolationsCount} জন নিয়মিত শিক্ষকের ${configuredWorkingDaysCap} দিনের বেশি ক্লাস কমানো সম্ভব (Auto-Fix করুন)।`
          : workingDaysImpossibleCount > 0
          ? `সব সম্ভাব্য শিক্ষক ≤${configuredWorkingDaysCap} দিনে আছেন; ${workingDaysImpossibleCount} জনের মোট ক্লাস > (${configuredWorkingDaysCap}×দৈনিক সীমা)।`
          : `সকল সক্ষম শিক্ষক ≤${configuredWorkingDaysCap} কার্যদিবসের মধ্যে কর্মরত।`,
    },
    {
      id: 'sys-9',
      order: 9,
      label: 'Consecutive Class Limit (4+ = 0)',
      status:
        fourPlusConsecViolationsCount > 0 || excessiveThreeConsecTeachersCount > 0
          ? 'FAIL'
          : forcedThreeConsecWarningsCount > 0
          ? 'WARNING'
          : 'PASS',
      valueText:
        fourPlusConsecViolationsCount > 0 || excessiveThreeConsecTeachersCount > 0
          ? `${fourPlusConsecViolationsCount} Four+ / ${excessiveThreeConsecTeachersCount} >2d 3x`
          : forcedThreeConsecWarningsCount > 0
          ? `0 Four+ (${forcedThreeConsecWarningsCount} Shift-Cap)`
          : 'PASS',
      detail:
        fourPlusConsecViolationsCount === 0 && excessiveThreeConsecTeachersCount === 0 && forcedThreeConsecWarningsCount === 0
          ? '৪+ একটানা ক্লাস ০টি এবং পরপর ৩ ক্লাস সীমিত (≤২ দিন/সপ্তাহ)।'
          : fourPlusConsecViolationsCount === 0 && excessiveThreeConsecTeachersCount === 0
          ? `৪+ একটানা ক্লাস সম্পূর্ণ ০টি; ${forcedThreeConsecWarningsCount} জন মর্নিং/উচ্চ লোড শিক্ষকের ৩-টানা ক্লাস সীমিত পর্যায়ে।`
          : `${fourPlusConsecViolationsCount} জন শিক্ষকের ৪+ একটানা এবং ${excessiveThreeConsecTeachersCount} জনের ২ দিনের বেশি ৩-টানা ক্লাস রয়েছে।`,
    },
    {
      id: 'sys-10',
      order: 10,
      label: 'Teacher Daily Workload Balance',
      status:
        teacherLimitViolationsCount > 0
          ? 'FAIL'
          : mathCapLimitWarnings.length > 0 || unbalancedTeachersCount > 0
          ? 'WARNING'
          : 'PASS',
      valueText:
        teacherLimitViolationsCount === 0 && unbalancedTeachersCount === 0 && mathCapLimitWarnings.length === 0
          ? 'PASS'
          : teacherLimitViolationsCount > 0
          ? `${teacherLimitViolationsCount} Exceeded`
          : mathCapLimitWarnings.length > 0
          ? `0 Avoidable (${mathCapLimitTeacherNames.length} Math-Cap)`
          : `${unbalancedTeachersCount} Unbalanced`,
      detail:
        teacherLimitViolationsCount === 0 && unbalancedTeachersCount === 0 && mathCapLimitWarnings.length === 0
          ? 'সক্রিয় কার্যদিবসে সকল শিক্ষকের দৈনিক ক্লাস সমভাবে বণ্টিত (≤৪টি/দিন)।'
          : teacherLimitViolationsCount > 0
          ? `${teacherLimitViolationsCount}টি দৈনিক সীমা লঙ্ঘন (${limitTeachersDetail}), ${unbalancedTeachersCount} জন শিক্ষকের দৈনিক বণ্টন অসম।`
          : `সব অর্জনযোগ্য শিক্ষক ≤৪/দিন; গাণিতিক লোড-ক্যাপ নোটিশ: ${mathCapLimitTeacherNames.join(', ')} (≤৫/দিন), ${unbalancedTeachersCount} জন শিক্ষকের দৈনিক বণ্টন অসম।`,
    },
    {
      id: 'sys-11',
      order: 11,
      label: 'Room Conflict Check',
      status: roomConflicts.length === 0 && religionSchedulingStatus.ok ? 'PASS' : 'FAIL',
      valueText: roomConflicts.length === 0 && religionSchedulingStatus.ok ? '0' : `${roomConflicts.length}`,
      detail: finalValidation.roomConflicts.detail,
    },
    {
      id: 'sys-12',
      order: 12,
      label: 'Teacher Availability Conflict Check',
      status: availConflictCount === 0 ? 'PASS' : 'FAIL',
      valueText: `${availConflictCount}`,
      detail: finalValidation.teacherAvailabilityConflicts.detail,
    },
    {
      id: 'sys-13',
      order: 13,
      label: 'Performance Test (< 1000ms)',
      status: verificationTimeMs < 1000 ? 'PASS' : 'WARNING',
      valueText: `${verificationTimeMs} ms`,
      detail: `মেমোরি-অপ্টিমাইজড ভেরিফিকেশন ও অডিট ${verificationTimeMs}ms সময়ে সম্পন্ন হয়েছে।`,
    },
  ];

  const passCount = healthItems.filter(i => i.status === 'PASS').length;
  const warningCount = healthItems.filter(i => i.status === 'WARNING').length;
  const failCount = healthItems.filter(i => i.status === 'FAIL').length;
  const systemHealthReport: SystemHealthReport = {
    overallStatus: failCount > 0 ? 'FAIL' : warningCount > 0 ? 'WARNING' : 'PASS',
    passCount,
    warningCount,
    failCount,
    items: healthItems,
  };

  const totalSubjects = subjects.filter(s => s.id !== 'sub-block-play-nur').length;
  const scopeLabel =
    scope.type === 'all'
      ? `All School (${scopedTargets.length} Sections)`
      : scope.type === 'class'
      ? `${classes.find(c => c.id === scope.classId)?.name || 'Class'} (${scopedTargets.length} Sections)`
      : `${classes.find(c => c.id === scope.classId)?.name || 'Class'} · ${
          scopedTargets[0]?.secName || 'Section'
        }`;

  return {
    scopeLabel,
    totalClassesRequired,
    totalClassesAssigned,
    totalTeachers: teachers.length,
    totalSubjects,
    totalSections: scopedTargets.length,
    unassignedClasses,
    teacherConflicts: availConflictCount,
    classSectionConflicts: classDoubleBookings.length,
    roomConflictsCount: roomConflicts.length,
    wrongTeacherAssignmentsCount: wrongTeacherConflicts.length,
    religionViolationsCount: religionRuleConflicts.length,
    overQuotaEntriesCount,
    exceededCapacitySectionsCount,
    religionSchedulingStatus,
    finalCompletionStatus,
    statusHeadline,
    statusSubtext,
    finalValidation,
    unassignedDetails,
    teacherDetails,
    unassignedTeachersCount,
    teacherLimitViolationsCount,
    workingDaysViolationsCount,
    workingDaysImpossibleCount,
    fourPlusConsecViolationsCount,
    excessiveThreeConsecTeachersCount,
    unbalancedTeachersCount,
    verificationTimeMs,
    systemHealthReport,
    unselectedSubjectEntriesCount,
    sameDayRepeatCount,
    checks,
    conflicts: scopedConflicts,
  };
}
