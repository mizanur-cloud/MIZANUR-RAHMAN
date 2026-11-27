import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Wand2,
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
  Grid3X3,
  LayoutList,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  Clock,
} from 'lucide-react';
import { useViewMode } from '../context/ViewModeContext';
import { BENGALI_DAY_NAMES, isSlotDismissed, getTierBadgeInfo } from '../services/scheduleTiers';
import { resolveLiveSlotStatus } from '../services/livePeriodClock';
import { exportSectionDocx } from '../services/exportDocx';
import { exportSectionPdf } from '../services/exportPdf';
import { AppState } from '../services/storage';
import {
  getEffectiveSectionRequirements,
  getEffectiveSubjectFixedPeriods,
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
    patch: { periodsPerWeek?: number; assignedTeacherId?: string; fixedPeriodIndices?: number[] }
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

  const subjectMap = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects]);
  const teacherMap = useMemo(() => new Map(teachers.map(t => [t.id, t])), [teachers]);

  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isSwapMode, setIsSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState<{ day: DayOfWeek; periodIndex: number } | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [showSectionSubjectPicker, setShowSectionSubjectPicker] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const { isMobileView } = useViewMode();
  const [mobileFormat, setMobileFormat] = useState<'cards' | 'grid'>('cards');
  const [mobileDay, setMobileDay] = useState<DayOfWeek>(() => {
    const todayMap: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = todayMap[new Date().getDay()];
    return workingDays.includes(today) ? today : workingDays[0] || 'Sunday';
  });
  const [now, setNow] = useState<Date>(() => new Date());
  const touchStartXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isMobileView) return;
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, [isMobileView]);

  const activeMobileDay = workingDays.includes(mobileDay) ? mobileDay : workingDays[0] || 'Sunday';
  const activeTeachingPeriods = periodTimings.filter(p => !p.isBreak && !p.isLocked);
  const liveStatus = resolveLiveSlotStatus(periodTimings, workingDays, now);

  const stepMobileDay = (delta: number) => {
    if (workingDays.length === 0) return;
    const idx = workingDays.indexOf(activeMobileDay);
    const cur = idx === -1 ? 0 : idx;
    const next = (cur + delta + workingDays.length) % workingDays.length;
    setMobileDay(workingDays[next]);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const diff = endX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(diff) > 48) {
      stepMobileDay(diff < 0 ? 1 : -1);
    }
  };

  const sectionEntries = useMemo(
    () =>
      entries.filter(
        e => e.classId === selectedClass?.id && e.sectionId === selectedSection?.id
      ),
    [entries, selectedClass?.id, selectedSection?.id]
  );

  const sectionCountBySectionId = useMemo(() => {
    const map = new Map<string, number>();
    if (!selectedClass) return map;
    for (const e of entries) {
      if (e.classId === selectedClass.id) {
        map.set(e.sectionId, (map.get(e.sectionId) || 0) + 1);
      }
    }
    return map;
  }, [entries, selectedClass]);

  const { sectionEntrySlotMap, sectionEntryDayCountMap, subjectCountMap } = useMemo(() => {
    const slotMap = new Map<string, TimetableEntry[]>();
    const dayCounts = new Map<DayOfWeek, number>();
    const subCounts = new Map<string, number>();
    for (const e of sectionEntries) {
      const key = `${e.day}_${e.periodIndex}`;
      const list = slotMap.get(key);
      if (list) list.push(e);
      else slotMap.set(key, [e]);
      dayCounts.set(e.day, (dayCounts.get(e.day) || 0) + 1);
      subCounts.set(e.subjectId, (subCounts.get(e.subjectId) || 0) + 1);
    }
    return {
      sectionEntrySlotMap: slotMap,
      sectionEntryDayCountMap: dayCounts,
      subjectCountMap: subCounts,
    };
  }, [sectionEntries]);

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

  const conflictEntryIds = useMemo(() => {
    const set = new Set<string>();
    conflicts.forEach(c => c.entryIds.forEach(id => set.add(id)));
    return set;
  }, [conflicts]);

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
    <div className={isMobileView ? 'space-y-3.5' : 'space-y-5'}>
      {isMobileView ? (
        /* Compact Mobile Unified Class + Section & Action Header */
        <div className="no-print bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-3.5 space-y-3">
          {/* Class Horizontal Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
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
                  className={`min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-[#145343] text-white'
                      : 'text-stone-700 dark:text-slate-200 bg-[#f7f5f0] dark:bg-slate-800 hover:bg-stone-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>{c.name}</span>
                  <span
                    className={`font-mono text-[10px] tabular-nums ${
                      isSelected ? 'text-emerald-200' : 'text-stone-400 dark:text-slate-500'
                    }`}
                  >
                    {c.sections.length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Section / Shift Horizontal Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-1 border-t border-stone-100 dark:border-slate-800/80">
            <span className="text-[11px] font-semibold text-stone-400 dark:text-slate-500 shrink-0 mr-1">
              {selectedClass?.usesShifts || isPlayNur ? 'শিফট:' : 'শাখা:'}
            </span>
            {selectedClass?.sections.map(sec => {
              const isSelected = sec.id === selectedSection?.id;
              const secCount = sectionCountBySectionId.get(sec.id) || 0;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => {
                    setSelectedSectionId(sec.id);
                    setSwapSource(null);
                    setSwapError(null);
                  }}
                  className={`min-h-[36px] px-3 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-[#145343] text-white'
                      : 'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300'
                  }`}
                >
                  <span>{sec.name}</span>
                  <span className={`font-mono text-[10px] tabular-nums ${isSelected ? 'text-emerald-200' : 'text-stone-400'}`}>
                    {secCount}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Compact Summary Strip + Tools Toggle */}
          <div className="pt-2 border-t border-stone-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] text-stone-500 dark:text-slate-400 truncate">
              <span className="font-semibold text-stone-800 dark:text-slate-200">
                রুম {selectedSection?.roomNumber || 'Standard'}
              </span>
              <span> · </span>
              <span className="font-mono tabular-nums font-semibold text-[#145343] dark:text-emerald-400">
                {totalAssignedPeriods}/{totalRequiredPeriods}
              </span>
              <span> পিরিয়ড</span>
            </div>

            <button
              type="button"
              onClick={() => setShowMobileActions(prev => !prev)}
              className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors shrink-0 ${
                showMobileActions || isSwapMode
                  ? 'bg-[#eef5f2] dark:bg-emerald-950/60 border-[#bfd5cc] dark:border-emerald-800 text-[#145343] dark:text-emerald-300'
                  : 'bg-stone-50 dark:bg-slate-800 border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>টুলস ও এক্সপোর্ট</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMobileActions ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Expandable Mobile Actions & Exports */}
          {showMobileActions && (
            <div className="pt-2 border-t border-stone-100 dark:border-slate-800/80 grid grid-cols-2 gap-2">
              {!readOnly && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSwapMode(prev => !prev);
                      setSwapSource(null);
                      setSwapError(null);
                    }}
                    className={`min-h-[40px] px-3 py-2 text-xs font-semibold rounded-xl border transition-colors flex items-center justify-center gap-1.5 ${
                      isSwapMode
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800'
                    }`}
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>{isSwapMode ? 'বদল মোড চালু' : 'স্লট বদল'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (selectedClass && selectedSection) {
                        onAutoGenerateSection(selectedClass.id, selectedSection.id);
                      }
                    }}
                    className="min-h-[40px] px-3 py-2 text-xs font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/60 border border-[#bfd5cc] dark:border-emerald-800 rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>Auto-Fill শাখা</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (selectedClass) {
                        onAutoGenerateClass(selectedClass.id);
                      }
                    }}
                    className="min-h-[40px] px-3 py-2 text-xs font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 rounded-xl flex items-center justify-center gap-1.5 col-span-2"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>সম্পূর্ণ {selectedClass?.name} Auto-Fill</span>
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
                className="min-h-[40px] px-3 py-2 text-xs font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 rounded-xl flex items-center justify-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5 text-[#145343] dark:text-emerald-400" />
                <span>Word (.docx)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (selectedClass && selectedSection) {
                    void exportSectionPdf(selectedClass.id, selectedSection.id, fullAppState);
                  }
                }}
                className="min-h-[40px] px-3 py-2 text-xs font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 rounded-xl flex items-center justify-center gap-1.5"
              >
                <FileCheck className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" />
                <span>PDF গ্রিড</span>
              </button>

              {!readOnly && (
                isConfirmingClear ? (
                  <div className="col-span-2 flex items-center justify-between gap-2 bg-rose-50 dark:bg-rose-950/50 p-2 rounded-xl border border-rose-200 dark:border-rose-800">
                    <span className="text-xs text-rose-700 dark:text-rose-300 font-semibold px-1">
                      এই শাখার রুটিন মুছবেন?
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedClass && selectedSection) {
                            onClearSection(selectedClass.id, selectedSection.id);
                          }
                          setIsConfirmingClear(false);
                        }}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 rounded-lg"
                      >
                        হ্যাঁ
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsConfirmingClear(false)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 rounded-lg"
                      >
                        না
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsConfirmingClear(true)}
                    className="col-span-2 min-h-[40px] px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>এই শাখার রুটিন খালি করুন</span>
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ) : (
        <>
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
                        ? 'bg-[#145343] text-white font-semibold'
                        : 'text-stone-700 dark:text-slate-200 bg-[#f7f5f0] dark:bg-slate-800 hover:bg-stone-100 dark:hover:bg-slate-700/70'
                    }`}
                  >
                    <span>{c.name}</span>
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        isSelected ? 'text-emerald-200' : 'text-stone-400 dark:text-slate-500'
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
                  const secCount = sectionCountBySectionId.get(sec.id) || 0;

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
                          ? 'bg-[#145343] text-white'
                          : 'bg-[#f7f5f0] dark:bg-slate-800 text-stone-700 dark:text-slate-300 hover:bg-stone-200 dark:hover:bg-slate-700'
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
                          isSelected ? 'text-emerald-100' : 'text-stone-500 dark:text-slate-400'
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
                      className="px-3 py-1.5 text-xs font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/60 hover:bg-[#dfece6] dark:hover:bg-emerald-900/50 border border-[#bfd5cc] dark:border-emerald-800 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
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
                      className="px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
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
                  className="px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
                  title="Download Section Routine Grid in Microsoft Word format"
                >
                  <FileText className="w-3.5 h-3.5 text-[#145343] dark:text-emerald-400" />
                  <span>Word</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (selectedClass && selectedSection) {
                      void exportSectionPdf(selectedClass.id, selectedSection.id, fullAppState);
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
                  title="Download Section Routine Grid in PDF format"
                >
                  <FileCheck className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" />
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
                <div className="w-24 bg-stone-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#145343] dark:bg-emerald-500 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (totalAssignedPeriods / (totalRequiredPeriods || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

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

      {/* Mobile Now / Next Contextual Card + Format Switcher */}
      {isMobileView && (
        <div className="space-y-3">
          {liveStatus.isWorkingDay && (liveStatus.currentWindow || liveStatus.nextWindow) && (() => {
            const curWin = liveStatus.currentWindow;
            const nextWin = liveStatus.nextWindow;
            const curEntries = curWin
              ? sectionEntrySlotMap.get(`${liveStatus.todayEnum}_${curWin.period.periodIndex}`) || []
              : [];
            const nextEntries = nextWin
              ? sectionEntrySlotMap.get(`${liveStatus.todayEnum}_${nextWin.period.periodIndex}`) || []
              : [];
            const curDismissed = curWin && selectedClass
              ? isSlotDismissed(selectedClass, liveStatus.todayEnum, curWin.period.periodIndex, selectedSectionId, workingDays)
              : false;

            return (
              <div className="bg-[#eef5f2]/90 dark:bg-emerald-950/35 border border-[#bfd5cc] dark:border-emerald-800/70 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[#145343] dark:text-emerald-300">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>আজকের এখন ও পরবর্তী ({BENGALI_DAY_NAMES[liveStatus.todayEnum]})</span>
                  </span>
                  {liveStatus.remainingMinutes !== null && (
                    <span className="font-mono tabular-nums">
                      বাকি {liveStatus.remainingMinutes} মি.
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-1.5">
                  {curWin && (
                    <div className="bg-white/85 dark:bg-slate-900/80 rounded-xl px-3 py-2 flex items-center justify-between gap-2 border border-emerald-200/70 dark:border-emerald-900/50">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                          চলমান · {curWin.period.label}
                        </div>
                        <div className="text-xs font-bold text-stone-900 dark:text-white truncate">
                          {curWin.period.isBreak || curWin.period.isLocked
                            ? 'টিফিন বিরতি'
                            : curDismissed
                            ? 'ছুটি (Class Off)'
                            : curEntries.length > 0
                            ? curEntries.map(e => subjectMap.get(e.subjectId)?.name || 'ক্লাস').join(' / ')
                            : 'নির্ধারিত ক্লাস নেই'}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-stone-500 dark:text-slate-400 tabular-nums shrink-0">
                        {curEntries[0] ? teacherMap.get(curEntries[0].teacherId)?.initials || '' : `${curWin.period.startTime}–${curWin.period.endTime}`}
                      </div>
                    </div>
                  )}

                  {nextWin && (
                    <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-3 py-2 flex items-center justify-between gap-2 border border-stone-200/70 dark:border-slate-800">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                          পরবর্তী · {nextWin.period.label}
                        </div>
                        <div className="text-xs font-semibold text-stone-800 dark:text-slate-200 truncate">
                          {nextEntries.length > 0
                            ? nextEntries.map(e => subjectMap.get(e.subjectId)?.name || 'ক্লাস').join(' / ')
                            : 'ফ্রি / নির্ধারিত নেই'}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-stone-500 dark:text-slate-400 tabular-nums shrink-0">
                        {nextWin.period.startTime}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="no-print flex items-center justify-between gap-2 bg-white dark:bg-slate-900 rounded-xl border border-stone-200 dark:border-slate-800 px-3 py-2">
            <span className="text-xs font-semibold text-stone-600 dark:text-slate-300">
              ভিউ ধরন
            </span>
            <div className="flex items-center p-0.5 bg-stone-100 dark:bg-slate-800 rounded-lg border border-stone-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setMobileFormat('cards')}
                className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1 transition-colors ${
                  mobileFormat === 'cards'
                    ? 'bg-white dark:bg-slate-700 text-[#145343] dark:text-emerald-300 shadow-2xs'
                    : 'text-stone-600 dark:text-slate-400'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
                <span>টাইমলাইন</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileFormat('grid')}
                className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1 transition-colors ${
                  mobileFormat === 'grid'
                    ? 'bg-white dark:bg-slate-700 text-[#145343] dark:text-emerald-300 shadow-2xs'
                    : 'text-stone-600 dark:text-slate-400'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                <span>পূর্ণ গ্রিড</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Day-by-Day Swipeable Agenda Timeline */}
      {isMobileView && mobileFormat === 'cards' ? (
        <div
          className="space-y-2.5"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Day Stepper Header */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => stepMobileDay(-1)}
                aria-label="পূর্ববর্তী দিন"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-200 hover:bg-stone-200 dark:hover:bg-slate-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="text-center min-w-0">
                <div className="text-sm font-bold text-stone-900 dark:text-white truncate">
                  {BENGALI_DAY_NAMES[activeMobileDay] || activeMobileDay}
                  {liveStatus.isWorkingDay && activeMobileDay === liveStatus.todayEnum && (
                    <span className="text-xs font-semibold text-[#145343] dark:text-emerald-400"> · আজ</span>
                  )}
                </div>
                <div className="text-[11px] text-stone-500 dark:text-slate-400 font-mono tabular-nums">
                  {sectionEntryDayCountMap.get(activeMobileDay) || 0} টি ক্লাস নির্ধারিত · সোয়াইপ করুন
                </div>
              </div>

              <button
                type="button"
                onClick={() => stepMobileDay(1)}
                aria-label="পরবর্তী দিন"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-200 hover:bg-stone-200 dark:hover:bg-slate-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Compact Day Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
              {workingDays.map(day => {
                const active = day === activeMobileDay;
                const shortBn = BENGALI_DAY_NAMES[day]?.replace('বার', '') || day.slice(0, 3);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setMobileDay(day)}
                    className={`min-h-[36px] flex-1 px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
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
          </div>

          {/* Vertical Agenda Timeline */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 divide-y divide-stone-100 dark:divide-slate-800 overflow-hidden">
            {allDisplayPeriods.map(period => {
              const isBreak = period.isBreak || period.isLocked;
              const isDismissed = selectedClass
                ? isSlotDismissed(selectedClass, activeMobileDay, period.periodIndex, selectedSectionId, workingDays)
                : false;
              const isLivePeriod =
                liveStatus.isWorkingDay &&
                activeMobileDay === liveStatus.todayEnum &&
                liveStatus.currentWindow?.period.periodIndex === period.periodIndex;

              if (isBreak) {
                return (
                  <div
                    key={period.periodIndex}
                    className={`px-3.5 py-3 flex items-center gap-3 ${
                      isLivePeriod
                        ? 'bg-amber-100/70 dark:bg-amber-950/40'
                        : 'bg-amber-50/55 dark:bg-amber-950/20'
                    }`}
                  >
                    <div className="w-16 shrink-0 font-mono tabular-nums">
                      <div className="text-[11px] font-bold text-amber-900 dark:text-amber-300">{period.startTime}</div>
                      <div className="text-[10px] text-amber-700/80 dark:text-amber-400/70">{period.endTime}</div>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        টিফিন বিরতি
                      </span>
                      <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        {isLivePeriod ? 'চলমান বিরতি' : 'বিরতি'}
                      </span>
                    </div>
                  </div>
                );
              }

              if (isDismissed) {
                return (
                  <div
                    key={period.periodIndex}
                    className="px-3.5 py-3 bg-stone-50/70 dark:bg-slate-900/40 flex items-center gap-3 text-stone-400 dark:text-slate-500"
                  >
                    <div className="w-16 shrink-0 font-mono tabular-nums">
                      <div className="text-[11px] font-semibold">{period.startTime}</div>
                      <div className="text-[10px]">{period.endTime}</div>
                    </div>
                    <div className="w-2 h-2 rounded-full border border-stone-300 dark:border-slate-600 shrink-0" />
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{period.label}</span>
                      <span className="text-xs">ছুটি (Class Off)</span>
                    </div>
                  </div>
                );
              }

              const slotEntries =
                sectionEntrySlotMap.get(`${activeMobileDay}_${period.periodIndex}`) || [];
              const isSelectedSwap =
                isSwapMode && swapSource?.day === activeMobileDay && swapSource?.periodIndex === period.periodIndex;
              const primaryColor = slotEntries[0] ? subjectMap.get(slotEntries[0].subjectId)?.color || '#145343' : undefined;

              return (
                <div
                  key={period.periodIndex}
                  onClick={() => handleSlotClick(activeMobileDay, period.periodIndex)}
                  className={`px-3.5 py-3.5 flex items-center gap-3 transition-colors ${
                    readOnly ? '' : 'cursor-pointer active:bg-stone-50 dark:active:bg-slate-800/60'
                  } ${
                    isSelectedSwap
                      ? 'bg-indigo-50 dark:bg-indigo-950/50 ring-2 ring-inset ring-indigo-500'
                      : isLivePeriod
                      ? 'bg-[#eef5f2]/65 dark:bg-emerald-950/30'
                      : ''
                  }`}
                >
                  {/* Tabular Start / End Column */}
                  <div className="w-16 shrink-0 font-mono tabular-nums">
                    <div className={`text-[11px] font-bold ${isLivePeriod ? 'text-[#145343] dark:text-emerald-300' : 'text-stone-800 dark:text-slate-200'}`}>
                      {period.startTime}
                    </div>
                    <div className="text-[10px] text-stone-400 dark:text-slate-500">
                      {period.endTime}
                    </div>
                  </div>

                  {/* Timeline Dot */}
                  <div
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      isLivePeriod
                        ? 'ring-4 ring-emerald-500/20 bg-[#145343] dark:bg-emerald-400'
                        : slotEntries.length === 0
                        ? 'border border-stone-300 dark:border-slate-600'
                        : ''
                    }`}
                    style={!isLivePeriod && primaryColor ? { backgroundColor: primaryColor } : undefined}
                  />

                  {/* Main Card Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 text-[11px] mb-0.5">
                      <span className="font-semibold text-stone-500 dark:text-slate-400">
                        {period.label}
                      </span>
                      {isLivePeriod && liveStatus.remainingMinutes !== null && (
                        <span className="font-semibold text-[#145343] dark:text-emerald-400 font-mono tabular-nums">
                          চলমান · {liveStatus.remainingMinutes}মি বাকি
                        </span>
                      )}
                    </div>

                    {slotEntries.length === 0 ? (
                      <div className="text-xs text-stone-400 dark:text-slate-500 py-0.5">
                        {readOnly ? 'নির্ধারিত ক্লাস নেই' : '+ বিষয় ও শিক্ষক যুক্ত করুন'}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {slotEntries.map(entry => {
                          const sub = subjectMap.get(entry.subjectId);
                          const tch = teacherMap.get(entry.teacherId);
                          const hasConflict = conflictEntryIds.has(entry.id);
                          return (
                            <div
                              key={entry.id}
                              className={`flex items-center justify-between gap-2 ${
                                hasConflict ? 'text-amber-700 dark:text-amber-300' : ''
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-stone-900 dark:text-white truncate">
                                  {sub?.name || 'Class'}
                                </div>
                                <div className="text-xs text-stone-600 dark:text-slate-300 truncate">
                                  {tch?.name ? `${tch.name} (${tch.initials})` : 'শিক্ষক নির্ধারিত নয়'}
                                  {entry.room ? ` · রুম ${entry.room}` : ''}
                                </div>
                              </div>
                              {!readOnly && !isSwapMode && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    onClearSlot(entry.id);
                                  }}
                                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0 -mr-2"
                                  title="মুছে ফেলুন"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
      /* Desktop Weekly Timetable Grid */
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

                    const slotEntries =
                      sectionEntrySlotMap.get(`${day}_${period.periodIndex}`) || [];

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
      )}

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
                      <>
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
                        {(() => {
                          const effectiveFixed = getEffectiveSubjectFixedPeriods(
                            selectedClass,
                            selectedSection.id,
                            req.subjectId,
                            subjects
                          );
                          const hasParentDefault = Boolean(
                            req.fixedPeriodIndices !== undefined
                              ? req.fixedPeriodIndices.length > 0
                              : sub.fixedPeriodIndices && sub.fixedPeriodIndices.length > 0
                          );
                          const toggleFixed = (pIdx: number) => {
                            const cur = effectiveFixed || [];
                            const next = cur.includes(pIdx)
                              ? cur.filter(p => p !== pIdx)
                              : [...cur, pIdx].sort((a, b) => a - b);
                            onUpdateSectionSubjectConfig(
                              selectedClass.id,
                              selectedSection.id,
                              req.subjectId,
                              {
                                fixedPeriodIndices:
                                  next.length > 0 ? next : hasParentDefault ? [] : undefined,
                              }
                            );
                          };
                          const maxPossibleInFixed =
                            effectiveFixed && effectiveFixed.length > 0
                              ? effectiveFixed.length * workingDays.length
                              : null;
                          return (
                            <>
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <span className="text-[10px] text-slate-500 mr-0.5">নির্দিষ্ট:</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onUpdateSectionSubjectConfig(
                                      selectedClass.id,
                                      selectedSection.id,
                                      req.subjectId,
                                      { fixedPeriodIndices: hasParentDefault ? [] : undefined }
                                    )
                                  }
                                  className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                                    !effectiveFixed || effectiveFixed.length === 0
                                      ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900'
                                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  যেকোনো
                                </button>
                                {activeTeachingPeriods.map(tp => {
                                  const isPinned = effectiveFixed?.includes(tp.periodIndex);
                                  return (
                                    <button
                                      key={tp.periodIndex}
                                      type="button"
                                      onClick={() => toggleFixed(tp.periodIndex)}
                                      className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border ${
                                        isPinned
                                          ? 'bg-blue-700 text-white border-blue-700'
                                          : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                                      }`}
                                    >
                                      P{tp.periodIndex}
                                    </button>
                                  );
                                })}
                              </div>
                              {maxPossibleInFixed !== null && maxPossibleInFixed < secPeriods && (
                                <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                  সর্বোচ্চ {maxPossibleInFixed} ক্লাস সম্ভব ({secPeriods}টি চাই)
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </>
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
          <div className={isMobileView ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5'}>
            {effectiveReqs.map(req => {
              const subject = subjectMap.get(req.subjectId);
              const teacher = req.assignedTeacherId ? teacherMap.get(req.assignedTeacherId) : null;
              const scheduledCount = subjectCountMap.get(req.subjectId) || 0;
              const targetPeriods = getEffectiveTargetPeriods(req.subjectId, req.periodsPerWeek);
              const isOver = scheduledCount > targetPeriods;
              const isExact = scheduledCount === targetPeriods;

              const effectiveFixed =
                selectedClass && selectedSection
                  ? getEffectiveSubjectFixedPeriods(
                      selectedClass,
                      selectedSection.id,
                      req.subjectId,
                      subjects
                    )
                  : undefined;

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
                    {effectiveFixed && effectiveFixed.length > 0 && (
                      <div className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 mt-0.5">
                        নির্দিষ্ট পিরিয়ড: {effectiveFixed.map(p => `P${p}`).join(', ')}
                      </div>
                    )}
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
