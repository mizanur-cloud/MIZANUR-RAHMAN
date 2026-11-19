import React, { useState, useMemo } from 'react';
import { DayOfWeek, PeriodTiming, SchoolClass, SchoolSettings, Subject, Teacher, TimetableEntry } from '../types';
import {
  ProxyAssignment,
  ProxyPlanResult,
  generateDailyProxyPlan,
  isEligibleForProxy,
} from '../services/proxyGenerator';
import { exportProxyDocx, exportProxyPdf } from '../services/exportProxyDoc';
import {
  UserMinus,
  Sparkles,
  FileCheck,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Search,
  School,
  Printer,
  ChevronDown,
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
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(settings.workingDays[0] || 'Sunday');
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
    <div className="space-y-6">
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
    </div>
  );
};
