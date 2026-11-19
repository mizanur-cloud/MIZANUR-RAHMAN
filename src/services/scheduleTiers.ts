import { DayOfWeek, SchoolClass } from '../types';

/**
 * Schedule Tiers defined by Icon Dreams School and College:
 * 
 * 1. Play to Class 2 (Play, Nursery, KG, Class 1, Class 2):
 *    - Classes run up to 4th period, then dismissal (তার পর ছুটি).
 *    - Play, Nursery, KG use Block Teachers.
 * 
 * 2. Class 3 to Class 5 (Class 3, 4, 5):
 *    - Classes run up to 6th period.
 *    - 4th Period is Tiffin Break (টিফিন বিরতি).
 *    - Period 7 is Off (ছুটি).
 * 
 * 3. Class 6 to Class 8 (Class 6, 7, 8):
 *    - Classes run up to 6th period, 4th period is Tiffin Break.
 *    - 7th Period Staggering: প্রতিটি ক্লাস ও সেকশনের ৭ম পিরিয়ড একই দিনে না দিয়ে
 *      সপ্তাহের ভিন্ন ভিন্ন দিনে (Sunday, Monday, Tuesday, Wednesday, Thursday) বিন্যস্ত।
 * 
 * 4. Class 9 and Class 10 (Class 9, 10):
 *    - Classes run all 7 periods every day.
 *    - 4th Period is Tiffin Break.
 */

export const BENGALI_DAY_NAMES: Record<DayOfWeek, string> = {
  Sunday: 'রবিবার',
  Monday: 'সোমবার',
  Tuesday: 'মঙ্গলবার',
  Wednesday: 'বুধবার',
  Thursday: 'বৃহস্পতিবার',
  Friday: 'শুক্রবার',
  Saturday: 'শনিবার',
};

const DEFAULT_WEEKDAYS: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];

export function isSeventhPeriodDisabled(
  cls: SchoolClass,
  sectionId?: string
): boolean {
  if (cls.disableSeventhPeriod) return true;
  if (sectionId) {
    const secObj = cls.sections?.find(s => s.id === sectionId);
    if (secObj?.disableSeventhPeriod) return true;
  }
  return false;
}

/**
 * Get the designated 7th-period extended day for a class section.
 * Automatically staggers Class 6 to 8 sections across different weekdays so they do not clash:
 *   - Class 6 - Section A: Sunday
 *   - Class 6 - Section B: Monday
 *   - Class 7 - Section A: Tuesday
 *   - Class 7 - Section B: Wednesday
 *   - Class 8 - Section A: Thursday
 *   - Class 8 - Section B: Sunday
 */
export function getExtendedDayForSection(
  cls: SchoolClass,
  sectionId?: string,
  workingDays?: DayOfWeek[]
): DayOfWeek {
  // 1. Check if section has custom extendedDay configured
  if (sectionId) {
    const secObj = cls.sections?.find(s => s.id === sectionId);
    if (secObj?.extendedDay) {
      return secObj.extendedDay;
    }
    if (cls.sectionExtendedDays && cls.sectionExtendedDays[sectionId]) {
      return cls.sectionExtendedDays[sectionId];
    }
  }

  // 2. Determine available weekdays (excluding Friday & Saturday if possible)
  const weekdays = (workingDays && workingDays.length > 0)
    ? workingDays.filter(d => d !== 'Friday' && d !== 'Saturday')
    : DEFAULT_WEEKDAYS;
  const availableDays = weekdays.length > 0 ? weekdays : (workingDays || DEFAULT_WEEKDAYS);

  // 3. Staggered distribution for junior secondary (Class 6, 7, 8)
  if (cls.numericGrade >= 6 && cls.numericGrade <= 8) {
    const gradeOffset = Math.max(0, cls.numericGrade - 6); // 0 for Class 6, 1 for Class 7, 2 for Class 8
    let secIndex = 0;
    if (sectionId && cls.sections) {
      const idx = cls.sections.findIndex(s => s.id === sectionId);
      if (idx !== -1) secIndex = idx;
    }

    // Stagger algorithm: (gradeOffset * 2 + secIndex) % availableDays.length
    // Class 6: Sec 0 -> Day 0 (Sun), Sec 1 -> Day 1 (Mon)
    // Class 7: Sec 0 -> Day 2 (Tue), Sec 1 -> Day 3 (Wed)
    // Class 8: Sec 0 -> Day 4 (Thu), Sec 1 -> Day 0 (Sun)
    const dayIndex = (gradeOffset * 2 + secIndex) % availableDays.length;
    return availableDays[dayIndex];
  }

  // Fallback to explicit class extendedDay or Thursday
  return cls.extendedDay || 'Thursday';
}

