import {
  DayOfWeek,
  PeriodTiming,
  ProxyLogEntry,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import {
  AssignmentLimitEvaluation,
  TeacherWorkloadSummary,
  computeTeacherWorkload,
  evaluateAssignmentLimits,
  getLocalDateStr,
} from './workloadService';

export type ProxyMatchType = 'same_subject' | 'same_department' | 'free_teacher' | 'manual';

export interface ProxyAssignment {
  id: string;
  originalEntryId: string;
  date?: string;
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
  overriddenWarning?: string;
}

export interface ProxyPlanResult {
  date?: string;
  day: DayOfWeek;
  absentTeacherIds: string[];
  totalAbsentClasses: number;
  assignedCount: number;
  unassignedCount: number;
  assignments: ProxyAssignment[];
}

export interface RankedProxyCandidate {
  teacher: Teacher;
  workload: TeacherWorkloadSummary;
  limitEval: AssignmentLimitEvaluation;
  isSameSubject: boolean;
  isSameDepartment: boolean;
  isRecommendedLowestLoad: boolean;
  inlineLabel: string; // e.g., "Free | Load: 16/24 | Proxy: 1"
}

export interface BusyProxyCandidate {
  teacher: Teacher;
  workload: TeacherWorkloadSummary;
  reason: string;
  reasonCode: 'absent' | 'exempt' | 'regular_class' | 'existing_proxy' | 'daily_proxy_limit' | 'blocked_slot';
}

export interface SlotProxyEvaluation {
  freeCandidates: RankedProxyCandidate[];
  busyCandidates: BusyProxyCandidate[];
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

function isTeacherBlockedAtDayPeriod(teacher: Teacher, day: DayOfWeek, periodIndex: number): boolean {
  if (teacher.unavailablePeriods?.includes(periodIndex)) return true;
  if (teacher.unavailableSlots?.some(s => s.day === day && s.periodIndex === periodIndex)) {
    return true;
  }
  return false;
}

/**
 * Checks if a teacher is eligible to be assigned a proxy class.
 * Institutional rules:
 * 1. কো-অর্ডিনেটরদের প্রক্সি ক্লাস দেওয়া যাবে না (Coordinators cannot be assigned proxy classes).
 * 2. যারা ব্লক টিচার (প্লে ও নার্সারি) থাকবে তাদের প্রক্সি ক্লাসেও দেওয়া যাবে না।
 * 3. মোয়াজ্জেম স্যার (বা noProxy ফ্ল্যাগযুক্ত শিক্ষক) কে প্রক্সি ক্লাস দেওয়া যাবে না।
 */
export function isEligibleForProxy(teacher: Teacher, classes?: SchoolClass[]): boolean {
  if (teacher.noProxy) return false;

  const lowerName = (teacher.name || '').toLowerCase();
  if (
    lowerName.includes('moazzem') ||
    lowerName.includes('মোয়াজ্জেম') ||
    lowerName.includes('মোয়াজ্জেম')
  ) {
    return false;
  }

  if (teacher.isCoordinator) return false;
  const desig = (teacher.designation || '').toLowerCase();
  if (
    desig.includes('coordinator') ||
    desig.includes('কো-অর্ডিনেটর') ||
    desig.includes('কো অর্ডিনেটর') ||
    desig.includes('কোঅর্ডিনেটর')
  ) {
    return false;
  }

  if (teacher.isBlockTeacher) return false;
  if (classes) {
    const isPlayNurBlock = classes.some(
      c =>
        (c.id === 'cls-play' || c.id === 'cls-nursery' || c.numericGrade <= -1) &&
        c.blockTeacherIds?.includes(teacher.id)
    );
    if (isPlayNurBlock) return false;
  }
  return true;
}

/**
 * Evaluates all teachers for a specific `(date, day, periodIndex)` slot,
 * cleanly separating Available/Free teachers (ranked primarily by lowest total
 * weekly load = Regular + Proxy) from Busy/Absent/Exempt teachers.
 */
export function evaluateProxyCandidatesForSlot(params: {
  date: string;
  day: DayOfWeek;
  periodIndex: number;
  subjectId: string;
  absentTeacherIdsOnDate: string[];
  allEntries: TimetableEntry[];
  existingProxyLogs: ProxyLogEntry[];
  teachers: Teacher[];
  classes: SchoolClass[];
  subjects: Subject[];
  ignoreProxyLogId?: string;
  pendingSameDatePeriods?: { teacherId: string; periodIndex: number }[];
  sortMode?: 'lowest_load' | 'subject_first';
  settings?: SchoolSettings;
}): SlotProxyEvaluation {
  const {
    date,
    day,
    periodIndex,
    subjectId,
    absentTeacherIdsOnDate,
    allEntries,
    existingProxyLogs,
    teachers,
    classes,
    ignoreProxyLogId,
    pendingSameDatePeriods = [],
    sortMode = 'lowest_load',
    settings,
  } = params;

  const subjectDept = getDepartmentOfSubject(subjectId);
  const freeCandidates: RankedProxyCandidate[] = [];
  const busyCandidates: BusyProxyCandidate[] = [];

  for (const teacher of teachers) {
    const workload = computeTeacherWorkload(teacher, allEntries, existingProxyLogs, {
      targetDate: date,
      targetDay: day,
      settings,
    });

    if (absentTeacherIdsOnDate.includes(teacher.id)) {
      busyCandidates.push({
        teacher,
        workload,
        reason: 'অনুপস্থিত / ছুটিতে (Absent on Date)',
        reasonCode: 'absent',
      });
      continue;
    }

    if (!isEligibleForProxy(teacher, classes)) {
      busyCandidates.push({
        teacher,
        workload,
        reason: teacher.isCoordinator
          ? 'কো-অর্ডিনেটর (প্রক্সি মুক্ত)'
          : teacher.isBlockTeacher
          ? 'ব্লক টিচার (প্রক্সি মুক্ত)'
          : 'প্রক্সি মুক্ত (Exempted)',
        reasonCode: 'exempt',
      });
      continue;
    }

    if (isTeacherBlockedAtDayPeriod(teacher, day, periodIndex)) {
      busyCandidates.push({
        teacher,
        workload,
        reason: `${day} P${periodIndex} বন্ধ নির্ধারিত`,
        reasonCode: 'blocked_slot',
      });
      continue;
    }

    const regularEntry = allEntries.find(
      e => e.teacherId === teacher.id && e.day === day && e.periodIndex === periodIndex
    );
    if (regularEntry) {
      const clsName = classes.find(c => c.id === regularEntry.classId)?.name || 'Class';
      busyCandidates.push({
        teacher,
        workload,
        reason: `নিয়মিত ক্লাস (${clsName})`,
        reasonCode: 'regular_class',
      });
      continue;
    }

    const existingProxyAtSlot = existingProxyLogs.find(
      p =>
        p.status !== 'cancelled' &&
        p.id !== ignoreProxyLogId &&
        p.proxyTeacherId === teacher.id &&
        p.date === date &&
        p.periodIndex === periodIndex
    );
    const pendingProxyAtSlot = pendingSameDatePeriods.some(
      p => p.teacherId === teacher.id && p.periodIndex === periodIndex
    );
    if (existingProxyAtSlot || pendingProxyAtSlot) {
      busyCandidates.push({
        teacher,
        workload,
        reason: existingProxyAtSlot
          ? `অন্য প্রক্সি নির্ধারিত (${existingProxyAtSlot.className})`
          : 'এই পিরিয়ডে প্রক্সি নির্ধারিত',
        reasonCode: 'existing_proxy',
      });
      continue;
    }

    // Hard institutional rule: A teacher cannot be assigned more than 1 proxy class on the same date
    const existingProxyOnDate = existingProxyLogs.find(
      p =>
        p.status !== 'cancelled' &&
        p.id !== ignoreProxyLogId &&
        p.proxyTeacherId === teacher.id &&
        p.date === date
    );
    const pendingProxyOnDate = pendingSameDatePeriods.find(
      p => p.teacherId === teacher.id
    );
    if (existingProxyOnDate || pendingProxyOnDate) {
      busyCandidates.push({
        teacher,
        workload,
        reason: existingProxyOnDate
          ? `আজ ১টি প্রক্সি নির্ধারিত (${existingProxyOnDate.className} · P${existingProxyOnDate.periodIndex})`
          : `আজ ১টি প্রক্সি নির্ধারিত (P${pendingProxyOnDate!.periodIndex})`,
        reasonCode: 'daily_proxy_limit',
      });
      continue;
    }

    const limitEval = evaluateAssignmentLimits({
      mode: 'proxy',
      teacher,
      day,
      periodIndex,
      date,
      entries: allEntries,
      proxyLogs: existingProxyLogs,
      absentTeacherIdsOnDate,
      ignoreProxyLogId,
      settings,
    });

    const isSameSubject = teacher.subjectIds.includes(subjectId);
    const isSameDepartment = Boolean(
      subjectDept && teacher.subjectIds.some(sId => getDepartmentOfSubject(sId) === subjectDept)
    );

    freeCandidates.push({
      teacher,
      workload,
      limitEval,
      isSameSubject,
      isSameDepartment,
      isRecommendedLowestLoad: false,
      inlineLabel: `Free | Load: ${workload.totalWeeklyLoad}/${workload.weeklyMax} | Proxy: ${workload.proxyWeeklyPeriods}`,
    });
  }

  freeCandidates.sort((a, b) => {
    const aOver = a.limitEval.hasOverloadWarning ? 1 : 0;
    const bOver = b.limitEval.hasOverloadWarning ? 1 : 0;
    if (aOver !== bOver) return aOver - bOver;

    if (sortMode === 'subject_first') {
      if (a.isSameSubject !== b.isSameSubject) return a.isSameSubject ? -1 : 1;
      if (a.isSameDepartment !== b.isSameDepartment) return a.isSameDepartment ? -1 : 1;
    }

    if (a.workload.totalWeeklyLoad !== b.workload.totalWeeklyLoad) {
      return a.workload.totalWeeklyLoad - b.workload.totalWeeklyLoad;
    }

    if (a.isSameSubject !== b.isSameSubject) return a.isSameSubject ? -1 : 1;
    if (a.isSameDepartment !== b.isSameDepartment) return a.isSameDepartment ? -1 : 1;

    if (a.workload.proxyWeeklyPeriods !== b.workload.proxyWeeklyPeriods) {
      return a.workload.proxyWeeklyPeriods - b.workload.proxyWeeklyPeriods;
    }

    return a.workload.totalDailyLoad - b.workload.totalDailyLoad;
  });

  if (freeCandidates.length > 0) {
    // Tag the lowest-load eligible (non-overloaded if available) candidate(s)
    const nonOverPool = freeCandidates.filter(c => !c.limitEval.hasOverloadWarning);
    const refPool = nonOverPool.length > 0 ? nonOverPool : freeCandidates;
    const minWeeklyLoad = Math.min(...refPool.map(c => c.workload.totalWeeklyLoad));
    for (const c of refPool) {
      if (c.workload.totalWeeklyLoad === minWeeklyLoad) {
        c.isRecommendedLowestLoad = true;
      }
    }
  }

  return { freeCandidates, busyCandidates };
}

export function generateDailyProxyPlan(
  day: DayOfWeek,
  absentTeacherIds: string[],
  allEntries: TimetableEntry[],
  teachers: Teacher[],
  classes: SchoolClass[],
  subjects: Subject[],
  periodTimings: PeriodTiming[],
  options?: {
    targetDate?: string;
    proxyLogs?: ProxyLogEntry[];
    settings?: SchoolSettings;
  }
): ProxyPlanResult {
  const targetDate = options?.targetDate || getLocalDateStr();
  const proxyLogs = options?.proxyLogs || [];
  const settings = options?.settings;

  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const classMap = new Map(classes.map(c => [c.id, c]));
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const periodMap = new Map(periodTimings.map(p => [p.periodIndex, p]));

  const affectedEntries = allEntries
    .filter(e => e.day === day && absentTeacherIds.includes(e.teacherId))
    .sort((a, b) => a.periodIndex - b.periodIndex);

  const pendingSameDatePeriods: { teacherId: string; periodIndex: number }[] = [];
  const virtualLogs: ProxyLogEntry[] = [...proxyLogs];

  const assignments: ProxyAssignment[] = [];
  let assignedCount = 0;
  let unassignedCount = 0;

  for (const entry of affectedEntries) {
    const period = periodMap.get(entry.periodIndex);
    const cls = classMap.get(entry.classId);
    const sec = cls?.sections.find(s => s.id === entry.sectionId);
    const sub = subjectMap.get(entry.subjectId);
    const absentTch = teacherMap.get(entry.teacherId);

    const alreadySaved = proxyLogs.find(
      p =>
        p.status !== 'cancelled' &&
        p.date === targetDate &&
        p.classId === entry.classId &&
        p.sectionId === entry.sectionId &&
        p.periodIndex === entry.periodIndex &&
        p.subjectId === entry.subjectId
    );
    if (alreadySaved) {
      assignedCount++;
      pendingSameDatePeriods.push({
        teacherId: alreadySaved.proxyTeacherId,
        periodIndex: entry.periodIndex,
      });
      assignments.push({
        id: alreadySaved.id,
        originalEntryId: entry.id,
        date: targetDate,
        day,
        periodIndex: entry.periodIndex,
        periodLabel: alreadySaved.periodLabel || period?.label || `Period ${entry.periodIndex}`,
        periodTime: alreadySaved.periodTime || `${period?.startTime || ''} - ${period?.endTime || ''}`,
        classId: entry.classId,
        className: cls?.name || alreadySaved.className,
        sectionId: entry.sectionId,
        sectionName: sec?.name || alreadySaved.sectionName,
        subjectId: entry.subjectId,
        subjectName: sub?.name || alreadySaved.subjectName,
        subjectColor: sub?.color || alreadySaved.subjectColor || '#3B82F6',
        absentTeacherId: entry.teacherId,
        absentTeacherName: absentTch?.name || alreadySaved.absentTeacherName,
        substituteTeacherId: alreadySaved.proxyTeacherId,
        substituteTeacherName: alreadySaved.proxyTeacherName,
        matchType: alreadySaved.matchType || 'manual',
        matchReason: alreadySaved.matchReason || 'Saved in Proxy Log',
        room: entry.room || sec?.roomNumber || alreadySaved.room,
        status: 'assigned',
        overriddenWarning: alreadySaved.overriddenWarning,
      });
      continue;
    }

    // Merged rule: preserve old priority (Same Subject -> Department Peer -> Free Teacher)
    // while strictly checking same-date proxy clashes, absences, and weekly/daily limits
    const { freeCandidates } = evaluateProxyCandidatesForSlot({
      date: targetDate,
      day,
      periodIndex: entry.periodIndex,
      subjectId: entry.subjectId,
      absentTeacherIdsOnDate: absentTeacherIds,
      allEntries,
      existingProxyLogs: virtualLogs,
      teachers,
      classes,
      subjects,
      pendingSameDatePeriods,
      sortMode: 'subject_first',
      settings,
    });

    const nonOverloaded = freeCandidates.filter(c => !c.limitEval.hasOverloadWarning);
    const pool = nonOverloaded.length > 0 ? nonOverloaded : freeCandidates;
    const chosenCandidate = pool[0] || null;
    const chosenTeacher = chosenCandidate?.teacher || null;

    let matchType: ProxyMatchType = 'free_teacher';
    let matchReason = 'Free Period Stand-in (Lowest Load)';

    if (chosenCandidate && chosenTeacher) {
      if (chosenCandidate.isSameSubject) {
        matchType = 'same_subject';
        matchReason = `Same Subject (${sub?.name || 'Subject'}) · Load ${chosenCandidate.workload.totalWeeklyLoad}/${chosenCandidate.workload.weeklyMax}`;
      } else if (chosenCandidate.isSameDepartment) {
        matchType = 'same_department';
        const dept = getDepartmentOfSubject(entry.subjectId) || 'dept';
        matchReason = `Dept Peer (${dept.replace('_', ' ').toUpperCase()}) · Load ${chosenCandidate.workload.totalWeeklyLoad}/${chosenCandidate.workload.weeklyMax}`;
      } else {
        matchType = 'free_teacher';
        matchReason = `Lowest Load (${chosenCandidate.workload.totalWeeklyLoad}/${chosenCandidate.workload.weeklyMax})`;
      }

      assignedCount++;
      pendingSameDatePeriods.push({
        teacherId: chosenTeacher.id,
        periodIndex: entry.periodIndex,
      });

      const assignmentId = `prx-${targetDate}-${entry.id}`;
      virtualLogs.push({
        id: assignmentId,
        date: targetDate,
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
        absentTeacherId: entry.teacherId,
        absentTeacherName: absentTch?.name || 'Absent Teacher',
        proxyTeacherId: chosenTeacher.id,
        proxyTeacherName: chosenTeacher.name,
        assignedByEmail: 'auto@system.local',
        assignedByName: 'Auto Matcher',
        assignedByRole: 'admin',
        status: 'assigned',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      assignments.push({
        id: assignmentId,
        originalEntryId: entry.id,
        date: targetDate,
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
        id: `prx-unassigned-${targetDate}-${entry.id}`,
        originalEntryId: entry.id,
        date: targetDate,
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
        matchReason: 'All eligible teachers busy or absent during this period',
        room: entry.room || sec?.roomNumber,
        status: 'unassigned',
      });
    }
  }

  return {
    date: targetDate,
    day,
    absentTeacherIds,
    totalAbsentClasses: affectedEntries.length,
    assignedCount,
    unassignedCount,
    assignments,
  };
}
