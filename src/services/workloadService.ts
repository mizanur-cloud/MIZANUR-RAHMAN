import {
  DayOfWeek,
  ProxyLogEntry,
  SchoolSettings,
  Teacher,
  TimetableEntry,
} from '../types';

export type WorkloadStatus = 'Normal' | 'Near Limit' | 'Overloaded';

export interface WorkloadWarning {
  code:
    | 'weekly_exceeded'
    | 'weekly_near'
    | 'daily_exceeded'
    | 'daily_proxy_limit_exceeded'
    | 'consecutive_exceeded'
    | 'time_clash'
    | 'absent_on_date'
    | 'blocked_slot';
  severity: 'error' | 'warning';
  message: string;
}

export interface TeacherWorkloadSummary {
  teacher: Teacher;
  regularWeeklyPeriods: number;
  proxyWeeklyPeriods: number;
  totalWeeklyLoad: number;
  weeklyMax: number;
  remainingWeeklyCapacity: number;
  regularDailyPeriods: number;
  proxyDailyPeriods: number;
  totalDailyLoad: number;
  dailyMax: number;
  consecutiveMax: number;
  peakDailyLoad: number;
  status: WorkloadStatus;
}

export interface AssignmentLimitEvaluation {
  hasHardClash: boolean;
  hasOverloadWarning: boolean;
  isNearLimit: boolean;
  requiresOverride: boolean;
  warnings: WorkloadWarning[];
  regularWeeklyPeriods: number;
  proxyWeeklyPeriods: number;
  projectedWeekly: number;
  weeklyMax: number;
  projectedDaily: number;
  dailyMax: number;
  projectedConsecutive: number;
  consecutiveMax: number;
  projectedStatus: WorkloadStatus;
}

const DAY_NAMES_BY_JS_DAY: DayOfWeek[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const DEFAULT_WEEKLY_MAX_PERIODS = 24;
export const DEFAULT_DAILY_MAX_PERIODS = 4;
export const DEFAULT_WEEKLY_MAX_WORKING_DAYS = 5;
export const DEFAULT_MAX_WORKING_DAYS = DEFAULT_WEEKLY_MAX_WORKING_DAYS;
export const DEFAULT_CONSECUTIVE_MAX_PERIODS = 2;
export const MAX_CONSECUTIVE_HARD_LIMIT = 3; // 4+ strictly forbidden
export const MAX_UNAVOIDABLE_THREE_CONSECUTIVE_DAYS = 2;
export const MAX_DAILY_PROXY_PERIODS = 1;

export function getLocalDateStr(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getDayOfWeekFromDateStr(dateStr: string): DayOfWeek {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) {
    return DAY_NAMES_BY_JS_DAY[new Date().getDay()];
  }
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return DAY_NAMES_BY_JS_DAY[dt.getDay()];
}

/**
 * Computes the Sunday–Saturday school week bounds [startDateStr, endDateStr]
 * containing `targetDateStr`.
 */
export function getWeekBoundsForDate(targetDateStr: string): {
  weekStart: string;
  weekEnd: string;
} {
  const parts = targetDateStr.split('-').map(Number);
  const dt =
    parts.length === 3 && !parts.some(n => Number.isNaN(n))
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date();
  const jsDay = dt.getDay(); // 0 (Sunday) .. 6 (Saturday)
  const start = new Date(dt);
  start.setDate(dt.getDate() - jsDay);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    weekStart: getLocalDateStr(start),
    weekEnd: getLocalDateStr(end),
  };
}

export function getTeacherWeeklyMax(teacher: Teacher): number {
  return typeof teacher.maxWeeklyPeriods === 'number' && teacher.maxWeeklyPeriods > 0
    ? teacher.maxWeeklyPeriods
    : DEFAULT_WEEKLY_MAX_PERIODS;
}

export function getTeacherDailyMax(teacher: Teacher, settings?: SchoolSettings): number {
  if (typeof teacher.maxDailyPeriods === 'number' && teacher.maxDailyPeriods > 0) {
    return teacher.maxDailyPeriods;
  }
  if (typeof settings?.defaultMaxDailyPeriods === 'number' && settings.defaultMaxDailyPeriods > 0) {
    return settings.defaultMaxDailyPeriods;
  }
  return DEFAULT_DAILY_MAX_PERIODS;
}

export function getTeacherConsecutiveMax(teacher: Teacher): number {
  return typeof teacher.maxConsecutivePeriods === 'number' && teacher.maxConsecutivePeriods > 0
    ? teacher.maxConsecutivePeriods
    : DEFAULT_CONSECUTIVE_MAX_PERIODS;
}

