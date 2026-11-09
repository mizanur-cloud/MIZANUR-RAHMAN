import React from 'react';
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
  Calendar,
  Sparkles,
  Download,
  Plus,
  Trash2,
  AlertCircle,
  Clock,
  CheckCircle2,
  FileText,
  FileCheck,
  Edit,
  Layers,
} from 'lucide-react';
import { exportClassDocx, exportSectionDocx } from '../services/exportDocx';
import { exportClassPdf, exportSectionPdf } from '../services/exportPdf';
import { AppState } from '../services/storage';

interface ClassRoutineViewProps {
  classes: SchoolClass[];
  selectedClassId: string;
  setSelectedClassId: (id: string) => void;
  selectedSectionId: string;
  setSelectedSectionId: (id: string) => void;
  subjects: Subject[];
  teachers: Teacher[];
  workingDays: DayOfWeek[];
  periodTimings: PeriodTiming[];
  entries: TimetableEntry[];
  conflicts: RoutineConflict[];
  onOpenEditSlot: (classId: string, sectionId: string, day: DayOfWeek, periodIndex: number) => void;
  onClearSlot: (entryId: string) => void;
  onClearSection: (classId: string, sectionId: string) => void;
  onAutoGenerateSection: (classId: string, sectionId: string) => void;
  onAutoGenerateClass: (classId: string) => void;
  onOpenSubjectMgmt?: () => void;
  fullAppState: AppState;
}

