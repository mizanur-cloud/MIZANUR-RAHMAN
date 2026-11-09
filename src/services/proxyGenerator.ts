import { DayOfWeek, PeriodTiming, SchoolClass, Subject, Teacher, TimetableEntry } from '../types';

export type ProxyMatchType = 'same_subject' | 'same_department' | 'free_teacher' | 'manual';

export interface ProxyAssignment {
  id: string;
  originalEntryId: string;
  day: DayOfWeek;
  periodIndex: number;
  periodLabel: string;
  periodTime: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  absentTeacherId: string;
  absentTeacherName: string;
  substituteTeacherId: string;
  substituteTeacherName: string;
  matchType: ProxyMatchType;
  matchReason: string;
  room?: string;
  status: 'assigned' | 'unassigned' | 'manual';
}

export interface ProxyPlanResult {
  day: DayOfWeek;
  absentTeacherIds: string[];
  totalAbsentClasses: number;
  assignedCount: number;
  unassignedCount: number;
  assignments: ProxyAssignment[];
}

// Department grouping for discipline-based proxy selection
const DEPARTMENT_GROUPS: Record<string, string[]> = {
  science_math: ['sub-mat', 'sub-hmt', 'sub-phy', 'sub-che', 'sub-bio', 'sub-sci', 'sub-ict'],
  languages: ['sub-ban', 'sub-eng'],
  humanities_social: ['sub-soc', 'sub-bgs', 'sub-rel'],
  arts_sports: ['sub-art', 'sub-ped'],
};

function getDepartmentOfSubject(subjectId: string): string | null {
  for (const [dept, subIds] of Object.entries(DEPARTMENT_GROUPS)) {
    if (subIds.includes(subjectId)) return dept;
  }
  return null;
}