export function getTeacherMaxWorkingDays(teacher: Teacher, settings?: SchoolSettings): number {
  if (typeof teacher.maxWorkingDays === 'number' && teacher.maxWorkingDays >= 1) {
    return Math.min(7, Math.floor(teacher.maxWorkingDays));
  }
  if (typeof settings?.defaultMaxWorkingDays === 'number' && settings.defaultMaxWorkingDays >= 1) {
    return Math.min(7, Math.floor(settings.defaultMaxWorkingDays));
  }
  return DEFAULT_WEEKLY_MAX_WORKING_DAYS;
}

export interface TeacherDayPattern {
  day: DayOfWeek;
  count: number;
  maxRun: number;
  periods: number[];
}

export interface TeacherWeeklyPatternAnalysis {
  activeWorkingDays: number;
  maxWorkingDays: number;
  dailyMax: number;
  physicalPeriods: number;
  effectiveRequiredPeriods: number;
  workingDaysExceeded: boolean;
  mathematicallyImpossibleWorkingDays: boolean;
  threeConsecDays: DayOfWeek[];
  fourPlusConsecDays: DayOfWeek[];
  maxConsecObserved: number;
  unbalancedDays: boolean;
  dayPatterns: TeacherDayPattern[];
}

export function analyzeTeacherWeeklyPattern(
  teacher: Teacher,
  entries: TimetableEntry[],
  workingDays: DayOfWeek[],
  requiredPeriods?: number,
  maxSingleSectionSubjectFreq?: number,
  settings?: SchoolSettings
): TeacherWeeklyPatternAnalysis {
  const maxWorkingDays = getTeacherMaxWorkingDays(teacher, settings);
  const dailyMax = getTeacherDailyMax(teacher, settings);
  const periodsByDay = new Map<DayOfWeek, Set<number>>();
  workingDays.forEach(d => periodsByDay.set(d, new Set<number>()));

  for (const e of entries) {
    if (e.teacherId !== teacher.id) continue;
    let set = periodsByDay.get(e.day);
    if (!set) {
      set = new Set<number>();
      periodsByDay.set(e.day, set);
    }
    set.add(e.periodIndex);
  }

  const dayPatterns: TeacherDayPattern[] = [];
  const threeConsecDays: DayOfWeek[] = [];
  const fourPlusConsecDays: DayOfWeek[] = [];
  let maxConsecObserved = 0;
  let physicalPeriods = 0;
  const activeCounts: number[] = [];

  for (const day of workingDays) {
    const sorted = Array.from(periodsByDay.get(day) || []).sort((a, b) => a - b);
    physicalPeriods += sorted.length;
    if (sorted.length > 0) activeCounts.push(sorted.length);

    let maxRun = sorted.length > 0 ? 1 : 0;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) {
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 1;
      }
    }

    if (maxRun > maxConsecObserved) maxConsecObserved = maxRun;
    if (maxRun === 3) threeConsecDays.push(day);
    if (maxRun >= 4) fourPlusConsecDays.push(day);

    dayPatterns.push({
      day,
      count: sorted.length,
      maxRun,
      periods: sorted,
    });
  }

  const activeWorkingDays = activeCounts.length;
  const effectiveRequiredPeriods = Math.max(physicalPeriods, requiredPeriods ?? physicalPeriods);
  const exceedsByDailyCap = effectiveRequiredPeriods > maxWorkingDays * dailyMax;
  const exceedsBySingleSubFreq = (maxSingleSectionSubjectFreq ?? 0) > maxWorkingDays;
  const mathematicallyImpossibleWorkingDays = exceedsByDailyCap || exceedsBySingleSubFreq;
  const workingDaysExceeded = activeWorkingDays > maxWorkingDays;
  const unbalancedDays =
    activeCounts.length >= 2 &&
    Math.max(...activeCounts) - Math.min(...activeCounts) > 1;

  return {
    activeWorkingDays,
    maxWorkingDays,
    dailyMax,
    physicalPeriods,
    effectiveRequiredPeriods,
    workingDaysExceeded,
    mathematicallyImpossibleWorkingDays,
    threeConsecDays,
    fourPlusConsecDays,
    maxConsecObserved,
    unbalancedDays,
    dayPatterns,
  };
}

/**
 * Deduplicates physical `(day, periodIndex)` slots for regular entries so
 * combined classes (e.g., Room 307 Hindu Religion across 3 sections at the same time)
 * count accurately as 1 physical teaching period.
 */
