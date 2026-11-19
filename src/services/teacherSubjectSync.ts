import { SchoolClass, Subject, Teacher, TeacherClassAssignment, SubjectRequirement, Section } from '../types';
import { isPlayOrNursery, isTeacherBlockTeacher } from './parallelSubjects';

/**
 * Synchronizes teacher assignments (assignedClassSections) to classes and section configs.
 * Institutional Rules:
 * - Play & Nursery: No separate subjectRequirements! Assigned teachers act as Block Teachers (max 2 per class).
 * - Other classes (KG - Class 10): Block teachers cannot be assigned to other classes.
 * - Strict Section Isolation: An assignment with a specific sectionId ONLY modifies that section's
 *   subjectConfigs and NEVER overwrites sibling sections or class-wide defaults.
 */
export function syncTeacherAssignmentsToClasses(
  classes: SchoolClass[],
  teachers: Teacher[],
  subjects: Subject[],
  prevTeachers?: Teacher[]
): SchoolClass[] {
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const prevTeacherMap = new Map((prevTeachers || []).map(t => [t.id, t]));

  return classes.map(cls => {
    // Play & Nursery: strictly keep subjectRequirements empty; sync blockTeacherIds only
    if (isPlayOrNursery(cls)) {
      const assignedIds = teachers
        .filter(t => (t.assignedClassSections || []).some(a => a.classId === cls.id))
        .map(t => t.id);

      const merged = Array.from(new Set([...(cls.blockTeacherIds || []), ...assignedIds])).filter(id =>
        teachers.some(t => t.id === id)
      );

      return {
        ...cls,
        isJuniorClass: true,
        usesShifts: true,
        subjectRequirements: [],
        blockTeacherIds: merged.length > 0 ? merged.slice(0, 2) : cls.blockTeacherIds,
      };
    }

    let newReqs: SubjectRequirement[] = [...cls.subjectRequirements];
    let newSections: Section[] = cls.sections.map(sec => ({
      ...sec,
      subjectConfigs: sec.subjectConfigs ? { ...sec.subjectConfigs } : undefined,
      selectedSubjectIds: sec.selectedSubjectIds ? [...sec.selectedSubjectIds] : undefined,
    }));

    // 1. If prevTeachers provided, clear stale class-wide and section-level teacher assignments that were removed
    if (prevTeachers) {
      newReqs = newReqs.map(r => {
        if (!r.assignedTeacherId) return r;
        const curT = teachers.find(t => t.id === r.assignedTeacherId);
        const prevT = prevTeacherMap.get(r.assignedTeacherId);
        if (!curT || isTeacherBlockTeacher(curT, classes)) return { ...r, assignedTeacherId: undefined };

        const hadClassWide = (prevT?.assignedClassSections || []).some(
          a => a.classId === cls.id && !a.sectionId && (!a.subjectId || a.subjectId === r.subjectId)
        );
        const stillHasClassWide = (curT.assignedClassSections || []).some(
          a => a.classId === cls.id && !a.sectionId && (!a.subjectId || a.subjectId === r.subjectId)
        );
        if (hadClassWide && !stillHasClassWide) {
          return { ...r, assignedTeacherId: undefined };
        }
        return r;
      });

      newSections = newSections.map(sec => {
        if (!sec.subjectConfigs) return sec;
        const nextConfigs = { ...sec.subjectConfigs };
        let changed = false;

        Object.entries(nextConfigs).forEach(([subId, cfg]) => {
          const tId = cfg?.assignedTeacherId;
          if (!tId) return;
          const curT = teachers.find(t => t.id === tId);
          const prevT = prevTeacherMap.get(tId);
          if (!curT || isTeacherBlockTeacher(curT, classes)) {
            nextConfigs[subId] = { ...cfg, assignedTeacherId: '' };
            changed = true;
            return;
          }
          const hadSec = (prevT?.assignedClassSections || []).some(
            a => a.classId === cls.id && a.sectionId === sec.id && (!a.subjectId || a.subjectId === subId)
          );
          const stillHasSec = (curT.assignedClassSections || []).some(
            a => a.classId === cls.id && a.sectionId === sec.id && (!a.subjectId || a.subjectId === subId)
          );
          if (hadSec && !stillHasSec) {
            nextConfigs[subId] = { ...cfg, assignedTeacherId: '' };
            changed = true;
          }
        });

        return changed ? { ...sec, subjectConfigs: nextConfigs } : sec;
      });
    }

    // 2. Apply current non-block teacher assignments
    for (const teacher of teachers) {
      if (isTeacherBlockTeacher(teacher, classes)) continue;

      const assignments = (teacher.assignedClassSections || []).filter(
        a => a.classId === cls.id
      );

      for (const assignment of assignments) {
        if (assignment.sectionId) {
          // Section-specific assignment -> ONLY touches that specific section's subjectConfigs
          const secIdx = newSections.findIndex(s => s.id === assignment.sectionId);
          if (secIdx === -1) continue;
          const sec = newSections[secIdx];
          const targetSubIds = assignment.subjectId
            ? [assignment.subjectId].filter(id => subjectMap.has(id))
            : teacher.subjectIds.filter(id =>
                sec.selectedSubjectIds
                  ? sec.selectedSubjectIds.includes(id)
                  : cls.subjectRequirements.some(r => r.subjectId === id)
              );

          const nextConfigs = { ...(sec.subjectConfigs || {}) };
          targetSubIds.forEach(subId => {
            const prevCfg = nextConfigs[subId] || {};
            if (prevCfg.assignedTeacherId === undefined || prevCfg.assignedTeacherId === '') {
              nextConfigs[subId] = { ...prevCfg, assignedTeacherId: teacher.id };
            }
          });
          newSections[secIdx] = { ...sec, subjectConfigs: nextConfigs };
        } else if (assignment.subjectId) {
          // Class-wide assignment -> updates class template only
          if (!subjectMap.has(assignment.subjectId)) continue;
          const existingIdx = newReqs.findIndex(r => r.subjectId === assignment.subjectId);
          if (existingIdx >= 0) {
            newReqs[existingIdx] = {
              ...newReqs[existingIdx],
              assignedTeacherId: teacher.id,
            };
          } else {
            const defaultPeriods = cls.maxPeriods && cls.maxPeriods <= 4 ? 4 : 5;
            newReqs.push({
              subjectId: assignment.subjectId,
              periodsPerWeek: defaultPeriods,
              assignedTeacherId: teacher.id,
            });
          }
        } else {
          for (const subId of teacher.subjectIds) {
            const existingIdx = newReqs.findIndex(r => r.subjectId === subId);
            if (existingIdx >= 0 && !newReqs[existingIdx].assignedTeacherId) {
              newReqs[existingIdx] = {
                ...newReqs[existingIdx],
                assignedTeacherId: teacher.id,
              };
            }
          }
        }
      }
    }

    return {
      ...cls,
      subjectRequirements: newReqs,
      sections: newSections,
    };
  });
}

