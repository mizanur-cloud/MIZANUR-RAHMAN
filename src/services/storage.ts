import { INITIAL_CLASSES, INITIAL_SETTINGS, INITIAL_SUBJECTS, INITIAL_TEACHERS, INITIAL_TIMETABLE_ENTRIES } from '../data/initialData';
import { DailyAbsenceRecord, ProxyLogEntry, RoutineSnapshot, SchoolClass, SchoolSettings, Subject, Teacher, TimetableEntry } from '../types';
import { syncTeacherAssignmentsToClasses } from './teacherSubjectSync';
import { isPlayOrNursery } from './parallelSubjects';

const STORAGE_KEYS = {
  CLASSES: 'school_routine_classes_v1',
  TEACHERS: 'school_routine_teachers_v1',
  SUBJECTS: 'school_routine_subjects_v1',
  SETTINGS: 'school_routine_settings_v1',
  ENTRIES: 'school_routine_entries_v1',
  PROXY_LOGS: 'school_routine_proxy_logs_v1',
  DAILY_ABSENCES: 'school_routine_daily_absences_v1',
  POLICY_V2: 'school_routine_policy_v2_migrated',
  POLICY_V3: 'school_routine_policy_v3_migrated',
  POLICY_V4: 'school_routine_policy_v4_migrated',
};

export const SNAPSHOTS_STORAGE_KEY = 'school_routine_snapshots_v1';
export const MAX_ROUTINE_SNAPSHOTS = 10;

export interface AppState {
  classes: SchoolClass[];
  teachers: Teacher[];
  subjects: Subject[];
  settings: SchoolSettings;
  entries: TimetableEntry[];
}

export function stripTeacherPii(teachers: Teacher[]): Teacher[] {
  return teachers.map(({ email: _email, phone: _phone, ...rest }) => rest as Teacher);
}

export function clearSensitiveOfflineCaches(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.PROXY_LOGS);
    localStorage.removeItem(STORAGE_KEYS.DAILY_ABSENCES);
    const rawTeachers = localStorage.getItem(STORAGE_KEYS.TEACHERS);
    if (rawTeachers) {
      const parsed = JSON.parse(rawTeachers);
      if (Array.isArray(parsed) && parsed.some((t: Teacher) => Boolean(t?.email || t?.phone))) {
        localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(stripTeacherPii(parsed)));
      }
    }
    const rawSnaps = localStorage.getItem(SNAPSHOTS_STORAGE_KEY);
    if (rawSnaps) {
      const snaps = JSON.parse(rawSnaps);
      if (
        Array.isArray(snaps) &&
        snaps.some((s: RoutineSnapshot) => s?.state?.teachers?.some((t: Teacher) => Boolean(t?.email || t?.phone)))
      ) {
        const sanitizedSnaps = snaps.map((s: RoutineSnapshot) =>
          s?.state?.teachers
            ? { ...s, state: { ...s.state, teachers: stripTeacherPii(s.state.teachers) } }
            : s
        );
        localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(sanitizedSnaps));
      }
    }
  } catch {
    // Ignore storage access errors
  }
}