export function generateDailyProxyPlan(
  day: DayOfWeek,
  absentTeacherIds: string[],
  allEntries: TimetableEntry[],
  teachers: Teacher[],
  classes: SchoolClass[],
  subjects: Subject[],
  periodTimings: PeriodTiming[]
): ProxyPlanResult {
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const classMap = new Map(classes.map(c => [c.id, c]));
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const periodMap = new Map(periodTimings.map(p => [p.periodIndex, p]));

  // Find all scheduled classes for the absent teachers on this day
  const affectedEntries = allEntries.filter(
    e => e.day === day && absentTeacherIds.includes(e.teacherId)
  ).sort((a, b) => a.periodIndex - b.periodIndex);

  // Available candidate teachers (not in absent list)
  const availableTeachers = teachers.filter(t => !absentTeacherIds.includes(t.id));

  // Track who is busy in which period on this day
  // busyMap: "teacherId_periodIndex" -> entry
  const busyMap = new Map<string, TimetableEntry>();
  allEntries
    .filter(e => e.day === day && !absentTeacherIds.includes(e.teacherId))
    .forEach(e => {
      busyMap.set(`${e.teacherId}_${e.periodIndex}`, e);
    });

  // Track how many proxy periods assigned to each teacher today
  const assignedProxyCountToday = new Map<string, number>();

  const assignments: ProxyAssignment[] = [];
  let assignedCount = 0;
  let unassignedCount = 0;

  for (const entry of affectedEntries) {
    const period = periodMap.get(entry.periodIndex);
    const cls = classMap.get(entry.classId);
    const sec = cls?.sections.find(s => s.id === entry.sectionId);
    const sub = subjectMap.get(entry.subjectId);
    const absentTch = teacherMap.get(entry.teacherId);
    const subjectDept = getDepartmentOfSubject(entry.subjectId);

    // Filter teachers who are FREE during this exact period on this day
    const freeTeachers = availableTeachers.filter(t => {
      // Must not already have a regular class at this period
      if (busyMap.has(`${t.id}_${entry.periodIndex}`)) return false;
      // Must not already have a proxy assigned in this same period
      if (assignments.some(a => a.substituteTeacherId === t.id && a.periodIndex === entry.periodIndex)) {
        return false;
      }
      return true;
    });

    let chosenTeacher: Teacher | null = null;
    let matchType: ProxyMatchType = 'free_teacher';
    let matchReason = 'Free Period Stand-in';

    if (freeTeachers.length > 0) {
      // Priority 1: Same Subject Specialist (একই বিষয়ের শিক্ষক)
      const sameSubjectTeachers = freeTeachers.filter(t => t.subjectIds.includes(entry.subjectId));
      if (sameSubjectTeachers.length > 0) {
        // Pick the one with the fewest proxy classes so far
        sameSubjectTeachers.sort((a, b) => {
          const aCount = assignedProxyCountToday.get(a.id) || 0;
          const bCount = assignedProxyCountToday.get(b.id) || 0;
          return aCount - bCount;
        });
        chosenTeacher = sameSubjectTeachers[0];
        matchType = 'same_subject';
        matchReason = `Same Subject Specialist (${sub?.name || 'Subject'})`;
      }

      // Priority 2: Same Department / Discipline Colleague (একই বিভাগের শিক্ষক)
      if (!chosenTeacher && subjectDept) {
        const sameDeptTeachers = freeTeachers.filter(t =>
          t.subjectIds.some(sId => getDepartmentOfSubject(sId) === subjectDept)
        );
        if (sameDeptTeachers.length > 0) {
          sameDeptTeachers.sort((a, b) => {
            const aCount = assignedProxyCountToday.get(a.id) || 0;
            const bCount = assignedProxyCountToday.get(b.id) || 0;
            return aCount - bCount;
          });
          chosenTeacher = sameDeptTeachers[0];
          matchType = 'same_department';
          const deptLabel = subjectDept.replace('_', ' ').toUpperCase();
          matchReason = `Department Peer (${deptLabel})`;
        }
      }

      // Priority 3: Any Available Free Teacher with lightest load
      if (!chosenTeacher) {
        freeTeachers.sort((a, b) => {
          const aProxy = assignedProxyCountToday.get(a.id) || 0;
          const bProxy = assignedProxyCountToday.get(b.id) || 0;
          return aProxy - bProxy;
        });
        chosenTeacher = freeTeachers[0];
        matchType = 'free_teacher';
        matchReason = 'Free Period Assignment';
      }
    }

    if (chosenTeacher) {
      assignedCount++;
      assignedProxyCountToday.set(
        chosenTeacher.id,
        (assignedProxyCountToday.get(chosenTeacher.id) || 0) + 1
      );

      assignments.push({
        id: `prx-${entry.id}-${chosenTeacher.id}`,
        originalEntryId: entry.id,
        day,
        periodIndex: entry.periodIndex,
        periodLabel: period?.label || `Period ${entry.periodIndex}`,
        periodTime: `${period?.startTime || ''} - ${period?.endTime || ''}`,
        classId: entry.classId,
        className: cls?.name || 'Class',
        sectionId: entry.sectionId,
        sectionName: sec?.name || 'Section',
        subjectId: entry.subjectId,
        subjectName: sub?.name || 'Subject',
        subjectColor: sub?.color || '#3B82F6',
        absentTeacherId: entry.teacherId,
        absentTeacherName: absentTch?.name || 'Absent Teacher',
        substituteTeacherId: chosenTeacher.id,
        substituteTeacherName: chosenTeacher.name,
        matchType,
        matchReason,
        room: entry.room || sec?.roomNumber,
        status: 'assigned',
      });
    } else {
      unassignedCount++;
      assignments.push({
        id: `prx-unassigned-${entry.id}`,
        originalEntryId: entry.id,
        day,
        periodIndex: entry.periodIndex,
        periodLabel: period?.label || `Period ${entry.periodIndex}`,
        periodTime: `${period?.startTime || ''} - ${period?.endTime || ''}`,
        classId: entry.classId,
        className: cls?.name || 'Class',
        sectionId: entry.sectionId,
        sectionName: sec?.name || 'Section',
        subjectId: entry.subjectId,
        subjectName: sub?.name || 'Subject',
        subjectColor: sub?.color || '#3B82F6',
        absentTeacherId: entry.teacherId,
        absentTeacherName: absentTch?.name || 'Absent Teacher',
        substituteTeacherId: '',
        substituteTeacherName: 'No Free Teacher Available',
        matchType: 'free_teacher',
        matchReason: 'All eligible teachers busy during this period',
        room: entry.room || sec?.roomNumber,
        status: 'unassigned',
      });
    }
  }

  return {
    day,
    absentTeacherIds,
    totalAbsentClasses: affectedEntries.length,
    assignedCount,
    unassignedCount,
    assignments,
  };
}
