import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AnnualSubjectPlan,
  AnnualTopicItem,
  DayOfWeek,
  LessonPlanFileMeta,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import {
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  FileType2,
  FolderOpen,
  Loader2,
  Minus,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useViewMode } from '../context/ViewModeContext';
import { isPlayOrNursery } from '../services/parallelSubjects';
import {
  arrayBufferToBase64,
  buildAnnualPlanId,
  computeAnnualProgress,
  DEFAULT_ACADEMIC_WEEKS,
  formatFileSize,
  generateScheduleTopicSlots,
  getLessonPlanFileKind,
  getWeeklyPeriodsForClassSubject,
  MAX_ANNUAL_CLASSES,
  MAX_TOPICS_PER_PLAN,
  suggestAnnualClassTotal,
  validateLessonPlanCandidate,
} from '../services/annualPlanUtils';

interface AnnualPlanDashboardViewProps {
  classes: SchoolClass[];
  subjects: Subject[];
  teachers: Teacher[];
  entries: TimetableEntry[];
  settings: SchoolSettings;
  selectedClassId: string;
  setSelectedClassId: (id: string) => void;
  annualPlans: AnnualSubjectPlan[];
  actorUid?: string;
  actorName: string;
  readOnly?: boolean;
  onSaveAnnualPlan: (plan: AnnualSubjectPlan, summary: string) => Promise<void>;
  onUploadLessonPlanFile: (params: {
    plan: AnnualSubjectPlan;
    fileMeta: LessonPlanFileMeta;
    dataBase64: string;
    summary: string;
  }) => Promise<void>;
  onDownloadLessonPlanFile: (fileMeta: LessonPlanFileMeta) => Promise<void>;
  onDeleteLessonPlanFile: (
    plan: AnnualSubjectPlan,
    fileMeta: LessonPlanFileMeta,
    summary: string
  ) => Promise<void>;
}

