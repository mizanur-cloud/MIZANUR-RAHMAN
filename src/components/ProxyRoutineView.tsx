import React, { useEffect, useMemo, useState } from 'react';
import {
  DailyAbsenceRecord,
  DayOfWeek,
  PeriodTiming,
  ProxyLogEntry,
  ProxyLogStatus,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import {
  ProxyAssignment,
  ProxyPlanResult,
  RankedProxyCandidate,
  evaluateProxyCandidatesForSlot,
  generateDailyProxyPlan,
  isEligibleForProxy,
} from '../services/proxyGenerator';
import {
  ProxyTeacherReportSummaryRow,
  exportProxyDocx,
  exportProxyPdf,
  exportProxyReportExcel,
  exportProxyReportPdf,
} from '../services/exportProxyDoc';
import {
  computeTeacherWorkload,
  getDayOfWeekFromDateStr,
  getLocalDateStr,
  getWeekBoundsForDate,
} from '../services/workloadService';
import { useViewMode } from '../context/ViewModeContext';
import { BENGALI_DAY_NAMES } from '../services/scheduleTiers';
import {
  AlertCircle,
  AlertTriangle,
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react';

type ProxySubTab = 'planner' | 'workload' | 'report';
type ReportRangePreset = 'today' | 'week' | 'month' | 'all' | 'custom';

interface SlotItem {
  slotKey: string;
  originalEntryId: string;
  date: string;
  day: DayOfWeek;
  periodIndex: number;
  periodLabel: string;
  periodTime: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  absentTeacherId: string;
  absentTeacherName: string;
  room?: string;
  savedLog?: ProxyLogEntry;
  autoSuggestion?: ProxyAssignment;
}

interface PendingOverrideRequest {
  title: string;
  warnings: string[];
  items: { log: ProxyLogEntry; isNew: boolean }[];
}

interface ProxyRoutineViewProps {
  settings: SchoolSettings;
  teachers: Teacher[];
  classes: SchoolClass[];
  subjects: Subject[];
  periodTimings: PeriodTiming[];
  entries: TimetableEntry[];
  proxyLogs: ProxyLogEntry[];
  dailyAbsences: Record<string, DailyAbsenceRecord>;
  onSaveProxyLog: (log: ProxyLogEntry, isNew: boolean) => Promise<void> | void;
  onSaveMultipleProxyLogs?: (items: { log: ProxyLogEntry; isNew: boolean }[]) => Promise<void> | void;
  onUpdateProxyStatus: (logId: string, status: ProxyLogStatus, summary: string) => Promise<void> | void;
  onDeleteProxyLog: (logId: string, summary: string) => Promise<void> | void;
  onSaveDailyAbsences: (date: string, day: DayOfWeek, absentTeacherIds: string[]) => Promise<void> | void;
  actorEmail?: string;
  actorName?: string;
  actorRole?: 'super_admin' | 'admin';
}

function getDateForWeekdayInWeek(anchorDateStr: string, targetDay: DayOfWeek): string {
  const dayOrder: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const targetIdx = dayOrder.indexOf(targetDay);
  if (targetIdx === -1) return anchorDateStr;
  const { weekStart } = getWeekBoundsForDate(anchorDateStr);
  const parts = weekStart.split('-').map(Number);
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  dt.setDate(dt.getDate() + targetIdx);
  return getLocalDateStr(dt);
}

const STATUS_BADGE_MAP: Record<
  ProxyLogStatus,
  { label: string; cls: string }
> = {
  assigned: {
    label: 'নির্ধারিত (Assigned)',
    cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
  },
  completed: {
    label: 'সম্পন্ন (Completed)',
    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  },
  cancelled: {
    label: 'বাতিল (Cancelled)',
    cls: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 line-through',
  },
};

export const ProxyRoutineView: React.FC<ProxyRoutineViewProps> = ({
  settings,
  teachers,
  classes,
  subjects,
  periodTimings,
  entries,
  proxyLogs,
  dailyAbsences,
  onSaveProxyLog,
  onSaveMultipleProxyLogs,
  onUpdateProxyStatus,
  onDeleteProxyLog,
  onSaveDailyAbsences,
  actorEmail = 'admin@school.local',
  actorName = 'Routine Admin',
  actorRole = 'admin',
}) => {
  const { isMobileView } = useViewMode();

  const [activeSubTab, setActiveSubTab] = useState<ProxySubTab>('planner');
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateStr());
  const selectedDay = useMemo(() => getDayOfWeekFromDateStr(selectedDate), [selectedDate]);
  const isWorkingDay = settings.workingDays.includes(selectedDay);

  // Absent teachers for selectedDate (synced from dailyAbsences record)
  const [absentTeacherIds, setAbsentTeacherIds] = useState<string[]>(
    () => dailyAbsences[getLocalDateStr()]?.absentTeacherIds || []
  );

  useEffect(() => {
    setAbsentTeacherIds(dailyAbsences[selectedDate]?.absentTeacherIds || []);
  }, [selectedDate, dailyAbsences]);

  const [focusedSlotKey, setFocusedSlotKey] = useState<string | null>(null);
  const [suggestionSortMode, setSuggestionSortMode] = useState<'lowest_load' | 'subject_first'>('lowest_load');
  const [customSubstituteMap, setCustomSubstituteMap] = useState<Record<string, string>>({});
  const [showBusyTeachers, setShowBusyTeachers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ruleErrorNotice, setRuleErrorNotice] = useState<string | null>(null);

  // Override confirmation modal + Delete confirmation modal + Manual modal
  const [pendingOverride, setPendingOverride] = useState<PendingOverrideRequest | null>(null);
  const [pendingDeleteLog, setPendingDeleteLog] = useState<ProxyLogEntry | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

  useEffect(() => {
    setRuleErrorNotice(null);
  }, [selectedDate]);

  // Manual modal form state
  const [manualClassId, setManualClassId] = useState<string>(classes[0]?.id || '');
  const [manualSectionId, setManualSectionId] = useState<string>(classes[0]?.sections[0]?.id || '');
  const [manualPeriodIndex, setManualPeriodIndex] = useState<number>(
    periodTimings.find(p => !p.isBreak)?.periodIndex || 1
  );
  const [manualSubjectId, setManualSubjectId] = useState<string>(subjects[0]?.id || '');
  const [manualAbsentTeacherId, setManualAbsentTeacherId] = useState<string>(teachers[0]?.id || '');
  const [manualProxyTeacherId, setManualProxyTeacherId] = useState<string>('');

  // Workload overview filters
  const [workloadSearch, setWorkloadSearch] = useState('');
  const [workloadFilter, setWorkloadFilter] = useState<'all' | 'alerts' | 'eligible'>('all');

  // Report & Log filters
  const [reportPreset, setReportPreset] = useState<ReportRangePreset>('week');
  const [customStartDate, setCustomStartDate] = useState<string>(() => getWeekBoundsForDate(getLocalDateStr()).weekStart);
  const [customEndDate, setCustomEndDate] = useState<string>(() => getWeekBoundsForDate(getLocalDateStr()).weekEnd);
  const [filterProxyTeacherId, setFilterProxyTeacherId] = useState<string>('all');
  const [filterAbsentTeacherId, setFilterAbsentTeacherId] = useState<string>('all');
  const [filterClassSection, setFilterClassSection] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const teacherMap = useMemo(() => new Map(teachers.map(t => [t.id, t])), [teachers]);
  const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);
  const subjectMap = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects]);
  const periodMap = useMemo(() => new Map(periodTimings.map(p => [p.periodIndex, p])), [periodTimings]);

  // Saved proxy logs on selectedDate
  const sameDateSavedLogs = useMemo(
    () => proxyLogs.filter(p => p.date === selectedDate && p.status !== 'cancelled'),
    [proxyLogs, selectedDate]
  );

  // Automated proxy plan considering same-date saved logs + lowest weekly load
  const autoPlan: ProxyPlanResult = useMemo(() => {
    return generateDailyProxyPlan(
      selectedDay,
      absentTeacherIds,
      entries,
      teachers,
      classes,
      subjects,
      periodTimings,
      {
        targetDate: selectedDate,
        proxyLogs,
      }
    );
  }, [selectedDay, selectedDate, absentTeacherIds, entries, teachers, classes, subjects, periodTimings, proxyLogs]);

  // Combined slot list: autoPlan affected entries merged with persisted logs on selectedDate
  const dailySlots: SlotItem[] = useMemo(() => {
    const items: SlotItem[] = [];
    const seenKeys = new Set<string>();

    for (const a of autoPlan.assignments) {
      const slotKey = `${a.classId}_${a.sectionId}_${a.periodIndex}_${a.subjectId}`;
      seenKeys.add(slotKey);
      const savedLog = sameDateSavedLogs.find(
        l =>
          l.classId === a.classId &&
          l.sectionId === a.sectionId &&
          l.periodIndex === a.periodIndex &&
          l.subjectId === a.subjectId
      );
      items.push({
        slotKey,
        originalEntryId: a.originalEntryId,
        date: selectedDate,
        day: selectedDay,
        periodIndex: a.periodIndex,
        periodLabel: a.periodLabel,
        periodTime: a.periodTime,
        classId: a.classId,
        className: a.className,
        sectionId: a.sectionId,
        sectionName: a.sectionName,
        subjectId: a.subjectId,
        subjectName: a.subjectName,
        subjectColor: a.subjectColor,
        absentTeacherId: a.absentTeacherId,
        absentTeacherName: a.absentTeacherName,
        room: a.room,
        savedLog,
        autoSuggestion: a,
      });
    }

    // Also include manual saved logs on selectedDate that aren't already in autoPlan
    for (const log of sameDateSavedLogs) {
      const slotKey = `${log.classId}_${log.sectionId}_${log.periodIndex}_${log.subjectId}`;
      if (seenKeys.has(slotKey)) continue;
      seenKeys.add(slotKey);
      const sub = subjectMap.get(log.subjectId);
      items.push({
        slotKey,
        originalEntryId: log.id,
        date: log.date,
        day: log.day,
        periodIndex: log.periodIndex,
        periodLabel: log.periodLabel,
        periodTime: log.periodTime,
        classId: log.classId,
        className: log.className,
        sectionId: log.sectionId,
        sectionName: log.sectionName,
        subjectId: log.subjectId,
        subjectName: log.subjectName,
        subjectColor: log.subjectColor || sub?.color || '#145343',
        absentTeacherId: log.absentTeacherId,
        absentTeacherName: log.absentTeacherName,
        room: log.room,
        savedLog: log,
      });
    }

    return items.sort((a, b) => a.periodIndex - b.periodIndex || a.className.localeCompare(b.className));
  }, [autoPlan.assignments, sameDateSavedLogs, selectedDate, selectedDay, subjectMap]);

  // Keep focused slot synced intelligently
  useEffect(() => {
    if (dailySlots.length === 0) {
      setFocusedSlotKey(null);
      return;
    }
    if (!focusedSlotKey || !dailySlots.some(s => s.slotKey === focusedSlotKey)) {
      const firstUnsaved = dailySlots.find(s => !s.savedLog);
      setFocusedSlotKey((firstUnsaved || dailySlots[0]).slotKey);
    }
  }, [dailySlots, focusedSlotKey]);

  const focusedSlot = useMemo(
    () => dailySlots.find(s => s.slotKey === focusedSlotKey) || null,
    [dailySlots, focusedSlotKey]
  );

  // Smart Free Teacher evaluation for focusedSlot
  const focusedSlotEvaluation = useMemo(() => {
    if (!focusedSlot) return null;
    return evaluateProxyCandidatesForSlot({
      date: focusedSlot.date,
      day: focusedSlot.day,
      periodIndex: focusedSlot.periodIndex,
      subjectId: focusedSlot.subjectId,
      absentTeacherIdsOnDate: absentTeacherIds,
      allEntries: entries,
      existingProxyLogs: proxyLogs,
      teachers,
      classes,
      subjects,
      ignoreProxyLogId: focusedSlot.savedLog?.id,
      sortMode: suggestionSortMode,
    });
  }, [focusedSlot, absentTeacherIds, entries, proxyLogs, teachers, classes, subjects, suggestionSortMode]);

  // Reset manual preview overrides and re-run automatic matching
  const handleAutoMatchReset = () => {
    setCustomSubstituteMap({});
  };

  // Inline substitute select change handler (preserves old one-click dropdown + checks new workload limits)
  const handleInlineDropdownAssign = async (slot: SlotItem, substituteTeacherId: string) => {
    if (!substituteTeacherId) {
      setCustomSubstituteMap(prev => {
        const next = { ...prev };
        delete next[slot.slotKey];
        return next;
      });
      return;
    }
    const evalRes = evaluateProxyCandidatesForSlot({
      date: slot.date,
      day: slot.day,
      periodIndex: slot.periodIndex,
      subjectId: slot.subjectId,
      absentTeacherIdsOnDate: absentTeacherIds,
      allEntries: entries,
      existingProxyLogs: proxyLogs,
      teachers,
      classes,
      subjects,
      ignoreProxyLogId: slot.savedLog?.id,
    });
    const candidate = evalRes.freeCandidates.find(c => c.teacher.id === substituteTeacherId);
    if (!candidate) {
      const busyMatch = evalRes.busyCandidates.find(b => b.teacher.id === substituteTeacherId);
      if (busyMatch) {
        setRuleErrorNotice(`${busyMatch.teacher.name}: ${busyMatch.reason}`);
      }
      return;
    }

    setRuleErrorNotice(null);
    setCustomSubstituteMap(prev => ({ ...prev, [slot.slotKey]: substituteTeacherId }));
    await handleAssignCandidate(slot, candidate);
  };

  // Toggle absent teacher + save immediately
  const toggleAbsentTeacher = async (teacherId: string) => {
    const next = absentTeacherIds.includes(teacherId)
      ? absentTeacherIds.filter(id => id !== teacherId)
      : [...absentTeacherIds, teacherId];
    setAbsentTeacherIds(next);
    await onSaveDailyAbsences(selectedDate, selectedDay, next);
  };

  const clearAbsentTeachers = async () => {
    setAbsentTeacherIds([]);
    await onSaveDailyAbsences(selectedDate, selectedDay, []);
  };

  // Build ProxyLogEntry from slot + candidate
  const buildLogEntryFromSlot = (
    slot: SlotItem,
    candidate: RankedProxyCandidate,
    overriddenWarning?: string
  ): { log: ProxyLogEntry; isNew: boolean } => {
    const nowIso = new Date().toISOString();
    const isNew = !slot.savedLog;
    const id = slot.savedLog?.id || `prx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const matchType = candidate.isSameSubject
      ? ('same_subject' as const)
      : candidate.isSameDepartment
      ? ('same_department' as const)
      : ('free_teacher' as const);

    return {
      isNew,
      log: {
        id,
        date: slot.date,
        day: slot.day,
        periodIndex: slot.periodIndex,
        periodLabel: slot.periodLabel,
        periodTime: slot.periodTime,
        classId: slot.classId,
        className: slot.className,
        sectionId: slot.sectionId,
        sectionName: slot.sectionName,
        subjectId: slot.subjectId,
        subjectName: slot.subjectName,
        subjectColor: slot.subjectColor,
        absentTeacherId: slot.absentTeacherId,
        absentTeacherName: slot.absentTeacherName,
        proxyTeacherId: candidate.teacher.id,
        proxyTeacherName: candidate.teacher.name,
        assignedByEmail: isNew ? actorEmail : slot.savedLog!.assignedByEmail,
        assignedByName: isNew ? actorName : slot.savedLog!.assignedByName,
        assignedByRole: isNew ? actorRole : slot.savedLog!.assignedByRole,
        status: slot.savedLog?.status === 'completed' ? 'completed' : 'assigned',
        room: slot.room,
        matchType,
        matchReason: `${candidate.inlineLabel}${candidate.isSameSubject ? ' · Same Subject' : candidate.isSameDepartment ? ' · Dept Peer' : ''}`,
        overriddenWarning,
        createdAt: slot.savedLog?.createdAt || nowIso,
        updatedAt: nowIso,
      },
    };
  };

  const commitProxyItems = async (items: { log: ProxyLogEntry; isNew: boolean }[]) => {
    if (items.length === 0) return;
    setIsSaving(true);
    try {
      if (items.length > 1 && onSaveMultipleProxyLogs) {
        await onSaveMultipleProxyLogs(items);
      } else {
        for (const item of items) {
          await onSaveProxyLog(item.log, item.isNew);
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Assign a candidate to focusedSlot (hard clashes cannot be overridden; workload limits trigger Admin Override)
  const handleAssignCandidate = async (slot: SlotItem, candidate: RankedProxyCandidate) => {
    if (candidate.limitEval.hasHardClash) {
      const clashMsg =
        candidate.limitEval.warnings.find(w => w.severity === 'error')?.message ||
        `${candidate.teacher.name}-কে এই প্রক্সি ক্লাসে বরাদ্দ করা যাবে না (দিনে ১টির বেশি প্রক্সি বা টাইম ক্ল্যাশ অনুমোদিত নয়)।`;
      setRuleErrorNotice(clashMsg);
      return;
    }

    setRuleErrorNotice(null);
    if (candidate.limitEval.requiresOverride && candidate.limitEval.warnings.length > 0) {
      const warningTexts = candidate.limitEval.warnings.map(w => w.message);
      const { log, isNew } = buildLogEntryFromSlot(slot, candidate, warningTexts.join(' | '));
      setPendingOverride({
        title: `${candidate.teacher.name} — লোড লিমিট সতর্কতা (${slot.periodLabel})`,
        warnings: warningTexts,
        items: [{ log, isNew }],
      });
      return;
    }

    const { log, isNew } = buildLogEntryFromSlot(slot, candidate);
    await commitProxyItems([{ log, isNew }]);
  };

  // Save all matched unsaved auto-suggestions for selectedDate
  const handleSaveAllMatched = async () => {
    const unsavedMatched = dailySlots.filter(
      s => !s.savedLog && s.autoSuggestion?.status === 'assigned' && s.autoSuggestion.substituteTeacherId
    );
    if (unsavedMatched.length === 0) return;

    const batchItems: { log: ProxyLogEntry; isNew: boolean }[] = [];
    const overrideWarnings: string[] = [];
    const blockedErrors: string[] = [];

    for (const slot of unsavedMatched) {
      const subId = slot.autoSuggestion!.substituteTeacherId;
      const teacher = teacherMap.get(subId);
      if (!teacher) continue;

      const evalRes = evaluateProxyCandidatesForSlot({
        date: slot.date,
        day: slot.day,
        periodIndex: slot.periodIndex,
        subjectId: slot.subjectId,
        absentTeacherIdsOnDate: absentTeacherIds,
        allEntries: entries,
        existingProxyLogs: [...proxyLogs, ...batchItems.map(i => i.log)],
        teachers,
        classes,
        subjects,
      });
      const candidate = evalRes.freeCandidates.find(c => c.teacher.id === subId);
      if (!candidate) {
        const busy = evalRes.busyCandidates.find(b => b.teacher.id === subId);
        if (busy) blockedErrors.push(`${busy.teacher.name}: ${busy.reason}`);
        continue;
      }

      if (candidate.limitEval.hasHardClash) {
        const msg =
          candidate.limitEval.warnings.find(w => w.severity === 'error')?.message ||
          `${candidate.teacher.name} (${slot.periodLabel}): নিয়ম লঙ্ঘন।`;
        blockedErrors.push(msg);
        continue;
      }

      if (candidate.limitEval.requiresOverride && candidate.limitEval.warnings.length > 0) {
        const msg = `${candidate.teacher.name} (${slot.periodLabel}, ${slot.className}): ${candidate.limitEval.warnings.map(w => w.message).join(' ')}`;
        overrideWarnings.push(msg);
        batchItems.push(buildLogEntryFromSlot(slot, candidate, msg));
      } else {
        batchItems.push(buildLogEntryFromSlot(slot, candidate));
      }
    }

    if (blockedErrors.length > 0) {
      setRuleErrorNotice(blockedErrors[0]);
    } else {
      setRuleErrorNotice(null);
    }

    if (batchItems.length === 0) return;

    if (overrideWarnings.length > 0) {
      setPendingOverride({
        title: `একাধিক প্রক্সি সংরক্ষণে লোড লিমিট সতর্কতা (${batchItems.length}টি ক্লাস)`,
        warnings: overrideWarnings,
        items: batchItems,
      });
      return;
    }

    await commitProxyItems(batchItems);
  };

  // Manual modal helpers
  const manualSelectedClass = classMap.get(manualClassId) || classes[0];
  const manualCandidates = useMemo(() => {
    if (!isManualModalOpen) return { freeCandidates: [], busyCandidates: [] };
    return evaluateProxyCandidatesForSlot({
      date: selectedDate,
      day: selectedDay,
      periodIndex: manualPeriodIndex,
      subjectId: manualSubjectId,
      absentTeacherIdsOnDate: absentTeacherIds,
      allEntries: entries,
      existingProxyLogs: proxyLogs,
      teachers,
      classes,
      subjects,
    });
  }, [
    isManualModalOpen,
    selectedDate,
    selectedDay,
    manualPeriodIndex,
    manualSubjectId,
    absentTeacherIds,
    entries,
    proxyLogs,
    teachers,
    classes,
    subjects,
  ]);

  const handleOpenManualModal = () => {
    const firstCls = classes[0];
    setManualClassId(firstCls?.id || '');
    setManualSectionId(firstCls?.sections[0]?.id || '');
    const firstPeriod = periodTimings.find(p => !p.isBreak)?.periodIndex || 1;
    setManualPeriodIndex(firstPeriod);
    setManualSubjectId(subjects[0]?.id || '');
    setManualAbsentTeacherId(absentTeacherIds[0] || teachers[0]?.id || '');
    setManualProxyTeacherId('');
    setIsManualModalOpen(true);
  };

  const handleManualModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cls = classMap.get(manualClassId);
    const sec = cls?.sections.find(s => s.id === manualSectionId);
    const sub = subjectMap.get(manualSubjectId);
    const absentTch = teacherMap.get(manualAbsentTeacherId);
    const period = periodMap.get(manualPeriodIndex);
    const candidate = manualCandidates.freeCandidates.find(c => c.teacher.id === manualProxyTeacherId);
    if (!cls || !sec || !sub || !absentTch || !candidate) return;

    const slot: SlotItem = {
      slotKey: `${cls.id}_${sec.id}_${manualPeriodIndex}_${sub.id}`,
      originalEntryId: `manual-${Date.now()}`,
      date: selectedDate,
      day: selectedDay,
      periodIndex: manualPeriodIndex,
      periodLabel: period?.label || `Period ${manualPeriodIndex}`,
      periodTime: period ? `${period.startTime} - ${period.endTime}` : '',
      classId: cls.id,
      className: cls.name,
      sectionId: sec.id,
      sectionName: sec.name,
      subjectId: sub.id,
      subjectName: sub.name,
      subjectColor: sub.color || '#145343',
      absentTeacherId: absentTch.id,
      absentTeacherName: absentTch.name,
      room: sec.roomNumber,
    };

    setIsManualModalOpen(false);
    await handleAssignCandidate(slot, candidate);
  };

  // Export plan representing current view (persisted logs take priority over auto suggestions)
  const exportPlan: ProxyPlanResult = useMemo(() => {
    const assignments: ProxyAssignment[] = dailySlots.map(s => {
      if (s.savedLog) {
        return {
          id: s.savedLog.id,
          originalEntryId: s.originalEntryId,
          date: s.date,
          day: s.day,
          periodIndex: s.periodIndex,
          periodLabel: s.periodLabel,
          periodTime: s.periodTime,
          classId: s.classId,
          className: s.className,
          sectionId: s.sectionId,
          sectionName: s.sectionName,
          subjectId: s.subjectId,
          subjectName: s.subjectName,
          subjectColor: s.subjectColor,
          absentTeacherId: s.absentTeacherId,
          absentTeacherName: s.absentTeacherName,
          substituteTeacherId: s.savedLog.proxyTeacherId,
          substituteTeacherName: s.savedLog.proxyTeacherName,
          matchType: s.savedLog.matchType || 'manual',
          matchReason: s.savedLog.matchReason || 'Saved in Proxy Log',
          room: s.room,
          status: 'assigned',
          overriddenWarning: s.savedLog.overriddenWarning,
        };
      }
      if (s.autoSuggestion) return s.autoSuggestion;
      return {
        id: s.slotKey,
        originalEntryId: s.originalEntryId,
        date: s.date,
        day: s.day,
        periodIndex: s.periodIndex,
        periodLabel: s.periodLabel,
        periodTime: s.periodTime,
        classId: s.classId,
        className: s.className,
        sectionId: s.sectionId,
        sectionName: s.sectionName,
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        subjectColor: s.subjectColor,
        absentTeacherId: s.absentTeacherId,
        absentTeacherName: s.absentTeacherName,
        substituteTeacherId: '',
        substituteTeacherName: 'Unassigned',
        matchType: 'free_teacher',
        matchReason: 'Unassigned',
        room: s.room,
        status: 'unassigned',
      };
    });

    const assignedCount = assignments.filter(a => a.status === 'assigned').length;
    return {
      date: selectedDate,
      day: selectedDay,
      absentTeacherIds,
      totalAbsentClasses: assignments.length,
      assignedCount,
      unassignedCount: assignments.length - assignedCount,
      assignments,
    };
  }, [dailySlots, selectedDate, selectedDay, absentTeacherIds]);

  const savedDailyCount = dailySlots.filter(s => Boolean(s.savedLog)).length;
  const unsavedMatchableCount = dailySlots.filter(
    s => !s.savedLog && s.autoSuggestion?.status === 'assigned'
  ).length;

  // Workload Overview Tab Data
  const workloadSummaries = useMemo(() => {
    const q = workloadSearch.trim().toLowerCase();
    return teachers
      .map(t =>
        computeTeacherWorkload(t, entries, proxyLogs, {
          targetDate: selectedDate,
          targetDay: selectedDay,
          workingDays: settings.workingDays,
        })
      )
      .filter(w => {
        if (q) {
          const match =
            w.teacher.name.toLowerCase().includes(q) ||
            w.teacher.initials.toLowerCase().includes(q) ||
            (w.teacher.designation || '').toLowerCase().includes(q);
          if (!match) return false;
        }
        if (workloadFilter === 'alerts') {
          return w.status === 'Overloaded' || w.status === 'Near Limit';
        }
        if (workloadFilter === 'eligible') {
          return isEligibleForProxy(w.teacher, classes);
        }
        return true;
      })
      .sort((a, b) => b.totalWeeklyLoad - a.totalWeeklyLoad);
  }, [teachers, entries, proxyLogs, selectedDate, selectedDay, settings.workingDays, workloadSearch, workloadFilter, classes]);

  const overloadTeacherCount = useMemo(
    () => workloadSummaries.filter(w => w.status === 'Overloaded').length,
    [workloadSummaries]
  );

  // Report & Log Filtering
  const todayStr = getLocalDateStr();
  const { filteredReportLogs, reportRangeLabel } = useMemo(() => {
    let startBound = '';
    let endBound = '';
    let rangeLabel = 'All Records';

    if (reportPreset === 'today') {
      startBound = todayStr;
      endBound = todayStr;
      rangeLabel = `Today (${todayStr})`;
    } else if (reportPreset === 'week') {
      const wb = getWeekBoundsForDate(selectedDate);
      startBound = wb.weekStart;
      endBound = wb.weekEnd;
      rangeLabel = `Week (${wb.weekStart} to ${wb.weekEnd})`;
    } else if (reportPreset === 'month') {
      const monthPrefix = selectedDate.slice(0, 7);
      startBound = `${monthPrefix}-01`;
      endBound = `${monthPrefix}-31`;
      rangeLabel = `Month (${monthPrefix})`;
    } else if (reportPreset === 'custom') {
      startBound = customStartDate || '';
      endBound = customEndDate || '';
      rangeLabel = `Custom (${startBound || '...'} to ${endBound || '...'})`;
    }

    const filtered = proxyLogs
      .filter(log => {
        if (startBound && log.date < startBound) return false;
        if (endBound && log.date > endBound) return false;
        if (filterProxyTeacherId !== 'all' && log.proxyTeacherId !== filterProxyTeacherId) return false;
        if (filterAbsentTeacherId !== 'all' && log.absentTeacherId !== filterAbsentTeacherId) return false;
        if (filterClassSection !== 'all' && `${log.classId}_${log.sectionId}` !== filterClassSection) return false;
        if (filterPeriod !== 'all' && String(log.periodIndex) !== filterPeriod) return false;
        if (filterStatus !== 'all' && log.status !== filterStatus) return false;
        return true;
      })
      .sort((a, b) => (b.date !== a.date ? b.date.localeCompare(a.date) : a.periodIndex - b.periodIndex));

    return { filteredReportLogs: filtered, reportRangeLabel: rangeLabel };
  }, [
    proxyLogs,
    reportPreset,
    todayStr,
    selectedDate,
    customStartDate,
    customEndDate,
    filterProxyTeacherId,
    filterAbsentTeacherId,
    filterClassSection,
    filterPeriod,
    filterStatus,
  ]);

  // Report KPIs + Teacher-wise Summary Table
  const { reportKpis, teacherSummaryRows } = useMemo(() => {
    const activeLogs = filteredReportLogs.filter(l => l.status !== 'cancelled');
    const todayActiveCount = proxyLogs.filter(l => l.date === todayStr && l.status !== 'cancelled').length;

    const byTeacher = new Map<
      string,
      {
        teacherName: string;
        initials: string;
        activeCount: number;
        completedCount: number;
        cancelledCount: number;
        dates: Set<string>;
      }
    >();

    for (const log of filteredReportLogs) {
      const tch = teacherMap.get(log.proxyTeacherId);
      const existing = byTeacher.get(log.proxyTeacherId) || {
        teacherName: tch?.name || log.proxyTeacherName,
        initials: tch?.initials || 'T',
        activeCount: 0,
        completedCount: 0,
        cancelledCount: 0,
        dates: new Set<string>(),
      };

      if (log.status === 'cancelled') {
        existing.cancelledCount++;
      } else {
        existing.activeCount++;
        if (log.status === 'completed') existing.completedCount++;
        existing.dates.add(log.date);
      }
      byTeacher.set(log.proxyTeacherId, existing);
    }

    const summaryRows: ProxyTeacherReportSummaryRow[] = Array.from(byTeacher.entries())
      .map(([teacherId, info]) => ({
        teacherId,
        teacherName: info.teacherName,
        initials: info.initials,
        totalProxyCount: info.activeCount,
        completedCount: info.completedCount,
        cancelledCount: info.cancelledCount,
        datesCount: info.dates.size,
      }))
      .sort((a, b) => b.totalProxyCount - a.totalProxyCount || a.teacherName.localeCompare(b.teacherName));

    const activeTeachersInvolved = summaryRows.filter(r => r.totalProxyCount > 0).length;
    const mostActiveRow = summaryRows.find(r => r.totalProxyCount > 0);
    const mostActiveName = mostActiveRow
      ? `${mostActiveRow.teacherName} (${mostActiveRow.totalProxyCount})`
      : '—';

    return {
      reportKpis: {
        totalProxy: activeLogs.length,
        todayProxy: todayActiveCount,
        mostActiveName,
        teachersInvolved: activeTeachersInvolved,
      },
      teacherSummaryRows: summaryRows,
    };
  }, [filteredReportLogs, proxyLogs, todayStr, teacherMap]);

  return (
    <div className={isMobileView ? 'space-y-3.5' : 'space-y-5'}>
      {/* Top Sub-Tab Navigation */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-2 sm:p-2.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveSubTab('planner')}
          className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${
            activeSubTab === 'planner'
              ? 'bg-[#145343] text-white shadow-xs'
              : 'text-stone-700 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>প্রক্সি ও স্মার্ট সাজেশন</span>
          {dailySlots.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-white/20 font-mono">
              {dailySlots.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('workload')}
          className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${
            activeSubTab === 'workload'
              ? 'bg-[#145343] text-white shadow-xs'
              : 'text-stone-700 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>শিক্ষক ওয়ার্কলোড (Load)</span>
          {overloadTeacherCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-rose-500 text-white font-mono">
              {overloadTeacherCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('report')}
          className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${
            activeSubTab === 'report'
              ? 'bg-[#145343] text-white shadow-xs'
              : 'text-stone-700 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>প্রক্সি লগ ও রিপোর্ট</span>
          <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-stone-200 dark:bg-slate-700 text-stone-800 dark:text-slate-200 font-mono">
            {proxyLogs.filter(l => l.status !== 'cancelled').length}
          </span>
        </button>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: DAILY PROXY PLANNER & SMART FREE TEACHER SUGGESTIONS         */}
      {/* =================================================================== */}
      {activeSubTab === 'planner' && (
        <div className="space-y-4">
          {/* Date & Day Control Header */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-4 sm:p-5 shadow-2xs space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-2 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                    <UserMinus className="w-4 h-4" />
                  </span>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-stone-900 dark:text-white">
                      স্মার্ট প্রক্সি ক্লাস ও ফ্রি শিক্ষক সাজেশন
                    </h2>
                    <p className="text-[11px] sm:text-xs text-stone-500 dark:text-slate-400">
                      তারিখ অনুযায়ী নিয়মিত ক্লাস ও পূর্বনির্ধারিত প্রক্সি যাচাই করে সর্বনিম্ন সাপ্তাহিক লোডধারী ফ্রি শিক্ষক সাজেশন দেয়।
                    </p>
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <div className="inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                    <span>🛡️ প্রক্সি মুক্ত:</span>
                    <span>
                      কো-অর্ডিনেটর, প্লে/নার্সারি ব্লক শিক্ষক ও মোয়াজ্জেম স্যার প্রক্সি তালিকা থেকে স্বয়ংক্রিয়ভাবে বাদ থাকবেন
                      {(() => {
                        const exempted = teachers.filter(t => !isEligibleForProxy(t, classes));
                        return exempted.length > 0
                          ? ` (${exempted.map(t => t.initials || t.name).join(', ')})`
                          : '';
                      })()}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                    <span>📌 দৈনিক প্রক্সি সীমা: একজন শিক্ষককে দিনে সর্বোচ্চ ১টি প্রক্সি ক্লাস দেওয়া যাবে</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenManualModal}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-bold text-white bg-[#145343] hover:bg-[#0f4034] rounded-xl flex items-center gap-1.5 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>ম্যানুয়াল প্রক্সি যোগ</span>
                </button>

                <button
                  type="button"
                  onClick={() => exportProxyDocx(exportPlan, settings, teachers)}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-xl flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Word (.docx)</span>
                </button>

                <button
                  type="button"
                  onClick={() => exportProxyPdf(exportPlan, settings, teachers)}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-xl flex items-center gap-1.5"
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Proxy PDF</span>
                </button>
              </div>
            </div>

            {/* Date Picker + Quick Weekday Jump */}
            <div className="pt-3 border-t border-stone-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="flex items-center gap-2 bg-[#f7f5f0] dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700">
                  <Calendar className="w-4 h-4 text-[#145343] dark:text-emerald-400" />
                  <span className="text-xs font-bold text-stone-700 dark:text-slate-200">তারিখ:</span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={e => e.target.value && setSelectedDate(e.target.value)}
                    className="bg-transparent text-xs font-bold text-stone-900 dark:text-white focus:outline-none font-mono"
                  />
                </label>

                <span
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                    isWorkingDay
                      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
                      : 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
                  }`}
                >
                  বার: {BENGALI_DAY_NAMES[selectedDay] || selectedDay} ({selectedDay})
                  {!isWorkingDay ? ' — সাপ্তাহিক ছুটি' : ''}
                </span>
              </div>

              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-0.5">
                <span className="text-[11px] font-semibold text-stone-500 mr-1 shrink-0">সপ্তাহের দিন:</span>
                {settings.workingDays.map(day => {
                  const active = selectedDay === day;
                  const shortBn = BENGALI_DAY_NAMES[day]?.replace('বার', '') || day.slice(0, 3);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelectedDate(getDateForWeekdayInWeek(selectedDate, day))}
                      className={`min-h-[32px] px-2.5 py-1 text-xs font-bold rounded-lg transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#145343] text-white'
                          : 'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 hover:bg-stone-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {shortBn}
                    </button>
                  );
                })}
              </div>
            </div>

            {!isWorkingDay && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>
                  নির্বাচিত তারিখটি ({selectedDate}, {BENGALI_DAY_NAMES[selectedDay]}) নিয়মিত কার্যদিবস নয়। রুটিন অনুযায়ী প্রক্সি দেখতে উপরের কার্যদিবস বাটনে ক্লিক করুন বা ম্যানুয়াল প্রক্সি যোগ করুন।
                </span>
              </div>
            )}

            {ruleErrorNotice && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                  <span className="font-semibold">{ruleErrorNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRuleErrorNotice(null)}
                  className="text-rose-500 hover:text-rose-800 dark:hover:text-rose-200 shrink-0"
                  aria-label="Close notice"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Absent Teacher Selection Strip */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-stone-800 dark:text-slate-200 flex items-center gap-1.5">
                  <span>অনুপস্থিত শিক্ষক নির্বাচন ({selectedDate} · {BENGALI_DAY_NAMES[selectedDay] || selectedDay})</span>
                </h3>
                <p className="text-[11px] text-stone-500 dark:text-slate-400">
                  যেই শিক্ষকগণ অনুপস্থিত বা ছুটিতে আছেন তাদের নির্বাচন করুন — তথ্যটি এই তারিখের লগে স্বয়ংক্রিয়ভাবে সংরক্ষিত হবে।
                </p>
              </div>
              {absentTeacherIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => void clearAbsentTeachers()}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-400 shrink-0"
                >
                  সব মুছুন
                </button>
              )}
            </div>

            <div className={isMobileView ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-2'}>
              {teachers.map(teacher => {
                const isAbsent = absentTeacherIds.includes(teacher.id);
                const dayClassCount = entries.filter(
                  e => e.day === selectedDay && e.teacherId === teacher.id
                ).length;

                return (
                  <button
                    key={teacher.id}
                    type="button"
                    onClick={() => void toggleAbsentTeacher(teacher.id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all flex items-center justify-between gap-2 text-left ${
                      isAbsent
                        ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-400 dark:border-rose-700 text-rose-900 dark:text-rose-100 ring-1 ring-rose-400/60'
                        : 'bg-[#f7f5f0] dark:bg-slate-800/60 border-stone-200 dark:border-slate-700 text-stone-700 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isAbsent ? 'bg-rose-500' : 'bg-stone-300 dark:bg-slate-600'
                        }`}
                      />
                      <span className="font-semibold truncate">{teacher.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                          isAbsent
                            ? 'bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-100 font-bold'
                            : 'bg-stone-200 dark:bg-slate-700 text-stone-600 dark:text-slate-300'
                        }`}
                      >
                        {dayClassCount}টি
                      </span>
                      {isAbsent && (
                        <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300">
                          [ABSENT]
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Daily Summary KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-stone-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">মোট প্রক্সি ক্লাস</div>
                <div className="text-xl font-bold text-stone-900 dark:text-white font-mono mt-0.5">
                  {dailySlots.length}
                </div>
              </div>
              <Clock className="w-5 h-5 text-amber-500 shrink-0" />
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-stone-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">লগে সংরক্ষিত</div>
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                  {savedDailyCount}
                </div>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-stone-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">অটো-সাজেশন প্রস্তুত</div>
                <div className="text-xl font-bold text-blue-600 dark:text-blue-400 font-mono mt-0.5">
                  {unsavedMatchableCount}
                </div>
              </div>
              <Sparkles className="w-5 h-5 text-blue-500 shrink-0" />
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-stone-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">বাকি / খালি</div>
                <div
                  className={`text-xl font-bold font-mono mt-0.5 ${
                    exportPlan.unassignedCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-stone-400'
                  }`}
                >
                  {exportPlan.unassignedCount}
                </div>
              </div>
              <AlertCircle
                className={`w-5 h-5 shrink-0 ${
                  exportPlan.unassignedCount > 0 ? 'text-rose-500' : 'text-stone-300'
                }`}
              />
            </div>
          </div>

          {/* Main 2-Column Workspace (Affected Slots Left + Smart Free Teacher Suggestions Right) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            {/* Affected Class Slots Column */}
            <div className="xl:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 overflow-hidden shadow-2xs">
              <div className="p-4 border-b border-stone-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-stone-900 dark:text-white">
                    প্রক্সি প্রয়োজনীয় ক্লাসসমূহ ({selectedDate})
                  </h3>
                  <p className="text-[11px] text-stone-500 dark:text-slate-400">
                    যেকোনো ক্লাসে ক্লিক করে ডান/নিচের প্যানেল থেকে র‍্যাংককৃত ফ্রি শিক্ষক নির্বাচন করুন।
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAutoMatchReset}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Auto Match</span>
                  </button>

                  {unsavedMatchableCount > 0 && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => void handleSaveAllMatched()}
                      className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#145343] hover:bg-[#0f4034] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>সব অটো-ম্যাচ লগে সেভ করুন ({unsavedMatchableCount})</span>
                    </button>
                  )}
                </div>
              </div>

              {dailySlots.length === 0 ? (
                <div className="p-10 text-center text-stone-500 dark:text-slate-400 space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                  <div className="text-sm font-bold text-stone-800 dark:text-slate-200">
                    এই তারিখে কোনো প্রক্সি ক্লাস বাকি নেই
                  </div>
                  <p className="text-xs max-w-sm mx-auto">
                    উপর থেকে অনুপস্থিত শিক্ষক নির্বাচন করুন অথবা "ম্যানুয়াল প্রক্সি যোগ" বাটনে ক্লিক করে নতুন প্রক্সি বরাদ্দ করুন।
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-slate-800">
                  {dailySlots.map(slot => {
                    const isFocused = focusedSlot?.slotKey === slot.slotKey;
                    const saved = slot.savedLog;
                    const suggestion = slot.autoSuggestion;
                    const slotCandidates = evaluateProxyCandidatesForSlot({
                      date: slot.date,
                      day: slot.day,
                      periodIndex: slot.periodIndex,
                      subjectId: slot.subjectId,
                      absentTeacherIdsOnDate: absentTeacherIds,
                      allEntries: entries,
                      existingProxyLogs: proxyLogs,
                      teachers,
                      classes,
                      subjects,
                      ignoreProxyLogId: saved?.id,
                      sortMode: 'subject_first',
                    });
                    const selectedTeacherId =
                      saved?.proxyTeacherId ||
                      customSubstituteMap[slot.slotKey] ||
                      suggestion?.substituteTeacherId ||
                      '';
                    const effectiveMatchType =
                      saved?.matchType ||
                      (customSubstituteMap[slot.slotKey] ? 'manual' : suggestion?.matchType) ||
                      'free_teacher';
                    const effectiveReason =
                      saved?.matchReason ||
                      suggestion?.matchReason ||
                      'ফ্রি শিক্ষক উপলব্ধ নেই';

                    return (
                      <div
                        key={slot.slotKey}
                        onClick={() => setFocusedSlotKey(slot.slotKey)}
                        className={`p-3.5 sm:p-4 cursor-pointer transition-colors ${
                          isFocused
                            ? 'bg-[#eef5f2]/70 dark:bg-emerald-950/30 border-l-4 border-l-[#145343]'
                            : 'hover:bg-stone-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-stone-100 dark:bg-slate-800 text-stone-900 dark:text-white text-xs font-bold">
                                {slot.periodLabel}
                              </span>
                              <span className="text-[11px] font-mono text-stone-500 dark:text-slate-400">
                                {slot.periodTime}
                              </span>
                              <span className="text-xs font-bold text-[#145343] dark:text-emerald-400">
                                {slot.className} ({slot.sectionName})
                              </span>
                              {slot.room && (
                                <span className="text-[11px] text-stone-400 font-mono">Room {slot.room}</span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: slot.subjectColor }}
                              />
                              <span className="font-semibold text-stone-800 dark:text-slate-200">
                                {slot.subjectName}
                              </span>
                              <span className="text-stone-300 dark:text-slate-700">|</span>
                              <span className="text-rose-700 dark:text-rose-400 font-medium">
                                অনুপস্থিত: {slot.absentTeacherName}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {saved ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-200 text-[10px] font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                Saved in Log
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                                অসংরক্ষিত সাজেশন
                              </span>
                            )}
                            {saved?.overriddenWarning && (
                              <span
                                title={saved.overriddenWarning}
                                className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px] font-bold"
                              >
                                Override
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Merged Inline Dropdown (Old Rule) + Status & Smart Suggestion Drawer (New Rule) */}
                        <div
                          className="mt-2.5 pt-2.5 border-t border-stone-100 dark:border-slate-800/80 space-y-2"
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <select
                              value={selectedTeacherId}
                              onChange={e => void handleInlineDropdownAssign(slot, e.target.value)}
                              className={`flex-1 min-h-[38px] py-1.5 px-2.5 text-xs rounded-xl border font-semibold focus:outline-none focus:ring-1 focus:ring-[#145343] ${
                                selectedTeacherId
                                  ? 'bg-[#eef5f2]/70 dark:bg-emerald-950/40 border-[#bfd5cc] dark:border-emerald-800 text-stone-900 dark:text-emerald-100'
                                  : 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                              }`}
                            >
                              <option value="">— বদলি শিক্ষক নির্বাচন করুন —</option>
                              {slotCandidates.freeCandidates.map(c => (
                                <option key={c.teacher.id} value={c.teacher.id}>
                                  {c.teacher.name} ({c.teacher.initials}) · Load {c.workload.totalWeeklyLoad}/{c.workload.weeklyMax} {c.isSameSubject ? '★ একই বিষয়' : c.isSameDepartment ? '◆ একই বিভাগ' : '✓ ফ্রি'}
                                </option>
                              ))}
                            </select>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {saved && (
                                <select
                                  value={saved.status}
                                  onChange={e =>
                                    void onUpdateProxyStatus(
                                      saved.id,
                                      e.target.value as ProxyLogStatus,
                                      `স্ট্যাটাস আপডেট (${saved.date} P${saved.periodIndex}): ${saved.proxyTeacherName} → ${e.target.value}`
                                    )
                                  }
                                  className="min-h-[36px] px-2 py-1 text-[11px] font-bold rounded-lg border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-stone-800 dark:text-slate-200"
                                >
                                  <option value="assigned">Assigned</option>
                                  <option value="completed">Completed</option>
                                  <option value="cancelled">Cancelled</option>
                                </select>
                              )}

                              <button
                                type="button"
                                onClick={() => setFocusedSlotKey(slot.slotKey)}
                                className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                                  isFocused
                                    ? 'bg-[#145343] text-white'
                                    : 'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-200 hover:bg-stone-200'
                                }`}
                              >
                                {isFocused ? 'সাজেশন খোলা' : 'বিস্তারিত সাজেশন'}
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
                                effectiveMatchType === 'same_subject'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                                  : effectiveMatchType === 'same_department'
                                  ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
                                  : effectiveMatchType === 'manual'
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200'
                                  : 'bg-stone-100 text-stone-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {effectiveReason}
                            </span>

                            {saved && (
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                <UserCheck className="w-3.5 h-3.5" />
                                {saved.proxyTeacherName}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Smart Free Teacher Suggestion Panel Column */}
            <div className="xl:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 overflow-hidden shadow-2xs xl:sticky xl:top-20">
              <div className="p-4 border-b border-stone-100 dark:border-slate-800 bg-gradient-to-r from-[#145343]/10 to-transparent space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#145343] dark:text-emerald-400" />
                    <h3 className="text-sm font-bold text-stone-900 dark:text-white">
                      স্মার্ট ফ্রি শিক্ষক সাজেশন
                    </h3>
                  </div>
                  {focusedSlot && (
                    <span className="px-2 py-0.5 rounded-lg bg-[#145343] text-white text-[10px] font-bold">
                      {focusedSlot.periodLabel} · {focusedSlot.className} ({focusedSlot.sectionName})
                    </span>
                  )}
                </div>

                {/* Sort Toggle: Lowest Load (New) vs Same Subject Priority (Old) */}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-stone-500 dark:text-slate-400">
                    {suggestionSortMode === 'lowest_load'
                      ? 'সর্বনিম্ন মোট সাপ্তাহিক লোড অনুযায়ী সাজানো।'
                      : 'একই বিষয় ও বিভাগের শিক্ষকদের অগ্রাধিকার দিয়ে সাজানো।'}
                  </p>
                  <div className="inline-flex rounded-lg bg-stone-100 dark:bg-slate-800 p-0.5 shrink-0 text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setSuggestionSortMode('lowest_load')}
                      className={`px-2 py-1 rounded-md transition-colors ${
                        suggestionSortMode === 'lowest_load'
                          ? 'bg-[#145343] text-white'
                          : 'text-stone-600 dark:text-slate-300'
                      }`}
                    >
                      সর্বনিম্ন লোড
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestionSortMode('subject_first')}
                      className={`px-2 py-1 rounded-md transition-colors ${
                        suggestionSortMode === 'subject_first'
                          ? 'bg-[#145343] text-white'
                          : 'text-stone-600 dark:text-slate-300'
                      }`}
                    >
                      একই বিষয় আগে
                    </button>
                  </div>
                </div>
              </div>

              {!focusedSlot || !focusedSlotEvaluation ? (
                <div className="p-8 text-center text-xs text-stone-500 dark:text-slate-400">
                  বাম দিক থেকে যেকোনো একটি প্রক্সি ক্লাস নির্বাচন করলে এখানে ফ্রি শিক্ষকদের র‍্যাংককৃত তালিকা দেখাবে।
                </div>
              ) : (
                <div className="p-3.5 sm:p-4 space-y-4">
                  {/* Available / Free Teachers List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-emerald-800 dark:text-emerald-300">
                      <span>উপলব্ধ ফ্রি শিক্ষক ({focusedSlotEvaluation.freeCandidates.length} জন)</span>
                      <span className="text-[10px] font-normal text-stone-500">
                        {suggestionSortMode === 'lowest_load' ? 'Lowest Load Ranked' : 'Subject + Load Ranked'}
                      </span>
                    </div>

                    {focusedSlotEvaluation.freeCandidates.length === 0 ? (
                      <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200">
                        এই পিরিয়ডে কোনো যোগ্য ফ্রি শিক্ষক অবসর নেই। নিচের ব্যস্ত/মুক্ত শিক্ষকদের তালিকা দেখুন।
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                        {focusedSlotEvaluation.freeCandidates.map(candidate => {
                          const isCurrentlyAssigned =
                            focusedSlot.savedLog?.proxyTeacherId === candidate.teacher.id;
                          const hasWarning = candidate.limitEval.requiresOverride;
                          const isNear = candidate.limitEval.isNearLimit && !hasWarning;

                          return (
                            <div
                              key={candidate.teacher.id}
                              className={`p-3 rounded-xl border transition-colors ${
                                isCurrentlyAssigned
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-700'
                                  : candidate.isRecommendedLowestLoad
                                  ? 'bg-[#eef5f2]/60 dark:bg-emerald-950/20 border-[#bfd5cc] dark:border-emerald-800/80'
                                  : 'bg-[#f7f5f0]/60 dark:bg-slate-800/50 border-stone-200 dark:border-slate-700'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-bold text-stone-900 dark:text-white truncate">
                                      {candidate.teacher.name}
                                    </span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-200 dark:bg-slate-700 text-stone-700 dark:text-slate-200">
                                      {candidate.teacher.initials}
                                    </span>
                                    {candidate.isRecommendedLowestLoad && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-bold">
                                        <Award className="w-3 h-3" />
                                        Recommended / Lowest Load
                                      </span>
                                    )}
                                  </div>

                                  {/* Required inline label format: Free | Load: 16/24 | Proxy: 1 */}
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="font-mono font-semibold text-[#145343] dark:text-emerald-300">
                                      {candidate.inlineLabel}
                                    </span>
                                    {candidate.isSameSubject && (
                                      <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 text-[10px] font-bold">
                                        ★ একই বিষয়
                                      </span>
                                    )}
                                    {!candidate.isSameSubject && candidate.isSameDepartment && (
                                      <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200 text-[10px] font-semibold">
                                        একই বিভাগ
                                      </span>
                                    )}
                                  </div>

                                  {hasWarning && (
                                    <div className="text-[10px] font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3 shrink-0" />
                                      <span>{candidate.limitEval.warnings[0]?.message}</span>
                                    </div>
                                  )}
                                  {isNear && (
                                    <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                      সাপ্তাহিক সীমার কাছাকাছি ({candidate.limitEval.projectedWeekly}/{candidate.limitEval.weeklyMax})
                                    </div>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  disabled={isSaving || isCurrentlyAssigned}
                                  onClick={() => void handleAssignCandidate(focusedSlot, candidate)}
                                  className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                                    isCurrentlyAssigned
                                      ? 'bg-emerald-600 text-white cursor-default'
                                      : hasWarning
                                      ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                      : 'bg-[#145343] hover:bg-[#0f4034] text-white'
                                  }`}
                                >
                                  {isCurrentlyAssigned ? 'Assigned' : hasWarning ? 'Override & Assign' : 'Assign'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Collapsible Busy / Absent / Exempted Teachers Section */}
                  <div className="pt-2 border-t border-stone-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setShowBusyTeachers(v => !v)}
                      className="w-full flex items-center justify-between text-xs font-bold text-stone-600 dark:text-slate-300 py-1.5"
                    >
                      <span>ব্যস্ত / অনুপস্থিত / প্রক্সি মুক্ত শিক্ষক ({focusedSlotEvaluation.busyCandidates.length} জন)</span>
                      {showBusyTeachers ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showBusyTeachers && (
                      <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto pr-1">
                        {focusedSlotEvaluation.busyCandidates.map(busy => (
                          <div
                            key={busy.teacher.id}
                            className="px-2.5 py-2 rounded-lg bg-stone-50 dark:bg-slate-800/50 border border-stone-200/80 dark:border-slate-700/70 flex items-center justify-between gap-2 text-[11px]"
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-stone-800 dark:text-slate-200">
                                {busy.teacher.name}
                              </span>{' '}
                              <span className="text-stone-400 font-mono">
                                ({busy.workload.totalWeeklyLoad}/{busy.workload.weeklyMax})
                              </span>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                                busy.reasonCode === 'absent'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                                  : busy.reasonCode === 'exempt'
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200'
                                  : busy.reasonCode === 'daily_proxy_limit'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                                  : 'bg-stone-200 text-stone-700 dark:bg-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {busy.reason}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: TEACHER WORKLOAD OVERVIEW                                    */}
      {/* =================================================================== */}
      {activeSubTab === 'workload' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 overflow-hidden shadow-2xs">
          <div className="p-4 sm:p-5 border-b border-stone-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-stone-900 dark:text-white">
                শিক্ষকদের সাপ্তাহিক ও দৈনিক ক্লাস লোড (Regular + Proxy)
              </h2>
              <p className="text-xs text-stone-500 dark:text-slate-400 mt-0.5">
                সপ্তাহ: {getWeekBoundsForDate(selectedDate).weekStart} থেকে {getWeekBoundsForDate(selectedDate).weekEnd} · নির্বাচিত দিন: {BENGALI_DAY_NAMES[selectedDay] || selectedDay}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={workloadSearch}
                  onChange={e => setWorkloadSearch(e.target.value)}
                  placeholder="শিক্ষকের নাম খুঁজুন..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 text-stone-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#145343]"
                />
              </div>

              <select
                value={workloadFilter}
                onChange={e => setWorkloadFilter(e.target.value as 'all' | 'alerts' | 'eligible')}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 text-stone-800 dark:text-slate-200"
              >
                <option value="all">সকল শিক্ষক ({teachers.length})</option>
                <option value="alerts">সতর্কতা / অতিরিক্ত লোড</option>
                <option value="eligible">শুধুমাত্র প্রক্সি যোগ্য</option>
              </select>
            </div>
          </div>

          {isMobileView ? (
            <div className="divide-y divide-stone-100 dark:divide-slate-800">
              {workloadSummaries.map(w => (
                <div key={w.teacher.id} className="p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-stone-900 dark:text-white truncate">
                        {w.teacher.name}
                      </div>
                      <div className="text-[11px] text-stone-500">
                        {w.teacher.initials} · {w.teacher.designation}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        w.status === 'Overloaded'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                          : w.status === 'Near Limit'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                      }`}
                    >
                      {w.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 text-center bg-[#f7f5f0] dark:bg-slate-800/60 p-2 rounded-xl text-[11px]">
                    <div>
                      <div className="text-stone-400 text-[10px]">নিয়মিত</div>
                      <div className="font-bold font-mono">{w.regularWeeklyPeriods}</div>
                    </div>
                    <div>
                      <div className="text-stone-400 text-[10px]">প্রক্সি</div>
                      <div className="font-bold font-mono text-blue-600 dark:text-blue-400">{w.proxyWeeklyPeriods}</div>
                    </div>
                    <div>
                      <div className="text-stone-400 text-[10px]">মোট/লিমিট</div>
                      <div className="font-bold font-mono">{w.totalWeeklyLoad}/{w.weeklyMax}</div>
                    </div>
                    <div>
                      <div className="text-stone-400 text-[10px]">দৈনিক</div>
                      <div className="font-bold font-mono">{w.totalDailyLoad}/{w.dailyMax}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[780px]">
                <thead>
                  <tr className="bg-stone-50 dark:bg-slate-800/60 border-b border-stone-200 dark:border-slate-800 text-xs text-stone-600 dark:text-slate-300">
                    <th className="py-3 px-4 font-semibold">শিক্ষকের নাম</th>
                    <th className="py-3 px-4 font-semibold text-center">নিয়মিত ক্লাস (সপ্তাহ)</th>
                    <th className="py-3 px-4 font-semibold text-center">প্রক্সি ক্লাস (সপ্তাহ)</th>
                    <th className="py-3 px-4 font-semibold text-center">মোট লোড / সর্বোচ্চ সীমা</th>
                    <th className="py-3 px-4 font-semibold text-center">নির্বাচিত দিনের লোড</th>
                    <th className="py-3 px-4 font-semibold text-center">স্ট্যাটাস</th>
                    <th className="py-3 px-4 font-semibold">নোট</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-slate-800/70 text-xs">
                  {workloadSummaries.map(w => {
                    const eligible = isEligibleForProxy(w.teacher, classes);
                    const pct = Math.min(100, Math.round((w.totalWeeklyLoad / w.weeklyMax) * 100));

                    return (
                      <tr key={w.teacher.id} className="hover:bg-stone-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <div className="font-bold text-stone-900 dark:text-white">{w.teacher.name}</div>
                          <div className="text-[11px] text-stone-500">
                            {w.teacher.initials} · {w.teacher.designation}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-semibold text-stone-800 dark:text-slate-200">
                          {w.regularWeeklyPeriods}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-blue-700 dark:text-blue-400">
                          {w.proxyWeeklyPeriods}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-mono font-bold text-stone-900 dark:text-white">
                              {w.totalWeeklyLoad} / {w.weeklyMax}
                            </span>
                            <div className="w-24 h-1.5 rounded-full bg-stone-200 dark:bg-slate-700 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  w.status === 'Overloaded'
                                    ? 'bg-rose-600'
                                    : w.status === 'Near Limit'
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-600'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono">
                          <span
                            className={`font-bold ${
                              w.totalDailyLoad > w.dailyMax
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-stone-700 dark:text-slate-300'
                            }`}
                          >
                            {w.totalDailyLoad} / {w.dailyMax}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                              w.status === 'Overloaded'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                                : w.status === 'Near Limit'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                            }`}
                          >
                            {w.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[11px] text-stone-500 dark:text-slate-400">
                          {eligible ? 'প্রক্সি যোগ্য' : 'প্রক্সি মুক্ত (Exempted)'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: PROXY LOG & ANALYTICS REPORT                                 */}
      {/* =================================================================== */}
      {activeSubTab === 'report' && (
        <div className="space-y-4">
          {/* Filters & Export Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-4 sm:p-5 shadow-2xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-stone-900 dark:text-white flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-[#145343] dark:text-emerald-400" />
                  <span>প্রক্সি ক্লাস লগ ও রিপোর্ট</span>
                </h2>
                <p className="text-xs text-stone-500 dark:text-slate-400 mt-0.5">
                  কোন শিক্ষক কতগুলো প্রক্সি নিয়েছেন, তারিখভিত্তিক পূর্ণাঙ্গ রেকর্ড, ফিল্টার ও PDF / Excel ডাউনলোড।
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void exportProxyReportExcel({
                      logs: filteredReportLogs,
                      teacherSummaryRows,
                      filterLabel: reportRangeLabel,
                      settings,
                      kpis: reportKpis,
                    }).catch(err => {
                      console.error('Proxy Excel export failed:', err);
                    })
                  }
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export Excel (.xlsx)</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void exportProxyReportPdf({
                      logs: filteredReportLogs,
                      teacherSummaryRows,
                      filterLabel: reportRangeLabel,
                      settings,
                      kpis: reportKpis,
                    })
                  }
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Print / Save as PDF</span>
                </button>
              </div>
            </div>

            {/* Date Range Presets */}
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-stone-100 dark:border-slate-800">
              <span className="text-xs font-bold text-stone-600 dark:text-slate-300 flex items-center gap-1 mr-1">
                <Filter className="w-3.5 h-3.5" />
                সময়সীমা:
              </span>
              {(
                [
                  { id: 'today', label: 'Today (আজ)' },
                  { id: 'week', label: 'This Week (এই সপ্তাহ)' },
                  { id: 'month', label: 'This Month (এই মাস)' },
                  { id: 'all', label: 'All (সকল)' },
                  { id: 'custom', label: 'Custom Range' },
                ] as const
              ).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setReportPreset(p.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                    reportPreset === p.id
                      ? 'bg-[#145343] text-white'
                      : 'bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 hover:bg-stone-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}

              {reportPreset === 'custom' && (
                <div className="flex items-center gap-2 ml-auto">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={e => setCustomStartDate(e.target.value)}
                    className="px-2.5 py-1 text-xs rounded-lg border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 font-mono"
                  />
                  <span className="text-xs text-stone-400">থেকে</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => setCustomEndDate(e.target.value)}
                    className="px-2.5 py-1 text-xs rounded-lg border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 font-mono"
                  />
                </div>
              )}
            </div>

            {/* Entity Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <select
                value={filterProxyTeacherId}
                onChange={e => setFilterProxyTeacherId(e.target.value)}
                className="px-2.5 py-2 text-xs rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 text-stone-800 dark:text-slate-200"
              >
                <option value="all">প্রক্সি শিক্ষক: সকল</option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.initials})
                  </option>
                ))}
              </select>

              <select
                value={filterAbsentTeacherId}
                onChange={e => setFilterAbsentTeacherId(e.target.value)}
                className="px-2.5 py-2 text-xs rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 text-stone-800 dark:text-slate-200"
              >
                <option value="all">অনুপস্থিত শিক্ষক: সকল</option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.initials})
                  </option>
                ))}
              </select>

              <select
                value={filterClassSection}
                onChange={e => setFilterClassSection(e.target.value)}
                className="px-2.5 py-2 text-xs rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 text-stone-800 dark:text-slate-200"
              >
                <option value="all">শ্রেণি ও সেকশন: সকল</option>
                {classes.flatMap(c =>
                  c.sections.map(s => (
                    <option key={`${c.id}_${s.id}`} value={`${c.id}_${s.id}`}>
                      {c.name} ({s.name})
                    </option>
                  ))
                )}
              </select>

              <select
                value={filterPeriod}
                onChange={e => setFilterPeriod(e.target.value)}
                className="px-2.5 py-2 text-xs rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 text-stone-800 dark:text-slate-200"
              >
                <option value="all">পিরিয়ড: সকল</option>
                {periodTimings
                  .filter(p => !p.isBreak)
                  .map(p => (
                    <option key={p.periodIndex} value={String(p.periodIndex)}>
                      {p.label} ({p.startTime})
                    </option>
                  ))}
              </select>

              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="px-2.5 py-2 text-xs rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 text-stone-800 dark:text-slate-200"
              >
                <option value="all">স্ট্যাটাস: সকল</option>
                <option value="assigned">Assigned</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* 4 Report KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-stone-200 dark:border-slate-800">
              <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">Total Proxy Classes</div>
              <div className="text-2xl font-bold text-stone-900 dark:text-white font-mono mt-1">
                {reportKpis.totalProxy}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-stone-200 dark:border-slate-800">
              <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">Today&apos;s Proxy Classes</div>
              <div className="text-2xl font-bold text-[#145343] dark:text-emerald-400 font-mono mt-1">
                {reportKpis.todayProxy}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-stone-200 dark:border-slate-800">
              <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">Most Active Proxy Teacher</div>
              <div className="text-sm font-bold text-blue-700 dark:text-blue-400 mt-1.5 truncate">
                {reportKpis.mostActiveName}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-stone-200 dark:border-slate-800">
              <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">Total Teachers Involved</div>
              <div className="text-2xl font-bold text-stone-900 dark:text-white font-mono mt-1">
                {reportKpis.teachersInvolved}
              </div>
            </div>
          </div>

          {/* Teacher-wise Proxy Summary Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-stone-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-stone-900 dark:text-white">
                শিক্ষক-ভিত্তিক প্রক্সি সারসংক্ষেপ (Teacher-wise Proxy Summary)
              </h3>
            </div>

            {teacherSummaryRows.length === 0 ? (
              <div className="p-8 text-center text-xs text-stone-500 dark:text-slate-400">
                নির্বাচিত ফিল্টারে কোনো শিক্ষক-ভিত্তিক প্রক্সি তথ্য পাওয়া যায়নি।
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[540px]">
                  <thead>
                    <tr className="bg-stone-50 dark:bg-slate-800/60 border-b border-stone-200 dark:border-slate-800 text-xs text-stone-600 dark:text-slate-300">
                      <th className="py-2.5 px-4 font-semibold">শিক্ষক</th>
                      <th className="py-2.5 px-4 font-semibold text-center">সক্রিয় প্রক্সি</th>
                      <th className="py-2.5 px-4 font-semibold text-center">সম্পন্ন (Completed)</th>
                      <th className="py-2.5 px-4 font-semibold text-center">বাতিল (Cancelled)</th>
                      <th className="py-2.5 px-4 font-semibold text-center">মোট দিন</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-slate-800 text-xs">
                    {teacherSummaryRows.map(row => (
                      <tr key={row.teacherId} className="hover:bg-stone-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-bold text-stone-900 dark:text-white">
                          {row.teacherName}{' '}
                          <span className="text-stone-400 font-mono font-normal">({row.initials})</span>
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono font-bold text-[#145343] dark:text-emerald-400">
                          {row.totalProxyCount}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono text-emerald-600 dark:text-emerald-400">
                          {row.completedCount}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono text-stone-400">
                          {row.cancelledCount}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono text-stone-700 dark:text-slate-300">
                          {row.datesCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Date-wise Proxy Log Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-stone-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-stone-900 dark:text-white">
                তারিখ-ভিত্তিক পূর্ণাঙ্গ প্রক্সি লগ ({filteredReportLogs.length}টি রেকর্ড)
              </h3>
            </div>

            {filteredReportLogs.length === 0 ? (
              <div className="p-10 text-center text-xs text-stone-500 dark:text-slate-400">
                নির্বাচিত ফিল্টারে কোনো প্রক্সি ক্লাস লগ পাওয়া যায়নি।
              </div>
            ) : isMobileView ? (
              <div className="divide-y divide-stone-100 dark:divide-slate-800">
                {filteredReportLogs.map(log => (
                  <div key={log.id} className="p-3.5 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-stone-900 dark:text-white">
                        {log.date} · {log.periodLabel}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE_MAP[log.status].cls}`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="font-semibold text-[#145343] dark:text-emerald-400">
                      {log.className} ({log.sectionName}) · {log.subjectName}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-rose-700 dark:text-rose-400">অনুপস্থিত: {log.absentTeacherName}</span>
                      <span className="font-bold text-stone-900 dark:text-white">প্রক্সি: {log.proxyTeacherName}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <select
                        value={log.status}
                        onChange={e =>
                          void onUpdateProxyStatus(
                            log.id,
                            e.target.value as ProxyLogStatus,
                            `প্রক্সি স্ট্যাটাস (${log.date} P${log.periodIndex}): ${log.proxyTeacherName} → ${e.target.value}`
                          )
                        }
                        className="px-2 py-1 text-[11px] rounded-lg border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      >
                        <option value="assigned">Assigned</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => setPendingDeleteLog(log)}
                        className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-[11px] font-bold flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        মুছুন
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[920px]">
                  <thead>
                    <tr className="bg-stone-50 dark:bg-slate-800/60 border-b border-stone-200 dark:border-slate-800 text-xs text-stone-600 dark:text-slate-300">
                      <th className="py-3 px-3.5 font-semibold">তারিখ ও বার</th>
                      <th className="py-3 px-3.5 font-semibold">পিরিয়ড</th>
                      <th className="py-3 px-3.5 font-semibold">শ্রেণি ও বিষয়</th>
                      <th className="py-3 px-3.5 font-semibold">অনুপস্থিত শিক্ষক</th>
                      <th className="py-3 px-3.5 font-semibold">প্রক্সি শিক্ষক</th>
                      <th className="py-3 px-3.5 font-semibold">বরাদ্দকারী</th>
                      <th className="py-3 px-3.5 font-semibold">স্ট্যাটাস</th>
                      <th className="py-3 px-3.5 font-semibold text-right">অ্যাকশন</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-slate-800 text-xs">
                    {filteredReportLogs.map(log => (
                      <tr key={log.id} className="hover:bg-stone-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <div className="font-mono font-bold text-stone-900 dark:text-white">{log.date}</div>
                          <div className="text-[11px] text-stone-500">{BENGALI_DAY_NAMES[log.day] || log.day}</div>
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <div className="font-semibold text-stone-800 dark:text-slate-200">{log.periodLabel}</div>
                          <div className="text-[11px] font-mono text-stone-400">{log.periodTime}</div>
                        </td>
                        <td className="py-2.5 px-3.5">
                          <div className="font-bold text-[#145343] dark:text-emerald-400">
                            {log.className} ({log.sectionName})
                          </div>
                          <div className="text-[11px] text-stone-600 dark:text-slate-300">{log.subjectName}</div>
                        </td>
                        <td className="py-2.5 px-3.5 text-rose-700 dark:text-rose-400 font-medium">
                          {log.absentTeacherName}
                        </td>
                        <td className="py-2.5 px-3.5">
                          <div className="font-bold text-stone-900 dark:text-white">{log.proxyTeacherName}</div>
                          {log.overriddenWarning && (
                            <div className="text-[10px] text-amber-700 dark:text-amber-300 max-w-[200px] truncate" title={log.overriddenWarning}>
                              Override: {log.overriddenWarning}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 text-[11px] text-stone-600 dark:text-slate-400">
                          <div>{log.assignedByName}</div>
                          <div className="font-mono text-[10px] opacity-75">{log.assignedByEmail}</div>
                        </td>
                        <td className="py-2.5 px-3.5">
                          <select
                            value={log.status}
                            onChange={e =>
                              void onUpdateProxyStatus(
                                log.id,
                                e.target.value as ProxyLogStatus,
                                `প্রক্সি স্ট্যাটাস (${log.date} P${log.periodIndex}): ${log.proxyTeacherName} → ${e.target.value}`
                              )
                            }
                            className={`px-2 py-1 text-[11px] font-bold rounded-lg border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 ${
                              log.status === 'cancelled'
                                ? 'text-stone-400'
                                : log.status === 'completed'
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-blue-700 dark:text-blue-300'
                            }`}
                          >
                            <option value="assigned">Assigned</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => setPendingDeleteLog(log)}
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                            title="লগ থেকে মুছুন"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 1: ADD MANUAL PROXY SLOT MODAL                                */}
      {/* =================================================================== */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900 dark:text-white">
                ম্যানুয়াল প্রক্সি ক্লাস যোগ করুন ({selectedDate})
              </h3>
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={e => void handleManualModalSubmit(e)} className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 dark:text-slate-300 mb-1">শ্রেণি</label>
                  <select
                    value={manualClassId}
                    onChange={e => {
                      const nextCls = classMap.get(e.target.value);
                      setManualClassId(e.target.value);
                      setManualSectionId(nextCls?.sections[0]?.id || '');
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800"
                  >
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-stone-700 dark:text-slate-300 mb-1">সেকশন</label>
                  <select
                    value={manualSectionId}
                    onChange={e => setManualSectionId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800"
                  >
                    {(manualSelectedClass?.sections || []).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 dark:text-slate-300 mb-1">পিরিয়ড</label>
                  <select
                    value={manualPeriodIndex}
                    onChange={e => setManualPeriodIndex(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800"
                  >
                    {periodTimings
                      .filter(p => !p.isBreak)
                      .map(p => (
                        <option key={p.periodIndex} value={p.periodIndex}>
                          {p.label} ({p.startTime})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-stone-700 dark:text-slate-300 mb-1">বিষয়</label>
                  <select
                    value={manualSubjectId}
                    onChange={e => setManualSubjectId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800"
                  >
                    {subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-stone-700 dark:text-slate-300 mb-1">অনুপস্থিত শিক্ষক</label>
                <select
                  value={manualAbsentTeacherId}
                  onChange={e => setManualAbsentTeacherId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800"
                >
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.initials})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-stone-700 dark:text-slate-300 mb-1">
                  ফ্রি প্রক্সি শিক্ষক ({manualCandidates.freeCandidates.length} জন উপলব্ধ)
                </label>
                <select
                  required
                  value={manualProxyTeacherId}
                  onChange={e => setManualProxyTeacherId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800 font-semibold"
                >
                  <option value="">— ফ্রি শিক্ষক নির্বাচন করুন —</option>
                  {manualCandidates.freeCandidates.map(c => (
                    <option key={c.teacher.id} value={c.teacher.id}>
                      {c.teacher.name} ({c.inlineLabel}){c.isRecommendedLowestLoad ? ' ★ Lowest Load' : ''}
                    </option>
                  ))}
                </select>
                {(() => {
                  const limitedToday = manualCandidates.busyCandidates.filter(
                    b => b.reasonCode === 'daily_proxy_limit'
                  );
                  if (limitedToday.length === 0) return null;
                  return (
                    <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                      দিনে ১টির বেশি প্রক্সি দেওয়া যাবে না — আজ ইতোমধ্যে ১টি প্রক্সি থাকায় বাদ:{' '}
                      {limitedToday.map(b => b.teacher.name).join(', ')}
                    </p>
                  );
                })()}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 font-semibold"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={!manualProxyTeacherId || isSaving}
                  className="px-4 py-2 rounded-xl bg-[#145343] hover:bg-[#0f4034] disabled:opacity-50 text-white font-bold"
                >
                  প্রক্সি সংরক্ষণ করুন
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 2: WORKLOAD LIMIT WARNING & ADMIN OVERRIDE CONFIRMATION       */}
      {/* =================================================================== */}
      {pendingOverride && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-amber-300 dark:border-amber-800 max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 flex items-center gap-2.5">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
              <h3 className="text-sm font-bold text-amber-950 dark:text-amber-100">
                {pendingOverride.title}
              </h3>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <p className="text-stone-700 dark:text-slate-300 leading-relaxed">
                নিচের সতর্কতাগুলো লক্ষ্য করুন। শুধুমাত্র জরুরি প্রয়োজনে Admin Override নিশ্চিত করে প্রক্সি বরাদ্দ করুন:
              </p>

              <ul className="space-y-1.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl p-3 text-rose-900 dark:text-rose-200">
                {pendingOverride.warnings.map((w, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingOverride(null)}
                  className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-200 font-semibold"
                >
                  ফিরে যান
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    const items = pendingOverride.items;
                    setPendingOverride(null);
                    void commitProxyItems(items);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold"
                >
                  Admin Override নিশ্চিত ও সংরক্ষণ করুন
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 3: DELETE PROXY LOG CONFIRMATION                              */}
      {/* =================================================================== */}
      {pendingDeleteLog && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900 max-w-md w-full shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-700 dark:text-rose-300">
              <Trash2 className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold">প্রক্সি লগ মুছে ফেলতে চান?</h3>
            </div>
            <p className="text-xs text-stone-600 dark:text-slate-300 leading-relaxed">
              <strong>{pendingDeleteLog.date}</strong> ({pendingDeleteLog.periodLabel}) —{' '}
              {pendingDeleteLog.className} ({pendingDeleteLog.sectionName}):{' '}
              <strong>{pendingDeleteLog.proxyTeacherName}</strong>-এর প্রক্সি লগটি স্থায়ীভাবে মুছে ফেলা হবে।
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteLog(null)}
                className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-200 text-xs font-semibold"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingDeleteLog;
                  setPendingDeleteLog(null);
                  void onDeleteProxyLog(
                    target.id,
                    `প্রক্সি লগ মুছে ফেলা হয়েছে (${target.date} P${target.periodIndex}): ${target.className} — ${target.proxyTeacherName}`
                  );
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
              >
                মুছে ফেলুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