export function countRegularWeeklySlots(
  teacherId: string,
  entries: TimetableEntry[]
): number {
  const uniqueSlots = new Set<string>();
  for (const e of entries) {
    if (e.teacherId === teacherId) {
      uniqueSlots.add(`${e.day}_${e.periodIndex}`);
    }
  }
  return uniqueSlots.size;
}

export function countRegularDailySlots(
  teacherId: string,
  day: DayOfWeek,
  entries: TimetableEntry[]
): number {
  const uniquePeriods = new Set<number>();
  for (const e of entries) {
    if (e.teacherId === teacherId && e.day === day) {
      uniquePeriods.add(e.periodIndex);
    }
  }
  return uniquePeriods.size;
}

export function getPeakRegularDailyLoad(
  teacherId: string,
  entries: TimetableEntry[],
  workingDays: DayOfWeek[]
): number {
  let maxDay = 0;
  for (const d of workingDays) {
    const cnt = countRegularDailySlots(teacherId, d, entries);
    if (cnt > maxDay) maxDay = cnt;
  }
  return maxDay;
}

/**
 * Counts active (non-cancelled) proxy periods for a teacher inside the target week.
 */
export function countWeeklyProxyPeriods(
  teacherId: string,
  proxyLogs: ProxyLogEntry[],
  targetDate: string
): number {
  const { weekStart, weekEnd } = getWeekBoundsForDate(targetDate);
  const uniqueDatePeriods = new Set<string>();
  for (const log of proxyLogs) {
    if (log.status === 'cancelled') continue;
    if (log.proxyTeacherId !== teacherId) continue;
    if (log.date >= weekStart && log.date <= weekEnd) {
      uniqueDatePeriods.add(`${log.date}_${log.periodIndex}`);
    }
  }
  return uniqueDatePeriods.size;
}

export function countDailyProxyPeriods(
  teacherId: string,
  proxyLogs: ProxyLogEntry[],
  targetDate: string
): number {
  const uniquePeriods = new Set<number>();
  for (const log of proxyLogs) {
    if (log.status === 'cancelled') continue;
    if (log.proxyTeacherId === teacherId && log.date === targetDate) {
      uniquePeriods.add(log.periodIndex);
    }
  }
  return uniquePeriods.size;
}

export function classifyWorkloadStatus(
  totalWeeklyLoad: number,
  weeklyMax: number
): WorkloadStatus {
  if (totalWeeklyLoad > weeklyMax) return 'Overloaded';
  if (totalWeeklyLoad >= Math.max(1, weeklyMax - 2)) return 'Near Limit';
  return 'Normal';
}

export function computeTeacherWorkload(
  teacher: Teacher,
  entries: TimetableEntry[],
  proxyLogs: ProxyLogEntry[],
  options: {
    targetDate?: string;
    targetDay?: DayOfWeek;
    workingDays?: DayOfWeek[];
    settings?: SchoolSettings;
  } = {}
): TeacherWorkloadSummary {
  const targetDate = options.targetDate || getLocalDateStr();
  const targetDay = options.targetDay || getDayOfWeekFromDateStr(targetDate);
  const workingDays = options.workingDays || [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
  ];

  const weeklyMax = getTeacherWeeklyMax(teacher);
  const dailyMax = getTeacherDailyMax(teacher, options.settings);
  const consecutiveMax = getTeacherConsecutiveMax(teacher);

  const regularWeeklyPeriods = countRegularWeeklySlots(teacher.id, entries);
  const proxyWeeklyPeriods = countWeeklyProxyPeriods(teacher.id, proxyLogs, targetDate);
  const totalWeeklyLoad = regularWeeklyPeriods + proxyWeeklyPeriods;

  const regularDailyPeriods = countRegularDailySlots(teacher.id, targetDay, entries);
  const proxyDailyPeriods = countDailyProxyPeriods(teacher.id, proxyLogs, targetDate);
  const totalDailyLoad = regularDailyPeriods + proxyDailyPeriods;

  const peakDailyLoad = Math.max(
    totalDailyLoad,
    getPeakRegularDailyLoad(teacher.id, entries, workingDays)
  );

  return {
    teacher,
    regularWeeklyPeriods,
    proxyWeeklyPeriods,
    totalWeeklyLoad,
    weeklyMax,
    remainingWeeklyCapacity: weeklyMax - totalWeeklyLoad,
    regularDailyPeriods,
    proxyDailyPeriods,
    totalDailyLoad,
    dailyMax,
    consecutiveMax,
    peakDailyLoad,
    status: classifyWorkloadStatus(totalWeeklyLoad, weeklyMax),
  };
}