export function loadStoredData(): AppState {
  try {
    const rawClasses = localStorage.getItem(STORAGE_KEYS.CLASSES);
    const rawTeachers = localStorage.getItem(STORAGE_KEYS.TEACHERS);
    const rawSubjects = localStorage.getItem(STORAGE_KEYS.SUBJECTS);
    const rawSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const rawEntries = localStorage.getItem(STORAGE_KEYS.ENTRIES);
    const hasMigratedV2 = localStorage.getItem(STORAGE_KEYS.POLICY_V2) === 'true';
    const hasMigratedV3 = localStorage.getItem(STORAGE_KEYS.POLICY_V3) === 'true';
    const hasMigratedV4 = localStorage.getItem(STORAGE_KEYS.POLICY_V4) === 'true';

    const parsedSettings: SchoolSettings = rawSettings ? JSON.parse(rawSettings) : { ...INITIAL_SETTINGS };
    if (parsedSettings && (parsedSettings.schoolName === 'Ideal Model High School & College' || !parsedSettings.schoolName)) {
      parsedSettings.schoolName = 'Icon Dreams School and College';
    }
    if (!parsedSettings.religionSchedule) {
      parsedSettings.religionSchedule = { ...INITIAL_SETTINGS.religionSchedule! };
    } else {
      parsedSettings.religionSchedule = {
        hinduRoom: parsedSettings.religionSchedule.hinduRoom || '307',
        maxConcurrentSections: parsedSettings.religionSchedule.maxConcurrentSections || 3,
        combinedHinduTeacherId: parsedSettings.religionSchedule.combinedHinduTeacherId || 'tch-tapash',
        combinedSlots: parsedSettings.religionSchedule.combinedSlots || [],
      };
    }

    let loadedSubjects: Subject[] = rawSubjects ? JSON.parse(rawSubjects) : INITIAL_SUBJECTS;
    let loadedTeachers: Teacher[] = stripTeacherPii(rawTeachers ? JSON.parse(rawTeachers) : INITIAL_TEACHERS);
    let loadedClasses: SchoolClass[] = rawClasses ? JSON.parse(rawClasses) : INITIAL_CLASSES;
    let loadedEntries: TimetableEntry[] = rawEntries ? JSON.parse(rawEntries) : INITIAL_TIMETABLE_ENTRIES;

    // Ensure Play, Nursery, KG exist
    const hasPlay = loadedClasses.some(c => c.id === 'cls-play');
    if (!hasPlay) {
      const preschools = INITIAL_CLASSES.filter(c => ['cls-play', 'cls-nursery', 'cls-kg'].includes(c.id));
      loadedClasses = [...preschools, ...loadedClasses];
    }

    // One-time Policy V2 upgrade for existing users:
    // 1. Add sub-hin, sub-agr, sub-block-play-nur if missing
    // 2. Add tch-hasan, tch-moazzem, tch-tapash if missing, mark coordinator & block teachers
    // 3. Enforce Play & Nursery shifts (Morning Shift & Day Shift), 2 Block Teachers each, no separate subjects
    // 4. Remove Play/Nursery block teachers from KG-10 classes & entries
    if (!hasMigratedV2) {
      const requiredSubIds = ['sub-hin', 'sub-agr', 'sub-block-play-nur'];
      requiredSubIds.forEach(reqId => {
        if (!loadedSubjects.some(s => s.id === reqId)) {
          const seedSub = INITIAL_SUBJECTS.find(s => s.id === reqId);
          if (seedSub) loadedSubjects.push(seedSub);
        }
      });
      loadedSubjects = loadedSubjects.map(s =>
        s.id === 'sub-rel' && s.name === 'Religion & Moral Education'
          ? { ...s, name: 'Islam Religion & Moral Ed.', isElective: true }
          : s
      );

      // Ensure new specialist & noProxy teachers exist
      ['tch-hasan', 'tch-moazzem', 'tch-tapash'].forEach(tId => {
        if (!loadedTeachers.some(t => t.id === tId)) {
          const seedTch = INITIAL_TEACHERS.find(t => t.id === tId);
          if (seedTch) loadedTeachers.push(seedTch);
        }
      });

      const playNurBlockSet = new Set<string>(['tch-zinat', 'tch-rubina', 'tch-nasrin', 'tch-selina']);
      loadedClasses.forEach(c => {
        if (isPlayOrNursery(c) && c.blockTeacherIds) {
          c.blockTeacherIds.forEach(id => playNurBlockSet.add(id));
        }
      });

      loadedTeachers = loadedTeachers.map(t => {
        const lowerName = (t.name || '').toLowerCase();
        const lowerDesig = (t.designation || '').toLowerCase();
        const isCoord = Boolean(t.isCoordinator || lowerDesig.includes('coordinator') || lowerDesig.includes('কো-অর্ডিনেটর'));
        const isMoazzem = Boolean(t.noProxy || lowerName.includes('moazzem') || lowerName.includes('মোয়াজ্জেম') || lowerName.includes('মোয়াজ্জেম'));
        const isBlock = Boolean(t.isBlockTeacher || playNurBlockSet.has(t.id));

        return {
          ...t,
          isCoordinator: isCoord || undefined,
          noProxy: (isMoazzem || isBlock) ? true : undefined,
          isBlockTeacher: isBlock || undefined,
        };
      });

      loadedClasses = loadedClasses.map(c => {
        if (c.id === 'cls-play' || c.numericGrade === -2) {
          return {
            ...c,
            isJuniorClass: true,
            usesShifts: true,
            maxPeriods: 4,
            blockTeacherIds: c.blockTeacherIds && c.blockTeacherIds.length >= 2
              ? c.blockTeacherIds.slice(0, 2)
              : ['tch-zinat', 'tch-rubina'],
            sections: [
              { id: 'shift-play-morning', name: 'মর্নিং শিফট (Morning Shift)', roomNumber: 'Room P-Morning' },
              { id: 'shift-play-day', name: 'ডে শিফট (Day Shift)', roomNumber: 'Room P-Day' },
            ],
            subjectRequirements: [], // প্লে-তে কোনো সাবজেক্ট থাকবে না
          };
        }
        if (c.id === 'cls-nursery' || c.numericGrade === -1) {
          return {
            ...c,
            isJuniorClass: true,
            usesShifts: true,
            maxPeriods: 4,
            blockTeacherIds: c.blockTeacherIds && c.blockTeacherIds.length >= 2
              ? c.blockTeacherIds.slice(0, 2)
              : ['tch-nasrin', 'tch-selina'],
            sections: [
              { id: 'shift-nur-morning', name: 'মর্নিং শিফট (Morning Shift)', roomNumber: 'Room N-Morning' },
              { id: 'shift-nur-day', name: 'ডে শিফট (Day Shift)', roomNumber: 'Room N-Day' },
            ],
            subjectRequirements: [], // নার্সারিতে কোনো সাবজেক্ট থাকবে না
          };
        }

        // Non-Play/Nursery classes: ensure block teachers are removed from subjectRequirements
        const cleanedReqs = c.subjectRequirements.map(req =>
          req.assignedTeacherId && playNurBlockSet.has(req.assignedTeacherId)
            ? { ...req, assignedTeacherId: undefined }
            : req
        );

        return {
          ...c,
          isJuniorClass: false,
          blockTeacherIds: undefined,
          subjectRequirements: cleanedReqs,
        };
      });

      // Clean entries where a Play/Nursery block teacher was placed in KG-10, or old Play/Nursery section IDs
      loadedEntries = loadedEntries
        .filter(e => {
          const cls = loadedClasses.find(c => c.id === e.classId);
          if (!cls) return false;
          if (!isPlayOrNursery(cls) && playNurBlockSet.has(e.teacherId)) return false;
          return true;
        })
        .map(e => {
          if (e.classId === 'cls-play') {
            const newSec = e.sectionId === 'sec-play-b' || e.sectionId === 'shift-play-day' ? 'shift-play-day' : 'shift-play-morning';
            return { ...e, sectionId: newSec, subjectId: 'sub-block-play-nur' };
          }
          if (e.classId === 'cls-nursery') {
            const newSec = e.sectionId === 'sec-nur-b' || e.sectionId === 'shift-nur-day' ? 'shift-nur-day' : 'shift-nur-morning';
            return { ...e, sectionId: newSec, subjectId: 'sub-block-play-nur' };
          }
          return e;
        });

      localStorage.setItem(STORAGE_KEYS.POLICY_V2, 'true');
      localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(loadedClasses));
      localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(loadedTeachers));
      localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(loadedSubjects));
      localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify(loadedEntries));
    }

    // One-time Policy V3 upgrade:
    // Migrate legacy 'Hindu Religion Room' entries to configured combined room ('307')
    if (!hasMigratedV3) {
      const targetHinduRoom = parsedSettings.religionSchedule?.hinduRoom || '307';
      loadedEntries = loadedEntries.map(e =>
        e.room === 'Hindu Religion Room' ? { ...e, room: targetHinduRoom } : e
      );
      localStorage.setItem(STORAGE_KEYS.POLICY_V3, 'true');
      localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify(loadedEntries));
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsedSettings));
    }

    // One-time Policy V4 upgrade:
    // Enforce school-wide policy: max 4 daily periods per teacher and 5 weekly working days
    if (!hasMigratedV4) {
      parsedSettings.defaultMaxDailyPeriods = 4;
      parsedSettings.defaultMaxWorkingDays = 5;
      loadedTeachers = loadedTeachers.map(t => ({
        ...t,
        maxDailyPeriods: Math.min(4, Math.max(1, t.maxDailyPeriods || 4)),
        maxWorkingDays: 5,
      }));
      localStorage.setItem(STORAGE_KEYS.POLICY_V4, 'true');
      localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(stripTeacherPii(loadedTeachers)));
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsedSettings));
    }

    // Apply tier schedule rules consistently
    loadedClasses = loadedClasses.map(c => {
      const grade = c.numericGrade;
      if (grade <= -1) {
        return {
          ...c,
          isJuniorClass: true,
          usesShifts: true,
          maxPeriods: 4,
          subjectRequirements: [], // Play & Nursery have NO subjects
          blockTeacherIds: c.blockTeacherIds && c.blockTeacherIds.length > 0
            ? c.blockTeacherIds
            : grade === -2 ? ['tch-zinat', 'tch-rubina'] : ['tch-nasrin', 'tch-selina'],
        };
      }
      if (grade <= 2) {
        return {
          ...c,
          isJuniorClass: false,
          maxPeriods: 4,
        };
      }
      if (grade >= 3 && grade <= 5) {
        return {
          ...c,
          maxPeriods: 6,
        };
      }
      if (grade >= 6 && grade <= 8) {
        return {
          ...c,
          maxPeriods: 6,
          extendedDay: c.extendedDay || 'Thursday',
        };
      }
      return {
        ...c,
        maxPeriods: 7,
      };
    });

    // Ensure period 4 is tiffin break if not configured
    if (parsedSettings && parsedSettings.periodTimings) {
      const hasAnyBreak = parsedSettings.periodTimings.some((p: any) => p.isBreak);
      if (!hasAnyBreak && parsedSettings.periodTimings.length >= 4) {
        parsedSettings.periodTimings = parsedSettings.periodTimings.map((p: any) => {
          if (p.periodIndex === 4) {
            return {
              ...p,
              label: p.label.includes('টিফিন') ? p.label : `${p.label} (টিফিন বিরতি)`,
              isBreak: true,
              isLocked: true,
            };
          }
          return p;
        });
      }
    }

    // Only sync default teacher assignments on brand new uninitialized storage
    if (!rawClasses) {
      loadedClasses = syncTeacherAssignmentsToClasses(loadedClasses, loadedTeachers, loadedSubjects);
    }

    return {
      classes: loadedClasses,
      teachers: stripTeacherPii(loadedTeachers),
      subjects: loadedSubjects,
      settings: parsedSettings,
      entries: loadedEntries,
    };
  } catch (err) {
    console.error('Failed to load data from localStorage:', err);
    return {
      classes: INITIAL_CLASSES,
      teachers: stripTeacherPii(INITIAL_TEACHERS),
      subjects: INITIAL_SUBJECTS,
      settings: INITIAL_SETTINGS,
      entries: INITIAL_TIMETABLE_ENTRIES,
    };
  }
}