/**
 * Synchronize a single teacher's assignments into classes with strict section isolation.
 */
export function syncSingleTeacherToClasses(
  classes: SchoolClass[],
  teacher: Teacher,
  subjects: Subject[],
  previousAssignments?: TeacherClassAssignment[]
): SchoolClass[] {
  const currentClassIds = new Set((teacher.assignedClassSections || []).map(a => a.classId));
  const previousClassIds = new Set((previousAssignments || []).map(a => a.classId));
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherIsBlock = Boolean(teacher.isBlockTeacher);

  return classes.map(cls => {
    if (isPlayOrNursery(cls)) {
      let newBlockTeachers = cls.blockTeacherIds ? [...cls.blockTeacherIds] : [];
      if (currentClassIds.has(cls.id)) {
        if (!newBlockTeachers.includes(teacher.id) && newBlockTeachers.length < 2) {
          newBlockTeachers.push(teacher.id);
        }
      } else if (previousClassIds.has(cls.id)) {
        newBlockTeachers = newBlockTeachers.filter(id => id !== teacher.id);
      }
      return {
        ...cls,
        isJuniorClass: true,
        usesShifts: true,
        subjectRequirements: [],
        blockTeacherIds: newBlockTeachers.length > 0 ? newBlockTeachers : undefined,
      };
    }

    // KG to Class 10: Block teachers cannot be assigned here
    if (teacherIsBlock) {
      return {
        ...cls,
        subjectRequirements: cls.subjectRequirements.map(r =>
          r.assignedTeacherId === teacher.id ? { ...r, assignedTeacherId: undefined } : r
        ),
        sections: cls.sections.map(sec => {
          if (!sec.subjectConfigs) return sec;
          const nextCfg = { ...sec.subjectConfigs };
          Object.keys(nextCfg).forEach(subId => {
            if (nextCfg[subId]?.assignedTeacherId === teacher.id) {
              nextCfg[subId] = { ...nextCfg[subId], assignedTeacherId: '' };
            }
          });
          return { ...sec, subjectConfigs: nextCfg };
        }),
      };
    }

    let newReqs = [...cls.subjectRequirements];
    let newSections = cls.sections.map(sec => ({
      ...sec,
      subjectConfigs: sec.subjectConfigs ? { ...sec.subjectConfigs } : undefined,
    }));

    const isCurrentlyAssigned = currentClassIds.has(cls.id);
    const wasPreviouslyAssigned = previousClassIds.has(cls.id);
    const assignmentsForClass = (teacher.assignedClassSections || []).filter(
      a => a.classId === cls.id
    );

    if (isCurrentlyAssigned) {
      for (const assignment of assignmentsForClass) {
        if (assignment.sectionId) {
          // Section-specific lock -> ONLY updates that exact section's subjectConfigs
          const secIdx = newSections.findIndex(s => s.id === assignment.sectionId);
          if (secIdx === -1) continue;
          const sec = newSections[secIdx];
          const targetSubIds = assignment.subjectId
            ? [assignment.subjectId].filter(id => subjectMap.has(id))
            : teacher.subjectIds;

          const nextConfigs = { ...(sec.subjectConfigs || {}) };
          targetSubIds.forEach(subId => {
            nextConfigs[subId] = {
              ...(nextConfigs[subId] || {}),
              assignedTeacherId: teacher.id,
            };
          });
          newSections[secIdx] = { ...sec, subjectConfigs: nextConfigs };
        } else if (assignment.subjectId) {
          if (!subjectMap.has(assignment.subjectId)) continue;
          const reqIdx = newReqs.findIndex(r => r.subjectId === assignment.subjectId);
          if (reqIdx >= 0) {
            newReqs[reqIdx] = {
              ...newReqs[reqIdx],
              assignedTeacherId: teacher.id,
            };
          } else {
            const defaultPeriods = cls.maxPeriods && cls.maxPeriods <= 4 ? 4 : 5;
            newReqs.push({
              subjectId: assignment.subjectId,
              periodsPerWeek: defaultPeriods,
              assignedTeacherId: teacher.id,
            });
          }
        } else {
          for (const subId of teacher.subjectIds) {
            const reqIdx = newReqs.findIndex(r => r.subjectId === subId);
            if (reqIdx >= 0 && !newReqs[reqIdx].assignedTeacherId) {
              newReqs[reqIdx] = {
                ...newReqs[reqIdx],
                assignedTeacherId: teacher.id,
              };
            }
          }
        }
      }

      // Remove class-wide reference if no class-wide assignment remains for that subject
      newReqs = newReqs.map(r => {
        if (r.assignedTeacherId !== teacher.id) return r;
        const stillClassWide = assignmentsForClass.some(
          a => !a.sectionId && (!a.subjectId || a.subjectId === r.subjectId)
        );
        return stillClassWide ? r : { ...r, assignedTeacherId: undefined };
      });

      // Remove section-level references for this teacher on sections/subjects no longer assigned
      newSections = newSections.map(sec => {
        if (!sec.subjectConfigs) return sec;
        const nextCfg = { ...sec.subjectConfigs };
        let changed = false;
        Object.entries(nextCfg).forEach(([subId, cfg]) => {
          if (cfg?.assignedTeacherId !== teacher.id) return;
          const stillSec = assignmentsForClass.some(
            a => a.sectionId === sec.id && (!a.subjectId || a.subjectId === subId)
          );
          const hadSecBefore = (previousAssignments || []).some(
            a => a.classId === cls.id && a.sectionId === sec.id && (!a.subjectId || a.subjectId === subId)
          );
          if (hadSecBefore && !stillSec) {
            nextCfg[subId] = { ...cfg, assignedTeacherId: '' };
            changed = true;
          }
        });
        return changed ? { ...sec, subjectConfigs: nextCfg } : sec;
      });
    } else if (wasPreviouslyAssigned && !isCurrentlyAssigned) {
      newReqs = newReqs.map(r =>
        r.assignedTeacherId === teacher.id ? { ...r, assignedTeacherId: undefined } : r
      );
      newSections = newSections.map(sec => {
        if (!sec.subjectConfigs) return sec;
        const nextCfg = { ...sec.subjectConfigs };
        let changed = false;
        Object.entries(nextCfg).forEach(([subId, cfg]) => {
          if (cfg?.assignedTeacherId === teacher.id) {
            nextCfg[subId] = { ...cfg, assignedTeacherId: '' };
            changed = true;
          }
        });
        return changed ? { ...sec, subjectConfigs: nextCfg } : sec;
      });
    }

    return {
      ...cls,
      subjectRequirements: newReqs,
      sections: newSections,
    };
  });
}

