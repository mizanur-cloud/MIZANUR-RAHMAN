import { DayOfWeek, RoutineConflict, SchoolClass, Teacher, TimetableEntry } from '../types';

export function detectAllConflicts(
  entries: TimetableEntry[],
  teachers: Teacher[],
  classes: SchoolClass[],
  workingDays: DayOfWeek[],
  periodIndices: number[]
): RoutineConflict[] {
  const conflicts: RoutineConflict[] = [];

  // Helper maps for quick lookup
  const teacherMap = new Map<string, Teacher>();
  teachers.forEach(t => teacherMap.set(t.id, t));

  const classMap = new Map<string, SchoolClass>();
  classes.forEach(c => classMap.set(c.id, c));

  const getSectionName = (classId: string, sectionId: string) => {
    const cls = classMap.get(classId);
    if (!cls) return sectionId;
    const sec = cls.sections.find(s => s.id === sectionId);
    return `${cls.name} (${sec?.name || sectionId})`;
  };

  // 1. Check for Teacher Double Booking (same day, same periodIndex, same teacherId)
  const teacherSlotMap = new Map<string, TimetableEntry[]>();
  entries.forEach(entry => {
    if (!entry.teacherId) return;
    const key = `${entry.teacherId}_${entry.day}_${entry.periodIndex}`;
    const list = teacherSlotMap.get(key) || [];
    list.push(entry);
    teacherSlotMap.set(key, list);
  });

  teacherSlotMap.forEach((matchedEntries) => {
    if (matchedEntries.length > 1) {
      const first = matchedEntries[0];
      const teacher = teacherMap.get(first.teacherId);
      const teacherName = teacher?.name || 'Assigned Teacher';
      const classNames = matchedEntries.map(e => getSectionName(e.classId, e.sectionId)).join(' and ');

      conflicts.push({
        id: `conf-tch-${first.teacherId}-${first.day}-${first.periodIndex}`,
        type: 'teacher_double_booking',
        severity: 'error',
        day: first.day,
        periodIndex: first.periodIndex,
        title: `Teacher Double Booking: ${teacherName}`,
        description: `${teacherName} is scheduled to teach simultaneously in ${classNames} on ${first.day}, Period ${first.periodIndex}.`,
        entryIds: matchedEntries.map(e => e.id),
        teacherId: first.teacherId,
      });
    }
  });

  // 2. Check for Class/Section Double Booking (same day, same periodIndex, same classId & sectionId)
  const sectionSlotMap = new Map<string, TimetableEntry[]>();
  entries.forEach(entry => {
    const key = `${entry.classId}_${entry.sectionId}_${entry.day}_${entry.periodIndex}`;
    const list = sectionSlotMap.get(key) || [];
    list.push(entry);
    sectionSlotMap.set(key, list);
  });

  sectionSlotMap.forEach((matchedEntries) => {
    if (matchedEntries.length > 1) {
      const first = matchedEntries[0];
      const sectionLabel = getSectionName(first.classId, first.sectionId);

      conflicts.push({
        id: `conf-sec-${first.classId}-${first.sectionId}-${first.day}-${first.periodIndex}`,
        type: 'class_double_booking',
        severity: 'error',
        day: first.day,
        periodIndex: first.periodIndex,
        title: `Class Overlap: ${sectionLabel}`,
        description: `${sectionLabel} has multiple classes scheduled at the same time on ${first.day}, Period ${first.periodIndex}.`,
        entryIds: matchedEntries.map(e => e.id),
        classId: first.classId,
        sectionId: first.sectionId,
      });
    }
  });

  // 3. Check for Max Consecutive Classes per Teacher (Requirement: "Maximum two consecutive classes per teacher")
  // For each teacher and each day, sort scheduled periods
  teachers.forEach(teacher => {
    const maxConsecutive = teacher.maxConsecutivePeriods || 2;
    workingDays.forEach(day => {
      const teacherDayEntries = entries
        .filter(e => e.teacherId === teacher.id && e.day === day)
        .sort((a, b) => a.periodIndex - b.periodIndex);

      if (teacherDayEntries.length <= maxConsecutive) return;

      let consecutiveRun: TimetableEntry[] = [];
      for (let i = 0; i < teacherDayEntries.length; i++) {
        const cur = teacherDayEntries[i];
        if (consecutiveRun.length === 0) {
          consecutiveRun.push(cur);
        } else {
          const prev = consecutiveRun[consecutiveRun.length - 1];
          // If strictly consecutive periodIndex (e.g. 1 then 2 then 3)
          if (cur.periodIndex === prev.periodIndex + 1) {
            consecutiveRun.push(cur);
            if (consecutiveRun.length > maxConsecutive) {
              conflicts.push({
                id: `conf-consec-${teacher.id}-${day}-${cur.periodIndex}`,
                type: 'max_consecutive_exceeded',
                severity: 'warning',
                day: day,
                periodIndex: cur.periodIndex,
                title: `Consecutive Limit: ${teacher.name}`,
                description: `${teacher.name} has ${consecutiveRun.length} consecutive periods scheduled without a break on ${day} (Periods ${consecutiveRun.map(e => e.periodIndex).join(', ')}). Policy allows maximum ${maxConsecutive} consecutive classes.`,
                entryIds: consecutiveRun.map(e => e.id),
                teacherId: teacher.id,
              });
            }
          } else {
            // Gap between periods, reset run
            consecutiveRun = [cur];
          }
        }
      }
    });
  });

  // 4. Check for Teacher Availability
  teachers.forEach(teacher => {
    if (!teacher.unavailableSlots || teacher.unavailableSlots.length === 0) return;
    teacher.unavailableSlots.forEach(slot => {
      const matched = entries.filter(
        e => e.teacherId === teacher.id && e.day === slot.day && e.periodIndex === slot.periodIndex
      );
      if (matched.length > 0) {
        conflicts.push({
          id: `conf-unavail-${teacher.id}-${slot.day}-${slot.periodIndex}`,
          type: 'teacher_unavailable',
          severity: 'error',
          day: slot.day,
          periodIndex: slot.periodIndex,
          title: `Teacher Unavailable: ${teacher.name}`,
          description: `${teacher.name} is marked unavailable on ${slot.day}, Period ${slot.periodIndex}, but is assigned to ${getSectionName(matched[0].classId, matched[0].sectionId)}.`,
          entryIds: matched.map(e => e.id),
          teacherId: teacher.id,
        });
      }
    });
  });

  return conflicts;
}
