import React, { useState } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  SchoolClass,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import { Grid3X3, Users, BookOpen, Layers, Clock, TrendingUp, CalendarCheck } from 'lucide-react';
import { isSlotDismissed } from '../services/scheduleTiers';
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
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(workingDays[0] || 'Sunday');
  const [pivotMode, setPivotMode] = useState<'byClass' | 'byTeacher'>('byClass');

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const classMap = new Map(classes.map(c => [c.id, c]));

  const allDisplayPeriods = periodTimings;
  const activePeriods = periodTimings.filter(p => !p.isBreak && !p.isLocked);

  // Flatten all class sections
  const allSections: { classObj: SchoolClass; sectionId: string; sectionName: string }[] = [];
  classes.forEach(c => {
    c.sections.forEach(s => {
      allSections.push({ classObj: c, sectionId: s.id, sectionName: s.name });
    });
  });

  // Calculate curriculum required periods across all sections
  const totalRequiredPeriods = classes.reduce((classAcc, c) => {
    if (isPlayOrNursery(c)) {
      const openPeriods = activePeriods.filter(
        p => !isSlotDismissed(c, workingDays[0] || 'Sunday', p.periodIndex, c.sections[0]?.id, workingDays)
      ).length;
      return classAcc + openPeriods * workingDays.length * c.sections.length;
    }
    const classReq = c.subjectRequirements.reduce((rAcc, req) => rAcc + req.periodsPerWeek, 0);
    return classAcc + classReq * c.sections.length;
  }, 0);

  // Total possible timetable slots in school grid
  const totalPossibleSlots = allSections.length * workingDays.length * activePeriods.length;

  // Total scheduled periods
  const totalScheduledPeriods = entries.length;

  // Remaining unassigned slots in matrix
  const remainingUnassignedSlots = Math.max(0, totalPossibleSlots - totalScheduledPeriods);

  // Teacher utilization percentage:
  // Each teacher has a standard weekly target capacity: (maxDailyPeriods || 4) * workingDays.length
  const totalTeacherCapacity = teachers.reduce((acc, t) => {
    const dailyCap = t.maxDailyPeriods || 4;
    return acc + dailyCap * workingDays.length;
  }, 0);

  const teacherUtilizationPct =
    totalTeacherCapacity > 0
      ? Math.min(100, Math.round((totalScheduledPeriods / totalTeacherCapacity) * 100))
      : 0;

  // Active teachers with at least 1 assigned class
  const activeTeachersCount = new Set(entries.map(e => e.teacherId)).size;

  return (
    <div className="space-y-6">
      {/* Dashboard Summary Card: Total Weekly Periods, Teacher Utilization %, and Remaining Unassigned Slots */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800/80">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-blue-600" />
              <span>School Schedule Overview</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live capacity and scheduling metrics across all {classes.length} classes and {teachers.length} faculty members.
            </p>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {allSections.length} sections · {workingDays.length} working days/week
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Card 1: Total Weekly Periods */}
          <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Weekly Periods
              </span>
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight">
                {totalScheduledPeriods}
              </div>
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                <span>Curriculum target: <strong className="font-semibold text-slate-700 dark:text-slate-300">{totalRequiredPeriods}</strong></span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/50">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                <span>Target completion</span>
                <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                  {Math.round((totalScheduledPeriods / (totalRequiredPeriods || 1)) * 100)}%
                </span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (totalScheduledPeriods / (totalRequiredPeriods || 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Card 2: Teacher Utilization Percentage */}
          <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Teacher Utilization
              </span>
              <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
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
                      ? 'bg-purple-600'
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

      {/* Controls: Day Selector & Pivot Mode */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Day Selector */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2 shrink-0">
              Select Day:
            </span>
            {workingDays.map(day => (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  selectedDay === day
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {day}
              </button>
            ))}
          </div>

          {/* Pivot Toggle: By Class vs By Teacher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700/80 shrink-0">
            <button
              onClick={() => setPivotMode('byClass')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                pivotMode === 'byClass'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>All Classes View</span>
            </button>
            <button
              onClick={() => setPivotMode('byTeacher')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                pivotMode === 'byTeacher'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>All Teachers View</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid Display */}
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
                <th className="py-2.5 px-3 font-bold uppercase tracking-wider w-32 shrink-0 bg-slate-100 dark:bg-slate-800">
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
                    const rowEntries = entries.filter(
                      e => e.day === selectedDay && e.classId === classObj.id && e.sectionId === sectionId
                    );
                    return (
                      <tr
                        key={`${classObj.id}-${sectionId}`}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="py-2 px-3 font-bold text-xs text-slate-900 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-800/20 border-r border-slate-200 dark:border-slate-800 whitespace-nowrap truncate">
                          {classObj.name} - {sectionName}
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

                          const matches = rowEntries.filter(e => e.periodIndex === period.periodIndex);

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
                                        readOnly ? 'cursor-default' : 'hover:border-blue-500 cursor-pointer'
                                      }`}
                                    >
                                      <div className="font-semibold text-[11px] text-slate-800 dark:text-slate-200 truncate flex items-center gap-1">
                                        <span
                                          className="w-1.5 h-1.5 rounded-full shrink-0"
                                          style={{ backgroundColor: sub?.color || '#3B82F6' }}
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
                                  className={`p-1 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 text-left transition-all min-h-11 flex flex-col justify-center gap-0.5 ${
                                    readOnly ? 'cursor-default' : 'hover:border-blue-500 cursor-pointer'
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
                                  className="h-11 rounded border border-dashed border-slate-200 dark:border-slate-800 hover:border-blue-400 flex items-center justify-center text-slate-300 dark:text-slate-700 cursor-pointer text-[10px]"
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
                    const rowEntries = entries.filter(
                      e => e.day === selectedDay && e.teacherId === teacher.id
                    );

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

                          const match = rowEntries.find(e => e.periodIndex === period.periodIndex);
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
                                    readOnly ? 'cursor-default' : 'hover:border-blue-500 cursor-pointer'
                                  }`}
                                >
                                  <div className="font-semibold text-[10px] text-blue-700 dark:text-blue-300 truncate">
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
    </div>
  );
};
