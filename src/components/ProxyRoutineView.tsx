import React, { useState, useMemo } from 'react';
import { DayOfWeek, PeriodTiming, SchoolClass, SchoolSettings, Subject, Teacher, TimetableEntry } from '../types';
import {
  ProxyAssignment,
  ProxyPlanResult,
  generateDailyProxyPlan,
  isEligibleForProxy,
} from '../services/proxyGenerator';
import { exportProxyDocx, exportProxyPdf } from '../services/exportProxyDoc';
import { useViewMode } from '../context/ViewModeContext';
import { BENGALI_DAY_NAMES } from '../services/scheduleTiers';
import {
  UserMinus,
  FileCheck,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface ProxyRoutineViewProps {
  settings: SchoolSettings;
  teachers: Teacher[];
  classes: SchoolClass[];
  subjects: Subject[];
  periodTimings: PeriodTiming[];
  entries: TimetableEntry[];
}

export const ProxyRoutineView: React.FC<ProxyRoutineViewProps> = ({
  settings,
  teachers,
  classes,
  subjects,
  periodTimings,
  entries,
}) => {
  const { isMobileView } = useViewMode();
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(() => {
    const todayMap: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = todayMap[new Date().getDay()];
    return settings.workingDays.includes(today) ? today : settings.workingDays[0] || 'Sunday';
  });
  const [absentTeacherIds, setAbsentTeacherIds] = useState<string[]>([
    teachers[0]?.id || '', // Default pre-select 1 absent teacher so the user immediately sees working proxy plan!
  ]);
  const [customAssignments, setCustomAssignments] = useState<ProxyAssignment[] | null>(null);

  const teacherMap = useMemo(() => new Map(teachers.map(t => [t.id, t])), [teachers]);
  const subjectMap = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects]);

  // Compute automated proxy plan
  const autoPlan: ProxyPlanResult = useMemo(() => {
    return generateDailyProxyPlan(
      selectedDay,
      absentTeacherIds,
      entries,
      teachers,
      classes,
      subjects,
      periodTimings
    );
  }, [selectedDay, absentTeacherIds, entries, teachers, classes, subjects, periodTimings]);

  // Active assignments (either auto or user-modified)
  const activeAssignments = customAssignments || autoPlan.assignments;

  // Toggle absent teacher
  const toggleAbsentTeacher = (teacherId: string) => {
    setCustomAssignments(null); // Reset manual changes on teacher set change
    if (absentTeacherIds.includes(teacherId)) {
      setAbsentTeacherIds(absentTeacherIds.filter(id => id !== teacherId));
    } else {
      setAbsentTeacherIds([...absentTeacherIds, teacherId]);
    }
  };

  // Manually override substitute teacher for a slot
  const handleManualSubstituteChange = (assignmentId: string, substituteTeacherId: string) => {
    const substituteTeacher = teacherMap.get(substituteTeacherId);
    const updated = activeAssignments.map(a => {
      if (a.id === assignmentId) {
        return {
          ...a,
          substituteTeacherId,
          substituteTeacherName: substituteTeacher?.name || 'Unassigned',
          matchType: 'manual' as const,
          matchReason: 'Manually Assigned by Admin',
          status: substituteTeacherId ? ('assigned' as const) : ('unassigned' as const),
        };
      }
      return a;
    });
    setCustomAssignments(updated);
  };

  // Re-generate auto plan
  const handleRegenerate = () => {
    setCustomAssignments(null);
  };

  const assignedCount = activeAssignments.filter(a => a.status === 'assigned').length;
  const unassignedCount = activeAssignments.filter(a => a.status === 'unassigned').length;

  return (
    <div className={isMobileView ? 'space-y-3.5' : 'space-y-6'}>
      {isMobileView ? (
        <>
          {/* Compact Mobile Header & Day Picker */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 shrink-0">
                  <UserMinus className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-stone-900 dark:text-white truncate">
                    দৈনিক প্রক্সি ও বদলি রুটিন
                  </h2>
                  <p className="text-[11px] text-stone-500 dark:text-slate-400 truncate">
                    কো-অর্ডিনেটর ও ব্লক শিক্ষক প্রক্সি মুক্ত
                  </p>
                </div>
              </div>
            </div>

            {/* Day Horizontal Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
              {settings.workingDays.map(day => {
                const shortBn = BENGALI_DAY_NAMES[day]?.replace('বার', '') || day.slice(0, 3);
                const active = selectedDay === day;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      setSelectedDay(day);
                      setCustomAssignments(null);
                    }}
                    className={`min-h-[36px] flex-1 px-2.5 py-1.5 text-xs font-bold rounded-xl transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#145343] text-white'
                        : 'bg-[#f7f5f0] dark:bg-slate-800 text-stone-700 dark:text-slate-300'
                    }`}
                  >
                    {shortBn}
                  </button>
                );
              })}
            </div>

            {/* Export Row */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-stone-100 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() =>
                  exportProxyDocx(
                    {
                      day: selectedDay,
                      absentTeacherIds,
                      totalAbsentClasses: activeAssignments.length,
                      assignedCount,
                      unassignedCount,
                      assignments: activeAssignments,
                    },
                    settings,
                    teachers
                  )
                }
                className="min-h-[40px] px-3 py-2 text-xs font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 rounded-xl flex items-center justify-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5 text-[#145343] dark:text-emerald-400" />
                <span>Word (.docx)</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  exportProxyPdf(
                    {
                      day: selectedDay,
                      absentTeacherIds,
                      totalAbsentClasses: activeAssignments.length,
                      assignedCount,
                      unassignedCount,
                      assignments: activeAssignments,
                    },
                    settings,
                    teachers
                  )
                }
                className="min-h-[40px] px-3 py-2 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-xl flex items-center justify-center gap-1.5"
              >
                <FileCheck className="w-3.5 h-3.5" />
                <span>Proxy PDF</span>
              </button>
            </div>
          </div>

          {/* Mobile 2-Col Absent Teacher Touch Grid */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-stone-800 dark:text-slate-200">
                অনুপস্থিত শিক্ষক ({BENGALI_DAY_NAMES[selectedDay] || selectedDay})
              </h3>
              {absentTeacherIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAbsentTeacherIds([]);
                    setCustomAssignments(null);
                  }}
                  className="text-xs font-semibold text-rose-600 dark:text-rose-400"
                >
                  সব মুছুন
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {teachers.map(teacher => {
                const isAbsent = absentTeacherIds.includes(teacher.id);
                const dayClassCount = entries.filter(
                  e => e.day === selectedDay && e.teacherId === teacher.id
                ).length;

                return (
                  <button
                    key={teacher.id}
                    type="button"
                    onClick={() => toggleAbsentTeacher(teacher.id)}
                    className={`min-h-[46px] px-3 py-2 rounded-xl border text-left transition-colors flex flex-col justify-center ${
                      isAbsent
                        ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-400 dark:border-rose-700 text-rose-900 dark:text-rose-100'
                        : 'bg-[#f7f5f0] dark:bg-slate-800/60 border-stone-200 dark:border-slate-700 text-stone-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-bold truncate">{teacher.name}</div>
                    <div
                      className={`text-[10px] font-mono tabular-nums truncate ${
                        isAbsent ? 'text-rose-700 dark:text-rose-300 font-semibold' : 'text-stone-500 dark:text-slate-400'
                      }`}
                    >
                      {teacher.initials} · {dayClassCount} ক্লাস{isAbsent ? ' · অনুপস্থিত' : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mobile Compact 3-Col KPI Strip */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-stone-200 dark:border-slate-800 text-center">
              <div className="text-[10px] font-semibold text-stone-500 dark:text-slate-400">মোট ক্লাস</div>
              <div className="text-lg font-bold text-stone-900 dark:text-white font-mono tabular-nums mt-0.5">
                {activeAssignments.length}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-stone-200 dark:border-slate-800 text-center">
              <div className="text-[10px] font-semibold text-stone-500 dark:text-slate-400">নির্ধারিত</div>
              <div className="text-lg font-bold text-[#145343] dark:text-emerald-400 font-mono tabular-nums mt-0.5">
                {assignedCount}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-stone-200 dark:border-slate-800 text-center">
              <div className="text-[10px] font-semibold text-stone-500 dark:text-slate-400">বাকি আছে</div>
              <div
                className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${
                  unassignedCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-stone-400'
                }`}
              >
                {unassignedCount}
              </div>
            </div>
          </div>

          {/* Mobile Vertical Proxy Assignment Cards */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 overflow-hidden">
            <div className="px-3.5 py-3 border-b border-stone-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-stone-900 dark:text-white">
                বদলি শিক্ষক তালিকা ({BENGALI_DAY_NAMES[selectedDay] || selectedDay})
              </h3>
              <button
                type="button"
                onClick={handleRegenerate}
                className="min-h-[34px] px-2.5 py-1 text-xs font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/60 rounded-lg flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>অটো ম্যাচ</span>
              </button>
            </div>

            {activeAssignments.length === 0 ? (
              <div className="p-8 text-center text-stone-500 dark:text-slate-400">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <div className="text-sm font-bold text-stone-800 dark:text-slate-200">
                  কোনো প্রক্সি ক্লাসের প্রয়োজন নেই
                </div>
                <p className="text-xs text-stone-400 mt-1">
                  উপরের তালিকা থেকে অনুপস্থিত শিক্ষক নির্বাচন করুন।
                </p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-slate-800">
                {activeAssignments.map(assignment => {
                  const availableFreeTeachers = teachers.filter(t => {
                    if (absentTeacherIds.includes(t.id)) return false;
                    if (!isEligibleForProxy(t, classes)) return false;
                    const hasClass = entries.some(
                      e => e.day === selectedDay && e.periodIndex === assignment.periodIndex && e.teacherId === t.id
                    );
                    return !hasClass;
                  });

                  return (
                    <div
                      key={assignment.id}
                      className={`p-3.5 space-y-2.5 ${
                        assignment.status === 'unassigned' ? 'bg-rose-50/40 dark:bg-rose-950/20' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-stone-900 dark:text-white">
                          {assignment.periodLabel} ·{' '}
                          <span className="font-mono font-normal text-stone-500 dark:text-slate-400 tabular-nums">
                            {assignment.periodTime}
                          </span>
                        </span>
                        <span className="font-bold text-[#145343] dark:text-emerald-400 truncate">
                          {assignment.className} · {assignment.sectionName}
                          {assignment.room ? ` (${assignment.room})` : ''}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: assignment.subjectColor }}
                          />
                          <span className="font-semibold text-stone-800 dark:text-slate-200 truncate">
                            {assignment.subjectName}
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-rose-700 dark:text-rose-400 shrink-0 truncate">
                          অনুপস্থিত: {assignment.absentTeacherName}
                        </span>
                      </div>

                      <select
                        value={assignment.substituteTeacherId}
                        onChange={e => handleManualSubstituteChange(assignment.id, e.target.value)}
                        className={`w-full min-h-[44px] py-2 px-3 text-xs rounded-xl border font-semibold focus:outline-none focus:ring-1 focus:ring-[#145343] ${
                          assignment.status === 'assigned'
                            ? 'bg-[#eef5f2]/70 dark:bg-emerald-950/40 border-[#bfd5cc] dark:border-emerald-800 text-stone-900 dark:text-emerald-100'
                            : 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                        }`}
                      >
                        <option value="">— বদলি শিক্ষক নির্বাচন করুন —</option>
                        {availableFreeTeachers.map(t => {
                          const isSameSubject = t.subjectIds.includes(assignment.subjectId);
                          return (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.initials}) {isSameSubject ? '★ একই বিষয়' : '· ফ্রি'}
                            </option>
                          );
                        })}
                      </select>

                      <div className="text-[11px] text-stone-500 dark:text-slate-400">
                        {assignment.matchReason}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Top Header Card */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                    <UserMinus className="w-4 h-4" />
                  </span>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Daily Proxy & Substitute Class Routine (দৈনিক বদলি / প্রক্সি ক্লাস)
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Select one or multiple absent teachers for any day. The system automatically assigns free teachers prioritizing same-subject specialists and department peers.
                </p>
                <div className="mt-2 inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  <span>🛡️ প্রক্সি মুক্ত (Exempted):</span>
                  <span>
                    কো-অর্ডিনেটর, প্লে/নার্সারির ব্লক টিচার এবং মোয়াজ্জেম স্যারকে প্রক্সি ক্লাস দেওয়া যাবে না
                    {(() => {
                      const exempted = teachers.filter(t => !isEligibleForProxy(t, classes));
                      return exempted.length > 0
                        ? ` (${exempted.map(t => t.initials || t.name).join(', ')})`
                        : '';
                    })()}
                    ।
                  </span>
                </div>
              </div>

              {/* Action Export Buttons */}
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <button
                  onClick={() =>
                    exportProxyDocx(
                      {
                        day: selectedDay,
                        absentTeacherIds,
                        totalAbsentClasses: activeAssignments.length,
                        assignedCount,
                        unassignedCount,
                        assignments: activeAssignments,
                      },
                      settings,
                      teachers
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>Proxy Word (.docx)</span>
                </button>

                <button
                  onClick={() =>
                    exportProxyPdf(
                      {
                        day: selectedDay,
                        absentTeacherIds,
                        totalAbsentClasses: activeAssignments.length,
                        assignedCount,
                        unassignedCount,
                        assignments: activeAssignments,
                      },
                      settings,
                      teachers
                    )
                  }
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs"
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Download Proxy PDF</span>
                </button>
              </div>
            </div>

            {/* Day Selector */}
            <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2 shrink-0">
                  Select Day:
                </span>
                {settings.workingDays.map(day => (
                  <button
                    key={day}
                    onClick={() => {
                      setSelectedDay(day);
                      setCustomAssignments(null);
                    }}
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

              <div className="text-xs text-slate-500">
                School: <strong className="text-slate-700 dark:text-slate-300">{settings.schoolName}</strong>
              </div>
            </div>
          </div>

          {/* Absent Teachers Selection Strip */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <span>Select Absent Teacher(s) on {selectedDay} (অনুপস্থিত শিক্ষক নির্বাচন করুন)</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Click any teacher to toggle their absent status for today. Multiple teachers can be absent simultaneously.
                </p>
              </div>
              {absentTeacherIds.length > 0 && (
                <button
                  onClick={() => {
                    setAbsentTeacherIds([]);
                    setCustomAssignments(null);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  Clear Absentees
                </button>
              )}
            </div>

            {/* Teachers Badges */}
            <div className="flex flex-wrap gap-2">
              {teachers.map(teacher => {
                const isAbsent = absentTeacherIds.includes(teacher.id);
                // Count how many classes this teacher has on this day
                const dayClassCount = entries.filter(
                  e => e.day === selectedDay && e.teacherId === teacher.id
                ).length;

                return (
                  <button
                    key={teacher.id}
                    onClick={() => toggleAbsentTeacher(teacher.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-2 ${
                      isAbsent
                        ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 ring-1 ring-rose-400'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isAbsent ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    />
                    <span className="font-semibold">{teacher.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        isAbsent
                          ? 'bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-100'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {dayClassCount} {dayClassCount === 1 ? 'class' : 'classes'}
                    </span>
                    {isAbsent && <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300">[ABSENT]</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Classes Needing Proxy
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                  {activeAssignments.length}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
                <Clock className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Proxy Assigned
                </div>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
                  {assignedCount}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Unassigned Slots
                </div>
                <div className={`text-2xl font-bold tabular-nums mt-1 ${unassignedCount > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                  {unassignedCount}
                </div>
              </div>
              <div className={`p-2.5 rounded-xl ${unassignedCount > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400'}`}>
                <AlertCircle className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Proxy Routine Schedule Table */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Generated Proxy Schedule for {selectedDay}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review substitute teachers matched for absent faculty. You can click any substitute to manually reassign.
                </p>
              </div>
              <button
                onClick={handleRegenerate}
                className="px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 rounded-lg flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Auto Match</span>
              </button>
            </div>

            {activeAssignments.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  No Proxy Classes Needed!
                </h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  Select one or more absent teachers from above to immediately generate proxy assignments for {selectedDay}.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                      <th className="py-3 px-4 font-semibold">Period & Time</th>
                      <th className="py-3 px-4 font-semibold">Class & Section</th>
                      <th className="py-3 px-4 font-semibold">Subject</th>
                      <th className="py-3 px-4 font-semibold">Absent Teacher</th>
                      <th className="py-3 px-4 font-semibold">Assigned Substitute</th>
                      <th className="py-3 px-4 font-semibold">Match Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                    {activeAssignments.map(assignment => {
                      // Find all teachers free at this exact period on this day (Strictly excluding Coordinators and Block Teachers)
                      const availableFreeTeachers = teachers.filter(t => {
                        if (absentTeacherIds.includes(t.id)) return false;
                        if (!isEligibleForProxy(t, classes)) return false;
                        const hasClass = entries.some(
                          e => e.day === selectedDay && e.periodIndex === assignment.periodIndex && e.teacherId === t.id
                        );
                        return !hasClass;
                      });

                      return (
                        <tr
                          key={assignment.id}
                          className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                            assignment.status === 'unassigned' ? 'bg-rose-50/40 dark:bg-rose-950/20' : ''
                          }`}
                        >
                          {/* Period & Time */}
                          <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            <div>{assignment.periodLabel}</div>
                            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                              {assignment.periodTime}
                            </div>
                          </td>

                          {/* Class & Section */}
                          <td className="py-3 px-4 font-bold text-blue-700 dark:text-blue-400 whitespace-nowrap">
                            <span>{assignment.className}</span>{' '}
                            <span className="text-slate-600 dark:text-slate-300 font-normal">
                              ({assignment.sectionName})
                            </span>
                            {assignment.room && (
                              <div className="text-[10px] text-slate-400 font-normal">
                                {assignment.room}
                              </div>
                            )}
                          </td>

                          {/* Subject */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: assignment.subjectColor }}
                              />
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {assignment.subjectName}
                              </span>
                            </div>
                          </td>

                          {/* Absent Teacher */}
                          <td className="py-3 px-4 text-rose-700 dark:text-rose-400 font-medium">
                            {assignment.absentTeacherName}
                          </td>

                          {/* Assigned Substitute Teacher (Interactive dropdown) */}
                          <td className="py-3 px-4">
                            <select
                              value={assignment.substituteTeacherId}
                              onChange={e => handleManualSubstituteChange(assignment.id, e.target.value)}
                              className={`w-full max-w-xs py-1.5 px-2.5 text-xs rounded-lg border font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                assignment.status === 'assigned'
                                  ? 'bg-blue-50/60 dark:bg-blue-950/50 border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-100'
                                  : 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                              }`}
                            >
                              <option value="">— Select Substitute —</option>
                              {availableFreeTeachers.map(t => {
                                const isSameSubject = t.subjectIds.includes(assignment.subjectId);
                                return (
                                  <option key={t.id} value={t.id}>
                                    {t.name} ({t.initials}) {isSameSubject ? '★ Same Subject' : '✓ Free'}
                                  </option>
                                );
                              })}
                            </select>
                          </td>

                          {/* Match Reason Tag */}
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                assignment.matchType === 'same_subject'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                                  : assignment.matchType === 'same_department'
                                  ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
                                  : assignment.matchType === 'manual'
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {assignment.matchReason}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
