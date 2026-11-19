import React, { useState } from 'react';
import { SchoolClass, Subject, Teacher, TimetableEntry } from '../types';
import {
  X,
  Plus,
  Trash2,
  Edit2,
  Check,
  BookOpen,
  Sparkles,
  Layers,
  Palette,
  Search,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { syncTeacherAssignmentsToClasses, syncClassesToTeachers } from '../services/teacherSubjectSync';
import { getEffectiveSectionRequirements, isPlayOrNursery, isTeacherBlockTeacher } from '../services/parallelSubjects';

interface SubjectManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: SchoolClass[];
  subjects: Subject[];
  teachers: Teacher[];
  entries?: TimetableEntry[];
  initialClassId?: string;
  onUpdateSubjects: (updatedSubjects: Subject[]) => void;
  onUpdateClasses: (updatedClasses: SchoolClass[]) => void;
  onUpdateTeachers?: (updatedTeachers: Teacher[]) => void;
  onUpdateSectionSubjectConfig?: (
    classId: string,
    sectionId: string,
    subjectId: string,
    patch: { periodsPerWeek?: number; assignedTeacherId?: string }
  ) => void;
  onDeleteGlobalSubject?: (subjectId: string) => void;
  onRemoveSubjectFromClass?: (classId: string, subjectId: string) => void;
}

const PRESET_COLORS = [
  '#3B82F6', // Blue
  '#6366F1', // Indigo
  '#10B981', // Emerald
  '#06B6D4', // Cyan
  '#F59E0B', // Amber
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#84CC16', // Lime
  '#059669', // Dark Green
  '#64748B', // Slate
  '#A855F7', // Violet
  '#EF4444', // Red
  '#D97706', // Ochre
];

