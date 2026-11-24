import { DayOfWeek, PeriodTiming } from '../types';

export const JS_DAY_TO_ENUM: DayOfWeek[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export interface ParsedPeriodWindow {
  period: PeriodTiming;
  startMinutes: number;
  endMinutes: number;
}

export function parseTimeStringToMinutes(raw: string, minHintMinutes: number = 0): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase();
  const match = cleaned.match(/^(\d{1,2})[:.](\d{2})(?:\s*(AM|PM))?$/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3];

  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }

  if (meridiem) {
    if (hours === 12) hours = 0;
    if (meridiem === 'PM') hours += 12;
  } else {
    if (hours * 60 + minutes < minHintMinutes && hours < 12) {
      hours += 12;
    }
  }

  return hours * 60 + minutes;
}

export function buildParsedWindows(periodTimings: PeriodTiming[]): ParsedPeriodWindow[] {
  const sorted = [...periodTimings].sort((a, b) => a.periodIndex - b.periodIndex);
  let lastEnd = 7 * 60;
  const result: ParsedPeriodWindow[] = [];

  for (const period of sorted) {
    const start = parseTimeStringToMinutes(period.startTime, lastEnd);
    const end = parseTimeStringToMinutes(period.endTime, start ?? lastEnd);
    if (start !== null && end !== null && end > start) {
      result.push({ period, startMinutes: start, endMinutes: end });
      lastEnd = end;
    }
  }
  return result;
}

export interface LiveSlotSnapshot {
  todayEnum: DayOfWeek;
  isWorkingDay: boolean;
  currentWindow: ParsedPeriodWindow | null;
  nextWindow: ParsedPeriodWindow | null;
  remainingMinutes: number | null;
}

export function resolveLiveSlotStatus(
  periodTimings: PeriodTiming[],
  workingDays: DayOfWeek[],
  now: Date
): LiveSlotSnapshot {
  const todayEnum = JS_DAY_TO_ENUM[now.getDay()];
  const isWorkingDay = workingDays.includes(todayEnum);
  const windows = buildParsedWindows(periodTimings);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (!isWorkingDay || windows.length === 0) {
    return {
      todayEnum,
      isWorkingDay,
      currentWindow: null,
      nextWindow: null,
      remainingMinutes: null,
    };
  }

  const currentIdx = windows.findIndex(w => nowMinutes >= w.startMinutes && nowMinutes < w.endMinutes);
  if (currentIdx !== -1) {
    const currentWindow = windows[currentIdx];
    const nextWindow = windows.slice(currentIdx + 1).find(w => !w.period.isBreak && !w.period.isLocked) || null;
    return {
      todayEnum,
      isWorkingDay,
      currentWindow,
      nextWindow,
      remainingMinutes: Math.max(0, currentWindow.endMinutes - nowMinutes),
    };
  }

  const upcomingWindow = windows.find(w => nowMinutes < w.startMinutes && !w.period.isBreak && !w.period.isLocked) || null;
  return {
    todayEnum,
    isWorkingDay,
    currentWindow: null,
    nextWindow: upcomingWindow,
    remainingMinutes: null,
  };
}
