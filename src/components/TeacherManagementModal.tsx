import React, { useState } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  ProxyLogEntry,
  SchoolClass,
  Subject,
  Teacher,
  TeacherClassAssignment,
  TimetableEntry,
} from '../types';
import { INITIAL_SETTINGS } from '../data/initialData';
import { BENGALI_DAY_NAMES } from '../services/scheduleTiers';
import { isAgricultureSubject, isHinduReligionSubject, isTeacherBlockedAtSlot } from '../services/parallelSubjects';
import {
  computeTeacherWorkload,
  DEFAULT_DAILY_MAX_PERIODS,
  DEFAULT_WEEKLY_MAX_PERIODS,
  getTeacherDailyMax,
  getTeacherWeeklyMax,
} from '../services/workloadService';
import {
  X,
  Plus,
  Trash2,
  Edit2,
  Users,
  Check,
  Shield,
  BookOpen,
  Layers,
  Search,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Ban,
} from 'lucide-react';

interface TeacherManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  teachers: Teacher[];
  subjects: Subject[];
  classes: SchoolClass[];
  entries?: TimetableEntry[];
  proxyLogs?: ProxyLogEntry[];
  workingDays?: DayOfWeek[];
  periodTimings?: PeriodTiming[];
  onUpdateTeachers: (updated: Teacher[]) => void;
  onUpdateClasses?: (updatedClasses: SchoolClass[]) => void;
  onDeleteTeacher?: (teacherId: string, removeAssignedEntries?: boolean) => void;
}

