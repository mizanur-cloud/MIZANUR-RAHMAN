import { DayOfWeek, PeriodTiming, SchoolClass, Teacher, TimetableEntry } from '../types';

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
}

export function generateSmartTimetable(
  classes: SchoolClass[],
  teachers: Teacher[],
  workingDays: DayOfWeek[],
  periodTimings: PeriodTiming[],
  existingEntries: TimetableEntry[],
  options: GenerationOptions
): GenerationResult {
  const maxConsecutive = options.maxConsecutiveLimit || 2;
  const teachingPeriods = periodTimings.filter(p => !p.isBreak).map(p => p.periodIndex);

  // Determine which sections are in scope
  const targetSections: { classObj: SchoolClass; sectionId: string; sectionName: string; room?: string }[] = [];

  classes.forEach(c => {
    if (options.scope === 'class' && c.id !== options.targetClassId) return;

    c.sections.forEach(s => {
      if (options.scope === 'section') {
        if (c.id === options.targetClassId && s.id === options.targetSectionId) {
          targetSections.push({ classObj: c, sectionId: s.id, sectionName: s.name, room: s.roomNumber });
        }
      } else {
        targetSections.push({ classObj: c, sectionId: s.id, sectionName: s.name, room: s.roomNumber });
      }
    });
  });

  // Start with existing entries that are outside the target scope (or all if preserving locked)
  const isTargetSlot = (entry: TimetableEntry) => {
    if (options.scope === 'all') return true;
    if (options.scope === 'class') return entry.classId === options.targetClassId;
    if (options.scope === 'section') return entry.classId === options.targetClassId && entry.sectionId === options.targetSectionId;
    return false;
  };

  const preservedEntries = existingEntries.filter(entry => !isTargetSlot(entry));
  const resultEntries: TimetableEntry[] = [...preservedEntries];

  // Helper tracking sets
  // teacherBookings: Map<"teacherId_day_periodIndex", true>
  const teacherBookings = new Map<string, string>(); // key -> entryId
  // sectionBookings: Map<"classId_sectionId_day_periodIndex", TimetableEntry>
  const sectionBookings = new Map<string, TimetableEntry>();

  // Populate tracking from preserved entries
  preservedEntries.forEach(e => {
    if (e.teacherId) {
      teacherBookings.set(`${e.teacherId}_${e.day}_${e.periodIndex}`, e.id);
    }
    sectionBookings.set(`${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`, e);
  });

  // Teacher lookup map
  const teacherMap = new Map<string, Teacher>();
  teachers.forEach(t => teacherMap.set(t.id, t));

  let totalAssigned = 0;
  let totalUnassigned = 0;

  // Process each section
  for (const { classObj, sectionId, room } of targetSections) {
    // Build list of all needed period allocations for this section
    interface PeriodItem {
      subjectId: string;
      preferredTeacherId?: string;
    }

    const itemsToSchedule: PeriodItem[] = [];
    classObj.subjectRequirements.forEach(req => {
      for (let i = 0; i < req.periodsPerWeek; i++) {
        itemsToSchedule.push({
          subjectId: req.subjectId,
          preferredTeacherId: req.assignedTeacherId,
        });
      }
    });

    // Shuffle slightly for organic distribution while sorting heavy subjects first
    itemsToSchedule.sort((a, b) => {
      const countA = itemsToSchedule.filter(x => x.subjectId === a.subjectId).length;
      const countB = itemsToSchedule.filter(x => x.subjectId === b.subjectId).length;
      return countB - countA;
    });

    // Track how many times a subject has been scheduled on each day for this section
    const subjectDayCount = new Map<string, number>(); // key: "subjectId_day"

    // Helper to evaluate consecutive periods for a teacher
    const wouldExceedConsecutive = (teacherId: string, day: DayOfWeek, periodIndex: number): boolean => {
      // Find all periods this teacher has on this day so far
      const currentPeriods: number[] = [periodIndex];
      teachingPeriods.forEach(p => {
        if (p !== periodIndex && teacherBookings.has(`${teacherId}_${day}_${p}`)) {
          currentPeriods.push(p);
        }
      });
      currentPeriods.sort((a, b) => a - b);

      // Check longest run
      let run = 1;
      for (let i = 1; i < currentPeriods.length; i++) {
        if (currentPeriods[i] === currentPeriods[i - 1] + 1) {
          run++;
          if (run > maxConsecutive) return true;
        } else {
          run = 1;
        }
      }
      return false;
    };

    // Find candidate teacher for a subject
    const getCandidateTeachers = (subjectId: string, preferredId?: string): Teacher[] => {
      const candidates: Teacher[] = [];
      if (preferredId && teacherMap.has(preferredId)) {
        candidates.push(teacherMap.get(preferredId)!);
      }
      teachers.forEach(t => {
        if (t.id !== preferredId && t.subjectIds.includes(subjectId)) {
          candidates.push(t);
        }
      });
      return candidates;
    };

    // All available time slots for this section: (day, periodIndex)
    const availableSlots: { day: DayOfWeek; periodIndex: number }[] = [];
    workingDays.forEach(day => {
      teachingPeriods.forEach(periodIndex => {
        const slotKey = `${classObj.id}_${sectionId}_${day}_${periodIndex}`;
        if (!sectionBookings.has(slotKey)) {
          availableSlots.push({ day, periodIndex });
        }
      });
    });

    // Try to assign each required subject period
    for (const item of itemsToSchedule) {
      const candidateTeachers = getCandidateTeachers(item.subjectId, item.preferredTeacherId);
      if (candidateTeachers.length === 0) {
        totalUnassigned++;
        continue;
      }

      let bestSlotIndex = -1;
      let bestTeacher: Teacher | null = null;
      let bestScore = -Infinity;

      for (let sIdx = 0; sIdx < availableSlots.length; sIdx++) {
        const slot = availableSlots[sIdx];
        const daySubKey = `${item.subjectId}_${slot.day}`;
        const dayCount = subjectDayCount.get(daySubKey) || 0;

        // Try candidate teachers
        for (const teacher of candidateTeachers) {
          const teacherSlotKey = `${teacher.id}_${slot.day}_${slot.periodIndex}`;
          if (teacherBookings.has(teacherSlotKey)) continue;

          // Check teacher unavailable slots
          if (teacher.unavailableSlots?.some(u => u.day === slot.day && u.periodIndex === slot.periodIndex)) {
            continue;
          }

          const exceedsConsecutive = wouldExceedConsecutive(teacher.id, slot.day, slot.periodIndex);

          // Scoring heuristic:
          // - High penalty if subject already taught on that day (spread across days)
          // - Penalty if exceeds consecutive limit
          // - Bonus for preferred teacher
          let score = 100;
          if (dayCount > 0) score -= (dayCount * 50);
          if (exceedsConsecutive) score -= 40;
          if (teacher.id === item.preferredTeacherId) score += 20;

          // Add a slight pseudo-random jitter to prevent rigid patterns
          score += (Math.random() * 5);

          if (score > bestScore) {
            bestScore = score;
            bestSlotIndex = sIdx;
            bestTeacher = teacher;
          }
        }
      }

      if (bestSlotIndex !== -1 && bestTeacher) {
        const chosenSlot = availableSlots.splice(bestSlotIndex, 1)[0];
        const entryId = `gen-${classObj.id}-${sectionId}-${chosenSlot.day}-${chosenSlot.periodIndex}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;

        const newEntry: TimetableEntry = {
          id: entryId,
          classId: classObj.id,
          sectionId: sectionId,
          day: chosenSlot.day,
          periodIndex: chosenSlot.periodIndex,
          subjectId: item.subjectId,
          teacherId: bestTeacher.id,
          room: room,
        };

        resultEntries.push(newEntry);
        teacherBookings.set(`${bestTeacher.id}_${chosenSlot.day}_${chosenSlot.periodIndex}`, entryId);
        sectionBookings.set(`${classObj.id}_${sectionId}_${chosenSlot.day}_${chosenSlot.periodIndex}`, newEntry);

        const daySubKey = `${item.subjectId}_${chosenSlot.day}`;
        subjectDayCount.set(daySubKey, (subjectDayCount.get(daySubKey) || 0) + 1);

        totalAssigned++;
      } else {
        totalUnassigned++;
      }
    }
  }

  return {
    success: true,
    entries: resultEntries,
    message: `Routine successfully generated for ${targetSections.length} sections (${totalAssigned} periods assigned).`,
    stats: {
      totalClassesScheduled: targetSections.length,
      totalPeriodsAssigned: totalAssigned,
      unassignedPeriods: totalUnassigned,
    },
  };
}
