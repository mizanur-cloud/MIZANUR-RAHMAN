import { DayOfWeek, SchoolClass, SchoolSettings, Subject, SubjectRequirement, Teacher } from '../types';

export type ParallelGroup = 'hmt_agr' | 'rel_hin';

export const HINDU_RELIGION_ROOM = '307';
export const LEGACY_HINDU_RELIGION_ROOM = 'Hindu Religion Room';
export const AGRICULTURE_ROOM = 'Agriculture Room';

export function getCombinedHinduRoom(settings?: Pick<SchoolSettings, 'religionSchedule'>): string {
  const custom = settings?.religionSchedule?.hinduRoom?.trim();
  return custom || HINDU_RELIGION_ROOM;
}

export function getMaxReligionConcurrentSections(settings?: Pick<SchoolSettings, 'religionSchedule'>): number {
  const val = settings?.religionSchedule?.maxConcurrentSections;
  return typeof val === 'number' && val >= 1 ? Math.floor(val) : 3;
}

export function isHinduReligionRoom(room: string | undefined, settings?: Pick<SchoolSettings, 'religionSchedule'>): boolean {
  if (!room) return false;
  const target = getCombinedHinduRoom(settings);
  const norm = room.trim().toLowerCase();
  return (
    norm === target.trim().toLowerCase() ||
    norm === '307' ||
    norm === 'room 307' ||
    norm === LEGACY_HINDU_RELIGION_ROOM.toLowerCase()
  );
}

export function isPlayOrNursery(cls: Pick<SchoolClass, 'id' | 'numericGrade'>): boolean {
  return cls.numericGrade <= -1 || cls.id === 'cls-play' || cls.id === 'cls-nursery';
}

export function isClassNineOrTen(cls?: Pick<SchoolClass, 'id' | 'name' | 'numericGrade'>): boolean {
  if (!cls) return false;
  if (cls.numericGrade >= 9) return true;
  if (cls.id === 'cls-9' || cls.id === 'cls-10') return true;
  const lower = (cls.name || '').toLowerCase().trim();
  return (
    lower.includes('class 9') ||
    lower.includes('class 10') ||
    lower.includes('class ix') ||
    lower.includes('class x') ||
    lower === '9' ||
    lower === '10' ||
    lower.includes('nine') ||
    lower.includes('ten') ||
    lower.includes('নবম') ||
    lower.includes('দশম') ||
    lower.includes('৯ম') ||
    lower.includes('১০ম')
  );
}

export function isTeacherBlockTeacher(teacher: Teacher, classes?: SchoolClass[]): boolean {
  if (teacher.isBlockTeacher) return true;
  if (classes) {
    return classes.some(
      c => isPlayOrNursery(c) && Boolean(c.blockTeacherIds?.includes(teacher.id))
    );
  }
  return false;
}

export function isHigherMathSubject(subId: string, subjects?: Subject[]): boolean {
  if (subId === 'sub-hmt') return true;
  const sub = subjects?.find(s => s.id === subId);
  if (!sub) return false;
  const name = sub.name.toLowerCase().trim();
  const code = sub.code.toLowerCase().trim();
  return (
    code === 'hmt' ||
    code === 'hm' ||
    code === 'hmath' ||
    code === 'h.math' ||
    code === 'h.m' ||
    name.includes('higher math') ||
    name.includes('higher-math') ||
    name.includes('h.math') ||
    name.includes('h. math') ||
    name.includes('উচ্চতর গণিত') ||
    name.includes('উচ্চতর গনিত')
  );
}

export function isAgricultureSubject(subId: string, subjects?: Subject[]): boolean {
  if (subId === 'sub-agr') return true;
  const sub = subjects?.find(s => s.id === subId);
  if (!sub) return false;
  const name = sub.name.toLowerCase().trim();
  const code = sub.code.toLowerCase().trim();
  return (
    code === 'agr' ||
    code === 'ag' ||
    code === 'agri' ||
    code === 'agr.' ||
    name.includes('agricult') ||
    name.includes('agritult') ||
    name.includes('agri ') ||
    name === 'agri' ||
    name.includes('কৃষি')
  );
}