export const TeacherManagementModal: React.FC<TeacherManagementModalProps> = ({
  isOpen,
  onClose,
  teachers,
  subjects,
  classes,
  entries = [],
  proxyLogs = [],
  workingDays = INITIAL_SETTINGS.workingDays,
  periodTimings = INITIAL_SETTINGS.periodTimings,
  onUpdateTeachers,
  onUpdateClasses,
  onDeleteTeacher,
}) => {
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [isAddingNew, setIsAddingNew] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Delete confirmation modal state (100% in-app, zero window.confirm)
  const [teacherToDelete, setTeacherToDelete] = useState<Teacher | null>(null);
  const [deleteRemoveEntries, setDeleteRemoveEntries] = useState<boolean>(true);
  const [successNotice, setSuccessNotice] = useState<string>('');

  // Form states
  const [name, setName] = useState('');
  const [initials, setInitials] = useState('');
  const [designation, setDesignation] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [assignedClassSections, setAssignedClassSections] = useState<TeacherClassAssignment[]>([]);
  const [maxConsecutive, setMaxConsecutive] = useState<number>(2);
  const [maxDaily, setMaxDaily] = useState<number>(DEFAULT_DAILY_MAX_PERIODS);
  const [maxWeekly, setMaxWeekly] = useState<number>(DEFAULT_WEEKLY_MAX_PERIODS);
  const [isBlockTeacher, setIsBlockTeacher] = useState<boolean>(false);
  const [isCoordinator, setIsCoordinator] = useState<boolean>(false);
  const [noProxy, setNoProxy] = useState<boolean>(false);
  const [unavailablePeriods, setUnavailablePeriods] = useState<number[]>([]);
  const [unavailableSlots, setUnavailableSlots] = useState<{ day: DayOfWeek; periodIndex: number }[]>([]);

  // New assignment picker states
  const [assignmentClassId, setAssignmentClassId] = useState<string>(classes[0]?.id || '');
  const [assignmentSectionId, setAssignmentSectionId] = useState<string>('all');
  const [assignmentSubjectId, setAssignmentSubjectId] = useState<string>(subjects[0]?.id || '');

  const teachingPeriods = periodTimings.filter(p => !p.isBreak && !p.isLocked);

  if (!isOpen) return null;

  // Calculate routine count for any teacher
  const getAssignedCount = (teacherId: string) => {
    return entries.filter(e => e.teacherId === teacherId).length;
  };

  const startEdit = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setIsAddingNew(false);
    setName(teacher.name);
    setInitials(teacher.initials);
    setDesignation(teacher.designation);
    setEmail(teacher.email || '');
    setPhone(teacher.phone || '');
    const tSubs = teacher.subjectIds || [];
    setSelectedSubjectIds(tSubs);
    setAssignmentSubjectId(tSubs[0] || '');
    setAssignedClassSections(teacher.assignedClassSections || []);
    setMaxConsecutive(teacher.maxConsecutivePeriods || 2);
    setMaxDaily(getTeacherDailyMax(teacher));
    setMaxWeekly(getTeacherWeeklyMax(teacher));
    setIsBlockTeacher(Boolean(teacher.isBlockTeacher));
    setIsCoordinator(Boolean(teacher.isCoordinator));
    setNoProxy(Boolean(teacher.noProxy));
    setUnavailablePeriods(teacher.unavailablePeriods ? [...teacher.unavailablePeriods] : []);
    setUnavailableSlots(teacher.unavailableSlots ? teacher.unavailableSlots.map(s => ({ ...s })) : []);
  };

  const startAddNew = () => {
    setEditingTeacher(null);
    setIsAddingNew(true);
    setName('');
    setInitials('');
    setDesignation('Assistant Teacher');
    setEmail('');
    setPhone('');
    const defaultSub = subjects[0]?.id || '';
    setSelectedSubjectIds(defaultSub ? [defaultSub] : []);
    setAssignmentSubjectId(defaultSub);
    setAssignedClassSections([]);
    setMaxConsecutive(2);
    setMaxDaily(DEFAULT_DAILY_MAX_PERIODS);
    setMaxWeekly(DEFAULT_WEEKLY_MAX_PERIODS);
    setIsBlockTeacher(false);
    setIsCoordinator(false);
    setNoProxy(false);
    setUnavailablePeriods([]);
    setUnavailableSlots([]);
  };

  const handleToggleUnavailablePeriod = (periodIndex: number) => {
    setUnavailablePeriods(prev =>
      prev.includes(periodIndex)
        ? prev.filter(p => p !== periodIndex)
        : [...prev, periodIndex].sort((a, b) => a - b)
    );
  };

  const handleToggleUnavailableSlot = (day: DayOfWeek, periodIndex: number) => {
    setUnavailableSlots(prev => {
      const exists = prev.some(s => s.day === day && s.periodIndex === periodIndex);
      if (exists) {
        return prev.filter(s => !(s.day === day && s.periodIndex === periodIndex));
      }
      return [...prev, { day, periodIndex }];
    });
  };

  const handleToggleSubject = (subId: string) => {
    if (selectedSubjectIds.includes(subId)) {
      if (selectedSubjectIds.length > 1) {
        const next = selectedSubjectIds.filter(id => id !== subId);
        setSelectedSubjectIds(next);
        if (assignmentSubjectId === subId) {
          setAssignmentSubjectId(next[0] || '');
        }
      }
    } else {
      const next = [...selectedSubjectIds, subId];
      setSelectedSubjectIds(next);
      if (!assignmentSubjectId || !selectedSubjectIds.includes(assignmentSubjectId)) {
        setAssignmentSubjectId(subId);
      }
    }
  };

  const handleAddAssignment = () => {
    if (!assignmentClassId) return;
    const exists = assignedClassSections.some(
      a =>
        a.classId === assignmentClassId &&
        (a.sectionId || 'all') === assignmentSectionId &&
        (a.subjectId || '') === (assignmentSubjectId || '')
    );
    if (!exists) {
      setAssignedClassSections([
        ...assignedClassSections,
        {
          classId: assignmentClassId,
          sectionId: assignmentSectionId === 'all' ? undefined : assignmentSectionId,
          subjectId: assignmentSubjectId || undefined,
        },
      ]);
    }
  };

  const handleRemoveAssignment = (index: number) => {
    setAssignedClassSections(assignedClassSections.filter((_, i) => i !== index));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const initialsVal = initials.trim() || name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();

    let targetTeacher: Teacher;

    const effectiveNoProxy = noProxy || isBlockTeacher || isCoordinator;

    const sortedUnavailablePeriods = Array.from(new Set(unavailablePeriods)).sort((a, b) => a - b);

    if (isAddingNew) {
      const lowerNewName = name.trim().toLowerCase();
      const lowerNewDesig = (designation.trim() || '').toLowerCase();
      const isCombinedSpecialist =
        selectedSubjectIds.some(
          id => isHinduReligionSubject(id, subjects) || isAgricultureSubject(id, subjects)
        ) ||
        lowerNewName.includes('taposh') ||
        lowerNewName.includes('tapash') ||
        lowerNewName.includes('tapas') ||
        lowerNewName.includes('তাপস') ||
        lowerNewName.includes('moazzem') ||
        lowerNewName.includes('মোয়াজ্জেম') ||
        lowerNewName.includes('মোয়াজ্জেম') ||
        lowerNewDesig.includes('hindu') ||
        lowerNewDesig.includes('হিন্দু') ||
        lowerNewDesig.includes('agriculture') ||
        lowerNewDesig.includes('কৃষি');

      targetTeacher = {
        id: `tch-${Date.now().toString(36)}`,
        name: name.trim(),
        initials: initialsVal,
        designation: designation.trim() || 'Teacher',
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        subjectIds: selectedSubjectIds,
        assignedClassSections: assignedClassSections,
        maxConsecutivePeriods: maxConsecutive,
        maxDailyPeriods: Math.max(1, Math.min(10, Number(maxDaily) || (isCombinedSpecialist ? 5 : 4))),
        maxWeeklyPeriods: Math.max(1, Math.min(48, Number(maxWeekly) || DEFAULT_WEEKLY_MAX_PERIODS)),
        isBlockTeacher,
        isCoordinator,
        noProxy: effectiveNoProxy,
        unavailablePeriods: sortedUnavailablePeriods.length > 0 ? sortedUnavailablePeriods : undefined,
        unavailableSlots: unavailableSlots.length > 0 ? unavailableSlots : undefined,
      };
      onUpdateTeachers([...teachers, targetTeacher]);
      setSuccessNotice(`শিক্ষক "${targetTeacher.name}" সংরক্ষিত এবং নির্ধারিত ক্লাসে বিষয় স্বয়ংক্রিয়ভাবে যুক্ত করা হয়েছে!`);
    } else if (editingTeacher) {
      targetTeacher = {
        ...editingTeacher,
        name: name.trim(),
        initials: initialsVal,
        designation: designation.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        subjectIds: selectedSubjectIds,
        assignedClassSections: assignedClassSections,
        maxConsecutivePeriods: maxConsecutive,
        maxDailyPeriods: Math.max(1, Math.min(10, Number(maxDaily) || DEFAULT_DAILY_MAX_PERIODS)),
        maxWeeklyPeriods: Math.max(1, Math.min(48, Number(maxWeekly) || DEFAULT_WEEKLY_MAX_PERIODS)),
        isBlockTeacher,
        isCoordinator,
        noProxy: effectiveNoProxy,
        unavailablePeriods: sortedUnavailablePeriods.length > 0 ? sortedUnavailablePeriods : undefined,
        unavailableSlots: unavailableSlots.length > 0 ? unavailableSlots : undefined,
      };
      const updated = teachers.map(t => (t.id === editingTeacher.id ? targetTeacher : t));
      onUpdateTeachers(updated);
      setSuccessNotice(`শিক্ষক "${name.trim()}" এর তথ্য আপডেট ও বিষয় ব্যবস্থাপনায় সিঙ্ক করা হয়েছে!`);
    } else {
      return;
    }

    setEditingTeacher(null);
    setIsAddingNew(false);

    setTimeout(() => {
      setSuccessNotice('');
    }, 4000);
  };

  // Trigger delete confirmation modal
  const promptDelete = (teacher: Teacher) => {
    setTeacherToDelete(teacher);
    setDeleteRemoveEntries(true);
  };

  // Perform delete safely without any blocking native dialog
  const executeDelete = () => {
    if (!teacherToDelete) return;
    const targetId = teacherToDelete.id;
    const targetName = teacherToDelete.name;

    if (onDeleteTeacher) {
      onDeleteTeacher(targetId, deleteRemoveEntries);
    } else {
      onUpdateTeachers(teachers.filter(t => t.id !== targetId));
    }

    if (editingTeacher?.id === targetId) {
      setEditingTeacher(null);
      setIsAddingNew(false);
    }

    setTeacherToDelete(null);
    setSuccessNotice(`শিক্ষক "${targetName}" সফলভাবে মুছে ফেলা হয়েছে!`);

    setTimeout(() => {
      setSuccessNotice('');
    }, 4000);
  };

  const subjectMap = new Map(subjects.map(s => [s.id, s]));

  const filteredTeachers = teachers.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.initials.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 relative">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Faculty & Teacher Management (শিক্ষক ব্যবস্থাপনা)
              </h2>
              <p className="text-xs text-slate-500">
                নতুন শিক্ষক যুক্ত করুন, তথ্য এডিট করুন অথবা শিক্ষক ও তাঁর রুটিন ডিলিট করুন।
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Alert Banner */}
        {successNotice && (
          <div className="mx-6 mt-3 p-2.5 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-200 font-semibold flex items-center justify-between animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successNotice}</span>
            </div>
            <button
              onClick={() => setSuccessNotice('')}
              className="p-0.5 text-emerald-600 hover:text-emerald-900 dark:hover:text-emerald-100 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Teacher List on Left */}
          <div className="w-full md:w-84 border-r border-slate-200 dark:border-slate-800 p-3 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/40 shrink-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                শিক্ষক তালিকা ({filteredTeachers.length}/{teachers.length})
              </span>
              <button
                onClick={startAddNew}
                className="px-2.5 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md flex items-center gap-1 shadow-2xs"
              >
                <Plus className="w-3 h-3" />
                <span>+ নতুন শিক্ষক</span>
              </button>
            </div>

            {/* Quick Search */}
            <div className="relative mb-2.5">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="শিক্ষক বা কোড খুঁজুন..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Teacher Cards */}
            <div className="space-y-1.5 flex-1 overflow-y-auto pr-0.5">
              {filteredTeachers.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  কোনো শিক্ষক পাওয়া যায়নি।
                </div>
              ) : (
                filteredTeachers.map(t => {
                  const isSelected = editingTeacher?.id === t.id;
                  const wl = computeTeacherWorkload(t, entries, proxyLogs, { workingDays });

                  return (
                    <div
                      key={t.id}
                      onClick={() => startEdit(t)}
                      className={`p-2.5 rounded-xl border cursor-pointer transition-all group relative ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 shadow-xs'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-xs text-slate-900 dark:text-white truncate">
                            {t.name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {t.designation}
                          </div>
                        </div>

                        {/* Badges & Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded font-bold">
                            {t.initials}
                          </span>

                          {/* Quick Delete Button directly on card */}
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              promptDelete(t);
                            }}
                            title={`"${t.name}" কে মুছে ফেলুন (Delete)`}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded-md transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Bottom line: subjects + role badges + routine workload badge */}
                      <div className="flex items-center justify-between gap-1 mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/60 text-[10px]">
                        <div className="flex items-center gap-1 flex-wrap text-slate-500">
                          {t.isBlockTeacher && (
                            <span className="px-1.5 py-0.2 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded font-semibold">
                              ব্লক
                            </span>
                          )}
                          {t.isCoordinator && (
                            <span className="px-1.5 py-0.2 bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 rounded font-semibold">
                              কো-অর্ডিনেটর
                            </span>
                          )}
                          {t.noProxy && !t.isBlockTeacher && !t.isCoordinator && (
                            <span className="px-1.5 py-0.2 bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 rounded font-semibold">
                              প্রক্সি মুক্ত
                            </span>
                          )}
                          {t.subjectIds.slice(0, 2).map(sId => (
                            <span
                              key={sId}
                              className="px-1 py-0.2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded"
                            >
                              {subjectMap.get(sId)?.code || sId}
                            </span>
                          ))}
                          {t.subjectIds.length > 2 && (
                            <span className="text-slate-400">+{t.subjectIds.length - 2}</span>
                          )}
                          {((t.unavailablePeriods?.length || 0) > 0 || (t.unavailableSlots?.length || 0) > 0) && (
                            <span
                              className="px-1.5 py-0.2 bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 rounded font-semibold"
                              title="এই শিক্ষকের কিছু পিরিয়ড/সময় বন্ধ নির্ধারিত রয়েছে"
                            >
                              বন্ধ:{' '}
                              {(t.unavailablePeriods?.length || 0) > 0
                                ? t.unavailablePeriods!.map(p => `P${p}`).join(',')
                                : `${t.unavailableSlots!.length} স্লট`}
                            </span>
                          )}
                        </div>

                        <span
                          title={`নিয়মিত: ${wl.regularWeeklyPeriods} + প্রক্সি: ${wl.proxyWeeklyPeriods} / সাপ্তাহিক লিমিট: ${wl.weeklyMax}`}
                          className={`font-mono font-semibold px-1.5 py-0.2 rounded shrink-0 tabular-nums ${
                            wl.status === 'Overloaded'
                              ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300'
                              : wl.status === 'Near Limit'
                              ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                              : wl.totalWeeklyLoad > 0
                              ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                          }`}
                        >
                          {wl.totalWeeklyLoad}/{wl.weeklyMax}
                          {wl.proxyWeeklyPeriods > 0 ? ` (+${wl.proxyWeeklyPeriods}P)` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Form / Profile Editor */}
          <div className="flex-1 p-6 overflow-y-auto">
            {editingTeacher || isAddingNew ? (
              <form onSubmit={handleSave} className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {isAddingNew ? 'নতুন শিক্ষক প্রোফাইল তৈরি' : `শিক্ষক সম্পাদনা: ${editingTeacher?.name}`}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      শিক্ষকের নাম, বিষয় ও ক্লাস সংক্রান্ত তথ্য পরিবর্তন করুন।
                    </p>
                  </div>

                  {!isAddingNew && editingTeacher && (
                    <button
                      type="button"
                      onClick={() => promptDelete(editingTeacher)}
                      className="px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 rounded-lg transition-colors flex items-center gap-1.5 border border-rose-200 dark:border-rose-900 shadow-2xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>শিক্ষক ডিলিট করুন (Delete)</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                      Full Name (পূর্ণ নাম) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Mr. A. Rahman"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                      Initials / Routine Code (সংক্ষিপ্ত নাম)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. AR"
                      value={initials}
                      onChange={e => setInitials(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 uppercase font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                      Designation (পদবী)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Senior Teacher (Mathematics)"
                      value={designation}
                      onChange={e => setDesignation(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                      Max Consecutive Classes (একটানা সর্বোচ্চ)
                    </label>
                    <select
                      value={maxConsecutive}
                      onChange={e => setMaxConsecutive(Number(e.target.value))}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-semibold"
                    >
                      <option value={1}>1 period max</option>
                      <option value={2}>2 periods max (Recommended standard)</option>
                      <option value={3}>3 periods max</option>
                      <option value={4}>4 periods max</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                      Weekly Max Periods (সাপ্তাহিক সর্বোচ্চ ক্লাস লিমিট)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={48}
                        value={maxWeekly}
                        onChange={e => setMaxWeekly(Math.max(1, Math.min(48, Number(e.target.value) || 24)))}
                        className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      />
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">ডিফল্ট ২৪</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                      Daily Max Periods (দৈনিক সর্বোচ্চ ক্লাস)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={maxDaily}
                        onChange={e => setMaxDaily(Math.max(1, Math.min(10, Number(e.target.value) || 5)))}
                        className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      />
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">ডিফল্ট ৫</span>
                    </div>
                  </div>
                </div>

                {/* Institutional Role & Proxy Policy Checkboxes */}
                <div className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-indigo-600" />
                    <span>বিশেষ দায়িত্ব ও প্রক্সি নীতি (Role & Proxy Exemption)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="flex items-start gap-2 p-2 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={isBlockTeacher}
                        onChange={e => {
                          const checked = e.target.checked;
                          setIsBlockTeacher(checked);
                          if (checked) setNoProxy(true);
                        }}
                        className="mt-0.5 rounded text-indigo-600"
                      />
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-100">ব্লক টিচার (Play/Nursery)</div>
                        <div className="text-[10px] text-slate-500">অন্য কোনো ক্লাস ও প্রক্সিতে নিষিদ্ধ</div>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 p-2 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={isCoordinator}
                        onChange={e => {
                          const checked = e.target.checked;
                          setIsCoordinator(checked);
                          if (checked) setNoProxy(true);
                        }}
                        className="mt-0.5 rounded text-purple-600"
                      />
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-100">কো-অর্ডিনেটর (Coordinator)</div>
                        <div className="text-[10px] text-slate-500">প্রক্সি ক্লাস দেওয়া যাবে না</div>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 p-2 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={noProxy || isBlockTeacher || isCoordinator}
                        onChange={e => setNoProxy(e.target.checked)}
                        disabled={isBlockTeacher || isCoordinator}
                        className="mt-0.5 rounded text-amber-600"
                      />
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-100">প্রক্সি মুক্ত (No Proxy)</div>
                        <div className="text-[10px] text-slate-500">প্রক্সি শিডিউলে আসবেন না</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Multiple Qualified Subjects Assignment */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
                    পড়ানোর যোগ্য বিষয়সমূহ (Subjects Qualified to Teach)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {subjects.map(sub => {
                      const isChecked = selectedSubjectIds.includes(sub.id);
                      return (
                        <div
                          key={sub.id}
                          onClick={() => handleToggleSubject(sub.id)}
                          className={`p-2 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                            isChecked
                              ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 font-semibold'
                              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: sub.color }}
                            />
                            <span className="truncate">{sub.name}</span>
                          </div>
                          {isChecked && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Class, Section & Subject Teaching Allocation */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      শ্রেণি ও সেকশন নির্ধারণ (Assigned Classes & Sections)
                    </label>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      এই শিক্ষক কোন কোন শ্রেণিতে ও সেকশনে কোন বিষয় পড়াবেন তা যুক্ত করুন:
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1.5 bg-[#eef5f2] dark:bg-emerald-950/40 border border-[#bfd5cc] dark:border-emerald-800/80 rounded-lg text-[11px] text-[#145343] dark:text-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#145343] dark:text-emerald-400 shrink-0" />
                      <span>
                        <strong>অটো-অ্যাড সিঙ্ক:</strong> এখানে ক্লাস ও বিষয় যুক্ত করলেই তা স্বয়ংক্রিয়ভাবে <strong>বিষয় ব্যবস্থাপনা (Subject Management)</strong>-এ ওই ক্লাসের রুটিন রিকোয়ারমেন্ট ও এই শিক্ষকের নামে যুক্ত হয়ে যাবে।
                      </span>
                    </div>
                  </div>

                  {/* Add Class Assignment Row */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                          শ্রেণি (Class)
                        </label>
                        <select
                          value={assignmentClassId}
                          onChange={e => {
                            setAssignmentClassId(e.target.value);
                            setAssignmentSectionId('all');
                          }}
                          className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-semibold"
                        >
                          {classes.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                          সেকশন (Section)
                        </label>
                        <select
                          value={assignmentSectionId}
                          onChange={e => setAssignmentSectionId(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-semibold"
                        >
                          <option value="all">সব সেকশন (All Sections)</option>
                          {classes
                            .find(c => c.id === assignmentClassId)
                            ?.sections.map(sec => (
                              <option key={sec.id} value={sec.id}>
                                {sec.name}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                          বিষয় (Subject)
                        </label>
                        <select
                          value={assignmentSubjectId}
                          onChange={e => setAssignmentSubjectId(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-semibold"
                        >
                          <option value="">সকল বিষয় / স্পেসিফিক নয়</option>
                          {subjects
                            .filter(s => selectedSubjectIds.includes(s.id) || selectedSubjectIds.length === 0)
                            .map(s => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.code})
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddAssignment}
                      className="w-full sm:w-auto px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ এই ক্লাসে যুক্ত করুন</span>
                    </button>
                  </div>

                  {/* List of assigned classes */}
                  <div className="space-y-1.5">
                    {assignedClassSections.length === 0 ? (
                      <div className="p-3 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-400">
                        এখনো নির্দিষ্ট কোনো শ্রেণি নির্ধারিত করা হয়নি (সব শ্রেণিতে সাধারণ প্রযোজ্য)।
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {assignedClassSections.map((assignment, aIdx) => {
                          const cls = classes.find(c => c.id === assignment.classId);
                          const sec = cls?.sections.find(s => s.id === assignment.sectionId);
                          const sub = subjects.find(s => s.id === assignment.subjectId);
                          return (
                            <div
                              key={aIdx}
                              className="px-2.5 py-1 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded-lg text-xs flex items-center gap-1.5 text-blue-900 dark:text-blue-200"
                            >
                              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                              <span className="font-bold">{cls?.name || assignment.classId}</span>
                              {sec ? (
                                <span className="text-[11px] text-blue-700 dark:text-blue-300">({sec.name})</span>
                              ) : (
                                <span className="text-[10px] text-blue-500 font-medium">(সব সেকশন)</span>
                              )}
                              {sub && (
                                <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                                  : {sub.name}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveAssignment(aIdx)}
                                className="p-0.5 hover:text-rose-600 rounded ml-1"
                                title="মুছে ফেলুন"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Teacher Blocked / Unavailable Periods Matrix */}
                {(() => {
                  const conflictingExistingCount = editingTeacher
                    ? entries.filter(
                        e =>
                          e.teacherId === editingTeacher.id &&
                          isTeacherBlockedAtSlot(
                            { unavailablePeriods, unavailableSlots },
                            e.day,
                            e.periodIndex
                          )
                      ).length
                    : 0;
                  const hasAnyBlock = unavailablePeriods.length > 0 || unavailableSlots.length > 0;

                  return (
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                            <Ban className="w-3.5 h-3.5 text-rose-600" />
                            <span>অবসর / বন্ধ পিরিয়ড নির্ধারণ (Blocked / Off Periods)</span>
                          </label>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            রুটিন তৈরির সময় এই শিক্ষকের যে পিরিয়ডে বা দিন-সময়ে কোনো ক্লাস রাখা যাবে না তা সিলেক্ট করুন।
                          </p>
                        </div>
                        {hasAnyBlock && (
                          <button
                            type="button"
                            onClick={() => {
                              setUnavailablePeriods([]);
                              setUnavailableSlots([]);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md shrink-0"
                          >
                            সব উন্মুক্ত করুন (Clear All)
                          </button>
                        )}
                      </div>

                      {/* All-Days Period-Wide Toggle Bar */}
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mr-1">
                          সকল দিনে নির্দিষ্ট পিরিয়ড বন্ধ:
                        </span>
                        {teachingPeriods.map(tp => {
                          const isPeriodBlocked = unavailablePeriods.includes(tp.periodIndex);
                          return (
                            <button
                              key={tp.periodIndex}
                              type="button"
                              onClick={() => handleToggleUnavailablePeriod(tp.periodIndex)}
                              title={`${tp.label} (${tp.startTime} - ${tp.endTime}) সব দিনে ${
                                isPeriodBlocked ? 'উন্মুক্ত করুন' : 'বন্ধ রাখুন'
                              }`}
                              className={`px-2 py-1 text-[11px] font-mono font-bold rounded border transition-colors ${
                                isPeriodBlocked
                                  ? 'bg-rose-600 text-white border-rose-600'
                                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:border-rose-400'
                              }`}
                            >
                              P{tp.periodIndex} {isPeriodBlocked ? 'বন্ধ' : ''}
                            </button>
                          );
                        })}
                      </div>

                      {/* Day x Period Matrix */}
                      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                        <table className="w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                              <th className="py-1.5 px-2.5 text-left font-semibold">দিন / পিরিয়ড</th>
                              {teachingPeriods.map(tp => (
                                <th
                                  key={tp.periodIndex}
                                  className="py-1.5 px-1.5 text-center font-mono font-bold"
                                  title={`${tp.label} (${tp.startTime} - ${tp.endTime})`}
                                >
                                  P{tp.periodIndex}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {workingDays.map(day => (
                              <tr key={day}>
                                <td className="py-1.5 px-2.5 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                                  {BENGALI_DAY_NAMES[day] || day}
                                </td>
                                {teachingPeriods.map(tp => {
                                  const isWideBlocked = unavailablePeriods.includes(tp.periodIndex);
                                  const isCellBlocked = unavailableSlots.some(
                                    s => s.day === day && s.periodIndex === tp.periodIndex
                                  );
                                  const isBlocked = isWideBlocked || isCellBlocked;
                                  return (
                                    <td key={tp.periodIndex} className="p-1 text-center">
                                      <button
                                        type="button"
                                        disabled={isWideBlocked}
                                        onClick={() => handleToggleUnavailableSlot(day, tp.periodIndex)}
                                        title={
                                          isWideBlocked
                                            ? `Period ${tp.periodIndex} উপরের বাটন থেকে সকল দিনে বন্ধ রয়েছে`
                                            : isCellBlocked
                                            ? `${BENGALI_DAY_NAMES[day]} P${tp.periodIndex} উন্মুক্ত করুন`
                                            : `${BENGALI_DAY_NAMES[day]} P${tp.periodIndex} বন্ধ রাখুন`
                                        }
                                        className={`w-full py-1 px-1 rounded text-[10px] font-semibold border transition-colors ${
                                          isWideBlocked
                                            ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 cursor-not-allowed opacity-85'
                                            : isCellBlocked
                                            ? 'bg-rose-600 text-white border-rose-600'
                                            : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-rose-400 hover:text-rose-600'
                                        }`}
                                      >
                                        {isWideBlocked ? 'সব দিন' : isCellBlocked ? 'বন্ধ' : '—'}
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {conflictingExistingCount > 0 && (
                        <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <span>
                            বর্তমান রুটিনে এই শিক্ষকের <strong>{conflictingExistingCount}টি</strong> ক্লাস উক্ত বন্ধ পিরিয়ডে রয়েছে। সংরক্ষণের পর রুটিন অটো-জেনারেট বা <strong>Auto Fix</strong> চালালে সেগুলো স্বয়ংক্রিয়ভাবে অন্য সময়ে সরিয়ে নেওয়া হবে।
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    {!isAddingNew && editingTeacher && (
                      <button
                        type="button"
                        onClick={() => promptDelete(editingTeacher)}
                        className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>শিক্ষক মুছে ফেলুন</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTeacher(null);
                        setIsAddingNew(false);
                      }}
                      className="px-3.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg font-medium"
                    >
                      বাতিল (Cancel)
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-xs"
                    >
                      {isAddingNew ? 'শিক্ষক সংরক্ষণ করুন' : 'আপডেট সংরক্ষণ করুন'}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <div className="py-16 text-center text-slate-500">
                <Users className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  বাম পাশ থেকে যেকোনো শিক্ষক সিলেক্ট করুন
                </div>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  শিক্ষকের তথ্য পরিবর্তন করতে কার্ডে ক্লিক করুন অথবা ডিলিট করতে কার্ডের লাল ট্র্যাশ (🗑️) আইকনে ক্লিক করুন।
                </p>
                <button
                  onClick={startAddNew}
                  className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>নতুন শিক্ষক যোগ করুন</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            মোট শিক্ষক: <strong>{teachers.length} জন</strong>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-xs"
          >
            সম্পন্ন (Done)
          </button>
        </div>

        {/* Custom In-App Delete Confirmation Modal (Zero window.confirm blocking!) */}
        {teacherToDelete && (
          <div className="absolute inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-100">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-300 dark:border-rose-900 shadow-2xl max-w-md w-full p-5 space-y-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-start gap-3">
                <div className="p-3 bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400 rounded-xl shrink-0">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    শিক্ষকের প্রোফাইল মুছে ফেলতে চান?
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Confirm deleting teacher profile from institutional roster.
                  </p>
                </div>
              </div>

              {/* Teacher Summary Details */}
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">শিক্ষকের নাম:</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {teacherToDelete.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">পদবী ও কোড:</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {teacherToDelete.designation} ({teacherToDelete.initials})
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1.5 mt-1.5">
                  <span className="text-slate-500">রুটিনে নির্ধারিত ক্লাস:</span>
                  <span className={`font-bold ${getAssignedCount(teacherToDelete.id) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
                    {getAssignedCount(teacherToDelete.id)} টি পিরিয়ড
                  </span>
                </div>
              </div>

              {/* Routine Cleanup Option */}
              {getAssignedCount(teacherToDelete.id) > 0 && (
                <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer bg-amber-50 dark:bg-amber-950/40 p-3 rounded-xl border border-amber-200 dark:border-amber-900/60">
                  <input
                    type="checkbox"
                    checked={deleteRemoveEntries}
                    onChange={e => setDeleteRemoveEntries(e.target.checked)}
                    className="mt-0.5 rounded text-rose-600 focus:ring-rose-500"
                  />
                  <div>
                    <span className="font-semibold text-amber-900 dark:text-amber-200">
                      রুটিনের সকল ক্লাসও মুছে ফেলুন
                    </span>
                    <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                      এই শিক্ষকের শিডিউলে থাকা {getAssignedCount(teacherToDelete.id)}টি ক্লাস রুটিন থেকে স্বয়ংক্রিয়ভাবে সরিয়ে দেওয়া হবে।
                    </p>
                  </div>
                </label>
              )}

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setTeacherToDelete(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  বাতিল (Cancel)
                </button>
                <button
                  type="button"
                  onClick={executeDelete}
                  className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>হ্যাঁ, নিশ্চিত ডিলিট করুন</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