export const AnnualPlanDashboardView: React.FC<AnnualPlanDashboardViewProps> = ({
  classes,
  subjects,
  teachers,
  entries,
  settings,
  selectedClassId,
  setSelectedClassId,
  annualPlans,
  actorUid = '',
  actorName,
  readOnly = false,
  onSaveAnnualPlan,
  onUploadLessonPlanFile,
  onDownloadLessonPlanFile,
  onDeleteLessonPlanFile,
}) => {
  const { isMobileView } = useViewMode();
  const activeClass = classes.find(c => c.id === selectedClassId) || classes[0];
  const academicYear = settings.academicYear || String(new Date().getFullYear());

  const [academicWeeks, setAcademicWeeks] = useState<number>(DEFAULT_ACADEMIC_WEEKS);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [extraTrackSubjectId, setExtraTrackSubjectId] = useState<string>('');
  const [topicFilter, setTopicFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [topicSearch, setTopicSearch] = useState('');

  // Editable annual total/completed inputs for active subject
  const [totalDraft, setTotalDraft] = useState<string>('');
  const [completedDraft, setCompletedDraft] = useState<string>('');
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  // Add new topic state
  const [newTopicDate, setNewTopicDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [newTopicText, setNewTopicText] = useState('');
  const [newTopicNotes, setNewTopicNotes] = useState('');

  // Inline edit topic state
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editTopicDate, setEditTopicDate] = useState('');
  const [editTopicText, setEditTopicText] = useState('');
  const [editTopicNotes, setEditTopicNotes] = useState('');

  // Auto-generate dated topic rows from weekly timetable
  const [showSlotGenerator, setShowSlotGenerator] = useState(false);
  const [genStartDate, setGenStartDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [genCount, setGenCount] = useState<number>(10);

  // Lesson plan upload / download states
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [confirmDeleteFileId, setConfirmDeleteFileId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const subjectMap = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects]);
  const teacherMap = useMemo(() => new Map(teachers.map(t => [t.id, t])), [teachers]);

  // Map plans by (classId + subjectId) for active academic year
  const planByClassSubject = useMemo(() => {
    const map = new Map<string, AnnualSubjectPlan>();
    annualPlans.forEach(p => {
      if (p.academicYear === academicYear) {
        map.set(`${p.classId}__${p.subjectId}`, p);
      }
    });
    return map;
  }, [annualPlans, academicYear]);

  // All subjects tracked/applicable for the active class
  const classSubjectIds = useMemo(() => {
    if (!activeClass) return [] as string[];
    const ids: string[] = [];
    const pushUnique = (id: string) => {
      if (id && subjectMap.has(id) && !ids.includes(id)) {
        ids.push(id);
      }
    };

    if (isPlayOrNursery(activeClass)) {
      pushUnique('sub-block-play-nur');
    }

    activeClass.subjectRequirements.forEach(req => pushUnique(req.subjectId));

    activeClass.sections.forEach(sec => {
      sec.selectedSubjectIds?.forEach(pushUnique);
      if (sec.subjectConfigs) {
        Object.keys(sec.subjectConfigs).forEach(pushUnique);
      }
    });

    entries.forEach(e => {
      if (e.classId === activeClass.id) pushUnique(e.subjectId);
    });

    annualPlans.forEach(p => {
      if (p.classId === activeClass.id && p.academicYear === academicYear) {
        pushUnique(p.subjectId);
      }
    });

    return ids;
  }, [activeClass, entries, annualPlans, academicYear, subjectMap]);

  useEffect(() => {
    if (classSubjectIds.length === 0) {
      setSelectedSubjectId('');
      return;
    }
    if (!selectedSubjectId || !classSubjectIds.includes(selectedSubjectId)) {
      setSelectedSubjectId(classSubjectIds[0]);
    }
  }, [classSubjectIds, selectedSubjectId]);

  const unaddedSubjects = useMemo(
    () => subjects.filter(s => !classSubjectIds.includes(s.id)),
    [subjects, classSubjectIds]
  );

  // Build subject summary rows for selected class
  const subjectRows = useMemo(() => {
    if (!activeClass) return [];
    return classSubjectIds.map(subId => {
      const subject = subjectMap.get(subId)!;
      const plan = planByClassSubject.get(`${activeClass.id}__${subId}`);
      const weeklyPeriods = getWeeklyPeriodsForClassSubject(activeClass, subId, entries);
      const suggestedTotal = suggestAnnualClassTotal(activeClass, subId, entries, academicWeeks);
      const progress = computeAnnualProgress(plan, suggestedTotal);
      return {
        subjectId: subId,
        subject,
        plan,
        weeklyPeriods,
        suggestedTotal,
        progress,
        fileCount: plan?.fileRefs?.length || 0,
      };
    });
  }, [activeClass, classSubjectIds, subjectMap, planByClassSubject, entries, academicWeeks]);

  // Aggregate KPI totals for the selected class
  const classKpis = useMemo(() => {
    let totalPlanned = 0;
    let totalCompleted = 0;
    let totalFiles = 0;
    subjectRows.forEach(row => {
      totalPlanned += row.progress.total;
      totalCompleted += row.progress.completed;
      totalFiles += row.fileCount;
    });
    const totalRemaining = Math.max(0, totalPlanned - totalCompleted);
    const overallPercent =
      totalPlanned > 0 ? Math.min(100, Math.round((totalCompleted / totalPlanned) * 100)) : 0;

    return {
      subjectCount: subjectRows.length,
      totalPlanned,
      totalCompleted,
      totalRemaining,
      overallPercent,
      totalFiles,
    };
  }, [subjectRows]);

  const activeRow =
    subjectRows.find(r => r.subjectId === selectedSubjectId) || subjectRows[0] || null;

  // Materialize an AnnualSubjectPlan object (from saved cloud doc or fresh draft)
  const buildWorkingPlan = (row: NonNullable<typeof activeRow>): AnnualSubjectPlan => {
    if (row.plan) {
      return {
        ...row.plan,
        topics: [...(row.plan.topics || [])],
        fileRefs: [...(row.plan.fileRefs || [])],
      };
    }
    return {
      id: buildAnnualPlanId(academicYear, activeClass.id, row.subjectId),
      academicYear,
      classId: activeClass.id,
      subjectId: row.subjectId,
      totalClassesPlanned: row.suggestedTotal,
      completedClasses: 0,
      topics: [],
      fileRefs: [],
      updatedAt: new Date().toISOString(),
      updatedByUid: actorUid || 'admin',
      updatedByName: actorName || 'Admin',
    };
  };

  useEffect(() => {
    if (!activeRow) {
      setTotalDraft('');
      setCompletedDraft('');
      return;
    }
    setTotalDraft(String(activeRow.progress.total));
    setCompletedDraft(String(activeRow.progress.completed));
    setEditingTopicId(null);
    setLocalError(null);
    setConfirmDeleteFileId(null);
  }, [activeRow?.subjectId, activeRow?.progress.total, activeRow?.progress.completed, activeClass?.id]);

  const activeTopicsFiltered = useMemo(() => {
    const list = activeRow?.plan?.topics || [];
    const q = topicSearch.trim().toLowerCase();
    return [...list]
      .sort((a, b) => a.classNumber - b.classNumber)
      .filter(item => {
        if (topicFilter === 'completed' && !item.isCompleted) return false;
        if (topicFilter === 'pending' && item.isCompleted) return false;
        if (!q) return true;
        return (
          item.topic.toLowerCase().includes(q) ||
          (item.date || '').toLowerCase().includes(q) ||
          (item.notes || '').toLowerCase().includes(q) ||
          String(item.classNumber).includes(q)
        );
      });
  }, [activeRow?.plan?.topics, topicFilter, topicSearch]);

  const persistPlanUpdate = async (nextPlan: AnnualSubjectPlan, summary: string) => {
    if (readOnly) return;
    setLocalError(null);
    setIsSavingPlan(true);
    try {
      await onSaveAnnualPlan(nextPlan, summary);
    } catch (err: any) {
      setLocalError(err?.message || 'পরিবর্তন সংরক্ষণ করতে সমস্যা হয়েছে।');
    } finally {
      setIsSavingPlan(false);
    }
  };

  const handleSaveCounts = async () => {
    if (!activeRow || readOnly) return;
    const parsedTotal = Math.max(
      1,
      Math.min(MAX_ANNUAL_CLASSES, Math.round(Number(totalDraft) || activeRow.suggestedTotal))
    );
    const parsedCompleted = Math.max(
      0,
      Math.min(parsedTotal, Math.round(Number(completedDraft) || 0))
    );
    const working = buildWorkingPlan(activeRow);
    working.totalClassesPlanned = parsedTotal;
    working.completedClasses = parsedCompleted;
    await persistPlanUpdate(
      working,
      `${activeClass.name} (${activeRow.subject.name}): মোট ক্লাস ${parsedTotal}, সম্পন্ন ${parsedCompleted}`
    );
  };

  const handleQuickAdjustCompleted = async (
    row: NonNullable<typeof activeRow>,
    delta: number
  ) => {
    if (readOnly) return;
    const working = buildWorkingPlan(row);
    const total = Math.max(1, Math.min(MAX_ANNUAL_CLASSES, working.totalClassesPlanned));
    const nextCompleted = Math.max(0, Math.min(total, (working.completedClasses || 0) + delta));
    if (nextCompleted === working.completedClasses && row.plan) return;
    working.totalClassesPlanned = total;
    working.completedClasses = nextCompleted;
    await persistPlanUpdate(
      working,
      `${activeClass.name} (${row.subject.name}): সম্পন্ন ক্লাস ${nextCompleted}/${total}`
    );
  };

  const handleAddTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRow || readOnly) return;
    const cleanTopic = newTopicText.trim();
    if (!cleanTopic) {
      setLocalError('সেই দিনের ক্লাসের টপিক লিখুন।');
      return;
    }
    const working = buildWorkingPlan(activeRow);
    if (working.topics.length >= MAX_TOPICS_PER_PLAN) {
      setLocalError(`প্রতিটি বিষয়ে সর্বোচ্চ ${MAX_TOPICS_PER_PLAN}টি টপিক এন্ট্রি রাখা যায়।`);
      return;
    }
    const nextClassNumber =
      working.topics.reduce((max, t) => Math.max(max, Number(t.classNumber) || 0), 0) + 1;
    const newItem: AnnualTopicItem = {
      id: `top-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      classNumber: nextClassNumber,
      ...(newTopicDate ? { date: newTopicDate } : {}),
      topic: cleanTopic.slice(0, 300),
      isCompleted: false,
      ...(newTopicNotes.trim() ? { notes: newTopicNotes.trim().slice(0, 400) } : {}),
    };
    working.topics = [...working.topics, newItem];
    setNewTopicText('');
    setNewTopicNotes('');
    await persistPlanUpdate(
      working,
      `${activeClass.name} (${activeRow.subject.name}): ক্লাস #${nextClassNumber} টপিক যুক্ত হয়েছে`
    );
  };

  const handleToggleTopicCompleted = async (topicId: string) => {
    if (!activeRow || readOnly) return;
    const working = buildWorkingPlan(activeRow);
    const target = working.topics.find(t => t.id === topicId);
    if (!target) return;
    const nextDone = !target.isCompleted;
    working.topics = working.topics.map(t =>
      t.id === topicId ? { ...t, isCompleted: nextDone } : t
    );
    const total = Math.max(1, working.totalClassesPlanned);
    working.completedClasses = Math.max(
      0,
      Math.min(total, (working.completedClasses || 0) + (nextDone ? 1 : -1))
    );
    await persistPlanUpdate(
      working,
      `${activeClass.name} (${activeRow.subject.name}): ক্লাস #${target.classNumber} ${
        nextDone ? 'সম্পন্ন' : 'বাকি'
      } চিহ্নিত`
    );
  };

  const handleSaveTopicEdit = async (topicId: string) => {
    if (!activeRow || readOnly) return;
    const cleanTopic = editTopicText.trim();
    if (!cleanTopic) {
      setLocalError('টপিকের নাম খালি রাখা যাবে না।');
      return;
    }
    const working = buildWorkingPlan(activeRow);
    working.topics = working.topics.map(t =>
      t.id === topicId
        ? {
            ...t,
            ...(editTopicDate ? { date: editTopicDate } : { date: undefined }),
            topic: cleanTopic.slice(0, 300),
            ...(editTopicNotes.trim()
              ? { notes: editTopicNotes.trim().slice(0, 400) }
              : { notes: undefined }),
          }
        : t
    );
    setEditingTopicId(null);
    await persistPlanUpdate(
      working,
      `${activeClass.name} (${activeRow.subject.name}): টপিক আপডেট হয়েছে`
    );
  };

  const handleDeleteTopic = async (topicId: string) => {
    if (!activeRow || readOnly) return;
    const working = buildWorkingPlan(activeRow);
    working.topics = working.topics
      .filter(t => t.id !== topicId)
      .map((t, idx) => ({ ...t, classNumber: idx + 1 }));
    await persistPlanUpdate(
      working,
      `${activeClass.name} (${activeRow.subject.name}): টপিক তালিকা থেকে সরানো হয়েছে`
    );
  };

  const handleGenerateRoutineSlots = async () => {
    if (!activeRow || readOnly) return;
    const working = buildWorkingPlan(activeRow);
    const generated = generateScheduleTopicSlots({
      startDate: genStartDate,
      workingDays: settings.workingDays as DayOfWeek[],
      entries,
      classId: activeClass.id,
      subjectId: activeRow.subjectId,
      count: genCount,
      existingTopics: working.topics,
    });
    if (generated.length === 0) {
      setLocalError('নতুন কোনো স্লট তৈরি করা যায়নি (সর্বোচ্চ সীমা পূর্ণ অথবা কর্মদিবস নেই)।');
      return;
    }
    working.topics = [...working.topics, ...generated];
    setShowSlotGenerator(false);
    await persistPlanUpdate(
      working,
      `${activeClass.name} (${activeRow.subject.name}): রুটিন অনুযায়ী ${generated.length}টি ক্লাস স্লট তৈরি`
    );
  };

  const handleSyncCompletedFromTopics = async () => {
    if (!activeRow || readOnly) return;
    const working = buildWorkingPlan(activeRow);
    const doneCount = working.topics.filter(t => t.isCompleted).length;
    working.completedClasses = Math.min(working.totalClassesPlanned, doneCount);
    await persistPlanUpdate(
      working,
      `${activeClass.name} (${activeRow.subject.name}): টপিক তালিকা অনুযায়ী সম্পন্ন ক্লাস (${working.completedClasses}) সিঙ্ক`
    );
  };

  const handleTrackExtraSubject = async () => {
    if (!activeClass || !extraTrackSubjectId || readOnly) return;
    const sub = subjectMap.get(extraTrackSubjectId);
    if (!sub) return;
    const suggested = suggestAnnualClassTotal(activeClass, extraTrackSubjectId, entries, academicWeeks);
    const newPlan: AnnualSubjectPlan = {
      id: buildAnnualPlanId(academicYear, activeClass.id, extraTrackSubjectId),
      academicYear,
      classId: activeClass.id,
      subjectId: extraTrackSubjectId,
      totalClassesPlanned: suggested,
      completedClasses: 0,
      topics: [],
      fileRefs: [],
      updatedAt: new Date().toISOString(),
      updatedByUid: actorUid || 'admin',
      updatedByName: actorName || 'Admin',
    };
    const targetId = extraTrackSubjectId;
    setExtraTrackSubjectId('');
    setSelectedSubjectId(targetId);
    await persistPlanUpdate(newPlan, `${activeClass.name}: "${sub.name}" বার্ষিক পরিকল্পনায় যুক্ত`);
  };

  const handleLessonFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeRow || readOnly) return;

    const working = buildWorkingPlan(activeRow);
    const check = validateLessonPlanCandidate({
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      existingFileCount: working.fileRefs.length,
    });
    if (!check.ok) {
      setLocalError(check.error);
      return;
    }

    setLocalError(null);
    setIsUploadingFile(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const fileId = `lp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const fileMeta: LessonPlanFileMeta = {
        id: fileId,
        fileName: file.name.slice(0, 160),
        mimeType: check.resolvedMime,
        fileSize: file.size,
        uploadedAtIso: new Date().toISOString(),
        uploadedByName: actorName || 'Admin',
      };
      await onUploadLessonPlanFile({
        plan: working,
        fileMeta,
        dataBase64: base64,
        summary: `${activeClass.name} (${activeRow.subject.name}): লেসন প্ল্যান ফাইল আপলোড (${file.name})`,
      });
    } catch (err: any) {
      setLocalError(err?.message || 'লেসন প্ল্যান ফাইল আপলোড করতে সমস্যা হয়েছে।');
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleDownloadFile = async (meta: LessonPlanFileMeta) => {
    setLocalError(null);
    setDownloadingFileId(meta.id);
    try {
      await onDownloadLessonPlanFile(meta);
    } catch (err: any) {
      setLocalError(err?.message || 'ফাইল ডাউনলোড করতে সমস্যা হয়েছে।');
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handleDeleteFile = async (meta: LessonPlanFileMeta) => {
    if (!activeRow || readOnly) return;
    const working = buildWorkingPlan(activeRow);
    setLocalError(null);
    setIsUploadingFile(true);
    try {
      await onDeleteLessonPlanFile(
        working,
        meta,
        `${activeClass.name} (${activeRow.subject.name}): লেসন প্ল্যান ফাইল অপসারণ (${meta.fileName})`
      );
      setConfirmDeleteFileId(null);
    } catch (err: any) {
      setLocalError(err?.message || 'ফাইল মুছতে সমস্যা হয়েছে।');
    } finally {
      setIsUploadingFile(false);
    }
  };

  const renderFileKindIcon = (mimeType: string, fileName: string) => {
    const kind = getLessonPlanFileKind(mimeType, fileName);
    if (kind === 'pdf') {
      return (
        <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
          <FileType2 className="w-4 h-4" />
        </div>
      );
    }
    if (kind === 'excel') {
      return (
        <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
          <FileSpreadsheet className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800/70 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
        <FileText className="w-4 h-4" />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Workspace Header & Class Selector */}
      <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-stone-900 dark:text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#145343] dark:text-emerald-400 shrink-0" />
              <span>বার্ষিক শ্রেণি-ভিত্তিক বিষয় ট্র্যাকার ও লেসন প্ল্যান</span>
            </h1>
            <p className="text-xs text-stone-500 dark:text-slate-400 mt-0.5">
              সেশন {academicYear} · সারা বছরে কোন বিষয়ে মোট কয়টি ক্লাস হবে, কতটি সম্পন্ন হয়েছে ও বাকি আছে এবং প্রতিদিনের টপিক ও লেসন প্ল্যান ফাইল।
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label className="text-[11px] font-semibold text-stone-600 dark:text-slate-300 whitespace-nowrap">
              বাৎসরিক কর্মসপ্তাহ:
            </label>
            <select
              aria-label="Academic Weeks Per Year"
              value={academicWeeks}
              onChange={e => setAcademicWeeks(Number(e.target.value) || DEFAULT_ACADEMIC_WEEKS)}
              className="px-2.5 py-1.5 text-xs font-mono font-semibold bg-[#f7f5f0] dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#145343]"
            >
              <option value={36}>36 Weeks</option>
              <option value={40}>40 Weeks</option>
              <option value={44}>44 Weeks</option>
              <option value={48}>48 Weeks</option>
            </select>
          </div>
        </div>

        {/* Class Pills Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {classes.map(cls => {
            const isSelected = cls.id === activeClass?.id;
            return (
              <button
                key={cls.id}
                type="button"
                onClick={() => setSelectedClassId(cls.id)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-[#145343] text-white font-bold'
                    : 'bg-[#f7f5f0] dark:bg-slate-800 text-stone-700 dark:text-slate-200 hover:bg-stone-200/70 dark:hover:bg-slate-700 font-medium'
                }`}
              >
                <span>{cls.name}</span>
              </button>
            );
          })}
        </div>

        {/* Class Teachers Assignment Summary Strip for Selected Class */}
        {activeClass && (
          <div className="pt-2.5 border-t border-stone-100 dark:border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-stone-700 dark:text-slate-300">
              <UserCheck className="w-3.5 h-3.5 text-[#145343] dark:text-emerald-400" />
              <span>শ্রেণি শিক্ষক ({activeClass.name}):</span>
            </span>
            {activeClass.sections.map(sec => {
              const ct = sec.classTeacherId ? teacherMap.get(sec.classTeacherId) : undefined;
              return (
                <span key={sec.id} className="text-stone-600 dark:text-slate-300">
                  <strong className="text-stone-800 dark:text-slate-100">{sec.name}:</strong>{' '}
                  {ct ? (
                    <span className="text-[#145343] dark:text-emerald-400 font-semibold">
                      {ct.name} ({ct.initials})
                    </span>
                  ) : (
                    <span className="text-stone-400">নির্ধারিত নয়</span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* 4-Metric KPI Strip (Single Elevation, Tabular Figures) */}
      <div className={`grid gap-3 ${isMobileView ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-3.5">
          <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">
            মোট বিষয় ({activeClass?.name})
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-stone-900 dark:text-white">
              {classKpis.subjectCount}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-stone-500 dark:text-slate-400">
              {classKpis.totalFiles} ফাইল
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-3.5">
          <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">
            বছরের মোট ক্লাস (Planned)
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold font-mono tabular-nums text-stone-900 dark:text-white">
            {classKpis.totalPlanned}
          </div>
        </div>

        <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-3.5">
          <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">
            ক্লাস সম্পন্ন হয়েছে
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#145343] dark:text-emerald-400">
              {classKpis.totalCompleted}
            </span>
            <span className="text-xs font-mono font-bold tabular-nums text-[#145343] dark:text-emerald-400">
              {classKpis.overallPercent}%
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-3.5">
          <div className="text-[11px] font-semibold text-stone-500 dark:text-slate-400">
            ক্লাস বাকি আছে
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
            {classKpis.totalRemaining}
          </div>
        </div>
      </div>

      {/* Inline Validation / Sync Alert */}
      {localError && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{localError}</span>
          </div>
          <button
            type="button"
            onClick={() => setLocalError(null)}
            className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/50"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Master-Detail Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left: Class Subjects Summary Table (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-[#f7f5f0]/70 dark:bg-slate-900/50">
            <div>
              <h2 className="text-xs font-bold text-stone-900 dark:text-white uppercase tracking-wide">
                {activeClass?.name} — বিষয়সমূহ
              </h2>
              <p className="text-[11px] text-stone-500 dark:text-slate-400">
                বিষয় নির্বাচন করলে ডানপাশে টপিক ও লেসন প্ল্যান খুলবে
              </p>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-stone-500 dark:text-slate-400">
              {subjectRows.length} টি
            </span>
          </div>

          {subjectRows.length === 0 ? (
            <div className="p-6 text-center text-xs text-stone-500 dark:text-slate-400 space-y-2">
              <p>এই শ্রেণিতে এখনও কোনো বিষয় নির্ধারিত হয়নি।</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100 dark:divide-slate-800">
              {subjectRows.map(row => {
                const isSelected = activeRow?.subjectId === row.subjectId;
                return (
                  <div
                    key={row.subjectId}
                    onClick={() => setSelectedSubjectId(row.subjectId)}
                    className={`px-4 py-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#eef5f2] dark:bg-emerald-950/35 border-l-4 border-l-[#145343] dark:border-l-emerald-400'
                        : 'hover:bg-stone-50 dark:hover:bg-slate-800/40 border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: row.subject.color || '#145343' }}
                          />
                          <span className="text-xs font-bold text-stone-900 dark:text-white truncate">
                            {row.subject.name}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-stone-500 dark:text-slate-400">
                          <span>সপ্তাহে {row.weeklyPeriods} ক্লাস</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {row.progress.topicCount} টপিক
                          </span>
                          {row.fileCount > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-[#145343] dark:text-emerald-400 font-semibold font-mono tabular-nums">
                                {row.fileCount} ফাইল
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {!readOnly && (
                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={isSavingPlan || row.progress.completed <= 0}
                            onClick={() => void handleQuickAdjustCompleted(row, -1)}
                            title="সম্পন্ন ক্লাস ১ কমান"
                            className="w-6 h-6 rounded border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-stone-700 dark:text-slate-200 flex items-center justify-center hover:bg-stone-100 disabled:opacity-40"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={isSavingPlan || row.progress.completed >= row.progress.total}
                            onClick={() => void handleQuickAdjustCompleted(row, 1)}
                            title="সম্পন্ন ক্লাস ১ বাড়ান"
                            className="w-6 h-6 rounded border border-[#bfd5cc] dark:border-emerald-800 bg-white dark:bg-slate-800 text-[#145343] dark:text-emerald-400 flex items-center justify-center hover:bg-[#eef5f2] disabled:opacity-40"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Numeric Total / Completed / Remaining + Bar */}
                    <div className="mt-2.5 flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="text-stone-600 dark:text-slate-300">
                        মোট: <strong className="text-stone-900 dark:text-white">{row.progress.total}</strong>
                      </span>
                      <span className="text-[#145343] dark:text-emerald-400">
                        হয়েছে: <strong>{row.progress.completed}</strong>
                      </span>
                      <span className="text-amber-700 dark:text-amber-400">
                        বাকি: <strong>{row.progress.remaining}</strong>
                      </span>
                      <span className="text-stone-500 dark:text-slate-400 font-bold">
                        {row.progress.percent}%
                      </span>
                    </div>
                    <div className="mt-1.5 w-full h-1.5 rounded-full bg-stone-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-[#145343] dark:bg-emerald-500 transition-all duration-300"
                        style={{ width: `${row.progress.percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add Extra Subject to Annual Plan (Admins only) */}
          {!readOnly && unaddedSubjects.length > 0 && (
            <div className="p-3 border-t border-stone-200 dark:border-slate-800 bg-[#f7f5f0]/50 dark:bg-slate-900/40 flex items-center gap-2">
              <select
                aria-label="অতিরিক্ত বিষয় নির্বাচন"
                value={extraTrackSubjectId}
                onChange={e => setExtraTrackSubjectId(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white"
              >
                <option value="">অন্য বিষয় ট্র্যাক করতে নির্বাচন করুন...</option>
                {unaddedSubjects.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!extraTrackSubjectId || isSavingPlan}
                onClick={() => void handleTrackExtraSubject()}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#145343] hover:bg-[#0f3f33] dark:bg-emerald-700 rounded-lg disabled:opacity-40 shrink-0"
              >
                যুক্ত করুন
              </button>
            </div>
          )}
        </div>

        {/* Right: Active Subject Workspace (Annual Counts, Lesson Plan Files, Daily Topic Log) (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {!activeRow ? (
            <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-8 text-center text-xs text-stone-500 dark:text-slate-400">
              বাম পাশ থেকে একটি বিষয় নির্বাচন করুন।
            </div>
          ) : (
            <>
              {/* Subject Counts & Progress Control Panel */}
              <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: activeRow.subject.color || '#145343' }}
                    />
                    <h2 className="text-sm sm:text-base font-bold text-stone-900 dark:text-white">
                      {activeClass?.name} — {activeRow.subject.name}
                    </h2>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-stone-500 dark:text-slate-400">
                    রুটিন প্রস্তাবনা: সপ্তাহে {activeRow.weeklyPeriods} × {academicWeeks} সপ্তাহ ={' '}
                    <strong className="text-stone-800 dark:text-slate-200">
                      {activeRow.suggestedTotal}
                    </strong>{' '}
                    ক্লাস
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 dark:text-slate-400 mb-1">
                      বছরে মোট ক্লাস (Planned)
                    </label>
                    {readOnly ? (
                      <div className="px-3 py-2 text-sm font-mono font-bold tabular-nums bg-[#f7f5f0] dark:bg-slate-900 rounded-lg border border-stone-200 dark:border-slate-800 text-stone-900 dark:text-white">
                        {activeRow.progress.total}
                      </div>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        max={MAX_ANNUAL_CLASSES}
                        value={totalDraft}
                        onChange={e => setTotalDraft(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-mono font-bold tabular-nums bg-white dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#145343]"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 dark:text-slate-400 mb-1">
                      ক্লাস হয়েছে (Completed)
                    </label>
                    {readOnly ? (
                      <div className="px-3 py-2 text-sm font-mono font-bold tabular-nums bg-[#eef5f2] dark:bg-emerald-950/40 rounded-lg border border-[#bfd5cc] dark:border-emerald-800 text-[#145343] dark:text-emerald-300">
                        {activeRow.progress.completed}
                      </div>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        max={MAX_ANNUAL_CLASSES}
                        value={completedDraft}
                        onChange={e => setCompletedDraft(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-mono font-bold tabular-nums bg-white dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-[#145343] dark:text-emerald-300 focus:outline-none focus:ring-1 focus:ring-[#145343]"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 dark:text-slate-400 mb-1">
                      ক্লাস বাকি আছে (Remaining)
                    </label>
                    <div className="px-3 py-1.5 text-sm font-mono font-bold tabular-nums bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 rounded-lg text-amber-800 dark:text-amber-300">
                      {Math.max(
                        0,
                        (Number(totalDraft) || activeRow.progress.total) -
                          (Number(completedDraft) || 0)
                      )}
                    </div>
                  </div>
                </div>

                {!readOnly && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isSavingPlan}
                      onClick={() => void handleSyncCompletedFromTopics()}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#145343] dark:text-emerald-400" />
                      <span>
                        টপিক চেকলিস্ট ({activeRow.progress.completedTopicCount}) থেকে সিঙ্ক
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={isSavingPlan}
                      onClick={() => void handleSaveCounts()}
                      className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#145343] hover:bg-[#0f3f33] dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isSavingPlan ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>ক্লাস সংখ্যা সংরক্ষণ করুন</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Lesson Plan Files Panel (Word / PDF / Excel) */}
              <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-stone-900 dark:text-white flex items-center gap-1.5">
                      <FolderOpen className="w-4 h-4 text-[#145343] dark:text-emerald-400" />
                      <span>লেসন প্ল্যান ফাইল (Word / PDF / Excel)</span>
                    </h3>
                    <p className="text-[11px] text-stone-500 dark:text-slate-400 mt-0.5">
                      সর্বোচ্চ 580 KB পর্যন্ত `.doc`, `.docx`, `.pdf`, `.xls`, `.xlsx` ফাইল আপলোড ও ডাউনলোড করা যাবে।
                    </p>
                  </div>

                  {!readOnly && (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".doc,.docx,.pdf,.xls,.xlsx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={e => void handleLessonFileChange(e)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={isUploadingFile}
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-[#145343] hover:bg-[#0f3f33] dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                      >
                        {isUploadingFile ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        <span>ফাইল আপলোড করুন</span>
                      </button>
                    </div>
                  )}
                </div>

                {(activeRow.plan?.fileRefs?.length || 0) === 0 ? (
                  <div className="py-4 px-3 rounded-lg border border-dashed border-stone-200 dark:border-slate-800 text-center text-xs text-stone-500 dark:text-slate-400">
                    এই বিষয়ের জন্য এখনো কোনো Word, PDF বা Excel লেসন প্ল্যান ফাইল আপলোড করা হয়নি।
                  </div>
                ) : (
                  <div className="divide-y divide-stone-100 dark:divide-slate-800 border border-stone-200 dark:border-slate-800 rounded-lg overflow-hidden">
                    {activeRow.plan!.fileRefs.map(file => {
                      const kind = getLessonPlanFileKind(file.mimeType, file.fileName);
                      const isDownloading = downloadingFileId === file.id;
                      const isConfirmingDel = confirmDeleteFileId === file.id;
                      return (
                        <div
                          key={file.id}
                          className="px-3 py-2.5 flex items-center justify-between gap-3 bg-white dark:bg-[#141a20]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {renderFileKindIcon(file.mimeType, file.fileName)}
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-stone-900 dark:text-white truncate">
                                {file.fileName}
                              </div>
                              <div className="text-[11px] text-stone-500 dark:text-slate-400 flex items-center gap-2 font-mono tabular-nums">
                                <span className="uppercase font-semibold">{kind}</span>
                                <span>·</span>
                                <span>{formatFileSize(file.fileSize)}</span>
                                <span>·</span>
                                <span className="font-sans truncate">{file.uploadedByName}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={isDownloading}
                              onClick={() => void handleDownloadFile(file)}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/60 hover:bg-[#dfece6] border border-[#bfd5cc] dark:border-emerald-800 rounded-lg flex items-center gap-1 disabled:opacity-50"
                            >
                              {isDownloading ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                              <span>ডাউনলোড</span>
                            </button>

                            {!readOnly &&
                              (isConfirmingDel ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={isUploadingFile}
                                    onClick={() => void handleDeleteFile(file)}
                                    className="px-2 py-1 text-[11px] font-bold text-white bg-rose-600 rounded"
                                  >
                                    মুছুন
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteFileId(null)}
                                    className="px-2 py-1 text-[11px] text-stone-600 dark:text-slate-300 bg-stone-100 dark:bg-slate-800 rounded"
                                  >
                                    না
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteFileId(file.id)}
                                  title="ফাইল মুছুন"
                                  className="p-1.5 text-stone-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Class-by-Class Daily Topic Planner */}
              <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-stone-900 dark:text-white flex items-center gap-1.5">
                      <CalendarDays className="w-4 h-4 text-[#145343] dark:text-emerald-400" />
                      <span>ক্লাস অনুযায়ী প্রতিদিনের টপিক তালিকা ({activeRow.progress.topicCount})</span>
                    </h3>
                    <p className="text-[11px] text-stone-500 dark:text-slate-400 mt-0.5">
                      বছরের প্রতিটি ক্লাসে সেই দিন কী কী টপিক পড়ানো হবে তা এখানে সংরক্ষণ ও সম্পন্ন চিহ্নিত করুন।
                    </p>
                  </div>

                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setShowSlotGenerator(prev => !prev)}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/50 border border-[#bfd5cc] dark:border-emerald-800 rounded-lg flex items-center gap-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>রুটিন থেকে তারিখ তৈরি</span>
                    </button>
                  )}
                </div>

                {/* Auto-Generate Scheduled Dates Form */}
                {!readOnly && showSlotGenerator && (
                  <div className="p-3 rounded-lg bg-[#f7f5f0] dark:bg-slate-900 border border-stone-200 dark:border-slate-800 flex flex-wrap items-end gap-2.5">
                    <div>
                      <label className="block text-[10px] font-semibold text-stone-600 dark:text-slate-400 mb-1">
                        শুরুর তারিখ
                      </label>
                      <input
                        type="date"
                        value={genStartDate}
                        onChange={e => setGenStartDate(e.target.value)}
                        className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-stone-300 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-stone-600 dark:text-slate-400 mb-1">
                        নতুন ক্লাস স্লট সংখ্যা
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={genCount}
                        onChange={e => setGenCount(Math.max(1, Math.min(100, Number(e.target.value) || 10)))}
                        className="w-24 px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-800 border border-stone-300 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isSavingPlan}
                      onClick={() => void handleGenerateRoutineSlots()}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-[#145343] hover:bg-[#0f3f33] rounded-lg"
                    >
                      তারিখ তৈরি করুন
                    </button>
                  </div>
                )}

                {/* Add Single Topic Form */}
                {!readOnly && (
                  <form
                    onSubmit={e => void handleAddTopic(e)}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1"
                  >
                    <input
                      type="date"
                      aria-label="ক্লাসের তারিখ"
                      value={newTopicDate}
                      onChange={e => setNewTopicDate(e.target.value)}
                      className="sm:col-span-3 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white"
                    />
                    <input
                      type="text"
                      maxLength={300}
                      placeholder="সেই দিন কী টপিক পড়ানো হবে (যেমন: অধ্যায় ২ — ভগ্নাংশ)..."
                      value={newTopicText}
                      onChange={e => setNewTopicText(e.target.value)}
                      className="sm:col-span-5 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white"
                    />
                    <input
                      type="text"
                      maxLength={200}
                      placeholder="সংক্ষিপ্ত নোট (ঐচ্ছিক)"
                      value={newTopicNotes}
                      onChange={e => setNewTopicNotes(e.target.value)}
                      className="sm:col-span-2 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white"
                    />
                    <button
                      type="submit"
                      disabled={isSavingPlan}
                      className="sm:col-span-2 px-3 py-1.5 text-xs font-bold text-white bg-[#145343] hover:bg-[#0f3f33] dark:bg-emerald-700 rounded-lg flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>যোগ করুন</span>
                    </button>
                  </form>
                )}

                {/* Search & Filter Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="টপিক বা তারিখ খুঁজুন..."
                      value={topicSearch}
                      onChange={e => setTopicSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#f7f5f0] dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-lg text-stone-900 dark:text-white"
                    />
                  </div>
                  <div className="flex items-center gap-1 border border-stone-200 dark:border-slate-700 rounded-lg p-0.5 bg-[#f7f5f0] dark:bg-slate-900">
                    {(
                      [
                        { id: 'all', label: 'সবগুলো' },
                        { id: 'pending', label: 'বাকি' },
                        { id: 'completed', label: 'সম্পন্ন' },
                      ] as const
                    ).map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setTopicFilter(f.id)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                          topicFilter === f.id
                            ? 'bg-white dark:bg-slate-700 text-[#145343] dark:text-emerald-300 shadow-2xs'
                            : 'text-stone-600 dark:text-slate-400'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Topics Table */}
                {activeTopicsFiltered.length === 0 ? (
                  <div className="py-6 text-center text-xs text-stone-500 dark:text-slate-400 border border-dashed border-stone-200 dark:border-slate-800 rounded-lg">
                    {(activeRow.plan?.topics?.length || 0) === 0
                      ? 'এখনো কোনো ক্লাস-ভিত্তিক টপিক যোগ করা হয়নি।'
                      : 'খোঁজার শর্ত অনুযায়ী কোনো টপিক পাওয়া যায়নি।'}
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-stone-200 dark:border-slate-800 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-[#f7f5f0] dark:bg-slate-900 text-[11px] text-stone-600 dark:text-slate-300 border-b border-stone-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2 px-3 font-bold w-14">ক্লাস</th>
                          <th className="py-2 px-3 font-bold w-28">তারিখ</th>
                          <th className="py-2 px-3 font-bold">পাঠ্য টপিক ও নোট</th>
                          <th className="py-2 px-3 font-bold w-24 text-center">অবস্থা</th>
                          {!readOnly && <th className="py-2 px-3 font-bold w-20 text-right">কাজ</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 dark:divide-slate-800">
                        {activeTopicsFiltered.map(item => {
                          const isEditing = editingTopicId === item.id;
                          return (
                            <tr
                              key={item.id}
                              className="hover:bg-stone-50/80 dark:hover:bg-slate-800/40 transition-colors"
                            >
                              <td className="py-2.5 px-3 font-mono font-bold tabular-nums text-stone-700 dark:text-slate-300">
                                #{item.classNumber}
                              </td>
                              <td className="py-2.5 px-3 font-mono tabular-nums text-stone-600 dark:text-slate-400 whitespace-nowrap">
                                {isEditing ? (
                                  <input
                                    type="date"
                                    value={editTopicDate}
                                    onChange={e => setEditTopicDate(e.target.value)}
                                    className="px-1.5 py-1 text-[11px] bg-white dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded text-stone-900 dark:text-white"
                                  />
                                ) : (
                                  item.date || '—'
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                {isEditing ? (
                                  <div className="space-y-1">
                                    <input
                                      type="text"
                                      maxLength={300}
                                      value={editTopicText}
                                      onChange={e => setEditTopicText(e.target.value)}
                                      placeholder="টপিক লিখুন..."
                                      className="w-full px-2 py-1 text-xs bg-white dark:bg-slate-900 border border-[#145343] rounded text-stone-900 dark:text-white"
                                    />
                                    <input
                                      type="text"
                                      maxLength={200}
                                      value={editTopicNotes}
                                      onChange={e => setEditTopicNotes(e.target.value)}
                                      placeholder="নোট (ঐচ্ছিক)"
                                      className="w-full px-2 py-1 text-[11px] bg-white dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded text-stone-700 dark:text-slate-300"
                                    />
                                  </div>
                                ) : (
                                  <div>
                                    <div
                                      className={`font-semibold ${
                                        item.isCompleted
                                          ? 'text-stone-500 dark:text-slate-400 line-through'
                                          : 'text-stone-900 dark:text-white'
                                      }`}
                                    >
                                      {item.topic || (
                                        <span className="italic text-stone-400">
                                          টপিক নির্ধারিত হয়নি
                                        </span>
                                      )}
                                    </div>
                                    {item.notes && (
                                      <div className="text-[11px] text-stone-500 dark:text-slate-400 mt-0.5">
                                        {item.notes}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {readOnly ? (
                                  <span
                                    className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                                      item.isCompleted
                                        ? 'text-[#145343] dark:text-emerald-400'
                                        : 'text-amber-700 dark:text-amber-400'
                                    }`}
                                  >
                                    {item.isCompleted ? (
                                      <>
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>সম্পন্ন</span>
                                      </>
                                    ) : (
                                      <>
                                        <Circle className="w-3.5 h-3.5" />
                                        <span>বাকি</span>
                                      </>
                                    )}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isSavingPlan}
                                    onClick={() => void handleToggleTopicCompleted(item.id)}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                                      item.isCompleted
                                        ? 'bg-[#eef5f2] dark:bg-emerald-950/60 text-[#145343] dark:text-emerald-300'
                                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100'
                                    }`}
                                  >
                                    {item.isCompleted ? (
                                      <>
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>সম্পন্ন</span>
                                      </>
                                    ) : (
                                      <>
                                        <Circle className="w-3.5 h-3.5" />
                                        <span>বাকি</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </td>
                              {!readOnly && (
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  {isEditing ? (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => void handleSaveTopicEdit(item.id)}
                                        className="p-1 rounded bg-[#145343] text-white"
                                        title="সংরক্ষণ"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingTopicId(null)}
                                        className="p-1 rounded bg-stone-200 dark:bg-slate-700 text-stone-700 dark:text-slate-200"
                                        title="বাতিল"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingTopicId(item.id);
                                          setEditTopicDate(item.date || '');
                                          setEditTopicText(item.topic || '');
                                          setEditTopicNotes(item.notes || '');
                                        }}
                                        className="p-1 text-stone-400 hover:text-[#145343] dark:hover:text-emerald-400 rounded"
                                        title="এডিট"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteTopic(item.id)}
                                        className="p-1 text-stone-400 hover:text-rose-600 rounded"
                                        title="মুছুন"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  )}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