export function computeMaxConsecutiveAfterSlot(
  teacherId: string,
  day: DayOfWeek,
  targetPeriodIndex: number,
  entries: TimetableEntry[],
  proxyLogs: ProxyLogEntry[] = [],
  targetDate?: string
): number {
  const occupied = new Set<number>([targetPeriodIndex]);
  for (const e of entries) {
    if (e.teacherId === teacherId && e.day === day) {
      occupied.add(e.periodIndex);
    }
  }
  if (targetDate) {
    for (const log of proxyLogs) {
      if (
        log.status !== 'cancelled' &&
        log.proxyTeacherId === teacherId &&
        log.date === targetDate
      ) {
        occupied.add(log.periodIndex);
      }
    }
  }

  let streak = 1;
  let prev = targetPeriodIndex - 1;
  while (occupied.has(prev)) {
    streak++;
    prev--;
  }
  let next = targetPeriodIndex + 1;
  while (occupied.has(next)) {
    streak++;
    next++;
  }
  return streak;
}

/**
 * Evaluates assigning one additional Regular or Proxy period to `teacher`
 * at `(day, periodIndex)` (and `date` for Proxy), returning explicit warnings
 * for Weekly Max, Near Limit, Daily Max, Consecutive Periods, Clashes, and Absence.
 */
