import React, { useState } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  RoutineConflict,
  SchoolClass,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import {
  Users,
  Search,
  FileText,
  FileCheck,
  Calendar,
  Grid3X3,
  List,
  AlertTriangle,
  Clock,
  Sparkles,
  Edit2,
  Trash2,
} from 'lucide-react';
import { exportAllTeachersDocx, exportTeacherDocx } from '../services/exportDocx';
import { exportAllTeachersPdf, exportTeacherPdf } from '../services/exportPdf';
import { AppState } from '../services/storage';

interface TeacherRoutineViewProps {
  teachers: Teacher[];
  selectedTeacherId: string;
  setSelectedTeacherId: (id: string) => void;
  classes: SchoolClass[];
  subjects: Subject[];
  workingDays: DayOfWeek[];
  periodTimings: PeriodTiming[];
  entries: TimetableEntry[];
  conflicts: RoutineConflict[];
  onOpenEditSlot: (classId: string, sectionId: string, day: DayOfWeek, periodIndex: number) => void;
  onClearSlot: (entryId: string) => void;
  fullAppState: AppState;
}

export const TeacherRoutineView: React.FC<TeacherRoutineViewProps> = ({
  teachers,
  selectedTeacherId,
  setSelectedTeacherId,
  classes,
  subjects,
  workingDays,
  periodTimings,
  entries,
  conflicts,
  onOpenEditSlot,
  onClearSlot,
  fullAppState,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  const selectedTeacher =
    teachers.find(t => t.id === selectedTeacherId) || teachers[0];

  const classMap = new Map(classes.map(c => [c.id, c]));
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const activePeriods = periodTimings.filter(p => !p.isBreak);

  // Filter teachers by search
  const filteredTeachers = teachers.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.initials.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Entries for selected teacher
  const teacherEntries = entries.filter(e => e.teacherId === selectedTeacher?.id);

  // Chronologically sort entries for table view (Day order then Period index)
  const dayOrder: Record<string, number> = {};
  workingDays.forEach((d, idx) => (dayOrder[d] = idx));

  const sortedEntries = [...teacherEntries].sort((a, b) => {
    const dDiff = (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99);
    if (dDiff !== 0) return dDiff;
    return a.periodIndex - b.periodIndex;
  });

  // Conflicts related to this teacher
  const teacherConflicts = conflicts.filter(
    c => c.teacherId === selectedTeacher?.id || c.entryIds.some(id => teacherEntries.some(e => e.id === id))
  );

  // Calculate daily workload distribution
  const dailyLoad: Record<string, number> = {};
  workingDays.forEach(d => {
    dailyLoad[d] = teacherEntries.filter(e => e.day === d).length;
  });

  return (
    <div className="space-y-6">
      {/* Top Controls: Teacher Selector & Mode Switch */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Teacher Selection Dropdown & Search */}
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search teacher by name or subject..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <select
              value={selectedTeacher?.id}
              onChange={e => setSelectedTeacherId(e.target.value)}
              className="py-2 px-3 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none font-medium"
            >
              {filteredTeachers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.initials})
                </option>
              ))}
            </select>
          </div>

          {/* View Toggle & Downloads */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* View Mode Buttons */}
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700/80">
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>Table View</span>
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                <span>Grid View</span>
              </button>
            </div>

            {/* Teacher Word Download */}
            <button
              onClick={() => {
                if (selectedTeacher) {
                  exportTeacherDocx(selectedTeacher.id, fullAppState);
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Download teacher routine in Word"
            >
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>Word (.docx)</span>
            </button>

            {/* Teacher PDF Download */}
            <button
              onClick={() => {
                if (selectedTeacher) {
                  exportTeacherPdf(selectedTeacher.id, fullAppState);
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Download teacher routine in PDF"
            >
              <FileCheck className="w-3.5 h-3.5 text-rose-600" />
              <span>PDF</span>
            </button>

            {/* Combined Download All */}
            <button
              onClick={() => exportAllTeachersDocx(fullAppState)}
              className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors flex items-center gap-1.5"
              title="Export all teachers' routines combined into one document"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>All Faculty Doc</span>
            </button>
          </div>
        </div>
      </div>

      {/* Selected Teacher Profile Card & Workload Metrics */}
      {selectedTeacher && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold flex items-center justify-center text-base border border-blue-200 dark:border-blue-800">
                {selectedTeacher.initials}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {selectedTeacher.name}
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {selectedTeacher.designation}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                  <span>Subjects:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {selectedTeacher.subjectIds
                      .map(sId => subjectMap.get(sId)?.name || sId)
                      .join(', ')}
                  </span>
                  <span>•</span>
                  <span>Max Consecutive: {selectedTeacher.maxConsecutivePeriods || 2} periods</span>
                </div>
              </div>
            </div>

            {/* Workload Pill Counter */}
            <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-[10px] uppercase font-semibold text-slate-500">Weekly Classes</div>
                <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
                  {teacherEntries.length} <span className="text-xs font-normal text-slate-500">periods</span>
                </div>
              </div>
              <div className="h-7 w-px bg-slate-200 dark:bg-slate-700" />
              <div>
                <div className="text-[10px] uppercase font-semibold text-slate-500">Active Days</div>
                <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
                  {Object.values(dailyLoad).filter(c => c > 0).length} / {workingDays.length}
                </div>
              </div>
              {teacherConflicts.length > 0 && (
                <>
                  <div className="h-7 w-px bg-slate-200 dark:bg-slate-700" />
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-amber-600">Conflicts</div>
                    <div className="text-base font-bold text-amber-600 tabular-nums">
                      {teacherConflicts.length}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* View Mode 1: Detailed Table View (Format specified in Requirement 1.B) */}
      {viewMode === 'table' ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Individual Teaching Schedule · {selectedTeacher?.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Modifications here are fully synchronized with the respective class routines in real time.
              </p>
            </div>
            <span className="text-xs text-slate-500">
              {sortedEntries.length} total classes assigned
            </span>
          </div>

          {sortedEntries.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Calendar className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No classes assigned yet for {selectedTeacher?.name}
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Use the Auto-Generate tool or assign {selectedTeacher?.name} in the Class Routines tab.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                    <th className="py-3 px-4 font-semibold">Day</th>
                    <th className="py-3 px-4 font-semibold">Period</th>
                    <th className="py-3 px-4 font-semibold">Period Time</th>
                    <th className="py-3 px-4 font-semibold">Class</th>
                    <th className="py-3 px-4 font-semibold">Section</th>
                    <th className="py-3 px-4 font-semibold">Subject</th>
                    <th className="py-3 px-4 font-semibold">Room</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                  {sortedEntries.map(entry => {
                    const period = periodTimings.find(p => p.periodIndex === entry.periodIndex);
                    const cls = classMap.get(entry.classId);
                    const sec = cls?.sections.find(s => s.id === entry.sectionId);
                    const sub = subjectMap.get(entry.subjectId);
                    const hasConflict = teacherConflicts.some(c => c.entryIds.includes(entry.id));

                    return (
                      <tr
                        key={entry.id}
                        className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                          hasConflict ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                          {entry.day}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-300">
                          {period?.label || `Period ${entry.periodIndex}`}
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono tabular-nums">
                          {period?.startTime} - {period?.endTime}
                        </td>
                        <td className="py-3 px-4 font-semibold text-blue-700 dark:text-blue-400">
                          {cls?.name || 'Class'}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                          {sec?.name || 'Section'}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: sub?.color || '#3B82F6' }}
                            />
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {sub?.name || 'Subject'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {entry.room || sec?.roomNumber || '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() =>
                                onOpenEditSlot(entry.classId, entry.sectionId, entry.day, entry.periodIndex)
                              }
                              title="Edit this entry"
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Remove this class from ${selectedTeacher.name}'s schedule?`)) {
                                  onClearSlot(entry.id);
                                }
                              }}
                              title="Remove entry"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* View Mode 2: Weekly Matrix Grid for Teacher */
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[850px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider w-28 shrink-0">
                    Day
                  </th>
                  {activePeriods.map(p => (
                    <th key={p.periodIndex} className="py-3 px-3 font-semibold text-center min-w-[120px]">
                      <div className="text-slate-900 dark:text-white font-bold">{p.label}</div>
                      <div className="text-[11px] text-slate-500 font-normal font-mono tabular-nums">
                        {p.startTime} - {p.endTime}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {workingDays.map(day => (
                  <tr key={day} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-bold text-sm text-slate-800 dark:text-slate-200 bg-slate-50/80 dark:bg-slate-800/40 border-r border-slate-200 dark:border-slate-800">
                      {day}
                    </td>

                    {activePeriods.map(period => {
                      const match = teacherEntries.find(
                        e => e.day === day && e.periodIndex === period.periodIndex
                      );
                      const cls = match ? classMap.get(match.classId) : null;
                      const sec = cls?.sections.find(s => s.id === match?.sectionId);
                      const sub = match ? subjectMap.get(match.subjectId) : null;
                      const hasConflict = match ? teacherConflicts.some(c => c.entryIds.includes(match.id)) : false;

                      return (
                        <td
                          key={period.periodIndex}
                          className="p-1.5 text-center align-middle border-r border-slate-100 dark:border-slate-800/60 last:border-r-0"
                        >
                          {match ? (
                            <div
                              onClick={() =>
                                onOpenEditSlot(match.classId, match.sectionId, day, period.periodIndex)
                              }
                              className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all hover:shadow-xs ${
                                hasConflict
                                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
                                  : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                              }`}
                            >
                              <div className="text-xs font-bold text-blue-700 dark:text-blue-300 truncate">
                                {cls?.name} · {sec?.name}
                              </div>
                              <div className="text-xs font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                                {sub?.name}
                              </div>
                              <div className="text-[10px] text-slate-500 mt-1 truncate">
                                {match.room || sec?.roomNumber || 'Room TBA'}
                              </div>
                            </div>
                          ) : (
                            <div className="h-16 flex items-center justify-center text-slate-300 dark:text-slate-700 text-xs">
                              Free
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
