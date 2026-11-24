import React, { useEffect, useMemo, useState } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import {
  Clock,
  Search,
  Users,
  BookOpen,
  ArrowUpRight,
  CalendarClock,
  Coffee,
  Home,
} from 'lucide-react';
import { BENGALI_DAY_NAMES, isSlotDismissed } from '../services/scheduleTiers';
import { SchoolCrestLogo } from './SchoolCrestLogo';
import { useViewMode } from '../context/ViewModeContext';

interface LiveDashboardViewProps {
  classes: SchoolClass[];
  teachers: Teacher[];
  subjects: Subject[];
  workingDays: DayOfWeek[];
  periodTimings: PeriodTiming[];
  entries: TimetableEntry[];
  settings: SchoolSettings;
  onSelectClassSection: (classId: string, sectionId: string) => void;
  onSelectTeacher: (teacherId: string) => void;
}

const JS_DAY_TO_ENUM: DayOfWeek[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

interface ParsedPeriodWindow {
  period: PeriodTiming;
  startMinutes: number;
  endMinutes: number;
}

function parseTimeStringToMinutes(raw: string, minHintMinutes: number = 0): number | null {
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
    // Handle omitted AM/PM during school hours sequentially (e.g. 01:15 after 12:35)
    if (hours * 60 + minutes < minHintMinutes && hours < 12) {
      hours += 12;
    }
  }

  return hours * 60 + minutes;
}

