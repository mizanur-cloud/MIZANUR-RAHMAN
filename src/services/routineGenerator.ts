import { DayOfWeek, PeriodTiming, SchoolClass, SchoolSettings, Subject, Teacher, TimetableEntry } from '../types';
import { isSlotDismissed } from './scheduleTiers';
import {
  AGRICULTURE_ROOM,
  areParallelSubjects,
  getCombinedHinduRoom,
  getCombinedHinduTeacherId,
  getEffectiveSectionRequirements,
  getEffectiveSubjectFixedPeriods,
  getExpectedSectionTeacherId,
  getMaxReligionConcurrentSections,
  isAgricultureSubject,
  isAgricultureTeacher,
  isClassNineOrTen,
  isHigherMathSubject,
  isHinduReligionRoom,
  isHinduReligionSubject,
  isHinduReligionTeacher,
  isIslamReligionSubject,
  isPlayOrNursery,
  isReligionSubject,
  isSubjectSelectedForSection,
  isTeacherBlockTeacher,
  isTeacherBlockedAtSlot,
} from './parallelSubjects';
import { RoutineVerificationReport, verifyRoutine } from './routineVerifier';
import {
  DEFAULT_DAILY_MAX_PERIODS,
  getTeacherDailyMax,
  getTeacherMaxWorkingDays,
  MAX_UNAVOIDABLE_THREE_CONSECUTIVE_DAYS,
} from './workloadService';

export interface GenerationOptions {
  scope: 'all' | 'class' | 'section';
  targetClassId?: string;
  targetSectionId?: string;
  preserveLockedEntries?: boolean;
  maxConsecutiveLimit?: number; // default 2
}

export interface GenerationResult {
  success: boolean;
  entries: TimetableEntry[];
  message: string;
  stats: {
    totalClassesScheduled: number;
    totalPeriodsAssigned: number;
    unassignedPeriods: number;
  };
  verification?: RoutineVerificationReport;
}

interface PeriodItem {
  subjectId: string;
  preferredTeacherId?: string;
  roomOverride?: string;
}

interface ParallelPairItem {
  primary: PeriodItem;
  partner?: PeriodItem; // If present, BOTH must be scheduled in the EXACT same (day, periodIndex)
}

interface CandidateMatch {
  teacher: Teacher;
  tier: 1 | 2 | 3 | 4;
  tierScore: number;
}

interface SectionContext {
  classObj: SchoolClass;
  sectionId: string;
  sectionName: string;
  room?: string;
  sectionIndex: number;
  availableSlots: { day: DayOfWeek; periodIndex: number }[];
  subjectDayCount: Map<string, number>;
  dayCount: Map<DayOfWeek, number>;
  initialOpenSlotsCount: number;
}

interface ScheduledItemTask {
  sectionCtx: SectionContext;
  pairItem: ParallelPairItem;
  hasDedicated: boolean;
  hasPrimaryDedicated: boolean;
  hasPartnerDedicated: boolean;
  hasExactSectionSpecialist: boolean;
  dedicatedCount: number;
  maxDedicatedLoad: number;
  isOverloadedPrimary: boolean;
  hasFixedPeriod: boolean;
  fixedPeriodCount: number;
  subjectPeriodsCount: number;
  subjectInstanceIndex: number;
  orderIndex: number;
}

export function generateSmartTimetable(
  classes: SchoolClass[],
  teachers: Teacher[],
  workingDays: DayOfWeek[],
  periodTimings: PeriodTiming[],
  existingEntries: TimetableEntry[],
  options: GenerationOptions,
  subjects?: Subject[],
  settings?: SchoolSettings
): GenerationResult {
  const maxConsecutive = options.maxConsecutiveLimit || 2;
  const preserveExistingInScope = Boolean(options.preserveLockedEntries);

  const hinduRoom = getCombinedHinduRoom(settings);
  const maxRelConcurrent = getMaxReligionConcurrentSections(settings);
  const combinedHinduTeacherId = getCombinedHinduTeacherId(teachers, settings, subjects);
  const pinnedReligionSlots = new Set(
    (settings?.religionSchedule?.combinedSlots || []).map(s => `${s.day}_${s.periodIndex}`)
  );

  // Strictly filter out any breaks or locked periods (e.g. Tiffin Break)
  const teachingPeriods = periodTimings
    .filter(p => !p.isBreak && !p.isLocked)
    .map(p => p.periodIndex);

  const firstBreakIndex =
    periodTimings.find(p => p.isBreak || p.isLocked)?.periodIndex ?? 4;

  const maxWeeklyCapacity = Math.max(1, workingDays.length * teachingPeriods.length);

  // Identify all Play/Nursery Block Teachers (MUST NOT be scheduled in KG - Class 10)
  const blockTeacherIdSet = new Set<string>();
  teachers.forEach(t => {
    if (isTeacherBlockTeacher(t, classes)) {
      blockTeacherIdSet.add(t.id);
    }
  });

  // Identify all Hindu Religion Teachers & Agriculture Teachers
  // for free-gap pacing & dedicated classroom rules
  const hinduTeacherIdSet = new Set<string>();
  const agricultureTeacherIdSet = new Set<string>();
  teachers.forEach(t => {
    if (blockTeacherIdSet.has(t.id)) return;
    if (isHinduReligionTeacher(t, subjects)) {
      hinduTeacherIdSet.add(t.id);
    }
    if (isAgricultureTeacher(t, subjects)) {
      agricultureTeacherIdSet.add(t.id);
    }
  });
  const specialPacedTeacherIdSet = new Set<string>([
    ...hinduTeacherIdSet,
    ...agricultureTeacherIdSet,
  ]);

  const defaultHinduSubjectId =
    subjects?.find(s => isHinduReligionSubject(s.id, subjects))?.id || 'sub-hin';
  const defaultHinduTeacherId =
    combinedHinduTeacherId ||
    teachers.find(t => !blockTeacherIdSet.has(t.id) && isHinduReligionTeacher(t, subjects))?.id;

  const defaultHmtSubjectId =
    subjects?.find(s => isHigherMathSubject(s.id, subjects))?.id || 'sub-hmt';
  const defaultHmtTeacherId =
    teachers.find(t => !blockTeacherIdSet.has(t.id) && t.subjectIds.includes(defaultHmtSubjectId))?.id;
  const defaultAgrSubjectId =
    subjects?.find(s => isAgricultureSubject(s.id, subjects))?.id || 'sub-agr';
  const defaultAgrTeacherId =
    teachers.find(t => !blockTeacherIdSet.has(t.id) && isAgricultureTeacher(t, subjects))?.id ||
    teachers.find(t => !blockTeacherIdSet.has(t.id) && t.subjectIds.includes(defaultAgrSubjectId))?.id;

  // Determine which sections are in scope
  const targetSections: {
    classObj: SchoolClass;
    sectionId: string;
    sectionName: string;
    room?: string;
    sectionIndex: number;
  }[] = [];

  classes.forEach(c => {
    if (options.scope === 'class' && c.id !== options.targetClassId) return;

    c.sections.forEach((s, sIdx) => {
      if (options.scope === 'section') {
        if (c.id === options.targetClassId && s.id === options.targetSectionId) {
          targetSections.push({
            classObj: c,
            sectionId: s.id,
            sectionName: s.name,
            room: s.roomNumber,
            sectionIndex: sIdx,
          });
        }
      } else {
        targetSections.push({
          classObj: c,
          sectionId: s.id,
          sectionName: s.name,
          room: s.roomNumber,
          sectionIndex: sIdx,
        });
      }
    });
  });

  // Preserve existing entries outside target scope (or all existing entries if preserveLockedEntries is enabled)
  const isTargetSlot = (entry: TimetableEntry) => {
    if (options.scope === 'all') return true;
    if (options.scope === 'class') return entry.classId === options.targetClassId;
    if (options.scope === 'section') {
      return entry.classId === options.targetClassId && entry.sectionId === options.targetSectionId;
    }
    return false;
  };

  const classMap = new Map<string, SchoolClass>();
  classes.forEach(c => classMap.set(c.id, c));

  const preservedEntries = (preserveExistingInScope
    ? [...existingEntries]
    : existingEntries.filter(entry => !isTargetSlot(entry))
  ).filter(entry => {
    const cls = classMap.get(entry.classId);
    if (!cls) return false;
    return isSubjectSelectedForSection(cls, entry.sectionId, entry.subjectId);
  });

  const resultEntries: TimetableEntry[] = [...preservedEntries];

  // Tracking maps to guarantee ZERO conflicts
  const teacherBookings = new Map<string, string>(); // "teacherId_day_periodIndex" -> first entryId
  const teacherSlotEntries = new Map<string, TimetableEntry[]>(); // "teacherId_day_periodIndex" -> entries in physical slot
  const sectionBookings = new Map<string, TimetableEntry[]>(); // "classId_sectionId_day_periodIndex" -> entries
  const agricultureRoomBookings = new Set<string>(); // "day_periodIndex" -> dedicated single Agriculture room
  const religionSlotSections = new Map<string, Map<string, number>>(); // "day_periodIndex" -> Map<sectionKey, count>
  const explicitRoomBookings = new Map<string, Map<string, number>>(); // "day_periodIndex_normRoom" -> Map<sectionKey, count>
  const teacherWeekLoad = new Map<string, number>(); // physical distinct (day, periodIndex) slots
  const teacherDayLoad = new Map<string, number>(); // physical distinct periods on that day
  const teacherSubjectDayLoad = new Map<string, number>(); // "teacherId_subjectId_day" -> count
  const preservedSubjectCounts = new Map<string, number>(); // "classId_sectionId_subjectId" -> count

  const normalizeRoomKey = (rawRoom: string | undefined): string => {
    const trimmed = (rawRoom || '').trim();
    if (!trimmed) return '';
    return isHinduReligionRoom(trimmed, settings) ? `hindu_${hinduRoom.toLowerCase()}` : trimmed.toLowerCase();
  };

  const trackTeacherPlacement = (e: TimetableEntry) => {
    if (e.teacherId) {
      const tKey = `${e.teacherId}_${e.day}_${e.periodIndex}`;
      const existing = teacherSlotEntries.get(tKey) || [];
      if (existing.length === 0) {
        teacherWeekLoad.set(e.teacherId, (teacherWeekLoad.get(e.teacherId) || 0) + 1);
        const tdKey = `${e.teacherId}_${e.day}`;
        teacherDayLoad.set(tdKey, (teacherDayLoad.get(tdKey) || 0) + 1);
      }
      teacherSlotEntries.set(tKey, [...existing, e]);
      teacherBookings.set(tKey, e.id);
      const tsdKey = `${e.teacherId}_${e.subjectId}_${e.day}`;
      teacherSubjectDayLoad.set(tsdKey, (teacherSubjectDayLoad.get(tsdKey) || 0) + 1);
    }

    const secKey = `${e.classId}_${e.sectionId}`;
    const dpKey = `${e.day}_${e.periodIndex}`;
    if (isAgricultureSubject(e.subjectId, subjects) || e.room === AGRICULTURE_ROOM) {
      agricultureRoomBookings.add(dpKey);
    }
    if (isReligionSubject(e.subjectId, subjects)) {
      const secMap = religionSlotSections.get(dpKey) || new Map<string, number>();
      secMap.set(secKey, (secMap.get(secKey) || 0) + 1);
      religionSlotSections.set(dpKey, secMap);
    }
    const normRoom = normalizeRoomKey(e.room);
    if (normRoom) {
      const rKey = `${dpKey}_${normRoom}`;
      const secMap = explicitRoomBookings.get(rKey) || new Map<string, number>();
      secMap.set(secKey, (secMap.get(secKey) || 0) + 1);
      explicitRoomBookings.set(rKey, secMap);
    }
  };

  const untrackTeacherPlacement = (e: TimetableEntry) => {
    if (e.teacherId) {
      const tKey = `${e.teacherId}_${e.day}_${e.periodIndex}`;
      const remaining = (teacherSlotEntries.get(tKey) || []).filter(item => item.id !== e.id);
      if (remaining.length === 0) {
        teacherSlotEntries.delete(tKey);
        teacherBookings.delete(tKey);
        teacherWeekLoad.set(e.teacherId, Math.max(0, (teacherWeekLoad.get(e.teacherId) || 1) - 1));
        const tdKey = `${e.teacherId}_${e.day}`;
        teacherDayLoad.set(tdKey, Math.max(0, (teacherDayLoad.get(tdKey) || 1) - 1));
      } else {
        teacherSlotEntries.set(tKey, remaining);
        teacherBookings.set(tKey, remaining[0].id);
      }
      const tsdKey = `${e.teacherId}_${e.subjectId}_${e.day}`;
      teacherSubjectDayLoad.set(tsdKey, Math.max(0, (teacherSubjectDayLoad.get(tsdKey) || 1) - 1));
    }

    const secKey = `${e.classId}_${e.sectionId}`;
    const dpKey = `${e.day}_${e.periodIndex}`;
    if (isAgricultureSubject(e.subjectId, subjects) || e.room === AGRICULTURE_ROOM) {
      agricultureRoomBookings.delete(dpKey);
    }
    if (isReligionSubject(e.subjectId, subjects)) {
      const secMap = religionSlotSections.get(dpKey);
      if (secMap) {
        const prev = secMap.get(secKey) || 0;
        if (prev <= 1) secMap.delete(secKey);
        else secMap.set(secKey, prev - 1);
        if (secMap.size === 0) religionSlotSections.delete(dpKey);
      }
    }
    const normRoom = normalizeRoomKey(e.room);
    if (normRoom) {
      const rKey = `${dpKey}_${normRoom}`;
      const secMap = explicitRoomBookings.get(rKey);
      if (secMap) {
        const prev = secMap.get(secKey) || 0;
        if (prev <= 1) secMap.delete(secKey);
        else secMap.set(secKey, prev - 1);
        if (secMap.size === 0) explicitRoomBookings.delete(rKey);
      }
    }
  };

  preservedEntries.forEach(e => {
    trackTeacherPlacement(e);
    const sKey = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
    const list = sectionBookings.get(sKey) || [];
    list.push(e);
    sectionBookings.set(sKey, list);

    const psKey = `${e.classId}_${e.sectionId}_${e.subjectId}`;
    preservedSubjectCounts.set(psKey, (preservedSubjectCounts.get(psKey) || 0) + 1);
  });

  const teacherMap = new Map<string, Teacher>();
  teachers.forEach(t => teacherMap.set(t.id, t));

  const BLOCK_SUBJECT_ID =
    subjects?.find(s => s.id === 'sub-block-play-nur' || s.code === 'ALL')?.id || 'sub-block-play-nur';

  let totalAssigned = 0;
  let totalUnassigned = 0;
  let idSeq = 0;
  const nextEntryId = (prefix: string, classId: string, sectionId: string, day: DayOfWeek, periodIndex: number) =>
    `${prefix}-${classId}-${sectionId}-${day}-${periodIndex}-${++idSeq}`;

  // Helper: Check if teacher exceeds consecutive period limit
  const getMaxConsecutiveRunWith = (
    teacherId: string,
    day: DayOfWeek,
    periodIndex: number,
    excludePeriodIndex?: number
  ): number => {
    const currentPeriods: number[] = [periodIndex];
    teachingPeriods.forEach(p => {
      if (p !== periodIndex && p !== excludePeriodIndex && teacherBookings.has(`${teacherId}_${day}_${p}`)) {
        currentPeriods.push(p);
      }
    });
    currentPeriods.sort((a, b) => a - b);

    let maxRun = 1;
    let run = 1;
    for (let i = 1; i < currentPeriods.length; i++) {
      if (currentPeriods[i] === currentPeriods[i - 1] + 1) {
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 1;
      }
    }
    return maxRun;
  };

  // Special free-gap pacing scorer for Hindu Religion Teachers (Tapash Kumar Roy)
  // and Agriculture Teachers (Moazzem Sir):
  // Ensures classes occur in blocks of 1-2 (at most 3) with free/gap periods between them,
  // never filling all periods of a day consecutively back-to-back.
  const getSpecialTeacherPacingPenalty = (
    teacherId: string,
    day: DayOfWeek,
    periodIndex: number
  ): number => {
    const existingOnDay = teachingPeriods.filter(
      p => p !== periodIndex && teacherBookings.has(`${teacherId}_${day}_${p}`)
    );
    const withNew = [...existingOnDay, periodIndex].sort((a, b) => a - b);
    const totalDayTeaching = teachingPeriods.length;

    let penalty = 0;

    // 1. Spread evenly across all working days
    penalty += existingOnDay.length * 650;

    // 2. Strictly avoid filling all periods or leaving <= 1 free period in a day
    if (withNew.length >= totalDayTeaching) {
      penalty += 12000;
    } else if (totalDayTeaching >= 5 && withNew.length >= totalDayTeaching - 1) {
      penalty += 5000;
    }

    // 3. Enforce blocks of 1-2 (strictly forbid 4+) with free gaps between them
    const maxRun = getMaxConsecutiveRunWith(teacherId, day, periodIndex);
    if (maxRun >= 4) {
      penalty += 150000;
    } else if (maxRun === 3) {
      penalty += 22000; // strongly prefer 2 classes -> free gap -> 2 classes over 3 straight
    } else if (maxRun === 2) {
      penalty += 60; // 2 consecutive classes followed by a free gap is clean
    }

    // 4. Balance Before-Tiffin vs After-Tiffin half-day blocks so each half retains a gap
    const beforeBreakTotal = teachingPeriods.filter(p => p < firstBreakIndex).length;
    const afterBreakTotal = teachingPeriods.filter(p => p > firstBreakIndex).length;
    const beforeCount = withNew.filter(p => p < firstBreakIndex).length;
    const afterCount = withNew.filter(p => p > firstBreakIndex).length;

    if (periodIndex < firstBreakIndex && beforeBreakTotal >= 3 && beforeCount >= beforeBreakTotal) {
      penalty += 3500; // keep at least 1 free period before tiffin whenever possible
    }
    if (periodIndex > firstBreakIndex && afterBreakTotal >= 3 && afterCount >= afterBreakTotal) {
      penalty += 3500; // keep at least 1 free period after tiffin whenever possible
    }

    return penalty;
  };

  // Helper: Check if a teacher's explicit assignedClassSections restricts this class/subject to OTHER sections only
  const isRestrictedToOtherSectionsInClass = (
    t: Teacher,
    classId: string,
    sectionId: string,
    subjectId: string
  ): boolean => {
    const classMatches = (t.assignedClassSections || []).filter(
      a => a.classId === classId && (!a.subjectId || a.subjectId === subjectId)
    );
    if (classMatches.length === 0) return false;
    const coversThisSection = classMatches.some(a => !a.sectionId || a.sectionId === sectionId);
    return !coversThisSection;
  };

  const teachersWithPreferredAssignments = new Set<string>();
  specialPacedTeacherIdSet.forEach(id => teachersWithPreferredAssignments.add(id));
  const sharedJuniorTeacherIdSet = new Set<string>();
  classes.forEach(cls => {
    if (isPlayOrNursery(cls)) return;
    cls.sections.forEach(sec => {
      getEffectiveSectionRequirements(cls, sec.id, teachers).forEach(req => {
        if (req.assignedTeacherId) {
          teachersWithPreferredAssignments.add(req.assignedTeacherId);
          if (cls.numericGrade <= 2) {
            sharedJuniorTeacherIdSet.add(req.assignedTeacherId);
          }
        }
      });
    });
  });
  teachers.forEach(t => {
    if (blockTeacherIdSet.has(t.id)) return;
    if (
      t.assignedClassSections?.some(a => {
        const cls = classes.find(c => c.id === a.classId);
        return cls && !isPlayOrNursery(cls) && cls.numericGrade <= 2;
      })
    ) {
      sharedJuniorTeacherIdSet.add(t.id);
    }
  });

  // Strict Tiered Candidate Matching for KG - Class 10
  // Tier 1 (+55000/+52000/+50000): Exact section subjectConfig override OR exact section teacher lock
  // Tier 2 (+26000/+22000): Class-wide template teacher (ONLY if section did not override or clear it)
  // Tier 3 (+5000): General pool qualified teacher
  // Tier 4 (-15000): Unassigned fallback pool
  const getCandidatesWithTiers = (
    subjectId: string,
    classId: string,
    sectionId: string,
    preferredId?: string,
    excludeTeacherId?: string
  ): CandidateMatch[] => {
    const matchesMap = new Map<string, CandidateMatch>();
    const cls = classMap.get(classId);
    const sec = cls?.sections.find(s => s.id === sectionId);
    const secCfg = sec?.subjectConfigs?.[subjectId];
    const hasExplicitSectionConfig = secCfg !== undefined && secCfg.assignedTeacherId !== undefined;
    const explicitSectionTeacherId = hasExplicitSectionConfig ? secCfg!.assignedTeacherId : undefined;

    const consider = (t: Teacher | undefined, tier: 1 | 2 | 3 | 4, tierScore: number) => {
      if (!t) return;
      if (blockTeacherIdSet.has(t.id)) return; // Block teachers CANNOT teach KG to Class 10
      if (excludeTeacherId && t.id === excludeTeacherId) return;

      const existing = matchesMap.get(t.id);
      if (!existing || tierScore > existing.tierScore) {
        matchesMap.set(t.id, { teacher: t, tier, tierScore });
      }
    };

    // Case A: Section explicitly configured a specific teacher in sec.subjectConfigs[subjectId]
    if (hasExplicitSectionConfig && explicitSectionTeacherId) {
      const explicitTeacher = teacherMap.get(explicitSectionTeacherId);
      if (explicitTeacher) {
        consider(explicitTeacher, 1, 55000);
        return Array.from(matchesMap.values());
      }
    }

    // Case B: No explicit empty clear on section -> check Teacher.assignedClassSections exact section lock
    let hasExactSectionSpecialist = false;
    if (!hasExplicitSectionConfig) {
      teachers.forEach(t => {
        const exactSubMatch = t.assignedClassSections?.some(
          a => a.classId === classId && a.sectionId === sectionId && a.subjectId === subjectId
        );
        if (exactSubMatch) {
          hasExactSectionSpecialist = true;
          consider(t, 1, 52000);
          return;
        }
        const exactSecMatch = t.assignedClassSections?.some(
          a => a.classId === classId && a.sectionId === sectionId && !a.subjectId
        );
        if (exactSecMatch && t.subjectIds.includes(subjectId)) {
          hasExactSectionSpecialist = true;
          consider(t, 1, 50000);
        }
      });
    }

    // Tier 2: Class-wide explicit preferredId & class-wide assignedClassSections (skipped if section explicitly cleared to '')
    let preferredRestrictedToOtherSection = false;
    const allowClassWideFallback = !(hasExplicitSectionConfig && explicitSectionTeacherId === '');
    if (allowClassWideFallback && preferredId && !hasExactSectionSpecialist) {
      const prefTeacher = teacherMap.get(preferredId);
      if (prefTeacher && !isRestrictedToOtherSectionsInClass(prefTeacher, classId, sectionId, subjectId)) {
        consider(prefTeacher, 2, 26000);
      } else if (prefTeacher && isRestrictedToOtherSectionsInClass(prefTeacher, classId, sectionId, subjectId)) {
        preferredRestrictedToOtherSection = true;
      }
    }

    if (allowClassWideFallback) {
      teachers.forEach(t => {
        const classWideSub = t.assignedClassSections?.some(
          a => a.classId === classId && !a.sectionId && a.subjectId === subjectId
        );
        if (classWideSub) {
          consider(t, 2, 23000);
          return;
        }
        const classWideAny = t.assignedClassSections?.some(
          a => a.classId === classId && !a.sectionId && !a.subjectId
        );
        if (classWideAny && t.subjectIds.includes(subjectId)) {
          consider(t, 2, 22000);
        }
      });
    }

    // Tier 3 & Tier 4: General qualified teachers
    const effectivePreferred = allowClassWideFallback && !preferredRestrictedToOtherSection ? preferredId : undefined;
    teachers.forEach(t => {
      if (matchesMap.has(t.id)) return;
      if (!t.subjectIds.includes(subjectId)) return;

      const hasExplicitClassLocks = Boolean(t.assignedClassSections && t.assignedClassSections.length > 0);
      if (hasExplicitClassLocks) return;

      if (!teachersWithPreferredAssignments.has(t.id)) {
        consider(t, 3, 5000);
      } else if (!effectivePreferred && !hasExactSectionSpecialist) {
        consider(t, 4, -15000);
      }
    });

    return Array.from(matchesMap.values()).sort((a, b) => b.tierScore - a.tierScore);
  };

  // ===========================================================================
  // PASS 1: PLAY & NURSERY (2 Shifts; 2 Isolated Block Teachers)
  // ===========================================================================
  const kg10Tasks: ScheduledItemTask[] = [];
  const dedicatedLoadEstimate = new Map<string, number>();
  const sectionContextMap = new Map<string, SectionContext>();
  const sectionSubjectTarget = new Map<string, number>(); // "classId_sectionId_subjectId" -> targetPeriodsPerWeek

  const getAllowedPeriodsForPair = (
    cls: SchoolClass,
    secId: string,
    item: ParallelPairItem
  ): number[] | undefined => {
    const p1 = getEffectiveSubjectFixedPeriods(cls, secId, item.primary.subjectId, subjects);
    const p2 = item.partner
      ? getEffectiveSubjectFixedPeriods(cls, secId, item.partner.subjectId, subjects)
      : undefined;
    if (p1 && p2) return p1.filter(idx => p2.includes(idx));
    return p1 || p2;
  };

  const isPeriodAllowedForSubject = (
    classId: string,
    sectionId: string,
    subjectId: string,
    periodIndex: number
  ): boolean => {
    const cls = classMap.get(classId);
    const allowed = getEffectiveSubjectFixedPeriods(cls, sectionId, subjectId, subjects);
    if (!allowed) return true;
    return allowed.includes(periodIndex);
  };

  const isPeriodAllowedForPair = (
    sectionCtx: SectionContext,
    item: ParallelPairItem,
    periodIndex: number
  ): boolean => {
    const allowed = getAllowedPeriodsForPair(sectionCtx.classObj, sectionCtx.sectionId, item);
    if (!allowed) return true;
    return allowed.includes(periodIndex);
  };

  // Track which periods inside each section are claimed by fixed-period subjects
  // so flexible subjects avoid taking them unnecessarily
  const sectionReservedFixedPeriods = new Map<string, Set<number>>();

  for (const { classObj, sectionId, sectionName, room, sectionIndex } of targetSections) {
    const availableSlots: { day: DayOfWeek; periodIndex: number }[] = [];
    workingDays.forEach(day => {
      teachingPeriods.forEach(periodIndex => {
        if (isSlotDismissed(classObj, day, periodIndex, sectionId, workingDays)) return;
        const slotKey = `${classObj.id}_${sectionId}_${day}_${periodIndex}`;
        const existingInSlot = sectionBookings.get(slotKey) || [];
        if (existingInSlot.length === 0) {
          availableSlots.push({ day, periodIndex });
        }
      });
    });

    if (isPlayOrNursery(classObj)) {
      let blockTeachers = (classObj.blockTeacherIds || [])
        .map(id => teacherMap.get(id))
        .filter((t): t is Teacher => Boolean(t));

      if (blockTeachers.length === 0) {
        blockTeachers = teachers.filter(t =>
          (t.assignedClassSections || []).some(a => a.classId === classObj.id)
        );
      }

      if (blockTeachers.length === 0) {
        totalUnassigned += availableSlots.length;
        continue;
      }

      for (const slot of availableSlots) {
        const orderedTeachers = [...blockTeachers];
        if (orderedTeachers.length > 1 && (sectionIndex + slot.periodIndex) % 2 === 1) {
          orderedTeachers.reverse();
        }

        const chosenTeacher = orderedTeachers.find(t => {
          if (teacherBookings.has(`${t.id}_${slot.day}_${slot.periodIndex}`)) return false;
          if (isTeacherBlockedAtSlot(t, slot.day, slot.periodIndex)) return false;
          return true;
        });

        if (chosenTeacher) {
          const entryId = nextEntryId('gen-blk', classObj.id, sectionId, slot.day, slot.periodIndex);
          const newEntry: TimetableEntry = {
            id: entryId,
            classId: classObj.id,
            sectionId,
            day: slot.day,
            periodIndex: slot.periodIndex,
            subjectId: BLOCK_SUBJECT_ID,
            teacherId: chosenTeacher.id,
            room,
          };

          resultEntries.push(newEntry);
          trackTeacherPlacement(newEntry);
          const sKey = `${classObj.id}_${sectionId}_${slot.day}_${slot.periodIndex}`;
          sectionBookings.set(sKey, [newEntry]);
          totalAssigned++;
        } else {
          totalUnassigned++;
        }
      }
      continue;
    }

    // Prepare KG - Class 10 Section Context & Item Pool
    const subjectDayCount = new Map<string, number>();
    const dayCount = new Map<DayOfWeek, number>();
    resultEntries
      .filter(e => e.classId === classObj.id && e.sectionId === sectionId)
      .forEach(e => {
        const k = `${e.subjectId}_${e.day}`;
        subjectDayCount.set(k, (subjectDayCount.get(k) || 0) + 1);
        dayCount.set(e.day, (dayCount.get(e.day) || 0) + 1);
      });

    const sectionCtx: SectionContext = {
      classObj,
      sectionId,
      sectionName,
      room,
      sectionIndex,
      availableSlots,
      subjectDayCount,
      dayCount,
      initialOpenSlotsCount: availableSlots.length,
    };
    sectionContextMap.set(`${classObj.id}_${sectionId}`, sectionCtx);

    const getRemainingPeriods = (subjectId: string, targetPeriods: number): number => {
      if (!preserveExistingInScope) return targetPeriods;
      const already = preservedSubjectCounts.get(`${classObj.id}_${sectionId}_${subjectId}`) || 0;
      return Math.max(0, targetPeriods - already);
    };

    const reqs = [...getEffectiveSectionRequirements(classObj, sectionId, teachers)];
    const setSectionSubTarget = (subjectId: string, count: number) => {
      const k = `${classObj.id}_${sectionId}_${subjectId}`;
      sectionSubjectTarget.set(k, Math.max(sectionSubjectTarget.get(k) || 0, count));
    };
    reqs.forEach(r => setSectionSubTarget(r.subjectId, r.periodsPerWeek));

    const isNineOrTen = isClassNineOrTen(classObj);
    const hmtReq = isNineOrTen ? reqs.find(r => isHigherMathSubject(r.subjectId, subjects)) : undefined;
    const agrReq = isNineOrTen ? reqs.find(r => isAgricultureSubject(r.subjectId, subjects)) : undefined;

    // Detect Islam & Hindu Religion requirements active in this section
    const relReqs = reqs.filter(r => isIslamReligionSubject(r.subjectId, subjects));
    const hinReqs = reqs.filter(r => isHinduReligionSubject(r.subjectId, subjects));

    const handledSubIds = new Set<string>();
    const itemsToSchedule: ParallelPairItem[] = [];

    // 1. Mandatory Parallel Pairing for Class 9 & 10:
    //    When BOTH Higher Math and Agriculture are selected in this section,
    //    they MUST run simultaneously in the exact same period (with Agriculture in its single room).
    //    If only ONE is selected for this section, never inject the unselected subject.
    if (isNineOrTen && hmtReq && agrReq) {
      handledSubIds.add(hmtReq.subjectId);
      handledSubIds.add(agrReq.subjectId);

      const hmtSubId = hmtReq.subjectId;
      const agrSubId = agrReq.subjectId;
      const hmtPrefTeacher = hmtReq.assignedTeacherId || defaultHmtTeacherId;
      const agrPrefTeacher = agrReq.assignedTeacherId || defaultAgrTeacherId;

      const hmtRem = getRemainingPeriods(hmtReq.subjectId, hmtReq.periodsPerWeek);
      const agrRem = getRemainingPeriods(agrReq.subjectId, agrReq.periodsPerWeek);
      const pairCount = Math.max(hmtRem, agrRem);
      const maxPairTarget = Math.max(hmtReq.periodsPerWeek, agrReq.periodsPerWeek);
      setSectionSubTarget(hmtSubId, maxPairTarget);
      setSectionSubTarget(agrSubId, maxPairTarget);

      for (let i = 0; i < pairCount; i++) {
        itemsToSchedule.push({
          primary: { subjectId: hmtSubId, preferredTeacherId: hmtPrefTeacher },
          partner: {
            subjectId: agrSubId,
            preferredTeacherId: agrPrefTeacher,
            roomOverride: AGRICULTURE_ROOM,
          },
        });
      }
    }

    // 2. Smart Parallel Pairing for Islam & Hindu Religion in the same section:
    //    Hindu Religion uses configured combined Hindu room (Room '307') and combinedHinduTeacherId by default
    //    unless the section explicitly configured its own teacher override in subjectConfigs.
    const resolveSectionHinduPref = (hinReq: typeof hinReqs[0]): string | undefined => {
      const secObj = classObj.sections.find(s => s.id === sectionId);
      const explicitSecCfg = secObj?.subjectConfigs?.[hinReq.subjectId]?.assignedTeacherId;
      if (explicitSecCfg !== undefined) return explicitSecCfg || undefined;
      return defaultHinduTeacherId || hinReq.assignedTeacherId;
    };

    if (relReqs.length > 0 && hinReqs.length > 0) {
      relReqs.forEach((relReq, idx) => {
        handledSubIds.add(relReq.subjectId);
        const matchedHinReq = hinReqs[idx] || hinReqs[0];
        handledSubIds.add(matchedHinReq.subjectId);

        const hinSubId = matchedHinReq.subjectId;
        const hinPrefTeacherId = resolveSectionHinduPref(matchedHinReq);

        const relRem = getRemainingPeriods(relReq.subjectId, relReq.periodsPerWeek);
        const hinRem = getRemainingPeriods(matchedHinReq.subjectId, matchedHinReq.periodsPerWeek);

        const pairCount = Math.min(relRem, hinRem);
        for (let i = 0; i < pairCount; i++) {
          itemsToSchedule.push({
            primary: { subjectId: relReq.subjectId, preferredTeacherId: relReq.assignedTeacherId },
            partner: {
              subjectId: hinSubId,
              preferredTeacherId: hinPrefTeacherId,
              roomOverride: hinduRoom,
            },
          });
        }

        // Any remainder if Islam & Hindu have different selected weekly periods in this section
        for (let i = pairCount; i < relRem; i++) {
          itemsToSchedule.push({
            primary: { subjectId: relReq.subjectId, preferredTeacherId: relReq.assignedTeacherId },
          });
        }
        for (let i = pairCount; i < hinRem; i++) {
          itemsToSchedule.push({
            primary: {
              subjectId: hinSubId,
              preferredTeacherId: hinPrefTeacherId,
              roomOverride: hinduRoom,
            },
          });
        }
      });
    } else if (hinReqs.length > 0) {
      // Only Hindu selected in this section
      hinReqs.forEach(hinReq => {
        handledSubIds.add(hinReq.subjectId);
        const hinRem = getRemainingPeriods(hinReq.subjectId, hinReq.periodsPerWeek);
        const hinPrefTeacherId = resolveSectionHinduPref(hinReq);
        for (let i = 0; i < hinRem; i++) {
          itemsToSchedule.push({
            primary: {
              subjectId: hinReq.subjectId,
              preferredTeacherId: hinPrefTeacherId,
              roomOverride: hinduRoom,
            },
          });
        }
      });
    }

    // 3. All remaining selected subjects (including solo Islam or solo Higher Math/Agriculture if partner unselected)
    reqs.forEach(req => {
      if (handledSubIds.has(req.subjectId)) return;
      const rem = getRemainingPeriods(req.subjectId, req.periodsPerWeek);
      const isHin = isHinduReligionSubject(req.subjectId, subjects);
      const isAgr = isAgricultureSubject(req.subjectId, subjects);
      for (let i = 0; i < rem; i++) {
        itemsToSchedule.push({
          primary: {
            subjectId: req.subjectId,
            preferredTeacherId: req.assignedTeacherId,
            roomOverride: isHin ? hinduRoom : isAgr ? AGRICULTURE_ROOM : undefined,
          },
        });
      }
    });

    const subTotalCounts = new Map<string, number>();
    itemsToSchedule.forEach(item => {
      subTotalCounts.set(item.primary.subjectId, (subTotalCounts.get(item.primary.subjectId) || 0) + 1);
    });

    const subSeenCounts = new Map<string, number>();
    itemsToSchedule.forEach((pairItem, idx) => {
      const subInstIdx = subSeenCounts.get(pairItem.primary.subjectId) || 0;
      subSeenCounts.set(pairItem.primary.subjectId, subInstIdx + 1);

      const pCandidates = getCandidatesWithTiers(
        pairItem.primary.subjectId,
        classObj.id,
        sectionId,
        pairItem.primary.preferredTeacherId
      );
      const dedicatedCandidates = pCandidates.filter(c => c.tier <= 2);
      const partnerDedicatedCandidates = pairItem.partner
        ? getCandidatesWithTiers(
            pairItem.partner.subjectId,
            classObj.id,
            sectionId,
            pairItem.partner.preferredTeacherId
          ).filter(c => c.tier <= 2)
        : [];
      const hasExactSectionSpecialist = pCandidates.some(c => c.tier === 1);

      dedicatedCandidates.forEach(dc => {
        dedicatedLoadEstimate.set(dc.teacher.id, (dedicatedLoadEstimate.get(dc.teacher.id) || 0) + 1);
      });
      if (pairItem.partner) {
        partnerDedicatedCandidates.forEach(dc => {
          dedicatedLoadEstimate.set(dc.teacher.id, (dedicatedLoadEstimate.get(dc.teacher.id) || 0) + 1);
        });
      }

      const hasPrimaryDedicated = dedicatedCandidates.length > 0;
      const hasPartnerDedicated = partnerDedicatedCandidates.length > 0;
      const allowedPeriods = getAllowedPeriodsForPair(classObj, sectionId, pairItem);
      const hasFixedPeriod = allowedPeriods !== undefined;
      const fixedPeriodCount = allowedPeriods ? allowedPeriods.length : teachingPeriods.length;

      if (allowedPeriods && allowedPeriods.length > 0) {
        const secKey = `${classObj.id}_${sectionId}`;
        const rSet = sectionReservedFixedPeriods.get(secKey) || new Set<number>();
        allowedPeriods.forEach(p => rSet.add(p));
        sectionReservedFixedPeriods.set(secKey, rSet);
      }

      kg10Tasks.push({
        sectionCtx,
        pairItem,
        hasDedicated: hasPrimaryDedicated || hasPartnerDedicated,
        hasPrimaryDedicated,
        hasPartnerDedicated,
        hasExactSectionSpecialist,
        dedicatedCount: dedicatedCandidates.length,
        maxDedicatedLoad: 0,
        isOverloadedPrimary: false,
        hasFixedPeriod,
        fixedPeriodCount,
        subjectPeriodsCount: subTotalCounts.get(pairItem.primary.subjectId) || 0,
        subjectInstanceIndex: subInstIdx,
        orderIndex: idx,
      });
    });
  }

  // Enrich tasks with total dedicated teacher load & detect overloaded catch-all teachers (> maxWeeklyCapacity)
  kg10Tasks.forEach(task => {
    const pCandidates = getCandidatesWithTiers(
      task.pairItem.primary.subjectId,
      task.sectionCtx.classObj.id,
      task.sectionCtx.sectionId,
      task.pairItem.primary.preferredTeacherId
    ).filter(c => c.tier <= 2);

    let maxLoad = 0;
    let allDedicatedOverloaded = pCandidates.length > 0;
    pCandidates.forEach(c => {
      const l = dedicatedLoadEstimate.get(c.teacher.id) || 0;
      if (l > maxLoad) maxLoad = l;
      if (l <= maxWeeklyCapacity) {
        allDedicatedOverloaded = false;
      }
    });
    task.maxDedicatedLoad = maxLoad;
    task.isOverloadedPrimary = allDedicatedOverloaded;
  });

  // Sort KG-10 tasks globally by constraint tightness:
  // 1. Dedicated teacher items BEFORE open items
  // 2. Non-overloaded realistic teachers (<= maxWeeklyCapacity) STRICTLY BEFORE overloaded catch-all teachers!
  //    (Ensures teachers like Md. Mizanur Rahman with 9 classes NEVER get starved out of a section!)
  // 3. Exact section specialists (Tier 1) BEFORE class-wide assignments
  // 4. Parallel pairs BEFORE single subjects
  // 5. Morning-only junior sections (KG - Class 2, fewer open slots) BEFORE Class 3-10
  // 6. For overloaded teachers (>30/wk), round-robin subjectInstanceIndex BEFORE grade/section so no class/day is starved to 0!
  kg10Tasks.sort((a, b) => {
    // Subjects with Fixed/Restricted periods MUST claim their slots before flexible subjects fill them
    if (a.hasFixedPeriod !== b.hasFixedPeriod) return a.hasFixedPeriod ? -1 : 1;
    if (a.hasFixedPeriod && b.hasFixedPeriod && a.fixedPeriodCount !== b.fixedPeriodCount) {
      return a.fixedPeriodCount - b.fixedPeriodCount;
    }
    if (a.hasDedicated !== b.hasDedicated) return a.hasDedicated ? -1 : 1;
    if (a.hasDedicated && b.hasDedicated && a.isOverloadedPrimary !== b.isOverloadedPrimary) {
      return a.isOverloadedPrimary ? 1 : -1;
    }

    // Morning-restricted sections (KG - Class 2, only P1-P3 slots) MUST reserve shared teachers before Class 3-10
    const aMorningOnly = a.sectionCtx.initialOpenSlotsCount <= workingDays.length * 3;
    const bMorningOnly = b.sectionCtx.initialOpenSlotsCount <= workingDays.length * 3;
    if (aMorningOnly !== bMorningOnly) return aMorningOnly ? -1 : 1;

    if (a.hasExactSectionSpecialist !== b.hasExactSectionSpecialist) {
      return a.hasExactSectionSpecialist ? -1 : 1;
    }
    const aPar = a.pairItem.partner ? 1 : 0;
    const bPar = b.pairItem.partner ? 1 : 0;
    if (aPar !== bPar) return bPar - aPar;

    // For overloaded teachers, interleave 1st period of every section before 2nd period so no section/day is starved
    if (a.isOverloadedPrimary && b.isOverloadedPrimary) {
      if (a.subjectInstanceIndex !== b.subjectInstanceIndex) {
        return a.subjectInstanceIndex - b.subjectInstanceIndex;
      }
    }

    // Sections with fewer open periods run before larger ones
    if (a.sectionCtx.initialOpenSlotsCount !== b.sectionCtx.initialOpenSlotsCount) {
      return a.sectionCtx.initialOpenSlotsCount - b.sectionCtx.initialOpenSlotsCount;
    }
    if (a.hasDedicated && b.hasDedicated && a.dedicatedCount !== b.dedicatedCount) {
      return a.dedicatedCount - b.dedicatedCount;
    }
    if (a.maxDedicatedLoad !== b.maxDedicatedLoad) return b.maxDedicatedLoad - a.maxDedicatedLoad;
    if (a.subjectPeriodsCount !== b.subjectPeriodsCount) return b.subjectPeriodsCount - a.subjectPeriodsCount;
    if (a.sectionCtx.classObj.numericGrade !== b.sectionCtx.classObj.numericGrade) {
      return a.sectionCtx.classObj.numericGrade - b.sectionCtx.classObj.numericGrade;
    }
    if (a.sectionCtx.sectionIndex !== b.sectionCtx.sectionIndex) {
      return a.sectionCtx.sectionIndex - b.sectionCtx.sectionIndex;
    }
    return a.orderIndex - b.orderIndex;
  });

  // Compute each non-block teacher's max weekly single-section subject frequency & rotating preferred off-day
  const dedicatedMaxSubFreq = new Map<string, number>();
  classes.forEach(cls => {
    if (isPlayOrNursery(cls)) return;
    cls.sections.forEach(sec => {
      getEffectiveSectionRequirements(cls, sec.id, teachers).forEach(req => {
        const cands = getCandidatesWithTiers(req.subjectId, cls.id, sec.id, req.assignedTeacherId).filter(
          c => c.tier <= 2
        );
        cands.forEach(c => {
          const cur = dedicatedMaxSubFreq.get(c.teacher.id) || 0;
          if (req.periodsPerWeek > cur) dedicatedMaxSubFreq.set(c.teacher.id, req.periodsPerWeek);
        });
      });
    });
  });

  const teacherPreferredOffDay = new Map<string, DayOfWeek>();
  if (workingDays.length > 1) {
    let offDayCursor = 0;
    teachers.forEach(t => {
      if (blockTeacherIdSet.has(t.id)) return;
      const maxWorkDays = getTeacherMaxWorkingDays(t, settings);
      if (maxWorkDays >= workingDays.length) return;
      const estLoad = dedicatedLoadEstimate.get(t.id) || 0;
      const maxDaily = getTeacherDailyMax(t, settings);
      const maxSubFreq = dedicatedMaxSubFreq.get(t.id) || 0;
      if (estLoad <= maxWorkDays * maxDaily && maxSubFreq <= maxWorkDays) {
        // Prefer an existing blocked/unavailable day if the teacher has unavailability configured
        const unavailDay = workingDays.find(d =>
          (t.unavailableSlots || []).some(u => u.day === d)
        );
        const chosenOffDay = unavailDay || workingDays[offDayCursor % workingDays.length];
        offDayCursor++;
        teacherPreferredOffDay.set(t.id, chosenOffDay);
      }
    });
  }

  // Helper: Check if a teacher is busy at (day, periodIndex), allowing ONLY Combined Hindu Room 307 <= maxRelConcurrent
  const isTeacherSlotBusyFor = (
    teacherId: string | undefined,
    subjectId: string,
    day: DayOfWeek,
    periodIndex: number,
    explicitRoom?: string
  ): boolean => {
    if (!teacherId) return false;
    const tKey = `${teacherId}_${day}_${periodIndex}`;
    const existing = teacherSlotEntries.get(tKey);
    if (!existing || existing.length === 0) return false;

    const incomingIsCombinedHindu =
      isHinduReligionSubject(subjectId, subjects) &&
      isHinduReligionRoom(explicitRoom || hinduRoom, settings);
    if (!incomingIsCombinedHindu) return true;

    const allExistingAreHindu = existing.every(
      e => isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)
    );
    if (!allExistingAreHindu) return true;

    const relSections = religionSlotSections.get(`${day}_${periodIndex}`);
    if ((relSections?.size || 0) >= maxRelConcurrent) return true;

    return false;
  };

  // Helper: Check Religion concurrency limit (maxRelConcurrent = 3 sections/period), dedicated Agriculture room,
  // and explicit room collisions
  const isSubjectDedicatedRoomConflict = (
    subjectId: string,
    day: DayOfWeek,
    periodIndex: number,
    explicitRoom?: string,
    classId?: string,
    sectionId?: string
  ): boolean => {
    const dpKey = `${day}_${periodIndex}`;
    const secKey = classId && sectionId ? `${classId}_${sectionId}` : undefined;

    if (isAgricultureSubject(subjectId, subjects) || explicitRoom === AGRICULTURE_ROOM) {
      if (agricultureRoomBookings.has(dpKey)) return true;
    }

    if (isReligionSubject(subjectId, subjects)) {
      const relSections = religionSlotSections.get(dpKey);
      if (relSections) {
        const alreadyInWave = Boolean(secKey && relSections.has(secKey));
        if (!alreadyInWave && relSections.size >= maxRelConcurrent) return true;
      }
    }

    const effectiveRoom =
      explicitRoom ||
      (isHinduReligionSubject(subjectId, subjects)
        ? hinduRoom
        : isAgricultureSubject(subjectId, subjects)
        ? AGRICULTURE_ROOM
        : undefined);
    const normRoom = normalizeRoomKey(effectiveRoom);
    if (normRoom) {
      const roomMap = explicitRoomBookings.get(`${dpKey}_${normRoom}`);
      if (roomMap && roomMap.size > 0) {
        const isHinduCombined =
          isHinduReligionSubject(subjectId, subjects) &&
          isHinduReligionRoom(effectiveRoom, settings);
        if (isHinduCombined) {
          const alreadyIn = Boolean(secKey && roomMap.has(secKey));
          if (!alreadyIn && roomMap.size >= maxRelConcurrent) return true;
        } else {
          const onlySameSection = Boolean(secKey && roomMap.size === 1 && roomMap.has(secKey));
          if (!onlySameSection) return true;
        }
      }
    }

    return false;
  };

  const isDedicatedRoomConflict = (
    item: ParallelPairItem,
    day: DayOfWeek,
    periodIndex: number,
    classId?: string,
    sectionId?: string,
    sectionRoom?: string
  ): boolean => {
    if (
      isSubjectDedicatedRoomConflict(
        item.primary.subjectId,
        day,
        periodIndex,
        item.primary.roomOverride || sectionRoom,
        classId,
        sectionId
      )
    ) {
      return true;
    }
    if (
      item.partner &&
      isSubjectDedicatedRoomConflict(
        item.partner.subjectId,
        day,
        periodIndex,
        item.partner.roomOverride || sectionRoom,
        classId,
        sectionId
      )
    ) {
      return true;
    }
    return false;
  };

  const addDedicatedRoomBooking = (subjectId: string, day: DayOfWeek, periodIndex: number, explicitRoom?: string) => {
    const slotKey = `${day}_${periodIndex}`;
    if (isAgricultureSubject(subjectId, subjects) || explicitRoom === AGRICULTURE_ROOM) {
      agricultureRoomBookings.add(slotKey);
    }
  };

  const moveDedicatedRoomBooking = (
    subjectId: string,
    oldDay: DayOfWeek,
    oldPeriod: number,
    newDay: DayOfWeek,
    newPeriod: number,
    explicitRoom?: string
  ) => {
    const oldKey = `${oldDay}_${oldPeriod}`;
    const newKey = `${newDay}_${newPeriod}`;
    if (isAgricultureSubject(subjectId, subjects) || explicitRoom === AGRICULTURE_ROOM) {
      agricultureRoomBookings.delete(oldKey);
      agricultureRoomBookings.add(newKey);
    }
  };

  // Helper: Resolve entry room cleanly
  const resolveRoom = (item: PeriodItem, fallbackRoom?: string): string | undefined => {
    if (item.roomOverride) return item.roomOverride;
    if (isHinduReligionSubject(item.subjectId, subjects)) return hinduRoom;
    if (isAgricultureSubject(item.subjectId, subjects)) return AGRICULTURE_ROOM;
    return fallbackRoom;
  };

  // Helper: Count active working days already scheduled for a teacher
  const getTeacherActiveDaysCount = (teacherId: string): number => {
    let count = 0;
    for (const d of workingDays) {
      if ((teacherDayLoad.get(`${teacherId}_${d}`) || 0) > 0) count++;
    }
    return count;
  };

  // Helper: Compute ideal daily load target for balanced weekday workload distribution
  // Distributes load across <= maxWorkingDays (4) whenever mathematically feasible
  const getIdealDailyForTeacher = (teacher: Teacher): number => {
    const expected = dedicatedLoadEstimate.get(teacher.id) || 0;
    const maxDaily = getTeacherDailyMax(teacher, settings);
    const maxWorkDays = blockTeacherIdSet.has(teacher.id)
      ? workingDays.length
      : getTeacherMaxWorkingDays(teacher, settings);
    const targetDays =
      expected > maxWorkDays * maxDaily
        ? Math.min(workingDays.length, Math.max(maxWorkDays, Math.ceil(expected / Math.max(1, maxDaily))))
        : Math.max(1, Math.min(workingDays.length, maxWorkDays));
    const ideal = Math.ceil(expected / targetDays);
    return Math.max(1, Math.min(maxDaily, ideal || 2));
  };

  // Helper: Score candidate workload & pacing (shared for primary and partner)
  const scoreTeacherSlotBalance = (
    t: Teacher,
    subjectId: string,
    day: DayOfWeek,
    periodIndex: number
  ): number => {
    const tWeek = teacherWeekLoad.get(t.id) || 0;
    const tDay = teacherDayLoad.get(`${t.id}_${day}`) || 0;
    const maxDaily = getTeacherDailyMax(t, settings);
    const maxWorkDays = getTeacherMaxWorkingDays(t, settings);
    const expected = dedicatedLoadEstimate.get(t.id) || tWeek;
    const idealDaily = getIdealDailyForTeacher(t);
    const sameSubOnDay = teacherSubjectDayLoad.get(`${t.id}_${subjectId}_${day}`) || 0;

    let penalty = 0;

    // Weekly working days compaction (<= 4 days/week whenever feasible)
    if (!blockTeacherIdSet.has(t.id) && tDay === 0) {
      const activeDays = getTeacherActiveDaysCount(t.id);
      if (activeDays >= maxWorkDays) {
        penalty += expected <= maxWorkDays * maxDaily ? 180000 : 12000;
      }
    }

    if (specialPacedTeacherIdSet.has(t.id)) {
      penalty += getSpecialTeacherPacingPenalty(t.id, day, periodIndex);
      if (tDay >= maxDaily) {
        penalty += 80000 + (tDay - maxDaily) * 5000;
      }
    } else {
      const consecRun = getMaxConsecutiveRunWith(t.id, day, periodIndex);
      if (consecRun >= 4) {
        penalty += 180000; // 4+ consecutive periods strictly forbidden
      } else if (consecRun === 3) {
        penalty += expected <= 19 ? 48000 : 22000; // strongly avoid 3-consecutive streaks when total load permits
      } else if (consecRun > (t.maxConsecutivePeriods || maxConsecutive)) {
        penalty += 2500;
      }
      if (tDay >= maxDaily) {
        penalty += 80000 + (tDay - maxDaily) * 5000;
      } else if (tDay >= idealDaily) {
        penalty += 450 * (tDay - idealDaily + 1);
      }
      penalty += tDay * 220;
    }

    // Spread same subject across different days for this teacher so they don't teach identical sessions all in one day
    if (sameSubOnDay > 0) {
      penalty += sameSubOnDay * 220;
    }
    penalty += tWeek * 18;
    return -penalty;
  };

  // Helper: Score partner candidate deterministically (including workload balancing & Tapash/Moazzem pacing)
  const scorePartnerCandidate = (
    c2: CandidateMatch,
    subjectId: string,
    day: DayOfWeek,
    periodIndex: number
  ): number => {
    return c2.tierScore + scoreTeacherSlotBalance(c2.teacher, subjectId, day, periodIndex);
  };

  // Helper: Strict per-day subject cap (KG - Class 10: same subject NEVER appears >1x on same day when weekly <= days)
  const wouldViolateSubjectDailyLimit = (
    sectionCtx: SectionContext,
    subjectId: string,
    targetDay: DayOfWeek,
    excludeSourceDay?: DayOfWeek
  ): boolean => {
    if (isPlayOrNursery(sectionCtx.classObj)) return false;
    if (excludeSourceDay && excludeSourceDay === targetDay) return false;

    const targetPeriods =
      sectionSubjectTarget.get(`${sectionCtx.classObj.id}_${sectionCtx.sectionId}_${subjectId}`) ??
      workingDays.length;
    const maxPerDay =
      targetPeriods <= workingDays.length
        ? 1
        : Math.ceil(targetPeriods / Math.max(1, workingDays.length));
    let currentCount = 0;
    for (const p of teachingPeriods) {
      const slotList = sectionBookings.get(
        `${sectionCtx.classObj.id}_${sectionCtx.sectionId}_${targetDay}_${p}`
      );
      if (slotList && slotList.some(e => e.subjectId === subjectId)) {
        currentCount++;
      }
    }
    return currentCount >= maxPerDay;
  };

  const wouldViolatePairDailyLimit = (
    sectionCtx: SectionContext,
    pairItem: ParallelPairItem,
    targetDay: DayOfWeek
  ): boolean => {
    if (wouldViolateSubjectDailyLimit(sectionCtx, pairItem.primary.subjectId, targetDay)) {
      return true;
    }
    if (
      pairItem.partner &&
      wouldViolateSubjectDailyLimit(sectionCtx, pairItem.partner.subjectId, targetDay)
    ) {
      return true;
    }
    return false;
  };

  // Helper: Check if a teacher can accept a slot without violating unavailability, bookings, or hard daily caps
  const canTeacherMoveToSlot = (
    teacherId: string | undefined,
    destDay: DayOfWeek,
    destPeriod: number,
    sourceDay?: DayOfWeek,
    enforceDailyLimit: boolean = true,
    subjectId: string = '',
    room?: string,
    sourcePeriod?: number
  ): boolean => {
    if (!teacherId) return true;
    if (isTeacherSlotBusyFor(teacherId, subjectId, destDay, destPeriod, room)) return false;
    const t = teacherMap.get(teacherId);
    if (isTeacherBlockedAtSlot(t, destDay, destPeriod)) {
      return false;
    }
    const alreadyInPhysicalSlot = teacherSlotEntries.has(`${teacherId}_${destDay}_${destPeriod}`);
    if (enforceDailyLimit && t && destDay !== sourceDay && !alreadyInPhysicalSlot) {
      const currentDayCount = teacherDayLoad.get(`${teacherId}_${destDay}`) || 0;
      const maxDaily = getTeacherDailyMax(t, settings);
      if (currentDayCount >= maxDaily) return false;
    }
    const excludePeriod = destDay === sourceDay ? sourcePeriod : undefined;
    const runWithDest = getMaxConsecutiveRunWith(teacherId, destDay, destPeriod, excludePeriod);
    if (runWithDest >= 4) {
      return false; // 4+ consecutive periods strictly forbidden for all teachers
    }
    if (specialPacedTeacherIdSet.has(teacherId)) {
      const tWeek = teacherWeekLoad.get(teacherId) || 0;
      const runLimit = tWeek >= 20 ? 4 : 3;
      if (runWithDest >= runLimit) {
        return false;
      }
    }
    return true;
  };

  // Helper: Atomically update all booking maps when moving a single entry to a destination slot (or swapping two slots)
  const updateTeacherAndSubjectCountsOnMove = (
    entry: TimetableEntry,
    secCtx: SectionContext,
    oldDay: DayOfWeek,
    oldPeriod: number,
    newDay: DayOfWeek,
    newPeriod: number
  ) => {
    untrackTeacherPlacement(entry);
    entry.day = newDay;
    entry.periodIndex = newPeriod;
    trackTeacherPlacement(entry);

    secCtx.subjectDayCount.set(
      `${entry.subjectId}_${oldDay}`,
      Math.max(0, (secCtx.subjectDayCount.get(`${entry.subjectId}_${oldDay}`) || 1) - 1)
    );
    secCtx.subjectDayCount.set(
      `${entry.subjectId}_${newDay}`,
      (secCtx.subjectDayCount.get(`${entry.subjectId}_${newDay}`) || 0) + 1
    );
    secCtx.dayCount.set(oldDay, Math.max(0, (secCtx.dayCount.get(oldDay) || 1) - 1));
    secCtx.dayCount.set(newDay, (secCtx.dayCount.get(newDay) || 0) + 1);
  };

  // Helper: Atomically swap two single non-parallel entries within the same section
  const swapTwoEntriesInSection = (
    secCtx: SectionContext,
    entryA: TimetableEntry,
    entryB: TimetableEntry
  ) => {
    const dayA = entryA.day;
    const periodA = entryA.periodIndex;
    const dayB = entryB.day;
    const periodB = entryB.periodIndex;
    const keyA = `${secCtx.classObj.id}_${secCtx.sectionId}_${dayA}_${periodA}`;
    const keyB = `${secCtx.classObj.id}_${secCtx.sectionId}_${dayB}_${periodB}`;

    untrackTeacherPlacement(entryA);
    untrackTeacherPlacement(entryB);

    secCtx.subjectDayCount.set(`${entryA.subjectId}_${dayA}`, Math.max(0, (secCtx.subjectDayCount.get(`${entryA.subjectId}_${dayA}`) || 1) - 1));
    secCtx.subjectDayCount.set(`${entryA.subjectId}_${dayB}`, (secCtx.subjectDayCount.get(`${entryA.subjectId}_${dayB}`) || 0) + 1);
    secCtx.subjectDayCount.set(`${entryB.subjectId}_${dayB}`, Math.max(0, (secCtx.subjectDayCount.get(`${entryB.subjectId}_${dayB}`) || 1) - 1));
    secCtx.subjectDayCount.set(`${entryB.subjectId}_${dayA}`, (secCtx.subjectDayCount.get(`${entryB.subjectId}_${dayA}`) || 0) + 1);

    entryA.day = dayB;
    entryA.periodIndex = periodB;
    entryB.day = dayA;
    entryB.periodIndex = periodA;

    trackTeacherPlacement(entryA);
    trackTeacherPlacement(entryB);

    sectionBookings.set(keyA, [entryB]);
    sectionBookings.set(keyB, [entryA]);
  };

  // Helper: Execute cross-section relocation for a blocking teacher's single non-parallel entry
  const tryRelocateTeacherBlockerAtSlot = (
    teacher: Teacher,
    day: DayOfWeek,
    periodIndex: number,
    allowRelaxedDaily: boolean = false,
    depth: number = 0,
    visitedIds: Set<string> = new Set()
  ): boolean => {
    const blockerEntryId = teacherBookings.get(`${teacher.id}_${day}_${periodIndex}`);
    if (!blockerEntryId || visitedIds.has(blockerEntryId)) return false;

    const blockerEntry = resultEntries.find(e => e.id === blockerEntryId);
    if (!blockerEntry) return false;
    if (isReligionSubject(blockerEntry.subjectId, subjects)) return false;

    const blockerSecSlotKey = `${blockerEntry.classId}_${blockerEntry.sectionId}_${blockerEntry.day}_${blockerEntry.periodIndex}`;
    const blockerSlotList = sectionBookings.get(blockerSecSlotKey) || [];
    if (blockerSlotList.length !== 1) return false;

    const otherSecCtx = sectionContextMap.get(`${blockerEntry.classId}_${blockerEntry.sectionId}`);
    if (!otherSecCtx) return false;

    // Strategy 1: Move blockerEntry to an empty slot in otherSecCtx
    if (otherSecCtx.availableSlots.length > 0) {
      const moveTargetIdx = otherSecCtx.availableSlots.findIndex(destSlot => {
        if (!isPeriodAllowedForSubject(blockerEntry.classId, blockerEntry.sectionId, blockerEntry.subjectId, destSlot.periodIndex)) {
          return false;
        }
        if (wouldViolateSubjectDailyLimit(otherSecCtx, blockerEntry.subjectId, destSlot.day, blockerEntry.day)) {
          return false;
        }
        if (
          isSubjectDedicatedRoomConflict(
            blockerEntry.subjectId,
            destSlot.day,
            destSlot.periodIndex,
            blockerEntry.room,
            blockerEntry.classId,
            blockerEntry.sectionId
          )
        ) {
          return false;
        }
        return canTeacherMoveToSlot(
          teacher.id,
          destSlot.day,
          destSlot.periodIndex,
          blockerEntry.day,
          !allowRelaxedDaily,
          blockerEntry.subjectId,
          blockerEntry.room,
          blockerEntry.periodIndex
        );
      });

      if (moveTargetIdx !== -1) {
        const destSlot = otherSecCtx.availableSlots.splice(moveTargetIdx, 1)[0];
        const oldDay = blockerEntry.day;
        const oldPeriod = blockerEntry.periodIndex;
        updateTeacherAndSubjectCountsOnMove(blockerEntry, otherSecCtx, oldDay, oldPeriod, destSlot.day, destSlot.periodIndex);
        sectionBookings.delete(blockerSecSlotKey);
        sectionBookings.set(
          `${blockerEntry.classId}_${blockerEntry.sectionId}_${destSlot.day}_${destSlot.periodIndex}`,
          [blockerEntry]
        );
        otherSecCtx.availableSlots.push({ day: oldDay, periodIndex: oldPeriod });
        return true;
      }
    }

    // Strategy 2: Swap blockerEntry with another single entry inside otherSecCtx
    const peerEntries = resultEntries.filter(e => {
      if (e.classId !== otherSecCtx.classObj.id || e.sectionId !== otherSecCtx.sectionId) return false;
      if (e.id === blockerEntry.id || e.subjectId === blockerEntry.subjectId) return false;
      if (isReligionSubject(e.subjectId, subjects) || isReligionSubject(blockerEntry.subjectId, subjects)) return false;
      if (visitedIds.has(e.id)) return false;
      const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
      return (sectionBookings.get(sk)?.length || 0) === 1;
    });

    // Pass 2A: Direct 1-swap inside otherSecCtx (no recursion needed)
    for (const peerEntry of peerEntries) {
      if (!isPeriodAllowedForSubject(blockerEntry.classId, blockerEntry.sectionId, blockerEntry.subjectId, peerEntry.periodIndex)) {
        continue;
      }
      if (!isPeriodAllowedForSubject(peerEntry.classId, peerEntry.sectionId, peerEntry.subjectId, blockerEntry.periodIndex)) {
        continue;
      }
      if (wouldViolateSubjectDailyLimit(otherSecCtx, blockerEntry.subjectId, peerEntry.day, blockerEntry.day)) {
        continue;
      }
      if (wouldViolateSubjectDailyLimit(otherSecCtx, peerEntry.subjectId, blockerEntry.day, peerEntry.day)) {
        continue;
      }
      if (
        isSubjectDedicatedRoomConflict(
          blockerEntry.subjectId,
          peerEntry.day,
          peerEntry.periodIndex,
          blockerEntry.room,
          blockerEntry.classId,
          blockerEntry.sectionId
        )
      ) {
        continue;
      }
      if (
        isSubjectDedicatedRoomConflict(
          peerEntry.subjectId,
          blockerEntry.day,
          blockerEntry.periodIndex,
          peerEntry.room,
          peerEntry.classId,
          peerEntry.sectionId
        )
      ) {
        continue;
      }
      if (
        !canTeacherMoveToSlot(
          teacher.id,
          peerEntry.day,
          peerEntry.periodIndex,
          blockerEntry.day,
          !allowRelaxedDaily,
          blockerEntry.subjectId,
          blockerEntry.room,
          blockerEntry.periodIndex
        )
      ) {
        continue;
      }
      if (
        !canTeacherMoveToSlot(
          peerEntry.teacherId,
          blockerEntry.day,
          blockerEntry.periodIndex,
          peerEntry.day,
          !allowRelaxedDaily,
          peerEntry.subjectId,
          peerEntry.room,
          peerEntry.periodIndex
        )
      ) {
        continue;
      }

      swapTwoEntriesInSection(otherSecCtx, blockerEntry, peerEntry);
      return true;
    }

    // Pass 2B: Depth-2 chain relocation when peerEntry's teacher is the only blocker at (day, periodIndex)
    if (depth < 2) {
      const nextVisited = new Set(visitedIds);
      nextVisited.add(blockerEntry.id);
      const bDay = blockerEntry.day;
      const bPeriod = blockerEntry.periodIndex;

      for (const peerEntry of peerEntries) {
        if (!peerEntry.teacherId) continue;
        if (!isPeriodAllowedForSubject(blockerEntry.classId, blockerEntry.sectionId, blockerEntry.subjectId, peerEntry.periodIndex)) {
          continue;
        }
        if (!isPeriodAllowedForSubject(peerEntry.classId, peerEntry.sectionId, peerEntry.subjectId, bPeriod)) {
          continue;
        }
        if (wouldViolateSubjectDailyLimit(otherSecCtx, blockerEntry.subjectId, peerEntry.day, bDay)) {
          continue;
        }
        if (wouldViolateSubjectDailyLimit(otherSecCtx, peerEntry.subjectId, bDay, peerEntry.day)) {
          continue;
        }
        if (
          isSubjectDedicatedRoomConflict(
            blockerEntry.subjectId,
            peerEntry.day,
            peerEntry.periodIndex,
            blockerEntry.room,
            blockerEntry.classId,
            blockerEntry.sectionId
          )
        ) {
          continue;
        }
        if (
          isSubjectDedicatedRoomConflict(
            peerEntry.subjectId,
            bDay,
            bPeriod,
            peerEntry.room,
            peerEntry.classId,
            peerEntry.sectionId
          )
        ) {
          continue;
        }
        if (
          !canTeacherMoveToSlot(
            teacher.id,
            peerEntry.day,
            peerEntry.periodIndex,
            bDay,
            !allowRelaxedDaily,
            blockerEntry.subjectId,
            blockerEntry.room,
            bPeriod
          )
        ) {
          continue;
        }

        const peerTeacher = teacherMap.get(peerEntry.teacherId);
        if (!peerTeacher) continue;
        if (isTeacherBlockedAtSlot(peerTeacher, bDay, bPeriod)) {
          continue;
        }
        if (
          !allowRelaxedDaily &&
          bDay !== peerEntry.day &&
          (teacherDayLoad.get(`${peerTeacher.id}_${bDay}`) || 0) >= getTeacherDailyMax(peerTeacher, settings)
        ) {
          continue;
        }

        const pDay = peerEntry.day;
        const pPeriod = peerEntry.periodIndex;
        const blockingPeerSlotId = teacherBookings.get(`${peerTeacher.id}_${bDay}_${bPeriod}`);
        if (blockingPeerSlotId && !visitedIds.has(blockingPeerSlotId)) {
          const chainVisited = new Set(nextVisited);
          chainVisited.add(peerEntry.id);
          if (
            tryRelocateTeacherBlockerAtSlot(
              peerTeacher,
              bDay,
              bPeriod,
              allowRelaxedDaily,
              depth + 1,
              chainVisited
            )
          ) {
            // Re-verify invariants after recursive move before executing swap
            if (
              blockerEntry.day === bDay &&
              blockerEntry.periodIndex === bPeriod &&
              peerEntry.day === pDay &&
              peerEntry.periodIndex === pPeriod &&
              !teacherBookings.has(`${teacher.id}_${pDay}_${pPeriod}`) &&
              !teacherBookings.has(`${peerTeacher.id}_${bDay}_${bPeriod}`) &&
              !wouldViolateSubjectDailyLimit(otherSecCtx, blockerEntry.subjectId, pDay, bDay) &&
              !wouldViolateSubjectDailyLimit(otherSecCtx, peerEntry.subjectId, bDay, pDay)
            ) {
              swapTwoEntriesInSection(otherSecCtx, blockerEntry, peerEntry);
              return true;
            }
          }
        }
      }
    }

    return false;
  };

  // Helper: Attempt 1-step intra-section swap (optionally relocating t1 across sections if t1 is busy at slotA)
  const tryIntraSectionSwap = (
    sectionCtx: SectionContext,
    pairItem: ParallelPairItem,
    primaryCandidates: CandidateMatch[],
    restrictPartnerToDedicated: boolean = false,
    allowBlockerRelocation: boolean = false,
    allowRelaxedDaily: boolean = false
  ): boolean => {
    if (sectionCtx.availableSlots.length === 0) return false;
    const { classObj, sectionId, room, availableSlots, subjectDayCount } = sectionCtx;

    const sectionEntries = resultEntries.filter(
      e => e.classId === classObj.id && e.sectionId === sectionId
    );

    for (const targetPrimaryMatch of primaryCandidates) {
      const t1 = targetPrimaryMatch.teacher;

      for (const existingEntry of sectionEntries) {
        const slotKeyA = `${classObj.id}_${sectionId}_${existingEntry.day}_${existingEntry.periodIndex}`;
        const slotAList = sectionBookings.get(slotKeyA) || [];
        if (slotAList.length === 0 || slotAList.length > 2) continue;
        // Avoid evaluating the same paired slot twice
        if (slotAList.length === 2 && slotAList[0].id !== existingEntry.id) continue;
        if (
          slotAList.some(
            e =>
              e.subjectId === pairItem.primary.subjectId ||
              e.subjectId === pairItem.partner?.subjectId ||
              (!allowBlockerRelocation && isReligionSubject(e.subjectId, subjects))
          )
        ) {
          continue;
        }

        if (!isPeriodAllowedForPair(sectionCtx, pairItem, existingEntry.periodIndex)) continue;
        if (wouldViolatePairDailyLimit(sectionCtx, pairItem, existingEntry.day)) continue;
        if (isDedicatedRoomConflict(pairItem, existingEntry.day, existingEntry.periodIndex, classObj.id, sectionId, room)) continue;

        if (isTeacherBlockedAtSlot(t1, existingEntry.day, existingEntry.periodIndex)) {
          continue;
        }
        const t1AlreadyInPhysical = teacherSlotEntries.has(`${t1.id}_${existingEntry.day}_${existingEntry.periodIndex}`);
        if (!allowRelaxedDaily && !t1AlreadyInPhysical && (teacherDayLoad.get(`${t1.id}_${existingEntry.day}`) || 0) >= getTeacherDailyMax(t1, settings)) {
          continue;
        }

        const t1BusyAtA = isTeacherSlotBusyFor(
          t1.id,
          pairItem.primary.subjectId,
          existingEntry.day,
          existingEntry.periodIndex,
          resolveRoom(pairItem.primary, room)
        );
        if (t1BusyAtA && !allowBlockerRelocation) continue;

        let chosenT2: Teacher | null = null;
        if (pairItem.partner) {
          const rawPartnerCands = getCandidatesWithTiers(
            pairItem.partner.subjectId,
            classObj.id,
            sectionId,
            pairItem.partner.preferredTeacherId,
            t1.id
          );
          const allPartnerCands = restrictPartnerToDedicated
            ? rawPartnerCands.filter(c2 => c2.tier <= 2)
            : rawPartnerCands;
          const freePartners = allPartnerCands.filter(c2 => {
            if (
              isTeacherSlotBusyFor(
                c2.teacher.id,
                pairItem.partner!.subjectId,
                existingEntry.day,
                existingEntry.periodIndex,
                resolveRoom(pairItem.partner!, room)
              )
            ) {
              return false;
            }
            if (
              isTeacherBlockedAtSlot(c2.teacher, existingEntry.day, existingEntry.periodIndex)
            ) {
              return false;
            }
            return true;
          });
          if (freePartners.length === 0) continue;
          freePartners.sort(
            (a, b) =>
              scorePartnerCandidate(b, pairItem.partner!.subjectId, existingEntry.day, existingEntry.periodIndex) -
              scorePartnerCandidate(a, pairItem.partner!.subjectId, existingEntry.day, existingEntry.periodIndex)
          );
          chosenT2 = freePartners[0].teacher;
        }

        let swapSlotIdx = availableSlots.findIndex(slotB =>
          slotAList.every(se => {
            if (!isPeriodAllowedForSubject(se.classId, se.sectionId, se.subjectId, slotB.periodIndex)) {
              return false;
            }
            if (wouldViolateSubjectDailyLimit(sectionCtx, se.subjectId, slotB.day, se.day)) {
              return false;
            }
            if (isSubjectDedicatedRoomConflict(se.subjectId, slotB.day, slotB.periodIndex, se.room, se.classId, se.sectionId)) {
              return false;
            }
            if (isHinduReligionSubject(se.subjectId, subjects)) {
              const otherHindu = resultEntries.find(
                e =>
                  e.day === slotB.day &&
                  e.periodIndex === slotB.periodIndex &&
                  isHinduReligionSubject(e.subjectId, subjects) &&
                  isHinduReligionRoom(e.room, settings) &&
                  Boolean(e.teacherId)
              );
              if (otherHindu && otherHindu.teacherId !== se.teacherId) {
                return false;
              }
            }
            return canTeacherMoveToSlot(
              se.teacherId,
              slotB.day,
              slotB.periodIndex,
              se.day,
              !allowRelaxedDaily || specialPacedTeacherIdSet.has(se.teacherId),
              se.subjectId,
              se.room,
              se.periodIndex
            );
          })
        );

        // If no direct slotB exists, try relocating a single existingEntry's teacher out of slotB
        if (slotAList.length === 1 && swapSlotIdx === -1 && allowBlockerRelocation && existingEntry.teacherId) {
          const existingTeacherObj = teacherMap.get(existingEntry.teacherId);
          const aOrigDay = existingEntry.day;
          const aOrigPeriod = existingEntry.periodIndex;
          if (existingTeacherObj) {
            for (let bIdx = 0; bIdx < availableSlots.length; bIdx++) {
              const slotB = availableSlots[bIdx];
              if (!isPeriodAllowedForSubject(existingEntry.classId, existingEntry.sectionId, existingEntry.subjectId, slotB.periodIndex)) {
                continue;
              }
              if (wouldViolateSubjectDailyLimit(sectionCtx, existingEntry.subjectId, slotB.day, aOrigDay)) {
                continue;
              }
              if (
                isSubjectDedicatedRoomConflict(
                  existingEntry.subjectId,
                  slotB.day,
                  slotB.periodIndex,
                  existingEntry.room,
                  existingEntry.classId,
                  existingEntry.sectionId
                )
              ) {
                continue;
              }
              if (isTeacherBlockedAtSlot(existingTeacherObj, slotB.day, slotB.periodIndex)) {
                continue;
              }
              if (
                !allowRelaxedDaily &&
                slotB.day !== aOrigDay &&
                (teacherDayLoad.get(`${existingTeacherObj.id}_${slotB.day}`) || 0) >=
                  getTeacherDailyMax(existingTeacherObj, settings)
              ) {
                continue;
              }
              if (
                isTeacherSlotBusyFor(
                  existingTeacherObj.id,
                  existingEntry.subjectId,
                  slotB.day,
                  slotB.periodIndex,
                  existingEntry.room
                ) &&
                tryRelocateTeacherBlockerAtSlot(existingTeacherObj, slotB.day, slotB.periodIndex, allowRelaxedDaily)
              ) {
                if (
                  existingEntry.day === aOrigDay &&
                  existingEntry.periodIndex === aOrigPeriod &&
                  canTeacherMoveToSlot(
                    existingTeacherObj.id,
                    slotB.day,
                    slotB.periodIndex,
                    aOrigDay,
                    !allowRelaxedDaily || specialPacedTeacherIdSet.has(existingTeacherObj.id),
                    existingEntry.subjectId,
                    existingEntry.room,
                    aOrigPeriod
                  )
                ) {
                  swapSlotIdx = bIdx;
                  break;
                }
              }
            }
          }
        }

        if (swapSlotIdx !== -1) {
          if (
            isTeacherSlotBusyFor(
              t1.id,
              pairItem.primary.subjectId,
              existingEntry.day,
              existingEntry.periodIndex,
              resolveRoom(pairItem.primary, room)
            )
          ) {
            if (!tryRelocateTeacherBlockerAtSlot(t1, existingEntry.day, existingEntry.periodIndex, allowRelaxedDaily)) {
              continue;
            }
          }
          // Re-verify slotB & partner stay clean if blocker relocation moved anything
          const slotBCheck = availableSlots[swapSlotIdx];
          if (
            !slotBCheck ||
            !slotAList.every(se =>
              canTeacherMoveToSlot(
                se.teacherId,
                slotBCheck.day,
                slotBCheck.periodIndex,
                se.day,
                !allowRelaxedDaily || specialPacedTeacherIdSet.has(se.teacherId),
                se.subjectId,
                se.room,
                se.periodIndex
              )
            )
          ) {
            continue;
          }

          const slotB = availableSlots.splice(swapSlotIdx, 1)[0];
          const oldDay = existingEntry.day;
          const oldPeriod = existingEntry.periodIndex;

          const movedSlotEntries = [...slotAList];
          for (const se of movedSlotEntries) {
            updateTeacherAndSubjectCountsOnMove(se, sectionCtx, oldDay, oldPeriod, slotB.day, slotB.periodIndex);
          }
          const slotKeyB = `${classObj.id}_${sectionId}_${slotB.day}_${slotB.periodIndex}`;
          sectionBookings.delete(slotKeyA);
          sectionBookings.set(slotKeyB, movedSlotEntries);

          const slotEntries: TimetableEntry[] = [];
          const newId1 = nextEntryId('gen', classObj.id, sectionId, oldDay, oldPeriod);
          const newEntry1: TimetableEntry = {
            id: newId1,
            classId: classObj.id,
            sectionId,
            day: oldDay,
            periodIndex: oldPeriod,
            subjectId: pairItem.primary.subjectId,
            teacherId: t1.id,
            room: resolveRoom(pairItem.primary, room),
          };
          resultEntries.push(newEntry1);
          slotEntries.push(newEntry1);
          trackTeacherPlacement(newEntry1);
          subjectDayCount.set(
            `${pairItem.primary.subjectId}_${oldDay}`,
            (subjectDayCount.get(`${pairItem.primary.subjectId}_${oldDay}`) || 0) + 1
          );
          totalAssigned++;

          if (pairItem.partner && chosenT2) {
            const newId2 = nextEntryId('gen-par', classObj.id, sectionId, oldDay, oldPeriod);
            const newEntry2: TimetableEntry = {
              id: newId2,
              classId: classObj.id,
              sectionId,
              day: oldDay,
              periodIndex: oldPeriod,
              subjectId: pairItem.partner.subjectId,
              teacherId: chosenT2.id,
              room: resolveRoom(pairItem.partner, room),
            };
            resultEntries.push(newEntry2);
            slotEntries.push(newEntry2);
            trackTeacherPlacement(newEntry2);
            subjectDayCount.set(
              `${pairItem.partner.subjectId}_${oldDay}`,
              (subjectDayCount.get(`${pairItem.partner.subjectId}_${oldDay}`) || 0) + 1
            );
            totalAssigned++;
          }

          sectionCtx.dayCount.set(oldDay, (sectionCtx.dayCount.get(oldDay) || 0) + (pairItem.partner && chosenT2 ? 2 : 1));
          sectionBookings.set(slotKeyA, slotEntries);
          return true;
        }
      }
    }

    return false;
  };

  // Helper: 2-step intra-section chain swap (pairItem -> slotA, entryA -> slotM, entryM -> slotB)
  const tryTwoStepIntraSectionSwap = (
    sectionCtx: SectionContext,
    pairItem: ParallelPairItem,
    primaryCandidates: CandidateMatch[],
    restrictPartnerToDedicated: boolean = false,
    allowRelaxedDaily: boolean = false,
    allowBlockerRelocation: boolean = false
  ): boolean => {
    if (sectionCtx.availableSlots.length === 0) return false;
    const { classObj, sectionId, room, availableSlots, subjectDayCount } = sectionCtx;

    const singleSectionEntries = resultEntries.filter(e => {
      if (e.classId !== classObj.id || e.sectionId !== sectionId) return false;
      const sk = `${classObj.id}_${sectionId}_${e.day}_${e.periodIndex}`;
      return (sectionBookings.get(sk)?.length || 0) === 1;
    });

    for (const targetPrimaryMatch of primaryCandidates) {
      const t1 = targetPrimaryMatch.teacher;

      for (const entryA of singleSectionEntries) {
        if (
          entryA.subjectId === pairItem.primary.subjectId ||
          entryA.subjectId === pairItem.partner?.subjectId ||
          isReligionSubject(entryA.subjectId, subjects)
        ) {
          continue;
        }
        if (!isPeriodAllowedForPair(sectionCtx, pairItem, entryA.periodIndex)) continue;
        if (wouldViolatePairDailyLimit(sectionCtx, pairItem, entryA.day)) continue;
        if (isDedicatedRoomConflict(pairItem, entryA.day, entryA.periodIndex, classObj.id, sectionId, room)) continue;
        if (
          isTeacherSlotBusyFor(
            t1.id,
            pairItem.primary.subjectId,
            entryA.day,
            entryA.periodIndex,
            resolveRoom(pairItem.primary, room)
          )
        ) {
          continue;
        }
        if (isTeacherBlockedAtSlot(t1, entryA.day, entryA.periodIndex)) {
          continue;
        }
        const t1AlreadyInPhys = teacherSlotEntries.has(`${t1.id}_${entryA.day}_${entryA.periodIndex}`);
        if (!allowRelaxedDaily && !t1AlreadyInPhys && (teacherDayLoad.get(`${t1.id}_${entryA.day}`) || 0) >= getTeacherDailyMax(t1, settings)) {
          continue;
        }

        let chosenT2: Teacher | null = null;
        if (pairItem.partner) {
          const rawPartnerCands = getCandidatesWithTiers(
            pairItem.partner.subjectId,
            classObj.id,
            sectionId,
            pairItem.partner.preferredTeacherId,
            t1.id
          );
          const allPartnerCands = restrictPartnerToDedicated
            ? rawPartnerCands.filter(c2 => c2.tier <= 2)
            : rawPartnerCands;
          const freePartners = allPartnerCands.filter(
            c2 =>
              !isTeacherSlotBusyFor(
                c2.teacher.id,
                pairItem.partner!.subjectId,
                entryA.day,
                entryA.periodIndex,
                resolveRoom(pairItem.partner!, room)
              ) &&
              !isTeacherBlockedAtSlot(c2.teacher, entryA.day, entryA.periodIndex)
          );
          if (freePartners.length === 0) continue;
          freePartners.sort(
            (a, b) =>
              scorePartnerCandidate(b, pairItem.partner!.subjectId, entryA.day, entryA.periodIndex) -
              scorePartnerCandidate(a, pairItem.partner!.subjectId, entryA.day, entryA.periodIndex)
          );
          chosenT2 = freePartners[0].teacher;
        }

        for (const entryM of singleSectionEntries) {
          if (entryM.id === entryA.id) continue;
          if (entryM.subjectId === entryA.subjectId || isReligionSubject(entryM.subjectId, subjects)) continue;

          if (!isPeriodAllowedForSubject(entryA.classId, entryA.sectionId, entryA.subjectId, entryM.periodIndex)) continue;
          if (wouldViolateSubjectDailyLimit(sectionCtx, entryA.subjectId, entryM.day, entryA.day)) continue;
          if (
            isSubjectDedicatedRoomConflict(
              entryA.subjectId,
              entryM.day,
              entryM.periodIndex,
              entryA.room,
              entryA.classId,
              entryA.sectionId
            )
          ) {
            continue;
          }
          const entryABusyAtMOnly =
            Boolean(entryA.teacherId) &&
            isTeacherSlotBusyFor(entryA.teacherId, entryA.subjectId, entryM.day, entryM.periodIndex, entryA.room);
          const aTeacherObj = entryA.teacherId ? teacherMap.get(entryA.teacherId) : undefined;
          if (entryABusyAtMOnly && (!allowBlockerRelocation || !aTeacherObj)) {
            continue;
          }
          if (
            !entryABusyAtMOnly &&
            !canTeacherMoveToSlot(
              entryA.teacherId,
              entryM.day,
              entryM.periodIndex,
              entryA.day,
              !allowRelaxedDaily,
              entryA.subjectId,
              entryA.room,
              entryA.periodIndex
            )
          ) {
            continue;
          }
          if (
            entryABusyAtMOnly &&
            aTeacherObj &&
            (isTeacherBlockedAtSlot(aTeacherObj, entryM.day, entryM.periodIndex) ||
              (!allowRelaxedDaily &&
                entryM.day !== entryA.day &&
                (teacherDayLoad.get(`${aTeacherObj.id}_${entryM.day}`) || 0) >= getTeacherDailyMax(aTeacherObj, settings)))
          ) {
            continue;
          }

          let swapSlotIdx = availableSlots.findIndex(slotB => {
            if (!isPeriodAllowedForSubject(entryM.classId, entryM.sectionId, entryM.subjectId, slotB.periodIndex)) {
              return false;
            }
            if (wouldViolateSubjectDailyLimit(sectionCtx, entryM.subjectId, slotB.day, entryM.day)) {
              return false;
            }
            if (
              isSubjectDedicatedRoomConflict(
                entryM.subjectId,
                slotB.day,
                slotB.periodIndex,
                entryM.room,
                entryM.classId,
                entryM.sectionId
              )
            ) {
              return false;
            }
            return canTeacherMoveToSlot(
              entryM.teacherId,
              slotB.day,
              slotB.periodIndex,
              entryM.day,
              !allowRelaxedDaily,
              entryM.subjectId,
              entryM.room,
              entryM.periodIndex
            );
          });

          if (swapSlotIdx === -1 && allowBlockerRelocation && entryM.teacherId) {
            const mTeacher = teacherMap.get(entryM.teacherId);
            if (mTeacher) {
              const dayAOrig = entryA.day;
              const periodAOrig = entryA.periodIndex;
              const dayMOrig = entryM.day;
              const periodMOrig = entryM.periodIndex;
              for (let bIdx = 0; bIdx < availableSlots.length; bIdx++) {
                const slotB = availableSlots[bIdx];
                if (!isPeriodAllowedForSubject(entryM.classId, entryM.sectionId, entryM.subjectId, slotB.periodIndex)) continue;
                if (wouldViolateSubjectDailyLimit(sectionCtx, entryM.subjectId, slotB.day, dayMOrig)) continue;
                if (
                  isSubjectDedicatedRoomConflict(
                    entryM.subjectId,
                    slotB.day,
                    slotB.periodIndex,
                    entryM.room,
                    entryM.classId,
                    entryM.sectionId
                  )
                ) {
                  continue;
                }
                if (isTeacherBlockedAtSlot(mTeacher, slotB.day, slotB.periodIndex)) continue;
                if (
                  !allowRelaxedDaily &&
                  slotB.day !== dayMOrig &&
                  (teacherDayLoad.get(`${mTeacher.id}_${slotB.day}`) || 0) >= getTeacherDailyMax(mTeacher, settings)
                ) {
                  continue;
                }
                if (
                  teacherBookings.has(`${mTeacher.id}_${slotB.day}_${slotB.periodIndex}`) &&
                  tryRelocateTeacherBlockerAtSlot(mTeacher, slotB.day, slotB.periodIndex, allowRelaxedDaily)
                ) {
                  if (
                    entryA.day === dayAOrig &&
                    entryA.periodIndex === periodAOrig &&
                    entryM.day === dayMOrig &&
                    entryM.periodIndex === periodMOrig &&
                    !isTeacherSlotBusyFor(t1.id, pairItem.primary.subjectId, dayAOrig, periodAOrig, resolveRoom(pairItem.primary, room)) &&
                    (!chosenT2 || !isTeacherSlotBusyFor(chosenT2.id, pairItem.partner!.subjectId, dayAOrig, periodAOrig, resolveRoom(pairItem.partner!, room))) &&
                    (entryABusyAtMOnly ||
                      canTeacherMoveToSlot(entryA.teacherId, dayMOrig, periodMOrig, dayAOrig, !allowRelaxedDaily, entryA.subjectId, entryA.room, periodAOrig)) &&
                    canTeacherMoveToSlot(entryM.teacherId, slotB.day, slotB.periodIndex, dayMOrig, !allowRelaxedDaily, entryM.subjectId, entryM.room, periodMOrig)
                  ) {
                    swapSlotIdx = bIdx;
                    break;
                  }
                }
              }
            }
          }

          if (swapSlotIdx !== -1 && entryABusyAtMOnly && aTeacherObj) {
            const slotBCheck = availableSlots[swapSlotIdx];
            if (
              !tryRelocateTeacherBlockerAtSlot(aTeacherObj, entryM.day, entryM.periodIndex, allowRelaxedDaily) ||
              !slotBCheck ||
              isTeacherSlotBusyFor(t1.id, pairItem.primary.subjectId, entryA.day, entryA.periodIndex, resolveRoom(pairItem.primary, room)) ||
              !canTeacherMoveToSlot(entryA.teacherId, entryM.day, entryM.periodIndex, entryA.day, !allowRelaxedDaily, entryA.subjectId, entryA.room, entryA.periodIndex) ||
              !canTeacherMoveToSlot(entryM.teacherId, slotBCheck.day, slotBCheck.periodIndex, entryM.day, !allowRelaxedDaily, entryM.subjectId, entryM.room, entryM.periodIndex)
            ) {
              swapSlotIdx = -1;
            }
          }

          if (swapSlotIdx !== -1) {
            const slotB = availableSlots.splice(swapSlotIdx, 1)[0];
            const dayA = entryA.day;
            const periodA = entryA.periodIndex;
            const dayM = entryM.day;
            const periodM = entryM.periodIndex;
            const slotKeyA = `${classObj.id}_${sectionId}_${dayA}_${periodA}`;
            const slotKeyM = `${classObj.id}_${sectionId}_${dayM}_${periodM}`;
            const slotKeyB = `${classObj.id}_${sectionId}_${slotB.day}_${slotB.periodIndex}`;

            updateTeacherAndSubjectCountsOnMove(entryM, sectionCtx, dayM, periodM, slotB.day, slotB.periodIndex);
            sectionBookings.set(slotKeyB, [entryM]);

            updateTeacherAndSubjectCountsOnMove(entryA, sectionCtx, dayA, periodA, dayM, periodM);
            sectionBookings.set(slotKeyM, [entryA]);

            const slotEntries: TimetableEntry[] = [];
            const newId1 = nextEntryId('gen', classObj.id, sectionId, dayA, periodA);
            const newEntry1: TimetableEntry = {
              id: newId1,
              classId: classObj.id,
              sectionId,
              day: dayA,
              periodIndex: periodA,
              subjectId: pairItem.primary.subjectId,
              teacherId: t1.id,
              room: resolveRoom(pairItem.primary, room),
            };
            resultEntries.push(newEntry1);
            slotEntries.push(newEntry1);
            trackTeacherPlacement(newEntry1);
            subjectDayCount.set(
              `${pairItem.primary.subjectId}_${dayA}`,
              (subjectDayCount.get(`${pairItem.primary.subjectId}_${dayA}`) || 0) + 1
            );
            totalAssigned++;

            if (pairItem.partner && chosenT2) {
              const newId2 = nextEntryId('gen-par', classObj.id, sectionId, dayA, periodA);
              const newEntry2: TimetableEntry = {
                id: newId2,
                classId: classObj.id,
                sectionId,
                day: dayA,
                periodIndex: periodA,
                subjectId: pairItem.partner.subjectId,
                teacherId: chosenT2.id,
                room: resolveRoom(pairItem.partner, room),
              };
              resultEntries.push(newEntry2);
              slotEntries.push(newEntry2);
              trackTeacherPlacement(newEntry2);
              subjectDayCount.set(
                `${pairItem.partner.subjectId}_${dayA}`,
                (subjectDayCount.get(`${pairItem.partner.subjectId}_${dayA}`) || 0) + 1
              );
              totalAssigned++;
            }

            sectionCtx.dayCount.set(dayA, (sectionCtx.dayCount.get(dayA) || 0) + (pairItem.partner && chosenT2 ? 2 : 1));
            sectionBookings.set(slotKeyA, slotEntries);
            return true;
          }
        }
      }
    }

    return false;
  };

  // Helper: Bidirectional cross-section relocation (frees either primary t1 OR partner t2)
  const tryCrossSectionRelocation = (
    sectionCtx: SectionContext,
    pairItem: ParallelPairItem,
    primaryCandidates: CandidateMatch[],
    restrictPartnerToDedicated: boolean = false,
    allowRelaxedDaily: boolean = false
  ): boolean => {
    if (sectionCtx.availableSlots.length === 0) return false;
    const { classObj, sectionId, room, availableSlots, subjectDayCount } = sectionCtx;

    const commitAtSlot = (sIdx: number, t1: Teacher, chosenT2: Teacher | null) => {
      const chosenSlot = availableSlots.splice(sIdx, 1)[0];
      const curSlotKey = `${classObj.id}_${sectionId}_${chosenSlot.day}_${chosenSlot.periodIndex}`;
      const slotEntries: TimetableEntry[] = [];

      const newId1 = nextEntryId('gen', classObj.id, sectionId, chosenSlot.day, chosenSlot.periodIndex);
      const newEntry1: TimetableEntry = {
        id: newId1,
        classId: classObj.id,
        sectionId,
        day: chosenSlot.day,
        periodIndex: chosenSlot.periodIndex,
        subjectId: pairItem.primary.subjectId,
        teacherId: t1.id,
        room: resolveRoom(pairItem.primary, room),
      };
      resultEntries.push(newEntry1);
      slotEntries.push(newEntry1);
      trackTeacherPlacement(newEntry1);
      subjectDayCount.set(
        `${pairItem.primary.subjectId}_${chosenSlot.day}`,
        (subjectDayCount.get(`${pairItem.primary.subjectId}_${chosenSlot.day}`) || 0) + 1
      );
      totalAssigned++;

      if (pairItem.partner && chosenT2) {
        const newId2 = nextEntryId('gen-par', classObj.id, sectionId, chosenSlot.day, chosenSlot.periodIndex);
        const newEntry2: TimetableEntry = {
          id: newId2,
          classId: classObj.id,
          sectionId,
          day: chosenSlot.day,
          periodIndex: chosenSlot.periodIndex,
          subjectId: pairItem.partner.subjectId,
          teacherId: chosenT2.id,
          room: resolveRoom(pairItem.partner, room),
        };
        resultEntries.push(newEntry2);
        slotEntries.push(newEntry2);
        trackTeacherPlacement(newEntry2);
        subjectDayCount.set(
          `${pairItem.partner.subjectId}_${chosenSlot.day}`,
          (subjectDayCount.get(`${pairItem.partner.subjectId}_${chosenSlot.day}`) || 0) + 1
        );
        totalAssigned++;
      }

      sectionCtx.dayCount.set(
        chosenSlot.day,
        (sectionCtx.dayCount.get(chosenSlot.day) || 0) + (pairItem.partner && chosenT2 ? 2 : 1)
      );
      sectionBookings.set(curSlotKey, slotEntries);
    };

    for (const targetPrimaryMatch of primaryCandidates) {
      const t1 = targetPrimaryMatch.teacher;

      for (let sIdx = 0; sIdx < availableSlots.length; sIdx++) {
        const slot = availableSlots[sIdx];
        if (!isPeriodAllowedForPair(sectionCtx, pairItem, slot.periodIndex)) continue;
        if (wouldViolatePairDailyLimit(sectionCtx, pairItem, slot.day)) continue;
        if (isDedicatedRoomConflict(pairItem, slot.day, slot.periodIndex, classObj.id, sectionId, room)) continue;
        if (isTeacherBlockedAtSlot(t1, slot.day, slot.periodIndex)) {
          continue;
        }
        const t1AlreadyInPhys = teacherSlotEntries.has(`${t1.id}_${slot.day}_${slot.periodIndex}`);
        if (!allowRelaxedDaily && !t1AlreadyInPhys && (teacherDayLoad.get(`${t1.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t1, settings)) {
          continue;
        }

        const t1Busy = isTeacherSlotBusyFor(
          t1.id,
          pairItem.primary.subjectId,
          slot.day,
          slot.periodIndex,
          resolveRoom(pairItem.primary, room)
        );

        if (!pairItem.partner) {
          if (t1Busy && tryRelocateTeacherBlockerAtSlot(t1, slot.day, slot.periodIndex, allowRelaxedDaily)) {
            commitAtSlot(sIdx, t1, null);
            return true;
          }
          continue;
        }

        const rawPartnerCands = getCandidatesWithTiers(
          pairItem.partner.subjectId,
          classObj.id,
          sectionId,
          pairItem.partner.preferredTeacherId,
          t1.id
        );
        const allPartnerCands = restrictPartnerToDedicated
          ? rawPartnerCands.filter(c2 => c2.tier <= 2)
          : rawPartnerCands;
        const freePartners = allPartnerCands.filter(
          c2 =>
            !isTeacherSlotBusyFor(
              c2.teacher.id,
              pairItem.partner!.subjectId,
              slot.day,
              slot.periodIndex,
              resolveRoom(pairItem.partner!, room)
            ) &&
            !isTeacherBlockedAtSlot(c2.teacher, slot.day, slot.periodIndex)
        );

        if (t1Busy) {
          if (freePartners.length === 0) continue;
          freePartners.sort(
            (a, b) =>
              scorePartnerCandidate(b, pairItem.partner!.subjectId, slot.day, slot.periodIndex) -
              scorePartnerCandidate(a, pairItem.partner!.subjectId, slot.day, slot.periodIndex)
          );
          if (tryRelocateTeacherBlockerAtSlot(t1, slot.day, slot.periodIndex, allowRelaxedDaily)) {
            commitAtSlot(sIdx, t1, freePartners[0].teacher);
            return true;
          }
        } else {
          for (const c2 of allPartnerCands) {
            const t2 = c2.teacher;
            if (isTeacherBlockedAtSlot(t2, slot.day, slot.periodIndex)) {
              continue;
            }
            if (tryRelocateTeacherBlockerAtSlot(t2, slot.day, slot.periodIndex, allowRelaxedDaily)) {
              commitAtSlot(sIdx, t1, t2);
              return true;
            }
          }
        }
      }
    }

    return false;
  };

  // Helper: Score and assign one KG-10 task strictly preserving assigned/dedicated teachers
  const assignTask = (
    task: ScheduledItemTask,
    allowFallbackTiers: boolean,
    enforceDailyLimit: boolean = false
  ): 'assigned' | 'deferred' | 'failed' => {
    const { sectionCtx, pairItem, orderIndex, hasPrimaryDedicated, hasPartnerDedicated } = task;
    const { classObj, sectionId, room, sectionIndex, availableSlots, subjectDayCount } = sectionCtx;
    const { primary, partner } = pairItem;

    if (availableSlots.length === 0) {
      return 'failed';
    }

    const allPrimaryCandidates = getCandidatesWithTiers(
      primary.subjectId,
      classObj.id,
      sectionId,
      primary.preferredTeacherId
    );

    const eligiblePrimaryCandidates =
      hasPrimaryDedicated || !allowFallbackTiers
        ? allPrimaryCandidates.filter(c => c.tier <= 2)
        : allPrimaryCandidates;

    if (eligiblePrimaryCandidates.length === 0) {
      return allowFallbackTiers ? 'failed' : 'deferred';
    }

    let bestSlotIndex = -1;
    let bestPrimaryTeacher: Teacher | null = null;
    let bestPartnerTeacher: Teacher | null = null;
    let bestScore = -Infinity;

    for (let sIdx = 0; sIdx < availableSlots.length; sIdx++) {
      const slot = availableSlots[sIdx];

      // Enforce Subject Fixed Period constraint
      if (!isPeriodAllowedForPair(sectionCtx, pairItem, slot.periodIndex)) continue;

      // Strict Same-Day Subject Cap
      if (wouldViolatePairDailyLimit(sectionCtx, pairItem, slot.day)) continue;

      // Enforce Religion concurrency limit, Room 307 / Agriculture room & homeroom collisions
      if (isDedicatedRoomConflict(pairItem, slot.day, slot.periodIndex, classObj.id, sectionId, room)) continue;

      const daySubKey = `${primary.subjectId}_${slot.day}`;
      const dayCount = subjectDayCount.get(daySubKey) || 0;

      for (const cand1 of eligiblePrimaryCandidates) {
        const t1 = cand1.teacher;
        if (
          isTeacherSlotBusyFor(
            t1.id,
            primary.subjectId,
            slot.day,
            slot.periodIndex,
            resolveRoom(primary, room)
          )
        ) {
          continue;
        }
        if (isTeacherBlockedAtSlot(t1, slot.day, slot.periodIndex)) continue;

        const t1InPhys = teacherSlotEntries.has(`${t1.id}_${slot.day}_${slot.periodIndex}`);
        if (
          enforceDailyLimit &&
          !t1InPhys &&
          (teacherDayLoad.get(`${t1.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t1, settings)
        ) {
          continue;
        }

        let chosenCand2: CandidateMatch | null = null;
        if (partner) {
          const allPartnerCandidates = getCandidatesWithTiers(
            partner.subjectId,
            classObj.id,
            sectionId,
            partner.preferredTeacherId,
            t1.id
          );
          const eligiblePartnerCandidates =
            hasPartnerDedicated || !allowFallbackTiers
              ? allPartnerCandidates.filter(c2 => c2.tier <= 2)
              : allPartnerCandidates;
          const freePartnerCandidates = eligiblePartnerCandidates.filter(c2 => {
            const t2 = c2.teacher;
            if (
              isTeacherSlotBusyFor(
                t2.id,
                partner.subjectId,
                slot.day,
                slot.periodIndex,
                resolveRoom(partner, room)
              )
            ) {
              return false;
            }
            if (isTeacherBlockedAtSlot(t2, slot.day, slot.periodIndex)) return false;
            const t2InPhys = teacherSlotEntries.has(`${t2.id}_${slot.day}_${slot.periodIndex}`);
            if (
              enforceDailyLimit &&
              !t2InPhys &&
              (teacherDayLoad.get(`${t2.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t2, settings)
            ) {
              return false;
            }
            return true;
          });

          if (freePartnerCandidates.length === 0) continue;

          let bestPartnerScore = -Infinity;
          for (const c2 of freePartnerCandidates) {
            const pScore = scorePartnerCandidate(c2, partner.subjectId, slot.day, slot.periodIndex);
            if (pScore > bestPartnerScore) {
              bestPartnerScore = pScore;
              chosenCand2 = c2;
            }
          }
          if (!chosenCand2) continue;
        }

        let score = cand1.tierScore + scoreTeacherSlotBalance(t1, primary.subjectId, slot.day, slot.periodIndex);

        if (chosenCand2) {
          score += scorePartnerCandidate(chosenCand2, partner!.subjectId, slot.day, slot.periodIndex);
          const pDayCount = subjectDayCount.get(`${partner!.subjectId}_${slot.day}`) || 0;
          if (pDayCount > 0) score -= pDayCount * 20000;
        }

        if (dayCount > 0) score -= dayCount * 20000;

        // Reward populating every active weekday of the section
        const secDayCount = sectionCtx.dayCount.get(slot.day) || 0;
        if (secDayCount === 0) {
          score += 1800;
        } else {
          score -= secDayCount * 220;
        }

        // Preserve periods reserved by fixed-period subjects in this section when placing flexible subjects
        if (!task.hasFixedPeriod) {
          const rSet = sectionReservedFixedPeriods.get(`${classObj.id}_${sectionId}`);
          if (rSet?.has(slot.periodIndex)) {
            score -= 1200;
          }
        }

        const involvesHindu =
          isHinduReligionSubject(primary.subjectId, subjects) ||
          Boolean(partner && isHinduReligionSubject(partner.subjectId, subjects));
        const involvesSharedJuniorTeacher =
          sharedJuniorTeacherIdSet.has(t1.id) ||
          Boolean(chosenCand2 && sharedJuniorTeacherIdSet.has(chosenCand2.teacher.id));
        if (classObj.numericGrade >= 3 && slot.periodIndex > firstBreakIndex) {
          if (involvesHindu) score += 350;
          if (involvesSharedJuniorTeacher) score += 250;
        }

        const deterministicSpread = ((slot.periodIndex + sectionIndex + orderIndex) % 7) * 0.01;
        score += deterministicSpread;

        if (score > bestScore) {
          bestScore = score;
          bestSlotIndex = sIdx;
          bestPrimaryTeacher = t1;
          bestPartnerTeacher = chosenCand2 ? chosenCand2.teacher : null;
        }
      }
    }

    if (bestSlotIndex !== -1 && bestPrimaryTeacher && (!partner || bestPartnerTeacher)) {
      const chosenSlot = availableSlots.splice(bestSlotIndex, 1)[0];
      const sKey = `${classObj.id}_${sectionId}_${chosenSlot.day}_${chosenSlot.periodIndex}`;
      const slotEntries: TimetableEntry[] = [];

      const entryId1 = nextEntryId('gen', classObj.id, sectionId, chosenSlot.day, chosenSlot.periodIndex);
      const entry1: TimetableEntry = {
        id: entryId1,
        classId: classObj.id,
        sectionId,
        day: chosenSlot.day,
        periodIndex: chosenSlot.periodIndex,
        subjectId: primary.subjectId,
        teacherId: bestPrimaryTeacher.id,
        room: resolveRoom(primary, room),
      };
      resultEntries.push(entry1);
      slotEntries.push(entry1);
      trackTeacherPlacement(entry1);
      subjectDayCount.set(
        `${primary.subjectId}_${chosenSlot.day}`,
        (subjectDayCount.get(`${primary.subjectId}_${chosenSlot.day}`) || 0) + 1
      );
      totalAssigned++;

      if (partner && bestPartnerTeacher) {
        const entryId2 = nextEntryId('gen-par', classObj.id, sectionId, chosenSlot.day, chosenSlot.periodIndex);
        const entry2: TimetableEntry = {
          id: entryId2,
          classId: classObj.id,
          sectionId,
          day: chosenSlot.day,
          periodIndex: chosenSlot.periodIndex,
          subjectId: partner.subjectId,
          teacherId: bestPartnerTeacher.id,
          room: resolveRoom(partner, room),
        };
        resultEntries.push(entry2);
        slotEntries.push(entry2);
        trackTeacherPlacement(entry2);
        subjectDayCount.set(
          `${partner.subjectId}_${chosenSlot.day}`,
          (subjectDayCount.get(`${partner.subjectId}_${chosenSlot.day}`) || 0) + 1
        );
        totalAssigned++;
      }

      sectionCtx.dayCount.set(
        chosenSlot.day,
        (sectionCtx.dayCount.get(chosenSlot.day) || 0) + (partner && bestPartnerTeacher ? 2 : 1)
      );
      sectionBookings.set(sKey, slotEntries);
      return 'assigned';
    }

    // Try intra-section 1-step swap & cross-section relocation (strictly preserving dedicated teacher rules)
    if (task.hasDedicated && !allowFallbackTiers) {
      const dedicatedPrimary = hasPrimaryDedicated
        ? allPrimaryCandidates.filter(c => c.tier <= 2)
        : allPrimaryCandidates;
      if (tryIntraSectionSwap(sectionCtx, pairItem, dedicatedPrimary, hasPartnerDedicated)) {
        return 'assigned';
      }
      if (tryCrossSectionRelocation(sectionCtx, pairItem, dedicatedPrimary, hasPartnerDedicated)) {
        return 'assigned';
      }
      return 'deferred';
    }

    return 'failed';
  };

  // ===========================================================================
  // PASS 1B: Combined Religious Wave Scheduler
  //          Packs Islam + Hindu (Room '307') into <= maxRelConcurrent (3)
  //          section waves per period so combined Hindu teacher stays within capacity
  //          while Islam teachers never double-book.
  // ===========================================================================
  const isReligionTask = (t: ScheduledItemTask): boolean =>
    isReligionSubject(t.pairItem.primary.subjectId, subjects) ||
    Boolean(t.pairItem.partner && isReligionSubject(t.pairItem.partner.subjectId, subjects));

  const religionTasks: ScheduledItemTask[] = [];
  const nonReligionTasks: ScheduledItemTask[] = [];
  for (const task of kg10Tasks) {
    if (isReligionTask(task)) {
      religionTasks.push(task);
    } else {
      nonReligionTasks.push(task);
    }
  }
  kg10Tasks.length = 0;
  kg10Tasks.push(...nonReligionTasks);

  religionTasks.sort((a, b) => {
    const aMorningOnly = a.sectionCtx.initialOpenSlotsCount <= workingDays.length * 3;
    const bMorningOnly = b.sectionCtx.initialOpenSlotsCount <= workingDays.length * 3;
    if (aMorningOnly !== bMorningOnly) return aMorningOnly ? -1 : 1;

    const aHasHin =
      isHinduReligionSubject(a.pairItem.primary.subjectId, subjects) ||
      Boolean(a.pairItem.partner && isHinduReligionSubject(a.pairItem.partner.subjectId, subjects));
    const bHasHin =
      isHinduReligionSubject(b.pairItem.primary.subjectId, subjects) ||
      Boolean(b.pairItem.partner && isHinduReligionSubject(b.pairItem.partner.subjectId, subjects));
    if (aHasHin !== bHasHin) return aHasHin ? -1 : 1;

    if (a.subjectInstanceIndex !== b.subjectInstanceIndex) {
      return a.subjectInstanceIndex - b.subjectInstanceIndex;
    }
    if (a.sectionCtx.classObj.numericGrade !== b.sectionCtx.classObj.numericGrade) {
      return a.sectionCtx.classObj.numericGrade - b.sectionCtx.classObj.numericGrade;
    }
    if (a.sectionCtx.sectionIndex !== b.sectionCtx.sectionIndex) {
      return a.sectionCtx.sectionIndex - b.sectionCtx.sectionIndex;
    }
    return a.orderIndex - b.orderIndex;
  });

  const assignReligionWaveTask = (task: ScheduledItemTask, enforceDailyLimit: boolean): boolean => {
    const { sectionCtx, pairItem, orderIndex, hasPrimaryDedicated, hasPartnerDedicated } = task;
    const { classObj, sectionId, room, sectionIndex, availableSlots, subjectDayCount } = sectionCtx;
    const { primary, partner } = pairItem;

    if (availableSlots.length === 0) return false;

    const allPrimaryCands = getCandidatesWithTiers(
      primary.subjectId,
      classObj.id,
      sectionId,
      primary.preferredTeacherId
    );
    const primaryCands = hasPrimaryDedicated ? allPrimaryCands.filter(c => c.tier <= 2) : allPrimaryCands;
    if (primaryCands.length === 0) return false;

    let bestSlotIdx = -1;
    let bestT1: Teacher | null = null;
    let bestT2: Teacher | null = null;
    let bestScore = -Infinity;

    for (let sIdx = 0; sIdx < availableSlots.length; sIdx++) {
      const slot = availableSlots[sIdx];
      if (!isPeriodAllowedForPair(sectionCtx, pairItem, slot.periodIndex)) continue;
      if (wouldViolatePairDailyLimit(sectionCtx, pairItem, slot.day)) continue;
      if (isDedicatedRoomConflict(pairItem, slot.day, slot.periodIndex, classObj.id, sectionId, room)) continue;

      const dpKey = `${slot.day}_${slot.periodIndex}`;
      const existingWaveCount = religionSlotSections.get(dpKey)?.size || 0;
      if (existingWaveCount >= maxRelConcurrent) continue;

      const existingHinduTeacherId = resultEntries.find(
        e =>
          e.day === slot.day &&
          e.periodIndex === slot.periodIndex &&
          isHinduReligionSubject(e.subjectId, subjects) &&
          isHinduReligionRoom(e.room, settings) &&
          Boolean(e.teacherId)
      )?.teacherId;

      for (const c1 of primaryCands) {
        const t1 = c1.teacher;
        const primaryRoom = resolveRoom(primary, room);
        if (isTeacherSlotBusyFor(t1.id, primary.subjectId, slot.day, slot.periodIndex, primaryRoom)) continue;
        if (isTeacherBlockedAtSlot(t1, slot.day, slot.periodIndex)) continue;

        if (
          existingHinduTeacherId &&
          isHinduReligionSubject(primary.subjectId, subjects) &&
          t1.id !== existingHinduTeacherId
        ) {
          continue;
        }

        const t1InPhys = teacherSlotEntries.has(`${t1.id}_${slot.day}_${slot.periodIndex}`);
        if (
          enforceDailyLimit &&
          !t1InPhys &&
          (teacherDayLoad.get(`${t1.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t1, settings)
        ) {
          continue;
        }

        let chosenCand2: CandidateMatch | null = null;
        if (partner) {
          const allPartnerCands = getCandidatesWithTiers(
            partner.subjectId,
            classObj.id,
            sectionId,
            partner.preferredTeacherId,
            t1.id
          );
          const partnerCands = hasPartnerDedicated ? allPartnerCands.filter(c2 => c2.tier <= 2) : allPartnerCands;
          const partnerRoom = resolveRoom(partner, room);

          const freePartners = partnerCands.filter(c2 => {
            const t2 = c2.teacher;
            if (existingHinduTeacherId && isHinduReligionSubject(partner.subjectId, subjects) && t2.id !== existingHinduTeacherId) {
              return false;
            }
            if (isTeacherSlotBusyFor(t2.id, partner.subjectId, slot.day, slot.periodIndex, partnerRoom)) {
              return false;
            }
            if (isTeacherBlockedAtSlot(t2, slot.day, slot.periodIndex)) {
              return false;
            }
            const t2InPhys = teacherSlotEntries.has(`${t2.id}_${slot.day}_${slot.periodIndex}`);
            if (
              enforceDailyLimit &&
              !t2InPhys &&
              (teacherDayLoad.get(`${t2.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t2, settings)
            ) {
              return false;
            }
            return true;
          });
          if (freePartners.length === 0) continue;
          freePartners.sort(
            (a, b) =>
              scorePartnerCandidate(b, partner.subjectId, slot.day, slot.periodIndex) -
              scorePartnerCandidate(a, partner.subjectId, slot.day, slot.periodIndex)
          );
          chosenCand2 = freePartners[0];
        }

        let score = c1.tierScore + scoreTeacherSlotBalance(t1, primary.subjectId, slot.day, slot.periodIndex);
        if (chosenCand2) {
          score += scorePartnerCandidate(chosenCand2, partner!.subjectId, slot.day, slot.periodIndex);
        }

        // Strongly penalize exceeding daily limits on fallback pass when another weekday is under cap
        if (!t1InPhys && (teacherDayLoad.get(`${t1.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t1, settings)) {
          score -= 250000;
        }
        const t2JoinWaveBonus =
          chosenCand2 && teacherSlotEntries.has(`${chosenCand2.teacher.id}_${slot.day}_${slot.periodIndex}`)
            ? 32000
            : t1InPhys && isHinduReligionSubject(primary.subjectId, subjects)
            ? 32000
            : 0;
        if (chosenCand2) {
          const t2 = chosenCand2.teacher;
          const t2InPhys = teacherSlotEntries.has(`${t2.id}_${slot.day}_${slot.periodIndex}`);
          if (!t2InPhys && (teacherDayLoad.get(`${t2.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t2, settings)) {
            score -= 250000;
          }
        }

        score += t2JoinWaveBonus;

        // Strongly pack compatible sections into existing <3 waves to keep Room 307 waves compact
        if (existingWaveCount === 2) {
          score += 55000;
        } else if (existingWaveCount === 1) {
          score += 44000;
        } else if (pinnedReligionSlots.has(dpKey)) {
          score += 25000;
        }

        const secDayCount = sectionCtx.dayCount.get(slot.day) || 0;
        if (secDayCount === 0) {
          score += 1200;
        } else {
          score -= secDayCount * 200;
        }

        if (existingWaveCount === 0 && classObj.numericGrade >= 3 && slot.periodIndex > firstBreakIndex) {
          score += 350;
        }

        if (!task.hasFixedPeriod) {
          const rSet = sectionReservedFixedPeriods.get(`${classObj.id}_${sectionId}`);
          if (rSet?.has(slot.periodIndex)) {
            score -= 1200;
          }
        }

        score += ((slot.periodIndex + sectionIndex + orderIndex) % 7) * 0.01;

        if (score > bestScore) {
          bestScore = score;
          bestSlotIdx = sIdx;
          bestT1 = t1;
          bestT2 = chosenCand2 ? chosenCand2.teacher : null;
        }
      }
    }

    if (bestSlotIdx !== -1 && bestT1 && (!partner || bestT2)) {
      const chosenSlot = availableSlots.splice(bestSlotIdx, 1)[0];
      const sKey = `${classObj.id}_${sectionId}_${chosenSlot.day}_${chosenSlot.periodIndex}`;
      const slotEntries: TimetableEntry[] = [];

      const e1: TimetableEntry = {
        id: nextEntryId('gen-rel', classObj.id, sectionId, chosenSlot.day, chosenSlot.periodIndex),
        classId: classObj.id,
        sectionId,
        day: chosenSlot.day,
        periodIndex: chosenSlot.periodIndex,
        subjectId: primary.subjectId,
        teacherId: bestT1.id,
        room: resolveRoom(primary, room),
      };
      resultEntries.push(e1);
      slotEntries.push(e1);
      trackTeacherPlacement(e1);
      subjectDayCount.set(
        `${primary.subjectId}_${chosenSlot.day}`,
        (subjectDayCount.get(`${primary.subjectId}_${chosenSlot.day}`) || 0) + 1
      );
      totalAssigned++;

      if (partner && bestT2) {
        const e2: TimetableEntry = {
          id: nextEntryId('gen-hin', classObj.id, sectionId, chosenSlot.day, chosenSlot.periodIndex),
          classId: classObj.id,
          sectionId,
          day: chosenSlot.day,
          periodIndex: chosenSlot.periodIndex,
          subjectId: partner.subjectId,
          teacherId: bestT2.id,
          room: resolveRoom(partner, room),
        };
        resultEntries.push(e2);
        slotEntries.push(e2);
        trackTeacherPlacement(e2);
        subjectDayCount.set(
          `${partner.subjectId}_${chosenSlot.day}`,
          (subjectDayCount.get(`${partner.subjectId}_${chosenSlot.day}`) || 0) + 1
        );
        totalAssigned++;
      }

      sectionCtx.dayCount.set(
        chosenSlot.day,
        (sectionCtx.dayCount.get(chosenSlot.day) || 0) + (partner && bestT2 ? 2 : 1)
      );
      sectionBookings.set(sKey, slotEntries);
      return true;
    }

    return false;
  };

  const deferredReligionTasks: ScheduledItemTask[] = [];
  for (const rTask of religionTasks) {
    if (!assignReligionWaveTask(rTask, true)) {
      deferredReligionTasks.push(rTask);
    }
  }
  for (const rTask of deferredReligionTasks) {
    if (!assignReligionWaveTask(rTask, false)) {
      kg10Tasks.unshift(rTask);
    }
  }

  // Merge under-filled Room 307 waves right after Pass 1B so Hindu teacher stays compact & <= daily/peak target
  for (let wRound = 0; wRound < 8; wRound++) {
    let mergedAnyWave = false;
    for (const teacher of teachers) {
      if (!hinduTeacherIdSet.has(teacher.id)) continue;
      const tMaxDaily = getTeacherDailyMax(teacher, settings);
      const dayLoads = workingDays.map(d => ({ d, c: teacherDayLoad.get(`${teacher.id}_${d}`) || 0 }));
      const peakLoad = Math.max(0, ...dayLoads.map(x => x.c));
      const overDays = dayLoads
        .filter(x => x.c > tMaxDaily)
        .sort((a, b) => b.c - a.c)
        .map(x => x.d);
      if (overDays.length === 0) continue;

      for (const dayOver of overDays) {
        const curDayOverLoad = teacherDayLoad.get(`${teacher.id}_${dayOver}`) || 0;
        if (curDayOverLoad <= tMaxDaily) break;
        const hinduOnDay = resultEntries.filter(
          e =>
            e.teacherId === teacher.id &&
            e.day === dayOver &&
            isHinduReligionSubject(e.subjectId, subjects) &&
            isHinduReligionRoom(e.room, settings)
        );
        // Prefer solo 1-section slots first so moving 1 section immediately drops dayLoad by 1
        hinduOnDay.sort((a, b) => {
          const ca = religionSlotSections.get(`${a.day}_${a.periodIndex}`)?.size || 0;
          const cb = religionSlotSections.get(`${b.day}_${b.periodIndex}`)?.size || 0;
          return ca - cb;
        });

        for (const hEntry of hinduOnDay) {
          if ((teacherDayLoad.get(`${teacher.id}_${dayOver}`) || 0) <= tMaxDaily) break;
          const oldDp = `${hEntry.day}_${hEntry.periodIndex}`;
          if ((religionSlotSections.get(oldDp)?.size || 0) > 1) continue;

          const secCtx = sectionContextMap.get(`${hEntry.classId}_${hEntry.sectionId}`);
          if (!secCtx) continue;
          const oldSlotKey = `${hEntry.classId}_${hEntry.sectionId}_${hEntry.day}_${hEntry.periodIndex}`;
          const slotEntries = [...(sectionBookings.get(oldSlotKey) || [])];
          if (slotEntries.length === 0) continue;

          // Phase A: Open slot in secCtx (either joining existing wave OR moving to < tMaxDaily / < curDayOverLoad - 1 day)
          const destSlotIdx = secCtx.availableSlots.findIndex(slot => {
            if (slot.day === dayOver) return false;
            const destDp = `${slot.day}_${slot.periodIndex}`;
            const relSize = religionSlotSections.get(destDp)?.size || 0;
            const tAlreadyInDest = teacherSlotEntries.has(`${teacher.id}_${destDp}`);
            const tDestLoad = teacherDayLoad.get(`${teacher.id}_${slot.day}`) || 0;
            if (tAlreadyInDest) {
              if (relSize >= maxRelConcurrent) return false;
            } else {
              if (relSize >= maxRelConcurrent) return false;
              const allowedDest = tDestLoad < tMaxDaily || (curDayOverLoad >= tMaxDaily + 2 && tDestLoad <= curDayOverLoad - 2);
              if (!allowedDest) return false;
            }
            return slotEntries.every(se => {
              if (!isPeriodAllowedForSubject(se.classId, se.sectionId, se.subjectId, slot.periodIndex)) return false;
              if (wouldViolateSubjectDailyLimit(secCtx, se.subjectId, slot.day, dayOver)) return false;
              if (isSubjectDedicatedRoomConflict(se.subjectId, slot.day, slot.periodIndex, se.room, se.classId, se.sectionId)) return false;
              if (isHinduReligionSubject(se.subjectId, subjects)) {
                const otherHin = resultEntries.find(
                  o => o.day === slot.day && o.periodIndex === slot.periodIndex && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                );
                if (otherHin && otherHin.teacherId !== se.teacherId) return false;
              }
              return canTeacherMoveToSlot(se.teacherId, slot.day, slot.periodIndex, dayOver, !tAlreadyInDest && tDestLoad >= tMaxDaily ? false : !tAlreadyInDest, se.subjectId, se.room, se.periodIndex);
            });
          });

          if (destSlotIdx !== -1) {
            const destSlot = secCtx.availableSlots.splice(destSlotIdx, 1)[0];
            const oldPeriod = hEntry.periodIndex;
            for (const se of slotEntries) {
              updateTeacherAndSubjectCountsOnMove(se, secCtx, dayOver, oldPeriod, destSlot.day, destSlot.periodIndex);
            }
            sectionBookings.delete(oldSlotKey);
            sectionBookings.set(`${hEntry.classId}_${hEntry.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, slotEntries);
            secCtx.availableSlots.push({ day: dayOver, periodIndex: oldPeriod });
            mergedAnyWave = true;
            break;
          }

          // Phase B: Swap 1-section religion slot with a single non-religion peer in secCtx sitting at an existing < maxRelConcurrent Room 307 wave (0 daily load cost for Tapash!)
          const oldPeriod = hEntry.periodIndex;
          const wavePeers = resultEntries.filter(peer => {
            if (peer.classId !== hEntry.classId || peer.sectionId !== hEntry.sectionId) return false;
            if (peer.day === dayOver || isReligionSubject(peer.subjectId, subjects)) return false;
            const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
            if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;

            const destDp = `${peer.day}_${peer.periodIndex}`;
            const relSize = religionSlotSections.get(destDp)?.size || 0;
            const tAlreadyInDest = teacherSlotEntries.has(`${teacher.id}_${destDp}`);
            const tDestLoad = teacherDayLoad.get(`${teacher.id}_${peer.day}`) || 0;
            if (relSize >= maxRelConcurrent) return false;
            if (!tAlreadyInDest) {
              const allowedDest = tDestLoad < tMaxDaily || (curDayOverLoad >= tMaxDaily + 2 && tDestLoad <= curDayOverLoad - 2);
              if (!allowedDest) return false;
            }

            const relOk = slotEntries.every(se => {
              if (!isPeriodAllowedForSubject(se.classId, se.sectionId, se.subjectId, peer.periodIndex)) return false;
              if (wouldViolateSubjectDailyLimit(secCtx, se.subjectId, peer.day, dayOver)) return false;
              if (isSubjectDedicatedRoomConflict(se.subjectId, peer.day, peer.periodIndex, se.room, se.classId, se.sectionId)) return false;
              if (isHinduReligionSubject(se.subjectId, subjects)) {
                const otherHin = resultEntries.find(
                  o => o.day === peer.day && o.periodIndex === peer.periodIndex && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                );
                if (otherHin && otherHin.teacherId !== se.teacherId) return false;
              }
              return canTeacherMoveToSlot(se.teacherId, peer.day, peer.periodIndex, dayOver, !tAlreadyInDest, se.subjectId, se.room, se.periodIndex);
            });
            if (!relOk) return false;

            if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldPeriod)) return false;
            if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
            if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, oldPeriod, peer.room, peer.classId, peer.sectionId)) return false;
            return canTeacherMoveToSlot(peer.teacherId, dayOver, oldPeriod, peer.day, true, peer.subjectId, peer.room, peer.periodIndex);
          });

          // Prefer merging into existing Room 307 wave first
          wavePeers.sort((a, b) => {
            const inA = teacherSlotEntries.has(`${teacher.id}_${a.day}_${a.periodIndex}`) ? 1 : 0;
            const inB = teacherSlotEntries.has(`${teacher.id}_${b.day}_${b.periodIndex}`) ? 1 : 0;
            if (inA !== inB) return inB - inA;
            return (teacherDayLoad.get(`${teacher.id}_${a.day}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${b.day}`) || 0);
          });

          if (wavePeers.length > 0 && peakLoad > tMaxDaily) {
            const swapPeer = wavePeers[0];
            const pDay = swapPeer.day;
            const pPeriod = swapPeer.periodIndex;
            const peerKey = `${swapPeer.classId}_${swapPeer.sectionId}_${pDay}_${pPeriod}`;
            for (const se of slotEntries) {
              updateTeacherAndSubjectCountsOnMove(se, secCtx, dayOver, oldPeriod, pDay, pPeriod);
            }
            updateTeacherAndSubjectCountsOnMove(swapPeer, secCtx, pDay, pPeriod, dayOver, oldPeriod);
            sectionBookings.set(oldSlotKey, [swapPeer]);
            sectionBookings.set(peerKey, slotEntries);
            mergedAnyWave = true;
            break;
          }
        }
      }
    }
    if (!mergedAnyWave) break;
  }

  // ===========================================================================
  // PASS 2: Schedule Fixed-Period & Dedicated-Teacher KG-10 Tasks First
  // ===========================================================================
  const remainingTasks: ScheduledItemTask[] = [];
  for (const task of kg10Tasks) {
    if (task.hasFixedPeriod || task.hasDedicated) {
      const status = assignTask(task, !task.hasDedicated, true);
      if (status !== 'assigned') {
        remainingTasks.push(task);
      }
    } else {
      remainingTasks.push(task);
    }
  }

  // ===========================================================================
  // PASS 3: Schedule Remaining Open / Deferred Tasks (Multi-Round Swaps,
  //         Strictly Refusing Wrong-Teacher Substitution for Dedicated Tasks)
  // ===========================================================================
  let retryQueue = [...remainingTasks];
  for (let round = 0; round < 6 && retryQueue.length > 0; round++) {
    const nextRetryQueue: ScheduledItemTask[] = [];
    // Strict daily-limit adherence on rounds 0-2; allow relaxed daily-cap swaps ONLY on final passes (rounds 3-5)
    const allowRelaxedDaily = round >= 3;
    const allowBlockerRelocOnSwap = round >= 1;
    let progressed = false;

    for (const task of retryQueue) {
      const allCands = getCandidatesWithTiers(
        task.pairItem.primary.subjectId,
        task.sectionCtx.classObj.id,
        task.sectionCtx.sectionId,
        task.pairItem.primary.preferredTeacherId
      );

      const allowedCands = task.hasPrimaryDedicated
        ? allCands.filter(c => c.tier <= 2)
        : allCands;

      if (
        tryIntraSectionSwap(
          task.sectionCtx,
          task.pairItem,
          allowedCands,
          task.hasPartnerDedicated,
          allowBlockerRelocOnSwap,
          allowRelaxedDaily
        )
      ) {
        progressed = true;
        continue;
      }
      if (
        tryCrossSectionRelocation(
          task.sectionCtx,
          task.pairItem,
          allowedCands,
          task.hasPartnerDedicated,
          allowRelaxedDaily
        )
      ) {
        progressed = true;
        continue;
      }
      if (
        tryTwoStepIntraSectionSwap(
          task.sectionCtx,
          task.pairItem,
          allowedCands,
          task.hasPartnerDedicated,
          allowRelaxedDaily,
          allowBlockerRelocOnSwap
        )
      ) {
        progressed = true;
        continue;
      }

      // Direct placement with open-pool fallback ONLY for tasks without dedicated locks
      const status = assignTask(task, true, !allowRelaxedDaily);
      if (status === 'assigned') {
        progressed = true;
        continue;
      }

      nextRetryQueue.push(task);
    }
    retryQueue = nextRetryQueue;
    if (!progressed && round >= 3) break;
  }

  // Pass 3C: Deep Rescue for any stubborn unresolved tasks (e.g., relocating teacher's daily load on a missing day or multi-section swaps)
  if (retryQueue.length > 0) {
    const finalUnresolved: ScheduledItemTask[] = [];
    for (const task of retryQueue) {
      const { sectionCtx, pairItem, hasPrimaryDedicated, hasPartnerDedicated } = task;
      const allCands = getCandidatesWithTiers(
        pairItem.primary.subjectId,
        sectionCtx.classObj.id,
        sectionCtx.sectionId,
        pairItem.primary.preferredTeacherId
      );
      const allowedCands = hasPrimaryDedicated ? allCands.filter(c => c.tier <= 2) : allCands;

      // Try freeing teacher daily capacity on any missing day of sectionCtx by moving/swapping one of t1's entries elsewhere
      for (const cand of allowedCands) {
        const t1 = cand.teacher;
        const tMaxD = getTeacherDailyMax(t1, settings);
        const underDaysT1 = workingDays.filter(d => (teacherDayLoad.get(`${t1.id}_${d}`) || 0) < tMaxD);
        if (underDaysT1.length === 0) continue;

        const missingDays = workingDays.filter(
          d =>
            !wouldViolatePairDailyLimit(sectionCtx, pairItem, d) &&
            (teacherDayLoad.get(`${t1.id}_${d}`) || 0) >= tMaxD
        );
        for (const mDay of missingDays) {
          const t1EntriesOnM = resultEntries.filter(
            e =>
              e.teacherId === t1.id &&
              e.day === mDay &&
              !isReligionSubject(e.subjectId, subjects) &&
              (sectionBookings.get(`${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`)?.length || 0) === 1
          );
          let freedOne = false;
          for (const eOther of t1EntriesOnM) {
            if (freedOne) break;
            const oSec = sectionContextMap.get(`${eOther.classId}_${eOther.sectionId}`);
            if (!oSec) continue;
            // Open slot on underDaysT1
            const oAvailIdx = oSec.availableSlots.findIndex(slot => {
              if (!underDaysT1.includes(slot.day)) return false;
              if (!isPeriodAllowedForSubject(eOther.classId, eOther.sectionId, eOther.subjectId, slot.periodIndex)) return false;
              if (wouldViolateSubjectDailyLimit(oSec, eOther.subjectId, slot.day, mDay)) return false;
              if (isSubjectDedicatedRoomConflict(eOther.subjectId, slot.day, slot.periodIndex, eOther.room, eOther.classId, eOther.sectionId)) return false;
              return canTeacherMoveToSlot(t1.id, slot.day, slot.periodIndex, mDay, true, eOther.subjectId, eOther.room, eOther.periodIndex);
            });
            if (oAvailIdx !== -1) {
              const destSlot = oSec.availableSlots.splice(oAvailIdx, 1)[0];
              const oldP = eOther.periodIndex;
              updateTeacherAndSubjectCountsOnMove(eOther, oSec, mDay, oldP, destSlot.day, destSlot.periodIndex);
              sectionBookings.delete(`${eOther.classId}_${eOther.sectionId}_${mDay}_${oldP}`);
              sectionBookings.set(`${eOther.classId}_${eOther.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, [eOther]);
              oSec.availableSlots.push({ day: mDay, periodIndex: oldP });
              freedOne = true;
              break;
            }
            // Swap eOther with a peer on underDaysT1 in oSec
            const swapPeer = resultEntries.find(p => {
              if (p.classId !== eOther.classId || p.sectionId !== eOther.sectionId) return false;
              if (!underDaysT1.includes(p.day) || p.subjectId === eOther.subjectId || p.teacherId === t1.id) return false;
              if (isReligionSubject(p.subjectId, subjects)) return false;
              const skP = `${p.classId}_${p.sectionId}_${p.day}_${p.periodIndex}`;
              if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
              if (!isPeriodAllowedForSubject(eOther.classId, eOther.sectionId, eOther.subjectId, p.periodIndex)) return false;
              if (!isPeriodAllowedForSubject(p.classId, p.sectionId, p.subjectId, eOther.periodIndex)) return false;
              if (wouldViolateSubjectDailyLimit(oSec, eOther.subjectId, p.day, mDay)) return false;
              if (wouldViolateSubjectDailyLimit(oSec, p.subjectId, mDay, p.day)) return false;
              if (isSubjectDedicatedRoomConflict(eOther.subjectId, p.day, p.periodIndex, eOther.room, eOther.classId, eOther.sectionId)) return false;
              if (isSubjectDedicatedRoomConflict(p.subjectId, mDay, eOther.periodIndex, p.room, p.classId, p.sectionId)) return false;
              return (
                canTeacherMoveToSlot(t1.id, p.day, p.periodIndex, mDay, true, eOther.subjectId, eOther.room, eOther.periodIndex) &&
                canTeacherMoveToSlot(p.teacherId, mDay, eOther.periodIndex, p.day, true, p.subjectId, p.room, p.periodIndex)
              );
            });
            if (swapPeer) {
              swapTwoEntriesInSection(oSec, eOther, swapPeer);
              freedOne = true;
              break;
            }
          }
        }
      }

      if (
        assignTask(task, !task.hasDedicated, true) === 'assigned' ||
        tryIntraSectionSwap(sectionCtx, pairItem, allowedCands, hasPartnerDedicated, true, false) ||
        tryCrossSectionRelocation(sectionCtx, pairItem, allowedCands, hasPartnerDedicated, false) ||
        tryTwoStepIntraSectionSwap(sectionCtx, pairItem, allowedCands, hasPartnerDedicated, false, true) ||
        tryIntraSectionSwap(sectionCtx, pairItem, allowedCands, hasPartnerDedicated, true, true) ||
        tryCrossSectionRelocation(sectionCtx, pairItem, allowedCands, hasPartnerDedicated, true) ||
        tryTwoStepIntraSectionSwap(sectionCtx, pairItem, allowedCands, hasPartnerDedicated, true, true) ||
        assignTask(task, true, false) === 'assigned'
      ) {
        continue;
      }

      finalUnresolved.push(task);
    }
    retryQueue = finalUnresolved;
  }

  for (const unresolvedTask of retryQueue) {
    totalUnassigned += unresolvedTask.pairItem.partner ? 2 : 1;
  }

  // ===========================================================================
  // PASS 4: Zero-Day Repair Pass (Ensures no active weekday is left completely empty
  // like Tuesday in KG when another weekday in the same section has >= 2 classes)
  // ===========================================================================
  sectionContextMap.forEach(secCtx => {
    const { classObj, sectionId, availableSlots, dayCount, subjectDayCount } = secCtx;
    if (availableSlots.length === 0) return;

    const emptyDays = workingDays.filter(
      d => (dayCount.get(d) || 0) === 0 && availableSlots.some(s => s.day === d)
    );
    if (emptyDays.length === 0) return;

    for (const emptyDay of emptyDays) {
      const emptyDaySlotIndices = availableSlots
        .map((s, idx) => ({ s, idx }))
        .filter(item => item.s.day === emptyDay);
      if (emptyDaySlotIndices.length === 0) continue;

      // Collect section entries on days that currently have >= 2 single-slot classes, richest day first
      const donorCandidates = resultEntries
        .filter(e => {
          if (e.classId !== classObj.id || e.sectionId !== sectionId) return false;
          if (isReligionSubject(e.subjectId, subjects)) return false;
          if ((dayCount.get(e.day) || 0) < 2) return false;
          const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
          return (sectionBookings.get(sk)?.length || 0) === 1;
        })
        .sort((a, b) => (dayCount.get(b.day) || 0) - (dayCount.get(a.day) || 0));

      let moved = false;
      for (const donorEntry of donorCandidates) {
        if (moved) break;
        const t = donorEntry.teacherId ? teacherMap.get(donorEntry.teacherId) : undefined;
        const tWeekLoad = t ? teacherWeekLoad.get(t.id) || 0 : 0;

        for (const { s: targetSlot, idx: availIdx } of emptyDaySlotIndices) {
          if (!isPeriodAllowedForSubject(donorEntry.classId, donorEntry.sectionId, donorEntry.subjectId, targetSlot.periodIndex)) {
            continue;
          }
          if (wouldViolateSubjectDailyLimit(secCtx, donorEntry.subjectId, targetSlot.day, donorEntry.day)) {
            continue;
          }
          if (
            isSubjectDedicatedRoomConflict(
              donorEntry.subjectId,
              targetSlot.day,
              targetSlot.periodIndex,
              donorEntry.room,
              donorEntry.classId,
              donorEntry.sectionId
            )
          ) {
            continue;
          }
          if (donorEntry.teacherId) {
            if (
              isTeacherSlotBusyFor(
                donorEntry.teacherId,
                donorEntry.subjectId,
                targetSlot.day,
                targetSlot.periodIndex,
                donorEntry.room
              )
            ) {
              continue;
            }
            if (isTeacherBlockedAtSlot(t, targetSlot.day, targetSlot.periodIndex)) {
              continue;
            }
            const tMaxDaily = t ? getTeacherDailyMax(t, settings) : DEFAULT_DAILY_MAX_PERIODS;
            const targetDayBusy = teacherSlotEntries.has(`${donorEntry.teacherId}_${targetSlot.day}_${targetSlot.periodIndex}`);
            const targetDayLoad = teacherDayLoad.get(`${donorEntry.teacherId}_${targetSlot.day}`) || 0;
            if (targetSlot.day !== donorEntry.day && !targetDayBusy && targetDayLoad >= tMaxDaily) {
              continue;
            }
            if (t && !blockTeacherIdSet.has(t.id) && targetDayLoad === 0) {
              if (teacherPreferredOffDay.get(t.id) === targetSlot.day) {
                continue;
              }
              const oldDayLoad = teacherDayLoad.get(`${t.id}_${donorEntry.day}`) || 0;
              const activeAfter = getTeacherActiveDaysCount(t.id) - (oldDayLoad <= 1 ? 1 : 0) + 1;
              if (activeAfter > getTeacherMaxWorkingDays(t, settings)) {
                continue;
              }
            }
            if (getMaxConsecutiveRunWith(donorEntry.teacherId, targetSlot.day, targetSlot.periodIndex) >= 4) {
              continue;
            }
            if (specialPacedTeacherIdSet.has(donorEntry.teacherId)) {
              const runLimit = tWeekLoad >= 20 ? 4 : 3;
              if (getMaxConsecutiveRunWith(donorEntry.teacherId, targetSlot.day, targetSlot.periodIndex) >= runLimit) {
                continue;
              }
            }
          }

          // Move donorEntry from donorEntry.day -> targetSlot.day atomically
          const oldDay = donorEntry.day;
          const oldPeriod = donorEntry.periodIndex;
          const oldSlotKey = `${classObj.id}_${sectionId}_${oldDay}_${oldPeriod}`;

          availableSlots.splice(availIdx, 1);
          availableSlots.push({ day: oldDay, periodIndex: oldPeriod });

          untrackTeacherPlacement(donorEntry);
          donorEntry.day = targetSlot.day;
          donorEntry.periodIndex = targetSlot.periodIndex;
          trackTeacherPlacement(donorEntry);

          subjectDayCount.set(
            `${donorEntry.subjectId}_${oldDay}`,
            Math.max(0, (subjectDayCount.get(`${donorEntry.subjectId}_${oldDay}`) || 1) - 1)
          );
          subjectDayCount.set(
            `${donorEntry.subjectId}_${targetSlot.day}`,
            (subjectDayCount.get(`${donorEntry.subjectId}_${targetSlot.day}`) || 0) + 1
          );
          dayCount.set(oldDay, Math.max(0, (dayCount.get(oldDay) || 1) - 1));
          dayCount.set(targetSlot.day, (dayCount.get(targetSlot.day) || 0) + 1);

          sectionBookings.delete(oldSlotKey);
          sectionBookings.set(
            `${classObj.id}_${sectionId}_${targetSlot.day}_${targetSlot.periodIndex}`,
            [donorEntry]
          );

          moved = true;
          break;
        }
      }
    }
  });

  // Helper: Free 1 daily slot for a peer teacher on `dayToFree` so they can accept a swap onto `dayToFree` without exceeding daily limit
  const tryFreeOneDaySlotForTeacher = (targetTeacher: Teacher, dayToFree: DayOfWeek): boolean => {
    const tMaxD = getTeacherDailyMax(targetTeacher, settings);
    if ((teacherDayLoad.get(`${targetTeacher.id}_${dayToFree}`) || 0) < tMaxD) return true;
    const altDays = workingDays
      .filter(d => d !== dayToFree && (teacherDayLoad.get(`${targetTeacher.id}_${d}`) || 0) > 0 && (teacherDayLoad.get(`${targetTeacher.id}_${d}`) || 0) < tMaxD)
      .sort((a, b) => (teacherDayLoad.get(`${targetTeacher.id}_${a}`) || 0) - (teacherDayLoad.get(`${targetTeacher.id}_${b}`) || 0));
    if (altDays.length === 0) return false;

    const entriesOnDay = resultEntries.filter(e => {
      if (e.teacherId !== targetTeacher.id || e.day !== dayToFree) return false;
      if (isReligionSubject(e.subjectId, subjects)) return false;
      const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
      return (sectionBookings.get(sk)?.length || 0) === 1;
    });

    for (const be of entriesOnDay) {
      const beSecCtx = sectionContextMap.get(`${be.classId}_${be.sectionId}`);
      if (!beSecCtx) continue;
      for (const altDay of altDays) {
        const openIdx = beSecCtx.availableSlots.findIndex(slot => {
          if (slot.day !== altDay) return false;
          if (!isPeriodAllowedForSubject(be.classId, be.sectionId, be.subjectId, slot.periodIndex)) return false;
          if (wouldViolateSubjectDailyLimit(beSecCtx, be.subjectId, altDay, dayToFree)) return false;
          if (isSubjectDedicatedRoomConflict(be.subjectId, altDay, slot.periodIndex, be.room, be.classId, be.sectionId)) return false;
          return canTeacherMoveToSlot(targetTeacher.id, altDay, slot.periodIndex, dayToFree, true, be.subjectId, be.room, be.periodIndex);
        });
        if (openIdx !== -1) {
          const destSlot = beSecCtx.availableSlots.splice(openIdx, 1)[0];
          const oldP = be.periodIndex;
          updateTeacherAndSubjectCountsOnMove(be, beSecCtx, dayToFree, oldP, destSlot.day, destSlot.periodIndex);
          sectionBookings.delete(`${be.classId}_${be.sectionId}_${dayToFree}_${oldP}`);
          sectionBookings.set(`${be.classId}_${be.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, [be]);
          beSecCtx.availableSlots.push({ day: dayToFree, periodIndex: oldP });
          return true;
        }

        const peer = resultEntries.find(bp => {
          if (bp.classId !== be.classId || bp.sectionId !== be.sectionId) return false;
          if (bp.day !== altDay || bp.subjectId === be.subjectId || bp.teacherId === targetTeacher.id) return false;
          if (isReligionSubject(bp.subjectId, subjects)) return false;
          const skP = `${bp.classId}_${bp.sectionId}_${bp.day}_${bp.periodIndex}`;
          if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
          if (!isPeriodAllowedForSubject(be.classId, be.sectionId, be.subjectId, bp.periodIndex)) return false;
          if (!isPeriodAllowedForSubject(bp.classId, bp.sectionId, bp.subjectId, be.periodIndex)) return false;
          if (wouldViolateSubjectDailyLimit(beSecCtx, be.subjectId, altDay, dayToFree)) return false;
          if (wouldViolateSubjectDailyLimit(beSecCtx, bp.subjectId, dayToFree, altDay)) return false;
          if (isSubjectDedicatedRoomConflict(be.subjectId, altDay, bp.periodIndex, be.room, be.classId, be.sectionId)) return false;
          if (isSubjectDedicatedRoomConflict(bp.subjectId, dayToFree, be.periodIndex, bp.room, bp.classId, bp.sectionId)) return false;
          return (
            canTeacherMoveToSlot(targetTeacher.id, altDay, bp.periodIndex, dayToFree, true, be.subjectId, be.room, be.periodIndex) &&
            canTeacherMoveToSlot(bp.teacherId, dayToFree, be.periodIndex, altDay, true, bp.subjectId, bp.room, bp.periodIndex)
          );
        });
        if (peer) {
          swapTwoEntriesInSection(beSecCtx, be, peer);
          return true;
        }
      }
    }
    return false;
  };

  // ===========================================================================
  // PASS 5: Teacher Daily Limit Rebalancing Pass
  //         Moves or swaps single entries from overloaded days (> maxDaily)
  //         to under-loaded days (< maxDaily) while keeping every rule intact.
  // ===========================================================================
  for (let rebalanceRound = 0; rebalanceRound < 6; rebalanceRound++) {
    let rebalancedAny = false;

    for (const teacher of teachers) {
      const maxDaily = getTeacherDailyMax(teacher, settings);

      for (let step = 0; step < 12; step++) {
        const overDays = workingDays
          .filter(d => (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) > maxDaily)
          .sort((a, b) => (teacherDayLoad.get(`${teacher.id}_${b}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${a}`) || 0));
        const activeDaysNow = getTeacherActiveDaysCount(teacher.id);
        const maxWorkDays = getTeacherMaxWorkingDays(teacher, settings);
        const estTeacherLoad = dedicatedLoadEstimate.get(teacher.id) || (teacherWeekLoad.get(teacher.id) || 0);
        const needsExtraDaysByCap = estTeacherLoad > maxWorkDays * maxDaily;
        const canOpenNewDayInPass5 =
          blockTeacherIdSet.has(teacher.id) || activeDaysNow < maxWorkDays || needsExtraDaysByCap;
        const activeUnderDays = workingDays
          .filter(d => {
            const load = teacherDayLoad.get(`${teacher.id}_${d}`) || 0;
            return load > 0 && load < maxDaily;
          })
          .sort((a, b) => (teacherDayLoad.get(`${teacher.id}_${a}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${b}`) || 0));
        const idleUnderDays = canOpenNewDayInPass5
          ? workingDays
              .filter(d => (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) === 0 && teacherPreferredOffDay.get(teacher.id) !== d)
              .sort((a, b) => a.localeCompare(b))
          : [];
        const underDays = activeUnderDays.length > 0 ? [...activeUnderDays, ...idleUnderDays] : idleUnderDays;

        if (overDays.length === 0) break;

        let movedThisStep = false;

        for (const dayOver of overDays) {
          if (movedThisStep) break;
          const overEntries = resultEntries.filter(e => {
            if (e.teacherId !== teacher.id || e.day !== dayOver) return false;
            if (isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)) {
              return false;
            }
            const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
            return (sectionBookings.get(sk)?.length || 0) === 1;
          });

          // Strategy 1: Move directly to an open section slot on an under-loaded day
          if (underDays.length > 0) {
            for (const entryOver of overEntries) {
              if (movedThisStep) break;
              const secCtx = sectionContextMap.get(`${entryOver.classId}_${entryOver.sectionId}`);
              if (!secCtx || secCtx.availableSlots.length === 0) continue;

              for (const dayUnder of underDays) {
                if ((teacherDayLoad.get(`${teacher.id}_${dayUnder}`) || 0) >= maxDaily) continue;
                const availIdx = secCtx.availableSlots.findIndex(slot => {
                  if (slot.day !== dayUnder) return false;
                  if (!isPeriodAllowedForSubject(entryOver.classId, entryOver.sectionId, entryOver.subjectId, slot.periodIndex)) {
                    return false;
                  }
                  if (wouldViolateSubjectDailyLimit(secCtx, entryOver.subjectId, slot.day, dayOver)) {
                    return false;
                  }
                  if (
                    isSubjectDedicatedRoomConflict(
                      entryOver.subjectId,
                      slot.day,
                      slot.periodIndex,
                      entryOver.room,
                      entryOver.classId,
                      entryOver.sectionId
                    )
                  ) {
                    return false;
                  }
                    return canTeacherMoveToSlot(
                      teacher.id,
                      slot.day,
                      slot.periodIndex,
                      dayOver,
                      true,
                      entryOver.subjectId,
                      entryOver.room,
                      entryOver.periodIndex
                    );
                  });

                  if (availIdx !== -1) {
                    const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
                    const oldPeriod = entryOver.periodIndex;
                    const oldSlotKey = `${entryOver.classId}_${entryOver.sectionId}_${dayOver}_${oldPeriod}`;
                    updateTeacherAndSubjectCountsOnMove(entryOver, secCtx, dayOver, oldPeriod, destSlot.day, destSlot.periodIndex);
                    sectionBookings.delete(oldSlotKey);
                    sectionBookings.set(
                      `${entryOver.classId}_${entryOver.sectionId}_${destSlot.day}_${destSlot.periodIndex}`,
                      [entryOver]
                    );
                    secCtx.availableSlots.push({ day: dayOver, periodIndex: oldPeriod });
                    movedThisStep = true;
                    rebalancedAny = true;
                    break;
                  }
                }
              }
            }

            // Strategy 2: Swap entryOver with another teacher's single entry in same section on dayUnder
            if (!movedThisStep && underDays.length > 0) {
              for (const entryOver of overEntries) {
                if (movedThisStep) break;
                const secCtx = sectionContextMap.get(`${entryOver.classId}_${entryOver.sectionId}`);
                if (!secCtx) continue;

                const peerCandidates = resultEntries.filter(peer => {
                  if (peer.classId !== entryOver.classId || peer.sectionId !== entryOver.sectionId) return false;
                  if (peer.subjectId === entryOver.subjectId) return false;
                  if (peer.teacherId === teacher.id) return false;
                  if (isReligionSubject(peer.subjectId, subjects)) return false;
                  if (!underDays.includes(peer.day)) return false;
                  if ((teacherDayLoad.get(`${teacher.id}_${peer.day}`) || 0) >= maxDaily) return false;
                  const sk = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                  return (sectionBookings.get(sk)?.length || 0) === 1;
                });

                for (const peerEntry of peerCandidates) {
                  if (
                    !isPeriodAllowedForSubject(entryOver.classId, entryOver.sectionId, entryOver.subjectId, peerEntry.periodIndex) ||
                    !isPeriodAllowedForSubject(peerEntry.classId, peerEntry.sectionId, peerEntry.subjectId, entryOver.periodIndex)
                  ) {
                    continue;
                  }
                  if (
                    wouldViolateSubjectDailyLimit(secCtx, entryOver.subjectId, peerEntry.day, entryOver.day) ||
                    wouldViolateSubjectDailyLimit(secCtx, peerEntry.subjectId, entryOver.day, peerEntry.day)
                  ) {
                    continue;
                  }
                  if (
                    isSubjectDedicatedRoomConflict(
                      entryOver.subjectId,
                      peerEntry.day,
                      peerEntry.periodIndex,
                      entryOver.room,
                      entryOver.classId,
                      entryOver.sectionId
                    ) ||
                    isSubjectDedicatedRoomConflict(
                      peerEntry.subjectId,
                      entryOver.day,
                      entryOver.periodIndex,
                      peerEntry.room,
                      peerEntry.classId,
                      peerEntry.sectionId
                    )
                  ) {
                    continue;
                  }
                  if (
                    !canTeacherMoveToSlot(
                      teacher.id,
                      peerEntry.day,
                      peerEntry.periodIndex,
                      entryOver.day,
                      true,
                      entryOver.subjectId,
                      entryOver.room,
                      entryOver.periodIndex
                    ) ||
                    !canTeacherMoveToSlot(
                      peerEntry.teacherId,
                      entryOver.day,
                      entryOver.periodIndex,
                      peerEntry.day,
                      true,
                      peerEntry.subjectId,
                      peerEntry.room,
                      peerEntry.periodIndex
                    )
                  ) {
                    continue;
                  }

                  swapTwoEntriesInSection(secCtx, entryOver, peerEntry);
                  movedThisStep = true;
                  rebalancedAny = true;
                  break;
                }
              }
            }

            // Strategy 3: 2-step intra-section chain swap when 1-step swap is blocked (e.g. same-day subject cap)
            if (!movedThisStep && underDays.length > 0) {
              for (const entryOver of overEntries) {
                if (movedThisStep) break;
                const secCtx = sectionContextMap.get(`${entryOver.classId}_${entryOver.sectionId}`);
                if (!secCtx) continue;
                const dDay = entryOver.day;
                const dPeriod = entryOver.periodIndex;

                const midPeers = resultEntries.filter(m => {
                  if (m.classId !== entryOver.classId || m.sectionId !== entryOver.sectionId) return false;
                  if (m.subjectId === entryOver.subjectId || !underDays.includes(m.day)) return false;
                  if (isReligionSubject(m.subjectId, subjects)) return false;
                  const skM = `${m.classId}_${m.sectionId}_${m.day}_${m.periodIndex}`;
                  if ((sectionBookings.get(skM)?.length || 0) !== 1) return false;
                  if (!isPeriodAllowedForSubject(entryOver.classId, entryOver.sectionId, entryOver.subjectId, m.periodIndex)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, entryOver.subjectId, m.day, dDay)) return false;
                  if (isSubjectDedicatedRoomConflict(entryOver.subjectId, m.day, m.periodIndex, entryOver.room, entryOver.classId, entryOver.sectionId)) return false;
                  return canTeacherMoveToSlot(teacher.id, m.day, m.periodIndex, dDay, true, entryOver.subjectId, entryOver.room, dPeriod);
                });

                for (const midPeer of midPeers) {
                  if (movedThisStep || !midPeer.teacherId) break;
                  const midTeacher = teacherMap.get(midPeer.teacherId);
                  if (!midTeacher) continue;
                  const mDay = midPeer.day;
                  if (wouldViolateSubjectDailyLimit(secCtx, midPeer.subjectId, dDay, mDay)) continue;
                  if ((teacherDayLoad.get(`${midTeacher.id}_${dDay}`) || 0) >= getTeacherDailyMax(midTeacher, settings)) {
                    continue;
                  }

                  const finalPeer = resultEntries.find(p => {
                    if (p.classId !== entryOver.classId || p.sectionId !== entryOver.sectionId) return false;
                    if (p.id === entryOver.id || p.id === midPeer.id || p.day !== dDay) return false;
                    if (p.subjectId === midPeer.subjectId || p.teacherId === teacher.id || p.teacherId === midTeacher.id) return false;
                    if (isReligionSubject(p.subjectId, subjects)) return false;
                    const skP = `${p.classId}_${p.sectionId}_${p.day}_${p.periodIndex}`;
                    if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                    if (!isPeriodAllowedForSubject(midPeer.classId, midPeer.sectionId, midPeer.subjectId, p.periodIndex)) return false;
                    if (isSubjectDedicatedRoomConflict(midPeer.subjectId, dDay, p.periodIndex, midPeer.room, midPeer.classId, midPeer.sectionId)) return false;
                    if (!canTeacherMoveToSlot(midTeacher.id, dDay, p.periodIndex, mDay, false, midPeer.subjectId, midPeer.room, midPeer.periodIndex)) return false;
                    if (!isPeriodAllowedForSubject(p.classId, p.sectionId, p.subjectId, dPeriod)) return false;
                    if (isSubjectDedicatedRoomConflict(p.subjectId, dDay, dPeriod, p.room, p.classId, p.sectionId)) return false;
                    if (p.teacherId && p.periodIndex !== dPeriod && !canTeacherMoveToSlot(p.teacherId, dDay, dPeriod, dDay, false, p.subjectId, p.room, p.periodIndex)) {
                      return false;
                    }
                    return true;
                  });

                  if (finalPeer) {
                    swapTwoEntriesInSection(secCtx, entryOver, finalPeer);
                    swapTwoEntriesInSection(secCtx, entryOver, midPeer);
                    movedThisStep = true;
                    rebalancedAny = true;
                    break;
                  }
                }
              }
            }

            // Strategy 3B: Swap with blocker relocation when a peer on underDays has its teacher busy at entryOver's slot
            if (!movedThisStep && underDays.length > 0) {
              for (const entryOver of overEntries) {
                if (movedThisStep) break;
                const secCtx = sectionContextMap.get(`${entryOver.classId}_${entryOver.sectionId}`);
                if (!secCtx) continue;
                const origDay = entryOver.day;
                const origPeriod = entryOver.periodIndex;

                const peerCandidates = resultEntries.filter(peer => {
                  if (peer.classId !== entryOver.classId || peer.sectionId !== entryOver.sectionId) return false;
                  if (peer.subjectId === entryOver.subjectId || peer.teacherId === teacher.id) return false;
                  if (isReligionSubject(peer.subjectId, subjects)) return false;
                  if (!underDays.includes(peer.day)) return false;
                  if ((teacherDayLoad.get(`${teacher.id}_${peer.day}`) || 0) >= maxDaily) return false;
                  const sk = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                  if ((sectionBookings.get(sk)?.length || 0) !== 1) return false;
                  if (!isPeriodAllowedForSubject(entryOver.classId, entryOver.sectionId, entryOver.subjectId, peer.periodIndex)) return false;
                  if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, origPeriod)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, entryOver.subjectId, peer.day, origDay)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, origDay, peer.day)) return false;
                  if (isSubjectDedicatedRoomConflict(entryOver.subjectId, peer.day, peer.periodIndex, entryOver.room, entryOver.classId, entryOver.sectionId)) return false;
                  if (isSubjectDedicatedRoomConflict(peer.subjectId, origDay, origPeriod, peer.room, peer.classId, peer.sectionId)) return false;
                  if (isTeacherBlockedAtSlot(teacher, peer.day, peer.periodIndex)) return false;
                  const pt = peer.teacherId ? teacherMap.get(peer.teacherId) : undefined;
                  if (pt && isTeacherBlockedAtSlot(pt, origDay, origPeriod)) return false;
                  if (pt && (teacherDayLoad.get(`${pt.id}_${origDay}`) || 0) >= getTeacherDailyMax(pt, settings)) return false;
                  return true;
                });

                for (const peer of peerCandidates) {
                  const pDay = peer.day;
                  const pPeriod = peer.periodIndex;
                  const pt = peer.teacherId ? teacherMap.get(peer.teacherId) : undefined;
                  if (teacherBookings.has(`${teacher.id}_${pDay}_${pPeriod}`)) {
                    tryRelocateTeacherBlockerAtSlot(teacher, pDay, pPeriod, false);
                  }
                  if (pt && teacherBookings.has(`${pt.id}_${origDay}_${origPeriod}`)) {
                    tryRelocateTeacherBlockerAtSlot(pt, origDay, origPeriod, false);
                  }
                  if (
                    entryOver.day === origDay &&
                    entryOver.periodIndex === origPeriod &&
                    peer.day === pDay &&
                    peer.periodIndex === pPeriod &&
                    canTeacherMoveToSlot(teacher.id, pDay, pPeriod, origDay, true, entryOver.subjectId, entryOver.room, origPeriod) &&
                    canTeacherMoveToSlot(peer.teacherId, origDay, origPeriod, pDay, true, peer.subjectId, peer.room, pPeriod) &&
                    !wouldViolateSubjectDailyLimit(secCtx, entryOver.subjectId, pDay, origDay) &&
                    !wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, origDay, pDay)
                  ) {
                    swapTwoEntriesInSection(secCtx, entryOver, peer);
                    movedThisStep = true;
                    rebalancedAny = true;
                    break;
                  }
                }
              }
            }

            // Strategy 4: Rebalance 2-entry non-religion paired slots (e.g. Class 9-10 HMT+AGR for Moazzem)
            if (!movedThisStep && underDays.length > 0) {
              const pairedKeys = new Set<string>();
              const overPairedSlots: TimetableEntry[][] = [];
              resultEntries.forEach(e => {
                if (e.teacherId !== teacher.id || e.day !== dayOver) return;
                if (isReligionSubject(e.subjectId, subjects)) return;
                const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
                if (pairedKeys.has(sk)) return;
                const slotList = sectionBookings.get(sk) || [];
                if (slotList.length === 2 && slotList.every(x => !isReligionSubject(x.subjectId, subjects))) {
                  pairedKeys.add(sk);
                  overPairedSlots.push([...slotList]);
                }
              });

              for (const pairList of overPairedSlots) {
                if (movedThisStep) break;
                const lead = pairList[0];
                const secCtx = sectionContextMap.get(`${lead.classId}_${lead.sectionId}`);
                if (!secCtx) continue;
                const oldPeriod = lead.periodIndex;
                const oldSlotKey = `${lead.classId}_${lead.sectionId}_${dayOver}_${oldPeriod}`;

                // 4A: Direct move of pair to an open slot on dayUnder
                for (const dayUnder of underDays) {
                  const availIdx = secCtx.availableSlots.findIndex(slot => {
                    if (slot.day !== dayUnder) return false;
                    return pairList.every(pe => {
                      if (!isPeriodAllowedForSubject(pe.classId, pe.sectionId, pe.subjectId, slot.periodIndex)) return false;
                      if (wouldViolateSubjectDailyLimit(secCtx, pe.subjectId, slot.day, dayOver)) return false;
                      if (isSubjectDedicatedRoomConflict(pe.subjectId, slot.day, slot.periodIndex, pe.room, pe.classId, pe.sectionId)) return false;
                      return canTeacherMoveToSlot(pe.teacherId, slot.day, slot.periodIndex, dayOver, true, pe.subjectId, pe.room, pe.periodIndex);
                    });
                  });
                  if (availIdx !== -1) {
                    const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
                    for (const pe of pairList) {
                      updateTeacherAndSubjectCountsOnMove(pe, secCtx, dayOver, oldPeriod, destSlot.day, destSlot.periodIndex);
                    }
                    sectionBookings.delete(oldSlotKey);
                    sectionBookings.set(`${lead.classId}_${lead.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, pairList);
                    secCtx.availableSlots.push({ day: dayOver, periodIndex: oldPeriod });
                    movedThisStep = true;
                    rebalancedAny = true;
                    break;
                  }
                }

                // 4B: Swap pair with a single non-religion entry on dayUnder inside the same section
                if (!movedThisStep) {
                  const singlePeer = resultEntries.find(peer => {
                    if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                    if (!underDays.includes(peer.day)) return false;
                    if (isReligionSubject(peer.subjectId, subjects)) return false;
                    if (pairList.some(pe => pe.subjectId === peer.subjectId || pe.teacherId === peer.teacherId)) return false;
                    const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                    if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;

                    const pairOk = pairList.every(pe => {
                      if (!isPeriodAllowedForSubject(pe.classId, pe.sectionId, pe.subjectId, peer.periodIndex)) return false;
                      if (wouldViolateSubjectDailyLimit(secCtx, pe.subjectId, peer.day, dayOver)) return false;
                      if (isSubjectDedicatedRoomConflict(pe.subjectId, peer.day, peer.periodIndex, pe.room, pe.classId, pe.sectionId)) return false;
                      return canTeacherMoveToSlot(pe.teacherId, peer.day, peer.periodIndex, dayOver, true, pe.subjectId, pe.room, pe.periodIndex);
                    });
                    if (!pairOk) return false;

                    if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldPeriod)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
                    if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, oldPeriod, peer.room, peer.classId, peer.sectionId)) return false;
                    return canTeacherMoveToSlot(peer.teacherId, dayOver, oldPeriod, peer.day, true, peer.subjectId, peer.room, peer.periodIndex);
                  });

                  if (singlePeer) {
                    const pDay = singlePeer.day;
                    const pPeriod = singlePeer.periodIndex;
                    const peerKey = `${singlePeer.classId}_${singlePeer.sectionId}_${pDay}_${pPeriod}`;
                    for (const pe of pairList) {
                      updateTeacherAndSubjectCountsOnMove(pe, secCtx, dayOver, oldPeriod, pDay, pPeriod);
                    }
                    updateTeacherAndSubjectCountsOnMove(singlePeer, secCtx, pDay, pPeriod, dayOver, oldPeriod);
                    sectionBookings.set(oldSlotKey, [singlePeer]);
                    sectionBookings.set(peerKey, pairList);
                    movedThisStep = true;
                    rebalancedAny = true;
                  }
                }
              }
            }

            // Strategy 5: Consolidate/shift Hindu Room 307 religion wave slots on dayOver (e.g. Tapash Sir)
            if (!movedThisStep) {
              const relOverSlots: TimetableEntry[][] = [];
              const seenRelKeys = new Set<string>();
              resultEntries.forEach(e => {
                if (e.teacherId !== teacher.id || e.day !== dayOver) return;
                if (!isHinduReligionSubject(e.subjectId, subjects) || !isHinduReligionRoom(e.room, settings)) return;
                const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
                if (seenRelKeys.has(sk)) return;
                seenRelKeys.add(sk);
                const list = sectionBookings.get(sk) || [];
                if (list.length > 0) relOverSlots.push([...list]);
              });
              relOverSlots.sort((a, b) => {
                const ca = religionSlotSections.get(`${a[0].day}_${a[0].periodIndex}`)?.size || 0;
                const cb = religionSlotSections.get(`${b[0].day}_${b[0].periodIndex}`)?.size || 0;
                return ca - cb;
              });

              for (const relList of relOverSlots) {
                if (movedThisStep) break;
                const lead = relList[0];
                const oldDp = `${lead.day}_${lead.periodIndex}`;
                if ((religionSlotSections.get(oldDp)?.size || 0) > 1) continue;
                const secCtx = sectionContextMap.get(`${lead.classId}_${lead.sectionId}`);
                if (!secCtx) continue;
                const oldPeriod = lead.periodIndex;
                const oldSlotKey = `${lead.classId}_${lead.sectionId}_${dayOver}_${oldPeriod}`;

                // 5A: Move religion slot to an existing Room 307 wave OR open slot on underDays
                const availDestIdx = secCtx.availableSlots.findIndex(slot => {
                  if (slot.day === dayOver) return false;
                  const destDp = `${slot.day}_${slot.periodIndex}`;
                  const relSize = religionSlotSections.get(destDp)?.size || 0;
                  if (relSize >= maxRelConcurrent) return false;
                  const tInDestWave = teacherSlotEntries.has(`${teacher.id}_${destDp}`);
                  const tDestDayLoad = teacherDayLoad.get(`${teacher.id}_${slot.day}`) || 0;
                  if (!tInDestWave && tDestDayLoad >= maxDaily) return false;
                  return relList.every(re => {
                    if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, slot.periodIndex)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, re.subjectId, slot.day, dayOver)) return false;
                    if (isSubjectDedicatedRoomConflict(re.subjectId, slot.day, slot.periodIndex, re.room, re.classId, re.sectionId)) return false;
                    if (isHinduReligionSubject(re.subjectId, subjects)) {
                      const otherHin = resultEntries.find(
                        o => o.day === slot.day && o.periodIndex === slot.periodIndex && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                      );
                      if (otherHin && otherHin.teacherId !== re.teacherId) return false;
                    }
                    return canTeacherMoveToSlot(re.teacherId, slot.day, slot.periodIndex, dayOver, !tInDestWave, re.subjectId, re.room, re.periodIndex);
                  });
                });

                if (availDestIdx !== -1) {
                  const destSlot = secCtx.availableSlots.splice(availDestIdx, 1)[0];
                  for (const re of relList) {
                    updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldPeriod, destSlot.day, destSlot.periodIndex);
                  }
                  sectionBookings.delete(oldSlotKey);
                  sectionBookings.set(`${lead.classId}_${lead.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, relList);
                  secCtx.availableSlots.push({ day: dayOver, periodIndex: oldPeriod });
                  movedThisStep = true;
                  rebalancedAny = true;
                  break;
                }

                // 5B: Swap religion slot with a single non-religion entry in secCtx sitting on an existing Room 307 wave slot or underDay
                const swapPeer = resultEntries.find(peer => {
                  if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                  if (peer.day === dayOver || isReligionSubject(peer.subjectId, subjects)) return false;
                  const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                  if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                  const destDp = `${peer.day}_${peer.periodIndex}`;
                  const relSize = religionSlotSections.get(destDp)?.size || 0;
                  if (relSize >= maxRelConcurrent) return false;
                  const tInDestWave = teacherSlotEntries.has(`${teacher.id}_${destDp}`);
                  const tDestDayLoad = teacherDayLoad.get(`${teacher.id}_${peer.day}`) || 0;
                  if (!tInDestWave && (!underDays.includes(peer.day) || tDestDayLoad >= maxDaily)) return false;

                  const relOk = relList.every(re => {
                    if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, peer.periodIndex)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, re.subjectId, peer.day, dayOver)) return false;
                    if (isSubjectDedicatedRoomConflict(re.subjectId, peer.day, peer.periodIndex, re.room, re.classId, re.sectionId)) return false;
                    if (isHinduReligionSubject(re.subjectId, subjects)) {
                      const otherHin = resultEntries.find(
                        o => o.day === peer.day && o.periodIndex === peer.periodIndex && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                      );
                      if (otherHin && otherHin.teacherId !== re.teacherId) return false;
                    }
                    return canTeacherMoveToSlot(re.teacherId, peer.day, peer.periodIndex, dayOver, !tInDestWave, re.subjectId, re.room, re.periodIndex);
                  });
                  if (!relOk) return false;

                  if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldPeriod)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
                  if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, oldPeriod, peer.room, peer.classId, peer.sectionId)) return false;
                  return canTeacherMoveToSlot(peer.teacherId, dayOver, oldPeriod, peer.day, true, peer.subjectId, peer.room, peer.periodIndex);
                });

                if (swapPeer) {
                  const pDay = swapPeer.day;
                  const pPeriod = swapPeer.periodIndex;
                  const peerKey = `${swapPeer.classId}_${swapPeer.sectionId}_${pDay}_${pPeriod}`;
                  for (const re of relList) {
                    updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldPeriod, pDay, pPeriod);
                  }
                  updateTeacherAndSubjectCountsOnMove(swapPeer, secCtx, pDay, pPeriod, dayOver, oldPeriod);
                  sectionBookings.set(oldSlotKey, [swapPeer]);
                  sectionBookings.set(peerKey, relList);
                  movedThisStep = true;
                  rebalancedAny = true;
                  break;
                }
              }
            }

            // Strategy 5B: Rebalance Islam / Paired (Islam + Hindu) Religion slots on dayOver (e.g. Karim / Rahim <= 4/day)
            if (!movedThisStep && underDays.length > 0) {
              const relOverSlots: TimetableEntry[][] = [];
              const seenRelKeys = new Set<string>();
              resultEntries.forEach(e => {
                if (e.teacherId !== teacher.id || e.day !== dayOver) return;
                if (!isReligionSubject(e.subjectId, subjects)) return;
                if (isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)) return;
                const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
                if (seenRelKeys.has(sk)) return;
                seenRelKeys.add(sk);
                const list = sectionBookings.get(sk) || [];
                if (list.length > 0) relOverSlots.push([...list]);
              });

              const canReligionPartnerMoveTo = (re: TimetableEntry, destDay: DayOfWeek, destPeriod: number, srcDay: DayOfWeek): boolean => {
                if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, destPeriod)) return false;
                if (wouldViolateSubjectDailyLimit(sectionContextMap.get(`${re.classId}_${re.sectionId}`)!, re.subjectId, destDay, srcDay)) return false;
                if (isSubjectDedicatedRoomConflict(re.subjectId, destDay, destPeriod, re.room, re.classId, re.sectionId)) return false;
                if (isHinduReligionSubject(re.subjectId, subjects)) {
                  const otherHin = resultEntries.find(
                    o => o.day === destDay && o.periodIndex === destPeriod && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                  );
                  if (otherHin && otherHin.teacherId !== re.teacherId) return false;
                }
                if (!re.teacherId) return true;
                if (re.teacherId === teacher.id) {
                  return canTeacherMoveToSlot(re.teacherId, destDay, destPeriod, srcDay, true, re.subjectId, re.room, re.periodIndex);
                }
                const pt = teacherMap.get(re.teacherId);
                if (!pt) return false;
                const destDp = `${destDay}_${destPeriod}`;
                const alreadyInWave = teacherSlotEntries.has(`${pt.id}_${destDp}`);
                const ptDestLoad = teacherDayLoad.get(`${pt.id}_${destDay}`) || 0;
                const ptMaxD = getTeacherDailyMax(pt, settings);
                const ptEstLoad = dedicatedLoadEstimate.get(pt.id) || (teacherWeekLoad.get(pt.id) || 0);
                // Never increase partner load above ptMaxD unless partner already mathematically requires 5/day, and never to 6+!
                const ptAllowedCap = ptEstLoad > getTeacherMaxWorkingDays(pt, settings) * ptMaxD ? ptMaxD + 1 : ptMaxD;
                if (!alreadyInWave && ptDestLoad >= ptAllowedCap) return false;
                // Do not open a disallowed extra working day for partner if feasible
                if (!alreadyInWave && ptDestLoad === 0 && !blockTeacherIdSet.has(pt.id)) {
                  const ptMaxW = getTeacherMaxWorkingDays(pt, settings);
                  if (ptEstLoad <= ptMaxW * ptMaxD && getTeacherActiveDaysCount(pt.id) >= ptMaxW) return false;
                }
                return canTeacherMoveToSlot(re.teacherId, destDay, destPeriod, srcDay, false, re.subjectId, re.room, re.periodIndex);
              };

              for (const relList of relOverSlots) {
                if (movedThisStep) break;
                const lead = relList[0];
                const secCtx = sectionContextMap.get(`${lead.classId}_${lead.sectionId}`);
                if (!secCtx) continue;
                const oldPeriod = lead.periodIndex;
                const oldSlotKey = `${lead.classId}_${lead.sectionId}_${dayOver}_${oldPeriod}`;

                // 5B-1: Open slot on underDays
                const availDestSlots = secCtx.availableSlots
                  .map((s, idx) => ({ s, idx }))
                  .filter(({ s: slot }) => {
                    if (!underDays.includes(slot.day)) return false;
                    if ((teacherDayLoad.get(`${teacher.id}_${slot.day}`) || 0) >= maxDaily) return false;
                    const destDp = `${slot.day}_${slot.periodIndex}`;
                    if ((religionSlotSections.get(destDp)?.size || 0) >= maxRelConcurrent) return false;
                    return relList.every(re => canReligionPartnerMoveTo(re, slot.day, slot.periodIndex, dayOver));
                  });
                // Prefer open slots where partner joins an existing wave or has lower load
                availDestSlots.sort((a, b) => {
                  const wA = religionSlotSections.get(`${a.s.day}_${a.s.periodIndex}`)?.size || 0;
                  const wB = religionSlotSections.get(`${b.s.day}_${b.s.periodIndex}`)?.size || 0;
                  return wB - wA;
                });

                if (availDestSlots.length > 0) {
                  const destSlot = secCtx.availableSlots.splice(availDestSlots[0].idx, 1)[0];
                  for (const re of relList) {
                    updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldPeriod, destSlot.day, destSlot.periodIndex);
                  }
                  sectionBookings.delete(oldSlotKey);
                  sectionBookings.set(`${lead.classId}_${lead.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, relList);
                  secCtx.availableSlots.push({ day: dayOver, periodIndex: oldPeriod });
                  movedThisStep = true;
                  rebalancedAny = true;
                  break;
                }

                // 5B-2: Swap with single non-religion peer on underDays (with optional blocker relocation & daily relief)
                const relSwapPeers = resultEntries.filter(peer => {
                  if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                  if (!underDays.includes(peer.day) || isReligionSubject(peer.subjectId, subjects)) return false;
                  if (peer.teacherId === teacher.id) return false;
                  const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                  if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                  if ((teacherDayLoad.get(`${teacher.id}_${peer.day}`) || 0) >= maxDaily) return false;
                  const destDp = `${peer.day}_${peer.periodIndex}`;
                  if ((religionSlotSections.get(destDp)?.size || 0) >= maxRelConcurrent) return false;

                  if (!relList.every(re => canReligionPartnerMoveTo(re, peer.day, peer.periodIndex, dayOver))) return false;
                  if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldPeriod)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
                  if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, oldPeriod, peer.room, peer.classId, peer.sectionId)) return false;
                  if (peer.teacherId) {
                    const bT = teacherMap.get(peer.teacherId);
                    if (!bT || isTeacherBlockedAtSlot(bT, dayOver, oldPeriod)) return false;
                  }
                  return true;
                });

                // Prefer swaps where Hindu partner joins existing wave AND bT is already free/<maxDaily on dayOver
                relSwapPeers.sort((a, b) => {
                  const hinPartner = relList.find(r => r.teacherId && r.teacherId !== teacher.id);
                  if (hinPartner?.teacherId) {
                    const inA = teacherSlotEntries.has(`${hinPartner.teacherId}_${a.day}_${a.periodIndex}`) ? 1 : 0;
                    const inB = teacherSlotEntries.has(`${hinPartner.teacherId}_${b.day}_${b.periodIndex}`) ? 1 : 0;
                    if (inA !== inB) return inB - inA;
                  }
                  const aBusy = a.teacherId && teacherBookings.has(`${a.teacherId}_${dayOver}_${oldPeriod}`) ? 1 : 0;
                  const bBusy = b.teacherId && teacherBookings.has(`${b.teacherId}_${dayOver}_${oldPeriod}`) ? 1 : 0;
                  if (aBusy !== bBusy) return aBusy - bBusy;
                  const aLoad = a.teacherId ? (teacherDayLoad.get(`${a.teacherId}_${dayOver}`) || 0) : 0;
                  const bLoad = b.teacherId ? (teacherDayLoad.get(`${b.teacherId}_${dayOver}`) || 0) : 0;
                  if (aLoad !== bLoad) return aLoad - bLoad;
                  return (teacherDayLoad.get(`${teacher.id}_${a.day}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${b.day}`) || 0);
                });

                for (const swapPeer of relSwapPeers) {
                  const pDay = swapPeer.day;
                  const pPeriod = swapPeer.periodIndex;
                  if (swapPeer.teacherId) {
                    const bT = teacherMap.get(swapPeer.teacherId);
                    if (bT && (teacherDayLoad.get(`${bT.id}_${dayOver}`) || 0) >= getTeacherDailyMax(bT, settings)) {
                      tryFreeOneDaySlotForTeacher(bT, dayOver);
                    }
                    if (bT && teacherBookings.has(`${bT.id}_${dayOver}_${oldPeriod}`)) {
                      tryRelocateTeacherBlockerAtSlot(bT, dayOver, oldPeriod, false);
                    }
                  }
                  if (
                    lead.day === dayOver &&
                    lead.periodIndex === oldPeriod &&
                    swapPeer.day === pDay &&
                    swapPeer.periodIndex === pPeriod &&
                    relList.every(re => canReligionPartnerMoveTo(re, pDay, pPeriod, dayOver)) &&
                    (!swapPeer.teacherId ||
                      canTeacherMoveToSlot(swapPeer.teacherId, dayOver, oldPeriod, pDay, true, swapPeer.subjectId, swapPeer.room, pPeriod))
                  ) {
                    const peerKey = `${swapPeer.classId}_${swapPeer.sectionId}_${pDay}_${pPeriod}`;
                    for (const re of relList) {
                      updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldPeriod, pDay, pPeriod);
                    }
                    updateTeacherAndSubjectCountsOnMove(swapPeer, secCtx, pDay, pPeriod, dayOver, oldPeriod);
                    sectionBookings.set(oldSlotKey, [swapPeer]);
                    sectionBookings.set(peerKey, relList);
                    movedThisStep = true;
                    rebalancedAny = true;
                    break;
                  }
                }

                // 5B-2b: Swap relList with a 2-entry non-religion pair (e.g. HMT+AGR in Class 9-10) on underDays
                if (!movedThisStep) {
                  const seenPairKeys = new Set<string>();
                  const pairPeers: TimetableEntry[][] = [];
                  resultEntries.forEach(e => {
                    if (e.classId !== lead.classId || e.sectionId !== lead.sectionId) return;
                    if (!underDays.includes(e.day) || isReligionSubject(e.subjectId, subjects)) return;
                    const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
                    if (seenPairKeys.has(sk)) return;
                    const list = sectionBookings.get(sk) || [];
                    if (list.length === 2 && list.every(x => !isReligionSubject(x.subjectId, subjects) && x.teacherId !== teacher.id)) {
                      seenPairKeys.add(sk);
                      pairPeers.push([...list]);
                    }
                  });
                  for (const peerList of pairPeers) {
                    const pLead = peerList[0];
                    const pDay = pLead.day;
                    const pPeriod = pLead.periodIndex;
                    if ((teacherDayLoad.get(`${teacher.id}_${pDay}`) || 0) >= maxDaily) continue;
                    const destDp = `${pDay}_${pPeriod}`;
                    if ((religionSlotSections.get(destDp)?.size || 0) >= maxRelConcurrent) continue;
                    if (!relList.every(re => canReligionPartnerMoveTo(re, pDay, pPeriod, dayOver))) continue;
                    const peerStaticOk = peerList.every(pe => {
                      if (!isPeriodAllowedForSubject(pe.classId, pe.sectionId, pe.subjectId, oldPeriod)) return false;
                      if (wouldViolateSubjectDailyLimit(secCtx, pe.subjectId, dayOver, pDay)) return false;
                      if (isSubjectDedicatedRoomConflict(pe.subjectId, dayOver, oldPeriod, pe.room, pe.classId, pe.sectionId)) return false;
                      if (pe.teacherId) {
                        const bt = teacherMap.get(pe.teacherId);
                        if (!bt || isTeacherBlockedAtSlot(bt, dayOver, oldPeriod)) return false;
                      }
                      return true;
                    });
                    if (!peerStaticOk) continue;
                    for (const pe of peerList) {
                      if (!pe.teacherId) continue;
                      const bt = teacherMap.get(pe.teacherId)!;
                      if ((teacherDayLoad.get(`${bt.id}_${dayOver}`) || 0) >= getTeacherDailyMax(bt, settings)) {
                        tryFreeOneDaySlotForTeacher(bt, dayOver);
                      }
                      if (teacherBookings.has(`${bt.id}_${dayOver}_${oldPeriod}`)) {
                        tryRelocateTeacherBlockerAtSlot(bt, dayOver, oldPeriod, false);
                      }
                    }
                    if (
                      lead.day === dayOver &&
                      lead.periodIndex === oldPeriod &&
                      peerList.every(pe => pe.day === pDay && pe.periodIndex === pPeriod) &&
                      relList.every(re => canReligionPartnerMoveTo(re, pDay, pPeriod, dayOver)) &&
                      peerList.every(pe => !pe.teacherId || canTeacherMoveToSlot(pe.teacherId, dayOver, oldPeriod, pDay, true, pe.subjectId, pe.room, pPeriod))
                    ) {
                      const peerKey = `${pLead.classId}_${pLead.sectionId}_${pDay}_${pPeriod}`;
                      for (const re of relList) {
                        updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldPeriod, pDay, pPeriod);
                      }
                      for (const pe of peerList) {
                        updateTeacherAndSubjectCountsOnMove(pe, secCtx, pDay, pPeriod, dayOver, oldPeriod);
                      }
                      sectionBookings.set(oldSlotKey, peerList);
                      sectionBookings.set(peerKey, relList);
                      movedThisStep = true;
                      rebalancedAny = true;
                      break;
                    }
                  }
                }

                // 5B-3: 2-step chain swap: relList on dayOver <-> mid on dayOver (in secCtx) <-> peer on underDays
                if (!movedThisStep) {
                  const midPeers = resultEntries.filter(m => {
                    if (m.classId !== lead.classId || m.sectionId !== lead.sectionId) return false;
                    if (m.day !== dayOver || m.periodIndex === oldPeriod || m.teacherId === teacher.id) return false;
                    if (isReligionSubject(m.subjectId, subjects)) return false;
                    const skM = `${m.classId}_${m.sectionId}_${m.day}_${m.periodIndex}`;
                    if ((sectionBookings.get(skM)?.length || 0) !== 1) return false;
                    if (!isPeriodAllowedForSubject(m.classId, m.sectionId, m.subjectId, oldPeriod)) return false;
                    if (isSubjectDedicatedRoomConflict(m.subjectId, dayOver, oldPeriod, m.room, m.classId, m.sectionId)) return false;
                    if (m.teacherId && !canTeacherMoveToSlot(m.teacherId, dayOver, oldPeriod, dayOver, false, m.subjectId, m.room, m.periodIndex)) return false;
                    return true;
                  });
                  for (const mid of midPeers) {
                    if (movedThisStep) break;
                    const midPeriod = mid.periodIndex;
                    const targetPeers = resultEntries.filter(peer => {
                      if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                      if (!underDays.includes(peer.day) || isReligionSubject(peer.subjectId, subjects)) return false;
                      if (peer.teacherId === teacher.id || peer.id === mid.id) return false;
                      const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                      if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                      if ((teacherDayLoad.get(`${teacher.id}_${peer.day}`) || 0) >= maxDaily) return false;
                      const destDp = `${peer.day}_${peer.periodIndex}`;
                      if ((religionSlotSections.get(destDp)?.size || 0) >= maxRelConcurrent) return false;
                      if (!relList.every(re => canReligionPartnerMoveTo(re, peer.day, peer.periodIndex, dayOver))) return false;
                      if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, midPeriod)) return false;
                      if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
                      if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, midPeriod, peer.room, peer.classId, peer.sectionId)) return false;
                      if (peer.teacherId) {
                        const bT = teacherMap.get(peer.teacherId);
                        if (!bT || isTeacherBlockedAtSlot(bT, dayOver, midPeriod)) return false;
                      }
                      return true;
                    });
                    for (const peer of targetPeers) {
                      const pDay = peer.day;
                      const pPeriod = peer.periodIndex;
                      if (peer.teacherId) {
                        const bT = teacherMap.get(peer.teacherId)!;
                        if ((teacherDayLoad.get(`${bT.id}_${dayOver}`) || 0) >= getTeacherDailyMax(bT, settings)) {
                          tryFreeOneDaySlotForTeacher(bT, dayOver);
                        }
                        if (teacherBookings.has(`${bT.id}_${dayOver}_${midPeriod}`)) {
                          tryRelocateTeacherBlockerAtSlot(bT, dayOver, midPeriod, false);
                        }
                      }
                      if (
                        lead.day === dayOver &&
                        lead.periodIndex === oldPeriod &&
                        mid.day === dayOver &&
                        mid.periodIndex === midPeriod &&
                        peer.day === pDay &&
                        peer.periodIndex === pPeriod &&
                        (!mid.teacherId || canTeacherMoveToSlot(mid.teacherId, dayOver, oldPeriod, dayOver, false, mid.subjectId, mid.room, midPeriod)) &&
                        relList.every(re => canReligionPartnerMoveTo(re, pDay, pPeriod, dayOver)) &&
                        (!peer.teacherId || canTeacherMoveToSlot(peer.teacherId, dayOver, midPeriod, pDay, true, peer.subjectId, peer.room, pPeriod))
                      ) {
                        const midKey = `${mid.classId}_${mid.sectionId}_${dayOver}_${midPeriod}`;
                        const peerKey = `${peer.classId}_${peer.sectionId}_${pDay}_${pPeriod}`;
                        for (const re of relList) {
                          updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldPeriod, pDay, pPeriod);
                        }
                        updateTeacherAndSubjectCountsOnMove(peer, secCtx, pDay, pPeriod, dayOver, midPeriod);
                        updateTeacherAndSubjectCountsOnMove(mid, secCtx, dayOver, midPeriod, dayOver, oldPeriod);
                        sectionBookings.set(oldSlotKey, [mid]);
                        sectionBookings.set(midKey, [peer]);
                        sectionBookings.set(peerKey, relList);
                        movedThisStep = true;
                        rebalancedAny = true;
                        break;
                      }
                    }
                  }
                }
              }
            }
          }

          if (!movedThisStep) break;
        }
      }

      if (!rebalancedAny) break;
    }

  // ===========================================================================
  // PASS 5B: Peak-Flattening Pass for High-Load Teachers (e.g. 6 -> 5 onto 4-period days)
  //          Eliminates any 6+ period day when mathematical weekly average is <= 5/day
  // ===========================================================================
  for (let flatRound = 0; flatRound < 6; flatRound++) {
    let flattenedAny = false;
    for (const teacher of teachers) {
      const maxDaily = getTeacherDailyMax(teacher, settings);
      for (let step = 0; step < 8; step++) {
        const highDays = workingDays
          .map(d => ({ d, c: teacherDayLoad.get(`${teacher.id}_${d}`) || 0 }))
          .filter(x => x.c >= maxDaily + 2)
          .sort((a, b) => b.c - a.c);
        if (highDays.length === 0) break;

        let movedFlat = false;
        for (const { d: dayOver, c: dayOverLoad } of highDays) {
          if (movedFlat) break;
          const flatTargets = workingDays
            .filter(d => {
              if (d === dayOver) return false;
              const c = teacherDayLoad.get(`${teacher.id}_${d}`) || 0;
              return c > 0 && c <= dayOverLoad - 2;
            })
            .sort((a, b) => (teacherDayLoad.get(`${teacher.id}_${a}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${b}`) || 0));

          // 1) Non-religion single entries (e.g. solo AGR)
          const singleOver = resultEntries.filter(e => {
            if (e.teacherId !== teacher.id || e.day !== dayOver) return false;
            if (isReligionSubject(e.subjectId, subjects)) return false;
            return (sectionBookings.get(`${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`)?.length || 0) === 1;
          });
          for (const eOver of singleOver) {
            if (movedFlat) break;
            const secCtx = sectionContextMap.get(`${eOver.classId}_${eOver.sectionId}`);
            if (!secCtx) continue;
            for (const dDest of flatTargets) {
              const availIdx = secCtx.availableSlots.findIndex(slot => {
                if (slot.day !== dDest) return false;
                if (!isPeriodAllowedForSubject(eOver.classId, eOver.sectionId, eOver.subjectId, slot.periodIndex)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, eOver.subjectId, dDest, dayOver)) return false;
                if (isSubjectDedicatedRoomConflict(eOver.subjectId, dDest, slot.periodIndex, eOver.room, eOver.classId, eOver.sectionId)) return false;
                return canTeacherMoveToSlot(teacher.id, dDest, slot.periodIndex, dayOver, false, eOver.subjectId, eOver.room, eOver.periodIndex);
              });
              if (availIdx !== -1) {
                const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
                const oldP = eOver.periodIndex;
                updateTeacherAndSubjectCountsOnMove(eOver, secCtx, dayOver, oldP, destSlot.day, destSlot.periodIndex);
                sectionBookings.delete(`${eOver.classId}_${eOver.sectionId}_${dayOver}_${oldP}`);
                sectionBookings.set(`${eOver.classId}_${eOver.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, [eOver]);
                secCtx.availableSlots.push({ day: dayOver, periodIndex: oldP });
                movedFlat = true;
                flattenedAny = true;
                break;
              }
            }
            if (!movedFlat) {
              const peer = resultEntries.find(p => {
                if (p.classId !== eOver.classId || p.sectionId !== eOver.sectionId) return false;
                if (!flatTargets.includes(p.day) || p.subjectId === eOver.subjectId || p.teacherId === teacher.id) return false;
                if (isReligionSubject(p.subjectId, subjects)) return false;
                if ((sectionBookings.get(`${p.classId}_${p.sectionId}_${p.day}_${p.periodIndex}`)?.length || 0) !== 1) return false;
                if (!isPeriodAllowedForSubject(eOver.classId, eOver.sectionId, eOver.subjectId, p.periodIndex)) return false;
                if (!isPeriodAllowedForSubject(p.classId, p.sectionId, p.subjectId, eOver.periodIndex)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, eOver.subjectId, p.day, dayOver)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, p.subjectId, dayOver, p.day)) return false;
                if (isSubjectDedicatedRoomConflict(eOver.subjectId, p.day, p.periodIndex, eOver.room, eOver.classId, eOver.sectionId)) return false;
                if (isSubjectDedicatedRoomConflict(p.subjectId, dayOver, eOver.periodIndex, p.room, p.classId, p.sectionId)) return false;
                return (
                  canTeacherMoveToSlot(teacher.id, p.day, p.periodIndex, dayOver, false, eOver.subjectId, eOver.room, eOver.periodIndex) &&
                  canTeacherMoveToSlot(p.teacherId, dayOver, eOver.periodIndex, p.day, true, p.subjectId, p.room, p.periodIndex)
                );
              });
              if (peer) {
                swapTwoEntriesInSection(secCtx, eOver, peer);
                movedFlat = true;
                flattenedAny = true;
              }
            }
          }

          // 2) Paired HMT+AGR slots (e.g. Moazzem in Class 9-10)
          if (!movedFlat && flatTargets.length > 0) {
            const seenP = new Set<string>();
            const pairedOver: TimetableEntry[][] = [];
            resultEntries.forEach(e => {
              if (e.teacherId !== teacher.id || e.day !== dayOver || isReligionSubject(e.subjectId, subjects)) return;
              const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
              if (seenP.has(sk)) return;
              const list = sectionBookings.get(sk) || [];
              if (list.length === 2 && list.every(x => !isReligionSubject(x.subjectId, subjects))) {
                seenP.add(sk);
                pairedOver.push([...list]);
              }
            });
            for (const pairList of pairedOver) {
              if (movedFlat) break;
              const lead = pairList[0];
              const secCtx = sectionContextMap.get(`${lead.classId}_${lead.sectionId}`);
              if (!secCtx) continue;
              const oldP = lead.periodIndex;
              const oldSlotKey = `${lead.classId}_${lead.sectionId}_${dayOver}_${oldP}`;

              for (const dDest of flatTargets) {
                const availIdx = secCtx.availableSlots.findIndex(slot => {
                  if (slot.day !== dDest) return false;
                  return pairList.every(pe => {
                    if (!isPeriodAllowedForSubject(pe.classId, pe.sectionId, pe.subjectId, slot.periodIndex)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, pe.subjectId, dDest, dayOver)) return false;
                    if (isSubjectDedicatedRoomConflict(pe.subjectId, dDest, slot.periodIndex, pe.room, pe.classId, pe.sectionId)) return false;
                    const enforceDest = pe.teacherId !== teacher.id;
                    return canTeacherMoveToSlot(pe.teacherId, dDest, slot.periodIndex, dayOver, enforceDest, pe.subjectId, pe.room, pe.periodIndex);
                  });
                });
                if (availIdx !== -1) {
                  const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
                  for (const pe of pairList) {
                    updateTeacherAndSubjectCountsOnMove(pe, secCtx, dayOver, oldP, destSlot.day, destSlot.periodIndex);
                  }
                  sectionBookings.delete(oldSlotKey);
                  sectionBookings.set(`${lead.classId}_${lead.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, pairList);
                  secCtx.availableSlots.push({ day: dayOver, periodIndex: oldP });
                  movedFlat = true;
                  flattenedAny = true;
                  break;
                }
              }

              if (!movedFlat) {
                const singlePeers = resultEntries.filter(peer => {
                  if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                  if (!flatTargets.includes(peer.day) || isReligionSubject(peer.subjectId, subjects)) return false;
                  if (pairList.some(pe => pe.subjectId === peer.subjectId || pe.teacherId === peer.teacherId)) return false;
                  const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                  if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                  const pairStaticOk = pairList.every(pe => {
                    if (!isPeriodAllowedForSubject(pe.classId, pe.sectionId, pe.subjectId, peer.periodIndex)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, pe.subjectId, peer.day, dayOver)) return false;
                    if (isSubjectDedicatedRoomConflict(pe.subjectId, peer.day, peer.periodIndex, pe.room, pe.classId, pe.sectionId)) return false;
                    if (pe.teacherId && isTeacherBlockedAtSlot(teacherMap.get(pe.teacherId), peer.day, peer.periodIndex)) return false;
                    return true;
                  });
                  if (!pairStaticOk) return false;
                  if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldP)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
                  if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, oldP, peer.room, peer.classId, peer.sectionId)) return false;
                  if (peer.teacherId && isTeacherBlockedAtSlot(teacherMap.get(peer.teacherId), dayOver, oldP)) return false;
                  return true;
                });

                for (const singlePeer of singlePeers) {
                  const pDay = singlePeer.day;
                  const pPer = singlePeer.periodIndex;
                  for (const pe of pairList) {
                    if (!pe.teacherId || pe.teacherId === teacher.id) continue;
                    const pt = teacherMap.get(pe.teacherId);
                    if (pt && (teacherDayLoad.get(`${pt.id}_${pDay}`) || 0) >= getTeacherDailyMax(pt, settings)) {
                      tryFreeOneDaySlotForTeacher(pt, pDay);
                    }
                    if (pt && teacherBookings.has(`${pt.id}_${pDay}_${pPer}`)) {
                      tryRelocateTeacherBlockerAtSlot(pt, pDay, pPer, false);
                    }
                  }
                  if (singlePeer.teacherId) {
                    const bt = teacherMap.get(singlePeer.teacherId);
                    if (bt && (teacherDayLoad.get(`${bt.id}_${dayOver}`) || 0) >= getTeacherDailyMax(bt, settings)) {
                      tryFreeOneDaySlotForTeacher(bt, dayOver);
                    }
                    if (bt && teacherBookings.has(`${bt.id}_${dayOver}_${oldP}`)) {
                      tryRelocateTeacherBlockerAtSlot(bt, dayOver, oldP, false);
                    }
                  }
                  const canMoveAll =
                    pairList.every(pe => pe.day === dayOver && pe.periodIndex === oldP) &&
                    singlePeer.day === pDay &&
                    singlePeer.periodIndex === pPer &&
                    pairList.every(pe =>
                      canTeacherMoveToSlot(pe.teacherId, pDay, pPer, dayOver, pe.teacherId !== teacher.id, pe.subjectId, pe.room, oldP)
                    ) &&
                    canTeacherMoveToSlot(singlePeer.teacherId, dayOver, oldP, pDay, true, singlePeer.subjectId, singlePeer.room, pPer);
                  if (canMoveAll) {
                    const peerKey = `${singlePeer.classId}_${singlePeer.sectionId}_${pDay}_${pPer}`;
                    for (const pe of pairList) {
                      updateTeacherAndSubjectCountsOnMove(pe, secCtx, dayOver, oldP, pDay, pPer);
                    }
                    updateTeacherAndSubjectCountsOnMove(singlePeer, secCtx, pDay, pPer, dayOver, oldP);
                    sectionBookings.set(oldSlotKey, [singlePeer]);
                    sectionBookings.set(peerKey, pairList);
                    movedFlat = true;
                    flattenedAny = true;
                    break;
                  }
                }
              }

              // 2-step chain swap for Paired HMT+AGR: pairList <-> mid on dayOver <-> singlePeer on flatTargets
              if (!movedFlat) {
                const midsOver = resultEntries.filter(m => {
                  if (m.classId !== lead.classId || m.sectionId !== lead.sectionId) return false;
                  if (m.day !== dayOver || m.periodIndex === oldP || isReligionSubject(m.subjectId, subjects)) return false;
                  const skM = `${m.classId}_${m.sectionId}_${m.day}_${m.periodIndex}`;
                  if ((sectionBookings.get(skM)?.length || 0) !== 1) return false;
                  if (pairList.some(pe => pe.subjectId === m.subjectId || pe.teacherId === m.teacherId)) return false;
                  if (!isPeriodAllowedForSubject(m.classId, m.sectionId, m.subjectId, oldP)) return false;
                  if (isSubjectDedicatedRoomConflict(m.subjectId, dayOver, oldP, m.room, m.classId, m.sectionId)) return false;
                  return canTeacherMoveToSlot(m.teacherId, dayOver, oldP, dayOver, false, m.subjectId, m.room, m.periodIndex);
                });
                for (const mid of midsOver) {
                  if (movedFlat) break;
                  const midP = mid.periodIndex;
                  const destPeers = resultEntries.filter(peer => {
                    if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                    if (!flatTargets.includes(peer.day) || isReligionSubject(peer.subjectId, subjects)) return false;
                    if (pairList.some(pe => pe.subjectId === peer.subjectId || pe.teacherId === peer.teacherId)) return false;
                    const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                    if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                    const pairStaticOk = pairList.every(pe => {
                      if (!isPeriodAllowedForSubject(pe.classId, pe.sectionId, pe.subjectId, peer.periodIndex)) return false;
                      if (wouldViolateSubjectDailyLimit(secCtx, pe.subjectId, peer.day, dayOver)) return false;
                      if (isSubjectDedicatedRoomConflict(pe.subjectId, peer.day, peer.periodIndex, pe.room, pe.classId, pe.sectionId)) return false;
                      if (pe.teacherId && isTeacherBlockedAtSlot(teacherMap.get(pe.teacherId), peer.day, peer.periodIndex)) return false;
                      return true;
                    });
                    if (!pairStaticOk) return false;
                    if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, midP)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
                    if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, midP, peer.room, peer.classId, peer.sectionId)) return false;
                    if (peer.teacherId && isTeacherBlockedAtSlot(teacherMap.get(peer.teacherId), dayOver, midP)) return false;
                    return true;
                  });
                  for (const peer of destPeers) {
                    const pDay = peer.day;
                    const pPer = peer.periodIndex;
                    for (const pe of pairList) {
                      if (!pe.teacherId || pe.teacherId === teacher.id) continue;
                      const pt = teacherMap.get(pe.teacherId);
                      if (pt && (teacherDayLoad.get(`${pt.id}_${pDay}`) || 0) >= getTeacherDailyMax(pt, settings)) {
                        tryFreeOneDaySlotForTeacher(pt, pDay);
                      }
                      if (pt && teacherBookings.has(`${pt.id}_${pDay}_${pPer}`)) {
                        tryRelocateTeacherBlockerAtSlot(pt, pDay, pPer, false);
                      }
                    }
                    if (peer.teacherId) {
                      const bt = teacherMap.get(peer.teacherId);
                      if (bt && (teacherDayLoad.get(`${bt.id}_${dayOver}`) || 0) >= getTeacherDailyMax(bt, settings)) {
                        tryFreeOneDaySlotForTeacher(bt, dayOver);
                      }
                      if (bt && teacherBookings.has(`${bt.id}_${dayOver}_${midP}`)) {
                        tryRelocateTeacherBlockerAtSlot(bt, dayOver, midP, false);
                      }
                    }
                    if (
                      pairList.every(pe => pe.day === dayOver && pe.periodIndex === oldP) &&
                      mid.day === dayOver &&
                      mid.periodIndex === midP &&
                      peer.day === pDay &&
                      peer.periodIndex === pPer &&
                      canTeacherMoveToSlot(mid.teacherId, dayOver, oldP, dayOver, false, mid.subjectId, mid.room, midP) &&
                      pairList.every(pe =>
                        canTeacherMoveToSlot(pe.teacherId, pDay, pPer, dayOver, pe.teacherId !== teacher.id, pe.subjectId, pe.room, oldP)
                      ) &&
                      canTeacherMoveToSlot(peer.teacherId, dayOver, midP, pDay, true, peer.subjectId, peer.room, pPer)
                    ) {
                      const midKey = `${mid.classId}_${mid.sectionId}_${dayOver}_${midP}`;
                      const peerKey = `${peer.classId}_${peer.sectionId}_${pDay}_${pPer}`;
                      for (const pe of pairList) {
                        updateTeacherAndSubjectCountsOnMove(pe, secCtx, dayOver, oldP, pDay, pPer);
                      }
                      updateTeacherAndSubjectCountsOnMove(peer, secCtx, pDay, pPer, dayOver, midP);
                      updateTeacherAndSubjectCountsOnMove(mid, secCtx, dayOver, midP, dayOver, oldP);
                      sectionBookings.set(oldSlotKey, [mid]);
                      sectionBookings.set(midKey, [peer]);
                      sectionBookings.set(peerKey, pairList);
                      movedFlat = true;
                      flattenedAny = true;
                      break;
                    }
                  }
                }
              }
            }
          }

          // 3) Hindu Room 307 solo-section & 2-section wave flattening on dayOver (e.g. Tapash 6 -> 5)
          if (!movedFlat) {
            const tryRelocateSingleHinduSectionFromDayOver = (relList: TimetableEntry[]): boolean => {
              const lead = relList[0];
              const secCtx = sectionContextMap.get(`${lead.classId}_${lead.sectionId}`);
              if (!secCtx) return false;
              const oldP = lead.periodIndex;
              const oldSlotKey = `${lead.classId}_${lead.sectionId}_${dayOver}_${oldP}`;

              const canMoveRelPartners = (destDay: DayOfWeek, destPer: number): boolean => {
                const destDp = `${destDay}_${destPer}`;
                if ((religionSlotSections.get(destDp)?.size || 0) >= maxRelConcurrent) return false;
                const tInWave = teacherSlotEntries.has(`${teacher.id}_${destDp}`);
                const tLoadDest = teacherDayLoad.get(`${teacher.id}_${destDay}`) || 0;
                if (!tInWave && tLoadDest > dayOverLoad - 2) return false;
                return relList.every(re => {
                  if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, destPer)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, re.subjectId, destDay, dayOver)) return false;
                  if (isSubjectDedicatedRoomConflict(re.subjectId, destDay, destPer, re.room, re.classId, re.sectionId)) return false;
                  if (isHinduReligionSubject(re.subjectId, subjects)) {
                    const otherHin = resultEntries.find(
                      o => o.day === destDay && o.periodIndex === destPer && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                    );
                    if (otherHin && otherHin.teacherId !== re.teacherId) return false;
                  }
                  if (re.teacherId === teacher.id) {
                    return canTeacherMoveToSlot(re.teacherId, destDay, destPer, dayOver, false, re.subjectId, re.room, oldP);
                  }
                  if (re.teacherId) {
                    const pt = teacherMap.get(re.teacherId);
                    if (!pt || isTeacherBlockedAtSlot(pt, destDay, destPer)) return false;
                    return true;
                  }
                  return true;
                });
              };

              const prepareRelPartners = (destDay: DayOfWeek, destPer: number): boolean => {
                for (const re of relList) {
                  if (!re.teacherId || re.teacherId === teacher.id) continue;
                  const pt = teacherMap.get(re.teacherId);
                  if (!pt) return false;
                  if ((teacherDayLoad.get(`${pt.id}_${destDay}`) || 0) >= getTeacherDailyMax(pt, settings)) {
                    tryFreeOneDaySlotForTeacher(pt, destDay);
                  }
                  if (teacherBookings.has(`${pt.id}_${destDay}_${destPer}`)) {
                    tryRelocateTeacherBlockerAtSlot(pt, destDay, destPer, false);
                  }
                  if (!canTeacherMoveToSlot(pt.id, destDay, destPer, dayOver, true, re.subjectId, re.room, oldP)) {
                    return false;
                  }
                }
                return true;
              };

              // 3A) Open slots (prefer joining existing < maxRelConcurrent waves!)
              const openCands = secCtx.availableSlots
                .map((s, idx) => ({ s, idx }))
                .filter(({ s: slot }) => slot.day !== dayOver && canMoveRelPartners(slot.day, slot.periodIndex))
                .sort((a, b) => {
                  const wA = teacherSlotEntries.has(`${teacher.id}_${a.s.day}_${a.s.periodIndex}`) ? 1 : 0;
                  const wB = teacherSlotEntries.has(`${teacher.id}_${b.s.day}_${b.s.periodIndex}`) ? 1 : 0;
                  return wB - wA;
                });

              for (const cand of openCands) {
                if (!prepareRelPartners(cand.s.day, cand.s.periodIndex)) continue;
                const realIdx = secCtx.availableSlots.findIndex(
                  s => s.day === cand.s.day && s.periodIndex === cand.s.periodIndex
                );
                if (realIdx === -1) continue;
                const destSlot = secCtx.availableSlots.splice(realIdx, 1)[0];
                for (const re of relList) {
                  updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldP, destSlot.day, destSlot.periodIndex);
                }
                sectionBookings.delete(oldSlotKey);
                sectionBookings.set(`${lead.classId}_${lead.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, relList);
                secCtx.availableSlots.push({ day: dayOver, periodIndex: oldP });
                return true;
              }

              // 3B) Swap with single non-religion peer (with blocker relocation & daily relief!)
              const swapPeers = resultEntries
                .filter(peer => {
                  if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                  if (peer.day === dayOver || isReligionSubject(peer.subjectId, subjects)) return false;
                  const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                  if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                  if (!canMoveRelPartners(peer.day, peer.periodIndex)) return false;
                  if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldP)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
                  if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, oldP, peer.room, peer.classId, peer.sectionId)) return false;
                  if (peer.teacherId && isTeacherBlockedAtSlot(teacherMap.get(peer.teacherId), dayOver, oldP)) return false;
                  return true;
                })
                .sort((a, b) => {
                  const wA = teacherSlotEntries.has(`${teacher.id}_${a.day}_${a.periodIndex}`) ? 1 : 0;
                  const wB = teacherSlotEntries.has(`${teacher.id}_${b.day}_${b.periodIndex}`) ? 1 : 0;
                  if (wA !== wB) return wB - wA;
                  return (teacherDayLoad.get(`${teacher.id}_${a.day}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${b.day}`) || 0);
                });

              for (const swapPeer of swapPeers) {
                const pDay = swapPeer.day;
                const pPer = swapPeer.periodIndex;
                if (swapPeer.teacherId) {
                  const bt = teacherMap.get(swapPeer.teacherId);
                  if (bt && (teacherDayLoad.get(`${bt.id}_${dayOver}`) || 0) >= getTeacherDailyMax(bt, settings)) {
                    tryFreeOneDaySlotForTeacher(bt, dayOver);
                  }
                  if (bt && teacherBookings.has(`${bt.id}_${dayOver}_${oldP}`)) {
                    tryRelocateTeacherBlockerAtSlot(bt, dayOver, oldP, false);
                  }
                }
                if (!prepareRelPartners(pDay, pPer)) continue;
                if (
                  lead.day === dayOver &&
                  lead.periodIndex === oldP &&
                  swapPeer.day === pDay &&
                  swapPeer.periodIndex === pPer &&
                  canMoveRelPartners(pDay, pPer) &&
                  canTeacherMoveToSlot(swapPeer.teacherId, dayOver, oldP, pDay, true, swapPeer.subjectId, swapPeer.room, pPer)
                ) {
                  const peerKey = `${swapPeer.classId}_${swapPeer.sectionId}_${pDay}_${pPer}`;
                  for (const re of relList) {
                    updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldP, pDay, pPer);
                  }
                  updateTeacherAndSubjectCountsOnMove(swapPeer, secCtx, pDay, pPer, dayOver, oldP);
                  sectionBookings.set(oldSlotKey, [swapPeer]);
                  sectionBookings.set(peerKey, relList);
                  return true;
                }
              }
              return false;
            };

            const slotsByPeriod = new Map<number, TimetableEntry[][]>();
            const seenR = new Set<string>();
            resultEntries.forEach(e => {
              if (e.teacherId !== teacher.id || e.day !== dayOver) return;
              if (!isHinduReligionSubject(e.subjectId, subjects) || !isHinduReligionRoom(e.room, settings)) return;
              const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
              if (seenR.has(sk)) return;
              seenR.add(sk);
              const list = sectionBookings.get(sk) || [];
              if (list.length > 0) {
                const arr = slotsByPeriod.get(e.periodIndex) || [];
                arr.push([...list]);
                slotsByPeriod.set(e.periodIndex, arr);
              }
            });

            const sortedWaves = Array.from(slotsByPeriod.entries()).sort((a, b) => a[1].length - b[1].length);
            for (const [, waveLists] of sortedWaves) {
              if (movedFlat) break;
              if (waveLists.length === 1) {
                if (tryRelocateSingleHinduSectionFromDayOver(waveLists[0])) {
                  movedFlat = true;
                  flattenedAny = true;
                  break;
                }
              } else if (waveLists.length === 2) {
                // Move first section, then second section so the entire 2-section slot vacates dayOver
                const firstMoved = tryRelocateSingleHinduSectionFromDayOver(waveLists[0]);
                if (firstMoved) {
                  const secondMoved = tryRelocateSingleHinduSectionFromDayOver(waveLists[1]);
                  if (secondMoved) {
                    movedFlat = true;
                    flattenedAny = true;
                    break;
                  }
                }
              }
            }
          }
        }
        if (!movedFlat) break;
      }
    }
    if (!flattenedAny) break;
  }

  // ===========================================================================
  // PASS 6: Weekly Working-Days Compaction (<= maxWorkingDays, default 4) &
  //         Active-Day Workload Balancing
  // ===========================================================================
  const getSimulatedDayConsecutiveRun = (
    teacherId: string,
    day: DayOfWeek,
    addPeriod?: number,
    removePeriod?: number
  ): number => {
    const periods: number[] = [];
    for (const p of teachingPeriods) {
      if (p === removePeriod) continue;
      if (p === addPeriod || teacherBookings.has(`${teacherId}_${day}_${p}`)) {
        periods.push(p);
      }
    }
    if (addPeriod !== undefined && !periods.includes(addPeriod)) {
      periods.push(addPeriod);
    }
    periods.sort((a, b) => a - b);
    if (periods.length === 0) return 0;
    let maxRun = 1;
    let run = 1;
    for (let i = 1; i < periods.length; i++) {
      if (periods[i] === periods[i - 1] + 1) {
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 1;
      }
    }
    return maxRun;
  };

  const canSwapEntriesPreservingWorkingDaysAndLimits = (
    entryA: TimetableEntry,
    teacherA: Teacher,
    peerEntry: TimetableEntry,
    allowSameDayOnly: boolean = false
  ): boolean => {
    if (!peerEntry.teacherId || peerEntry.teacherId === teacherA.id) return false;
    const teacherB = teacherMap.get(peerEntry.teacherId);
    if (!teacherB) return false;
    if (isReligionSubject(peerEntry.subjectId, subjects)) return false;

    const skPeer = `${peerEntry.classId}_${peerEntry.sectionId}_${peerEntry.day}_${peerEntry.periodIndex}`;
    if ((sectionBookings.get(skPeer)?.length || 0) !== 1) return false;

    const secCtx = sectionContextMap.get(`${entryA.classId}_${entryA.sectionId}`);
    if (!secCtx) return false;

    if (
      !isPeriodAllowedForSubject(entryA.classId, entryA.sectionId, entryA.subjectId, peerEntry.periodIndex) ||
      !isPeriodAllowedForSubject(peerEntry.classId, peerEntry.sectionId, peerEntry.subjectId, entryA.periodIndex)
    ) {
      return false;
    }
    if (
      !allowSameDayOnly &&
      (wouldViolateSubjectDailyLimit(secCtx, entryA.subjectId, peerEntry.day, entryA.day) ||
        wouldViolateSubjectDailyLimit(secCtx, peerEntry.subjectId, entryA.day, peerEntry.day))
    ) {
      return false;
    }
    if (
      isSubjectDedicatedRoomConflict(
        entryA.subjectId,
        peerEntry.day,
        peerEntry.periodIndex,
        entryA.room,
        entryA.classId,
        entryA.sectionId
      ) ||
      isSubjectDedicatedRoomConflict(
        peerEntry.subjectId,
        entryA.day,
        entryA.periodIndex,
        peerEntry.room,
        peerEntry.classId,
        peerEntry.sectionId
      )
    ) {
      return false;
    }
    if (isTeacherBlockedAtSlot(teacherA, peerEntry.day, peerEntry.periodIndex)) return false;
    if (isTeacherBlockedAtSlot(teacherB, entryA.day, entryA.periodIndex)) return false;

    if (entryA.day !== peerEntry.day) {
      // Destination slots must not clash for either teacher
      if (teacherBookings.has(`${teacherA.id}_${peerEntry.day}_${peerEntry.periodIndex}`)) return false;
      if (teacherBookings.has(`${teacherB.id}_${entryA.day}_${entryA.periodIndex}`)) return false;

      // Enforce daily limits for both teachers on cross-day swap
      if ((teacherDayLoad.get(`${teacherA.id}_${peerEntry.day}`) || 0) >= getTeacherDailyMax(teacherA, settings)) {
        return false;
      }
      if ((teacherDayLoad.get(`${teacherB.id}_${entryA.day}`) || 0) >= getTeacherDailyMax(teacherB, settings)) {
        return false;
      }

      // Never allow cross-day swap to push a feasible peer teacher B over their effective maxWorkingDays
      if (!blockTeacherIdSet.has(teacherB.id)) {
        const bMaxWork = getTeacherMaxWorkingDays(teacherB, settings);
        const bEstLoad = dedicatedLoadEstimate.get(teacherB.id) || 0;
        const bMaxSub = dedicatedMaxSubFreq.get(teacherB.id) || 0;
        const bEffectiveMaxDays =
          bEstLoad > bMaxWork * getTeacherDailyMax(teacherB, settings) || bMaxSub > bMaxWork
            ? workingDays.length
            : bMaxWork;
        const bDayOldLoad = teacherDayLoad.get(`${teacherB.id}_${peerEntry.day}`) || 0;
        const bDayNewLoad = teacherDayLoad.get(`${teacherB.id}_${entryA.day}`) || 0;
        const bActiveBefore = getTeacherActiveDaysCount(teacherB.id);
        const bEmptiesOldDay = bDayOldLoad === 1;
        const bOpensNewDay = bDayNewLoad === 0;
        const bActiveAfter = bActiveBefore - (bEmptiesOldDay ? 1 : 0) + (bOpensNewDay ? 1 : 0);
        if (bOpensNewDay && bActiveAfter > bEffectiveMaxDays) {
          return false;
        }
      }
    } else {
      // Same-day swap: ensure neither teacher holds a *different* entry at the target period
      if (
        peerEntry.periodIndex !== entryA.periodIndex &&
        teacherBookings.has(`${teacherA.id}_${peerEntry.day}_${peerEntry.periodIndex}`)
      ) {
        return false;
      }
      if (
        entryA.periodIndex !== peerEntry.periodIndex &&
        teacherBookings.has(`${teacherB.id}_${entryA.day}_${entryA.periodIndex}`)
      ) {
        return false;
      }
    }

    // Never introduce a 4+ consecutive streak for teacher B
    const bRunAfter = getSimulatedDayConsecutiveRun(
      teacherB.id,
      entryA.day,
      entryA.periodIndex,
      entryA.day === peerEntry.day ? peerEntry.periodIndex : undefined
    );
    if (bRunAfter >= 4) return false;

    return true;
  };

  // Pass 6A: Compact non-block teachers onto <= maxWorkingDays (4) whenever feasible
  for (let compactRound = 0; compactRound < 5; compactRound++) {
    let compactedAny = false;

    for (const teacher of teachers) {
      if (blockTeacherIdSet.has(teacher.id)) continue;
      const maxWorkDays = getTeacherMaxWorkingDays(teacher, settings);
      const maxDaily = getTeacherDailyMax(teacher, settings);

      for (let step = 0; step < 12; step++) {
        const activeDayCounts = workingDays
          .map(d => ({ day: d, count: teacherDayLoad.get(`${teacher.id}_${d}`) || 0 }))
          .filter(x => x.count > 0)
          .sort((a, b) => a.count - b.count);

        if (activeDayCounts.length <= maxWorkDays) break;

        let movedOne = false;

        for (const donorInfo of activeDayCounts) {
          if (movedOne) break;
          const donorDay = donorInfo.day;

          // Target days must already be active (never open a 5th/idle day) and under daily cap
          const targetActiveDays = activeDayCounts
            .filter(x => x.day !== donorDay && x.count < maxDaily)
            .sort((a, b) => a.count - b.count)
            .map(x => x.day);

          if (targetActiveDays.length === 0) continue;

          const donorEntries = resultEntries.filter(e => {
            if (e.teacherId !== teacher.id || e.day !== donorDay) return false;
            if (isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)) {
              return false;
            }
            const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
            return (sectionBookings.get(sk)?.length || 0) === 1;
          });

          // Strategy 1: Move directly to an open section slot on an already-active day
          for (const entryDonor of donorEntries) {
            if (movedOne) break;
            const secCtx = sectionContextMap.get(`${entryDonor.classId}_${entryDonor.sectionId}`);
            if (!secCtx || secCtx.availableSlots.length === 0) continue;

            for (const targetDay of targetActiveDays) {
              const availIdx = secCtx.availableSlots.findIndex(slot => {
                if (slot.day !== targetDay) return false;
                if (!isPeriodAllowedForSubject(entryDonor.classId, entryDonor.sectionId, entryDonor.subjectId, slot.periodIndex)) {
                  return false;
                }
                if (wouldViolateSubjectDailyLimit(secCtx, entryDonor.subjectId, slot.day, donorDay)) {
                  return false;
                }
                if (
                  isSubjectDedicatedRoomConflict(
                    entryDonor.subjectId,
                    slot.day,
                    slot.periodIndex,
                    entryDonor.room,
                    entryDonor.classId,
                    entryDonor.sectionId
                  )
                ) {
                  return false;
                }
                if (getSimulatedDayConsecutiveRun(teacher.id, slot.day, slot.periodIndex) >= 4) {
                  return false;
                }
                return canTeacherMoveToSlot(
                  teacher.id,
                  slot.day,
                  slot.periodIndex,
                  donorDay,
                  true,
                  entryDonor.subjectId,
                  entryDonor.room
                );
              });

              if (availIdx !== -1) {
                const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
                const oldPeriod = entryDonor.periodIndex;
                const oldSlotKey = `${entryDonor.classId}_${entryDonor.sectionId}_${donorDay}_${oldPeriod}`;
                updateTeacherAndSubjectCountsOnMove(entryDonor, secCtx, donorDay, oldPeriod, destSlot.day, destSlot.periodIndex);
                sectionBookings.delete(oldSlotKey);
                sectionBookings.set(
                  `${entryDonor.classId}_${entryDonor.sectionId}_${destSlot.day}_${destSlot.periodIndex}`,
                  [entryDonor]
                );
                secCtx.availableSlots.push({ day: donorDay, periodIndex: oldPeriod });
                movedOne = true;
                compactedAny = true;
                break;
              }
            }
          }

          // Strategy 1B: Slide a peer on targetActiveDay into an open slot on THAT SAME targetActiveDay
          // so entryDonor can claim the newly vacated period (preserves peer's working days & daily load!)
          if (!movedOne) {
            for (const entryDonor of donorEntries) {
              if (movedOne) break;
              const secCtx = sectionContextMap.get(`${entryDonor.classId}_${entryDonor.sectionId}`);
              if (!secCtx || secCtx.availableSlots.length === 0) continue;

              for (const targetDay of targetActiveDays) {
                if (movedOne) break;
                const openSameDaySlots = secCtx.availableSlots
                  .map((s, idx) => ({ s, idx }))
                  .filter(x => x.s.day === targetDay);
                if (openSameDaySlots.length === 0) continue;
                if (wouldViolateSubjectDailyLimit(secCtx, entryDonor.subjectId, targetDay, donorDay)) continue;

                const dayPeers = resultEntries.filter(p => {
                  if (p.classId !== entryDonor.classId || p.sectionId !== entryDonor.sectionId || p.day !== targetDay) {
                    return false;
                  }
                  if (isHinduReligionSubject(p.subjectId, subjects) && isHinduReligionRoom(p.room, settings)) {
                    return false;
                  }
                  const skP = `${p.classId}_${p.sectionId}_${p.day}_${p.periodIndex}`;
                  if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                  if (!isPeriodAllowedForSubject(entryDonor.classId, entryDonor.sectionId, entryDonor.subjectId, p.periodIndex)) {
                    return false;
                  }
                  if (isSubjectDedicatedRoomConflict(entryDonor.subjectId, targetDay, p.periodIndex, entryDonor.room, entryDonor.classId, entryDonor.sectionId)) {
                    return false;
                  }
                  if (getSimulatedDayConsecutiveRun(teacher.id, targetDay, p.periodIndex) >= 4) return false;
                  return canTeacherMoveToSlot(teacher.id, targetDay, p.periodIndex, donorDay, true, entryDonor.subjectId, entryDonor.room);
                });

                for (const peer of dayPeers) {
                  if (movedOne) break;
                  const slideSlot = openSameDaySlots.find(({ s: dest }) => {
                    if (dest.periodIndex === peer.periodIndex) return false;
                    if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, dest.periodIndex)) {
                      return false;
                    }
                    if (isSubjectDedicatedRoomConflict(peer.subjectId, targetDay, dest.periodIndex, peer.room, peer.classId, peer.sectionId)) {
                      return false;
                    }
                    if (peer.teacherId) {
                      const pt = teacherMap.get(peer.teacherId);
                      if (!pt || isTeacherBlockedAtSlot(pt, targetDay, dest.periodIndex)) return false;
                      if (teacherBookings.has(`${pt.id}_${targetDay}_${dest.periodIndex}`)) return false;
                      if (getSimulatedDayConsecutiveRun(pt.id, targetDay, dest.periodIndex, peer.periodIndex) >= 4) {
                        return false;
                      }
                    }
                    return true;
                  });

                  if (slideSlot) {
                    const dest = secCtx.availableSlots.splice(slideSlot.idx, 1)[0];
                    const peerOldPeriod = peer.periodIndex;
                    const peerOldKey = `${peer.classId}_${peer.sectionId}_${targetDay}_${peerOldPeriod}`;
                    updateTeacherAndSubjectCountsOnMove(peer, secCtx, targetDay, peerOldPeriod, targetDay, dest.periodIndex);
                    sectionBookings.delete(peerOldKey);
                    sectionBookings.set(`${peer.classId}_${peer.sectionId}_${targetDay}_${dest.periodIndex}`, [peer]);

                    const donorOldPeriod = entryDonor.periodIndex;
                    const donorOldKey = `${entryDonor.classId}_${entryDonor.sectionId}_${donorDay}_${donorOldPeriod}`;
                    updateTeacherAndSubjectCountsOnMove(entryDonor, secCtx, donorDay, donorOldPeriod, targetDay, peerOldPeriod);
                    sectionBookings.delete(donorOldKey);
                    sectionBookings.set(`${entryDonor.classId}_${entryDonor.sectionId}_${targetDay}_${peerOldPeriod}`, [entryDonor]);
                    secCtx.availableSlots.push({ day: donorDay, periodIndex: donorOldPeriod });
                    movedOne = true;
                    compactedAny = true;
                    break;
                  }
                }
              }
            }
          }

          // Strategy 2: Swap entryDonor with peerEntry in same section on targetActiveDay
          if (!movedOne) {
            for (const entryDonor of donorEntries) {
              if (movedOne) break;
              const secCtx = sectionContextMap.get(`${entryDonor.classId}_${entryDonor.sectionId}`);
              if (!secCtx) continue;

              const peerCandidates = resultEntries.filter(peer => {
                if (peer.classId !== entryDonor.classId || peer.sectionId !== entryDonor.sectionId) return false;
                if (peer.subjectId === entryDonor.subjectId) return false;
                if (!targetActiveDays.includes(peer.day)) return false;
                return canSwapEntriesPreservingWorkingDaysAndLimits(entryDonor, teacher, peer, false);
              });

              // Prefer swaps keeping teacher's consecutive run <= 2 on target day
              peerCandidates.sort((a, b) => {
                const runA = getSimulatedDayConsecutiveRun(teacher.id, a.day, a.periodIndex);
                const runB = getSimulatedDayConsecutiveRun(teacher.id, b.day, b.periodIndex);
                if (runA !== runB) return runA - runB;
                const loadA = teacherDayLoad.get(`${teacher.id}_${a.day}`) || 0;
                const loadB = teacherDayLoad.get(`${teacher.id}_${b.day}`) || 0;
                return loadA - loadB;
              });

              for (const peerEntry of peerCandidates) {
                const aRunAfter = getSimulatedDayConsecutiveRun(teacher.id, peerEntry.day, peerEntry.periodIndex);
                if (aRunAfter >= 4) continue;
                swapTwoEntriesInSection(secCtx, entryDonor, peerEntry);
                movedOne = true;
                compactedAny = true;
                break;
              }
            }
          }

          // Strategy 2B: 2-step intra-section chain swap when 1-step swap is blocked by same-day subject limit
          // Moves entryDonor (donorDay) -> slotM (targetActiveDay) and entryM (targetActiveDay) -> slotP (donorDay)
          if (!movedOne) {
            for (const entryDonor of donorEntries) {
              if (movedOne) break;
              const secCtx = sectionContextMap.get(`${entryDonor.classId}_${entryDonor.sectionId}`);
              if (!secCtx) continue;

              const midPeers = resultEntries.filter(m => {
                if (m.classId !== entryDonor.classId || m.sectionId !== entryDonor.sectionId) return false;
                if (m.subjectId === entryDonor.subjectId || !targetActiveDays.includes(m.day)) return false;
                const skM = `${m.classId}_${m.sectionId}_${m.day}_${m.periodIndex}`;
                if ((sectionBookings.get(skM)?.length || 0) !== 1) return false;
                if (isReligionSubject(m.subjectId, subjects)) return false;
                if (!isPeriodAllowedForSubject(entryDonor.classId, entryDonor.sectionId, entryDonor.subjectId, m.periodIndex)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, entryDonor.subjectId, m.day, donorDay)) return false;
                if (isSubjectDedicatedRoomConflict(entryDonor.subjectId, m.day, m.periodIndex, entryDonor.room, entryDonor.classId, entryDonor.sectionId)) return false;
                if (!canTeacherMoveToSlot(teacher.id, m.day, m.periodIndex, donorDay, true, entryDonor.subjectId, entryDonor.room)) return false;
                return getSimulatedDayConsecutiveRun(teacher.id, m.day, m.periodIndex) < 4;
              });

              for (const midPeer of midPeers) {
                if (movedOne) break;
                if (!midPeer.teacherId) continue;
                const midTeacher = teacherMap.get(midPeer.teacherId);
                if (!midTeacher) continue;

                // midPeer itself moves mDay -> dDay, check mDay/dDay teacher working-days constraint once per midPeer
                const dDay = entryDonor.day;
                const dPeriod = entryDonor.periodIndex;
                const mDay = midPeer.day;
                const mPeriod = midPeer.periodIndex;

                if (wouldViolateSubjectDailyLimit(secCtx, midPeer.subjectId, dDay, mDay)) continue;
                if (!blockTeacherIdSet.has(midTeacher.id)) {
                  const mOldDayLoad = teacherDayLoad.get(`${midTeacher.id}_${mDay}`) || 0;
                  const mNewDayLoad = teacherDayLoad.get(`${midTeacher.id}_${dDay}`) || 0;
                  const mActiveBefore = getTeacherActiveDaysCount(midTeacher.id);
                  const mOpensNewDay = mNewDayLoad === 0;
                  const mActiveAfter = mActiveBefore - (mOldDayLoad === 1 ? 1 : 0) + (mOpensNewDay ? 1 : 0);
                  if (mOpensNewDay && mActiveAfter > getTeacherMaxWorkingDays(midTeacher, settings)) {
                    continue;
                  }
                }
                if ((teacherDayLoad.get(`${midTeacher.id}_${dDay}`) || 0) >= getTeacherDailyMax(midTeacher, settings)) {
                  continue;
                }

                const finalPeers = resultEntries.filter(p => {
                  if (p.classId !== entryDonor.classId || p.sectionId !== entryDonor.sectionId) return false;
                  if (p.id === entryDonor.id || p.id === midPeer.id) return false;
                  if (p.day !== dDay) return false;
                  if (p.subjectId === midPeer.subjectId || p.teacherId === teacher.id || p.teacherId === midTeacher.id) return false;
                  const skP = `${p.classId}_${p.sectionId}_${p.day}_${p.periodIndex}`;
                  if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                  if (isReligionSubject(p.subjectId, subjects)) return false;

                  // Validate midPeer -> (dDay, p.periodIndex)
                  if (!isPeriodAllowedForSubject(midPeer.classId, midPeer.sectionId, midPeer.subjectId, p.periodIndex)) return false;
                  if (isSubjectDedicatedRoomConflict(midPeer.subjectId, dDay, p.periodIndex, midPeer.room, midPeer.classId, midPeer.sectionId)) return false;
                  if (isTeacherBlockedAtSlot(midTeacher, dDay, p.periodIndex)) return false;
                  if (teacherBookings.has(`${midTeacher.id}_${dDay}_${p.periodIndex}`)) return false;
                  if (getSimulatedDayConsecutiveRun(midTeacher.id, dDay, p.periodIndex) >= 4) return false;

                  // Validate p (same-day shift) -> (dDay, dPeriod)
                  if (!isPeriodAllowedForSubject(p.classId, p.sectionId, p.subjectId, dPeriod)) return false;
                  if (isSubjectDedicatedRoomConflict(p.subjectId, dDay, dPeriod, p.room, p.classId, p.sectionId)) return false;
                  if (p.teacherId) {
                    const pTeacher = teacherMap.get(p.teacherId);
                    if (!pTeacher) return false;
                    if (isTeacherBlockedAtSlot(pTeacher, dDay, dPeriod)) return false;
                    if (p.periodIndex !== dPeriod && teacherBookings.has(`${pTeacher.id}_${dDay}_${dPeriod}`)) return false;
                    if (getSimulatedDayConsecutiveRun(pTeacher.id, dDay, dPeriod, p.periodIndex) >= 4) return false;
                  }
                  return true;
                });

                if (finalPeers.length > 0) {
                  const finalPeer = finalPeers[0];
                  // Execute 3-cycle atomically:
                  // entryDonor(dDay, dPeriod) -> (mDay, mPeriod)
                  // midPeer(mDay, mPeriod) -> (dDay, pPeriod)
                  // finalPeer(dDay, pPeriod) -> (dDay, dPeriod)
                  swapTwoEntriesInSection(secCtx, entryDonor, finalPeer);
                  swapTwoEntriesInSection(secCtx, entryDonor, midPeer);
                  movedOne = true;
                  compactedAny = true;
                  break;
                }
              }
            }
          }

          // Strategy 3: Move 2-entry non-religion parallel slots (e.g. HMT+AGR) onto an active day open slot
          if (!movedOne) {
            const pairedKeys = new Set<string>();
            const donorPairedSlots: TimetableEntry[][] = [];
            resultEntries.forEach(e => {
              if (e.teacherId !== teacher.id || e.day !== donorDay) return;
              if (isReligionSubject(e.subjectId, subjects)) return;
              const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
              if (pairedKeys.has(sk)) return;
              const slotList = sectionBookings.get(sk) || [];
              if (slotList.length === 2 && slotList.every(x => !isReligionSubject(x.subjectId, subjects))) {
                pairedKeys.add(sk);
                donorPairedSlots.push([...slotList]);
              }
            });

            for (const pairList of donorPairedSlots) {
              if (movedOne) break;
              const lead = pairList[0];
              const secCtx = sectionContextMap.get(`${lead.classId}_${lead.sectionId}`);
              if (!secCtx || secCtx.availableSlots.length === 0) continue;

              for (const targetDay of targetActiveDays) {
                const availIdx = secCtx.availableSlots.findIndex(slot => {
                  if (slot.day !== targetDay) return false;
                  return pairList.every(pe => {
                    if (!isPeriodAllowedForSubject(pe.classId, pe.sectionId, pe.subjectId, slot.periodIndex)) {
                      return false;
                    }
                    if (wouldViolateSubjectDailyLimit(secCtx, pe.subjectId, slot.day, donorDay)) {
                      return false;
                    }
                    if (isSubjectDedicatedRoomConflict(pe.subjectId, slot.day, slot.periodIndex, pe.room, pe.classId, pe.sectionId)) {
                      return false;
                    }
                    if (pe.teacherId && getSimulatedDayConsecutiveRun(pe.teacherId, slot.day, slot.periodIndex) >= 4) {
                      return false;
                    }
                    if (pe.teacherId && pe.teacherId !== teacher.id) {
                      const pt = teacherMap.get(pe.teacherId);
                      const ptNewDay = (teacherDayLoad.get(`${pe.teacherId}_${slot.day}`) || 0) === 0;
                      if (pt && !blockTeacherIdSet.has(pt.id) && ptNewDay && getTeacherActiveDaysCount(pt.id) >= getTeacherMaxWorkingDays(pt, settings)) {
                        return false;
                      }
                    }
                    return canTeacherMoveToSlot(pe.teacherId, slot.day, slot.periodIndex, donorDay, true, pe.subjectId, pe.room);
                  });
                });

                if (availIdx !== -1) {
                  const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
                  const oldPeriod = lead.periodIndex;
                  const oldSlotKey = `${lead.classId}_${lead.sectionId}_${donorDay}_${oldPeriod}`;
                  for (const pe of pairList) {
                    updateTeacherAndSubjectCountsOnMove(pe, secCtx, donorDay, oldPeriod, destSlot.day, destSlot.periodIndex);
                  }
                  sectionBookings.delete(oldSlotKey);
                  sectionBookings.set(
                    `${lead.classId}_${lead.sectionId}_${destSlot.day}_${destSlot.periodIndex}`,
                    pairList
                  );
                  secCtx.availableSlots.push({ day: donorDay, periodIndex: oldPeriod });
                  movedOne = true;
                  compactedAny = true;
                  break;
                }
              }

              // Strategy 3B: Swap 2-entry paired slot (e.g. Zakir HMT + Moazzem AGR) with a single non-religion peer on targetActiveDay
              if (!movedOne) {
                const oldPeriod = lead.periodIndex;
                const oldSlotKey = `${lead.classId}_${lead.sectionId}_${donorDay}_${oldPeriod}`;
                const singlePeers = resultEntries.filter(peer => {
                  if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                  if (!targetActiveDays.includes(peer.day)) return false;
                  if (isReligionSubject(peer.subjectId, subjects)) return false;
                  if (pairList.some(pe => pe.subjectId === peer.subjectId || pe.teacherId === peer.teacherId)) return false;
                  const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                  if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;

                  // All entries in pairList must cleanly move to (peer.day, peer.periodIndex)
                  const pairOk = pairList.every(pe => {
                    if (!isPeriodAllowedForSubject(pe.classId, pe.sectionId, pe.subjectId, peer.periodIndex)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, pe.subjectId, peer.day, donorDay)) return false;
                    if (isSubjectDedicatedRoomConflict(pe.subjectId, peer.day, peer.periodIndex, pe.room, pe.classId, pe.sectionId)) return false;
                    if (pe.teacherId) {
                      const pt = teacherMap.get(pe.teacherId);
                      if (!pt || isTeacherBlockedAtSlot(pt, peer.day, peer.periodIndex)) return false;
                      if (teacherBookings.has(`${pt.id}_${peer.day}_${peer.periodIndex}`)) return false;
                      if ((teacherDayLoad.get(`${pt.id}_${peer.day}`) || 0) >= getTeacherDailyMax(pt, settings)) return false;
                      if (getSimulatedDayConsecutiveRun(pt.id, peer.day, peer.periodIndex) >= 4) return false;
                      if (pe.teacherId !== teacher.id && !blockTeacherIdSet.has(pt.id)) {
                        const ptNewDay = (teacherDayLoad.get(`${pt.id}_${peer.day}`) || 0) === 0;
                        const ptMaxW = getTeacherMaxWorkingDays(pt, settings);
                        const ptNeed5 =
                          (dedicatedLoadEstimate.get(pt.id) || 0) > ptMaxW * getTeacherDailyMax(pt, settings) ||
                          (dedicatedMaxSubFreq.get(pt.id) || 0) > ptMaxW;
                        if (!ptNeed5 && ptNewDay && getTeacherActiveDaysCount(pt.id) >= ptMaxW) return false;
                      }
                    }
                    return true;
                  });
                  if (!pairOk) return false;

                  // peer must cleanly move to (donorDay, oldPeriod)
                  if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldPeriod)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, donorDay, peer.day)) return false;
                  if (isSubjectDedicatedRoomConflict(peer.subjectId, donorDay, oldPeriod, peer.room, peer.classId, peer.sectionId)) return false;
                  if (peer.teacherId) {
                    const bT = teacherMap.get(peer.teacherId);
                    if (!bT || isTeacherBlockedAtSlot(bT, donorDay, oldPeriod)) return false;
                    if (teacherBookings.has(`${bT.id}_${donorDay}_${oldPeriod}`)) return false;
                    if ((teacherDayLoad.get(`${bT.id}_${donorDay}`) || 0) >= getTeacherDailyMax(bT, settings)) return false;
                    if (getSimulatedDayConsecutiveRun(bT.id, donorDay, oldPeriod) >= 4) return false;
                    if (!blockTeacherIdSet.has(bT.id)) {
                      const bMaxW = getTeacherMaxWorkingDays(bT, settings);
                      const bNeed5 =
                        (dedicatedLoadEstimate.get(bT.id) || 0) > bMaxW * getTeacherDailyMax(bT, settings) ||
                        (dedicatedMaxSubFreq.get(bT.id) || 0) > bMaxW;
                      const bEffMax = bNeed5 ? workingDays.length : bMaxW;
                      const bOpens = (teacherDayLoad.get(`${bT.id}_${donorDay}`) || 0) === 0;
                      const bEmpties = (teacherDayLoad.get(`${bT.id}_${peer.day}`) || 0) === 1;
                      const bAfter = getTeacherActiveDaysCount(bT.id) - (bEmpties ? 1 : 0) + (bOpens ? 1 : 0);
                      if (bOpens && bAfter > bEffMax) return false;
                    }
                  }
                  return true;
                });

                if (singlePeers.length > 0) {
                  const peer = singlePeers[0];
                  const peerDay = peer.day;
                  const peerPeriod = peer.periodIndex;
                  const peerKey = `${peer.classId}_${peer.sectionId}_${peerDay}_${peerPeriod}`;
                  for (const pe of pairList) {
                    updateTeacherAndSubjectCountsOnMove(pe, secCtx, donorDay, oldPeriod, peerDay, peerPeriod);
                  }
                  updateTeacherAndSubjectCountsOnMove(peer, secCtx, peerDay, peerPeriod, donorDay, oldPeriod);
                  sectionBookings.set(oldSlotKey, [peer]);
                  sectionBookings.set(peerKey, pairList);
                  movedOne = true;
                  compactedAny = true;
                  break;
                }
              }
            }
          }

          // Strategy 4: Slide teacher's own blocker on targetActiveDay in another section so entryDonor can swap/move onto targetActiveDay
          if (!movedOne) {
            for (const entryDonor of donorEntries) {
              if (movedOne) break;
              const secCtx = sectionContextMap.get(`${entryDonor.classId}_${entryDonor.sectionId}`);
              if (!secCtx) continue;

              for (const targetDay of targetActiveDays) {
                if (movedOne) break;
                const dDay = entryDonor.day;
                const dPeriod = entryDonor.periodIndex;
                const candidatePeers = resultEntries.filter(peer => {
                  if (peer.classId !== entryDonor.classId || peer.sectionId !== entryDonor.sectionId) return false;
                  if (peer.day !== targetDay || peer.subjectId === entryDonor.subjectId) return false;
                  if (isReligionSubject(peer.subjectId, subjects) || !peer.teacherId || peer.teacherId === teacher.id) return false;
                  const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                  if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                  if (!isPeriodAllowedForSubject(entryDonor.classId, entryDonor.sectionId, entryDonor.subjectId, peer.periodIndex)) return false;
                  if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, dPeriod)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, entryDonor.subjectId, targetDay, dDay)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dDay, targetDay)) return false;
                  if (isSubjectDedicatedRoomConflict(entryDonor.subjectId, targetDay, peer.periodIndex, entryDonor.room, entryDonor.classId, entryDonor.sectionId)) return false;
                  if (isSubjectDedicatedRoomConflict(peer.subjectId, dDay, dPeriod, peer.room, peer.classId, peer.sectionId)) return false;
                  if (isTeacherBlockedAtSlot(teacher, targetDay, peer.periodIndex)) return false;
                  const bT = teacherMap.get(peer.teacherId);
                  if (!bT || isTeacherBlockedAtSlot(bT, dDay, dPeriod)) return false;
                  if ((teacherDayLoad.get(`${bT.id}_${dDay}`) || 0) >= getTeacherDailyMax(bT, settings)) return false;
                  return true;
                });

                for (const peer of candidatePeers) {
                  const pPeriod = peer.periodIndex;
                  const bT = teacherMap.get(peer.teacherId!)!;
                  // If teacher himself holds another class at (targetDay, pPeriod), try relocating it onto an open slot/same-day swap on targetDay
                  if (teacherBookings.has(`${teacher.id}_${targetDay}_${pPeriod}`)) {
                    tryRelocateTeacherBlockerAtSlot(teacher, targetDay, pPeriod, false);
                  }
                  if (teacherBookings.has(`${bT.id}_${dDay}_${dPeriod}`)) {
                    tryRelocateTeacherBlockerAtSlot(bT, dDay, dPeriod, false);
                  }
                  if (
                    entryDonor.day === dDay &&
                    entryDonor.periodIndex === dPeriod &&
                    peer.day === targetDay &&
                    peer.periodIndex === pPeriod &&
                    canSwapEntriesPreservingWorkingDaysAndLimits(entryDonor, teacher, peer, false) &&
                    getSimulatedDayConsecutiveRun(teacher.id, targetDay, pPeriod) < 4
                  ) {
                    swapTwoEntriesInSection(secCtx, entryDonor, peer);
                    movedOne = true;
                    compactedAny = true;
                    break;
                  }
                }
              }
            }
          }

          // Strategy 5: Religion slot compaction onto targetActiveDays (e.g. Maulana Abdul Karim <= 4 working days)
          if (!movedOne) {
            const relDonorSlots: TimetableEntry[][] = [];
            const seenRel = new Set<string>();
            resultEntries.forEach(e => {
              if (e.teacherId !== teacher.id || e.day !== donorDay) return;
              if (!isReligionSubject(e.subjectId, subjects)) return;
              if (isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)) return;
              const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
              if (seenRel.has(sk)) return;
              seenRel.add(sk);
              const list = sectionBookings.get(sk) || [];
              if (list.length > 0) relDonorSlots.push([...list]);
            });

            for (const relList of relDonorSlots) {
              if (movedOne) break;
              const lead = relList[0];
              const secCtx = sectionContextMap.get(`${lead.classId}_${lead.sectionId}`);
              if (!secCtx) continue;
              const oldPeriod = lead.periodIndex;
              const oldSlotKey = `${lead.classId}_${lead.sectionId}_${donorDay}_${oldPeriod}`;

              // 5A: Open slot on targetActiveDay
              for (const targetDay of targetActiveDays) {
                const availIdx = secCtx.availableSlots.findIndex(slot => {
                  if (slot.day !== targetDay) return false;
                  const dp = `${slot.day}_${slot.periodIndex}`;
                  if ((religionSlotSections.get(dp)?.size || 0) >= maxRelConcurrent) return false;
                  return relList.every(re => {
                    if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, slot.periodIndex)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, re.subjectId, slot.day, donorDay)) return false;
                    if (isSubjectDedicatedRoomConflict(re.subjectId, slot.day, slot.periodIndex, re.room, re.classId, re.sectionId)) return false;
                    if (isHinduReligionSubject(re.subjectId, subjects)) {
                      const otherHin = resultEntries.find(
                        o => o.day === slot.day && o.periodIndex === slot.periodIndex && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                      );
                      if (otherHin && otherHin.teacherId !== re.teacherId) return false;
                    }
                    return canTeacherMoveToSlot(re.teacherId, slot.day, slot.periodIndex, donorDay, true, re.subjectId, re.room);
                  });
                });
                if (availIdx !== -1) {
                  const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
                  for (const re of relList) {
                    updateTeacherAndSubjectCountsOnMove(re, secCtx, donorDay, oldPeriod, destSlot.day, destSlot.periodIndex);
                  }
                  sectionBookings.delete(oldSlotKey);
                  sectionBookings.set(`${lead.classId}_${lead.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, relList);
                  secCtx.availableSlots.push({ day: donorDay, periodIndex: oldPeriod });
                  movedOne = true;
                  compactedAny = true;
                  break;
                }
              }

              // 5B: Swap Religion slot with a single non-religion peer on targetActiveDay in same section (relocating peer blocker if needed)
              if (!movedOne) {
                const candidateRelPeers = resultEntries.filter(peer => {
                  if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                  if (!targetActiveDays.includes(peer.day) || isReligionSubject(peer.subjectId, subjects)) return false;
                  const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                  if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                  const dp = `${peer.day}_${peer.periodIndex}`;
                  if ((religionSlotSections.get(dp)?.size || 0) >= maxRelConcurrent) return false;

                  const relOk = relList.every(re => {
                    if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, peer.periodIndex)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, re.subjectId, peer.day, donorDay)) return false;
                    if (isSubjectDedicatedRoomConflict(re.subjectId, peer.day, peer.periodIndex, re.room, re.classId, re.sectionId)) return false;
                    if (isHinduReligionSubject(re.subjectId, subjects)) {
                      const otherHin = resultEntries.find(
                        o => o.day === peer.day && o.periodIndex === peer.periodIndex && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                      );
                      if (otherHin && otherHin.teacherId !== re.teacherId) return false;
                    }
                    if (re.teacherId !== teacher.id && re.teacherId) {
                      const pt = teacherMap.get(re.teacherId);
                      if (pt && !blockTeacherIdSet.has(pt.id)) {
                        const ptNewDay = (teacherDayLoad.get(`${pt.id}_${peer.day}`) || 0) === 0;
                        const ptMaxW = getTeacherMaxWorkingDays(pt, settings);
                        const ptNeed5 = (dedicatedLoadEstimate.get(pt.id) || 0) > ptMaxW * getTeacherDailyMax(pt, settings);
                        if (!ptNeed5 && ptNewDay && getTeacherActiveDaysCount(pt.id) >= ptMaxW) return false;
                      }
                    }
                    return canTeacherMoveToSlot(re.teacherId, peer.day, peer.periodIndex, donorDay, true, re.subjectId, re.room);
                  });
                  if (!relOk) return false;

                  if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldPeriod)) return false;
                  if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, donorDay, peer.day)) return false;
                  if (isSubjectDedicatedRoomConflict(peer.subjectId, donorDay, oldPeriod, peer.room, peer.classId, peer.sectionId)) return false;
                  if (peer.teacherId) {
                    const bT = teacherMap.get(peer.teacherId);
                    if (!bT || isTeacherBlockedAtSlot(bT, donorDay, oldPeriod)) return false;
                    if ((teacherDayLoad.get(`${bT.id}_${donorDay}`) || 0) >= getTeacherDailyMax(bT, settings)) return false;
                    if (!blockTeacherIdSet.has(bT.id)) {
                      const bMaxW = getTeacherMaxWorkingDays(bT, settings);
                      const bNeed5 = (dedicatedLoadEstimate.get(bT.id) || 0) > bMaxW * getTeacherDailyMax(bT, settings);
                      const bEffMax = bNeed5 ? workingDays.length : bMaxW;
                      const bOpens = (teacherDayLoad.get(`${bT.id}_${donorDay}`) || 0) === 0;
                      const bEmpties = (teacherDayLoad.get(`${bT.id}_${peer.day}`) || 0) === 1;
                      const bAfter = getTeacherActiveDaysCount(bT.id) - (bEmpties ? 1 : 0) + (bOpens ? 1 : 0);
                      if (bOpens && bAfter > bEffMax) return false;
                    }
                  }
                  return true;
                });

                for (const swapPeer of candidateRelPeers) {
                  const pDay = swapPeer.day;
                  const pPeriod = swapPeer.periodIndex;
                  if (swapPeer.teacherId) {
                    const bT = teacherMap.get(swapPeer.teacherId);
                    if (bT && teacherBookings.has(`${bT.id}_${donorDay}_${oldPeriod}`)) {
                      tryRelocateTeacherBlockerAtSlot(bT, donorDay, oldPeriod, false);
                    }
                  }
                  if (
                    lead.day === donorDay &&
                    lead.periodIndex === oldPeriod &&
                    swapPeer.day === pDay &&
                    swapPeer.periodIndex === pPeriod &&
                    (!swapPeer.teacherId ||
                      canTeacherMoveToSlot(swapPeer.teacherId, donorDay, oldPeriod, pDay, true, swapPeer.subjectId, swapPeer.room))
                  ) {
                    const peerKey = `${swapPeer.classId}_${swapPeer.sectionId}_${pDay}_${pPeriod}`;
                    for (const re of relList) {
                      updateTeacherAndSubjectCountsOnMove(re, secCtx, donorDay, oldPeriod, pDay, pPeriod);
                    }
                    updateTeacherAndSubjectCountsOnMove(swapPeer, secCtx, pDay, pPeriod, donorDay, oldPeriod);
                    sectionBookings.set(oldSlotKey, [swapPeer]);
                    sectionBookings.set(peerKey, relList);
                    movedOne = true;
                    compactedAny = true;
                    break;
                  }
                }
              }
            }
          }
        }

        if (!movedOne) break;
      }
    }

    if (!compactedAny) break;
  }

  // Pass 6B: Rebalance daily class loads across each teacher's active working days
  // (maxActiveLoad - minActiveLoad <= 1) without opening new working days
  for (let balRound = 0; balRound < 3; balRound++) {
    let balancedAny = false;
    for (const teacher of teachers) {
      if (blockTeacherIdSet.has(teacher.id)) continue;
      const maxDaily = getTeacherDailyMax(teacher, settings);

      for (let step = 0; step < 6; step++) {
        const active = workingDays
          .map(d => ({ day: d, count: teacherDayLoad.get(`${teacher.id}_${d}`) || 0 }))
          .filter(x => x.count > 0)
          .sort((a, b) => a.count - b.count);
        if (active.length < 2) break;
        const minLoad = active[0].count;
        const maxLoad = active[active.length - 1].count;
        if (maxLoad - minLoad <= 1) break;

        const heavyDay = active[active.length - 1].day;
        const lightDays = active
          .filter(x => x.count <= maxLoad - 2 && x.count < maxDaily)
          .map(x => x.day);
        if (lightDays.length === 0) break;

        let moved = false;
        const heavyEntries = resultEntries.filter(e => {
          if (e.teacherId !== teacher.id || e.day !== heavyDay) return false;
          if (isReligionSubject(e.subjectId, subjects)) return false;
          const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
          return (sectionBookings.get(sk)?.length || 0) === 1;
        });

        for (const eHeavy of heavyEntries) {
          if (moved) break;
          const secCtx = sectionContextMap.get(`${eHeavy.classId}_${eHeavy.sectionId}`);
          if (!secCtx) continue;

          // Open slot on light active day
          for (const dLight of lightDays) {
            const availIdx = secCtx.availableSlots.findIndex(slot => {
              if (slot.day !== dLight) return false;
              if (!isPeriodAllowedForSubject(eHeavy.classId, eHeavy.sectionId, eHeavy.subjectId, slot.periodIndex)) return false;
              if (wouldViolateSubjectDailyLimit(secCtx, eHeavy.subjectId, slot.day, heavyDay)) return false;
              if (isSubjectDedicatedRoomConflict(eHeavy.subjectId, slot.day, slot.periodIndex, eHeavy.room, eHeavy.classId, eHeavy.sectionId)) return false;
              if (getSimulatedDayConsecutiveRun(teacher.id, slot.day, slot.periodIndex) >= 3) return false;
              return canTeacherMoveToSlot(teacher.id, slot.day, slot.periodIndex, heavyDay, true, eHeavy.subjectId, eHeavy.room);
            });
            if (availIdx !== -1) {
              const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
              const oldPeriod = eHeavy.periodIndex;
              const oldSlotKey = `${eHeavy.classId}_${eHeavy.sectionId}_${heavyDay}_${oldPeriod}`;
              updateTeacherAndSubjectCountsOnMove(eHeavy, secCtx, heavyDay, oldPeriod, destSlot.day, destSlot.periodIndex);
              sectionBookings.delete(oldSlotKey);
              sectionBookings.set(`${eHeavy.classId}_${eHeavy.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, [eHeavy]);
              secCtx.availableSlots.push({ day: heavyDay, periodIndex: oldPeriod });
              moved = true;
              balancedAny = true;
              break;
            }
          }

          if (!moved) {
            const peer = resultEntries.find(p => {
              if (p.classId !== eHeavy.classId || p.sectionId !== eHeavy.sectionId) return false;
              if (p.subjectId === eHeavy.subjectId || !lightDays.includes(p.day)) return false;
              if (!canSwapEntriesPreservingWorkingDaysAndLimits(eHeavy, teacher, p, false)) return false;
              return getSimulatedDayConsecutiveRun(teacher.id, p.day, p.periodIndex) <= 2;
            });
            if (peer) {
              swapTwoEntriesInSection(secCtx, eHeavy, peer);
              moved = true;
              balancedAny = true;
            }
          }
        }
        if (!moved) break;
      }
    }
    if (!balancedAny) break;
  }

  // ===========================================================================
  // PASS 7: Consecutive Streak Elimination Pass
  //         Strictly eliminates ALL 4+ consecutive streaks (0 allowed) and
  //         minimizes 3-consecutive streaks (<= 2 days/week max, 0 ideal)
  //         preferring same-day moves/swaps first so working days stay <= 4.
  // ===========================================================================
  const getTeacherDayStreaks = (teacherId: string, day: DayOfWeek): number[][] => {
    const periods = teachingPeriods
      .filter(p => teacherBookings.has(`${teacherId}_${day}_${p}`))
      .sort((a, b) => a - b);
    const streaks: number[][] = [];
    let current: number[] = [];
    for (const p of periods) {
      if (current.length === 0 || p === current[current.length - 1] + 1) {
        current.push(p);
      } else {
        if (current.length >= 3) streaks.push(current);
        current = [p];
      }
    }
    if (current.length >= 3) streaks.push(current);
    return streaks;
  };

  for (let streakRound = 0; streakRound < 8; streakRound++) {
    let fixedStreak = false;

    for (const teacher of teachers) {
      if (blockTeacherIdSet.has(teacher.id)) continue;

      for (const day of workingDays) {
        const streaks = getTeacherDayStreaks(teacher.id, day);
        if (streaks.length === 0) continue;

        // Sort longest streaks (4+ strictly first)
        streaks.sort((a, b) => b.length - a.length);

        for (const streak of streaks) {
          const isFourPlus = streak.length >= 4;
          const runTargetCap = isFourPlus ? 3 : 2; // Never leave a 4+ streak; break 3-run to <=2

          // Try middle periods first so breaking 1 period splits [1,2,3] -> [1],[3] or [1,2,3,4] -> [1,2],[4]
          const candidatePeriods: number[] = [];
          const midIdx = Math.floor(streak.length / 2);
          candidatePeriods.push(streak[midIdx]);
          for (let offset = 1; offset < streak.length; offset++) {
            if (midIdx - offset >= 0) candidatePeriods.push(streak[midIdx - offset]);
            if (midIdx + offset < streak.length) candidatePeriods.push(streak[midIdx + offset]);
          }

          let brokeThisStreak = false;

          for (const pSrc of candidatePeriods) {
            if (brokeThisStreak) break;
            const dayEntriesAtP = resultEntries.filter(e => {
              if (e.teacherId !== teacher.id || e.day !== day || e.periodIndex !== pSrc) return false;
              const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
              if ((sectionBookings.get(sk)?.length || 0) !== 1) return false;
              // Do not split multi-section combined Hindu Room 307 sessions
              if (isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)) {
                return false;
              }
              return true;
            });

            for (const entrySrc of dayEntriesAtP) {
              if (brokeThisStreak) break;
              const secCtx = sectionContextMap.get(`${entrySrc.classId}_${entrySrc.sectionId}`);
              if (!secCtx) continue;

              // Method A: Same-day move into an open slot in the same section (keeps working days & daily load invariant!)
              const openSameDayIdx = secCtx.availableSlots.findIndex(slot => {
                if (slot.day !== day) return false;
                if (!isPeriodAllowedForSubject(entrySrc.classId, entrySrc.sectionId, entrySrc.subjectId, slot.periodIndex)) {
                  return false;
                }
                if (
                  isSubjectDedicatedRoomConflict(
                    entrySrc.subjectId,
                    day,
                    slot.periodIndex,
                    entrySrc.room,
                    entrySrc.classId,
                    entrySrc.sectionId
                  )
                ) {
                  return false;
                }
                if (isTeacherBlockedAtSlot(teacher, day, slot.periodIndex)) return false;
                if (teacherBookings.has(`${teacher.id}_${day}_${slot.periodIndex}`)) return false;

                const newRun = getSimulatedDayConsecutiveRun(teacher.id, day, slot.periodIndex, pSrc);
                return newRun <= runTargetCap && newRun < streak.length;
              });

              if (openSameDayIdx !== -1) {
                const destSlot = secCtx.availableSlots.splice(openSameDayIdx, 1)[0];
                const oldKey = `${entrySrc.classId}_${entrySrc.sectionId}_${day}_${pSrc}`;
                updateTeacherAndSubjectCountsOnMove(entrySrc, secCtx, day, pSrc, day, destSlot.periodIndex);
                sectionBookings.delete(oldKey);
                sectionBookings.set(`${entrySrc.classId}_${entrySrc.sectionId}_${day}_${destSlot.periodIndex}`, [entrySrc]);
                secCtx.availableSlots.push({ day, periodIndex: pSrc });
                brokeThisStreak = true;
                fixedStreak = true;
                break;
              }

              // Method B: Same-day intra-section swap (keeps active working days & daily load 100% invariant!)
              const teacherThreeDaysNow = workingDays.filter(
                d => getTeacherDayStreaks(teacher.id, d).some(s => s.length >= 3)
              ).length;
              const sameDayPeers = resultEntries.filter(peer => {
                if (peer.classId !== entrySrc.classId || peer.sectionId !== entrySrc.sectionId) return false;
                if (peer.day !== day || peer.periodIndex === pSrc) return false;
                if (peer.subjectId === entrySrc.subjectId) return false;
                if (!canSwapEntriesPreservingWorkingDaysAndLimits(entrySrc, teacher, peer, true)) return false;

                const aRunAfter = getSimulatedDayConsecutiveRun(teacher.id, day, peer.periodIndex, pSrc);
                if (aRunAfter > runTargetCap || aRunAfter >= streak.length) return false;

                if (peer.teacherId) {
                  const bRunAfter = getSimulatedDayConsecutiveRun(peer.teacherId, day, pSrc, peer.periodIndex);
                  if (bRunAfter >= 4) return false;
                  if (!isFourPlus && bRunAfter >= 3) {
                    const bThreeDaysNow = workingDays.filter(
                      d => getTeacherDayStreaks(peer.teacherId, d).some(s => s.length >= 3)
                    ).length;
                    const allowTrade =
                      teacherThreeDaysNow > MAX_UNAVOIDABLE_THREE_CONSECUTIVE_DAYS &&
                      bThreeDaysNow < MAX_UNAVOIDABLE_THREE_CONSECUTIVE_DAYS;
                    if (!allowTrade) return false;
                  }
                }
                return true;
              });

              if (sameDayPeers.length > 0) {
                // Pick swap minimizing teacher's post-swap run
                sameDayPeers.sort((a, b) => {
                  const rA = getSimulatedDayConsecutiveRun(teacher.id, day, a.periodIndex, pSrc);
                  const rB = getSimulatedDayConsecutiveRun(teacher.id, day, b.periodIndex, pSrc);
                  return rA - rB;
                });
                swapTwoEntriesInSection(secCtx, entrySrc, sameDayPeers[0]);
                brokeThisStreak = true;
                fixedStreak = true;
                break;
              }

              // Method B2: Same-day 2-step 3-cycle intra-section swap (keeps active working days & daily load 100% invariant!)
              if (!brokeThisStreak) {
                const sameDayMids = resultEntries.filter(m => {
                  if (m.classId !== entrySrc.classId || m.sectionId !== entrySrc.sectionId) return false;
                  if (m.day !== day || m.periodIndex === pSrc || m.subjectId === entrySrc.subjectId) return false;
                  if (isReligionSubject(m.subjectId, subjects)) return false;
                  const skM = `${m.classId}_${m.sectionId}_${m.day}_${m.periodIndex}`;
                  if ((sectionBookings.get(skM)?.length || 0) !== 1) return false;
                  if (!isPeriodAllowedForSubject(entrySrc.classId, entrySrc.sectionId, entrySrc.subjectId, m.periodIndex)) return false;
                  if (isSubjectDedicatedRoomConflict(entrySrc.subjectId, day, m.periodIndex, entrySrc.room, entrySrc.classId, entrySrc.sectionId)) return false;
                  if (isTeacherBlockedAtSlot(teacher, day, m.periodIndex)) return false;
                  if (teacherBookings.has(`${teacher.id}_${day}_${m.periodIndex}`)) return false;
                  const aRunAfter = getSimulatedDayConsecutiveRun(teacher.id, day, m.periodIndex, pSrc);
                  return aRunAfter <= runTargetCap && aRunAfter < streak.length;
                });

                for (const mid of sameDayMids) {
                  if (brokeThisStreak) break;
                  const finals = resultEntries.filter(f => {
                    if (f.classId !== entrySrc.classId || f.sectionId !== entrySrc.sectionId) return false;
                    if (f.day !== day || f.id === entrySrc.id || f.id === mid.id) return false;
                    if (f.subjectId === mid.subjectId || f.teacherId === teacher.id || f.teacherId === mid.teacherId) return false;
                    if (isReligionSubject(f.subjectId, subjects)) return false;
                    const skF = `${f.classId}_${f.sectionId}_${f.day}_${f.periodIndex}`;
                    if ((sectionBookings.get(skF)?.length || 0) !== 1) return false;

                    if (!isPeriodAllowedForSubject(mid.classId, mid.sectionId, mid.subjectId, f.periodIndex)) return false;
                    if (isSubjectDedicatedRoomConflict(mid.subjectId, day, f.periodIndex, mid.room, mid.classId, mid.sectionId)) return false;
                    if (mid.teacherId) {
                      const mt = teacherMap.get(mid.teacherId);
                      if (!mt || isTeacherBlockedAtSlot(mt, day, f.periodIndex)) return false;
                      if (teacherBookings.has(`${mt.id}_${day}_${f.periodIndex}`)) return false;
                      const mRunAfter = getSimulatedDayConsecutiveRun(mt.id, day, f.periodIndex, mid.periodIndex);
                      if (mRunAfter >= (isFourPlus ? 4 : 3)) return false;
                    }

                    if (!isPeriodAllowedForSubject(f.classId, f.sectionId, f.subjectId, pSrc)) return false;
                    if (isSubjectDedicatedRoomConflict(f.subjectId, day, pSrc, f.room, f.classId, f.sectionId)) return false;
                    if (f.teacherId) {
                      const ft = teacherMap.get(f.teacherId);
                      if (!ft || isTeacherBlockedAtSlot(ft, day, pSrc)) return false;
                      if (teacherBookings.has(`${ft.id}_${day}_${pSrc}`)) return false;
                      const fRunAfter = getSimulatedDayConsecutiveRun(ft.id, day, pSrc, f.periodIndex);
                      if (fRunAfter >= (isFourPlus ? 4 : 3)) return false;
                    }
                    return true;
                  });

                  if (finals.length > 0) {
                    const fin = finals[0];
                    swapTwoEntriesInSection(secCtx, entrySrc, fin);
                    swapTwoEntriesInSection(secCtx, entrySrc, mid);
                    brokeThisStreak = true;
                    fixedStreak = true;
                    break;
                  }
                }
              }

              // Method B3: Same-day swap with blocker relocation for stubborn 3-consec/4+ streaks
              if (!brokeThisStreak) {
                const threeNowB3 = workingDays.filter(d => getTeacherDayStreaks(teacher.id, d).some(s => s.length >= 3)).length;
                if (isFourPlus || threeNowB3 > MAX_UNAVOIDABLE_THREE_CONSECUTIVE_DAYS) {
                  const b3Peers = resultEntries.filter(peer => {
                    if (peer.classId !== entrySrc.classId || peer.sectionId !== entrySrc.sectionId) return false;
                    if (peer.day !== day || peer.periodIndex === pSrc || peer.subjectId === entrySrc.subjectId) return false;
                    if (isReligionSubject(peer.subjectId, subjects) || !peer.teacherId || peer.teacherId === teacher.id) return false;
                    const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                    if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                    if (!isPeriodAllowedForSubject(entrySrc.classId, entrySrc.sectionId, entrySrc.subjectId, peer.periodIndex)) return false;
                    if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, pSrc)) return false;
                    if (isSubjectDedicatedRoomConflict(entrySrc.subjectId, day, peer.periodIndex, entrySrc.room, entrySrc.classId, entrySrc.sectionId)) return false;
                    if (isSubjectDedicatedRoomConflict(peer.subjectId, day, pSrc, peer.room, peer.classId, peer.sectionId)) return false;
                    if (isTeacherBlockedAtSlot(teacher, day, peer.periodIndex)) return false;
                    const bT = teacherMap.get(peer.teacherId);
                    if (!bT || isTeacherBlockedAtSlot(bT, day, pSrc)) return false;
                    const aRunAfter = getSimulatedDayConsecutiveRun(teacher.id, day, peer.periodIndex, pSrc);
                    if (aRunAfter > runTargetCap || aRunAfter >= streak.length) return false;
                    const bRunAfter = getSimulatedDayConsecutiveRun(bT.id, day, pSrc, peer.periodIndex);
                    if (bRunAfter >= (isFourPlus ? 4 : 3)) return false;
                    return true;
                  });

                  for (const peer of b3Peers) {
                    const pPer = peer.periodIndex;
                    const bT = teacherMap.get(peer.teacherId!)!;
                    if (teacherBookings.has(`${teacher.id}_${day}_${pPer}`)) {
                      tryRelocateTeacherBlockerAtSlot(teacher, day, pPer, false);
                    }
                    if (teacherBookings.has(`${bT.id}_${day}_${pSrc}`)) {
                      tryRelocateTeacherBlockerAtSlot(bT, day, pSrc, false);
                    }
                    if (
                      entrySrc.day === day &&
                      entrySrc.periodIndex === pSrc &&
                      peer.day === day &&
                      peer.periodIndex === pPer &&
                      canSwapEntriesPreservingWorkingDaysAndLimits(entrySrc, teacher, peer, true) &&
                      getSimulatedDayConsecutiveRun(teacher.id, day, pPer, pSrc) <= runTargetCap &&
                      getSimulatedDayConsecutiveRun(bT.id, day, pSrc, pPer) < (isFourPlus ? 4 : 3)
                    ) {
                      swapTwoEntriesInSection(secCtx, entrySrc, peer);
                      brokeThisStreak = true;
                      fixedStreak = true;
                      break;
                    }
                  }
                }
              }

              // Method C: Cross-day move/swap onto already-active day when 4+ or >2 days of 3-run persists
              const threeDaysCount = workingDays.filter(
                d => getTeacherDayStreaks(teacher.id, d).some(s => s.length >= 3)
              ).length;
              if (isFourPlus || threeDaysCount > MAX_UNAVOIDABLE_THREE_CONSECUTIVE_DAYS) {
                const maxDaily = getTeacherDailyMax(teacher, settings);
                const otherUnderDays = workingDays
                  .filter(d => d !== day && (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) > 0 && (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) < maxDaily)
                  .sort((a, b) => (teacherDayLoad.get(`${teacher.id}_${a}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${b}`) || 0));

                for (const otherDay of otherUnderDays) {
                  const availIdx = secCtx.availableSlots.findIndex(slot => {
                    if (slot.day !== otherDay) return false;
                    if (!isPeriodAllowedForSubject(entrySrc.classId, entrySrc.sectionId, entrySrc.subjectId, slot.periodIndex)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, entrySrc.subjectId, otherDay, day)) return false;
                    if (isSubjectDedicatedRoomConflict(entrySrc.subjectId, otherDay, slot.periodIndex, entrySrc.room, entrySrc.classId, entrySrc.sectionId)) return false;
                    if (getSimulatedDayConsecutiveRun(teacher.id, otherDay, slot.periodIndex) >= 3) return false;
                    return canTeacherMoveToSlot(teacher.id, otherDay, slot.periodIndex, day, true, entrySrc.subjectId, entrySrc.room, pSrc);
                  });

                  if (availIdx !== -1) {
                    const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
                    const oldKey = `${entrySrc.classId}_${entrySrc.sectionId}_${day}_${pSrc}`;
                    updateTeacherAndSubjectCountsOnMove(entrySrc, secCtx, day, pSrc, otherDay, destSlot.periodIndex);
                    sectionBookings.delete(oldKey);
                    sectionBookings.set(`${entrySrc.classId}_${entrySrc.sectionId}_${otherDay}_${destSlot.periodIndex}`, [entrySrc]);
                    secCtx.availableSlots.push({ day, periodIndex: pSrc });
                    brokeThisStreak = true;
                    fixedStreak = true;
                    break;
                  }

                  const crossPeers = resultEntries.filter(peer => {
                    if (peer.classId !== entrySrc.classId || peer.sectionId !== entrySrc.sectionId) return false;
                    if (peer.day !== otherDay || peer.subjectId === entrySrc.subjectId) return false;
                    if (isReligionSubject(peer.subjectId, subjects) || peer.teacherId === teacher.id) return false;
                    const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                    if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                    if (!isPeriodAllowedForSubject(entrySrc.classId, entrySrc.sectionId, entrySrc.subjectId, peer.periodIndex)) return false;
                    if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, pSrc)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, entrySrc.subjectId, otherDay, day)) return false;
                    if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, day, otherDay)) return false;
                    if (isSubjectDedicatedRoomConflict(entrySrc.subjectId, otherDay, peer.periodIndex, entrySrc.room, entrySrc.classId, entrySrc.sectionId)) return false;
                    if (isSubjectDedicatedRoomConflict(peer.subjectId, day, pSrc, peer.room, peer.classId, peer.sectionId)) return false;
                    if (isTeacherBlockedAtSlot(teacher, otherDay, peer.periodIndex)) return false;
                    if (getSimulatedDayConsecutiveRun(teacher.id, otherDay, peer.periodIndex) >= 3) return false;
                    if (peer.teacherId) {
                      const bT = teacherMap.get(peer.teacherId);
                      if (!bT || isTeacherBlockedAtSlot(bT, day, pSrc)) return false;
                      if (!isFourPlus && getSimulatedDayConsecutiveRun(bT.id, day, pSrc) >= 3) return false;
                      if (isFourPlus && getSimulatedDayConsecutiveRun(bT.id, day, pSrc) >= 4) return false;
                    }
                    return true;
                  });

                  for (const crossPeer of crossPeers) {
                    const cpPer = crossPeer.periodIndex;
                    const bT = crossPeer.teacherId ? teacherMap.get(crossPeer.teacherId) : undefined;
                    if (teacherBookings.has(`${teacher.id}_${otherDay}_${cpPer}`)) {
                      tryRelocateTeacherBlockerAtSlot(teacher, otherDay, cpPer, false);
                    }
                    if (bT && (teacherDayLoad.get(`${bT.id}_${day}`) || 0) >= getTeacherDailyMax(bT, settings)) {
                      tryFreeOneDaySlotForTeacher(bT, day);
                    }
                    if (bT && teacherBookings.has(`${bT.id}_${day}_${pSrc}`)) {
                      tryRelocateTeacherBlockerAtSlot(bT, day, pSrc, false);
                    }
                    if (
                      entrySrc.day === day &&
                      entrySrc.periodIndex === pSrc &&
                      crossPeer.day === otherDay &&
                      crossPeer.periodIndex === cpPer &&
                      canSwapEntriesPreservingWorkingDaysAndLimits(entrySrc, teacher, crossPeer, false) &&
                      getSimulatedDayConsecutiveRun(teacher.id, otherDay, cpPer) < 3 &&
                      (!bT || getSimulatedDayConsecutiveRun(bT.id, day, pSrc) < (isFourPlus ? 4 : 3))
                    ) {
                      swapTwoEntriesInSection(secCtx, entrySrc, crossPeer);
                      brokeThisStreak = true;
                      fixedStreak = true;
                      break;
                    }
                  }
                  if (brokeThisStreak) break;

                  // Cross-day swap with a Religion slot (1 or 2 entries) on otherDay when single non-rel peers are exhausted
                  const relSlotsOtherDay = Array.from(
                    new Set(
                      resultEntries
                        .filter(
                          e =>
                            e.classId === entrySrc.classId &&
                            e.sectionId === entrySrc.sectionId &&
                            e.day === otherDay &&
                            isReligionSubject(e.subjectId, subjects)
                        )
                        .map(e => e.periodIndex)
                    )
                  );
                  for (const rPer of relSlotsOtherDay) {
                    const relList = sectionBookings.get(`${entrySrc.classId}_${entrySrc.sectionId}_${otherDay}_${rPer}`) || [];
                    if (relList.length === 0 || !relList.every(re => isReligionSubject(re.subjectId, subjects))) continue;
                    if (relList.some(re => re.teacherId === teacher.id)) continue;
                    const srcDp = `${day}_${pSrc}`;
                    const destSecKey = `${entrySrc.classId}_${entrySrc.sectionId}`;
                    if ((religionSlotSections.get(srcDp)?.size || 0) >= maxRelConcurrent && !religionSlotSections.get(srcDp)?.has(destSecKey)) continue;
                    if (!isPeriodAllowedForSubject(entrySrc.classId, entrySrc.sectionId, entrySrc.subjectId, rPer)) continue;
                    if (wouldViolateSubjectDailyLimit(secCtx, entrySrc.subjectId, otherDay, day)) continue;
                    if (isSubjectDedicatedRoomConflict(entrySrc.subjectId, otherDay, rPer, entrySrc.room, entrySrc.classId, entrySrc.sectionId)) continue;
                    if (isTeacherBlockedAtSlot(teacher, otherDay, rPer)) continue;
                    if (teacherBookings.has(`${teacher.id}_${otherDay}_${rPer}`)) continue;
                    if (getSimulatedDayConsecutiveRun(teacher.id, otherDay, rPer) >= 3) continue;

                    const relStaticOk = relList.every(re => {
                      if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, pSrc)) return false;
                      if (wouldViolateSubjectDailyLimit(secCtx, re.subjectId, day, otherDay)) return false;
                      if (isSubjectDedicatedRoomConflict(re.subjectId, day, pSrc, re.room, re.classId, re.sectionId)) return false;
                      if (isHinduReligionSubject(re.subjectId, subjects)) {
                        const otherHin = resultEntries.find(
                          o => o.day === day && o.periodIndex === pSrc && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                        );
                        if (otherHin && otherHin.teacherId !== re.teacherId) return false;
                      }
                      if (!re.teacherId) return true;
                      const rt = teacherMap.get(re.teacherId);
                      if (!rt || isTeacherBlockedAtSlot(rt, day, pSrc)) return false;
                      if (isTeacherSlotBusyFor(rt.id, re.subjectId, day, pSrc, re.room)) return false;
                      const rtInWave = teacherSlotEntries.has(`${rt.id}_${day}_${pSrc}`);
                      if (!rtInWave && (teacherDayLoad.get(`${rt.id}_${day}`) || 0) >= getTeacherDailyMax(rt, settings)) return false;
                      if (getSimulatedDayConsecutiveRun(rt.id, day, pSrc) >= (isFourPlus ? 4 : 3)) return false;
                      return true;
                    });
                    if (!relStaticOk) continue;

                    const oldKey = `${entrySrc.classId}_${entrySrc.sectionId}_${day}_${pSrc}`;
                    const relKey = `${entrySrc.classId}_${entrySrc.sectionId}_${otherDay}_${rPer}`;
                    updateTeacherAndSubjectCountsOnMove(entrySrc, secCtx, day, pSrc, otherDay, rPer);
                    for (const re of relList) {
                      updateTeacherAndSubjectCountsOnMove(re, secCtx, otherDay, rPer, day, pSrc);
                    }
                    sectionBookings.set(oldKey, [...relList]);
                    sectionBookings.set(relKey, [entrySrc]);
                    brokeThisStreak = true;
                    fixedStreak = true;
                    break;
                  }
                  if (brokeThisStreak) break;
                }

                // Equal-day cross-swap (with optional blocker relocation so stubborn >2-day 3-consec teachers break cleanly)
                if (!brokeThisStreak) {
                  const otherEqualDays = workingDays.filter(d => d !== day && (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) > 0 && (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) <= maxDaily);
                  for (const otherDay of otherEqualDays) {
                    if (brokeThisStreak) break;
                    const equalPeers = resultEntries.filter(peer => {
                      if (peer.classId !== entrySrc.classId || peer.sectionId !== entrySrc.sectionId) return false;
                      if (peer.day !== otherDay || peer.subjectId === entrySrc.subjectId) return false;
                      if (isReligionSubject(peer.subjectId, subjects) || !peer.teacherId || peer.teacherId === teacher.id) return false;
                      const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                      if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                      if (!isPeriodAllowedForSubject(entrySrc.classId, entrySrc.sectionId, entrySrc.subjectId, peer.periodIndex)) return false;
                      if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, pSrc)) return false;
                      if (wouldViolateSubjectDailyLimit(secCtx, entrySrc.subjectId, otherDay, day)) return false;
                      if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, day, otherDay)) return false;
                      if (isSubjectDedicatedRoomConflict(entrySrc.subjectId, otherDay, peer.periodIndex, entrySrc.room, entrySrc.classId, entrySrc.sectionId)) return false;
                      if (isSubjectDedicatedRoomConflict(peer.subjectId, day, pSrc, peer.room, peer.classId, peer.sectionId)) return false;
                      if (isTeacherBlockedAtSlot(teacher, otherDay, peer.periodIndex)) return false;
                      const bT = teacherMap.get(peer.teacherId);
                      if (!bT || isTeacherBlockedAtSlot(bT, day, pSrc)) return false;
                      if (getSimulatedDayConsecutiveRun(teacher.id, otherDay, peer.periodIndex) >= 3) return false;
                      if (getSimulatedDayConsecutiveRun(bT.id, day, pSrc) >= (isFourPlus ? 4 : 3)) return false;
                      return true;
                    });
                    for (const equalPeer of equalPeers) {
                      const epPer = equalPeer.periodIndex;
                      const bT = teacherMap.get(equalPeer.teacherId!)!;
                      if (teacherBookings.has(`${teacher.id}_${otherDay}_${epPer}`)) {
                        tryRelocateTeacherBlockerAtSlot(teacher, otherDay, epPer, false);
                      }
                      if (teacherBookings.has(`${bT.id}_${day}_${pSrc}`)) {
                        tryRelocateTeacherBlockerAtSlot(bT, day, pSrc, false);
                      }
                      if (
                        entrySrc.day === day &&
                        entrySrc.periodIndex === pSrc &&
                        equalPeer.day === otherDay &&
                        equalPeer.periodIndex === epPer &&
                        canSwapEntriesPreservingWorkingDaysAndLimits(entrySrc, teacher, equalPeer, false) &&
                        getSimulatedDayConsecutiveRun(teacher.id, otherDay, epPer) < 3 &&
                        getSimulatedDayConsecutiveRun(bT.id, day, pSrc) < (isFourPlus ? 4 : 3)
                      ) {
                        swapTwoEntriesInSection(secCtx, entrySrc, equalPeer);
                        brokeThisStreak = true;
                        fixedStreak = true;
                        break;
                      }
                    }
                  }
                }
              }

              // Method D: Same-day swap with a Religion slot (single Islam or Islam+Hindu) when non-religion peers are exhausted (e.g. Class 3-5)
              if (!brokeThisStreak) {
                const threeNow = workingDays.filter(d => getTeacherDayStreaks(teacher.id, d).some(s => s.length >= 3)).length;
                if (isFourPlus || threeNow > MAX_UNAVOIDABLE_THREE_CONSECUTIVE_DAYS) {
                  const relSlotPeriods = Array.from(
                    new Set(
                      resultEntries
                        .filter(
                          e =>
                            e.classId === entrySrc.classId &&
                            e.sectionId === entrySrc.sectionId &&
                            e.day === day &&
                            e.periodIndex !== pSrc &&
                            isReligionSubject(e.subjectId, subjects)
                        )
                        .map(e => e.periodIndex)
                    )
                  );

                  for (const rPeriod of relSlotPeriods) {
                    const relList = sectionBookings.get(`${entrySrc.classId}_${entrySrc.sectionId}_${day}_${rPeriod}`) || [];
                    if (relList.length === 0 || !relList.every(re => isReligionSubject(re.subjectId, subjects))) continue;
                    const srcDp = `${day}_${pSrc}`;
                    const destSecKey = `${entrySrc.classId}_${entrySrc.sectionId}`;
                    const srcRelSize = religionSlotSections.get(srcDp)?.size || 0;
                    if (srcRelSize >= maxRelConcurrent && !religionSlotSections.get(srcDp)?.has(destSecKey)) continue;

                    const aRunAfter = getSimulatedDayConsecutiveRun(teacher.id, day, rPeriod, pSrc);
                    if (aRunAfter > runTargetCap || aRunAfter >= streak.length) continue;
                    if (!isPeriodAllowedForSubject(entrySrc.classId, entrySrc.sectionId, entrySrc.subjectId, rPeriod)) continue;
                    if (isSubjectDedicatedRoomConflict(entrySrc.subjectId, day, rPeriod, entrySrc.room, entrySrc.classId, entrySrc.sectionId)) continue;
                    if (isTeacherBlockedAtSlot(teacher, day, rPeriod)) continue;
                    if (teacherBookings.has(`${teacher.id}_${day}_${rPeriod}`)) continue;

                    const relCanMove = relList.every(re => {
                      if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, pSrc)) return false;
                      if (isSubjectDedicatedRoomConflict(re.subjectId, day, pSrc, re.room, re.classId, re.sectionId)) return false;
                      if (isHinduReligionSubject(re.subjectId, subjects)) {
                        const otherHin = resultEntries.find(
                          o => o.day === day && o.periodIndex === pSrc && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                        );
                        if (otherHin && otherHin.teacherId !== re.teacherId) return false;
                      }
                      if (!re.teacherId || re.teacherId === teacher.id) return re.teacherId !== teacher.id;
                      const rt = teacherMap.get(re.teacherId);
                      if (!rt || isTeacherBlockedAtSlot(rt, day, pSrc)) return false;
                      if (isTeacherSlotBusyFor(rt.id, re.subjectId, day, pSrc, re.room)) return false;
                      const rRunAfter = getSimulatedDayConsecutiveRun(rt.id, day, pSrc, rPeriod);
                      if (rRunAfter >= 4) return false;
                      return true;
                    });
                    if (!relCanMove) continue;

                    const oldKey = `${entrySrc.classId}_${entrySrc.sectionId}_${day}_${pSrc}`;
                    const relKey = `${entrySrc.classId}_${entrySrc.sectionId}_${day}_${rPeriod}`;
                    updateTeacherAndSubjectCountsOnMove(entrySrc, secCtx, day, pSrc, day, rPeriod);
                    for (const re of relList) {
                      updateTeacherAndSubjectCountsOnMove(re, secCtx, day, rPeriod, day, pSrc);
                    }
                    sectionBookings.set(oldKey, [...relList]);
                    sectionBookings.set(relKey, [entrySrc]);
                    brokeThisStreak = true;
                    fixedStreak = true;
                    break;
                  }
                }
              }

              // Method C2: Cross-day 3-cycle onto an active under-cap day when >2 days of 3-run persists
              if (!brokeThisStreak) {
                const threeNowC2 = workingDays.filter(d => getTeacherDayStreaks(teacher.id, d).some(s => s.length >= 3)).length;
                if (isFourPlus || threeNowC2 > MAX_UNAVOIDABLE_THREE_CONSECUTIVE_DAYS) {
                  const maxDailyC2 = getTeacherDailyMax(teacher, settings);
                  const underDaysC2 = workingDays
                    .filter(
                      d =>
                        d !== day &&
                        (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) > 0 &&
                        (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) < maxDailyC2
                    )
                    .sort((a, b) => (teacherDayLoad.get(`${teacher.id}_${a}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${b}`) || 0));

                  for (const otherDay of underDaysC2) {
                    if (brokeThisStreak) break;
                    const singleEntriesOnOther = resultEntries.filter(e => {
                      if (e.classId !== entrySrc.classId || e.sectionId !== entrySrc.sectionId) return false;
                      if (e.day !== otherDay || isReligionSubject(e.subjectId, subjects)) return false;
                      if (e.teacherId === teacher.id) return false;
                      const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
                      return (sectionBookings.get(sk)?.length || 0) === 1;
                    });

                    for (const pEntry of singleEntriesOnOther) {
                      if (brokeThisStreak) break;
                      if (pEntry.subjectId === entrySrc.subjectId) continue;
                      const pP = pEntry.periodIndex;
                      if (!isPeriodAllowedForSubject(pEntry.classId, pEntry.sectionId, pEntry.subjectId, pSrc)) continue;
                      if (wouldViolateSubjectDailyLimit(secCtx, pEntry.subjectId, day, otherDay)) continue;
                      if (isSubjectDedicatedRoomConflict(pEntry.subjectId, day, pSrc, pEntry.room, pEntry.classId, pEntry.sectionId)) continue;
                      const pT = pEntry.teacherId ? teacherMap.get(pEntry.teacherId) : undefined;
                      if (pT) {
                        if (isTeacherBlockedAtSlot(pT, day, pSrc)) continue;
                        if (getSimulatedDayConsecutiveRun(pT.id, day, pSrc) >= (isFourPlus ? 4 : 3)) continue;
                      }

                      for (const qEntry of singleEntriesOnOther) {
                        if (qEntry.id === pEntry.id) continue;
                        if (qEntry.subjectId === entrySrc.subjectId || qEntry.subjectId === pEntry.subjectId) continue;
                        const qP = qEntry.periodIndex;
                        if (
                          entrySrc.day !== day ||
                          entrySrc.periodIndex !== pSrc ||
                          pEntry.day !== otherDay ||
                          pEntry.periodIndex !== pP ||
                          qEntry.day !== otherDay ||
                          qEntry.periodIndex !== qP
                        ) {
                          continue;
                        }

                        // entrySrc: (day, pSrc) -> (otherDay, qP)
                        if (!isPeriodAllowedForSubject(entrySrc.classId, entrySrc.sectionId, entrySrc.subjectId, qP)) continue;
                        if (wouldViolateSubjectDailyLimit(secCtx, entrySrc.subjectId, otherDay, day)) continue;
                        if (isSubjectDedicatedRoomConflict(entrySrc.subjectId, otherDay, qP, entrySrc.room, entrySrc.classId, entrySrc.sectionId)) continue;
                        if (isTeacherBlockedAtSlot(teacher, otherDay, qP)) continue;
                        if (getSimulatedDayConsecutiveRun(teacher.id, otherDay, qP) >= 3) continue;

                        // qEntry: (otherDay, qP) -> (otherDay, pP)
                        if (!isPeriodAllowedForSubject(qEntry.classId, qEntry.sectionId, qEntry.subjectId, pP)) continue;
                        if (isSubjectDedicatedRoomConflict(qEntry.subjectId, otherDay, pP, qEntry.room, qEntry.classId, qEntry.sectionId)) continue;
                        const qT = qEntry.teacherId ? teacherMap.get(qEntry.teacherId) : undefined;
                        if (qT) {
                          if (isTeacherBlockedAtSlot(qT, otherDay, pP)) continue;
                          if (getSimulatedDayConsecutiveRun(qT.id, otherDay, pP, qP) >= 3) continue;
                        }

                        // Attempt blocker relocations if needed
                        if (teacherBookings.has(`${teacher.id}_${otherDay}_${qP}`)) {
                          tryRelocateTeacherBlockerAtSlot(teacher, otherDay, qP, false);
                        }
                        if (qT && pT?.id !== qT.id && teacherBookings.has(`${qT.id}_${otherDay}_${pP}`)) {
                          tryRelocateTeacherBlockerAtSlot(qT, otherDay, pP, false);
                        }
                        if (pT && (teacherDayLoad.get(`${pT.id}_${day}`) || 0) >= getTeacherDailyMax(pT, settings)) {
                          tryFreeOneDaySlotForTeacher(pT, day);
                        }
                        if (pT && teacherBookings.has(`${pT.id}_${day}_${pSrc}`)) {
                          tryRelocateTeacherBlockerAtSlot(pT, day, pSrc, false);
                        }

                        // Re-verify exact positions & post-relocation safety
                        if (
                          entrySrc.day !== day ||
                          entrySrc.periodIndex !== pSrc ||
                          pEntry.day !== otherDay ||
                          pEntry.periodIndex !== pP ||
                          qEntry.day !== otherDay ||
                          qEntry.periodIndex !== qP
                        ) {
                          continue;
                        }
                        if ((teacherDayLoad.get(`${teacher.id}_${otherDay}`) || 0) >= maxDailyC2) continue;
                        if (isTeacherSlotBusyFor(teacher.id, entrySrc.subjectId, otherDay, qP, entrySrc.room)) continue;
                        if (getSimulatedDayConsecutiveRun(teacher.id, otherDay, qP) >= 3) continue;

                        const qTargetConflict =
                          qT &&
                          (pT?.id !== qT.id
                            ? isTeacherSlotBusyFor(qT.id, qEntry.subjectId, otherDay, pP, qEntry.room)
                            : false);
                        if (qTargetConflict) continue;
                        if (qT && getSimulatedDayConsecutiveRun(qT.id, otherDay, pP, qP) >= 3) continue;

                        if (pT) {
                          if ((teacherDayLoad.get(`${pT.id}_${day}`) || 0) >= getTeacherDailyMax(pT, settings)) continue;
                          if (isTeacherSlotBusyFor(pT.id, pEntry.subjectId, day, pSrc, pEntry.room)) continue;
                          if (getSimulatedDayConsecutiveRun(pT.id, day, pSrc) >= (isFourPlus ? 4 : 3)) continue;
                        }

                        // Commit 3-cycle: entrySrc -> (otherDay, qP), qEntry -> (otherDay, pP), pEntry -> (day, pSrc)
                        updateTeacherAndSubjectCountsOnMove(entrySrc, secCtx, day, pSrc, otherDay, qP);
                        updateTeacherAndSubjectCountsOnMove(qEntry, secCtx, otherDay, qP, otherDay, pP);
                        updateTeacherAndSubjectCountsOnMove(pEntry, secCtx, otherDay, pP, day, pSrc);
                        sectionBookings.set(`${entrySrc.classId}_${entrySrc.sectionId}_${day}_${pSrc}`, [pEntry]);
                        sectionBookings.set(`${entrySrc.classId}_${entrySrc.sectionId}_${otherDay}_${pP}`, [qEntry]);
                        sectionBookings.set(`${entrySrc.classId}_${entrySrc.sectionId}_${otherDay}_${qP}`, [entrySrc]);

                        brokeThisStreak = true;
                        fixedStreak = true;
                        break;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (!fixedStreak) break;
  }

  // Final quick daily-limit safeguard in case Pass 7 cross-day adjustments created a >maxDaily spike
  for (const teacher of teachers) {
    const tMaxD = getTeacherDailyMax(teacher, settings);
    const overDays = workingDays.filter(d => (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) > tMaxD);
    const activeUnder = workingDays.filter(d => {
      const c = teacherDayLoad.get(`${teacher.id}_${d}`) || 0;
      return c > 0 && c < tMaxD;
    });
    if (overDays.length === 0 || activeUnder.length === 0) continue;
    for (const dOver of overDays) {
      if ((teacherDayLoad.get(`${teacher.id}_${dOver}`) || 0) <= tMaxD) break;
      const singles = resultEntries.filter(
        e =>
          e.teacherId === teacher.id &&
          e.day === dOver &&
          !isReligionSubject(e.subjectId, subjects) &&
          (sectionBookings.get(`${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`)?.length || 0) === 1
      );
      for (const eOver of singles) {
        if ((teacherDayLoad.get(`${teacher.id}_${dOver}`) || 0) <= tMaxD) break;
        const secCtx = sectionContextMap.get(`${eOver.classId}_${eOver.sectionId}`);
        if (!secCtx) continue;
        const swapPeer = resultEntries.find(p => {
          if (p.classId !== eOver.classId || p.sectionId !== eOver.sectionId) return false;
          if (!activeUnder.includes(p.day) || p.subjectId === eOver.subjectId) return false;
          if ((teacherDayLoad.get(`${teacher.id}_${p.day}`) || 0) >= tMaxD) return false;
          return canSwapEntriesPreservingWorkingDaysAndLimits(eOver, teacher, p, false);
        });
        if (swapPeer) {
          swapTwoEntriesInSection(secCtx, eOver, swapPeer);
        }
      }
    }
  }

  // Pass 7B: Post-Pass-7 Safeguard for Religion daily limits (e.g. Karim <= 4/day) & Room 307 Peak-Flattening (e.g. Tapash <= 5/day)
  for (let round7B = 0; round7B < 4; round7B++) {
    let fixed7B = false;

    // 7B-1: Non-Hindu Religion teachers > maxDaily (e.g. Karim 5 -> 4)
    for (const teacher of teachers) {
      if (hinduTeacherIdSet.has(teacher.id) || blockTeacherIdSet.has(teacher.id)) continue;
      const maxDaily = getTeacherDailyMax(teacher, settings);
      for (let step = 0; step < 6; step++) {
        const overDays = workingDays
          .filter(d => (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) > maxDaily)
          .sort((a, b) => (teacherDayLoad.get(`${teacher.id}_${b}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${a}`) || 0));
        const underDays = workingDays
          .filter(d => {
            const c = teacherDayLoad.get(`${teacher.id}_${d}`) || 0;
            return c > 0 && c < maxDaily;
          })
          .sort((a, b) => (teacherDayLoad.get(`${teacher.id}_${a}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${b}`) || 0));
        if (overDays.length === 0 || underDays.length === 0) break;

        let movedOne = false;
        for (const dayOver of overDays) {
          if (movedOne) break;
          const seenRel = new Set<string>();
          const relOverSlots: TimetableEntry[][] = [];
          resultEntries.forEach(e => {
            if (e.teacherId !== teacher.id || e.day !== dayOver || !isReligionSubject(e.subjectId, subjects)) return;
            if (isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)) return;
            const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
            if (seenRel.has(sk)) return;
            seenRel.add(sk);
            const list = sectionBookings.get(sk) || [];
            if (list.length > 0) relOverSlots.push([...list]);
          });

          const canPartnerMove = (re: TimetableEntry, destDay: DayOfWeek, destPeriod: number, srcDay: DayOfWeek, srcPeriod: number): boolean => {
            if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, destPeriod)) return false;
            const sCtx = sectionContextMap.get(`${re.classId}_${re.sectionId}`);
            if (!sCtx || wouldViolateSubjectDailyLimit(sCtx, re.subjectId, destDay, srcDay)) return false;
            if (isSubjectDedicatedRoomConflict(re.subjectId, destDay, destPeriod, re.room, re.classId, re.sectionId)) return false;
            if (isHinduReligionSubject(re.subjectId, subjects)) {
              const otherHin = resultEntries.find(
                o => o.day === destDay && o.periodIndex === destPeriod && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
              );
              if (otherHin && otherHin.teacherId !== re.teacherId) return false;
            }
            if (!re.teacherId) return true;
            if (re.teacherId === teacher.id) {
              return canTeacherMoveToSlot(re.teacherId, destDay, destPeriod, srcDay, true, re.subjectId, re.room, srcPeriod);
            }
            const pt = teacherMap.get(re.teacherId);
            if (!pt) return false;
            const destDp = `${destDay}_${destPeriod}`;
            const alreadyInWave = teacherSlotEntries.has(`${pt.id}_${destDp}`);
            const ptDestLoad = teacherDayLoad.get(`${pt.id}_${destDay}`) || 0;
            const ptMaxD = getTeacherDailyMax(pt, settings);
            const ptEstLoad = dedicatedLoadEstimate.get(pt.id) || (teacherWeekLoad.get(pt.id) || 0);
            const ptCap = ptEstLoad > getTeacherMaxWorkingDays(pt, settings) * ptMaxD ? ptMaxD + 1 : ptMaxD;
            if (!alreadyInWave && ptDestLoad >= ptCap) return false;
            return canTeacherMoveToSlot(re.teacherId, destDay, destPeriod, srcDay, false, re.subjectId, re.room, srcPeriod);
          };

          for (const relList of relOverSlots) {
            if (movedOne) break;
            const lead = relList[0];
            const secCtx = sectionContextMap.get(`${lead.classId}_${lead.sectionId}`);
            if (!secCtx) continue;
            const oldPeriod = lead.periodIndex;
            const oldSlotKey = `${lead.classId}_${lead.sectionId}_${dayOver}_${oldPeriod}`;

            const swapPeers = resultEntries
              .filter(peer => {
                if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                if (!underDays.includes(peer.day) || isReligionSubject(peer.subjectId, subjects) || peer.teacherId === teacher.id) return false;
                const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                const destDp = `${peer.day}_${peer.periodIndex}`;
                if ((religionSlotSections.get(destDp)?.size || 0) >= maxRelConcurrent) return false;
                if (!relList.every(re => canPartnerMove(re, peer.day, peer.periodIndex, dayOver, oldPeriod))) return false;
                if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldPeriod)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
                if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, oldPeriod, peer.room, peer.classId, peer.sectionId)) return false;
                if (peer.teacherId && isTeacherBlockedAtSlot(teacherMap.get(peer.teacherId), dayOver, oldPeriod)) return false;
                return true;
              })
              .sort((a, b) => {
                const hp = relList.find(r => r.teacherId && r.teacherId !== teacher.id);
                if (hp?.teacherId) {
                  const inA = teacherSlotEntries.has(`${hp.teacherId}_${a.day}_${a.periodIndex}`) ? 1 : 0;
                  const inB = teacherSlotEntries.has(`${hp.teacherId}_${b.day}_${b.periodIndex}`) ? 1 : 0;
                  if (inA !== inB) return inB - inA;
                }
                const aBusy = a.teacherId && teacherBookings.has(`${a.teacherId}_${dayOver}_${oldPeriod}`) ? 1 : 0;
                const bBusy = b.teacherId && teacherBookings.has(`${b.teacherId}_${dayOver}_${oldPeriod}`) ? 1 : 0;
                return aBusy - bBusy;
              });

            for (const swapPeer of swapPeers) {
              const pDay = swapPeer.day;
              const pPer = swapPeer.periodIndex;
              if (swapPeer.teacherId) {
                const bt = teacherMap.get(swapPeer.teacherId);
                if (bt && (teacherDayLoad.get(`${bt.id}_${dayOver}`) || 0) >= getTeacherDailyMax(bt, settings)) {
                  tryFreeOneDaySlotForTeacher(bt, dayOver);
                }
                if (bt && teacherBookings.has(`${bt.id}_${dayOver}_${oldPeriod}`)) {
                  tryRelocateTeacherBlockerAtSlot(bt, dayOver, oldPeriod, false);
                }
              }
              if (
                lead.day === dayOver &&
                lead.periodIndex === oldPeriod &&
                swapPeer.day === pDay &&
                swapPeer.periodIndex === pPer &&
                relList.every(re => canPartnerMove(re, pDay, pPer, dayOver, oldPeriod)) &&
                (!swapPeer.teacherId ||
                  canTeacherMoveToSlot(swapPeer.teacherId, dayOver, oldPeriod, pDay, true, swapPeer.subjectId, swapPeer.room, pPer))
              ) {
                const peerKey = `${swapPeer.classId}_${swapPeer.sectionId}_${pDay}_${pPer}`;
                for (const re of relList) {
                  updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldPeriod, pDay, pPer);
                }
                updateTeacherAndSubjectCountsOnMove(swapPeer, secCtx, pDay, pPer, dayOver, oldPeriod);
                sectionBookings.set(oldSlotKey, [swapPeer]);
                sectionBookings.set(peerKey, relList);
                movedOne = true;
                fixed7B = true;
                break;
              }
            }
          }
        }
        if (!movedOne) break;
      }
    }

    // 7B-2: Room 307 Peak-Flattening (e.g. Tapash 6 -> 5, including 2-section wave splits with 3-cycle destination swap!)
    for (const teacher of teachers) {
      if (!hinduTeacherIdSet.has(teacher.id)) continue;
      const maxDaily = getTeacherDailyMax(teacher, settings);
      for (let step = 0; step < 6; step++) {
        const highDays = workingDays
          .map(d => ({ d, c: teacherDayLoad.get(`${teacher.id}_${d}`) || 0 }))
          .filter(x => x.c >= maxDaily + 2)
          .sort((a, b) => b.c - a.c);
        if (highDays.length === 0) break;

        let movedFlat = false;
        for (const { d: dayOver, c: dayOverLoad } of highDays) {
          if (movedFlat) break;
          const vacateHinduSection = (relList: TimetableEntry[]): boolean => {
            const lead = relList[0];
            const secCtx = sectionContextMap.get(`${lead.classId}_${lead.sectionId}`);
            if (!secCtx) return false;
            const oldP = lead.periodIndex;
            const oldSlotKey = `${lead.classId}_${lead.sectionId}_${dayOver}_${oldP}`;

            const canMovePartnersStatic = (destDay: DayOfWeek, destPer: number): boolean => {
              const destDp = `${destDay}_${destPer}`;
              if ((religionSlotSections.get(destDp)?.size || 0) >= maxRelConcurrent) return false;
              const tInWave = teacherSlotEntries.has(`${teacher.id}_${destDp}`);
              const tLoadDest = teacherDayLoad.get(`${teacher.id}_${destDay}`) || 0;
              if (!tInWave && tLoadDest > dayOverLoad - 2) return false;
              return relList.every(re => {
                if (!isPeriodAllowedForSubject(re.classId, re.sectionId, re.subjectId, destPer)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, re.subjectId, destDay, dayOver)) return false;
                if (isSubjectDedicatedRoomConflict(re.subjectId, destDay, destPer, re.room, re.classId, re.sectionId)) return false;
                if (isHinduReligionSubject(re.subjectId, subjects)) {
                  const otherHin = resultEntries.find(
                    o => o.day === destDay && o.periodIndex === destPer && isHinduReligionSubject(o.subjectId, subjects) && isHinduReligionRoom(o.room, settings) && Boolean(o.teacherId)
                  );
                  if (otherHin && otherHin.teacherId !== re.teacherId) return false;
                }
                if (re.teacherId === teacher.id) {
                  return canTeacherMoveToSlot(re.teacherId, destDay, destPer, dayOver, false, re.subjectId, re.room, oldP);
                }
                if (re.teacherId) {
                  const pt = teacherMap.get(re.teacherId);
                  if (!pt || isTeacherBlockedAtSlot(pt, destDay, destPer)) return false;
                }
                return true;
              });
            };

            const prepPartners = (destDay: DayOfWeek, destPer: number): boolean => {
              for (const re of relList) {
                if (!re.teacherId || re.teacherId === teacher.id) continue;
                const pt = teacherMap.get(re.teacherId);
                if (!pt) return false;
                if ((teacherDayLoad.get(`${pt.id}_${destDay}`) || 0) >= getTeacherDailyMax(pt, settings)) {
                  tryFreeOneDaySlotForTeacher(pt, destDay);
                }
                if (teacherBookings.has(`${pt.id}_${destDay}_${destPer}`)) {
                  tryRelocateTeacherBlockerAtSlot(pt, destDay, destPer, false);
                }
                if (!canTeacherMoveToSlot(pt.id, destDay, destPer, dayOver, true, re.subjectId, re.room, oldP)) return false;
              }
              return true;
            };

            // Direct 1-swap into existing wave or <=4 day
            const directPeers = resultEntries
              .filter(peer => {
                if (peer.classId !== lead.classId || peer.sectionId !== lead.sectionId) return false;
                if (peer.day === dayOver || isReligionSubject(peer.subjectId, subjects)) return false;
                const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                if (!canMovePartnersStatic(peer.day, peer.periodIndex)) return false;
                if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, oldP)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, dayOver, peer.day)) return false;
                if (isSubjectDedicatedRoomConflict(peer.subjectId, dayOver, oldP, peer.room, peer.classId, peer.sectionId)) return false;
                if (peer.teacherId && isTeacherBlockedAtSlot(teacherMap.get(peer.teacherId), dayOver, oldP)) return false;
                return true;
              })
              .sort((a, b) => {
                const wA = teacherSlotEntries.has(`${teacher.id}_${a.day}_${a.periodIndex}`) ? 1 : 0;
                const wB = teacherSlotEntries.has(`${teacher.id}_${b.day}_${b.periodIndex}`) ? 1 : 0;
                return wB - wA;
              });

            for (const sp of directPeers) {
              const pDay = sp.day;
              const pPer = sp.periodIndex;
              if (sp.teacherId) {
                const bt = teacherMap.get(sp.teacherId);
                if (bt && (teacherDayLoad.get(`${bt.id}_${dayOver}`) || 0) >= getTeacherDailyMax(bt, settings)) {
                  tryFreeOneDaySlotForTeacher(bt, dayOver);
                }
                if (bt && teacherBookings.has(`${bt.id}_${dayOver}_${oldP}`)) {
                  tryRelocateTeacherBlockerAtSlot(bt, dayOver, oldP, false);
                }
              }
              if (!prepPartners(pDay, pPer)) continue;
              if (
                lead.day === dayOver &&
                lead.periodIndex === oldP &&
                sp.day === pDay &&
                sp.periodIndex === pPer &&
                canMovePartnersStatic(pDay, pPer) &&
                canTeacherMoveToSlot(sp.teacherId, dayOver, oldP, pDay, true, sp.subjectId, sp.room, pPer)
              ) {
                const peerKey = `${sp.classId}_${sp.sectionId}_${pDay}_${pPer}`;
                for (const re of relList) {
                  updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldP, pDay, pPer);
                }
                updateTeacherAndSubjectCountsOnMove(sp, secCtx, pDay, pPer, dayOver, oldP);
                sectionBookings.set(oldSlotKey, [sp]);
                sectionBookings.set(peerKey, relList);
                return true;
              }
            }

            // 3-cycle destination pre-swap: relList(dayOver, oldP) -> waveSlot(pDay, pPer), wavePeer(pDay, pPer) -> qSlot(pDay, qPer), qPeer(pDay, qPer) -> (dayOver, oldP)
            const waveCands = resultEntries.filter(wp => {
              if (wp.classId !== lead.classId || wp.sectionId !== lead.sectionId) return false;
              if (wp.day === dayOver || isReligionSubject(wp.subjectId, subjects)) return false;
              const skP = `${wp.classId}_${wp.sectionId}_${wp.day}_${wp.periodIndex}`;
              if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
              return canMovePartnersStatic(wp.day, wp.periodIndex);
            });
            for (const wp of waveCands) {
              const pDay = wp.day;
              const pPer = wp.periodIndex;
              const qCands = resultEntries.filter(qp => {
                if (qp.classId !== lead.classId || qp.sectionId !== lead.sectionId) return false;
                if (qp.day !== pDay || qp.periodIndex === pPer || isReligionSubject(qp.subjectId, subjects)) return false;
                if (qp.subjectId === wp.subjectId || qp.teacherId === wp.teacherId) return false;
                const skQ = `${qp.classId}_${qp.sectionId}_${qp.day}_${qp.periodIndex}`;
                if ((sectionBookings.get(skQ)?.length || 0) !== 1) return false;
                if (!isPeriodAllowedForSubject(wp.classId, wp.sectionId, wp.subjectId, qp.periodIndex)) return false;
                if (isSubjectDedicatedRoomConflict(wp.subjectId, pDay, qp.periodIndex, wp.room, wp.classId, wp.sectionId)) return false;
                if (wp.teacherId) {
                  const wt = teacherMap.get(wp.teacherId);
                  if (!wt || isTeacherBlockedAtSlot(wt, pDay, qp.periodIndex)) return false;
                  if (getSimulatedDayConsecutiveRun(wt.id, pDay, qp.periodIndex, pPer) >= 4) return false;
                }
                if (!isPeriodAllowedForSubject(qp.classId, qp.sectionId, qp.subjectId, oldP)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, qp.subjectId, dayOver, pDay)) return false;
                if (isSubjectDedicatedRoomConflict(qp.subjectId, dayOver, oldP, qp.room, qp.classId, qp.sectionId)) return false;
                if (qp.teacherId && isTeacherBlockedAtSlot(teacherMap.get(qp.teacherId), dayOver, oldP)) return false;
                return true;
              });
              for (const qp of qCands) {
                const qPer = qp.periodIndex;
                if (wp.teacherId) {
                  const wt = teacherMap.get(wp.teacherId);
                  if (wt && teacherBookings.has(`${wt.id}_${pDay}_${qPer}`)) {
                    tryRelocateTeacherBlockerAtSlot(wt, pDay, qPer, false);
                  }
                }
                if (qp.teacherId) {
                  const qt = teacherMap.get(qp.teacherId);
                  if (qt && (teacherDayLoad.get(`${qt.id}_${dayOver}`) || 0) >= getTeacherDailyMax(qt, settings)) {
                    tryFreeOneDaySlotForTeacher(qt, dayOver);
                  }
                  if (qt && teacherBookings.has(`${qt.id}_${dayOver}_${oldP}`)) {
                    tryRelocateTeacherBlockerAtSlot(qt, dayOver, oldP, false);
                  }
                }
                if (!prepPartners(pDay, pPer)) continue;
                if (
                  lead.day === dayOver &&
                  lead.periodIndex === oldP &&
                  wp.day === pDay &&
                  wp.periodIndex === pPer &&
                  qp.day === pDay &&
                  qp.periodIndex === qPer &&
                  canMovePartnersStatic(pDay, pPer) &&
                  (!wp.teacherId || canTeacherMoveToSlot(wp.teacherId, pDay, qPer, pDay, false, wp.subjectId, wp.room, pPer)) &&
                  canTeacherMoveToSlot(qp.teacherId, dayOver, oldP, pDay, true, qp.subjectId, qp.room, qPer)
                ) {
                  const wpKey = `${wp.classId}_${wp.sectionId}_${pDay}_${pPer}`;
                  const qpKey = `${qp.classId}_${qp.sectionId}_${pDay}_${qPer}`;
                  for (const re of relList) {
                    updateTeacherAndSubjectCountsOnMove(re, secCtx, dayOver, oldP, pDay, pPer);
                  }
                  updateTeacherAndSubjectCountsOnMove(wp, secCtx, pDay, pPer, pDay, qPer);
                  updateTeacherAndSubjectCountsOnMove(qp, secCtx, pDay, qPer, dayOver, oldP);
                  sectionBookings.set(oldSlotKey, [qp]);
                  sectionBookings.set(wpKey, relList);
                  sectionBookings.set(qpKey, [wp]);
                  return true;
                }
              }
            }
            return false;
          };

          const slotsByPeriod = new Map<number, TimetableEntry[][]>();
          const seenR = new Set<string>();
          resultEntries.forEach(e => {
            if (e.teacherId !== teacher.id || e.day !== dayOver) return;
            if (!isHinduReligionSubject(e.subjectId, subjects) || !isHinduReligionRoom(e.room, settings)) return;
            const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
            if (seenR.has(sk)) return;
            seenR.add(sk);
            const list = sectionBookings.get(sk) || [];
            if (list.length > 0) {
              const arr = slotsByPeriod.get(e.periodIndex) || [];
              arr.push([...list]);
              slotsByPeriod.set(e.periodIndex, arr);
            }
          });
          const sortedWaves = Array.from(slotsByPeriod.entries()).sort((a, b) => a[1].length - b[1].length);
          for (const [, waveLists] of sortedWaves) {
            if (movedFlat) break;
            if (waveLists.length === 1) {
              if (vacateHinduSection(waveLists[0])) {
                movedFlat = true;
                fixed7B = true;
                break;
              }
            } else if (waveLists.length === 2) {
              if (vacateHinduSection(waveLists[0]) && vacateHinduSection(waveLists[1])) {
                movedFlat = true;
                fixed7B = true;
                break;
              }
            }
          }
        }
        if (!movedFlat) break;
      }
    }

    if (!fixed7B) break;
  }

  // Post-Pass-7 Working-Days Compaction Refresher (for any feasible teachers left at > maxWorkingDays after streak rearrangements)
  for (let postRound = 0; postRound < 2; postRound++) {
    let postCompacted = false;
    for (const teacher of teachers) {
      if (blockTeacherIdSet.has(teacher.id)) continue;
      const maxW = getTeacherMaxWorkingDays(teacher, settings);
      const maxD = getTeacherDailyMax(teacher, settings);
      const tNeed5 =
        (dedicatedLoadEstimate.get(teacher.id) || 0) > maxW * maxD ||
        (dedicatedMaxSubFreq.get(teacher.id) || 0) > maxW;
      if (tNeed5) continue;

      for (let step = 0; step < 6; step++) {
        const active = workingDays
          .map(d => ({ day: d, count: teacherDayLoad.get(`${teacher.id}_${d}`) || 0 }))
          .filter(x => x.count > 0)
          .sort((a, b) => a.count - b.count);
        if (active.length <= maxW) break;

        let movedOne = false;
        for (const donorInfo of active) {
          if (movedOne) break;
          const donorDay = donorInfo.day;
          const targetActiveDays = active
            .filter(x => x.day !== donorDay && x.count < maxD)
            .sort((a, b) => a.count - b.count)
            .map(x => x.day);
          if (targetActiveDays.length === 0) continue;

          const donorEntries = resultEntries.filter(e => {
            if (e.teacherId !== teacher.id || e.day !== donorDay) return false;
            if (isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)) return false;
            const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
            return (sectionBookings.get(sk)?.length || 0) === 1;
          });

          for (const entryDonor of donorEntries) {
            if (movedOne) break;
            const secCtx = sectionContextMap.get(`${entryDonor.classId}_${entryDonor.sectionId}`);
            if (!secCtx) continue;

            for (const tDay of targetActiveDays) {
              const availIdx = secCtx.availableSlots.findIndex(slot => {
                if (slot.day !== tDay) return false;
                if (!isPeriodAllowedForSubject(entryDonor.classId, entryDonor.sectionId, entryDonor.subjectId, slot.periodIndex)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, entryDonor.subjectId, slot.day, donorDay)) return false;
                if (isSubjectDedicatedRoomConflict(entryDonor.subjectId, slot.day, slot.periodIndex, entryDonor.room, entryDonor.classId, entryDonor.sectionId)) return false;
                if (getSimulatedDayConsecutiveRun(teacher.id, slot.day, slot.periodIndex) >= 4) return false;
                return canTeacherMoveToSlot(teacher.id, slot.day, slot.periodIndex, donorDay, true, entryDonor.subjectId, entryDonor.room);
              });
              if (availIdx !== -1) {
                const destSlot = secCtx.availableSlots.splice(availIdx, 1)[0];
                const oldP = entryDonor.periodIndex;
                updateTeacherAndSubjectCountsOnMove(entryDonor, secCtx, donorDay, oldP, destSlot.day, destSlot.periodIndex);
                sectionBookings.delete(`${entryDonor.classId}_${entryDonor.sectionId}_${donorDay}_${oldP}`);
                sectionBookings.set(`${entryDonor.classId}_${entryDonor.sectionId}_${destSlot.day}_${destSlot.periodIndex}`, [entryDonor]);
                secCtx.availableSlots.push({ day: donorDay, periodIndex: oldP });
                movedOne = true;
                postCompacted = true;
                break;
              }

              const peers = resultEntries.filter(peer => {
                if (peer.classId !== entryDonor.classId || peer.sectionId !== entryDonor.sectionId) return false;
                if (peer.day !== tDay || peer.subjectId === entryDonor.subjectId || peer.teacherId === teacher.id) return false;
                if (isReligionSubject(peer.subjectId, subjects)) return false;
                const skP = `${peer.classId}_${peer.sectionId}_${peer.day}_${peer.periodIndex}`;
                if ((sectionBookings.get(skP)?.length || 0) !== 1) return false;
                if (!isPeriodAllowedForSubject(entryDonor.classId, entryDonor.sectionId, entryDonor.subjectId, peer.periodIndex)) return false;
                if (!isPeriodAllowedForSubject(peer.classId, peer.sectionId, peer.subjectId, entryDonor.periodIndex)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, entryDonor.subjectId, tDay, donorDay)) return false;
                if (wouldViolateSubjectDailyLimit(secCtx, peer.subjectId, donorDay, tDay)) return false;
                if (isSubjectDedicatedRoomConflict(entryDonor.subjectId, tDay, peer.periodIndex, entryDonor.room, entryDonor.classId, entryDonor.sectionId)) return false;
                if (isSubjectDedicatedRoomConflict(peer.subjectId, donorDay, entryDonor.periodIndex, peer.room, peer.classId, peer.sectionId)) return false;
                if (isTeacherBlockedAtSlot(teacher, tDay, peer.periodIndex)) return false;
                if (peer.teacherId) {
                  const bT = teacherMap.get(peer.teacherId);
                  if (!bT || isTeacherBlockedAtSlot(bT, donorDay, entryDonor.periodIndex)) return false;
                  if ((teacherDayLoad.get(`${bT.id}_${donorDay}`) || 0) >= getTeacherDailyMax(bT, settings)) return false;
                }
                return true;
              });

              for (const peer of peers) {
                const pDay = peer.day;
                const pPer = peer.periodIndex;
                const dPer = entryDonor.periodIndex;
                if (teacherBookings.has(`${teacher.id}_${pDay}_${pPer}`)) {
                  tryRelocateTeacherBlockerAtSlot(teacher, pDay, pPer, false);
                }
                if (peer.teacherId && teacherBookings.has(`${peer.teacherId}_${donorDay}_${dPer}`)) {
                  const bT = teacherMap.get(peer.teacherId)!;
                  tryRelocateTeacherBlockerAtSlot(bT, donorDay, dPer, false);
                }
                if (
                  entryDonor.day === donorDay &&
                  entryDonor.periodIndex === dPer &&
                  peer.day === pDay &&
                  peer.periodIndex === pPer &&
                  canSwapEntriesPreservingWorkingDaysAndLimits(entryDonor, teacher, peer, false) &&
                  getSimulatedDayConsecutiveRun(teacher.id, pDay, pPer) < 4
                ) {
                  swapTwoEntriesInSection(secCtx, entryDonor, peer);
                  movedOne = true;
                  postCompacted = true;
                  break;
                }
              }
              if (movedOne) break;
            }
          }
        }
        if (!movedOne) break;
      }
    }
    if (!postCompacted) break;
  }

  // ===========================================================================
  // Final Conflict Verification & Zero-Collision Safety Pass
  // ===========================================================================
  const finalTeacherSlots = new Map<string, TimetableEntry[]>(); // "teacherId_day_period" -> entries
  const finalSectionSlots = new Map<string, TimetableEntry[]>(); // "classId_sectionId_day_period" -> entries
  const finalReligionSections = new Map<string, Set<string>>(); // "day_period" -> Set<secKey>
  const finalRoomSlots = new Map<string, Set<string>>(); // "day_period_normRoom" -> Set<secKey>
  const safeEntries: TimetableEntry[] = [];

  for (const entry of resultEntries) {
    const cls = classes.find(c => c.id === entry.classId);
    const tKey = `${entry.teacherId}_${entry.day}_${entry.periodIndex}`;
    const sKey = `${entry.classId}_${entry.sectionId}_${entry.day}_${entry.periodIndex}`;
    const secKey = `${entry.classId}_${entry.sectionId}`;
    const dpKey = `${entry.day}_${entry.periodIndex}`;

    // Reject if block teacher mistakenly placed in KG-10
    if (cls && !isPlayOrNursery(cls) && blockTeacherIdSet.has(entry.teacherId)) {
      continue;
    }

    // Check section slot collision: allow ONLY if existing entry is a valid parallel subject pair
    const existingInSlot = finalSectionSlots.get(sKey) || [];
    if (existingInSlot.length > 0) {
      const canParallel =
        existingInSlot.length === 1 &&
        areParallelSubjects(existingInSlot[0].subjectId, entry.subjectId, subjects, cls?.numericGrade);
      if (!canParallel) continue;
    }

    // Check Religion concurrency limit (maxRelConcurrent per period)
    if (isReligionSubject(entry.subjectId, subjects)) {
      const relSecs = finalReligionSections.get(dpKey) || new Set<string>();
      if (!relSecs.has(secKey) && relSecs.size >= maxRelConcurrent) {
        continue;
      }
    }

    // Check teacher collision strictly, allowing ONLY Combined Hindu Room 307 (<= maxRelConcurrent)
    if (entry.teacherId) {
      const existingForTeacher = finalTeacherSlots.get(tKey) || [];
      if (existingForTeacher.length > 0) {
        const isIncomingHinduCombined =
          isHinduReligionSubject(entry.subjectId, subjects) &&
          isHinduReligionRoom(entry.room, settings);
        const allExistingHinduCombined = existingForTeacher.every(
          e => isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)
        );
        const relSecs = finalReligionSections.get(dpKey);
        const underLimit = (relSecs?.size || 0) < maxRelConcurrent || Boolean(relSecs?.has(secKey));
        if (!(isIncomingHinduCombined && allExistingHinduCombined && underLimit)) {
          continue;
        }
      }
    }

    // Check explicit room collision (exempt Combined Hindu Room 307 <= maxRelConcurrent and same-section parallel pair)
    const normRoom = normalizeRoomKey(entry.room);
    if (normRoom) {
      const rKey = `${dpKey}_${normRoom}`;
      const roomSecs = finalRoomSlots.get(rKey) || new Set<string>();
      if (roomSecs.size > 0 && !roomSecs.has(secKey)) {
        const isHinduCombined =
          isHinduReligionSubject(entry.subjectId, subjects) &&
          isHinduReligionRoom(entry.room, settings);
        if (!isHinduCombined || roomSecs.size >= maxRelConcurrent) {
          continue;
        }
      }
    }

    if (entry.teacherId) {
      finalTeacherSlots.set(tKey, [...(finalTeacherSlots.get(tKey) || []), entry]);
    }
    if (isReligionSubject(entry.subjectId, subjects)) {
      const relSecs = finalReligionSections.get(dpKey) || new Set<string>();
      relSecs.add(secKey);
      finalReligionSections.set(dpKey, relSecs);
    }
    if (normRoom) {
      const rKey = `${dpKey}_${normRoom}`;
      const roomSecs = finalRoomSlots.get(rKey) || new Set<string>();
      roomSecs.add(secKey);
      finalRoomSlots.set(rKey, roomSecs);
    }
    finalSectionSlots.set(sKey, [...existingInSlot, entry]);
    safeEntries.push(entry);
  }

  // Run full post-generation verification across target scope
  const verifyScope =
    options.scope === 'all'
      ? ({ type: 'all' } as const)
      : options.scope === 'class'
      ? ({ type: 'class', classId: options.targetClassId } as const)
      : ({ type: 'section', classId: options.targetClassId, sectionId: options.targetSectionId } as const);

  const verification = verifyRoutine(
    safeEntries,
    classes,
    teachers,
    subjects || [],
    workingDays,
    periodTimings,
    verifyScope,
    settings
  );

  const actualUnassigned = Math.max(totalUnassigned, verification.unassignedClasses);
  const allComplete = verification.finalCompletionStatus === 'complete' && actualUnassigned === 0;

  return {
    success: allComplete,
    entries: safeEntries,
    message: allComplete
      ? `Routine Successfully Generated for ${targetSections.length} section${targetSections.length > 1 ? 's' : ''} (${safeEntries.length} periods, Zero Unassigned & Zero Conflicts).`
      : `Generated ${safeEntries.length} periods for ${targetSections.length} section${targetSections.length > 1 ? 's' : ''} (${actualUnassigned} unassigned or conflicted items detected — see report).`,
    stats: {
      totalClassesScheduled: targetSections.length,
      totalPeriodsAssigned: safeEntries.length,
      unassignedPeriods: actualUnassigned,
    },
    verification,
  };
}

/**
 * One-click Auto Fix Routine:
 * Sanitizes broken/conflicting/over-quota/wrong-teacher/over-3-religion slots,
 * then fills all missing periods cleanly while enforcing every institutional rule.
 */
export function autoFixRoutine(
  classes: SchoolClass[],
  teachers: Teacher[],
  workingDays: DayOfWeek[],
  periodTimings: PeriodTiming[],
  existingEntries: TimetableEntry[],
  settings?: SchoolSettings,
  subjects?: Subject[]
): GenerationResult {
  const classMap = new Map(classes.map(c => [c.id, c]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const validDaySet = new Set(workingDays);
  const validTeachingPeriods = new Set(
    periodTimings.filter(p => !p.isBreak && !p.isLocked).map(p => p.periodIndex)
  );
  const hinduRoom = getCombinedHinduRoom(settings);
  const maxRelConcurrent = getMaxReligionConcurrentSections(settings);
  const combinedHinduTeacherId = getCombinedHinduTeacherId(teachers, settings, subjects);

  const blockTeacherIdSet = new Set<string>();
  teachers.forEach(t => {
    if (isTeacherBlockTeacher(t, classes)) blockTeacherIdSet.add(t.id);
  });

  // Track section subject target upper bounds
  const secTargetMaxMap = new Map<string, number>();
  classes.forEach(cls => {
    if (isPlayOrNursery(cls)) return;
    cls.sections.forEach(sec => {
      const reqs = getEffectiveSectionRequirements(cls, sec.id, teachers);
      const isNineTen = isClassNineOrTen(cls);
      const hmtReq = isNineTen ? reqs.find(r => isHigherMathSubject(r.subjectId, subjects)) : undefined;
      const agrReq = isNineTen ? reqs.find(r => isAgricultureSubject(r.subjectId, subjects)) : undefined;
      reqs.forEach(r => {
        let cap = r.periodsPerWeek;
        if (hmtReq && agrReq && (r.subjectId === hmtReq.subjectId || r.subjectId === agrReq.subjectId)) {
          cap = Math.max(hmtReq.periodsPerWeek, agrReq.periodsPerWeek);
        }
        secTargetMaxMap.set(`${cls.id}_${sec.id}_${r.subjectId}`, cap);
      });
    });
  });

  const keptTeacherSlot = new Map<string, TimetableEntry[]>();
  const keptSectionSlot = new Map<string, TimetableEntry[]>();
  const keptSectionSubjectCount = new Map<string, number>();
  const keptSectionSubjectDay = new Set<string>();
  const keptRelSlotSections = new Map<string, Set<string>>();
  const keptRoomSlots = new Map<string, Set<string>>();
  const keptTeacherDayLoad = new Map<string, number>();

  const normRoom = (r: string | undefined) => {
    const t = (r || '').trim();
    if (!t) return '';
    return isHinduReligionRoom(t, settings) ? `hindu_${hinduRoom.toLowerCase()}` : t.toLowerCase();
  };

  const candidateEntries: TimetableEntry[] = [];
  for (const raw of existingEntries) {
    const cls = classMap.get(raw.classId);
    if (!cls) continue;
    const sec = cls.sections.find(s => s.id === raw.sectionId);
    if (!sec) continue;
    if (!validDaySet.has(raw.day) || !validTeachingPeriods.has(raw.periodIndex)) continue;
    if (isSlotDismissed(cls, raw.day, raw.periodIndex, raw.sectionId, workingDays)) continue;

    const isPN = isPlayOrNursery(cls);
    if (!isPN && !isSubjectSelectedForSection(cls, raw.sectionId, raw.subjectId)) continue;
    if (!isPN && raw.teacherId && blockTeacherIdSet.has(raw.teacherId)) continue;
    if (isPN && raw.teacherId && !cls.blockTeacherIds?.includes(raw.teacherId)) continue;

    // Drop entries violating fixed period restrictions so Auto Fix reschedules them in allowed periods
    const allowedPeriods = getEffectiveSubjectFixedPeriods(cls, raw.sectionId, raw.subjectId, subjects);
    if (allowedPeriods && !allowedPeriods.includes(raw.periodIndex)) continue;

    // Repair explicit teacher & room assignment if needed
    let fixedTeacherId = raw.teacherId;
    if (!isPN) {
      const expected = getExpectedSectionTeacherId(cls, raw.sectionId, raw.subjectId, teachers);
      if (expected) {
        fixedTeacherId = expected;
      } else if (isHinduReligionSubject(raw.subjectId, subjects) && combinedHinduTeacherId) {
        fixedTeacherId = combinedHinduTeacherId;
      }
    }

    const fixedRoom = isHinduReligionSubject(raw.subjectId, subjects)
      ? hinduRoom
      : isAgricultureSubject(raw.subjectId, subjects)
      ? AGRICULTURE_ROOM
      : raw.room || sec.roomNumber;

    candidateEntries.push({
      ...raw,
      teacherId: fixedTeacherId,
      room: fixedRoom,
    });
  }

  const sanitized: TimetableEntry[] = [];
  for (const entry of candidateEntries) {
    const cls = classMap.get(entry.classId)!;
    const isPN = isPlayOrNursery(cls);
    const secKey = `${entry.classId}_${entry.sectionId}`;
    const dpKey = `${entry.day}_${entry.periodIndex}`;
    const slotKey = `${secKey}_${dpKey}`;

    // Check section slot collision / valid parallel pair
    const existingInSecSlot = keptSectionSlot.get(slotKey) || [];
    if (existingInSecSlot.length > 0) {
      const validPair =
        existingInSecSlot.length === 1 &&
        areParallelSubjects(existingInSecSlot[0].subjectId, entry.subjectId, subjects, cls.numericGrade);
      if (!validPair) continue;
    }

    // Check weekly quota & same-day subject uniqueness (KG-10)
    if (!isPN) {
      const subDayKey = `${secKey}_${entry.day}_${entry.subjectId}`;
      if (keptSectionSubjectDay.has(subDayKey)) continue;

      const secSubKey = `${secKey}_${entry.subjectId}`;
      const maxWeekly = secTargetMaxMap.get(secSubKey);
      if (maxWeekly !== undefined && (keptSectionSubjectCount.get(secSubKey) || 0) >= maxWeekly) {
        continue;
      }
    }

    // Check religion <= maxRelConcurrent
    if (isReligionSubject(entry.subjectId, subjects)) {
      const relSecs = keptRelSlotSections.get(dpKey) || new Set<string>();
      if (!relSecs.has(secKey) && relSecs.size >= maxRelConcurrent) continue;
    }

    // Check teacher availability, daily cap & collisions
    if (entry.teacherId) {
      const t = teacherMap.get(entry.teacherId);
      if (!t) continue;
      if (isTeacherBlockedAtSlot(t, entry.day, entry.periodIndex)) continue;

      const tSlotKey = `${entry.teacherId}_${dpKey}`;
      const tExisting = keptTeacherSlot.get(tSlotKey) || [];
      if (tExisting.length > 0) {
        const isIncomingHindu =
          isHinduReligionSubject(entry.subjectId, subjects) &&
          isHinduReligionRoom(entry.room, settings);
        const allExistingHindu = tExisting.every(
          ex => isHinduReligionSubject(ex.subjectId, subjects) && isHinduReligionRoom(ex.room, settings)
        );
        const relSecs = keptRelSlotSections.get(dpKey);
        const underLimit = (relSecs?.size || 0) < maxRelConcurrent || Boolean(relSecs?.has(secKey));
        if (!(isIncomingHindu && allExistingHindu && underLimit)) {
          continue;
        }
      } else {
        const tdKey = `${entry.teacherId}_${entry.day}`;
        if ((keptTeacherDayLoad.get(tdKey) || 0) >= getTeacherDailyMax(t, settings)) {
          continue;
        }
      }
    }

    // Check explicit room conflict
    const nr = normRoom(entry.room);
    if (nr) {
      const rKey = `${dpKey}_${nr}`;
      const rSecs = keptRoomSlots.get(rKey) || new Set<string>();
      if (rSecs.size > 0 && !rSecs.has(secKey)) {
        const isHinduCombined =
          isHinduReligionSubject(entry.subjectId, subjects) &&
          isHinduReligionRoom(entry.room, settings);
        if (!isHinduCombined || rSecs.size >= maxRelConcurrent) continue;
      }
    }

    // Commit sanitized entry
    sanitized.push(entry);
    keptSectionSlot.set(slotKey, [...existingInSecSlot, entry]);
    if (!isPN) {
      keptSectionSubjectDay.add(`${secKey}_${entry.day}_${entry.subjectId}`);
      const secSubKey = `${secKey}_${entry.subjectId}`;
      keptSectionSubjectCount.set(secSubKey, (keptSectionSubjectCount.get(secSubKey) || 0) + 1);
    }
    if (isReligionSubject(entry.subjectId, subjects)) {
      const relSecs = keptRelSlotSections.get(dpKey) || new Set<string>();
      relSecs.add(secKey);
      keptRelSlotSections.set(dpKey, relSecs);
    }
    if (entry.teacherId) {
      const tSlotKey = `${entry.teacherId}_${dpKey}`;
      const tExisting = keptTeacherSlot.get(tSlotKey) || [];
      if (tExisting.length === 0) {
        const tdKey = `${entry.teacherId}_${entry.day}`;
        keptTeacherDayLoad.set(tdKey, (keptTeacherDayLoad.get(tdKey) || 0) + 1);
      }
      keptTeacherSlot.set(tSlotKey, [...tExisting, entry]);
    }
    if (nr) {
      const rKey = `${dpKey}_${nr}`;
      const rSecs = keptRoomSlots.get(rKey) || new Set<string>();
      rSecs.add(secKey);
      keptRoomSlots.set(rKey, rSecs);
    }
  }

  // Drop incomplete parallel slots in sanitized list so Pass 1B/2/3 can schedule paired slots cleanly
  const slotMapAfter = new Map<string, TimetableEntry[]>();
  sanitized.forEach(e => {
    const k = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
    slotMapAfter.set(k, [...(slotMapAfter.get(k) || []), e]);
  });

  const cleanPreserved = sanitized.filter(entry => {
    const cls = classMap.get(entry.classId)!;
    if (isPlayOrNursery(cls)) return true;
    const reqs = getEffectiveSectionRequirements(cls, entry.sectionId, teachers);
    const slotList = slotMapAfter.get(`${entry.classId}_${entry.sectionId}_${entry.day}_${entry.periodIndex}`) || [];

    if (isClassNineOrTen(cls)) {
      const hasBothHmtAgr =
        reqs.some(r => isHigherMathSubject(r.subjectId, subjects)) &&
        reqs.some(r => isAgricultureSubject(r.subjectId, subjects));
      if (hasBothHmtAgr && (isHigherMathSubject(entry.subjectId, subjects) || isAgricultureSubject(entry.subjectId, subjects))) {
        const hasHmt = slotList.some(s => isHigherMathSubject(s.subjectId, subjects));
        const hasAgr = slotList.some(s => isAgricultureSubject(s.subjectId, subjects));
        if (!hasHmt || !hasAgr) return false;
      }
    }

    const hasBothRelHin =
      reqs.some(r => isIslamReligionSubject(r.subjectId, subjects)) &&
      reqs.some(r => isHinduReligionSubject(r.subjectId, subjects));
    if (hasBothRelHin && (isIslamReligionSubject(entry.subjectId, subjects) || isHinduReligionSubject(entry.subjectId, subjects))) {
      const hasRel = slotList.some(s => isIslamReligionSubject(s.subjectId, subjects));
      const hasHin = slotList.some(s => isHinduReligionSubject(s.subjectId, subjects));
      if (!hasRel || !hasHin) return false;
    }

    return true;
  });

  // Attempt incremental fix preserving valid existing entries
  const incrementalResult = generateSmartTimetable(
    classes,
    teachers,
    workingDays,
    periodTimings,
    cleanPreserved,
    { scope: 'all', preserveLockedEntries: true, maxConsecutiveLimit: 2 },
    subjects,
    settings
  );

  const incrementalAllPass =
    incrementalResult.verification?.finalCompletionStatus === 'complete' &&
    incrementalResult.stats.unassignedPeriods === 0 &&
    Boolean(incrementalResult.verification?.finalValidation.allPassed) &&
    (incrementalResult.verification?.workingDaysViolationsCount ?? 0) === 0 &&
    (incrementalResult.verification?.fourPlusConsecViolationsCount ?? 0) === 0;

  if (incrementalAllPass) {
    return incrementalResult;
  }

  // Fallback to a clean full solve if preserved geometry prevented complete repair
  const fullSolveResult = generateSmartTimetable(
    classes,
    teachers,
    workingDays,
    periodTimings,
    [],
    { scope: 'all', preserveLockedEntries: false, maxConsecutiveLimit: 2 },
    subjects,
    settings
  );

  const incFailCount = (incrementalResult.verification?.finalValidation?.items || []).filter(v => v.status === 'FAIL').length;
  const fullFailCount = (fullSolveResult.verification?.finalValidation?.items || []).filter(v => v.status === 'FAIL').length;
  const incPatternFails =
    (incrementalResult.verification?.workingDaysViolationsCount ?? 0) +
    (incrementalResult.verification?.fourPlusConsecViolationsCount ?? 0) +
    (incrementalResult.verification?.excessiveThreeConsecTeachersCount ?? 0);
  const fullPatternFails =
    (fullSolveResult.verification?.workingDaysViolationsCount ?? 0) +
    (fullSolveResult.verification?.fourPlusConsecViolationsCount ?? 0) +
    (fullSolveResult.verification?.excessiveThreeConsecTeachersCount ?? 0);
  const incLimits = incrementalResult.verification?.teacherLimitViolationsCount ?? 0;
  const fullLimits = fullSolveResult.verification?.teacherLimitViolationsCount ?? 0;

  if (
    fullFailCount < incFailCount ||
    (fullFailCount === incFailCount && fullSolveResult.stats.unassignedPeriods < incrementalResult.stats.unassignedPeriods) ||
    (fullFailCount === incFailCount && fullSolveResult.stats.unassignedPeriods === incrementalResult.stats.unassignedPeriods && fullPatternFails < incPatternFails) ||
    (fullFailCount === incFailCount && fullSolveResult.stats.unassignedPeriods === incrementalResult.stats.unassignedPeriods && fullPatternFails === incPatternFails && fullLimits < incLimits)
  ) {
    return fullSolveResult;
  }
  return incrementalResult;
}