export const ClassRoutineView: React.FC<ClassRoutineViewProps> = ({
  classes,
  selectedClassId,
  setSelectedClassId,
  selectedSectionId,
  setSelectedSectionId,
  subjects,
  teachers,
  workingDays,
  periodTimings,
  entries,
  conflicts,
  onOpenEditSlot,
  onClearSlot,
  onClearSection,
  onAutoGenerateSection,
  onAutoGenerateClass,
  onOpenSubjectMgmt,
  fullAppState,
}) => {
  const selectedClass = classes.find(c => c.id === selectedClassId) || classes[0];
  const selectedSection =
    selectedClass?.sections.find(s => s.id === selectedSectionId) || selectedClass?.sections[0];

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  // Active entries for this section
  const sectionEntries = entries.filter(
    e => e.classId === selectedClass?.id && e.sectionId === selectedSection?.id
  );

  // Teaching periods vs break
  const activePeriods = periodTimings.filter(p => !p.isBreak);

  // Calculate total quota fulfillment
  const totalRequiredPeriods = selectedClass?.subjectRequirements.reduce(
    (acc, req) => acc + req.periodsPerWeek,
    0
  ) || 0;
  const totalAssignedPeriods = sectionEntries.length;

  // Conflict lookup for fast cell checking
  const conflictEntryIds = new Set<string>();
  conflicts.forEach(c => c.entryIds.forEach(id => conflictEntryIds.add(id)));

  return (
    <div className="space-y-6">
      {/* Class 1 to 10 Navigation Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 shadow-xs">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Select Class (Play, Nursery, KG, Classes 1 — 10)
          </div>
          <div className="text-xs text-slate-500">
            {classes.length} classes available
          </div>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {classes.map(c => {
            const isSelected = c.id === selectedClass?.id;
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedClassId(c.id);
                  if (c.sections.length > 0) {
                    setSelectedSectionId(c.sections[0].id);
                  }
                }}
                className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-blue-700 text-white shadow-xs font-semibold'
                    : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                }`}
              >
                <span>{c.name}</span>
                <span
                  className={`text-xs px-1.5 py-0.2 rounded-full ${
                    isSelected ? 'bg-blue-800 text-blue-100' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {c.sections.length} sec
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section Selection & Action Header */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Section Tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 mr-2">
              Sections:
            </span>
            {selectedClass?.sections.map(sec => {
              const isSelected = sec.id === selectedSection?.id;
              const secCount = entries.filter(
                e => e.classId === selectedClass.id && e.sectionId === sec.id
              ).length;

              return (
                <button
                  key={sec.id}
                  onClick={() => setSelectedSectionId(sec.id)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>{sec.name}</span>
                  {sec.roomNumber && (
                    <span className="text-[10px] opacity-75 font-normal">
                      [{sec.roomNumber}]
                    </span>
                  )}
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isSelected
                        ? 'bg-blue-700 text-blue-100'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {secCount}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action Buttons: Generate & Downloads */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                if (selectedClass && selectedSection) {
                  onAutoGenerateSection(selectedClass.id, selectedSection.id);
                }
              }}
              title="Automatically generate a conflict-free routine for this section"
              className="px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Auto-Fill Section</span>
            </button>

            <button
              onClick={() => {
                if (selectedClass) {
                  onAutoGenerateClass(selectedClass.id);
                }
              }}
              title="Generate routines for all sections in this class"
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Auto-Fill All {selectedClass?.name}</span>
            </button>

            {/* Word Download */}
            <button
              onClick={() => {
                if (selectedClass && selectedSection) {
                  exportSectionDocx(selectedClass.id, selectedSection.id, fullAppState);
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Download Section Routine in Microsoft Word format"
            >
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>Word (.docx)</span>
            </button>

            {/* PDF Download */}
            <button
              onClick={() => {
                if (selectedClass && selectedSection) {
                  exportSectionPdf(selectedClass.id, selectedSection.id, fullAppState);
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Download Section Routine in PDF format"
            >
              <FileCheck className="w-3.5 h-3.5 text-rose-600" />
              <span>PDF</span>
            </button>

            {/* Clear Section */}
            <button
              onClick={() => {
                if (
                  selectedClass &&
                  selectedSection &&
                  confirm(`Clear all scheduled periods for ${selectedClass.name} - ${selectedSection.name}?`)
                ) {
                  onClearSection(selectedClass.id, selectedSection.id);
                }
              }}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
              title="Clear all entries for this section"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Section Quota Metric Bar */}
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {selectedClass?.name} · {selectedSection?.name}
            </span>
            <span>•</span>
            <span>Room: {selectedSection?.roomNumber || 'Standard Classroom'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span>
              Weekly Periods: <strong className="text-slate-900 dark:text-white tabular-nums">{totalAssignedPeriods}</strong> / {totalRequiredPeriods}
            </span>
            <div className="w-24 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (totalAssignedPeriods / (totalRequiredPeriods || 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Master Timetable Grid */}
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
                  {/* Day Label Cell */}
                  <td className="py-3 px-4 font-bold text-sm text-slate-800 dark:text-slate-200 bg-slate-50/80 dark:bg-slate-800/40 border-r border-slate-200 dark:border-slate-800">
                    {day}
                  </td>

                  {/* Period Cells */}
                  {activePeriods.map(period => {
                    const entry = sectionEntries.find(
                      e => e.day === day && e.periodIndex === period.periodIndex
                    );
                    const subject = entry ? subjectMap.get(entry.subjectId) : null;
                    const teacher = entry ? teacherMap.get(entry.teacherId) : null;
                    const hasConflict = entry ? conflictEntryIds.has(entry.id) : false;

                    return (
                      <td
                        key={period.periodIndex}
                        className="p-1.5 text-center align-middle border-r border-slate-100 dark:border-slate-800/60 last:border-r-0"
                      >
                        {entry ? (
                          <div
                            onClick={() =>
                              onOpenEditSlot(
                                selectedClass.id,
                                selectedSection.id,
                                day,
                                period.periodIndex
                              )
                            }
                            className={`group relative p-2.5 rounded-lg border text-left cursor-pointer transition-all hover:shadow-xs ${
                              hasConflict
                                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 ring-1 ring-amber-400'
                                : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/80 hover:border-blue-400'
                            }`}
                          >
                            {/* Color Accent Indicator */}
                            <div
                              className="w-1.5 h-1.5 rounded-full absolute top-2 right-2"
                              style={{ backgroundColor: subject?.color || '#3B82F6' }}
                            />

                            {/* Subject Name */}
                            <div className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate pr-3">
                              {subject?.name || 'Class'}
                            </div>

                            {/* Teacher & Room */}
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                              {teacher?.name || 'Assigned Teacher'}
                            </div>

                            {entry.room && (
                              <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                                {entry.room}
                              </div>
                            )}

                            {/* Conflict Alert icon */}
                            {hasConflict && (
                              <div className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 font-semibold mt-1">
                                <AlertCircle className="w-3 h-3 text-amber-600" />
                                <span>Conflict</span>
                              </div>
                            )}

                            {/* Hover Quick Delete */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onClearSlot(entry.id);
                              }}
                              title="Remove class"
                              className="hidden group-hover:block absolute bottom-1 right-1 p-1 text-slate-400 hover:text-rose-600 rounded"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() =>
                              onOpenEditSlot(
                                selectedClass.id,
                                selectedSection.id,
                                day,
                                period.periodIndex
                              )
                            }
                            className="w-full h-18 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 text-slate-400 hover:text-blue-600 transition-all flex flex-col items-center justify-center gap-1 text-xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span className="text-[10px]">Assign</span>
                          </button>
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

      {/* Subject Quota & Teacher Assignment Summary */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Subject Allocation for {selectedClass?.name} - {selectedSection?.name}
          </div>
          <div className="flex items-center gap-3">
            {onOpenSubjectMgmt && (
              <button
                type="button"
                onClick={onOpenSubjectMgmt}
                className="text-xs font-semibold text-blue-700 dark:text-blue-300 hover:text-blue-800 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 border border-blue-200 dark:border-blue-900 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs"
                title="Add new subjects or change subjects for this class"
              >
                <Edit className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Edit / Add Subjects (বিষয় পরিবর্তন ও যোগ)</span>
              </button>
            )}
            <div className="text-xs text-slate-500 hidden sm:block">
              Click any empty slot above to place a subject
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {selectedClass?.subjectRequirements.map(req => {
            const subject = subjectMap.get(req.subjectId);
            const teacher = req.assignedTeacherId ? teacherMap.get(req.assignedTeacherId) : null;
            const scheduledCount = sectionEntries.filter(e => e.subjectId === req.subjectId).length;
            const isComplete = scheduledCount >= req.periodsPerWeek;

            return (
              <div
                key={req.subjectId}
                className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: subject?.color || '#3B82F6' }}
                    />
                    <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                      {subject?.name}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {teacher?.name || 'Any qualified teacher'}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    {scheduledCount} / {req.periodsPerWeek}
                  </div>
                  {isComplete ? (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 justify-end">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      <span>Full</span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">
                      {req.periodsPerWeek - scheduledCount} left
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
