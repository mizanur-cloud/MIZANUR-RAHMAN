import React, { useMemo, useState } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  SchoolClass,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import { Grid3X3, Users, BookOpen, Layers, Clock, TrendingUp, CalendarCheck, LayoutList } from 'lucide-react';
import { useViewMode } from '../context/ViewModeContext';
import { BENGALI_DAY_NAMES, isSlotDismissed } from '../services/scheduleTiers';
import { resolveLiveSlotStatus } from '../services/livePeriodClock';
import { isPlayOrNursery } from '../services/parallelSubjects';

interface MasterTimetableViewProps {
  classes: SchoolClass[];
  teachers: Teacher[];
  subjects: Subject[];
  workingDays: DayOfWeek[];
  periodTimings: PeriodTiming[];
  entries: TimetableEntry[];
  onOpenEditSlot: (classId: string, sectionId: string, day: DayOfWeek, periodIndex: number) => void;
  readOnly?: boolean;
}

export const MasterTimetableView: React.FC<MasterTimetableViewProps> = ({
  classes,
  teachers,
  subjects,
  workingDays,
  periodTimings,
  entries,
  onOpenEditSlot,
  readOnly = false,
}) => {
  const { isMobileView } = useViewMode();
  const activePeriods = periodTimings.filter(p => !p.isBreak && !p.isLocked);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(() => {
    const todayMap: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = todayMap[new Date().getDay()];
    return workingDays.includes(today) ? today : workingDays[0] || 'Sunday';
  });
  const [pivotMode, setPivotMode] = useState<'byClass' | 'byTeacher'>('byClass');
  const [mobileMasterFormat, setMobileMasterFormat] = useState<'agenda' | 'grid'>('agenda');
  const [selectedMobilePeriod, setSelectedMobilePeriod] = useState<number>(() => {
    const snap = resolveLiveSlotStatus(periodTimings, workingDays, new Date());
    const curIdx =
      snap.currentWindow && !snap.currentWindow.period.isBreak && !snap.currentWindow.period.isLocked
        ? snap.currentWindow.period.periodIndex
        : null;
    return curIdx ?? activePeriods[0]?.periodIndex ?? 1;
  });

  const subjectMap = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects]);
  const teacherMap = useMemo(() => new Map(teachers.map(t => [t.id, t])), [teachers]);
  const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);

  const allDisplayPeriods = periodTimings;

  const allSections = useMemo(() => {
    const flat: { classObj: SchoolClass; sectionId: string; sectionName: string }[] = [];
    classes.forEach(c => {
      c.sections.forEach(s => {
        flat.push({ classObj: c, sectionId: s.id, sectionName: s.name });
      });
    });
    return flat;
  }, [classes]);

  const { sectionSlotMap, teacherPeriodMap } = useMemo(() => {
    const secMap = new Map<string, TimetableEntry[]>();
    const tchMap = new Map<string, TimetableEntry>();
    for (const e of entries) {
      if (e.day !== selectedDay) continue;
      const sKey = `${e.classId}_${e.sectionId}_${e.periodIndex}`;
      const list = secMap.get(sKey);
      if (list) list.push(e);
      else secMap.set(sKey, [e]);

      const tKey = `${e.teacherId}_${e.periodIndex}`;
      if (!tchMap.has(tKey)) {
        tchMap.set(tKey, e);
      }
    }
    return { sectionSlotMap: secMap, teacherPeriodMap: tchMap };
  }, [entries, selectedDay]);

  // Calculate curriculum required periods across all sections
  const totalRequiredPeriods = useMemo(
    () =>
      classes.reduce((classAcc, c) => {
        if (isPlayOrNursery(c)) {
          const openPeriods = activePeriods.filter(
            p => !isSlotDismissed(c, workingDays[0] || 'Sunday', p.periodIndex, c.sections[0]?.id, workingDays)
          ).length;
          return classAcc + openPeriods * workingDays.length * c.sections.length;
        }
        const classReq = c.subjectRequirements.reduce((rAcc, req) => rAcc + req.periodsPerWeek, 0);
        return classAcc + classReq * c.sections.length;
      }, 0),
    [classes, activePeriods, workingDays]
  );

  // Total possible timetable slots in school grid
  const totalPossibleSlots = allSections.length * workingDays.length * activePeriods.length;

  // Total scheduled periods
  const totalScheduledPeriods = entries.length;

  // Remaining unassigned slots in matrix
  const remainingUnassignedSlots = Math.max(0, totalPossibleSlots - totalScheduledPeriods);

  // Teacher utilization percentage:
  // Each teacher has a standard weekly target capacity: (maxDailyPeriods || 5) * workingDays.length
  const totalTeacherCapacity = useMemo(
    () =>
      teachers.reduce((acc, t) => {
        const dailyCap = typeof t.maxDailyPeriods === 'number' && t.maxDailyPeriods > 0 ? t.maxDailyPeriods : 5;
        return acc + dailyCap * workingDays.length;
      }, 0),
    [teachers, workingDays.length]
  );

  const teacherUtilizationPct =
    totalTeacherCapacity > 0
      ? Math.min(100, Math.round((totalScheduledPeriods / totalTeacherCapacity) * 100))
      : 0;

  // Active teachers with at least 1 assigned class
  const activeTeachersCount = useMemo(() => new Set(entries.map(e => e.teacherId)).size, [entries]);

  const activeMobilePeriod =
    activePeriods.find(p => p.periodIndex === selectedMobilePeriod) || activePeriods[0];

  return (
    <div className={isMobileView ? 'space-y-3.5' : 'space-y-6'}>
      {isMobileView ? (
        /* Compact Mobile 2-Col KPI Strip */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-stone-900 dark:text-white flex items-center gap-1.5">
              <CalendarCheck className="w-4 h-4 text-[#145343] dark:text-emerald-400" />
              <span>মাস্টার রুটিন ম্যাট্রিক্স</span>
            </h2>
            <span className="text-[11px] font-mono text-stone-500 dark:text-slate-400 tabular-nums">
              {allSections.length} শাখা · {workingDays.length} দিন
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-2.5 rounded-xl bg-[#f7f5f0] dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
              <div className="text-[10px] font-semibold text-stone-500 dark:text-slate-400">
                নির্ধারিত পিরিয়ড
              </div>
              <div className="text-lg font-bold text-stone-900 dark:text-white font-mono tabular-nums mt-0.5">
                {totalScheduledPeriods}
                <span className="text-xs font-normal text-stone-400"> / {totalRequiredPeriods}</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[#f7f5f0] dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
              <div className="text-[10px] font-semibold text-stone-500 dark:text-slate-400">
                শিক্ষক ব্যবহার
              </div>
              <div className="text-lg font-bold text-[#145343] dark:text-emerald-400 font-mono tabular-nums mt-0.5">
                {teacherUtilizationPct}%
                <span className="text-xs font-normal text-stone-500 dark:text-slate-400">
                  {' '}· {activeTeachersCount}/{teachers.length}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-slate-400">
              <span>কারিকুলাম সম্পন্ন: {Math.round((totalScheduledPeriods / (totalRequiredPeriods || 1)) * 100)}%</span>
              <span className="font-mono tabular-nums">খালি: {remainingUnassignedSlots}</span>
            </div>
            <div className="w-full bg-stone-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[#145343] dark:bg-emerald-500 h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (totalScheduledPeriods / (totalRequiredPeriods || 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        /* Desktop Summary Card: Total Weekly Periods, Teacher Utilization %, and Remaining Unassigned Slots */
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-[#145343] dark:text-emerald-400" />
                <span>School Schedule Overview</span>
              </h2>
              <p className="text-xs text-stone-500 dark:text-slate-400 mt-0.5">
                Live capacity and scheduling metrics across all {classes.length} classes and {teachers.length} faculty members.
              </p>
            </div>
            <div className="text-xs text-stone-500 dark:text-slate-400 font-medium">
              {allSections.length} sections · {workingDays.length} working days/week
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Card 1: Total Weekly Periods */}
            <div className="p-4 rounded-xl bg-[#f7f5f0] dark:bg-slate-800/40 border border-stone-200/80 dark:border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                  Total Weekly Periods
                </span>
                <div className="p-1.5 rounded-lg bg-[#eef5f2] dark:bg-emerald-950/60 text-[#145343] dark:text-emerald-300">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-stone-900 dark:text-white tabular-nums tracking-tight">
                  {totalScheduledPeriods}
                </div>
                <div className="text-xs text-stone-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                  <span>Curriculum target: <strong className="font-semibold text-stone-700 dark:text-slate-300">{totalRequiredPeriods}</strong></span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-stone-200/60 dark:border-slate-700/50">
                <div className="flex items-center justify-between text-[11px] text-stone-500 mb-1">
                  <span>Target completion</span>
                  <span className="font-semibold tabular-nums text-stone-700 dark:text-slate-300">
                    {Math.round((totalScheduledPeriods / (totalRequiredPeriods || 1)) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-stone-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#145343] dark:bg-emerald-500 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (totalScheduledPeriods / (totalRequiredPeriods || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Card 2: Teacher Utilization Percentage */}
            <div className="p-4 rounded-xl bg-[#f7f5f0] dark:bg-slate-800/40 border border-stone-200/80 dark:border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                  Teacher Utilization
                </span>
                <div className="p-1.5 rounded-lg bg-teal-100/70 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight">
                  {teacherUtilizationPct}%
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  <span><strong className="font-semibold text-slate-700 dark:text-slate-300">{activeTeachersCount} of {teachers.length}</strong> teachers deployed</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/50">
                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                  <span>Faculty capacity load</span>
                  <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    {totalScheduledPeriods} / {totalTeacherCapacity} max
                  </span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      teacherUtilizationPct > 90
                        ? 'bg-amber-500'
                        : teacherUtilizationPct > 60
                        ? 'bg-[#145343] dark:bg-emerald-500'
                        : 'bg-emerald-600'
                    }`}
                    style={{ width: `${Math.min(100, teacherUtilizationPct)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Card 3: Remaining Unassigned Slots */}
            <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Remaining Unassigned Slots
                </span>
                <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                  <Layers className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight">
                  {remainingUnassignedSlots}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  <span>Open period slots in timetable grid</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/50">
                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                  <span>Available grid space</span>
                  <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    {Math.round((remainingUnassignedSlots / (totalPossibleSlots || 1)) * 100)}% free
                  </span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-500 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (remainingUnassignedSlots / (totalPossibleSlots || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controls: Day Selector & Pivot Mode */}
      <div className={`bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-800 ${isMobileView ? 'rounded-2xl p-3 space-y-2.5' : 'rounded-xl p-4 shadow-xs'}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Day Selector */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
            {!isMobileView && (
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2 shrink-0">
                Select Day:
              </span>
            )}
            {workingDays.map(day => {
              const label = isMobileView
                ? BENGALI_DAY_NAMES[day]?.replace('বার', '') || day.slice(0, 3)
                : day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={`${
                    isMobileView ? 'min-h-[36px] flex-1 px-2.5 py-1.5 rounded-xl' : 'px-3.5 py-1.5 rounded-lg'
                  } text-xs font-semibold transition-colors whitespace-nowrap ${
                    selectedDay === day
                      ? 'bg-[#145343] text-white'
                      : 'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 hover:bg-stone-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Pivot Toggle + Mobile Format Toggle */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-slate-800 rounded-lg border border-stone-200 dark:border-slate-700/80 shrink-0">
              <button
                type="button"
                onClick={() => setPivotMode('byClass')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  pivotMode === 'byClass'
                    ? 'bg-white dark:bg-slate-700 text-stone-900 dark:text-white shadow-2xs font-semibold'
                    : 'text-stone-600 dark:text-slate-400 hover:text-stone-900'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>{isMobileView ? 'সকল ক্লাস' : 'All Classes View'}</span>
              </button>
              <button
                type="button"
                onClick={() => setPivotMode('byTeacher')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  pivotMode === 'byTeacher'
                    ? 'bg-white dark:bg-slate-700 text-stone-900 dark:text-white shadow-2xs font-semibold'
                    : 'text-stone-600 dark:text-slate-400 hover:text-stone-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>{isMobileView ? 'সকল শিক্ষক' : 'All Teachers View'}</span>
              </button>
            </div>

            {isMobileView && (
              <div className="flex items-center p-0.5 bg-stone-100 dark:bg-slate-800 rounded-lg border border-stone-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setMobileMasterFormat('agenda')}
                  className={`p-1.5 rounded-md transition-colors ${
                    mobileMasterFormat === 'agenda'
                      ? 'bg-white dark:bg-slate-700 text-[#145343] dark:text-emerald-300 shadow-2xs'
                      : 'text-stone-500'
                  }`}
                  title="পিরিয়ড কার্ড"
                >
                  <LayoutList className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setMobileMasterFormat('grid')}
                  className={`p-1.5 rounded-md transition-colors ${
                    mobileMasterFormat === 'grid'
                      ? 'bg-white dark:bg-slate-700 text-[#145343] dark:text-emerald-300 shadow-2xs'
                      : 'text-stone-500'
                  }`}
                  title="পূর্ণ গ্রিড"
                >
                  <Grid3X3 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Period Explorer vs Desktop Grid Matrix */}
      {isMobileView && mobileMasterFormat === 'agenda' ? (
        <div className="space-y-3">
          {/* Period Chips */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-3 space-y-2">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              {activePeriods.map(p => {
                const active = activeMobilePeriod?.periodIndex === p.periodIndex;
                return (
                  <button
                    key={p.periodIndex}
                    type="button"
                    onClick={() => setSelectedMobilePeriod(p.periodIndex)}
                    className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${
                      active
                        ? 'bg-[#145343] text-white'
                        : 'bg-[#f7f5f0] dark:bg-slate-800 text-stone-700 dark:text-slate-300'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {activeMobilePeriod && (
              <div className="flex items-center justify-between text-xs text-stone-500 dark:text-slate-400 pt-1 border-t border-stone-100 dark:border-slate-800/80">
                <span className="font-semibold text-stone-800 dark:text-slate-200">
                  {BENGALI_DAY_NAMES[selectedDay] || selectedDay} · {activeMobilePeriod.label}
                </span>
                <span className="font-mono tabular-nums">
                  {activeMobilePeriod.startTime} – {activeMobilePeriod.endTime}
                </span>
              </div>
            )}
          </div>

          {/* Selected Period Cards */}
          {activeMobilePeriod && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 divide-y divide-stone-100 dark:divide-slate-800 overflow-hidden">
              {pivotMode === 'byClass'
                ? allSections.map(({ classObj, sectionId, sectionName }) => {
                    const isDismissed = isSlotDismissed(
                      classObj,
                      selectedDay,
                      activeMobilePeriod.periodIndex,
                      sectionId,
                      workingDays
                    );
                    const matches =
                      sectionSlotMap.get(
                        `${classObj.id}_${sectionId}_${activeMobilePeriod.periodIndex}`
                      ) || [];

                    const classTeacherId = classObj.sections.find(s => s.id === sectionId)?.classTeacherId;
                    const classTeacher = classTeacherId ? teacherMap.get(classTeacherId) : undefined;

                    return (
                      <div
                        key={`${classObj.id}-${sectionId}`}
                        onClick={() => {
                          if (!readOnly && !isDismissed) {
                            onOpenEditSlot(classObj.id, sectionId, selectedDay, activeMobilePeriod.periodIndex);
                          }
                        }}
                        className={`px-3.5 py-3 flex items-center justify-between gap-3 ${
                          !readOnly && !isDismissed ? 'cursor-pointer active:bg-stone-50 dark:active:bg-slate-800/60' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-[#145343] dark:text-emerald-400 truncate">
                            {classObj.name} · {sectionName}
                          </div>
                          {classTeacher && (
                            <div className="text-[11px] text-stone-500 dark:text-slate-400 truncate mt-0.5">
                              শ্রেণি শিক্ষক: {classTeacher.name} ({classTeacher.initials})
                            </div>
                          )}
                          {isDismissed ? (
                            <div className="text-xs text-stone-400 mt-0.5">ছুটি (Class Off)</div>
                          ) : matches.length === 0 ? (
                            <div className="text-xs text-stone-400 mt-0.5">
                              {readOnly ? 'নির্ধারিত নেই' : '+ ক্লাস যোগ করুন'}
                            </div>
                          ) : (
                            <div className="mt-0.5 space-y-0.5">
                              {matches.map(m => {
                                const sub = subjectMap.get(m.subjectId);
                                const tch = teacherMap.get(m.teacherId);
                                return (
                                  <div key={m.id} className="flex items-center gap-1.5 text-sm font-bold text-stone-900 dark:text-white truncate">
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: sub?.color || '#145343' }}
                                    />
                                    <span className="truncate">{sub?.name || 'Class'}</span>
                                    <span className="text-xs font-normal text-stone-500 dark:text-slate-400 shrink-0">
                                      · {tch?.initials || tch?.name || '—'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                : teachers.map(teacher => {
                    const match = teacherPeriodMap.get(
                      `${teacher.id}_${activeMobilePeriod.periodIndex}`
                    );
                    const cls = match ? classMap.get(match.classId) : null;
                    const sec = cls?.sections.find(s => s.id === match?.sectionId);
                    const sub = match ? subjectMap.get(match.subjectId) : null;

                    return (
                      <div
                        key={teacher.id}
                        onClick={() => {
                          if (!readOnly && match) {
                            onOpenEditSlot(match.classId, match.sectionId, selectedDay, activeMobilePeriod.periodIndex);
                          }
                        }}
                        className={`px-3.5 py-3 flex items-center justify-between gap-3 ${
                          !readOnly && match ? 'cursor-pointer active:bg-stone-50 dark:active:bg-slate-800/60' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-stone-900 dark:text-white truncate">
                            {teacher.name}{' '}
                            <span className="text-xs font-mono font-normal text-stone-400">
                              ({teacher.initials})
                            </span>
                          </div>
                          {match ? (
                            <div className="text-xs text-[#145343] dark:text-emerald-400 font-medium truncate mt-0.5">
                              {cls?.name} · {sec?.name} — {sub?.name}
                            </div>
                          ) : (
                            <div className="text-xs text-stone-400 mt-0.5">ফ্রি পিরিয়ড</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </div>
          )}
        </div>
      ) : (
      /* Grid Display */
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {pivotMode === 'byClass' ? 'School-Wide Class Matrix' : 'School-Wide Teacher Matrix'} · {selectedDay}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Live overview of all ongoing classes and assignments across the school on {selectedDay}.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            {pivotMode === 'byClass' ? `${allSections.length} sections` : `${teachers.length} teachers`}
          </span>
        </div>

        <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
          <table className="w-full text-left border-collapse table-fixed">
            <thead className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <th className={`py-2.5 px-3 font-bold uppercase tracking-wider shrink-0 bg-slate-100 dark:bg-slate-800 ${pivotMode === 'byClass' ? 'w-44' : 'w-36'}`}>
                  {pivotMode === 'byClass' ? 'Class & Sec' : 'Teacher'}
                </th>
                {allDisplayPeriods.map(p => {
                  const isBreak = p.isBreak || p.isLocked;
                  return (
                    <th
                      key={p.periodIndex}
                      className={`py-2.5 px-1.5 font-semibold text-center ${
                        isBreak
                          ? 'w-24 bg-amber-50/70 dark:bg-amber-950/30 border-x border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200'
                          : 'min-w-[100px]'
                      }`}
                    >
                      <div className="text-slate-900 dark:text-white font-bold text-xs truncate">
                        {isBreak ? '☕ টিফিন 🔒' : p.label}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono tabular-nums opacity-75">
                        {p.startTime} - {p.endTime}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
              {pivotMode === 'byClass'
                ? allSections.map(({ classObj, sectionId, sectionName }) => {
                    const secObj = classObj.sections.find(s => s.id === sectionId);
                    const classTeacher = secObj?.classTeacherId
                      ? teacherMap.get(secObj.classTeacherId)
                      : undefined;
                    return (
                      <tr
                        key={`${classObj.id}-${sectionId}`}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="py-2 px-3 bg-slate-50/50 dark:bg-slate-800/20 border-r border-slate-200 dark:border-slate-800">
                          <div className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">
                            {classObj.name} - {sectionName}
                          </div>
                          {classTeacher && (
                            <div className="text-[10px] font-medium text-[#145343] dark:text-emerald-400 truncate mt-0.5">
                              CT: {classTeacher.name} ({classTeacher.initials})
                            </div>
                          )}
                        </td>

                        {allDisplayPeriods.map(period => {
                          const isBreak = period.isBreak || period.isLocked;
                          const isDismissed = isSlotDismissed(classObj, selectedDay, period.periodIndex, sectionId, workingDays);

                          if (isBreak) {
                            return (
                              <td
                                key={period.periodIndex}
                                className="p-0.5 border-r border-amber-200/50 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 text-center"
                              >
                                <div className="h-11 rounded border border-dashed border-amber-200 dark:border-amber-800/60 flex flex-col items-center justify-center text-amber-700 dark:text-amber-300 cursor-not-allowed select-none text-[10px]">
                                  <span className="font-semibold">☕ টিফিন</span>
                                  <span className="text-[8px] opacity-75">লক 🔒</span>
                                </div>
                              </td>
                            );
                          }

                          if (isDismissed) {
                            return (
                              <td
                                key={period.periodIndex}
                                className="p-0.5 border-r border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/30 text-center"
                              >
                                <div className="h-11 rounded border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-slate-400 select-none text-[10px]">
                                  <span className="font-semibold">🏠 ছুটি</span>
                                  <span className="text-[8px]">Off</span>
                                </div>
                              </td>
                            );
                          }

                          const matches =
                            sectionSlotMap.get(`${classObj.id}_${sectionId}_${period.periodIndex}`) || [];

                          return (
                            <td
                              key={period.periodIndex}
                              className="p-0.5 border-r border-slate-100 dark:border-slate-800/60 last:border-r-0 text-center"
                            >
                              {matches.length === 1 ? (
                                (() => {
                                  const match = matches[0];
                                  const sub = subjectMap.get(match.subjectId);
                                  const tch = teacherMap.get(match.teacherId);
                                  return (
                                    <div
                                      onClick={() => {
                                        if (!readOnly) {
                                          onOpenEditSlot(classObj.id, sectionId, selectedDay, period.periodIndex);
                                        }
                                      }}
                                      className={`p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-left transition-all h-11 flex flex-col justify-between ${
                                        readOnly ? 'cursor-default' : 'hover:border-[#145343] dark:hover:border-emerald-500 cursor-pointer'
                                      }`}
                                    >
                                      <div className="font-semibold text-[11px] text-slate-800 dark:text-slate-200 truncate flex items-center gap-1">
                                        <span
                                          className="w-1.5 h-1.5 rounded-full shrink-0"
                                          style={{ backgroundColor: sub?.color || '#145343' }}
                                        />
                                        <span className="truncate">{sub?.name || 'Class'}</span>
                                      </div>
                                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-medium">
                                        {tch?.initials ? `${tch.name} (${tch.initials})` : tch?.name}
                                      </div>
                                    </div>
                                  );
                                })()
                              ) : matches.length > 1 ? (
                                <div
                                  onClick={() => {
                                    if (!readOnly) {
                                      onOpenEditSlot(classObj.id, sectionId, selectedDay, period.periodIndex);
                                    }
                                  }}
                                  className={`p-1 rounded-md border border-[#bfd5cc] dark:border-emerald-800 bg-[#eef5f2]/70 dark:bg-emerald-950/30 text-left transition-all min-h-11 flex flex-col justify-center gap-0.5 ${
                                    readOnly ? 'cursor-default' : 'hover:border-[#145343] dark:hover:border-emerald-500 cursor-pointer'
                                  }`}
                                >
                                  {matches.map(m => {
                                    const sub = subjectMap.get(m.subjectId);
                                    const tch = teacherMap.get(m.teacherId);
                                    return (
                                      <div key={m.id} className="flex items-center justify-between gap-1 text-[9.5px] leading-tight truncate">
                                        <span className="font-bold text-slate-800 dark:text-slate-100 truncate">
                                          {sub?.code || sub?.name}
                                        </span>
                                        <span className="text-slate-500 dark:text-slate-400 shrink-0">
                                          ({tch?.initials || '—'})
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : readOnly ? (
                                <div className="h-11 rounded border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-700 text-[10px]">
                                  —
                                </div>
                              ) : (
                                <div
                                  onClick={() =>
                                    onOpenEditSlot(classObj.id, sectionId, selectedDay, period.periodIndex)
                                  }
                                  className="h-11 rounded border border-dashed border-slate-200 dark:border-slate-800 hover:border-[#145343] dark:hover:border-emerald-500 flex items-center justify-center text-slate-300 dark:text-slate-700 cursor-pointer text-[10px]"
                                >
                                  +
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                : teachers.map(teacher => {
                    return (
                      <tr
                        key={teacher.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="py-2 px-3 font-bold text-xs text-slate-900 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-800/20 border-r border-slate-200 dark:border-slate-800 whitespace-nowrap truncate">
                          <div>{teacher.name}</div>
                          <div className="text-[10px] text-slate-400 font-normal">{teacher.initials}</div>
                        </td>

                        {allDisplayPeriods.map(period => {
                          const isBreak = period.isBreak || period.isLocked;

                          if (isBreak) {
                            return (
                              <td
                                key={period.periodIndex}
                                className="p-0.5 border-r border-amber-200/50 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 text-center"
                              >
                                <div className="h-11 rounded border border-dashed border-amber-200 dark:border-amber-800/60 flex flex-col items-center justify-center text-amber-700 dark:text-amber-300 cursor-not-allowed select-none text-[10px]">
                                  <span className="font-semibold">☕ টিফিন</span>
                                  <span className="text-[8px] opacity-75">লক 🔒</span>
                                </div>
                              </td>
                            );
                          }

                          const match = teacherPeriodMap.get(`${teacher.id}_${period.periodIndex}`);
                          const cls = match ? classMap.get(match.classId) : null;
                          const sec = cls?.sections.find(s => s.id === match?.sectionId);
                          const sub = match ? subjectMap.get(match.subjectId) : null;

                          return (
                            <td
                              key={period.periodIndex}
                              className="p-0.5 border-r border-slate-100 dark:border-slate-800/60 last:border-r-0 text-center"
                            >
                              {match ? (
                                <div
                                  onClick={() => {
                                    if (!readOnly) {
                                      onOpenEditSlot(match.classId, match.sectionId, selectedDay, period.periodIndex);
                                    }
                                  }}
                                  className={`p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-left transition-all h-11 flex flex-col justify-between ${
                                    readOnly ? 'cursor-default' : 'hover:border-[#145343] dark:hover:border-emerald-500 cursor-pointer'
                                  }`}
                                >
                                  <div className="font-semibold text-[10px] text-[#145343] dark:text-emerald-300 truncate">
                                    {cls?.name} · {sec?.name}
                                  </div>
                                  <div className="text-[10px] text-slate-600 dark:text-slate-400 truncate">
                                    {sub?.name}
                                  </div>
                                </div>
                              ) : (
                                <div className="h-11 flex items-center justify-center text-slate-300 dark:text-slate-700 text-[10px]">
                                  —
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
};