export function isHinduReligionSubject(subId: string, subjects?: Subject[]): boolean {
  if (subId === 'sub-hin') return true;
  const sub = subjects?.find(s => s.id === subId);
  if (!sub) return false;
  const name = sub.name.toLowerCase();
  const code = sub.code.toLowerCase();
  return (
    code === 'hin' ||
    code === 'hrm' ||
    name.includes('hindu') ||
    name.includes('হিন্দু') ||
    name.includes('হিন্দূ') ||
    name.includes('সনাতন') ||
    name.includes('sanatan')
  );
}

export function isIslamReligionSubject(subId: string, subjects?: Subject[]): boolean {
  if (subId === 'sub-rel') return true;
  const sub = subjects?.find(s => s.id === subId);
  if (!sub) return false;
  if (isHinduReligionSubject(subId, subjects)) return false;
  const name = sub.name.toLowerCase();
  const code = sub.code.toLowerCase();
  return (
    code === 'rel' ||
    code === 'isl' ||
    code === 'irm' ||
    name.includes('islam') ||
    name.includes('ইসলাম') ||
    name.includes('religion') ||
    name.includes('ধর্ম') ||
    name.includes('রিলিজিয়ন') ||
    name.includes('রিলিজিয়ন')
  );
}

export function isReligionSubject(subId: string, subjects?: Subject[]): boolean {
  return isIslamReligionSubject(subId, subjects) || isHinduReligionSubject(subId, subjects);
}

export function isHinduReligionTeacher(teacher: Teacher, subjects?: Subject[]): boolean {
  const lowerName = (teacher.name || '').toLowerCase();
  const lowerDesig = (teacher.designation || '').toLowerCase();
  if (
    lowerName.includes('taposh') ||
    lowerName.includes('tapash') ||
    lowerName.includes('tapas') ||
    lowerName.includes('তাপস') ||
    lowerDesig.includes('hindu') ||
    lowerDesig.includes('হিন্দু')
  ) {
    return true;
  }
  return (teacher.subjectIds || []).some(sId => isHinduReligionSubject(sId, subjects));
}

export function getCombinedHinduTeacherId(
  teachers: Teacher[],
  settings?: Pick<SchoolSettings, 'religionSchedule'>,
  subjects?: Subject[]
): string | undefined {
  const configuredId = settings?.religionSchedule?.combinedHinduTeacherId;
  if (configuredId && teachers.some(t => t.id === configuredId)) {
    return configuredId;
  }
  const tapash = teachers.find(t => {
    const n = (t.name || '').toLowerCase();
    return t.id === 'tch-tapash' || n.includes('taposh') || n.includes('tapash') || n.includes('tapas') || n.includes('তাপস');
  });
  if (tapash) return tapash.id;
  return teachers.find(t => !t.isBlockTeacher && isHinduReligionTeacher(t, subjects))?.id;
}

export function isAgricultureTeacher(teacher: Teacher, subjects?: Subject[]): boolean {
  const lowerName = (teacher.name || '').toLowerCase();
  const lowerDesig = (teacher.designation || '').toLowerCase();
  if (
    lowerName.includes('moazzem') ||
    lowerName.includes('মোয়াজ্জেম') ||
    lowerName.includes('মোয়াজ্জেম') ||
    lowerDesig.includes('agriculture') ||
    lowerDesig.includes('কৃষি')
  ) {
    return true;
  }
  return (teacher.subjectIds || []).some(sId => isAgricultureSubject(sId, subjects));
}

/**
 * Determines which parallel group a subject belongs to.
 * - Class 9 & 10: Higher Math (hmt) <-> Agriculture (agr)
 * - All Classes (KG - Class 10): Islam Religion (rel) <-> Hindu Religion (hin)
 */
export function getParallelSubjectGroup(
  subjectId: string,
  subjects?: Subject[],
  numericGrade?: number
): ParallelGroup | null {
  if (isIslamReligionSubject(subjectId, subjects) || isHinduReligionSubject(subjectId, subjects)) {
    return 'rel_hin';
  }

  // Higher Math + Agriculture applies primarily to Class 9 & 10 (or when grade unspecified)
  if (numericGrade === undefined || numericGrade >= 9) {
    if (isHigherMathSubject(subjectId, subjects) || isAgricultureSubject(subjectId, subjects)) {
      return 'hmt_agr';
    }
  }

  return null;
}

