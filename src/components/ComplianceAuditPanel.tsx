import React, { useMemo, useState } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  ProxyLogEntry,
  RoutineConflict,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import { computeTeacherWorkload, getTeacherDailyMax } from '../services/workloadService';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Wand2,
  Users,
  Layers,
  ClipboardCheck,
  Wrench,
} from 'lucide-react';
import { isSlotDismissed } from '../services/scheduleTiers';
import {
  getEffectiveSectionRequirements,
  isAgricultureSubject,
  isAgricultureTeacher,
  isClassNineOrTen,
  isHigherMathSubject,
  isHinduReligionSubject,
  isHinduReligionTeacher,
  isIslamReligionSubject,
  isPlayOrNursery,
} from '../services/parallelSubjects';
import { verifyRoutine } from '../services/routineVerifier';
import type { GenerationResult } from '../services/routineGenerator';

interface ComplianceAuditPanelProps {
  classes: SchoolClass[];
  teachers: Teacher[];
  subjects: Subject[];
  entries: TimetableEntry[];
  proxyLogs?: ProxyLogEntry[];
  conflicts: RoutineConflict[];
  workingDays: DayOfWeek[];
  periodTimings: PeriodTiming[];
  settings?: SchoolSettings;
  onOpenAutoGenerate: () => void;
  onAutoFixRoutine?: () => GenerationResult | void;
  onUpdateTeachers?: (updated: Teacher[]) => void;
  onSelectTeacher: (teacherId: string) => void;
  onSelectClassSection: (classId: string, sectionId: string) => void;
}

