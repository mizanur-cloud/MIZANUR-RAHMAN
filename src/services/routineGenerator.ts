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
import { getTeacherDailyMax } from './workloadService';

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
    periodIndex: number
  ): number => {
    const currentPeriods: number[] = [periodIndex];
    teachingPeriods.forEach(p => {
      if (p !== periodIndex && teacherBookings.has(`${teacherId}_${day}_${p}`)) {
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

    // 3. Enforce blocks of 1-2 (at most 3 if >20 classes/week) with free gaps between them
    const maxRun = getMaxConsecutiveRunWith(teacherId, day, periodIndex);
    if (maxRun >= 4) {
      penalty += 12000;
    } else if (maxRun === 3) {
      penalty += 5000; // strongly prefer 2 classes -> free gap -> 2 classes over 3 straight
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

  // Helper: Compute ideal daily load target for balanced weekday workload distribution
  const getIdealDailyForTeacher = (teacher: Teacher): number => {
    const expected = dedicatedLoadEstimate.get(teacher.id) || 0;
    const daysCount = Math.max(1, workingDays.length);
    const ideal = Math.ceil(expected / daysCount);
    return Math.max(1, Math.min(getTeacherDailyMax(teacher), ideal || 2));
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
    const maxDaily = getTeacherDailyMax(t);
    const idealDaily = getIdealDailyForTeacher(t);
    const sameSubOnDay = teacherSubjectDayLoad.get(`${t.id}_${subjectId}_${day}`) || 0;

    let penalty = 0;
    if (specialPacedTeacherIdSet.has(t.id)) {
      penalty += getSpecialTeacherPacingPenalty(t.id, day, periodIndex);
      if (tDay >= maxDaily) {
        penalty += 80000 + (tDay - maxDaily) * 5000;
      }
    } else {
      const consecRun = getMaxConsecutiveRunWith(t.id, day, periodIndex);
      if (consecRun > (t.maxConsecutivePeriods || maxConsecutive)) {
        penalty += 1800;
      }
      if (tDay >= maxDaily) {
        penalty += 80000 + (tDay - maxDaily) * 5000;
      } else if (tDay >= idealDaily) {
        penalty += 450 * (tDay - idealDaily + 1);
      }
      penalty += tDay * 240;
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
    room?: string
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
      const maxDaily = getTeacherDailyMax(t);
      if (currentDayCount >= maxDaily) return false;
    }
    if (specialPacedTeacherIdSet.has(teacherId)) {
      const tWeek = teacherWeekLoad.get(teacherId) || 0;
      const runLimit = tWeek >= 20 ? 4 : 3;
      if (getMaxConsecutiveRunWith(teacherId, destDay, destPeriod) >= runLimit) {
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
          blockerEntry.room
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
          blockerEntry.room
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
          peerEntry.room
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
            blockerEntry.room
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
          (teacherDayLoad.get(`${peerTeacher.id}_${bDay}`) || 0) >= getTeacherDailyMax(peerTeacher)
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
        if (!allowRelaxedDaily && !t1AlreadyInPhysical && (teacherDayLoad.get(`${t1.id}_${existingEntry.day}`) || 0) >= getTeacherDailyMax(t1)) {
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
              se.room
            );
          })
        );

        // If no direct slotB exists and t1 is already free at slotA, try relocating a single existingEntry's teacher out of slotB
        if (slotAList.length === 1 && swapSlotIdx === -1 && allowBlockerRelocation && !t1BusyAtA && existingEntry.teacherId) {
          const existingTeacherObj = teacherMap.get(existingEntry.teacherId);
          if (existingTeacherObj) {
            for (let bIdx = 0; bIdx < availableSlots.length; bIdx++) {
              const slotB = availableSlots[bIdx];
              if (!isPeriodAllowedForSubject(existingEntry.classId, existingEntry.sectionId, existingEntry.subjectId, slotB.periodIndex)) {
                continue;
              }
              if (wouldViolateSubjectDailyLimit(sectionCtx, existingEntry.subjectId, slotB.day, existingEntry.day)) {
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
                slotB.day !== existingEntry.day &&
                (teacherDayLoad.get(`${existingTeacherObj.id}_${slotB.day}`) || 0) >=
                  getTeacherDailyMax(existingTeacherObj)
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
                swapSlotIdx = bIdx;
                break;
              }
            }
          }
        }

        if (swapSlotIdx !== -1) {
          if (t1BusyAtA) {
            if (!tryRelocateTeacherBlockerAtSlot(t1, existingEntry.day, existingEntry.periodIndex, allowRelaxedDaily)) {
              continue;
            }
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
        if (!allowRelaxedDaily && !t1AlreadyInPhys && (teacherDayLoad.get(`${t1.id}_${entryA.day}`) || 0) >= getTeacherDailyMax(t1)) {
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
          if (
            !canTeacherMoveToSlot(
              entryA.teacherId,
              entryM.day,
              entryM.periodIndex,
              entryA.day,
              !allowRelaxedDaily,
              entryA.subjectId,
              entryA.room
            )
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
              entryM.room
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
                  (teacherDayLoad.get(`${mTeacher.id}_${slotB.day}`) || 0) >= getTeacherDailyMax(mTeacher)
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
                    canTeacherMoveToSlot(entryA.teacherId, dayMOrig, periodMOrig, dayAOrig, !allowRelaxedDaily, entryA.subjectId, entryA.room) &&
                    canTeacherMoveToSlot(entryM.teacherId, slotB.day, slotB.periodIndex, dayMOrig, !allowRelaxedDaily, entryM.subjectId, entryM.room)
                  ) {
                    swapSlotIdx = bIdx;
                    break;
                  }
                }
              }
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
        if (!allowRelaxedDaily && !t1AlreadyInPhys && (teacherDayLoad.get(`${t1.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t1)) {
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
          (teacherDayLoad.get(`${t1.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t1)
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
              (teacherDayLoad.get(`${t2.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t2)
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
          (teacherDayLoad.get(`${t1.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t1)
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
              (teacherDayLoad.get(`${t2.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t2)
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
        if (!t1InPhys && (teacherDayLoad.get(`${t1.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t1)) {
          score -= 80000;
        }
        if (chosenCand2) {
          const t2 = chosenCand2.teacher;
          const t2InPhys = teacherSlotEntries.has(`${t2.id}_${slot.day}_${slot.periodIndex}`);
          if (!t2InPhys && (teacherDayLoad.get(`${t2.id}_${slot.day}`) || 0) >= getTeacherDailyMax(t2)) {
            score -= 80000;
          }
        }

        // Strongly pack compatible sections into existing <3 waves to keep Room 307 waves compact
        if (existingWaveCount === 2) {
          score += 45000;
        } else if (existingWaveCount === 1) {
          score += 38000;
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
            const tMaxDaily = t ? getTeacherDailyMax(t) : 5;
            const targetDayBusy = teacherSlotEntries.has(`${donorEntry.teacherId}_${targetSlot.day}_${targetSlot.periodIndex}`);
            if (
              targetSlot.day !== donorEntry.day &&
              !targetDayBusy &&
              (teacherDayLoad.get(`${donorEntry.teacherId}_${targetSlot.day}`) || 0) >= tMaxDaily
            ) {
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

  // ===========================================================================
  // PASS 5: Teacher Daily Limit Rebalancing Pass
  //         Moves or swaps single entries from overloaded days (> maxDaily)
  //         to under-loaded days (< maxDaily) while keeping every rule intact.
  // ===========================================================================
  for (let rebalanceRound = 0; rebalanceRound < 6; rebalanceRound++) {
    let rebalancedAny = false;

    for (const teacher of teachers) {
      const maxDaily = getTeacherDailyMax(teacher);

      for (let step = 0; step < 12; step++) {
        const overDays = workingDays
          .filter(d => (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) > maxDaily)
          .sort((a, b) => (teacherDayLoad.get(`${teacher.id}_${b}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${a}`) || 0));
        const underDays = workingDays
          .filter(d => (teacherDayLoad.get(`${teacher.id}_${d}`) || 0) < maxDaily)
          .sort((a, b) => (teacherDayLoad.get(`${teacher.id}_${a}`) || 0) - (teacherDayLoad.get(`${teacher.id}_${b}`) || 0));

        if (overDays.length === 0 || underDays.length === 0) break;

        let movedThisStep = false;

        for (const dayOver of overDays) {
          if (movedThisStep) break;
          const overEntries = resultEntries.filter(e => {
            if (e.teacherId !== teacher.id || e.day !== dayOver) return false;
            if (isReligionSubject(e.subjectId, subjects)) return false;
            const sk = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
            return (sectionBookings.get(sk)?.length || 0) === 1;
          });

          // Strategy 1: Move directly to an open section slot on an under-loaded day
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
                  entryOver.room
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

          // Strategy 2: Swap entryOver with another teacher's single entry in same section on dayUnder
          if (!movedThisStep) {
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
                    entryOver.room
                  ) ||
                  !canTeacherMoveToSlot(
                    peerEntry.teacherId,
                    entryOver.day,
                    entryOver.periodIndex,
                    peerEntry.day,
                    true,
                    peerEntry.subjectId,
                    peerEntry.room
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
        }

        if (!movedThisStep) break;
      }
    }

    if (!rebalancedAny) break;
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
        if ((keptTeacherDayLoad.get(tdKey) || 0) >= getTeacherDailyMax(t)) {
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
    Boolean(incrementalResult.verification?.finalValidation.allPassed);

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
  const incLimits = incrementalResult.verification?.teacherLimitViolationsCount ?? 0;
  const fullLimits = fullSolveResult.verification?.teacherLimitViolationsCount ?? 0;

  if (
    fullFailCount < incFailCount ||
    (fullFailCount === incFailCount && fullSolveResult.stats.unassignedPeriods < incrementalResult.stats.unassignedPeriods) ||
    (fullFailCount === incFailCount && fullSolveResult.stats.unassignedPeriods === incrementalResult.stats.unassignedPeriods && fullLimits < incLimits)
  ) {
    return fullSolveResult;
  }
  return incrementalResult;
}