export const SubjectManagementModal: React.FC<SubjectManagementModalProps> = ({
  isOpen,
  onClose,
  classes,
  subjects,
  teachers,
  entries = [],
  initialClassId,
  onUpdateSubjects,
  onUpdateClasses,
  onUpdateTeachers,
  onUpdateSectionSubjectConfig,
  onDeleteGlobalSubject,
  onRemoveSubjectFromClass,
}) => {
  const [activeTab, setActiveTab] = useState<'class_subjects' | 'all_subjects'>('class_subjects');
  const [selectedClassId, setSelectedClassId] = useState<string>(
    initialClassId || classes[0]?.id || ''
  );
  const activeClass = classes.find(c => c.id === selectedClassId) || classes[0];
  const [selectedSectionScopeId, setSelectedSectionScopeId] = useState<string>('__class__');

  // Search in all subjects
  const [searchQuery, setSearchQuery] = useState('');
  const [syncNotice, setSyncNotice] = useState<string>('');
  const [deleteNotice, setDeleteNotice] = useState<string>('');

  // Delete Global Subject Modal State
  const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null);

  // New subject state
  const [isAddingGlobal, setIsAddingGlobal] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [newSubCode, setNewSubCode] = useState('');
  const [newSubColor, setNewSubColor] = useState('#3B82F6');

  // Add subject to active class state
  const [addSubjectIdToClass, setAddSubjectIdToClass] = useState<string>('');
  const [addSubjectPeriods, setAddSubjectPeriods] = useState<number>(5);
  const [addSubjectTeacherId, setAddSubjectTeacherId] = useState<string>('');

  if (!isOpen) return null;

  // 0. Auto-Sync from Teachers functionality
  const handleSyncFromTeachers = () => {
    const syncedClasses = syncTeacherAssignmentsToClasses(classes, teachers, subjects);
    onUpdateClasses(syncedClasses);
    setSyncNotice('✓ শিক্ষক ব্যবস্থাপনা থেকে সকল শিক্ষকের নির্ধারিত ক্লাস ও বিষয়সমূহ এখানে স্বয়ংক্রিয়ভাবে সিঙ্ক করা হয়েছে!');
    setTimeout(() => setSyncNotice(''), 4500);
  };

  // 1. Add or Edit Brand New Global Subject
  const handleSaveGlobalSubject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim()) return;

    const code =
      newSubCode.trim().toUpperCase() ||
      newSubName
        .split(' ')
        .map(w => w[0])
        .join('')
        .slice(0, 3)
        .toUpperCase();

    if (editingSubject) {
      const updated = subjects.map(s => {
        if (s.id === editingSubject.id) {
          return {
            ...s,
            name: newSubName.trim(),
            code,
            color: newSubColor,
          };
        }
        return s;
      });
      onUpdateSubjects(updated);
      setDeleteNotice(`বিষয় "${newSubName.trim()}" এর তথ্য সফলভাবে আপডেট করা হয়েছে!`);
      setEditingSubject(null);
    } else {
      const newSub: Subject = {
        id: `sub-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
        name: newSubName.trim(),
        code,
        color: newSubColor,
      };
      onUpdateSubjects([...subjects, newSub]);
      setDeleteNotice(`নতুন বিষয় "${newSub.name}" সফলভাবে যুক্ত করা হয়েছে!`);
      setIsAddingGlobal(false);
    }

    setNewSubName('');
    setNewSubCode('');
    setNewSubColor('#3B82F6');
    setTimeout(() => setDeleteNotice(''), 4000);
  };

  // 2. Execute Delete Global Subject (Complete removal from database)
  const executeDeleteGlobalSubject = () => {
    if (!subjectToDelete) return;
    const targetId = subjectToDelete.id;
    const targetName = subjectToDelete.name;

    if (onDeleteGlobalSubject) {
      onDeleteGlobalSubject(targetId);
    } else {
      onUpdateSubjects(subjects.filter(s => s.id !== targetId));
      const updatedClasses = classes.map(c => ({
        ...c,
        subjectRequirements: c.subjectRequirements.filter(r => r.subjectId !== targetId),
        sections: c.sections.map(s =>
          s.selectedSubjectIds
            ? { ...s, selectedSubjectIds: s.selectedSubjectIds.filter(id => id !== targetId) }
            : s
        ),
      }));
      onUpdateClasses(updatedClasses);
    }

    setSubjectToDelete(null);
    setDeleteNotice(`বিষয় "${targetName}" সফলভাবে ডাটাবেস থেকে মুছে ফেলা হয়েছে!`);
    setTimeout(() => setDeleteNotice(''), 4500);
  };

  // 3. Add Subject to Active Class
  const handleAddSubjectToClass = () => {
    if (!addSubjectIdToClass) return;

    const existingIdx = activeClass.subjectRequirements.findIndex(
      r => r.subjectId === addSubjectIdToClass
    );
    let newReqs = [...activeClass.subjectRequirements];

    if (existingIdx >= 0) {
      newReqs[existingIdx] = {
        subjectId: addSubjectIdToClass,
        periodsPerWeek: addSubjectPeriods,
        assignedTeacherId: addSubjectTeacherId || undefined,
      };
    } else {
      newReqs.push({
        subjectId: addSubjectIdToClass,
        periodsPerWeek: addSubjectPeriods,
        assignedTeacherId: addSubjectTeacherId || undefined,
      });
    }

    const updatedClasses = classes.map(c => {
      if (c.id === activeClass.id) {
        return { ...c, subjectRequirements: newReqs };
      }
      return c;
    });

    onUpdateClasses(updatedClasses);
    if (onUpdateTeachers && addSubjectTeacherId) {
      const syncedTeachers = syncClassesToTeachers(updatedClasses, teachers);
      onUpdateTeachers(syncedTeachers);
    }

    const addedSub = subjects.find(s => s.id === addSubjectIdToClass);
    setDeleteNotice(`বিষয় "${addedSub?.name || ''}" সফলভাবে ${activeClass.name} শ্রেণিতে যুক্ত করা হয়েছে!`);
    setTimeout(() => setDeleteNotice(''), 4000);

    setAddSubjectIdToClass('');
    setAddSubjectTeacherId('');
  };

  // 4. Update Periods or Teacher for Class Subject
  const handleUpdateClassRequirement = (
    subjectId: string,
    periodsPerWeek: number,
    assignedTeacherId?: string
  ) => {
    const updatedClasses = classes.map(c => {
      if (c.id === activeClass.id) {
        let newReqs = [...c.subjectRequirements];
        const idx = newReqs.findIndex(r => r.subjectId === subjectId);
        if (idx >= 0) {
          if (periodsPerWeek <= 0) {
            newReqs.splice(idx, 1);
          } else {
            newReqs[idx] = {
              subjectId,
              periodsPerWeek,
              assignedTeacherId: assignedTeacherId || undefined,
            };
          }
        }
        return { ...c, subjectRequirements: newReqs };
      }
      return c;
    });
    onUpdateClasses(updatedClasses);
    if (onUpdateTeachers) {
      const syncedTeachers = syncClassesToTeachers(updatedClasses, teachers);
      onUpdateTeachers(syncedTeachers);
    }
  };

  // 5. Remove Subject from Active Class (Class-wise removal)
  const handleRemoveSubjectFromClass = (subjectId: string) => {
    const subObj = subjects.find(s => s.id === subjectId);

    if (onRemoveSubjectFromClass) {
      onRemoveSubjectFromClass(activeClass.id, subjectId);
    } else {
      const updatedClasses = classes.map(c => {
        if (c.id === activeClass.id) {
          return {
            ...c,
            subjectRequirements: c.subjectRequirements.filter(r => r.subjectId !== subjectId),
            sections: c.sections.map(s =>
              s.selectedSubjectIds
                ? { ...s, selectedSubjectIds: s.selectedSubjectIds.filter(id => id !== subjectId) }
                : s
            ),
          };
        }
        return c;
      });
      onUpdateClasses(updatedClasses);
    }

    setDeleteNotice(`বিষয় "${subObj?.name || subjectId}" সফলভাবে ${activeClass.name} শ্রেণি থেকে অপসারণ করা হয়েছে!`);
    setTimeout(() => setDeleteNotice(''), 4500);
  };

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  const isPlayNur = activeClass ? isPlayOrNursery(activeClass) : false;

  // Active class assigned subjects vs unassigned available subjects
  const assignedSubjectIds = new Set(activeClass?.subjectRequirements.map(r => r.subjectId));
  const availableSubjectsForClass = subjects.filter(
    s => !assignedSubjectIds.has(s.id) && s.id !== 'sub-block-play-nur'
  );

  // Filtered subjects list for search
  const filteredSubjects = subjects.filter(
    s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Helper to count how many timetable entries exist for a subject
  const getSubjectRoutineCount = (subjectId: string) => {
    return entries.filter(e => e.subjectId === subjectId).length;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 relative">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Subject Management & Class Allocation (বিষয় ব্যবস্থাপনা)
              </h2>
              <p className="text-xs text-slate-500">
                নতুন বিষয় তৈরি করুন, ক্লাসভিত্তিক বিষয় ও শিক্ষক নির্ধারণ করুন অথবা বিষয় ডিলিট করুন।
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab switch */}
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
              <button
                onClick={() => setActiveTab('class_subjects')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                  activeTab === 'class_subjects'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Class-wise Subjects
              </button>
              <button
                onClick={() => setActiveTab('all_subjects')}
                className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                  activeTab === 'all_subjects'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                All Subjects ({subjects.length})
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Action / Delete Feedback Banner */}
        {deleteNotice && (
          <div className="mx-6 mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-200 font-semibold flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{deleteNotice}</span>
            </div>
            <button
              onClick={() => setDeleteNotice('')}
              className="p-0.5 text-emerald-600 hover:text-emerald-900 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Tab 1: Class-Wise Subjects */}
        {activeTab === 'class_subjects' && (
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* Left: Class Selector (Play, Nursery, KG, Class 1-10) */}
            <div className="w-full md:w-56 border-r border-slate-200 dark:border-slate-800 p-3 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/40 shrink-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-2">
                শ্রেণি নির্বাচন করুন
              </div>
              <div className="space-y-1">
                {classes.map(c => {
                  const isSelected = c.id === activeClass.id;
                  const totalPeriods = c.subjectRequirements.reduce(
                    (acc, r) => acc + r.periodsPerWeek,
                    0
                  );
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedClassId(c.id);
                        setSelectedSectionScopeId('__class__');
                      }}
                      className={`w-full px-3 py-2 text-xs font-semibold rounded-lg text-left transition-colors flex items-center justify-between ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{c.name}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                          isSelected
                            ? 'bg-blue-700 text-blue-100'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {c.subjectRequirements.length} subs
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: Subjects configured for this active class */}
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              {/* Header Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Subjects for {activeClass.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-semibold">
                      {activeClass.subjectRequirements.length} Subjects Configured
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Total weekly load: <strong>{activeClass.subjectRequirements.reduce((acc, r) => acc + r.periodsPerWeek, 0)} periods/week</strong>
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleSyncFromTeachers}
                    className="px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-1.5 shrink-0 transition-colors shadow-2xs"
                    title="শিক্ষক ব্যবস্থাপনা (Faculty Management) থেকে সকল শিক্ষকের অ্যাসাইনকৃত ক্লাস ও বিষয়সমূহ এখানে অটো-সিঙ্ক করুন"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span>টিচারদের তথ্য থেকে অটো-সিঙ্ক</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsAddingGlobal(true);
                      setActiveTab('all_subjects');
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 rounded-lg flex items-center gap-1.5 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create New Subject</span>
                  </button>
                </div>
              </div>

              {/* Success Sync Notice Banner */}
              {syncNotice && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-200 font-semibold flex items-center justify-between animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{syncNotice}</span>
                  </div>
                  <button onClick={() => setSyncNotice('')} className="p-0.5 text-emerald-600 hover:text-emerald-900">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Play & Nursery Block Teacher Notice OR Class Subject Table */}
              {isPlayNur ? (
                <div className="p-6 rounded-2xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/30 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-indigo-950 dark:text-indigo-100">
                    <BookOpen className="w-4 h-4 text-indigo-600" />
                    <span>{activeClass.name}: কোনো আলাদা সাবজেক্ট নেই (ব্লক টিচার সকল বিষয় পড়াবেন)</span>
                  </div>
                  <p className="text-xs text-indigo-800 dark:text-indigo-200 leading-relaxed">
                    স্কুলের নীতিমালা অনুযায়ী <strong>প্লে ও নার্সারি</strong> শ্রেণিতে কোনো আলাদা বিষয় থাকে না। প্রতিটি শ্রেণিতে শুধুমাত্র দুটি শিফট (<strong>মর্নিং শিফট ও ডে শিফট</strong>) রয়েছে এবং নির্ধারিত <strong>২ জন ব্লক টিচার</strong> সকল বিষয় পড়ান।
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(activeClass.blockTeacherIds || []).map((bId, idx) => {
                      const t = teacherMap.get(bId);
                      if (!t) return null;
                      return (
                        <span
                          key={bId}
                          className="px-3 py-1 rounded-lg bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold text-indigo-900 dark:text-indigo-200"
                        >
                          ব্লক টিচার {idx + 1}: {t.name} ({t.initials})
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  {/* Add Subject to This Class Form */}
                  <div className="p-4 rounded-xl border border-dashed border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20 space-y-3">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5 text-blue-600" />
                      <span>Add a Subject to {activeClass.name} (এই শ্রেণিতে বিষয় যুক্ত করুন)</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                      {/* Subject Dropdown */}
                      <div className="sm:col-span-2">
                        <select
                          value={addSubjectIdToClass}
                          onChange={e => setAddSubjectIdToClass(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-medium"
                        >
                          <option value="">— Select Subject to Add —</option>
                          {availableSubjectsForClass.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.code})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Periods / Week */}
                      <div>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          placeholder="Periods/wk"
                          value={addSubjectPeriods}
                          onChange={e => setAddSubjectPeriods(Number(e.target.value))}
                          className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-center font-bold tabular-nums"
                          title="Number of periods per week"
                        />
                      </div>

                      {/* Add button */}
                      <div>
                        <button
                          type="button"
                          onClick={handleAddSubjectToClass}
                          disabled={!addSubjectIdToClass}
                          className="w-full px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Add to Class</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Section-wise Independent Control Bar */}
                  {activeClass.sections.length > 0 && (
                    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2">
                      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        সেকশন অনুযায়ী স্বতন্ত্র বিষয়, সাপ্তাহিক ক্লাস ও শিক্ষক নিয়ন্ত্রণ (অন্য সেকশনে কপি হবে না):
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setSelectedSectionScopeId('__class__')}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                            selectedSectionScopeId === '__class__'
                              ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          Class Default (টেমপ্লেট)
                        </button>
                        {activeClass.sections.map(sec => {
                          const isSecActive = selectedSectionScopeId === sec.id;
                          return (
                            <button
                              key={sec.id}
                              type="button"
                              onClick={() => setSelectedSectionScopeId(sec.id)}
                              className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                                isSecActive
                                  ? 'bg-blue-700 text-white border-blue-700'
                                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                              }`}
                            >
                              {sec.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Table of active subjects in this class / selected section */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3 font-semibold">Subject Name</th>
                          <th className="py-2.5 px-3 font-semibold w-28 text-center">Periods/Wk</th>
                          <th className="py-2.5 px-3 font-semibold">Assigned Teacher</th>
                          <th className="py-2.5 px-3 font-semibold text-right w-24">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {activeClass.subjectRequirements.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-400">
                              এই শ্রেণিতে এখনো কোনো বিষয় অন্তর্ভুক্ত করা হয়নি। উপরের ফরম থেকে বিষয় যোগ করুন।
                            </td>
                          </tr>
                        ) : (
                          (() => {
                            const scopedSection =
                              selectedSectionScopeId !== '__class__'
                                ? activeClass.sections.find(s => s.id === selectedSectionScopeId)
                                : undefined;
                            const secEffReqs = scopedSection
                              ? getEffectiveSectionRequirements(activeClass, scopedSection.id, teachers)
                              : [];
                            const secSelectedSet = new Set(secEffReqs.map(r => r.subjectId));

                            return activeClass.subjectRequirements.map(req => {
                              const subject = subjectMap.get(req.subjectId);
                              const nonBlockTeachers = teachers.filter(t => !isTeacherBlockTeacher(t, classes));
                              const qualifiedTeachers = nonBlockTeachers.filter(t =>
                                t.subjectIds.includes(req.subjectId)
                              );

                              const effForRow = scopedSection
                                ? secEffReqs.find(r => r.subjectId === req.subjectId)
                                : undefined;
                              const isSecSelected = scopedSection ? secSelectedSet.has(req.subjectId) : true;
                              const displayPeriods = scopedSection
                                ? effForRow?.periodsPerWeek ?? req.periodsPerWeek
                                : req.periodsPerWeek;
                              const displayTeacherId = scopedSection
                                ? effForRow?.assignedTeacherId ?? ''
                                : req.assignedTeacherId || '';

                              const updateRow = (nextPeriods: number, nextTeacherId?: string) => {
                                if (scopedSection && onUpdateSectionSubjectConfig) {
                                  onUpdateSectionSubjectConfig(
                                    activeClass.id,
                                    scopedSection.id,
                                    req.subjectId,
                                    {
                                      periodsPerWeek: nextPeriods,
                                      assignedTeacherId: nextTeacherId ?? '',
                                    }
                                  );
                                } else {
                                  handleUpdateClassRequirement(
                                    req.subjectId,
                                    nextPeriods,
                                    nextTeacherId || undefined
                                  );
                                }
                              };

                              const toggleSecSubject = () => {
                                if (!scopedSection) return;
                                const allIds = activeClass.subjectRequirements.map(r => r.subjectId);
                                const nextSet = new Set(
                                  scopedSection.selectedSubjectIds !== undefined
                                    ? scopedSection.selectedSubjectIds
                                    : allIds
                                );
                                if (nextSet.has(req.subjectId)) nextSet.delete(req.subjectId);
                                else nextSet.add(req.subjectId);
                                const updatedClasses = classes.map(c =>
                                  c.id === activeClass.id
                                    ? {
                                        ...c,
                                        sections: c.sections.map(s =>
                                          s.id === scopedSection.id
                                            ? { ...s, selectedSubjectIds: Array.from(nextSet) }
                                            : s
                                        ),
                                      }
                                    : c
                                );
                                onUpdateClasses(updatedClasses);
                              };

                              return (
                                <tr
                                  key={req.subjectId}
                                  className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors ${
                                    scopedSection && !isSecSelected ? 'opacity-50' : ''
                                  }`}
                                >
                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center gap-2">
                                      {scopedSection && (
                                        <input
                                          type="checkbox"
                                          checked={isSecSelected}
                                          onChange={toggleSecSubject}
                                          className="w-3.5 h-3.5 rounded text-blue-600 border-slate-300 shrink-0"
                                          title="এই সেকশনে বিষয়টি চালু/বন্ধ করুন"
                                        />
                                      )}
                                      <span
                                        className="w-2.5 h-2.5 rounded-full shrink-0"
                                        style={{ backgroundColor: subject?.color || '#3B82F6' }}
                                      />
                                      <div>
                                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                                          {subject?.name || 'Unknown Subject'}
                                        </span>
                                        <span className="ml-1.5 text-[10px] text-slate-400 font-mono">
                                          [{subject?.code}]
                                        </span>
                                      </div>
                                    </div>
                                  </td>

                                  {/* Periods / week counter */}
                                  <td className="py-2 px-3 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        type="button"
                                        disabled={scopedSection ? !isSecSelected : false}
                                        onClick={() =>
                                          updateRow(
                                            Math.max(1, displayPeriods - 1),
                                            displayTeacherId
                                          )
                                        }
                                        className="w-5 h-5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 disabled:opacity-40 rounded text-slate-600 flex items-center justify-center font-bold text-xs"
                                      >
                                        -
                                      </button>
                                      <span className="w-8 text-center font-bold tabular-nums text-slate-900 dark:text-white">
                                        {displayPeriods}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={scopedSection ? !isSecSelected : false}
                                        onClick={() =>
                                          updateRow(
                                            displayPeriods + 1,
                                            displayTeacherId
                                          )
                                        }
                                        className="w-5 h-5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 disabled:opacity-40 rounded text-slate-600 flex items-center justify-center font-bold text-xs"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </td>

                                  {/* Assigned Teacher (Strictly excludes Block Teachers) */}
                                  <td className="py-2 px-3">
                                    <select
                                      disabled={scopedSection ? !isSecSelected : false}
                                      value={displayTeacherId}
                                      onChange={e =>
                                        updateRow(displayPeriods, e.target.value)
                                      }
                                      className="w-full max-w-xs py-1 px-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200 font-medium disabled:opacity-50"
                                    >
                                      <option value="">Any Qualified Teacher</option>
                                      {qualifiedTeachers.map(t => (
                                        <option key={t.id} value={t.id}>
                                          {t.name} ({t.initials})
                                        </option>
                                      ))}
                                      {nonBlockTeachers
                                        .filter(t => !qualifiedTeachers.some(q => q.id === t.id))
                                        .map(t => (
                                          <option key={t.id} value={t.id}>
                                            {t.name} ({t.initials}) [Other Dept]
                                          </option>
                                        ))}
                                    </select>
                                  </td>

                                  {/* Remove Button from Class */}
                                  <td className="py-2 px-3 text-right">
                                    {!scopedSection ? (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveSubjectFromClass(req.subjectId)}
                                        title={`"${subject?.name || 'বিষয়'}" কে ${activeClass.name} শ্রেণি থেকে মুছে ফেলুন`}
                                        className="px-2.5 py-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded-lg transition-colors flex items-center gap-1 ml-auto font-medium"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>মুছুন</span>
                                      </button>
                                    ) : (
                                      <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
                                        {scopedSection.name}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            });
                          })()
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: All Global Subjects Management */}
        {activeTab === 'all_subjects' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Top Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search subjects by name or code..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              {!isAddingGlobal && !editingSubject && (
                <button
                  onClick={() => {
                    setIsAddingGlobal(true);
                    setEditingSubject(null);
                    setNewSubName('');
                    setNewSubCode('');
                    setNewSubColor('#3B82F6');
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg flex items-center gap-1.5 shadow-xs shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ নতুন বিষয় যোগ করুন</span>
                </button>
              )}
            </div>

            {/* Create or Edit Subject Form */}
            {(isAddingGlobal || editingSubject) && (
              <form
                onSubmit={handleSaveGlobalSubject}
                className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/30 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-blue-900 dark:text-blue-200 uppercase tracking-wider">
                    {editingSubject ? `Edit Subject: ${editingSubject.name}` : 'Create Brand New Subject'}
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingGlobal(false);
                      setEditingSubject(null);
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Cancel
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Subject Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Arabic, Quran Studies, Spoken English"
                      value={newSubName}
                      onChange={e => setNewSubName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-medium text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Subject Code (3-4 letters)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. ARB, CS, SPK"
                      value={newSubCode}
                      onChange={e => setNewSubCode(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono uppercase text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Subject Color Badge
                    </label>
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      {PRESET_COLORS.slice(0, 8).map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewSubColor(c)}
                          className={`w-5 h-5 rounded-full border transition-transform ${
                            newSubColor === c ? 'scale-125 ring-2 ring-blue-500' : 'opacity-80'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingGlobal(false);
                      setEditingSubject(null);
                    }}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-xs"
                  >
                    {editingSubject ? 'Update Subject' : 'Save Subject'}
                  </button>
                </div>
              </form>
            )}

            {/* List of all global subjects */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {filteredSubjects.map(sub => {
                // Find which classes are using this subject
                const classesUsingThis = classes.filter(c =>
                  c.subjectRequirements.some(r => r.subjectId === sub.id)
                );

                return (
                  <div
                    key={sub.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 shadow-2xs flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: sub.color }}
                        />
                        <div>
                          <div className="font-bold text-xs text-slate-900 dark:text-white">
                            {sub.name}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Code: {sub.code}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSubject(sub);
                            setIsAddingGlobal(false);
                            setNewSubName(sub.name);
                            setNewSubCode(sub.code);
                            setNewSubColor(sub.color);
                          }}
                          title="Edit subject name or code"
                          className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubjectToDelete(sub)}
                          title={`"${sub.name}" বিষয়কে সম্পূর্ণ ডাটাবেস থেকে মুছে ফেলুন (Delete)`}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700/60 truncate">
                      অন্তর্ভুক্ত শ্রেণি:{' '}
                      {classesUsingThis.length > 0
                        ? classesUsingThis.map(c => c.name).join(', ')
                        : 'কোনো ক্লাসে নির্ধারিত নয়'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-xs"
          >
            Done (সম্পন্ন)
          </button>
        </div>

        {/* Custom In-App Delete Subject Confirmation Modal (Zero browser confirm() blocking) */}
        {subjectToDelete && (
          <div className="absolute inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-100">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-300 dark:border-rose-900 shadow-2xl max-w-md w-full p-5 space-y-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-start gap-3">
                <div className="p-3 bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400 rounded-xl shrink-0">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    বিষয়টি স্থায়ীভাবে মুছে ফেলতে চান?
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Confirm deleting subject from the school database.
                  </p>
                </div>
              </div>

              {/* Subject details card */}
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200 dark:border-slate-700 text-xs space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">বিষয়ের নাম:</span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: subjectToDelete.color }}
                    />
                    <span className="font-bold text-slate-900 dark:text-white">
                      {subjectToDelete.name}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">বিষয় কোড:</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300 font-mono">
                    {subjectToDelete.code}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1.5 mt-1.5">
                  <span className="text-slate-500">অন্তর্ভুক্ত শ্রেণি সংখ্যা:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {classes.filter(c => c.subjectRequirements.some(r => r.subjectId === subjectToDelete.id)).length} টি ক্লাসে রয়েছে
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">রুটিনে নির্ধারিত ক্লাস:</span>
                  <span className={`font-bold ${getSubjectRoutineCount(subjectToDelete.id) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
                    {getSubjectRoutineCount(subjectToDelete.id)} টি পিরিয়ড
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs text-rose-800 dark:text-rose-300">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>সতর্কবার্তা:</span>
                </div>
                <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-400">
                  এই বিষয়টি ডিলিট করলে তা প্রতিষ্ঠানের সকল ক্লাসের বিষয় তালিকা, শিক্ষকের পাঠদান বিষয় এবং রুটিন থেকে স্থায়ীভাবে মুছে ফেলা হবে।
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSubjectToDelete(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  বাতিল (Cancel)
                </button>
                <button
                  type="button"
                  onClick={executeDeleteGlobalSubject}
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
