import React, { useState } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  RoutineConflict,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import {
  Search,
  FileText,
  FileCheck,
  Calendar,
  Grid3X3,
  List,
  Edit2,
  Trash2,
  Copy,
  Check,
  Printer,
} from 'lucide-react';
import { exportAllTeachersDocx, exportTeacherDocx } from '../services/exportDocx';
import { exportTeacherPdf } from '../services/exportPdf';
import { AppState } from '../services/storage';
import {
  getCombinedHinduRoom,
  getEffectiveSectionRequirements,
  isHinduReligionRoom,
  isHinduReligionSubject,
} from '../services/parallelSubjects';

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
  settings?: SchoolSettings;
  onOpenEditSlot: (classId: string, sectionId: string, day: DayOfWeek, periodIndex: number) => void;
  onClearSlot: (entryId: string) => void;
  fullAppState: AppState;
  readOnly?: boolean;
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
  settings,
  onOpenEditSlot,
  onClearSlot,
  fullAppState,
  readOnly = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('grid');
  const [copiedSchedule, setCopiedSchedule] = useState(false);

  const selectedTeacher =
    teachers.find(t => t.id === selectedTeacherId) || teachers[0];

  const classMap = new Map(classes.map(c => [c.id, c]));
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const allDisplayPeriods = periodTimings;
  const combinedHinduRoom = getCombinedHinduRoom(settings);

  const filteredTeachers = teachers.filter(
    t =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.initials.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const teacherEntries = entries.filter(e => e.teacherId === selectedTeacher?.id);
  const physicalPeriodCount = new Set(teacherEntries.map(e => `${e.day}_${e.periodIndex}`)).size;

  const dayOrder: Record<string, number> = {};
  workingDays.forEach((d, idx) => (dayOrder[d] = idx));

  const sortedEntries = [...teacherEntries].sort((a, b) => {
    const dDiff = (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99);
    if (dDiff !== 0) return dDiff;
    return a.periodIndex - b.periodIndex;
  });

  const teacherConflicts = conflicts.filter(
    c => c.teacherId === selectedTeacher?.id || c.entryIds.some(id => teacherEntries.some(e => e.id === id))
  );

  const dailyLoad: Record<string, number> = {};
  workingDays.forEach(d => {
    dailyLoad[d] = new Set(teacherEntries.filter(e => e.day === d).map(e => e.periodIndex)).size;
  });

  let configuredTargetPeriods = 0;
  if (selectedTeacher && !selectedTeacher.isBlockTeacher) {
    classes.forEach(cls => {
      if (cls.usesShifts || cls.numericGrade < 0) return;
      cls.sections.forEach(sec => {
        getEffectiveSectionRequirements(cls, sec.id, teachers).forEach(req => {
          if (req.assignedTeacherId === selectedTeacher.id) {
            configuredTargetPeriods += req.periodsPerWeek;
          }
        });
      });
    });
  }

  const handleCopyTeacherSchedule = () => {
    if (!selectedTeacher) return;
    const header = `${fullAppState.settings.schoolName}\nশিক্ষকের সাপ্তাহিক রুটিন: ${selectedTeacher.name} (${selectedTeacher.initials}) — মোট ${sortedEntries.length} পিরিয়ড\n`;
    const lines = workingDays.map(day => {
      const dayItems = sortedEntries.filter(e => e.day === day);
      if (dayItems.length === 0) return `• ${day}: কোনো ক্লাস নেই`;
      const formatted = dayItems
        .map(item => {
          const p = periodTimings.find(pt => pt.periodIndex === item.periodIndex);
          const cls = classMap.get(item.classId);
          const sec = cls?.sections.find(s => s.id === item.sectionId);
          const sub = subjectMap.get(item.subjectId);
          const room = item.room || sec?.roomNumber;
          return `  - ${p?.label || `P${item.periodIndex}`} (${p?.startTime || ''}–${p?.endTime || ''}): ${cls?.name || ''} (${sec?.name || ''}) — ${sub?.name || ''}${room ? ` [${room}]` : ''}`;
        })
        .join('\n');
      return `• ${day}:\n${formatted}`;
    });

    navigator.clipboard.writeText(`${header}\n${lines.join('\n')}`);
    setCopiedSchedule(true);
    setTimeout(() => setCopiedSchedule(false), 2500);
  };

  return (
    <div className="space-y-5">
      {/* Teacher Selector Strip */}
      <div className="no-print bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Select Faculty Member (সকল শিক্ষক তালিকা)
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {teachers.length} faculty
          </div>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {teachers.map(t => {
            const isSelected = t.id === selectedTeacher?.id;
            const tEntries = entries.filter(e => e.teacherId === t.id);
            const tCount = new Set(tEntries.map(e => `${e.day}_${e.periodIndex}`)).size;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTeacherId(t.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-blue-700 text-white font-semibold'
                    : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/70'
                }`}
              >
                <span>{t.name}</span>
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    isSelected ? 'text-blue-200' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {t.initials} · {tCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Controls, Quick Share & Exports */}
      <div className="no-print bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search teacher by name or initials..."
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

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>Table</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                <span>Grid</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopyTeacherSchedule}
              title="শিক্ষকের সাপ্তাহিক রুটিন WhatsApp বা মেসেজের জন্য কপি করুন"
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                copiedSchedule
                  ? 'bg-emerald-600 text-white'
                  : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
              }`}
            >
              {copiedSchedule ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSchedule ? 'কপি হয়েছে!' : 'কপি রুটিন'}</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Print this teacher's weekly schedule"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (selectedTeacher) {
                  exportTeacherDocx(selectedTeacher.id, fullAppState);
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Download teacher routine in Word"
            >
              <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Word</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (selectedTeacher) {
                  exportTeacherPdf(selectedTeacher.id, fullAppState);
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Download teacher routine in PDF"
            >
              <FileCheck className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>PDF</span>
            </button>

            <button
              type="button"
              onClick={() => exportAllTeachersDocx(fullAppState)}
              className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors flex items-center gap-1.5"
              title="Export all teachers' routines combined into one document"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>All Faculty</span>
            </button>
          </div>
        </div>
      </div>

      {/* Selected Teacher Profile & Workload Strip */}
      {selectedTeacher && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold flex items-center justify-center text-sm border border-blue-200 dark:border-blue-800 shrink-0">
                {selectedTeacher.initials}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {selectedTeacher.name}
                  </h2>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    · {selectedTeacher.designation}
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>Subjects:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {selectedTeacher.subjectIds
                      .map(sId => subjectMap.get(sId)?.name || sId)
                      .join(', ')}
                  </span>
                  <span>·</span>
                  <span>Max Consecutive: {selectedTeacher.maxConsecutivePeriods || 2}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-5 px-4 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 shrink-0">
              <div>
                <div className="text-[10px] uppercase font-semibold text-slate-500">Weekly Periods</div>
                <div className="text-base font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                  {physicalPeriodCount}
                  {teacherEntries.length > physicalPeriodCount ? (
                    <span className="text-xs font-normal text-indigo-600 dark:text-indigo-400 ml-1">
                      ({teacherEntries.length} sec)
                    </span>
                  ) : configuredTargetPeriods > 0 ? (
                    <span className="text-xs font-normal text-slate-500"> / {configuredTargetPeriods}</span>
                  ) : null}
                </div>
              </div>
              <div className="h-7 w-px bg-slate-200 dark:bg-slate-700" />
              <div>
                <div className="text-[10px] uppercase font-semibold text-slate-500">Active Days</div>
                <div className="text-base font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                  {Object.values(dailyLoad).filter(c => c > 0).length} / {workingDays.length}
                </div>
              </div>
              {teacherConflicts.length > 0 && (
                <>
                  <div className="h-7 w-px bg-slate-200 dark:bg-slate-700" />
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-amber-600">Alerts</div>
                    <div className="text-base font-mono font-bold text-amber-600 tabular-nums">
                      {teacherConflicts.length}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Table vs Grid */}
      {viewMode === 'table' ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Individual Teaching Schedule · {selectedTeacher?.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time synchronized with class routines.
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {sortedEntries.length} classes
            </span>
          </div>

          {sortedEntries.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Calendar className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No classes assigned yet for {selectedTeacher?.name}
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Use Auto-Fill or assign {selectedTeacher?.name} in the Class Routines tab.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                    <th className="py-3 px-4 font-semibold">Day</th>
                    <th className="py-3 px-4 font-semibold">Period</th>
                    <th className="py-3 px-4 font-semibold">Time</th>
                    <th className="py-3 px-4 font-semibold">Class</th>
                    <th className="py-3 px-4 font-semibold">Section</th>
                    <th className="py-3 px-4 font-semibold">Subject</th>
                    <th className="py-3 px-4 font-semibold">Room</th>
                    {!readOnly && <th className="no-print py-3 px-4 font-semibold text-right">Actions</th>}
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
                        <td className="py-3 px-4 text-slate-500 font-mono">
                          {entry.room || sec?.roomNumber || '—'}
                        </td>
                        {!readOnly && (
                          <td className="no-print py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenEditSlot(entry.classId, entry.sectionId, entry.day, entry.periodIndex)
                                }
                                title="Edit this entry"
                                className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded transition-colors"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onClearSlot(entry.id)}
                                title="Remove entry from schedule"
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-3 font-semibold uppercase tracking-wider w-24 shrink-0 bg-slate-100/60 dark:bg-slate-800">
                    Day
                  </th>
                  {allDisplayPeriods.map(p => {
                    const isBreak = p.isBreak || p.isLocked;
                    return (
                      <th
                        key={p.periodIndex}
                        className={`py-2.5 px-2 font-semibold text-center ${
                          isBreak
                            ? 'w-24 bg-amber-50/70 dark:bg-amber-950/30 border-x border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200'
                            : 'min-w-[105px]'
                        }`}
                      >
                        <div className="font-bold text-xs truncate">
                          {isBreak ? '☕ টিফিন বিরতি 🔒' : p.label}
                        </div>
                        <div className="text-[10px] font-mono tabular-nums opacity-75">
                          {p.startTime} - {p.endTime}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {workingDays.map(day => (
                  <tr key={day} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 px-3 font-bold text-xs text-slate-800 dark:text-slate-200 bg-slate-50/80 dark:bg-slate-800/40 border-r border-slate-200 dark:border-slate-800">
                      {day}
                    </td>

                    {allDisplayPeriods.map(period => {
                      const isBreak = period.isBreak || period.isLocked;

                      if (isBreak) {
                        return (
                          <td
                            key={period.periodIndex}
                            className="p-1 text-center align-middle border-r border-amber-200/50 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20"
                          >
                            <div className="h-14 rounded-lg border border-dashed border-amber-200 dark:border-amber-800/60 flex flex-col items-center justify-center text-amber-700 dark:text-amber-300 cursor-not-allowed select-none">
                              <span className="text-[11px] font-bold">☕ টিফিন বিরতি</span>
                              <span className="text-[9px] text-amber-600/80 font-medium">লক 🔒</span>
                            </div>
                          </td>
                        );
                      }

                      const slotMatches = teacherEntries.filter(
                        e => e.day === day && e.periodIndex === period.periodIndex
                      );
                      const hasConflict = slotMatches.some(m =>
                        teacherConflicts.some(c => c.entryIds.includes(m.id))
                      );

                      if (slotMatches.length === 0) {
                        return (
                          <td
                            key={period.periodIndex}
                            className="p-1 text-center align-middle border-r border-slate-100 dark:border-slate-800/60 last:border-r-0"
                          >
                            <div className="h-14 flex items-center justify-center text-slate-300 dark:text-slate-700 text-[11px] rounded-lg border border-dashed border-slate-100 dark:border-slate-800/60">
                              Free
                            </div>
                          </td>
                        );
                      }

                      if (slotMatches.length === 1) {
                        const match = slotMatches[0];
                        const cls = classMap.get(match.classId);
                        const sec = cls?.sections.find(s => s.id === match.sectionId);
                        const sub = subjectMap.get(match.subjectId);

                        return (
                          <td
                            key={period.periodIndex}
                            className="p-1 text-center align-middle border-r border-slate-100 dark:border-slate-800/60 last:border-r-0"
                          >
                            <div
                              onClick={() => {
                                if (!readOnly) {
                                  onOpenEditSlot(match.classId, match.sectionId, day, period.periodIndex);
                                }
                              }}
                              className={`p-1.5 rounded-lg border text-left transition-all h-14 flex flex-col justify-between ${
                                readOnly ? 'cursor-default' : 'cursor-pointer'
                              } ${
                                hasConflict
                                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
                                  : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                              }`}
                            >
                              <div className="text-[11px] font-bold text-blue-700 dark:text-blue-300 truncate">
                                {cls?.name} · {sec?.name}
                              </div>
                              <div className="text-[10px] text-slate-600 dark:text-slate-300 truncate flex items-center justify-between gap-1">
                                <span className="font-semibold text-slate-900 dark:text-white truncate">
                                  {sub?.name}
                                </span>
                                {(match.room || sec?.roomNumber) && (
                                  <span className="text-[9px] text-slate-400 font-mono shrink-0">
                                    [{match.room || sec?.roomNumber}]
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                        );
                      }

                      // Multi-section combined period (e.g. Combined Hindu Religion in Room 307)
                      const firstMatch = slotMatches[0];
                      const firstSub = subjectMap.get(firstMatch.subjectId);
                      const allHindu = slotMatches.every(
                        m =>
                          isHinduReligionSubject(m.subjectId, subjects) &&
                          isHinduReligionRoom(m.room, settings)
                      );

                      return (
                        <td
                          key={period.periodIndex}
                          className="p-1 text-center align-middle border-r border-slate-100 dark:border-slate-800/60 last:border-r-0"
                        >
                          <div
                            onClick={() => {
                              if (!readOnly) {
                                onOpenEditSlot(firstMatch.classId, firstMatch.sectionId, day, period.periodIndex);
                              }
                            }}
                            title={slotMatches
                              .map(m => {
                                const c = classMap.get(m.classId);
                                const s = c?.sections.find(sec => sec.id === m.sectionId);
                                return `${c?.name} (${s?.name})`;
                              })
                              .join(', ')}
                            className={`p-1.5 rounded-lg border text-left transition-all min-h-[56px] flex flex-col justify-between ${
                              readOnly ? 'cursor-default' : 'cursor-pointer'
                            } ${
                              hasConflict
                                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
                                : allHindu
                                ? 'bg-indigo-50/70 dark:bg-indigo-950/35 border-indigo-200 dark:border-indigo-800 hover:border-indigo-400'
                                : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                              <span className="truncate">
                                {allHindu ? `Combined ${slotMatches.length} Sec` : `${slotMatches.length} Classes`}
                              </span>
                              <span className="font-mono text-[9px] shrink-0">
                                [{firstMatch.room || combinedHinduRoom}]
                              </span>
                            </div>
                            <div className="text-[9.5px] font-semibold text-slate-800 dark:text-slate-100 leading-tight line-clamp-2">
                              {slotMatches
                                .map(m => {
                                  const c = classMap.get(m.classId);
                                  const s = c?.sections.find(sec => sec.id === m.sectionId);
                                  const shortCls = (c?.name || '').replace(/^Class\s+/i, '');
                                  return `${shortCls} ${s?.name || ''}`.trim();
                                })
                                .join(' · ')}
                            </div>
                            <div className="text-[9px] text-slate-500 dark:text-slate-400 truncate">
                              {firstSub?.name}
                            </div>
                          </div>
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