export function saveStoredData(state: Partial<AppState>) {
  try {
    if (state.classes) localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(state.classes));
    if (state.teachers) localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(stripTeacherPii(state.teachers)));
    if (state.subjects) localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(state.subjects));
    if (state.settings) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
    if (state.entries) localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify(state.entries));
  } catch (err) {
    console.error('Failed to save data to localStorage:', err);
  }
}

export function resetToDefaults(): AppState {
  try {
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(STORAGE_KEYS.POLICY_V2, 'true');
    localStorage.setItem(STORAGE_KEYS.POLICY_V3, 'true');
    localStorage.setItem(STORAGE_KEYS.POLICY_V4, 'true');
  } catch (err) {
    console.error('Failed to clear localStorage:', err);
  }
  return {
    classes: INITIAL_CLASSES,
    teachers: stripTeacherPii(INITIAL_TEACHERS),
    subjects: INITIAL_SUBJECTS,
    settings: INITIAL_SETTINGS,
    entries: INITIAL_TIMETABLE_ENTRIES,
  };
}

export function exportBackupJSON(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importBackupJSON(jsonStr: string): AppState {
  const parsed = JSON.parse(jsonStr);
  if (!parsed.classes || !parsed.teachers || !parsed.entries) {
    throw new Error('Invalid timetable backup file format');
  }
  const mergedSettings: SchoolSettings = {
    ...INITIAL_SETTINGS,
    ...(parsed.settings || {}),
    religionSchedule: {
      ...INITIAL_SETTINGS.religionSchedule!,
      ...(parsed.settings?.religionSchedule || {}),
    },
  };
  const normalizedState: AppState = {
    classes: parsed.classes,
    teachers: parsed.teachers,
    subjects: parsed.subjects || INITIAL_SUBJECTS,
    settings: mergedSettings,
    entries: parsed.entries,
  };
  saveStoredData(normalizedState);
  return normalizedState;
}

export function loadStoredProxyLogs(): ProxyLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROXY_LOGS);
    return raw ? (JSON.parse(raw) as ProxyLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredProxyLogs(logs: ProxyLogEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.PROXY_LOGS, JSON.stringify(logs));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadStoredDailyAbsences(): Record<string, DailyAbsenceRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DAILY_ABSENCES);
    return raw ? (JSON.parse(raw) as Record<string, DailyAbsenceRecord>) : {};
  } catch {
    return {};
  }
}