/**
 * Checks whether two different subjects are configured to run simultaneously in the same period.
 */
export function areParallelSubjects(
  subIdA: string,
  subIdB: string,
  subjects?: Subject[],
  numericGrade?: number
): boolean {
  if (!subIdA || !subIdB || subIdA === subIdB) return false;
  const groupA = getParallelSubjectGroup(subIdA, subjects, numericGrade);
  const groupB = getParallelSubjectGroup(subIdB, subjects, numericGrade);
  return groupA !== null && groupA === groupB;
}

/**
 * Finds the parallel partner subject ID from the subjects catalog if one exists.
 */
export function findParallelPartnerSubjectId(
  subjectId: string,
  subjects: Subject[],
  numericGrade?: number
): string | null {
  if (numericGrade === undefined || numericGrade >= 9) {
    if (isHigherMathSubject(subjectId, subjects)) {
      return subjects.find(s => isAgricultureSubject(s.id, subjects))?.id || null;
    }
    if (isAgricultureSubject(subjectId, subjects)) {
      return subjects.find(s => isHigherMathSubject(s.id, subjects))?.id || null;
    }
  }

  if (isIslamReligionSubject(subjectId, subjects)) {
    return subjects.find(s => isHinduReligionSubject(s.id, subjects))?.id || null;
  }
  if (isHinduReligionSubject(subjectId, subjects)) {
    return subjects.find(s => isIslamReligionSubject(s.id, subjects))?.id || null;
  }

  return null;
}

/**
 * Resolves the expected teacherId for a specific (class, section, subject).
 * Strictly honors section-level subjectConfigs first, then exact section teacher locks,
 * and falls back to class-level default ONLY when the section did not explicitly configure/clear it.
 */
export function getExpectedSectionTeacherId(
  cls: SchoolClass,
  sectionId: string,
  subjectId: string,
  teachers?: Teacher[]
): string | undefined {
  const sec = cls.sections.find(s => s.id === sectionId);
  const secCfg = sec?.subjectConfigs?.[subjectId];

  // 1. Explicit section-level override (including explicit empty '' meaning "Any Qualified Teacher")
  if (secCfg && secCfg.assignedTeacherId !== undefined) {
    return secCfg.assignedTeacherId ? secCfg.assignedTeacherId : undefined;
  }

  // 2. Exact section assignment on a Teacher object
  if (teachers) {
    const exactMatch = teachers.find(t =>
      !t.isBlockTeacher &&
      t.assignedClassSections?.some(
        a =>
          a.classId === cls.id &&
          a.sectionId === sectionId &&
          (!a.subjectId || a.subjectId === subjectId)
      )
    );
    if (exactMatch) return exactMatch.id;
  }

  // 3. Fallback to class template requirement only when section has not overridden it
  const classReq = cls.subjectRequirements.find(r => r.subjectId === subjectId);
  const classAssigned = classReq?.assignedTeacherId;
  if (classAssigned && teachers) {
    const t = teachers.find(cand => cand.id === classAssigned);
    if (t) {
      const classLocks = (t.assignedClassSections || []).filter(
        a => a.classId === cls.id && (!a.subjectId || a.subjectId === subjectId)
      );
      if (classLocks.length > 0 && !classLocks.some(a => !a.sectionId || a.sectionId === sectionId)) {
        return undefined;
      }
    }
  }
  return classAssigned;
}

/**
 * Returns the active SubjectRequirement list for a specific section inside a class.
 * Honors section-wise selectedSubjectIds, section-wise subjectConfigs.periodsPerWeek,
 * and section-wise subjectConfigs.assignedTeacherId completely independently per section.
 */