/**
 * Bidirectional sync: When classes' subject requirements, section subjectConfigs, or blockTeacherIds change,
 * update teachers' assignedClassSections, isBlockTeacher, and noProxy flags cleanly with strict section isolation.
 */
export function syncClassesToTeachers(
  classes: SchoolClass[],
  teachers: Teacher[]
): Teacher[] {
  const validClassSubjectPairs = new Set<string>();
  const classSubjectPreferredTeacher = new Map<string, string>();
  const sectionSubjectPreferredTeacher = new Map<string, string>(); // "classId_sectionId_subjectId" -> teacherId (or '')
  const teacherDesiredAssignments = new Map<string, TeacherClassAssignment[]>();
  const blockTeacherIdSet = new Set<string>();

  const pushDesired = (teacherId: string, item: TeacherClassAssignment) => {
    const list = teacherDesiredAssignments.get(teacherId) || [];
    const exists = list.some(
      a =>
        a.classId === item.classId &&
        (a.sectionId || '') === (item.sectionId || '') &&
        (a.subjectId || '') === (item.subjectId || '')
    );
    if (!exists) {
      list.push(item);
      teacherDesiredAssignments.set(teacherId, list);
    }
  };

  for (const cls of classes) {
    if (isPlayOrNursery(cls) && cls.blockTeacherIds) {
      for (const bId of cls.blockTeacherIds) {
        blockTeacherIdSet.add(bId);
        pushDesired(bId, { classId: cls.id });
      }
      continue;
    }

    for (const req of cls.subjectRequirements) {
      const pairKey = `${cls.id}_${req.subjectId}`;
      validClassSubjectPairs.add(pairKey);
      if (req.assignedTeacherId) {
        classSubjectPreferredTeacher.set(pairKey, req.assignedTeacherId);
        pushDesired(req.assignedTeacherId, {
          classId: cls.id,
          sectionId: undefined,
          subjectId: req.subjectId,
        });
      }
    }

    // Track per-section overrides strictly by sectionId
    for (const sec of cls.sections) {
      if (sec.selectedSubjectIds) {
        sec.selectedSubjectIds.forEach(sId => validClassSubjectPairs.add(`${cls.id}_${sId}`));
      }
      if (sec.subjectConfigs) {
        Object.entries(sec.subjectConfigs).forEach(([subId, cfg]) => {
          validClassSubjectPairs.add(`${cls.id}_${subId}`);
          if (cfg.assignedTeacherId !== undefined) {
            const secKey = `${cls.id}_${sec.id}_${subId}`;
            sectionSubjectPreferredTeacher.set(secKey, cfg.assignedTeacherId);
            if (cfg.assignedTeacherId) {
              pushDesired(cfg.assignedTeacherId, {
                classId: cls.id,
                sectionId: sec.id,
                subjectId: subId,
              });
            }
          }
        });
      }
    }
  }

  return teachers.map(teacher => {
    let currentAssignments = teacher.assignedClassSections ? [...teacher.assignedClassSections] : [];
    const currentSubjectIds = new Set(teacher.subjectIds);

    currentAssignments = currentAssignments.filter(a => {
      if (!a.subjectId) return true;
      const pairKey = `${a.classId}_${a.subjectId}`;
      if (!validClassSubjectPairs.has(pairKey)) return false;

      if (a.sectionId) {
        const secKey = `${a.classId}_${a.sectionId}_${a.subjectId}`;
        if (sectionSubjectPreferredTeacher.has(secKey)) {
          return sectionSubjectPreferredTeacher.get(secKey) === teacher.id;
        }
        return true;
      }

      const classOwner = classSubjectPreferredTeacher.get(pairKey);
      if (classOwner && classOwner !== teacher.id) {
        return false;
      }
      return true;
    });

    const desiredForTeacher = teacherDesiredAssignments.get(teacher.id) || [];
    for (const item of desiredForTeacher) {
      if (item.subjectId && !currentSubjectIds.has(item.subjectId)) {
        currentSubjectIds.add(item.subjectId);
      }

      const alreadyHasExact = currentAssignments.some(
        a =>
          a.classId === item.classId &&
          (a.sectionId || '') === (item.sectionId || '') &&
          (!item.subjectId || a.subjectId === item.subjectId)
      );

      if (!alreadyHasExact) {
        currentAssignments.push(item);
      }
    }

    const isBlock = blockTeacherIdSet.has(teacher.id) || teacher.isBlockTeacher;

    return {
      ...teacher,
      subjectIds: Array.from(currentSubjectIds),
      assignedClassSections: currentAssignments,
      isBlockTeacher: isBlock ? true : teacher.isBlockTeacher,
      noProxy: isBlock ? true : teacher.noProxy,
    };
  });
}