export const ComplianceAuditPanel: React.FC<ComplianceAuditPanelProps> = ({
  classes,
  teachers,
  subjects,
  entries,
  proxyLogs = [],
  conflicts,
  workingDays,
  periodTimings,
  settings,
  onOpenAutoGenerate,
  onAutoFixRoutine,
  onUpdateTeachers,
  onSelectTeacher,
  onSelectClassSection,
}) => {
  const [auditTab, setAuditTab] = useState<'quota' | 'unassigned' | 'conflicts' | 'capacity'>('quota');
  const [conflictTypeFilter, setConflictTypeFilter] = useState<'all' | 'teacher_limit_exceeded' | 'other'>('all');
  const [isFixing, setIsFixing] = useState(false);

  const verification = useMemo(
    () =>
      verifyRoutine(
        entries,
        classes,
        teachers,
        subjects,
        workingDays,
        periodTimings,
        { type: 'all' },
        settings
      ),
    [entries, classes, teachers, subjects, workingDays, periodTimings, settings]
  );

  // 1. Live Teacher Quota & Combined Regular+Proxy Workload Audit
  const teacherAuditRows = useMemo(() => {
    const detailMap = new Map(verification.teacherDetails.map(d => [d.teacherId, d]));

    return teachers.map(teacher => {
      const vDetail = detailMap.get(teacher.id);
      const rawEntries = entries.filter(e => e.teacherId === teacher.id);
      const physicalSlots = vDetail?.assignedPeriods ?? new Set(rawEntries.map(e => `${e.day}_${e.periodIndex}`)).size;
      const sectionCoverage = vDetail?.sectionCoveragePeriods ?? rawEntries.length;
      const configuredTarget = vDetail?.requiredPeriods ?? 0;
      const activeDays = vDetail?.activeDays ?? new Set(rawEntries.map(e => e.day)).size;
      const isHindu = isHinduReligionTeacher(teacher, subjects);
      const isAgr = isAgricultureTeacher(teacher, subjects);
      const workload = computeTeacherWorkload(teacher, entries, proxyLogs, { workingDays });

      return {
        teacher,
        configuredTarget,
        scheduledCount: physicalSlots,
        sectionCoverage,
        diff: sectionCoverage - configuredTarget,
        activeDays,
        isHindu,
        isAgr,
        workload,
      };
    });
  }, [teachers, entries, proxyLogs, workingDays, subjects, verification.teacherDetails]);

  // 2. Live Section Capacity Audit (Curriculum periods vs Open Timetable Slots)
  const sectionCapacityRows = useMemo(() => {
    const teachingPeriods = periodTimings.filter(p => !p.isBreak && !p.isLocked);
    const rows: {
      classObj: SchoolClass;
      sectionId: string;
      sectionName: string;
      openSlots: number;
      requiredUniqueSlots: number;
      scheduledCount: number;
      isOverSubscribed: boolean;
    }[] = [];

    classes.forEach(cls => {
      cls.sections.forEach(sec => {
        const openSlots = workingDays.reduce((acc, d) => {
          return acc + teachingPeriods.filter(p => !isSlotDismissed(cls, d, p.periodIndex, sec.id, workingDays)).length;
        }, 0);

        let requiredUniqueSlots = 0;
        if (isPlayOrNursery(cls)) {
          requiredUniqueSlots = openSlots;
        } else {
          const effReqs = getEffectiveSectionRequirements(cls, sec.id, teachers);
          const hasHmt =
            isClassNineOrTen(cls) &&
            effReqs.some(r => isHigherMathSubject(r.subjectId, subjects));
          const hasRel = effReqs.some(r => isIslamReligionSubject(r.subjectId, subjects));
          const hasHin = effReqs.some(r => isHinduReligionSubject(r.subjectId, subjects));
          effReqs.forEach(req => {
            if (hasHmt && isAgricultureSubject(req.subjectId, subjects)) return;
            if (hasRel && hasHin && isHinduReligionSubject(req.subjectId, subjects)) return;
            requiredUniqueSlots += req.periodsPerWeek;
          });
        }

        const scheduledCount = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id).length;

        rows.push({
          classObj: cls,
          sectionId: sec.id,
          sectionName: sec.name,
          openSlots,
          requiredUniqueSlots,
          scheduledCount,
          isOverSubscribed: !isPlayOrNursery(cls) && requiredUniqueSlots > openSlots,
        });
      });
    });

    return rows;
  }, [classes, teachers, workingDays, periodTimings, entries, subjects]);

  // 3. Institutional Parallel & Room Rule Verification
  const islamEntries = entries.filter(e => isIslamReligionSubject(e.subjectId, subjects));
  const missingHinduPartners = islamEntries.filter(
    r =>
      !entries.some(
        e =>
          e.classId === r.classId &&
          e.sectionId === r.sectionId &&
          e.day === r.day &&
          e.periodIndex === r.periodIndex &&
          isHinduReligionSubject(e.subjectId, subjects)
      )
  ).length;

  const class910Ids = new Set(classes.filter(c => isClassNineOrTen(c)).map(c => c.id));
  const hmtAgrSlots = new Map<string, { hasHmt: boolean; hasAgr: boolean }>();
  entries.forEach(e => {
    if (!class910Ids.has(e.classId)) return;
    const isHmt = isHigherMathSubject(e.subjectId, subjects);
    const isAgr = isAgricultureSubject(e.subjectId, subjects);
    if (!isHmt && !isAgr) return;
    const k = `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`;
    const cur = hmtAgrSlots.get(k) || { hasHmt: false, hasAgr: false };
    if (isHmt) cur.hasHmt = true;
    if (isAgr) cur.hasAgr = true;
    hmtAgrSlots.set(k, cur);
  });
  let unpairedHmtAgrCount = 0;
  hmtAgrSlots.forEach(v => {
    if (v.hasHmt !== v.hasAgr) unpairedHmtAgrCount++;
  });

  // 4. Same-Day Subject Repeat & Exact Weekly Subject Quota Audit (KG - Class 10)
  const sameDayRepeatCount = useMemo(() => {
    const map = new Map<string, number>();
    const classMap = new Map(classes.map(c => [c.id, c]));
    entries.forEach(e => {
      const cls = classMap.get(e.classId);
      if (cls && isPlayOrNursery(cls)) return;
      const k = `${e.classId}_${e.sectionId}_${e.day}_${e.subjectId}`;
      map.set(k, (map.get(k) || 0) + 1);
    });
    let repeats = 0;
    map.forEach(cnt => {
      if (cnt > 1) repeats++;
    });
    return repeats;
  }, [entries, classes]);

  const sectionSubjectMismatchMap = useMemo(() => {
    const mismatchMap = new Map<string, number>();
    classes.forEach(cls => {
      if (isPlayOrNursery(cls)) return;
      cls.sections.forEach(sec => {
        const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
        if (secEntries.length === 0) return;
        const effReqs = getEffectiveSectionRequirements(cls, sec.id, teachers);
        const hasHmt =
          isClassNineOrTen(cls) &&
          effReqs.some(r => isHigherMathSubject(r.subjectId, subjects));

        let mismatches = 0;
        effReqs.forEach(req => {
          let target = req.periodsPerWeek;
          if (hasHmt && isAgricultureSubject(req.subjectId, subjects)) {
            const hmtReq = effReqs.find(r => isHigherMathSubject(r.subjectId, subjects));
            if (hmtReq) target = Math.max(target, hmtReq.periodsPerWeek);
          }
          const actual = secEntries.filter(e => e.subjectId === req.subjectId).length;
          if (actual !== target) mismatches++;
        });
        mismatchMap.set(`${cls.id}_${sec.id}`, mismatches);
      });
    });
    return mismatchMap;
  }, [classes, teachers, entries, subjects]);

  const overSubscribedCount = sectionCapacityRows.filter(r => r.isOverSubscribed).length;
  const vStatus = verification.finalCompletionStatus;

  const limitConflicts = useMemo(
    () => conflicts.filter(c => c.type === 'teacher_limit_exceeded'),
    [conflicts]
  );

  const filteredConflicts = useMemo(() => {
    if (conflictTypeFilter === 'teacher_limit_exceeded') {
      return limitConflicts;
    }
    if (conflictTypeFilter === 'other') {
      return conflicts.filter(c => c.type !== 'teacher_limit_exceeded');
    }
    return conflicts;
  }, [conflicts, limitConflicts, conflictTypeFilter]);

  const dailyLimitDiagnostics = useMemo(() => {
    const teacherDetailMap = new Map(verification.teacherDetails.map(d => [d.teacherId, d]));
    const conflictCountByTeacher = new Map<string, number>();
    limitConflicts.forEach(c => {
      if (c.teacherId) {
        conflictCountByTeacher.set(c.teacherId, (conflictCountByTeacher.get(c.teacherId) || 0) + 1);
      }
    });

    return teachers
      .filter(t => (conflictCountByTeacher.get(t.id) || 0) > 0)
      .map(teacher => {
        const maxDaily = getTeacherDailyMax(teacher);
        const dayCounts = workingDays.map(day => {
          const slots = new Set<number>();
          entries.forEach(e => {
            if (e.teacherId === teacher.id && e.day === day) {
              slots.add(e.periodIndex);
            }
          });
          return {
            day,
            shortDay: day.slice(0, 3),
            count: slots.size,
            exceeded: slots.size > maxDaily,
          };
        });
        const weeklyPhysical = dayCounts.reduce((acc, d) => acc + d.count, 0);
        const requiredPeriods = teacherDetailMap.get(teacher.id)?.requiredPeriods ?? 0;
        const effectiveWeeklyTarget = Math.max(weeklyPhysical, requiredPeriods);
        const weeklyCapFromDaily = maxDaily * Math.max(1, workingDays.length);
        const isImpossibleLimit = effectiveWeeklyTarget > weeklyCapFromDaily;
        const minRequiredDaily = Math.max(
          maxDaily + 1,
          Math.ceil(effectiveWeeklyTarget / Math.max(1, workingDays.length))
        );
        return {
          teacher,
          maxDaily,
          dayCounts,
          weeklyPhysical,
          requiredPeriods,
          weeklyCapFromDaily,
          isImpossibleLimit,
          minRequiredDaily,
          violationCount: conflictCountByTeacher.get(teacher.id) || 0,
        };
      })
      .sort((a, b) => b.violationCount - a.violationCount);
  }, [teachers, entries, workingDays, limitConflicts, verification.teacherDetails]);

  const handleOpenCheckTarget = (checkId: string) => {
    if (checkId === 'fv-limits' || checkId === 'chk-teacher-limits') {
      setAuditTab('conflicts');
      setConflictTypeFilter('teacher_limit_exceeded');
    } else if (checkId === 'fv-unassigned') {
      setAuditTab('unassigned');
    } else if (checkId === 'fv-workload' || checkId === 'chk-teacher-unassigned') {
      setAuditTab('quota');
    } else if (checkId === 'fv-quotas' || checkId === 'chk-subject-quota') {
      setAuditTab(verification.unassignedClasses > 0 ? 'unassigned' : 'capacity');
    } else {
      setAuditTab('conflicts');
      setConflictTypeFilter('all');
    }
  };

  const handleRaiseTeacherDailyLimit = (teacher: Teacher, newLimit: number) => {
    if (!onUpdateTeachers) return;
    const clamped = Math.max(1, Math.min(10, newLimit));
    const updated = teachers.map(t =>
      t.id === teacher.id ? { ...t, maxDailyPeriods: clamped } : t
    );
    onUpdateTeachers(updated);
  };

  return (
    <div className="space-y-6">
      {/* Final Routine Verification Dashboard */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl ${
                vStatus === 'complete'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : vStatus === 'warning'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
              }`}
            >
              {vStatus === 'complete' ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {verification.statusHeadline}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {verification.statusSubtext}
                {missingHinduPartners > 0 ? ` · ${missingHinduPartners} Islam slots missing Hindu partner` : ''}
                {unpairedHmtAgrCount > 0 ? ` · ${unpairedHmtAgrCount} Class 9–10 HMT/AGR unpaired` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {onAutoFixRoutine && (
              <button
                type="button"
                disabled={isFixing}
                onClick={() => {
                  setIsFixing(true);
                  setTimeout(() => {
                    onAutoFixRoutine();
                    setIsFixing(false);
                  }, 50);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-60"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>{isFixing ? 'Fixing...' : 'Auto Fix Routine'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenAutoGenerate}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#145343] hover:bg-[#0f3f33] dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Auto-Resolve & Regenerate</span>
            </button>
          </div>
        </div>

        {/* 8-Point Final Validation Statuses */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
              Final Validation Dashboard (৮-দফা চূড়ান্ত যাচাই)
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide ${
                verification.finalValidation.allPassed
                  ? 'bg-emerald-600 text-white'
                  : 'bg-rose-600 text-white'
              }`}
            >
              {verification.finalValidation.allPassed ? 'ALL 8 PASSED' : 'ACTION REQUIRED'}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 p-3 bg-white dark:bg-slate-900">
            {verification.finalValidation.items.map(item => (
              <div
                key={item.id}
                onClick={() => handleOpenCheckTarget(item.id)}
                title="বিস্তারিত দেখতে ক্লিক করুন"
                className={`p-2.5 rounded-lg border flex flex-col justify-between gap-1 cursor-pointer transition-colors hover:shadow-2xs ${
                  item.status === 'PASS'
                    ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20'
                    : 'border-rose-300 dark:border-rose-900/70 bg-rose-50/60 dark:bg-rose-950/25 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {item.label}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                      item.status === 'PASS'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-200'
                        : 'bg-rose-100 text-rose-800 dark:bg-rose-900/70 dark:text-rose-200'
                    }`}
                  >
                    {item.valueText}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                  {item.detail}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 10 Dashboard Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Classes Required
            </div>
            <div className="text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
              {verification.totalClassesRequired}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Classes Assigned
            </div>
            <div className="text-lg font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums mt-0.5">
              {verification.totalClassesAssigned}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Teachers · Subjects · Sections
            </div>
            <div className="text-sm font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-1.5">
              {verification.totalTeachers} · {verification.totalSubjects} · {verification.totalSections}
            </div>
          </div>

          <div
            className={`p-3 rounded-xl border ${
              verification.unassignedClasses > 0
                ? 'border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40'
            }`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Unassigned Classes
            </div>
            <div
              className={`text-lg font-mono font-bold tabular-nums mt-0.5 ${
                verification.unassignedClasses > 0
                  ? 'text-rose-700 dark:text-rose-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {verification.unassignedClasses}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Teacher / Class Conflicts
            </div>
            <div
              className={`text-lg font-mono font-bold tabular-nums mt-0.5 ${
                verification.teacherConflicts + verification.classSectionConflicts > 0
                  ? 'text-rose-700 dark:text-rose-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {verification.teacherConflicts} / {verification.classSectionConflicts}
            </div>
          </div>
        </div>

        {/* Religion Scheduling Status + 8-Point Automatic Verification Checklist */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs">
          {verification.checks.map(chk => (
            <div
              key={chk.id}
              onClick={() => handleOpenCheckTarget(chk.id)}
              title="বিস্তারিত দেখতে ক্লিক করুন"
              className={`px-3 py-2 rounded-lg border flex items-start justify-between gap-2 cursor-pointer transition-colors ${
                chk.passed
                  ? 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
                  : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/35'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                {chk.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : chk.severity === 'warning' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {chk.label}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {chk.detail}
                  </div>
                </div>
              </div>
              <span
                className={`text-[11px] font-semibold shrink-0 ${
                  chk.passed
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : chk.severity === 'warning'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {chk.passed ? 'OK' : chk.severity === 'warning' ? 'Notice' : 'Issue'}
              </span>
            </div>
          ))}
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setAuditTab('quota')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              auditTab === 'quota'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Teacher Load Match ({teachers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setAuditTab('unassigned')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              auditTab === 'unassigned'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>
              Unassigned Breakdown ({verification.unassignedClasses})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setAuditTab('conflicts')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              auditTab === 'conflicts'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Conflicts & Pacing ({conflicts.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setAuditTab('capacity')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              auditTab === 'capacity'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>
              Section Slot Capacity {overSubscribedCount > 0 ? `(${overSubscribedCount} Over)` : ''}
            </span>
          </button>
        </div>
      </div>

      {/* Tab 2: Unassigned Classes Breakdown */}
      {auditTab === 'unassigned' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                অনির্ধারিত ক্লাস ও ঘাটতি বিবরণ (Zero Unassigned Verification)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                কোনো শ্রেণি, সেকশন, বিষয় বা শিক্ষকের নির্ধারিত পিরিয়ড বাকি থাকলে এখানে বিস্তারিত কারণসহ প্রদর্শিত হবে।
              </p>
            </div>
            <span className="font-mono text-xs font-bold tabular-nums text-slate-700 dark:text-slate-300">
              {verification.unassignedClasses} missing periods
            </span>
          </div>

          {verification.unassignedDetails.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2.5" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                শূন্য অনির্ধারিত ক্লাস (Zero Unassigned Classes)
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                সকল শ্রেণি ও সেকশনের নির্বাচিত প্রতিটি বিষয়ের নির্ধারিত পিরিয়ড শতভাগ পূর্ণ হয়েছে।
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-4 font-semibold">Class · Section</th>
                    <th className="py-2.5 px-4 font-semibold">Subject</th>
                    <th className="py-2.5 px-4 font-semibold">Assigned Teacher</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Assigned / Required</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Missing</th>
                    <th className="py-2.5 px-4 font-semibold">Reason</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {verification.unassignedDetails.map((item, idx) => (
                    <tr
                      key={`${item.classId}_${item.sectionId}_${item.subjectId}_${idx}`}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                    >
                      <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {item.className} · {item.sectionName}
                      </td>
                      <td className="py-2.5 px-4 text-slate-800 dark:text-slate-200">
                        {item.subjectName}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">
                        {item.assignedTeacherName || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {item.assignedPeriods} / {item.requiredPeriods}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400">
                        {item.missingPeriods}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                        {item.reason}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectClassSection(item.classId, item.sectionId)}
                          className="text-blue-700 dark:text-blue-400 hover:underline font-semibold inline-flex items-center gap-1"
                        >
                          <span>Open</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 1: Teacher Quota vs Scheduled Load Table */}
      {auditTab === 'quota' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                শিক্ষকদের নির্ধারিত ক্লাস বনাম রুটিন অডিট (Configured vs Scheduled)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                প্রতিটি শিক্ষকের জন্য নির্ধারিত মোট ক্লাস এবং ক্লাস/টিচার রুটিনে থাকা পিরিয়ড সংখ্যা এখানে এক নজরে যাচাই করুন।
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-4 font-semibold">Teacher</th>
                  <th className="py-2.5 px-4 font-semibold">Policy / Role</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Configured</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Regular</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Proxy (Wk)</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Total / Limit</th>
                  <th className="py-2.5 px-4 font-semibold">Workload Status</th>
                  <th className="py-2.5 px-4 font-semibold">Quota Match</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {teacherAuditRows.map(row => {
                  const isExactMatch = row.configuredTarget === 0 || row.diff === 0;
                  const wl = row.workload;
                  return (
                    <tr
                      key={row.teacher.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {row.teacher.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {row.teacher.initials} · {row.teacher.designation}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">
                        {row.teacher.isBlockTeacher
                          ? 'Play/Nursery Block · Proxy Exempt'
                          : row.teacher.isCoordinator
                          ? 'Coordinator · Proxy Exempt'
                          : row.isAgr
                          ? `Agriculture Room · Free-Gap Pacing${row.teacher.noProxy ? ' · Proxy Exempt' : ''}`
                          : row.isHindu
                          ? `Hindu Room · Free-Gap Pacing${row.teacher.noProxy ? ' · Proxy Exempt' : ''}`
                          : row.teacher.noProxy
                          ? 'Proxy Exempt'
                          : 'Regular Faculty'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-slate-700 dark:text-slate-300">
                        {row.configuredTarget > 0 ? row.configuredTarget : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                        {row.scheduledCount}
                        {row.sectionCoverage > row.scheduledCount && (
                          <span className="block text-[10px] font-normal text-indigo-600 dark:text-indigo-400">
                            ({row.sectionCoverage} sec)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                        {wl.proxyWeeklyPeriods}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold">
                        <span
                          className={
                            wl.status === 'Overloaded'
                              ? 'text-rose-600 dark:text-rose-400'
                              : wl.status === 'Near Limit'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-900 dark:text-white'
                          }
                        >
                          {wl.totalWeeklyLoad} / {wl.weeklyMax}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                              wl.status === 'Overloaded'
                                ? 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800'
                                : wl.status === 'Near Limit'
                                ? 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
                                : 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                            }`}
                          >
                            {wl.status}
                          </span>
                          {wl.peakDailyLoad > wl.dailyMax && (
                            <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                              দৈনিক সর্বোচ্চ: {wl.peakDailyLoad}/{wl.dailyMax}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        {isExactMatch ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>
                              {row.sectionCoverage > row.scheduledCount
                                ? `Exact (${row.sectionCoverage}/${row.configuredTarget})`
                                : 'Exact Match'}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>
                              {row.diff > 0 ? `+${row.diff} Extra` : `${Math.abs(row.diff)} Unassigned`}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectTeacher(row.teacher.id)}
                          className="text-blue-700 dark:text-blue-400 hover:underline font-semibold inline-flex items-center gap-1"
                        >
                          <span>View</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Conflicts & Pacing List */}
      {auditTab === 'conflicts' && (
        <div className="space-y-4">
          {conflicts.length > 0 && (
            <div className="flex items-center justify-between gap-2 flex-wrap bg-white dark:bg-slate-900 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setConflictTypeFilter('all')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    conflictTypeFilter === 'all'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  All ({conflicts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setConflictTypeFilter('teacher_limit_exceeded')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    conflictTypeFilter === 'teacher_limit_exceeded'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100'
                  }`}
                >
                  Daily/Weekly Limits ({limitConflicts.length})
                </button>
                {conflicts.length > limitConflicts.length && (
                  <button
                    type="button"
                    onClick={() => setConflictTypeFilter('other')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                      conflictTypeFilter === 'other'
                        ? 'bg-rose-600 text-white'
                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
                    }`}
                  >
                    Other Conflicts ({conflicts.length - limitConflicts.length})
                  </button>
                )}
              </div>
              {dailyLimitDiagnostics.length > 0 && (
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  মোট {dailyLimitDiagnostics.length} জন শিক্ষকের {limitConflicts.length}টি সীমা লঙ্ঘন পাওয়া গেছে
                </span>
              )}
            </div>
          )}

          {/* Dedicated Daily/Weekly Teacher Limit Diagnostic Breakdown */}
          {dailyLimitDiagnostics.length > 0 && conflictTypeFilter !== 'other' && (
            <div className="bg-amber-50/70 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900/70 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      দৈনিক ও সাপ্তাহিক পিরিয়ড সীমা বিশ্লেষণ ({limitConflicts.length}টি লঙ্ঘন · {dailyLimitDiagnostics.length} জন শিক্ষক)
                    </span>
                  </h3>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                    নিচে প্রতিটি শিক্ষকের দিনভিত্তিক ক্লাস সংখ্যা, সীমা অতিক্রমের কারণ ও সরাসরি সমাধান দেওয়া হলো।
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {dailyLimitDiagnostics.map(diag => (
                  <div
                    key={diag.teacher.id}
                    className="bg-white dark:bg-slate-900 rounded-lg border border-amber-200/80 dark:border-amber-900/60 p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          {diag.teacher.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          দৈনিক সীমা: {diag.maxDaily} পিরিয়ড/দিন · সপ্তাহে মোট: {diag.weeklyPhysical} ক্লাস
                          {diag.requiredPeriods > 0 ? ` (নির্ধারিত ${diag.requiredPeriods})` : ''} · {diag.violationCount}টি সীমা লঙ্ঘন
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectTeacher(diag.teacher.id)}
                        className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline shrink-0 inline-flex items-center gap-1"
                      >
                        <span>রুটিন দেখুন</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Per-Day Breakdown Badges */}
                    <div className="flex flex-wrap gap-1.5">
                      {diag.dayCounts.map(dc => (
                        <span
                          key={dc.day}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                            dc.exceeded
                              ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800'
                              : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                          }`}
                        >
                          {dc.shortDay}: {dc.count}/{diag.maxDaily}
                          {dc.exceeded ? ' !' : ''}
                        </span>
                      ))}
                    </div>

                    {/* Diagnosis & One-Click Action */}
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/60 p-2 rounded-md">
                      {diag.isImpossibleLimit ? (
                        <>
                          <strong>কারণ:</strong> সপ্তাহে নির্ধারিত/বরাদ্দ ক্লাস ({Math.max(diag.weeklyPhysical, diag.requiredPeriods)}টি) বর্তমান দৈনিক সীমা অনুযায়ী সর্বোচ্চ ক্ষমতার ({diag.maxDaily} × {workingDays.length} দিন = {diag.weeklyCapFromDaily}টি) চেয়ে বেশি। তাই দৈনিক সীমা কমপক্ষে <strong>{diag.minRequiredDaily}</strong> করতে হবে অথবা কিছু ক্লাস অন্য শিক্ষকের নামে দিতে হবে।
                        </>
                      ) : (
                        <>
                          <strong>কারণ:</strong> সপ্তাহে মোট ক্লাস ({diag.weeklyPhysical}টি) সর্বোচ্চ ক্ষমতার ({diag.weeklyCapFromDaily}টি) মধ্যে থাকলেও নির্দিষ্ট দিনে {diag.maxDaily}-এর বেশি ক্লাস জমে গেছে। অটো-ফিক্স করলে ক্লাসগুলো কম চাপের দিনে সমানভাবে সরে যাবে।
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {diag.isImpossibleLimit && onUpdateTeachers && (
                        <button
                          type="button"
                          onClick={() => handleRaiseTeacherDailyLimit(diag.teacher, diag.minRequiredDaily)}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                        >
                          দৈনিক সীমা {diag.minRequiredDaily} পিরিয়ড করুন
                        </button>
                      )}
                      {!diag.isImpossibleLimit && onAutoFixRoutine && (
                        <button
                          type="button"
                          disabled={isFixing}
                          onClick={() => {
                            setIsFixing(true);
                            setTimeout(() => {
                              onAutoFixRoutine();
                              setIsFixing(false);
                            }, 50);
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-emerald-700 hover:bg-emerald-800 text-white transition-colors disabled:opacity-60"
                        >
                          {isFixing ? 'Rebalancing...' : 'Auto Fix / Rebalance করুন'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredConflicts.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-12 text-center">
              <ShieldCheck className="w-11 h-11 text-emerald-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Zero Conflicts Found
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Every class and teacher schedule is aligned, conflict-free, and satisfies all institutional policies.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredConflicts.map(conf => (
                <div
                  key={conf.id}
                  className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`font-semibold ${
                          conf.severity === 'error'
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {conf.severity === 'error' ? 'Critical Collision' : 'Pacing Notice'} · {conf.type.replace(/_/g, ' ')}
                      </span>
                      <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {conf.day} · P{conf.periodIndex}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      {conf.title}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {conf.description}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div className="text-xs text-slate-500 tabular-nums">
                      {conf.entryIds.length} slot{conf.entryIds.length > 1 ? 's' : ''} affected
                    </div>
                    {conf.teacherId ? (
                      <button
                        type="button"
                        onClick={() => onSelectTeacher(conf.teacherId!)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 flex items-center gap-1"
                      >
                        <span>Open Teacher Routine</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (conf.classId && conf.sectionId) {
                            onSelectClassSection(conf.classId, conf.sectionId);
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 flex items-center gap-1"
                      >
                        <span>Open Class Routine</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Section Capacity Audit */}
      {auditTab === 'capacity' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              শ্রেণি ও সেকশনভিত্তিক সাপ্তাহিক পিরিয়ড ধারণক্ষমতা (Section Slot Capacity)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              প্রতিটি সেকশনে সপ্তাহে মোট খালি পিরিয়ড এবং বিষয় ব্যবস্থাপনায় চাওয়া পিরিয়ডের তুলনা।
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-4 font-semibold">Class & Section</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Weekly Open Slots</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Curriculum Required</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Scheduled</th>
                  <th className="py-2.5 px-4 font-semibold">Subject Quota Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {sectionCapacityRows.map(r => {
                  const subMismatchCount = sectionSubjectMismatchMap.get(`${r.classObj.id}_${r.sectionId}`) || 0;
                  return (
                  <tr
                    key={`${r.classObj.id}_${r.sectionId}`}
                    onClick={() => onSelectClassSection(r.classObj.id, r.sectionId)}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                      {r.classObj.name} · {r.sectionName}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {r.openSlots}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {r.requiredUniqueSlots}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                      {r.scheduledCount}
                    </td>
                    <td className="py-2.5 px-4">
                      {r.isOverSubscribed ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>
                            Exceeds by {r.requiredUniqueSlots - r.openSlots} period{r.requiredUniqueSlots - r.openSlots > 1 ? 's' : ''}
                          </span>
                        </span>
                      ) : r.scheduledCount === 0 ? (
                        <span className="text-slate-400">Not scheduled</span>
                      ) : subMismatchCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>{subMismatchCount} subject quota mismatch</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Exact Weekly Match</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