function buildParsedWindows(periodTimings: PeriodTiming[]): ParsedPeriodWindow[] {
  const sorted = [...periodTimings].sort((a, b) => a.periodIndex - b.periodIndex);
  let lastEnd = 7 * 60; // School day starts no earlier than 07:00
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

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const LiveDashboardView: React.FC<LiveDashboardViewProps> = ({
  classes,
  teachers,
  subjects,
  workingDays,
  periodTimings,
  entries,
  settings,
  onSelectClassSection,
  onSelectTeacher,
}) => {
  const { isMobileView } = useViewMode();
  const [now, setNow] = useState<Date>(() => new Date());
  const [inspectMode, setInspectMode] = useState<'live' | 'manual'>('live');
  const [manualDay, setManualDay] = useState<DayOfWeek>(() => {
    const today = JS_DAY_TO_ENUM[new Date().getDay()];
    return workingDays.includes(today) ? today : (workingDays[0] || 'Sunday');
  });
  const [manualPeriodIndex, setManualPeriodIndex] = useState<number>(() => {
    return periodTimings[0]?.periodIndex ?? 1;
  });
  const [viewScope, setViewScope] = useState<'classes' | 'teachers'>('classes');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('all');

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const parsedWindows = useMemo(() => buildParsedWindows(periodTimings), [periodTimings]);
  const subjectMap = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects]);
  const teacherMap = useMemo(() => new Map(teachers.map(t => [t.id, t])), [teachers]);
  const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);

  const currentDayEnum = JS_DAY_TO_ENUM[now.getDay()];
  const isTodayWorkingDay = workingDays.includes(currentDayEnum);
  const nowSecondsSinceMidnight =
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const nowMinutesFloat = nowSecondsSinceMidnight / 60;

  const liveWindow = useMemo(() => {
    if (!isTodayWorkingDay) return null;
    return (
      parsedWindows.find(
        w => nowMinutesFloat >= w.startMinutes && nowMinutesFloat < w.endMinutes
      ) || null
    );
  }, [isTodayWorkingDay, parsedWindows, nowMinutesFloat]);

  const nextUpcomingWindow = useMemo(() => {
    if (!isTodayWorkingDay) return null;
    return parsedWindows.find(w => w.startMinutes > nowMinutesFloat) || null;
  }, [isTodayWorkingDay, parsedWindows, nowMinutesFloat]);

  // Effective day & period being visualized on the board
  const activeDay: DayOfWeek = inspectMode === 'live' ? currentDayEnum : manualDay;
  const activePeriod: PeriodTiming | null = useMemo(() => {
    if (inspectMode === 'manual') {
      return periodTimings.find(p => p.periodIndex === manualPeriodIndex) || periodTimings[0] || null;
    }
    return liveWindow?.period || null;
  }, [inspectMode, liveWindow, manualPeriodIndex, periodTimings]);

  const isGlobalBreak = Boolean(activePeriod && (activePeriod.isBreak || activePeriod.isLocked));
  const isSchoolOffline = inspectMode === 'live' && (!isTodayWorkingDay || !activePeriod);

  // Build section snapshots for the active (day, period)
  const sectionSnapshots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list: {
      cls: SchoolClass;
      sectionId: string;
      sectionName: string;
      room?: string;
      status: 'offline' | 'break' | 'dismissed' | 'active' | 'free';
      slotEntries: TimetableEntry[];
      nextSlotEntries: TimetableEntry[];
      nextPeriod?: PeriodTiming;
    }[] = [];

    const nextPeriodObj = activePeriod
      ? periodTimings.find(
          p => p.periodIndex > activePeriod.periodIndex && !p.isBreak && !p.isLocked
        )
      : undefined;

    for (const cls of classes) {
      if (selectedClassFilter !== 'all' && cls.id !== selectedClassFilter) continue;

      for (const sec of cls.sections) {
        const currentEntries =
          activePeriod && !isSchoolOffline && !isGlobalBreak
            ? entries.filter(
                e =>
                  e.classId === cls.id &&
                  e.sectionId === sec.id &&
                  e.day === activeDay &&
                  e.periodIndex === activePeriod.periodIndex
              )
            : [];

        const nextEntries = nextPeriodObj
          ? entries.filter(
              e =>
                e.classId === cls.id &&
                e.sectionId === sec.id &&
                e.day === activeDay &&
                e.periodIndex === nextPeriodObj.periodIndex
            )
          : [];

        let status: 'offline' | 'break' | 'dismissed' | 'active' | 'free' = 'free';
        if (isSchoolOffline || !activePeriod) {
          status = 'offline';
        } else if (isGlobalBreak) {
          status = 'break';
        } else if (isSlotDismissed(cls, activeDay, activePeriod.periodIndex, sec.id, workingDays)) {
          status = 'dismissed';
        } else if (currentEntries.length > 0) {
          status = 'active';
        } else {
          status = 'free';
        }

        if (q) {
          const matchesText =
            cls.name.toLowerCase().includes(q) ||
            sec.name.toLowerCase().includes(q) ||
            (sec.roomNumber || '').toLowerCase().includes(q) ||
            currentEntries.some(e => {
              const sub = subjectMap.get(e.subjectId);
              const tch = teacherMap.get(e.teacherId);
              return (
                (sub?.name || '').toLowerCase().includes(q) ||
                (tch?.name || '').toLowerCase().includes(q) ||
                (tch?.initials || '').toLowerCase().includes(q)
              );
            });
          if (!matchesText) continue;
        }

        list.push({
          cls,
          sectionId: sec.id,
          sectionName: sec.name,
          room: sec.roomNumber,
          status,
          slotEntries: currentEntries,
          nextSlotEntries: nextEntries,
          nextPeriod: nextPeriodObj,
        });
      }
    }

    return list;
  }, [
    classes,
    selectedClassFilter,
    searchQuery,
    activePeriod,
    activeDay,
    isSchoolOffline,
    isGlobalBreak,
    entries,
    periodTimings,
    workingDays,
    subjectMap,
    teacherMap,
  ]);

  // All sections unfiltered counts for header metrics
  const metrics = useMemo(() => {
    let totalSections = 0;
    let runningSections = 0;
    let dismissedSections = 0;
    const activeTeacherIds = new Set<string>();

    for (const cls of classes) {
      for (const sec of cls.sections) {
        totalSections += 1;
        if (!activePeriod || isSchoolOffline || isGlobalBreak) continue;
        if (isSlotDismissed(cls, activeDay, activePeriod.periodIndex, sec.id, workingDays)) {
          dismissedSections += 1;
          continue;
        }
        const cur = entries.filter(
          e =>
            e.classId === cls.id &&
            e.sectionId === sec.id &&
            e.day === activeDay &&
            e.periodIndex === activePeriod.periodIndex
        );
        if (cur.length > 0) {
          runningSections += 1;
          cur.forEach(e => {
            if (e.teacherId) activeTeacherIds.add(e.teacherId);
          });
        }
      }
    }

    return {
      totalSections,
      runningSections,
      dismissedSections,
      teachersInClass: activeTeacherIds.size,
      freeTeachers: Math.max(0, teachers.length - activeTeacherIds.size),
    };
  }, [
    classes,
    teachers.length,
    activePeriod,
    activeDay,
    isSchoolOffline,
    isGlobalBreak,
    entries,
    workingDays,
  ]);

  // Group class sections by SchoolClass for clean hierarchy
  const groupedByClass = useMemo(() => {
    const map = new Map<
      string,
      { cls: SchoolClass; items: typeof sectionSnapshots }
    >();
    for (const item of sectionSnapshots) {
      const existing = map.get(item.cls.id);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(item.cls.id, { cls: item.cls, items: [item] });
      }
    }
    return Array.from(map.values());
  }, [sectionSnapshots]);

  // Teacher directory split into In Class vs Standby/Free
  const teacherSnapshots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const inClass: { teacher: Teacher; assignments: TimetableEntry[] }[] = [];
    const standby: Teacher[] = [];

    for (const teacher of teachers) {
      const currentAssignments =
        activePeriod && !isSchoolOffline && !isGlobalBreak
          ? entries.filter(
              e =>
                e.day === activeDay &&
                e.periodIndex === activePeriod.periodIndex &&
                e.teacherId === teacher.id
            )
          : [];

      if (q) {
        const hitTeacher =
          teacher.name.toLowerCase().includes(q) ||
          teacher.initials.toLowerCase().includes(q) ||
          teacher.designation.toLowerCase().includes(q);
        const hitAssignment = currentAssignments.some(e => {
          const c = classMap.get(e.classId);
          const s = subjectMap.get(e.subjectId);
          return (
            (c?.name || '').toLowerCase().includes(q) ||
            (s?.name || '').toLowerCase().includes(q)
          );
        });
        if (!hitTeacher && !hitAssignment) continue;
      }

      if (currentAssignments.length > 0) {
        inClass.push({ teacher, assignments: currentAssignments });
      } else {
        standby.push(teacher);
      }
    }

    return { inClass, standby };
  }, [
    teachers,
    activePeriod,
    activeDay,
    isSchoolOffline,
    isGlobalBreak,
    entries,
    searchQuery,
    classMap,
    subjectMap,
  ]);

  const liveClockFormatted = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const liveDateFormatted = now.toLocaleDateString('bn-BD', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const liveRemainingText = useMemo(() => {
    if (inspectMode !== 'live') return null;
    if (liveWindow) {
      const endSec = liveWindow.endMinutes * 60;
      const diff = Math.max(0, endSec - nowSecondsSinceMidnight);
      return `পিরিয়ড শেষ হতে বাকি ${formatCountdown(diff)}`;
    }
    if (nextUpcomingWindow) {
      const startSec = nextUpcomingWindow.startMinutes * 60;
      const diff = Math.max(0, startSec - nowSecondsSinceMidnight);
      return `${nextUpcomingWindow.period.label} শুরু হতে বাকি ${formatCountdown(diff)}`;
    }
    return null;
  }, [inspectMode, liveWindow, nextUpcomingWindow, nowSecondsSinceMidnight]);

  return (
    <div className="space-y-5">
      {/* Live Campus Dispatch Header */}
      <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-stone-200/80 dark:border-slate-800">
          <div className="flex items-start gap-3.5">
            <SchoolCrestLogo className="w-12 h-12 shrink-0 hidden sm:block mt-0.5" />
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase text-[#145343] dark:text-emerald-400">
                  {inspectMode === 'live' && !isSchoolOffline ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-pulse" />
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {inspectMode === 'live'
                      ? 'রিয়েল-টাইম ক্যাম্পাস ড্যাশবোর্ড'
                      : 'পিরিয়ড ইন্সপেক্টর মোড'}
                  </span>
                </span>
                <span className="text-stone-300 dark:text-slate-700">|</span>
                <span className="text-xs text-stone-600 dark:text-slate-400 font-medium">
                  {settings.schoolName}
                </span>
              </div>

            <h1 className="text-lg sm:text-xl font-bold text-stone-900 dark:text-white tracking-tight">
              {isSchoolOffline ? (
                !isTodayWorkingDay ? (
                  `আজ ${BENGALI_DAY_NAMES[currentDayEnum] || currentDayEnum} — সাপ্তাহিক ছুটি`
                ) : (
                  'বর্তমানে শ্রেণি কার্যক্রম চলমান নেই (বিদ্যালয় সময়ের বাইরে)'
                )
              ) : isGlobalBreak ? (
                `টিফিন বিরতি চলমান · ${activePeriod?.label || '4th Period'} (${activePeriod?.startTime} – ${activePeriod?.endTime})`
              ) : (
                `${BENGALI_DAY_NAMES[activeDay] || activeDay} · ${activePeriod?.label || ''} (${activePeriod?.startTime || ''} – ${activePeriod?.endTime || ''})`
              )}
            </h1>

            <div className="flex items-center gap-3 flex-wrap text-xs text-stone-500 dark:text-slate-400">
              <span>{liveDateFormatted}</span>
              {liveRemainingText && (
                <>
                  <span>·</span>
                  <span className="font-mono font-semibold text-[#145343] dark:text-emerald-400 tabular-nums">
                    {liveRemainingText}
                  </span>
                </>
              )}
            </div>
          </div>
          </div>

          {/* Right: Live Clock + Live/Manual Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
            <div className="px-3.5 py-2 rounded-lg bg-[#f7f5f0] dark:bg-slate-900 border border-stone-200 dark:border-slate-800 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                ক্যাম্পাস ঘড়ি
              </div>
              <div className="text-lg font-mono font-bold text-stone-900 dark:text-white tabular-nums leading-tight">
                {liveClockFormatted}
              </div>
            </div>

            <div className="flex items-center p-1 rounded-lg bg-[#f7f5f0] dark:bg-slate-900 border border-stone-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setInspectMode('live')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  inspectMode === 'live'
                    ? 'bg-[#145343] text-white'
                    : 'text-stone-600 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                Live এখন
              </button>
              <button
                type="button"
                onClick={() => setInspectMode('manual')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center gap-1 ${
                  inspectMode === 'manual'
                    ? 'bg-[#145343] text-white'
                    : 'text-stone-600 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>অন্য সময় দেখুন</span>
              </button>
            </div>
          </div>
        </div>

        {/* Manual Day/Period Picker */}
        {inspectMode === 'manual' && (
          <div className="pt-4 pb-1 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-stone-200/70 dark:border-slate-800 mb-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-stone-500 dark:text-slate-400 mr-1">দিন:</span>
              {workingDays.map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => setManualDay(day)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    manualDay === day
                      ? 'bg-[#145343] text-white'
                      : 'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 hover:bg-stone-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap pb-3 md:pb-0">
              <span className="text-xs font-semibold text-stone-500 dark:text-slate-400 mr-1">পিরিয়ড:</span>
              {periodTimings.map(p => (
                <button
                  key={p.periodIndex}
                  type="button"
                  onClick={() => setManualPeriodIndex(p.periodIndex)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    manualPeriodIndex === p.periodIndex
                      ? p.isBreak || p.isLocked
                        ? 'bg-amber-600 text-white'
                        : 'bg-[#145343] text-white'
                      : 'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 hover:bg-stone-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {p.isBreak || p.isLocked ? 'টিফিন' : `P${p.periodIndex}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Crisp Tabular Metrics Strip (No Pill Clutter) */}
        <div className={`grid gap-4 pt-4 ${isMobileView ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
          <div className="border-r border-stone-200/80 dark:border-slate-800 pr-4 last:border-r-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
              চলমান সেকশন
            </div>
            <div className="text-2xl font-mono font-bold text-[#145343] dark:text-emerald-400 tabular-nums mt-0.5">
              {metrics.runningSections}
              <span className="text-xs font-normal text-stone-400 ml-1">/ {metrics.totalSections}</span>
            </div>
          </div>

          <div className="lg:border-r border-stone-200/80 dark:border-slate-800 pr-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
              ক্লাসরুমে শিক্ষক
            </div>
            <div className="text-2xl font-mono font-bold text-stone-900 dark:text-white tabular-nums mt-0.5">
              {metrics.teachersInClass}
              <span className="text-xs font-normal text-stone-400 ml-1">জন</span>
            </div>
          </div>

          <div className="border-r border-stone-200/80 dark:border-slate-800 pr-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
              ফ্রি / স্ট্যান্ডবাই শিক্ষক
            </div>
            <div className="text-2xl font-mono font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">
              {metrics.freeTeachers}
              <span className="text-xs font-normal text-stone-400 ml-1">জন</span>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
              ছুটিপ্রাপ্ত সেকশন
            </div>
            <div className="text-2xl font-mono font-bold text-stone-600 dark:text-slate-300 tabular-nums mt-0.5">
              {metrics.dismissedSections}
              <span className="text-xs font-normal text-stone-400 ml-1">টি</span>
            </div>
          </div>
        </div>
      </div>

      {/* Offline Info Prompt */}
      {isSchoolOffline && (
        <div className="bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
          <div>
            <strong>এখন লাইভ ক্লাস চলাকালীন সময় নয়</strong> ({BENGALI_DAY_NAMES[currentDayEnum]},{' '}
            {liveClockFormatted})। নিচে যেকোনো দিনের নির্দিষ্ট পিরিয়ডে কোন শ্রেণিতে কে ক্লাস নিচ্ছেন তা পরীক্ষা করতে পারেন।
          </div>
          <button
            type="button"
            onClick={() => setInspectMode('manual')}
            className="px-3 py-1.5 rounded-lg bg-[#145343] hover:bg-[#0f3f33] text-white font-semibold shrink-0 transition-colors"
          >
            নির্দিষ্ট পিরিয়ড দেখুন
          </button>
        </div>
      )}

      {/* Sub-navigation & Filters */}
      <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-5 border-b md:border-b-0 border-stone-100 dark:border-slate-800 pb-2 md:pb-0">
          <button
            type="button"
            onClick={() => setViewScope('classes')}
            className={`pb-1.5 md:pb-0.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              viewScope === 'classes'
                ? 'border-[#145343] text-[#145343] dark:border-emerald-400 dark:text-emerald-400'
                : 'border-transparent text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>শ্রেণি ও সেকশন লাইভ বোর্ড ({sectionSnapshots.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setViewScope('teachers')}
            className={`pb-1.5 md:pb-0.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              viewScope === 'teachers'
                ? 'border-[#145343] text-[#145343] dark:border-emerald-400 dark:text-emerald-400'
                : 'border-transparent text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>শিক্ষক অবস্থান ({teachers.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {viewScope === 'classes' && (
            <select
              value={selectedClassFilter}
              onChange={e => setSelectedClassFilter(e.target.value)}
              className="py-1.5 px-2.5 text-xs bg-[#f7f5f0] dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-lg text-stone-800 dark:text-slate-200 font-medium focus:outline-none"
            >
              <option value="all">সকল শ্রেণি (Play – 10)</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          <div className="relative flex-1 min-w-[200px] sm:w-64">
            <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="শ্রেণি, শিক্ষক বা বিষয় খুঁজুন..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#f7f5f0] dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#145343]"
            />
          </div>
        </div>
      </div>

      {/* Main Live Grid Body */}
      {viewScope === 'classes' ? (
        <div className="space-y-4">
          {groupedByClass.length === 0 ? (
            <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-10 text-center text-xs text-stone-500">
              অনুসন্ধানের সাথে মিলে এমন কোনো সেকশন পাওয়া যায়নি।
            </div>
          ) : (
            groupedByClass.map(({ cls, items }) => (
              <div
                key={cls.id}
                className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 overflow-hidden"
              >
                <div className="px-4 py-2.5 bg-[#f7f5f0] dark:bg-slate-900/70 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between">
                  <div className="text-xs font-bold text-stone-900 dark:text-white">
                    {cls.name}
                  </div>
                  <div className="text-[11px] font-mono text-stone-500 dark:text-slate-400">
                    {items.length} টি সেকশন
                  </div>
                </div>

                <div
                  className={
                    isMobileView
                      ? 'grid grid-cols-1 divide-y divide-stone-200/70 dark:divide-slate-800 bg-white dark:bg-[#141a20]'
                      : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:gap-px bg-stone-200/70 dark:bg-slate-800'
                  }
                >
                  {items.map(item => (
                    <button
                      key={`${cls.id}-${item.sectionId}`}
                      type="button"
                      onClick={() => onSelectClassSection(cls.id, item.sectionId)}
                      className="text-left p-4 bg-white dark:bg-[#141a20] hover:bg-stone-50 dark:hover:bg-slate-800/50 transition-colors flex flex-col justify-between gap-2.5 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-sm text-stone-900 dark:text-white truncate">
                            {item.sectionName}
                          </span>
                          {item.room && (
                            <span className="text-[11px] font-mono text-stone-500 dark:text-slate-400 shrink-0">
                              রুম {item.room}
                            </span>
                          )}
                        </div>
                        <ArrowUpRight className="w-3.5 h-3.5 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>

                      {item.status === 'active' ? (
                        <div className="space-y-1.5">
                          {item.slotEntries.map(entry => {
                            const sub = subjectMap.get(entry.subjectId);
                            const tch = teacherMap.get(entry.teacherId);
                            return (
                              <div key={entry.id} className="space-y-0.5">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-[#145343] dark:text-emerald-400">
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: sub?.color || '#145343' }}
                                  />
                                  <span className="truncate">{sub?.name || 'Subject'}</span>
                                  {entry.room && entry.room !== item.room && (
                                    <span className="text-[10px] font-mono text-stone-500 dark:text-slate-400">
                                      [{entry.room}]
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-stone-700 dark:text-slate-200 font-medium pl-3.5 truncate">
                                  শিক্ষক: {tch?.name || 'নির্ধারিত নয়'}
                                  {tch?.initials ? ` (${tch.initials})` : ''}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : item.status === 'break' ? (
                        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 font-semibold py-1">
                          <Coffee className="w-4 h-4 shrink-0" />
                          <span>টিফিন বিরতি চলমান</span>
                        </div>
                      ) : item.status === 'dismissed' ? (
                        <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-slate-500 font-medium py-1">
                          <Home className="w-4 h-4 shrink-0" />
                          <span>এই পিরিয়ডে শ্রেণি ছুটি</span>
                        </div>
                      ) : item.status === 'offline' ? (
                        <div className="text-xs text-stone-400 dark:text-slate-500 py-1">
                          বর্তমানে চলমান কোনো পিরিয়ড নেই
                        </div>
                      ) : (
                        <div className="text-xs text-stone-400 dark:text-slate-500 py-1">
                          এই পিরিয়ডে কোনো ক্লাস নির্ধারিত নেই
                        </div>
                      )}

                      {item.nextPeriod &&
                        item.nextSlotEntries.length > 0 &&
                        item.status !== 'dismissed' && (
                          <div className="pt-2 border-t border-stone-100 dark:border-slate-800/80 text-[11px] text-stone-500 dark:text-slate-400 truncate">
                            পরবর্তী ({item.nextPeriod.label}):{' '}
                            <span className="font-semibold text-stone-700 dark:text-slate-300">
                              {item.nextSlotEntries
                                .map(ne => subjectMap.get(ne.subjectId)?.name || '')
                                .filter(Boolean)
                                .join(' / ')}
                            </span>
                          </div>
                        )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className={`grid gap-5 ${isMobileView ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
          {/* Active In Class Teachers */}
          <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 bg-[#f7f5f0] dark:bg-slate-900/70 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between">
              <div className="text-xs font-bold text-[#145343] dark:text-emerald-400">
                বর্তমানে ক্লাসরুমে আছেন ({teacherSnapshots.inClass.length} জন)
              </div>
              <div className="text-[11px] text-stone-500 dark:text-slate-400">
                ক্লিক করে রুটিন দেখুন
              </div>
            </div>

            {teacherSnapshots.inClass.length === 0 ? (
              <div className="p-8 text-center text-xs text-stone-500">
                এই মুহূর্তে কোনো শিক্ষক ক্লাসরুমে নেই।
              </div>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-slate-800">
                {teacherSnapshots.inClass.map(({ teacher, assignments }) => (
                  <button
                    key={teacher.id}
                    type="button"
                    onClick={() => onSelectTeacher(teacher.id)}
                    className="w-full text-left px-4 py-3 hover:bg-stone-50 dark:hover:bg-slate-800/50 transition-colors flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-stone-900 dark:text-white truncate">
                        {teacher.name} ({teacher.initials})
                      </div>
                      <div className="text-[11px] text-stone-500 dark:text-slate-400 mt-0.5">
                        {teacher.designation}
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      {assignments.map(a => {
                        const cls = classMap.get(a.classId);
                        const sec = cls?.sections.find(s => s.id === a.sectionId);
                        const sub = subjectMap.get(a.subjectId);
                        return (
                          <div key={a.id} className="text-xs">
                            <span className="font-bold text-[#145343] dark:text-emerald-400">
                              {cls?.name} · {sec?.name}
                            </span>
                            <div className="text-[11px] text-stone-600 dark:text-slate-300">
                              {sub?.name}
                              {(a.room || sec?.roomNumber) ? ` · রুম ${a.room || sec?.roomNumber}` : ''}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Free / Standby Teachers */}
          <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 bg-[#f7f5f0] dark:bg-slate-900/70 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between">
              <div className="text-xs font-bold text-stone-800 dark:text-slate-200">
                ফ্রি / স্ট্যান্ডবাই শিক্ষক ({teacherSnapshots.standby.length} জন)
              </div>
              <div className="text-[11px] text-stone-500 dark:text-slate-400">
                ক্লিক করে রুটিন দেখুন
              </div>
            </div>

            {teacherSnapshots.standby.length === 0 ? (
              <div className="p-8 text-center text-xs text-stone-500">
                সকল শিক্ষকই বর্তমানে ব্যস্ত আছেন।
              </div>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-slate-800">
                {teacherSnapshots.standby.map(teacher => {
                  const notes: string[] = [];
                  if (teacher.isBlockTeacher) notes.push('ব্লক শিক্ষক');
                  if (teacher.isCoordinator) notes.push('কো-অর্ডিনেটর');
                  if (teacher.noProxy) notes.push('প্রক্সি-মুক্ত');
                  return (
                    <button
                      key={teacher.id}
                      type="button"
                      onClick={() => onSelectTeacher(teacher.id)}
                      className="w-full text-left px-4 py-3 hover:bg-stone-50 dark:hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-stone-900 dark:text-white truncate">
                          {teacher.name} ({teacher.initials})
                        </div>
                        <div className="text-[11px] text-stone-500 dark:text-slate-400 mt-0.5 truncate">
                          {teacher.designation}
                          {notes.length > 0 ? ` · ${notes.join(', ')}` : ''}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                        {isGlobalBreak ? 'বিরতি' : isSchoolOffline ? 'অফ-আওয়ার' : 'ফ্রি'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
