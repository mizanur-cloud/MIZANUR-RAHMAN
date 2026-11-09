/**
 * Core type definitions for Smart School Routine Management System
 */

export type DayOfWeek = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export interface PeriodTiming {
  periodIndex: number; // 1-based (1, 2, 3...)
  label: string;       // e.g., "1st Period", "2nd Period", "Tiffin Break"
  startTime: string;   // e.g., "08:30 AM"
  endTime: string;     // e.g., "09:15 AM"
  isBreak?: boolean;   // if true, it's a break / tiffin
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  color: string;       // Hex or Tailwind color token for visually distinguishing subjects
  isElective?: boolean;
}

export interface Teacher {
  id: string;
  name: string;
  initials: string;
  email?: string;
  phone?: string;
  designation: string; // e.g. "Senior Teacher", "Head of Dept"
  subjectIds: string[]; // subjects qualified to teach
  maxConsecutivePeriods: number; // default 2
  maxDailyPeriods: number;       // default 4 or 5
  unavailableSlots?: { day: DayOfWeek; periodIndex: number }[];
}

export interface Section {
  id: string;
  name: string; // 'A', 'B', 'C', 'D'
  roomNumber?: string;
}

export interface SubjectRequirement {
  subjectId: string;
  periodsPerWeek: number;
  assignedTeacherId?: string; // preferred teacher for this subject in this section
}

export interface SchoolClass {
  id: string;
  name: string; // "Class 1", "Class 2", ... "Class 10"
  numericGrade: number; // 1 to 10
  sections: Section[];
  subjectRequirements: SubjectRequirement[]; // weekly requirements
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

export interface SchoolSettings {
  schoolName: string;
  schoolAddress: string;
  academicYear: string;
  principalName: string;
  workingDays: DayOfWeek[];
  periodTimings: PeriodTiming[];
}

export type ConflictType = 'teacher_double_booking' | 'class_double_booking' | 'max_consecutive_exceeded' | 'teacher_unavailable';

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
