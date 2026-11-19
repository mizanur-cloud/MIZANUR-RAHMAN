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
} from './parallelSubjects';
import { isSlotDismissed } from './scheduleTiers';

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
  const teachingPeriods = periodTimings.filter(p => !p.isBreak && !p.isLocked);
  const teachingPeriodIndices = teachingPeriods.map(p => p.periodIndex);
  const maxWeeklySlots = Math.max(1, workingDays.length * Math.max(1, teachingPeriodIndices.length));

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
  const unavailableConflicts = scopedConflicts.filter(c => c.type === 'teacher_unavailable');
  const limitConflicts = scopedConflicts.filter(c => c.type === 'teacher_limit_exceeded');

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
      if (hasRel && hasHin && isHinduReligionSubject(req.subjectId, subjects)) {
        target = Math.max(target, relTarget);
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
        const reason =
          secEntries.length === 0
            ? 'সেকশনটির রুটিন এখনো অটো-ফিল করা হয়নি'
            : dedicatedTeacher
            ? `${dedicatedTeacher.name}-এর সাথে নির্ধারিত সময়ে স্লট/দৈনিক সীমা সমন্বয় হয়নি`
            : 'যোগ্য শিক্ষক বা উন্মুক্ত পিরিয়ড স্লট পাওয়া যায়নি';

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
            if (!expectedTch && isHinduReligionSubject(req.subjectId, subjects) && teacher.id === combinedHinduTeacherId) {
              const secExplicit = sec.subjectConfigs?.[req.subjectId]?.assignedTeacherId;
              if (secExplicit === undefined) {
                expectedTch = combinedHinduTeacherId;
              }
            }
            if (expectedTch === teacher.id) {
              requiredPeriods += req.periodsPerWeek;
            }
          });
        });
      });
    }

    const maxDaily = teacher.maxDailyPeriods || 4;
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
    };
  });

  const unassignedTeachersCount = teacherDetails.filter(
    t => t.requiredPeriods > 0 && t.missingPeriods > 0
  ).length;
  const overloadedTeachers = teacherDetails.filter(t => t.weeklyCapacityExceeded);
  const teacherLimitViolationsCount = limitConflicts.length;
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
    unselectedSubjectEntriesCount === 0;

  const quotaFailReasons: string[] = [];
  if (unassignedClasses > 0) quotaFailReasons.push(`${unassignedClasses}টি পিরিয়ড এখনো বাকি`);
  if (overQuotaEntriesCount > 0) quotaFailReasons.push(`${overQuotaEntriesCount}টি অতিরিক্ত কোটা`);
  if (exceededCapacitySectionsCount > 0) quotaFailReasons.push(capacityErrors[0]);
  if (sameDayRepeatCount > 0) quotaFailReasons.push(`${sameDayRepeatCount}টি একই দিনে পুনরাবৃত্তি`);
  if (unselectedSubjectEntriesCount > 0) quotaFailReasons.push(`${unselectedSubjectEntriesCount}টি অনির্বাচিত বিষয়`);

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
          ? 'সকল শিক্ষক দৈনিক ও সাপ্তাহিক সর্বোচ্চ ক্লাস সীমার মধ্যে আছেন।'
          : `${teacherLimitViolationsCount}টি দৈনিক/সাপ্তাহিক পিরিয়ড সীমা লঙ্ঘন পাওয়া গেছে (${limitConflicts[0].title})।`,
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
      severity: limitConflicts.some(c => c.severity === 'error') ? 'error' : 'warning',
      detail: finalValidation.dailyWeeklyLimits.detail,
    },
    {
      id: 'chk-religion-rules',
      label: `8. সম্মিলিত ধর্মীয় ক্লাস (Room ${hinduRoom} · ≤${maxRelConcurrent} সেকশন)`,
      passed: religionSchedulingStatus.ok,
      severity: 'error',
      detail: religionSchedulingStatus.detail,
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
    exceededCapacitySectionsCount +
    overQuotaEntriesCount +
    limitConflicts.filter(c => c.severity === 'error').length +
    (religionSchedulingStatus.ok ? 0 : 1);

  const hasUnassigned = unassignedClasses > 0 || (scope.type === 'all' && unassignedTeachersCount > 0);
  const hasWarnings = teacherLimitViolationsCount > 0 || sameDayRepeatCount > 0;

  let finalCompletionStatus: 'complete' | 'incomplete' | 'warning' = 'complete';
  let statusHeadline = 'Routine Verified — All 8 Checks Passed';
  let statusSubtext = `0 Unassigned · 0 Teacher/Room Conflicts · Section Quotas & Combined Room ${hinduRoom} Verified`;

  if (criticalErrorsCount > 0 || hasUnassigned) {
    finalCompletionStatus = 'incomplete';
    statusHeadline = 'Action Required — Validation Failed';
    const reasons: string[] = [];
    if (unassignedClasses > 0) reasons.push(`${unassignedClasses} Unassigned Periods`);
    if (wrongTeacherConflicts.length > 0) reasons.push(`${wrongTeacherConflicts.length} Wrong Section Teachers`);
    if (roomConflicts.length > 0) reasons.push(`${roomConflicts.length} Room Conflicts`);
    if (availConflictCount > 0) reasons.push(`${availConflictCount} Teacher Conflicts`);
    if (classDoubleBookings.length > 0) reasons.push(`${classDoubleBookings.length} Section Overlaps`);
    if (!religionSchedulingStatus.ok) reasons.push('Combined Religion Rule Issue');
    if (exceededCapacitySectionsCount > 0) reasons.push(`${exceededCapacitySectionsCount} Over-Subscribed Sections`);
    statusSubtext = reasons.join(' · ') || 'Review validation details below.';
  } else if (hasWarnings) {
    finalCompletionStatus = 'warning';
    statusHeadline = 'Routine Complete With Teacher Limit Notices';
    statusSubtext = `0 Unassigned Periods · 0 Critical Conflicts · ${teacherLimitViolationsCount} Daily/Weekly Limit Notices`;
  }

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
    unselectedSubjectEntriesCount,
    sameDayRepeatCount,
    checks,
    conflicts: scopedConflicts,
  };
}