export function getEffectiveSectionRequirements(
  cls: SchoolClass,
  sectionId: string,
  teachers?: Teacher[]
): SubjectRequirement[] {
  if (isPlayOrNursery(cls)) return [];
  const sec = cls.sections.find(s => s.id === sectionId);
  const baseBySubId = new Map<string, SubjectRequirement>();
  cls.subjectRequirements.forEach(r => baseBySubId.set(r.subjectId, r));

  // Candidate subject IDs for this section
  let activeSubIds: string[];
  if (!sec || sec.selectedSubjectIds === undefined) {
    activeSubIds = cls.subjectRequirements.map(r => r.subjectId);
  } else {
    activeSubIds = sec.selectedSubjectIds;
  }

  const seen = new Set<string>();
  const resolved: SubjectRequirement[] = [];

  for (const subId of activeSubIds) {
    if (seen.has(subId)) continue;
    seen.add(subId);

    const baseReq = baseBySubId.get(subId);
    const secCfg = sec?.subjectConfigs?.[subId];
    const periodsPerWeek =
      secCfg?.periodsPerWeek !== undefined
        ? secCfg.periodsPerWeek
        : baseReq?.periodsPerWeek ?? 0;

    if (periodsPerWeek <= 0) continue;

    const assignedTeacherId = getExpectedSectionTeacherId(cls, sectionId, subId, teachers);
    resolved.push({
      subjectId: subId,
      periodsPerWeek,
      assignedTeacherId,
    });
  }

  return resolved;
}

/**
 * Checks whether a subject is selected & enabled for a given section.
 */
export function isSubjectSelectedForSection(
  cls: SchoolClass,
  sectionId: string,
  subjectId: string
): boolean {
  if (isPlayOrNursery(cls)) {
    return subjectId === 'sub-block-play-nur';
  }
  const sec = cls.sections.find(s => s.id === sectionId);
  if (!sec || sec.selectedSubjectIds === undefined) {
    const base = cls.subjectRequirements.find(r => r.subjectId === subjectId);
    const cfg = sec?.subjectConfigs?.[subjectId];
    const periods = cfg?.periodsPerWeek !== undefined ? cfg.periodsPerWeek : base?.periodsPerWeek ?? 0;
    return Boolean(base) && periods > 0;
  }
  if (!sec.selectedSubjectIds.includes(subjectId)) return false;
  const base = cls.subjectRequirements.find(r => r.subjectId === subjectId);
  const cfg = sec?.subjectConfigs?.[subjectId];
  const periods = cfg?.periodsPerWeek !== undefined ? cfg.periodsPerWeek : base?.periodsPerWeek ?? 0;
  return (Boolean(base) || Boolean(cfg)) && periods > 0;
}

/**
 * Checks whether a teacher is blocked / marked unavailable at a given (day, periodIndex)
 * via either period-wide blocks (`unavailablePeriods`) or specific Day+Period slots (`unavailableSlots`).
 */
export function isTeacherBlockedAtSlot(
  teacher: Pick<Teacher, 'unavailableSlots' | 'unavailablePeriods'> | undefined,
  day: DayOfWeek,
  periodIndex: number
): boolean {
  if (!teacher) return false;
  if (teacher.unavailablePeriods?.includes(periodIndex)) return true;
  return Boolean(teacher.unavailableSlots?.some(u => u.day === day && u.periodIndex === periodIndex));
}

/**
 * Resolves the allowed/fixed period indices for a subject inside a specific class & section.
 * Priority: Section override -> Class Requirement -> Global Subject default -> undefined (any period).
 */
export function getEffectiveSubjectFixedPeriods(
  cls: SchoolClass | undefined,
  sectionId: string,
  subjectId: string,
  subjects?: Subject[]
): number[] | undefined {
  if (!cls || isPlayOrNursery(cls)) return undefined;
  const sec = cls.sections.find(s => s.id === sectionId);
  const secCfg = sec?.subjectConfigs?.[subjectId];

  if (secCfg && secCfg.fixedPeriodIndices !== undefined) {
    return secCfg.fixedPeriodIndices.length > 0 ? secCfg.fixedPeriodIndices : undefined;
  }

  const classReq = cls.subjectRequirements.find(r => r.subjectId === subjectId);
  if (classReq && classReq.fixedPeriodIndices !== undefined) {
    return classReq.fixedPeriodIndices.length > 0 ? classReq.fixedPeriodIndices : undefined;
  }

  const sub = subjects?.find(s => s.id === subjectId);
  if (sub?.fixedPeriodIndices && sub.fixedPeriodIndices.length > 0) {
    return sub.fixedPeriodIndices;
  }

  return undefined;
}

