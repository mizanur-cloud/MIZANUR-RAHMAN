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
  LayoutList,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  Clock,
} from 'lucide-react';
import { useViewMode } from '../context/ViewModeContext';
import { BENGALI_DAY_NAMES } from '../services/scheduleTiers';
import { resolveLiveSlotStatus } from '../services/livePeriodClock';
import { exportAllTeachersDocx, exportTeacherDocx } from '../services/exportDocx';
import { exportAllTeachersPdf, exportTeacherPdf } from '../services/exportPdf';
import { AppState } from '../services/storage';
import {
  getCombinedHinduRoom,
  getCombinedHinduTeacherId,
  getEffectiveSectionRequirements,
  isHinduReligionRoom,
  isHinduReligionSubject,
  isTeacherBlockTeacher,
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

  const selectedTeacher =
    teachers.find(t => t.id === selectedTeacherId) || teachers[0];

  const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);
  const subjectMap = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects]);
  const allDisplayPeriods = periodTimings;
  const combinedHinduRoom = getCombinedHinduRoom(settings);

  const teacherPhysicalCountMap = useMemo(() => {
    const slotSets = new Map<string, Set<string>>();
    for (const e of entries) {
      let set = slotSets.get(e.teacherId);
      if (!set) {
        set = new Set<string>();
        slotSets.set(e.teacherId, set);
      }
      set.add(`${e.day}_${e.periodIndex}`);
    }
    const countMap = new Map<string, number>();
    slotSets.forEach((set, tid) => countMap.set(tid, set.size));
    return countMap;
  }, [entries]);

  const filteredTeachers = useMemo(
    () =>
      teachers.filter(
        t =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.initials.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [teachers, searchQuery]
  );

  const teacherEntries = useMemo(
    () => entries.filter(e => e.teacherId === selectedTeacher?.id),
    [entries, selectedTeacher?.id]
  );

  const teacherSlotMap = useMemo(() => {
    const map = new Map<string, TimetableEntry[]>();
    for (const e of teacherEntries) {
      const k = `${e.day}_${e.periodIndex}`;
      const list = map.get(k);
      if (list) list.push(e);
      else map.set(k, [e]);
    }
    return map;
  }, [teacherEntries]);

  const physicalPeriodCount = selectedTeacher
    ? teacherPhysicalCountMap.get(selectedTeacher.id) || 0
    : 0;

  const dayOrder = useMemo(() => {
    const order: Record<string, number> = {};
    workingDays.forEach((d, idx) => (order[d] = idx));
    return order;
  }, [workingDays]);

  const sortedEntries = useMemo(
    () =>
      [...teacherEntries].sort((a, b) => {
        const dDiff = (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99);
        if (dDiff !== 0) return dDiff;
        return a.periodIndex - b.periodIndex;
      }),
    [teacherEntries, dayOrder]
  );

  const teacherConflicts = useMemo(
    () =>
      conflicts.filter(
        c =>
          c.teacherId === selectedTeacher?.id ||
          c.entryIds.some(id => teacherEntries.some(e => e.id === id))
      ),
    [conflicts, selectedTeacher?.id, teacherEntries]
  );

  const conflictEntryIdSet = useMemo(() => {
    const set = new Set<string>();
    teacherConflicts.forEach(c => c.entryIds.forEach(id => set.add(id)));
    return set;
  }, [teacherConflicts]);

  const dailyLoad = useMemo(() => {
    const load: Record<string, number> = {};
    workingDays.forEach(d => {
      load[d] = new Set(teacherEntries.filter(e => e.day === d).map(e => e.periodIndex)).size;
    });
    return load;
  }, [workingDays, teacherEntries]);

  const combinedHinduTeacherId = getCombinedHinduTeacherId(teachers, settings, subjects);
  let configuredTargetPeriods = 0;
  if (selectedTeacher && !selectedTeacher.isBlockTeacher) {
    classes.forEach(cls => {
      if (cls.usesShifts || cls.numericGrade < 0) return;
      cls.sections.forEach(sec => {
        getEffectiveSectionRequirements(cls, sec.id, teachers).forEach(req => {
          let expectedTch = req.assignedTeacherId;
          if (isHinduReligionSubject(req.subjectId, subjects) && combinedHinduTeacherId) {
            const secExplicit = sec.subjectConfigs?.[req.subjectId]?.assignedTeacherId;
            if (secExplicit === undefined) {
              expectedTch = combinedHinduTeacherId;
            }
          }
          if (expectedTch === selectedTeacher.id) {
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
    <div className={isMobileView ? 'space-y-3.5' : 'space-y-5'}>
      {isMobileView ? (
        /* Compact Mobile Teacher Selector + Workload + Collapsible Exports */
        <div className="no-print bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-3.5 space-y-3">
          {/* Search & Dropdown */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="শিক্ষক খুঁজুন (নাম বা সংক্ষিপ্ত নাম)..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs bg-[#f7f5f0] dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#145343]"
              />
            </div>

            <select
              value={selectedTeacher?.id}
              onChange={e => setSelectedTeacherId(e.target.value)}
              className="w-full min-h-[42px] py-2 px-3 text-xs bg-[#f7f5f0] dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl text-stone-900 dark:text-slate-100 font-semibold focus:outline-none"
            >
              {filteredTeachers.map(t => {
                const tCount = teacherPhysicalCountMap.get(t.id) || 0;
                return (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.initials}) · {tCount} পিরিয়ড
                  </option>
                );
              })}
            </select>
          </div>

          {/* Selected Teacher Compact Profile & Workload Row */}
          {selectedTeacher && (
            <div className="pt-2.5 border-t border-stone-100 dark:border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#eef5f2] dark:bg-emerald-950 text-[#145343] dark:text-emerald-300 font-bold flex items-center justify-center text-xs border border-[#bfd5cc] dark:border-emerald-800 shrink-0">
                    {selectedTeacher.initials}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-stone-900 dark:text-white truncate">
                      {selectedTeacher.name}
                    </h2>
                    <div className="text-[11px] text-stone-500 dark:text-slate-400 truncate">
                      {selectedTeacher.designation} ·{' '}
                      {teacherEntries.length > physicalPeriodCount ? (
                        <>
                          <span className="font-mono tabular-nums font-semibold text-[#145343] dark:text-emerald-400">
                            {physicalPeriodCount}
                          </span>{' '}
                          পিরিয়ড (
                          <span className="font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-300">
                            {teacherEntries.length}
                            {configuredTargetPeriods > 0 ? `/${configuredTargetPeriods}` : ''}
                          </span>{' '}
                          সেকশন)
                        </>
                      ) : (
                        <>
                          <span className="font-mono tabular-nums font-semibold text-[#145343] dark:text-emerald-400">
                            {physicalPeriodCount}
                            {configuredTargetPeriods > 0 ? `/${configuredTargetPeriods}` : ''}
                          </span>{' '}
                          পিরিয়ড
                        </>
                      )}
                      {' · '}
                      <span className="font-mono tabular-nums">
                        {Object.values(dailyLoad).filter(c => c > 0).length}/{workingDays.length}
                      </span>{' '}
                      দিন
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowMobileActions(prev => !prev)}
                  className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 border transition-colors shrink-0 ${
                    showMobileActions
                      ? 'bg-[#eef5f2] dark:bg-emerald-950/60 border-[#bfd5cc] dark:border-emerald-800 text-[#145343] dark:text-emerald-300'
                      : 'bg-stone-50 dark:bg-slate-800 border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-200'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>শেয়ার/ডাউনলোড</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMobileActions ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {showMobileActions && (
                <div className="pt-2 border-t border-stone-100 dark:border-slate-800/80 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCopyTeacherSchedule}
                    className={`min-h-[40px] px-3 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 ${
                      copiedSchedule
                        ? 'bg-emerald-600 text-white'
                        : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800'
                    }`}
                  >
                    {copiedSchedule ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedSchedule ? 'কপি হয়েছে!' : 'কপি রুটিন'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="min-h-[40px] px-3 py-2 text-xs font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>প্রিন্ট</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (selectedTeacher) {
                        exportTeacherDocx(selectedTeacher.id, fullAppState);
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
                      if (selectedTeacher) {
                        void exportTeacherPdf(selectedTeacher.id, fullAppState);
                      }
                    }}
                    className="min-h-[40px] px-3 py-2 text-xs font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <FileCheck className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" />
                    <span>PDF গ্রিড</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => exportAllTeachersDocx(fullAppState)}
                    className="min-h-[40px] px-3 py-2 text-xs font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/60 border border-[#bfd5cc] dark:border-emerald-800 rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>সকল শিক্ষক Word</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void exportAllTeachersPdf(fullAppState)}
                    className="min-h-[40px] px-3 py-2 text-xs font-semibold text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <FileCheck className="w-3.5 h-3.5" />
                    <span>সকল শিক্ষক PDF</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
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
                const tCount = teacherPhysicalCountMap.get(t.id) || 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTeacherId(t.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-[#145343] text-white font-semibold'
                        : 'text-stone-700 dark:text-slate-200 bg-[#f7f5f0] dark:bg-slate-800 hover:bg-stone-100 dark:hover:bg-slate-700/70'
                    }`}
                  >
                    <span>{t.name}</span>
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        isSelected ? 'text-emerald-200' : 'text-stone-400 dark:text-slate-500'
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
                    className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#145343]"
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
                  className="px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
                  title="Download teacher Grid routine in Word"
                >
                  <FileText className="w-3.5 h-3.5 text-[#145343] dark:text-emerald-400" />
                  <span>Word</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (selectedTeacher) {
                      void exportTeacherPdf(selectedTeacher.id, fullAppState);
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
                  title="Download teacher Grid routine in PDF"
                >
                  <FileCheck className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" />
                  <span>PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() => exportAllTeachersDocx(fullAppState)}
                  className="px-3 py-1.5 text-xs font-medium text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/60 hover:bg-[#dfece6] dark:hover:bg-emerald-900/50 border border-[#bfd5cc] dark:border-emerald-800 rounded-lg transition-colors flex items-center gap-1.5"
                  title="Export all teachers' Grid routines combined into one Word document"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>All Faculty Word</span>
                </button>

                <button
                  type="button"
                  onClick={() => void exportAllTeachersPdf(fullAppState)}
                  className="px-3 py-1.5 text-xs font-medium text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 rounded-lg transition-colors flex items-center gap-1.5"
                  title="Export all teachers' Grid routines combined into one PDF document"
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>All Faculty PDF</span>
                </button>
              </div>
            </div>
          </div>

          {/* Selected Teacher Profile & Workload Strip */}
          {selectedTeacher && (
            <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-[#eef5f2] dark:bg-emerald-950 text-[#145343] dark:text-emerald-300 font-bold flex items-center justify-center text-sm border border-[#bfd5cc] dark:border-emerald-800 shrink-0">
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
                      <span>
                        {isTeacherBlockTeacher(selectedTeacher, classes)
                          ? 'ব্লক টিচার (একটানা সীমা মুক্ত)'
                          : `Max Consecutive: ${selectedTeacher.maxConsecutivePeriods || 2}`}
                      </span>
                      <span>·</span>
                      <span>Max Days/Wk: {selectedTeacher.maxWorkingDays || 5}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-5 px-4 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 shrink-0">
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-slate-500">Weekly Periods</div>
                    <div className="text-base font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                      {physicalPeriodCount}
                      {teacherEntries.length > physicalPeriodCount ? (
                        <span className="text-xs font-normal text-amber-700 dark:text-amber-400 ml-1">
                          ({teacherEntries.length}
                          {configuredTargetPeriods > 0 ? `/${configuredTargetPeriods}` : ''} sec)
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
        </>
      )}

      {/* Mobile Now / Next Card & Format Switcher */}
      {isMobileView && (
        <div className="space-y-3">
          {liveStatus.isWorkingDay && (liveStatus.currentWindow || liveStatus.nextWindow) && (() => {
            const curWin = liveStatus.currentWindow;
            const nextWin = liveStatus.nextWindow;
            const curMatches = curWin
              ? teacherSlotMap.get(`${liveStatus.todayEnum}_${curWin.period.periodIndex}`) || []
              : [];
            const nextMatches = nextWin
              ? teacherSlotMap.get(`${liveStatus.todayEnum}_${nextWin.period.periodIndex}`) || []
              : [];

            const formatTeacherSlotSummary = (matches: TimetableEntry[]) => {
              if (matches.length === 0) return 'ফ্রি পিরিয়ড';
              const first = matches[0];
              const sub = subjectMap.get(first.subjectId);
              if (matches.length === 1) {
                const cls = classMap.get(first.classId);
                const sec = cls?.sections.find(s => s.id === first.sectionId);
                const room = first.room || sec?.roomNumber;
                return `${cls?.name || ''} · ${sec?.name || ''} — ${sub?.name || ''}${room ? ` (রুম ${room})` : ''}`;
              }
              return `যৌথ ${matches.length} শাখা — ${sub?.name || ''}`;
            };

            return (
              <div className="bg-[#eef5f2]/90 dark:bg-emerald-950/35 border border-[#bfd5cc] dark:border-emerald-800/70 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[#145343] dark:text-emerald-300">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>আজকের ক্লাস স্ট্যাটাস ({BENGALI_DAY_NAMES[liveStatus.todayEnum]})</span>
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
                            : formatTeacherSlotSummary(curMatches)}
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-stone-500 dark:text-slate-400 tabular-nums shrink-0">
                        {curWin.period.startTime}–{curWin.period.endTime}
                      </span>
                    </div>
                  )}

                  {nextWin && (
                    <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-3 py-2 flex items-center justify-between gap-2 border border-stone-200/70 dark:border-slate-800">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                          পরবর্তী · {nextWin.period.label}
                        </div>
                        <div className="text-xs font-semibold text-stone-800 dark:text-slate-200 truncate">
                          {formatTeacherSlotSummary(nextMatches)}
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-stone-500 dark:text-slate-400 tabular-nums shrink-0">
                        {nextWin.period.startTime}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="no-print flex items-center justify-between gap-2 bg-white dark:bg-slate-900 rounded-xl border border-stone-200 dark:border-slate-800 px-3 py-2">
            <span className="text-xs font-semibold text-stone-600 dark:text-slate-300">
              শিডিউল ভিউ
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

      {/* Mobile Day-by-Day Swipeable Teacher Timeline vs Desktop Table / Grid */}
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
                  {dailyLoad[activeMobileDay] || 0} টি পিরিয়ড · সোয়াইপ করুন
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

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 divide-y divide-stone-100 dark:divide-slate-800 overflow-hidden">
            {allDisplayPeriods.map(period => {
              const isBreak = period.isBreak || period.isLocked;
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

              const slotMatches =
                teacherSlotMap.get(`${activeMobileDay}_${period.periodIndex}`) || [];
              const primaryColor = slotMatches[0] ? subjectMap.get(slotMatches[0].subjectId)?.color || '#145343' : undefined;

              return (
                <div
                  key={period.periodIndex}
                  className={`px-3.5 py-3.5 flex items-center gap-3 transition-colors ${
                    isLivePeriod ? 'bg-[#eef5f2]/65 dark:bg-emerald-950/30' : ''
                  }`}
                >
                  <div className="w-16 shrink-0 font-mono tabular-nums">
                    <div className={`text-[11px] font-bold ${isLivePeriod ? 'text-[#145343] dark:text-emerald-300' : 'text-stone-800 dark:text-slate-200'}`}>
                      {period.startTime}
                    </div>
                    <div className="text-[10px] text-stone-400 dark:text-slate-500">
                      {period.endTime}
                    </div>
                  </div>

                  <div
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      isLivePeriod
                        ? 'ring-4 ring-emerald-500/20 bg-[#145343] dark:bg-emerald-400'
                        : slotMatches.length === 0
                        ? 'border border-stone-300 dark:border-slate-600'
                        : ''
                    }`}
                    style={!isLivePeriod && primaryColor ? { backgroundColor: primaryColor } : undefined}
                  />

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

                    {slotMatches.length === 0 ? (
                      <div className="text-xs text-stone-400 dark:text-slate-500 py-0.5">
                        ফ্রি পিরিয়ড
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {slotMatches.map(match => {
                          const cls = classMap.get(match.classId);
                          const sec = cls?.sections.find(s => s.id === match.sectionId);
                          const sub = subjectMap.get(match.subjectId);
                          const room = match.room || sec?.roomNumber;
                          return (
                            <div
                              key={match.id}
                              onClick={() => {
                                if (!readOnly) {
                                  onOpenEditSlot(match.classId, match.sectionId, activeMobileDay, period.periodIndex);
                                }
                              }}
                              className={`flex items-center justify-between gap-2 ${readOnly ? '' : 'cursor-pointer'}`}
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-stone-900 dark:text-white truncate">
                                  {sub?.name || 'Subject'}
                                </div>
                                <div className="text-xs font-medium text-[#145343] dark:text-emerald-400 truncate">
                                  {cls?.name} · {sec?.name}
                                  {room ? ` · রুম ${room}` : ''}
                                </div>
                              </div>
                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    onClearSlot(match.id);
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
      ) : viewMode === 'table' ? (
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
                    const hasConflict = conflictEntryIdSet.has(entry.id);

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
                        <td className="py-3 px-4 font-semibold text-[#145343] dark:text-emerald-400">
                          {cls?.name || 'Class'}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                          {sec?.name || 'Section'}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: sub?.color || '#145343' }}
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
                                className="p-1.5 text-slate-500 hover:text-[#145343] dark:hover:text-emerald-300 hover:bg-[#eef5f2] dark:hover:bg-emerald-950/40 rounded transition-colors"
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

                      const slotMatches =
                        teacherSlotMap.get(`${day}_${period.periodIndex}`) || [];
                      const hasConflict = slotMatches.some(m => conflictEntryIdSet.has(m.id));

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
                                  : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-[#145343] dark:hover:border-emerald-500'
                              }`}
                            >
                              <div className="text-[11px] font-bold text-[#145343] dark:text-emerald-300 truncate">
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
                                ? 'bg-[#eef5f2]/80 dark:bg-emerald-950/35 border-[#bfd5cc] dark:border-emerald-800 hover:border-[#145343]'
                                : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-[#145343] dark:hover:border-emerald-500'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-[#145343] dark:text-emerald-300">
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