export function evaluateAssignmentLimits(params: {
  mode: 'regular' | 'proxy';
  teacher: Teacher;
  day: DayOfWeek;
  periodIndex: number;
  date?: string;
  entries: TimetableEntry[];
  proxyLogs?: ProxyLogEntry[];
  absentTeacherIdsOnDate?: string[];
  ignoreEntryId?: string;
  ignoreProxyLogId?: string;
  settings?: SchoolSettings;
}): AssignmentLimitEvaluation {
  const {
    mode,
    teacher,
    day,
    periodIndex,
    date = getLocalDateStr(),
    entries,
    proxyLogs = [],
    absentTeacherIdsOnDate = [],
    ignoreEntryId,
    ignoreProxyLogId,
    settings,
  } = params;

  const filteredEntries = ignoreEntryId
    ? entries.filter(e => e.id !== ignoreEntryId)
    : entries;
  const filteredProxies = ignoreProxyLogId
    ? proxyLogs.filter(p => p.id !== ignoreProxyLogId)
    : proxyLogs;

  const summary = computeTeacherWorkload(teacher, filteredEntries, filteredProxies, {
    targetDate: date,
    targetDay: day,
    settings,
  });

  const warnings: WorkloadWarning[] = [];
  let hasHardClash = false;

  // Check if slot already counted for this teacher (e.g., same physical slot)
  const hasRegularAtSlot = filteredEntries.some(
    e => e.teacherId === teacher.id && e.day === day && e.periodIndex === periodIndex
  );
  const hasProxyAtSlot = filteredProxies.some(
    p =>
      p.status !== 'cancelled' &&
      p.proxyTeacherId === teacher.id &&
      p.date === date &&
      p.periodIndex === periodIndex
  );

  if (mode === 'proxy' && absentTeacherIdsOnDate.includes(teacher.id)) {
    hasHardClash = true;
    warnings.push({
      code: 'absent_on_date',
      severity: 'error',
      message: `${teacher.name} ${date} তারিখে অনুপস্থিত (Absent / On Leave) হিসেবে চিহ্নিত আছেন।`,
    });
  }

  if (mode === 'proxy' && (hasRegularAtSlot || hasProxyAtSlot)) {
    hasHardClash = true;
    warnings.push({
      code: 'time_clash',
      severity: 'error',
      message: hasRegularAtSlot
        ? `${teacher.name}-এর ${day} (Period ${periodIndex})-এ নিয়মিত ক্লাস রয়েছে (Time Clash)।`
        : `${teacher.name}-এর ${date} (Period ${periodIndex})-এ ইতোমধ্যেই আরেকটি প্রক্সি ক্লাস বরাদ্দ রয়েছে।`,
    });
  }

  if (mode === 'proxy' && !hasProxyAtSlot) {
    const existingProxyOnDate = filteredProxies.find(
      p => p.status !== 'cancelled' && p.proxyTeacherId === teacher.id && p.date === date
    );
    if (existingProxyOnDate) {
      hasHardClash = true;
      warnings.push({
        code: 'daily_proxy_limit_exceeded',
        severity: 'error',
        message: `${teacher.name}-কে ${date} তারিখে ইতোমধ্যেই ১টি প্রক্সি ক্লাস (${existingProxyOnDate.className}, P${existingProxyOnDate.periodIndex}) দেওয়া হয়েছে। একজন শিক্ষককে দিনে ১টির বেশি প্রক্সি ক্লাস দেওয়া যাবে না।`,
      });
    }
  }

  const slotBlockedByTeacher =
    teacher.unavailablePeriods?.includes(periodIndex) ||
    teacher.unavailableSlots?.some(s => s.day === day && s.periodIndex === periodIndex);
  if (slotBlockedByTeacher) {
    warnings.push({
      code: 'blocked_slot',
      severity: 'warning',
      message: `${teacher.name}-এর জন্য ${day} (P${periodIndex}) বন্ধ/অবসর পিরিয়ড হিসেবে চিহ্নিত রয়েছে।`,
    });
  }

  const addsNewWeeklyUnit =
    mode === 'proxy'
      ? !hasProxyAtSlot
      : !hasRegularAtSlot;
  const regularCountAfter =
    mode === 'regular' && !hasRegularAtSlot
      ? summary.regularWeeklyPeriods + 1
      : summary.regularWeeklyPeriods;
  const proxyCountAfter =
    mode === 'proxy' && !hasProxyAtSlot
      ? summary.proxyWeeklyPeriods + 1
      : summary.proxyWeeklyPeriods;

  const projectedWeekly = summary.totalWeeklyLoad + (addsNewWeeklyUnit ? 1 : 0);
  const projectedDaily = summary.totalDailyLoad + (addsNewWeeklyUnit ? 1 : 0);
  const projectedConsecutive = computeMaxConsecutiveAfterSlot(
    teacher.id,
    day,
    periodIndex,
    filteredEntries,
    filteredProxies,
    date
  );

  let hasOverloadWarning = false;
  let isNearLimit = false;

  if (projectedWeekly > summary.weeklyMax) {
    hasOverloadWarning = true;
    warnings.push({
      code: 'weekly_exceeded',
      severity: 'error',
      message: `এই শিক্ষকের নিয়মিত (${regularCountAfter}) ও প্রক্সি (${proxyCountAfter}) মিলিয়ে মোট ${projectedWeekly}টি ক্লাস হচ্ছে, যা ${summary.weeklyMax}টি সাপ্তাহিক লিমিটের বেশি।`,
    });
  } else if (projectedWeekly >= Math.max(1, summary.weeklyMax - 2)) {
    isNearLimit = true;
    warnings.push({
      code: 'weekly_near',
      severity: 'warning',
      message: `সাপ্তাহিক সীমার কাছাকাছি: এই ক্লাসটি যুক্ত করলে মোট লোড হবে ${projectedWeekly}/${summary.weeklyMax} (নিয়মিত ${regularCountAfter} + প্রক্সি ${proxyCountAfter})।`,
    });
  }

  if (projectedDaily > summary.dailyMax) {
    hasOverloadWarning = true;
    warnings.push({
      code: 'daily_exceeded',
      severity: 'warning',
      message: `দৈনিক ক্লাস লিমিট অতিক্রম: ${day} দিনে মোট ক্লাস হবে ${projectedDaily}টি (দৈনিক সর্বোচ্চ সীমা ${summary.dailyMax}টি)।`,
    });
  }

  if (projectedConsecutive > summary.consecutiveMax) {
    hasOverloadWarning = true;
    warnings.push({
      code: 'consecutive_exceeded',
      severity: 'warning',
      message: `একটানা ক্লাস সতর্কতা: পরপর ${projectedConsecutive}টি পিরিয়ড ক্লাস পড়বে (নির্ধারিত সর্বোচ্চ সীমা ${summary.consecutiveMax}টি)।`,
    });
  }

  return {
    hasHardClash,
    hasOverloadWarning,
    isNearLimit,
    requiresOverride: hasOverloadWarning || Boolean(slotBlockedByTeacher),
    warnings,
    regularWeeklyPeriods: regularCountAfter,
    proxyWeeklyPeriods: proxyCountAfter,
    projectedWeekly,
    weeklyMax: summary.weeklyMax,
    projectedDaily,
    dailyMax: summary.dailyMax,
    projectedConsecutive,
    consecutiveMax: summary.consecutiveMax,
    projectedStatus: classifyWorkloadStatus(projectedWeekly, summary.weeklyMax),
  };
}