export function isSlotDismissed(
  cls: SchoolClass,
  day: DayOfWeek,
  periodIndex: number,
  sectionId?: string,
  workingDays?: DayOfWeek[]
): boolean {
  const grade = cls.numericGrade;

  // Tier 1: Play to Class 2 (Play: -2, Nursery: -1, KG: 0, Class 1: 1, Class 2: 2)
  if (grade <= 2) {
    const maxP = cls.maxPeriods || 4;
    return periodIndex > maxP;
  }

  // Tier 2: Class 3 to Class 5 (grade 3, 4, 5)
  if (grade >= 3 && grade <= 5) {
    const maxP = cls.maxPeriods || 6;
    return periodIndex > maxP;
  }

  // Tier 3: Class 6 to Class 8 (grade 6, 7, 8)
  // 6th period standard; 1 staggered day runs up to 7th period unless disabled for this section/class
  if (grade >= 6 && grade <= 8) {
    if (isSeventhPeriodDisabled(cls, sectionId)) {
      return periodIndex > 6;
    }
    const extDay = getExtendedDayForSection(cls, sectionId, workingDays);
    if (day === extDay) {
      return periodIndex > 7;
    }
    return periodIndex > 6;
  }

  // Tier 4: Class 9 to Class 10 (grade 9, 10)
  if (isSeventhPeriodDisabled(cls, sectionId)) {
    return periodIndex > 6;
  }
  return periodIndex > 7;
}

export function getMaxPeriodsForDay(
  cls: SchoolClass,
  day: DayOfWeek,
  sectionId?: string,
  workingDays?: DayOfWeek[]
): number {
  const grade = cls.numericGrade;

  if (grade <= 2) {
    return cls.maxPeriods || 4;
  }
  if (grade >= 3 && grade <= 5) {
    return cls.maxPeriods || 6;
  }
  if (grade >= 6 && grade <= 8) {
    if (isSeventhPeriodDisabled(cls, sectionId)) {
      return 6;
    }
    const extDay = getExtendedDayForSection(cls, sectionId, workingDays);
    return day === extDay ? 7 : 6;
  }
  if (isSeventhPeriodDisabled(cls, sectionId)) {
    return 6;
  }
  return 7;
}

export function getTierBadgeInfo(
  cls: SchoolClass,
  sectionId?: string,
  workingDays?: DayOfWeek[]
): {
  label: string;
  details: string;
  color: string;
  extendedDay?: DayOfWeek;
  extendedDayBengali?: string;
} {
  const grade = cls.numericGrade;

  if (grade <= 2) {
    return {
      label: '৪র্থ পিরিয়ড পর্যন্ত (ছুটি)',
      details: '১ম থেকে ৪র্থ পিরিয়ড পর্যন্ত ক্লাস, তারপর ছুটি।',
      color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300',
    };
  }

  if (grade >= 3 && grade <= 5) {
    return {
      label: '৬ষ্ঠ পিরিয়ড পর্যন্ত (৪র্থ টিফিন)',
      details: '৬ষ্ঠ পিরিয়ড পর্যন্ত ক্লাস, ৪র্থ পিরিয়ড টিফিন বিরতি।',
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300',
    };
  }

  if (grade >= 6 && grade <= 8) {
    if (isSeventhPeriodDisabled(cls, sectionId)) {
      const secObj = sectionId && cls.sections ? cls.sections.find(s => s.id === sectionId) : null;
      const secLabel = secObj ? `সেকশন ${secObj.name}` : 'এই শ্রেণি';
      return {
        label: '৬ষ্ঠ পিরিয়ড পর্যন্ত (৭ম পিরিয়ড বন্ধ)',
        details: `${secLabel}-এর জন্য ৭ম পিরিয়ড বন্ধ রাখা হয়েছে (সকল কার্যদিবসে ৬ষ্ঠ পিরিয়ড পর্যন্ত ক্লাস, ৪র্থ টিফিন)।`,
        color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
    }

    const extDay = getExtendedDayForSection(cls, sectionId, workingDays);
    const dayBn = BENGALI_DAY_NAMES[extDay] || extDay;
    const secObj = sectionId && cls.sections ? cls.sections.find(s => s.id === sectionId) : null;
    const secLabel = secObj ? `সেকশন ${secObj.name}` : 'প্রতি সেকশন';

    return {
      label: `৬ষ্ঠ পিরিয়ড + ${dayBn} ৭ম (${secLabel})`,
      details: `${secLabel}-এ ৬ষ্ঠ পিরিয়ড পর্যন্ত ক্লাস, তবে ${dayBn} ৭ম পিরিয়ড পর্যন্ত চলবে (৪র্থ পিরিয়ড টিফিন)।`,
      color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300',
      extendedDay: extDay,
      extendedDayBengali: dayBn,
    };
  }

  if (isSeventhPeriodDisabled(cls, sectionId)) {
    return {
      label: '৬ষ্ঠ পিরিয়ড পর্যন্ত (৭ম পিরিয়ড বন্ধ)',
      details: 'এই শ্রেণি/সেকশনের জন্য ৭ম পিরিয়ড বন্ধ রাখা হয়েছে (৬ষ্ঠ পিরিয়ড পর্যন্ত ক্লাস, ৪র্থ টিফিন)।',
      color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    };
  }

  return {
    label: '৭ম পিরিয়ড পর্যন্ত (৪র্থ টিফিন)',
    details: 'সকল কার্যদিবসে ৭ম পিরিয়ড পর্যন্ত ক্লাস এবং ৪র্থ পিরিয়ড টিফিন।',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300',
  };
}
