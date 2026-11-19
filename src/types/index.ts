/**
 * Core type definitions for Smart School Routine Management System
 */

export type DayOfWeek = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export interface PeriodTiming {
  periodIndex: number; // 1-based (1, 2, 3...)
  label: string;       // e.g., "1st Period", "2nd Period", "4th Period (টিফিন বিরতি)"
  startTime: string;   // e.g., "08:30 AM"
  endTime: string;     // e.g., "09:15 AM"
  isBreak?: boolean;   // if true, it's a break / tiffin
  isLocked?: boolean;  // strictly locked: no class can be scheduled here
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  color: string;       // Hex or Tailwind color token for visually distinguishing subjects
  isElective?: boolean;
}

export interface TeacherClassAssignment {
  classId: string;
  sectionId?: string; // specific section or empty for all
  subjectId?: string; // specific subject
}

export interface Teacher {
  id: string;
  name: string;
  initials: string;
  email?: string;
  phone?: string;
  designation: string; // e.g. "Senior Teacher", "Head of Dept", "Coordinator"
  subjectIds: string[]; // subjects qualified to teach
  assignedClassSections?: TeacherClassAssignment[]; // classes & sections this teacher teaches
  maxConsecutivePeriods: number; // default 2
  maxDailyPeriods: number;       // default 4 or 5
  unavailableSlots?: { day: DayOfWeek; periodIndex: number }[];
  isBlockTeacher?: boolean;      // dedicated block teacher for Play / Nursery (no other classes or proxies)
  isCoordinator?: boolean;       // coordinator (no proxy classes allowed)
  noProxy?: boolean;             // explicitly exempted from proxy classes (e.g. Moazzem Sir)
}

export interface SectionSubjectConfig {
  periodsPerWeek?: number;
  assignedTeacherId?: string; // '' = explicitly unassigned ("Any"); string = section-specific teacher; undefined = unconfigured
}

export interface Section {
  id: string;
  name: string; // 'A', 'B', 'C', 'D' or 'মর্নিং শিফট (Morning Shift)', 'ডে শিফট (Day Shift)'
  roomNumber?: string;
  extendedDay?: DayOfWeek; // Optional custom extended day for this section
  disableSeventhPeriod?: boolean; // If true, Period 7 is completely OFF (dismissed) for this section
  selectedSubjectIds?: string[]; // Section-wise selected subjects (undefined = all class subjects active)
  subjectConfigs?: Record<string, SectionSubjectConfig>; // Section-wise independent quota & teacher config per subjectId
}

export interface SubjectRequirement {
  subjectId: string;
  periodsPerWeek: number;
  assignedTeacherId?: string; // default/template preferred teacher for this subject
}

export interface SchoolClass {
  id: string;
  name: string; // "Play", "Nursery", "KG", "Class 1", ... "Class 10"
  numericGrade: number; // -2 (Play), -1 (Nursery), 0 (KG), 1 to 10
  sections: Section[];
  subjectRequirements: SubjectRequirement[]; // weekly requirements
  isJuniorClass?: boolean; // if true (Play, Nursery, KG), uses block teachers
  usesShifts?: boolean; // if true (Play, Nursery), sections are Morning Shift and Day Shift
  maxPeriods?: number; // max periods (e.g. 4 periods for Play-Class 2, 6 for 3-5, 7 for 9-10)
  blockTeacherIds?: string[]; // 2 block teachers who take all classes/subjects
  extendedDay?: DayOfWeek; // for Class 6-8: 1 day in week running up to period 7 (default Thursday)
  sectionExtendedDays?: Record<string, DayOfWeek>; // per-section extended days mapping (sectionId -> DayOfWeek)
  disableSeventhPeriod?: boolean; // If true, Period 7 is completely OFF (dismissed) for the whole class
}

export interface TimetableEntry {
  id: string;
  classId: string;
  sectionId: string;
  day: DayOfWeek;
  periodIndex: number;
  subjectId: string;
  teacherId: string;
  room?: string;
}

export interface ReligionScheduleSettings {
  hinduRoom: string; // Combined Hindu classroom, default '307'
  maxConcurrentSections: number; // Max sections sharing same religion period, default 3
  combinedHinduTeacherId?: string; // Primary teacher for combined Room 307 sessions (e.g. Tapash Kumar Das)
  combinedSlots?: { day: DayOfWeek; periodIndex: number }[]; // Optional pinned combined religion slots
}

export interface SchoolSettings {
  schoolName: string;
  schoolAddress: string;
  academicYear: string;
  principalName: string;
  workingDays: DayOfWeek[];
  periodTimings: PeriodTiming[];
  religionSchedule?: ReligionScheduleSettings;
}

export type ConflictType =
  | 'teacher_double_booking'
  | 'class_double_booking'
  | 'room_conflict'
  | 'wrong_teacher_assignment'
  | 'religion_rule_violation'
  | 'max_consecutive_exceeded'
  | 'teacher_unavailable'
  | 'unselected_subject'
  | 'teacher_limit_exceeded';

export interface RoutineConflict {
  id: string;
  type: ConflictType;
  severity: 'error' | 'warning';
  day: DayOfWeek;
  periodIndex: number;
  title: string;
  description: string;
  entryIds: string[];
  teacherId?: string;
  classId?: string;
  sectionId?: string;
}