export function saveStoredDailyAbsences(map: Record<string, DailyAbsenceRecord>) {
  try {
    localStorage.setItem(STORAGE_KEYS.DAILY_ABSENCES, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadRoutineSnapshots(): RoutineSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is RoutineSnapshot =>
        Boolean(s && typeof s.id === 'string' && typeof s.label === 'string' && s.state && Array.isArray(s.state.entries))
    );
  } catch {
    return [];
  }
}

export function saveRoutineSnapshot(label: string, state: AppState): RoutineSnapshot | null {
  try {
    const existing = loadRoutineSnapshots();
    const clonedState: AppState = JSON.parse(JSON.stringify({
      classes: state.classes,
      teachers: stripTeacherPii(state.teachers),
      subjects: state.subjects,
      settings: state.settings,
      entries: state.entries,
    }));
    const snapshot: RoutineSnapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      label: label.trim().slice(0, 120) || 'Routine Snapshot',
      entryCount: clonedState.entries.length,
      state: clonedState,
    };

    const nextList = [snapshot, ...existing].slice(0, MAX_ROUTINE_SNAPSHOTS);
    while (nextList.length > 0) {
      try {
        localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(nextList));
        return snapshot;
      } catch {
        // Trim oldest snapshot when localStorage quota is tight
        if (nextList.length === 1) {
          return null;
        }
        nextList.pop();
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function deleteRoutineSnapshot(id: string): RoutineSnapshot[] {
  const next = loadRoutineSnapshots().filter(s => s.id !== id);
  try {
    localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

export function clearRoutineSnapshots(): void {
  try {
    localStorage.removeItem(SNAPSHOTS_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
