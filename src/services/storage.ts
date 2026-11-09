import { INITIAL_CLASSES, INITIAL_SETTINGS, INITIAL_SUBJECTS, INITIAL_TEACHERS, INITIAL_TIMETABLE_ENTRIES } from '../data/initialData';
import { SchoolClass, SchoolSettings, Subject, Teacher, TimetableEntry } from '../types';

const STORAGE_KEYS = {
  CLASSES: 'school_routine_classes_v1',
  TEACHERS: 'school_routine_teachers_v1',
  SUBJECTS: 'school_routine_subjects_v1',
  SETTINGS: 'school_routine_settings_v1',
  ENTRIES: 'school_routine_entries_v1',
};

export interface AppState {
  classes: SchoolClass[];
  teachers: Teacher[];
  subjects: Subject[];
  settings: SchoolSettings;
  entries: TimetableEntry[];
}

export function loadStoredData(): AppState {
  try {
    const rawClasses = localStorage.getItem(STORAGE_KEYS.CLASSES);
    const rawTeachers = localStorage.getItem(STORAGE_KEYS.TEACHERS);
    const rawSubjects = localStorage.getItem(STORAGE_KEYS.SUBJECTS);
    const rawSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const rawEntries = localStorage.getItem(STORAGE_KEYS.ENTRIES);

    const parsedSettings = rawSettings ? JSON.parse(rawSettings) : INITIAL_SETTINGS;
    if (parsedSettings && (parsedSettings.schoolName === 'Ideal Model High School & College' || !parsedSettings.schoolName)) {
      parsedSettings.schoolName = 'Icon Dreams School and College';
    }

    let loadedClasses: SchoolClass[] = rawClasses ? JSON.parse(rawClasses) : INITIAL_CLASSES;
    // Ensure Play, Nursery, KG exist
    const hasPlay = loadedClasses.some(c => c.id === 'cls-play');
    if (!hasPlay) {
      const preschools = INITIAL_CLASSES.filter(c => ['cls-play', 'cls-nursery', 'cls-kg'].includes(c.id));
      loadedClasses = [...preschools, ...loadedClasses];
    }

    let loadedSubjects: Subject[] = rawSubjects ? JSON.parse(rawSubjects) : INITIAL_SUBJECTS;
    INITIAL_SUBJECTS.forEach(sub => {
      if (!loadedSubjects.some(s => s.id === sub.id)) {
        loadedSubjects.push(sub);
      }
    });

    return {
      classes: loadedClasses,
      teachers: rawTeachers ? JSON.parse(rawTeachers) : INITIAL_TEACHERS,
      subjects: loadedSubjects,
      settings: parsedSettings,
      entries: rawEntries ? JSON.parse(rawEntries) : INITIAL_TIMETABLE_ENTRIES,
    };
  } catch (err) {
    console.error('Failed to load data from localStorage:', err);
    return {
      classes: INITIAL_CLASSES,
      teachers: INITIAL_TEACHERS,
      subjects: INITIAL_SUBJECTS,
      settings: INITIAL_SETTINGS,
      entries: INITIAL_TIMETABLE_ENTRIES,
    };
  }
}

export function saveStoredData(state: Partial<AppState>) {
  try {
    if (state.classes) localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(state.classes));
    if (state.teachers) localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(state.teachers));
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
  } catch (err) {
    console.error('Failed to clear localStorage:', err);
  }
  return {
    classes: INITIAL_CLASSES,
    teachers: INITIAL_TEACHERS,
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
  saveStoredData(parsed);
  return {
    classes: parsed.classes,
    teachers: parsed.teachers,
    subjects: parsed.subjects || INITIAL_SUBJECTS,
    settings: parsed.settings || INITIAL_SETTINGS,
    entries: parsed.entries,
  };
}
