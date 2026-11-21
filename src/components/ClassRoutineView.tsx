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
  Sparkles,
  Plus,
  Trash2,
  CheckCircle2,
  FileText,
  FileCheck,
  Edit,
  ArrowLeftRight,
  AlertTriangle,
  X,
  CheckSquare,
} from 'lucide-react';
import { exportSectionDocx } from '../services/exportDocx';
import { exportSectionPdf } from '../services/exportPdf';
import { AppState } from '../services/storage';
import { isSlotDismissed, getTierBadgeInfo } from '../services/scheduleTiers';
import {
  getEffectiveSectionRequirements,
  isAgricultureSubject,
  isClassNineOrTen,
  isHigherMathSubject,
  isHinduReligionSubject,
  isIslamReligionSubject,
  isPlayOrNursery,
  isTeacherBlockTeacher,
} from '../services/parallelSubjects';

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
  onSwapSectionSlots: (
    classId: string,
    sectionId: string,
    dayA: DayOfWeek,
    periodA: number,
    dayB: DayOfWeek,
    periodB: number
  ) => { ok: boolean; reason?: string };
  onAutoGenerateSection: (classId: string, sectionId: string) => void;
  onAutoGenerateClass: (classId: string) => void;
  onOpenSubjectMgmt?: () => void;
  onUpdateSectionSubjects?: (
    classId: string,
    sectionId: string,
    selectedSubjectIds: string[] | undefined,
    extraClassRequirements?: { subjectId: string; periodsPerWeek: number; assignedTeacherId?: string }[]
  ) => void;
  onUpdateSectionSubjectConfig?: (
    classId: string,
    sectionId: string,
    subjectId: string,
    patch: { periodsPerWeek?: number; assignedTeacherId?: string }
  ) => void;
  settings?: SchoolSettings;
  fullAppState: AppState;
  readOnly?: boolean;
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
  onSwapSectionSlots,
  onAutoGenerateSection,
  onAutoGenerateClass,
  onOpenSubjectMgmt,
  onUpdateSectionSubjects,
  onUpdateSectionSubjectConfig,
  settings,
  fullAppState,
  readOnly = false,
}) => {
  const selectedClass = classes.find(c => c.id === selectedClassId) || classes[0];
  const selectedSection =
    selectedClass?.sections.find(s => s.id === selectedSectionId) || selectedClass?.sections[0];

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isSwapMode, setIsSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState<{ day: DayOfWeek; periodIndex: number } | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [showSectionSubjectPicker, setShowSectionSubjectPicker] = useState(false);

  // Active entries for this section
  const sectionEntries = entries.filter(
    e => e.classId === selectedClass?.id && e.sectionId === selectedSection?.id
  );

  const allDisplayPeriods = periodTimings;
  const isPlayNur = selectedClass ? isPlayOrNursery(selectedClass) : false;

  const effectiveReqs =
    selectedClass && selectedSection && !isPlayNur
      ? getEffectiveSectionRequirements(selectedClass, selectedSection.id, teachers)
      : [];
  const selectedSectionSubSet = new Set(effectiveReqs.map(r => r.subjectId));

  const hasHmtInSection =
    Boolean(selectedClass && isClassNineOrTen(selectedClass)) &&
    effectiveReqs.some(r => isHigherMathSubject(r.subjectId, subjects));
  const hasRelInSection = effectiveReqs.some(r => isIslamReligionSubject(r.subjectId, subjects));
  const hasHinInSection = effectiveReqs.some(r => isHinduReligionSubject(r.subjectId, subjects));

  const getEffectiveTargetPeriods = (reqSubjectId: string, basePeriods: number): number => {
    let target = basePeriods;
    if (hasHmtInSection && isAgricultureSubject(reqSubjectId, subjects)) {
      const hmtReq = effectiveReqs.find(r => isHigherMathSubject(r.subjectId, subjects));
      if (hmtReq) target = Math.max(target, hmtReq.periodsPerWeek);
    }
    if (hasRelInSection && hasHinInSection && isHinduReligionSubject(reqSubjectId, subjects)) {
      const relReq = effectiveReqs.find(r => isIslamReligionSubject(r.subjectId, subjects));
      if (relReq) target = Math.max(target, relReq.periodsPerWeek);
    }
    return target;
  };

  const totalRequiredPeriods = isPlayNur
    ? workingDays.reduce((dayAcc, d) => {
        const openInDay = periodTimings.filter(
          p =>
            !p.isBreak &&
            !p.isLocked &&
            selectedClass &&
            !isSlotDismissed(selectedClass, d, p.periodIndex, selectedSection?.id, workingDays)
        ).length;
        return dayAcc + openInDay;
      }, 0)
    : effectiveReqs.reduce(
        (acc, req) => acc + getEffectiveTargetPeriods(req.subjectId, req.periodsPerWeek),
        0
      );

  const totalAssignedPeriods = sectionEntries.length;

  const handleToggleSubjectForActiveSection = (subjectId: string) => {
    if (!selectedClass || !selectedSection || !onUpdateSectionSubjects) return;
    const allClassSubIds = selectedClass.subjectRequirements.map(r => r.subjectId);
    const curSet = new Set(
      selectedSection.selectedSubjectIds !== undefined
        ? selectedSection.selectedSubjectIds
        : allClassSubIds
    );
    if (curSet.has(subjectId)) {
      curSet.delete(subjectId);
    } else {
      curSet.add(subjectId);
    }
    onUpdateSectionSubjects(selectedClass.id, selectedSection.id, Array.from(curSet));
  };

  const conflictEntryIds = new Set<string>();
  conflicts.forEach(c => c.entryIds.forEach(id => conflictEntryIds.add(id)));

  const handleSlotClick = (day: DayOfWeek, periodIndex: number) => {
    if (!selectedClass || !selectedSection) return;

    if (!isSwapMode) {
      onOpenEditSlot(selectedClass.id, selectedSection.id, day, periodIndex);
      return;
    }

    setSwapError(null);
    if (!swapSource) {
      setSwapSource({ day, periodIndex });
      return;
    }

    if (swapSource.day === day && swapSource.periodIndex === periodIndex) {
      setSwapSource(null);
      return;
    }

    const res = onSwapSectionSlots(
      selectedClass.id,
      selectedSection.id,
      swapSource.day,
      swapSource.periodIndex,
      day,
      periodIndex
    );

    if (!res.ok) {
      setSwapError(res.reason || 'এই দুই পিরিয়ডের মধ্যে অদলবদল করা সম্ভব নয়।');
    } else {
      setSwapSource(null);
      setSwapError(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Class Navigation Strip */}
      <div className="no-print bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Select Class (Play, Nursery, KG, Classes 1 — 10)
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {classes.length} classes
          </div>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {classes.map(c => {
            const isSelected = c.id === selectedClass?.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSelectedClassId(c.id);
                  if (c.sections.length > 0) {
                    setSelectedSectionId(c.sections[0].id);
                  }
                  setSwapSource(null);
                  setSwapError(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-blue-700 text-white font-semibold'
                    : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/70'
                }`}
              >
                <span>{c.name}</span>
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    isSelected ? 'text-blue-200' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {c.sections.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section Header & Actions */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Section / Shift Selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 mr-1">
              {selectedClass?.usesShifts || isPlayNur ? 'Shifts:' : 'Sections:'}
            </span>
            {selectedClass?.sections.map(sec => {
              const isSelected = sec.id === selectedSection?.id;
              const secCount = entries.filter(
                e => e.classId === selectedClass.id && e.sectionId === sec.id
              ).length;

              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => {
                    setSelectedSectionId(sec.id);
                    setSwapSource(null);
                    setSwapError(null);
                  }}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>{sec.name}</span>
                  {sec.roomNumber && (
                    <span className="text-[10px] opacity-80 font-normal">
                      [{sec.roomNumber}]
                    </span>
                  )}
                  <span
                    className={`font-mono text-[10px] tabular-nums ${
                      isSelected ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    ({secCount})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action Toolbar */}
          <div className="no-print flex items-center gap-2 flex-wrap">
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setIsSwapMode(prev => !prev);
                    setSwapSource(null);
                    setSwapError(null);
                  }}
                  title="দুটি পিরিয়ড নিরাপদভাবে অদলবদল করুন (ক্ল্যাশ চেকসহ)"
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
                    isSwapMode
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                  }`}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>{isSwapMode ? 'বদল মোড চালু' : 'স্লট বদল (Swap)'}</span>
                </button>

                <button
                  type="button"
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
                  type="button"
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
              </>
            )}

            <button
              type="button"
              onClick={() => {
                if (selectedClass && selectedSection) {
                  exportSectionDocx(selectedClass.id, selectedSection.id, fullAppState);
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Download Section Routine in Microsoft Word format"
            >
              <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Word</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (selectedClass && selectedSection) {
                  exportSectionPdf(selectedClass.id, selectedSection.id, fullAppState);
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Download Section Routine in PDF format"
            >
              <FileCheck className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>PDF</span>
            </button>

            {!readOnly && (isConfirmingClear ? (
              <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/60 p-1 rounded-lg border border-rose-200 dark:border-rose-800">
                <span className="text-[11px] text-rose-700 dark:text-rose-300 font-semibold px-1">
                  রুটিন মুছবেন?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedClass && selectedSection) {
                      onClearSection(selectedClass.id, selectedSection.id);
                    }
                    setIsConfirmingClear(false);
                  }}
                  className="px-2 py-1 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors"
                >
                  হ্যাঁ
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingClear(false)}
                  className="px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
                >
                  না
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsConfirmingClear(true)}
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                title="Clear all entries for this section"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>

        {/* Metadata & Weekly Quota Progress */}
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {selectedClass?.name} · {selectedSection?.name}
            </span>
            <span>·</span>
            <span>Room: {selectedSection?.roomNumber || 'Standard Classroom'}</span>
            {selectedClass && (
              <>
                <span>·</span>
                <span
                  className="font-medium text-slate-700 dark:text-slate-300"
                  title={getTierBadgeInfo(selectedClass, selectedSectionId, workingDays).details}
                >
                  {getTierBadgeInfo(selectedClass, selectedSectionId, workingDays).label}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>
              Weekly Periods:{' '}
              <strong className="font-mono text-slate-900 dark:text-white tabular-nums">
                {totalAssignedPeriods}
              </strong>{' '}
              /{' '}
              <span className="font-mono tabular-nums">{totalRequiredPeriods}</span>
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

      {/* Interactive Swap Mode Guide / Validation Banner */}
      {isSwapMode && (
        <div className="no-print bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-indigo-900 dark:text-indigo-200">
            <ArrowLeftRight className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>
              {swapSource ? (
                <>
                  প্রথম স্লট নির্বাচিত: <strong>{swapSource.day} · Period {swapSource.periodIndex}</strong> — এবার বদল করার জন্য দ্বিতীয় স্লট ক্লিক করুন।
                </>
              ) : (
                <>
                  <strong>স্লট বদল মোড:</strong> যেকোনো দুটি পিরিয়ড পরপর ক্লিক করলে শিক্ষক ও রুমের সংঘর্ষ যাচাই করে নিরাপদভাবে অদলবদল করা হবে।
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsSwapMode(false);
              setSwapSource(null);
              setSwapError(null);
            }}
            className="text-indigo-700 dark:text-indigo-300 font-semibold hover:underline flex items-center gap-1 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>বন্ধ করুন</span>
          </button>
        </div>
      )}

      {swapError && (
        <div className="no-print bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-rose-800 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{swapError}</span>
          </div>
          <button
            type="button"
            onClick={() => setSwapError(null)}
            className="text-rose-600 dark:text-rose-300 hover:underline shrink-0"
          >
            ঠিক আছে
          </button>
        </div>
      )}

      {/* Timetable Grid */}
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
                    const isDismissed = selectedClass
                      ? isSlotDismissed(selectedClass, day, period.periodIndex, selectedSectionId, workingDays)
                      : false;

                    if (isBreak) {
                      return (
                        <td
                          key={period.periodIndex}
                          className="p-1 text-center align-middle border-r border-amber-200/50 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20"
                        >
                          <div className="h-14 rounded-lg border border-dashed border-amber-200 dark:border-amber-800/60 flex flex-col items-center justify-center text-amber-700 dark:text-amber-300 cursor-not-allowed select-none">
                            <span className="text-[11px] font-bold">☕ টিফিন বিরতি</span>
                            <span className="text-[9px] text-amber-600/80 dark:text-amber-400/80 font-medium">
                              লক 🔒
                            </span>
                          </div>
                        </td>
                      );
                    }

                    if (isDismissed) {
                      return (
                        <td
                          key={period.periodIndex}
                          className="p-1 text-center align-middle border-r border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/30"
                        >
                          <div className="h-14 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-slate-400 select-none">
                            <span className="text-[11px] font-semibold">🏠 ছুটি</span>
                            <span className="text-[9px] text-slate-400 font-normal">Class Off</span>
                          </div>
                        </td>
                      );
                    }

                    const slotEntries = sectionEntries.filter(
                      e => e.day === day && e.periodIndex === period.periodIndex
                    );

                    const isSelectedSwapSource =
                      isSwapMode && swapSource?.day === day && swapSource?.periodIndex === period.periodIndex;

                    return (
                      <td
                        key={period.periodIndex}
                        className="p-1 text-center align-middle border-r border-slate-100 dark:border-slate-800/60 last:border-r-0"
                      >
                        {slotEntries.length === 1 ? (
                          (() => {
                            const entry = slotEntries[0];
                            const subject = subjectMap.get(entry.subjectId);
                            const teacher = teacherMap.get(entry.teacherId);
                            const hasConflict = conflictEntryIds.has(entry.id);
                            return (
                              <div
                                onClick={() => handleSlotClick(day, period.periodIndex)}
                                className={`group relative p-2 rounded-lg border text-left transition-all h-14 flex flex-col justify-between ${
                                  readOnly ? 'cursor-default' : 'cursor-pointer'
                                } ${
                                  isSelectedSwapSource
                                    ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 ring-2 ring-indigo-500'
                                    : hasConflict
                                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 ring-1 ring-amber-400'
                                    : isSwapMode
                                    ? 'bg-white dark:bg-slate-800/80 border-indigo-200 dark:border-indigo-800 hover:border-indigo-500'
                                    : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/80 hover:border-blue-400'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <div className="font-bold text-[11px] text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: subject?.color || '#3B82F6' }}
                                    />
                                    <span className="truncate">{subject?.name || 'Class'}</span>
                                  </div>
                                  {!readOnly && !isSwapMode && (
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        onClearSlot(entry.id);
                                      }}
                                      title="Remove class"
                                      className="no-print hidden group-hover:block p-0.5 text-slate-400 hover:text-rose-600 rounded shrink-0"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>

                                <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate flex items-center justify-between gap-1">
                                  <span className="truncate font-medium">
                                    {teacher?.name ? `${teacher.name} (${teacher.initials})` : 'Assigned Teacher'}
                                  </span>
                                  {entry.room && (
                                    <span className="text-[9px] font-mono text-slate-400 shrink-0">[{entry.room}]</span>
                                  )}
                                </div>
                              </div>
                            );
                          })()
                        ) : slotEntries.length > 1 ? (
                          <div
                            onClick={() => handleSlotClick(day, period.periodIndex)}
                            className={`p-1 rounded-lg border transition-all min-h-14 flex flex-col justify-center gap-1 ${
                              readOnly ? 'cursor-default' : 'cursor-pointer'
                            } ${
                              isSelectedSwapSource
                                ? 'bg-indigo-100 dark:bg-indigo-950 border-indigo-500 ring-2 ring-indigo-500'
                                : 'border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/40 dark:bg-indigo-950/30 hover:border-blue-400'
                            }`}
                            title="সমান্তরাল (Parallel) ক্লাস — একই পিরিয়ডে চলমান"
                          >
                            {slotEntries.map(entry => {
                              const subject = subjectMap.get(entry.subjectId);
                              const teacher = teacherMap.get(entry.teacherId);
                              const hasConflict = conflictEntryIds.has(entry.id);
                              return (
                                <div
                                  key={entry.id}
                                  className={`group/item flex items-center justify-between gap-1 px-1.5 py-0.5 rounded text-left text-[10px] ${
                                    hasConflict
                                      ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200'
                                      : 'bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100'
                                  }`}
                                >
                                  <div className="flex items-center gap-1 min-w-0">
                                    <span
                                      className="w-1.5 h-1.5 rounded-full shrink-0"
                                      style={{ backgroundColor: subject?.color || '#3B82F6' }}
                                    />
                                    <span className="font-bold truncate">
                                      {subject?.code || subject?.name}
                                    </span>
                                    <span className="text-[9px] text-slate-500 dark:text-slate-400 shrink-0">
                                      ({teacher?.initials || '—'})
                                    </span>
                                  </div>
                                  {!readOnly && !isSwapMode && (
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        onClearSlot(entry.id);
                                      }}
                                      title="Remove this parallel class"
                                      className="no-print hidden group-hover/item:block p-0.5 text-slate-400 hover:text-rose-600 rounded shrink-0"
                                    >
                                      <Trash2 className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : readOnly ? (
                          <div className="w-full h-14 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center text-xs text-slate-300 dark:text-slate-700">
                            —
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSlotClick(day, period.periodIndex)}
                            className={`w-full h-14 rounded-lg border border-dashed transition-all flex flex-col items-center justify-center gap-0.5 text-xs ${
                              isSelectedSwapSource
                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 ring-2 ring-indigo-500'
                                : isSwapMode
                                ? 'border-indigo-300 dark:border-indigo-800 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 text-indigo-500'
                                : 'border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 text-slate-400 hover:text-blue-600'
                            }`}
                          >
                            {isSwapMode ? (
                              <span className="text-[10px] font-medium">এখানে সরান</span>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" />
                                <span className="text-[10px]">Assign</span>
                              </>
                            )}
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
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Subject Allocation for {selectedClass?.name} · {selectedSection?.name}
            {!isPlayNur && selectedSection?.selectedSubjectIds !== undefined && (
              <span className="ml-2 text-blue-600 dark:text-blue-400 normal-case font-medium">
                (সেকশন-নির্বাচিত: {effectiveReqs.length} বিষয়)
              </span>
            )}
          </div>
          {!readOnly && (
            <div className="no-print flex items-center gap-2 flex-wrap">
              {!isPlayNur && onUpdateSectionSubjects && (
                <button
                  type="button"
                  onClick={() => setShowSectionSubjectPicker(prev => !prev)}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg border flex items-center gap-1.5 transition-colors ${
                    showSectionSubjectPicker
                      ? 'bg-blue-700 text-white border-blue-700'
                      : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>সেকশন বিষয় নির্বাচন ({selectedSection?.name})</span>
                </button>
              )}
              {onOpenSubjectMgmt && (
                <button
                  type="button"
                  onClick={onOpenSubjectMgmt}
                  className="text-xs font-semibold text-blue-700 dark:text-blue-300 hover:text-blue-800 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 border border-blue-200 dark:border-blue-900 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors"
                  title="Add new subjects or change subjects for this class"
                >
                  <Edit className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Edit / Add Subjects</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Inline Section-wise Subject Selection Drawer */}
        {!readOnly && !isPlayNur && showSectionSubjectPicker && selectedClass && selectedSection && onUpdateSectionSubjects && (
          <div className="no-print mb-4 p-3.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-xs text-slate-800 dark:text-slate-200">
                <strong>{selectedClass.name} · {selectedSection.name}</strong>-এর জন্য বিষয় নির্বাচন করুন — শুধুমাত্র টিক দেওয়া বিষয়গুলোই এই সেকশনের রুটিনে বসবে:
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSectionSubjects(
                      selectedClass.id,
                      selectedSection.id,
                      selectedClass.subjectRequirements.map(r => r.subjectId)
                    )
                  }
                  className="px-2 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                >
                  সব নির্বাচন
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSectionSubjects(selectedClass.id, selectedSection.id, undefined)}
                  className="px-2 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-50"
                >
                  ডিফল্ট
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {selectedClass.subjectRequirements.map(req => {
                const sub = subjectMap.get(req.subjectId);
                if (!sub) return null;
                const isSelected = selectedSectionSubSet.has(req.subjectId);
                const effReq = effectiveReqs.find(r => r.subjectId === req.subjectId);
                const secPeriods = effReq?.periodsPerWeek ?? req.periodsPerWeek;
                const secTeacherId = effReq?.assignedTeacherId ?? '';
                const nonBlockTeachers = teachers.filter(t => !isTeacherBlockTeacher(t, classes));
                const qualified = nonBlockTeachers.filter(t => t.subjectIds.includes(req.subjectId));

                return (
                  <div
                    key={req.subjectId}
                    className={`p-2.5 rounded-lg border text-xs space-y-2 transition-colors ${
                      isSelected
                        ? 'bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-800 text-slate-900 dark:text-white'
                        : 'bg-slate-100/70 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 min-w-0 cursor-pointer flex-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSubjectForActiveSection(req.subjectId)}
                          className="w-3.5 h-3.5 rounded text-blue-600 border-slate-300 focus:ring-blue-500 shrink-0"
                        />
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: sub.color }}
                        />
                        <span className="font-semibold truncate">{sub.name}</span>
                      </label>
                      {isSelected && onUpdateSectionSubjectConfig && (
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={12}
                            value={secPeriods}
                            onChange={e =>
                              onUpdateSectionSubjectConfig(
                                selectedClass.id,
                                selectedSection.id,
                                req.subjectId,
                                { periodsPerWeek: Number(e.target.value) }
                              )
                            }
                            className="w-12 px-1.5 py-0.5 text-center font-mono text-[11px] font-bold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white"
                            title="Weekly periods for this section only"
                          />
                          <span className="text-[10px] text-slate-400">/wk</span>
                        </div>
                      )}
                    </div>

                    {isSelected && onUpdateSectionSubjectConfig && (
                      <select
                        value={secTeacherId}
                        onChange={e =>
                          onUpdateSectionSubjectConfig(
                            selectedClass.id,
                            selectedSection.id,
                            req.subjectId,
                            { assignedTeacherId: e.target.value }
                          )
                        }
                        className="w-full px-2 py-1 text-[11px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                        title="Assigned teacher for this section only"
                      >
                        <option value="">Any Qualified Teacher</option>
                        {qualified.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.initials})
                          </option>
                        ))}
                        {nonBlockTeachers
                          .filter(t => !qualified.some(q => q.id === t.id))
                          .map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.initials}) [Other]
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isPlayNur ? (
          <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-indigo-900 dark:text-indigo-200">
              <div className="font-bold">ব্লক টিচার মডেল (সকল বিষয়) — {selectedClass?.name}</div>
              <p className="text-[11px] text-indigo-700 dark:text-indigo-300 mt-0.5">
                এই শ্রেণিতে কোনো আলাদা সাবজেক্ট নেই; নির্ধারিত ২ জন ব্লক টিচার মর্নিং ও ডে শিফটে সকল বিষয় পড়ান (অন্য কোনো ক্লাস বা প্রক্সি ক্লাসে যুক্ত নন)।
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(selectedClass?.blockTeacherIds || []).map((bId, idx) => {
                const t = teacherMap.get(bId);
                if (!t) return null;
                return (
                  <span
                    key={bId}
                    className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold text-indigo-900 dark:text-indigo-100"
                  >
                    ব্লক শিক্ষক {idx + 1}: {t.name} ({t.initials})
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {effectiveReqs.map(req => {
              const subject = subjectMap.get(req.subjectId);
              const teacher = req.assignedTeacherId ? teacherMap.get(req.assignedTeacherId) : null;
              const scheduledCount = sectionEntries.filter(e => e.subjectId === req.subjectId).length;
              const targetPeriods = getEffectiveTargetPeriods(req.subjectId, req.periodsPerWeek);
              const isOver = scheduledCount > targetPeriods;
              const isExact = scheduledCount === targetPeriods;

              return (
                <div
                  key={req.subjectId}
                  className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 ${
                    isOver
                      ? 'border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/30'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40'
                  }`}
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
                    <div
                      className={`text-xs font-mono font-semibold tabular-nums ${
                        isOver
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {scheduledCount} / {targetPeriods}
                    </div>
                    {isOver ? (
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold">
                        +{scheduledCount - targetPeriods} বেশি
                      </span>
                    ) : isExact ? (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 justify-end">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        <span>Exact</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">
                        {targetPeriods - scheduledCount} কম
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
