import React, { useState } from 'react';
import { SchoolClass, Subject, Teacher } from '../types';
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
} from 'lucide-react';

interface SubjectManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: SchoolClass[];
  subjects: Subject[];
  teachers: Teacher[];
  initialClassId?: string;
  onUpdateSubjects: (updatedSubjects: Subject[]) => void;
  onUpdateClasses: (updatedClasses: SchoolClass[]) => void;
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
  initialClassId,
  onUpdateSubjects,
  onUpdateClasses,
}) => {
  if (!isOpen) return null;

  const [activeTab, setActiveTab] = useState<'class_subjects' | 'all_subjects'>('class_subjects');
  const [selectedClassId, setSelectedClassId] = useState<string>(
    initialClassId || classes[0]?.id || ''
  );
  const activeClass = classes.find(c => c.id === selectedClassId) || classes[0];

  // Search in all subjects
  const [searchQuery, setSearchQuery] = useState('');

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

  // 1. Add Brand New Global Subject
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
      setEditingSubject(null);
    } else {
      const newSub: Subject = {
        id: `sub-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
        name: newSubName.trim(),
        code,
        color: newSubColor,
      };
      onUpdateSubjects([...subjects, newSub]);
      setIsAddingGlobal(false);
    }

    setNewSubName('');
    setNewSubCode('');
    setNewSubColor('#3B82F6');
  };

  // 2. Delete Global Subject
  const handleDeleteGlobalSubject = (subjectId: string) => {
    const isUsedInClass = classes.some(c =>
      c.subjectRequirements.some(r => r.subjectId === subjectId)
    );
    if (
      isUsedInClass &&
      !confirm(
        'This subject is currently assigned to one or more classes. Deleting it will remove it from all class requirements. Continue?'
      )
    ) {
      return;
    }

    onUpdateSubjects(subjects.filter(s => s.id !== subjectId));

    // Remove from classes
    const updatedClasses = classes.map(c => ({
      ...c,
      subjectRequirements: c.subjectRequirements.filter(r => r.subjectId !== subjectId),
    }));
    onUpdateClasses(updatedClasses);
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
  };

  // 5. Remove Subject from Class
  const handleRemoveSubjectFromClass = (subjectId: string) => {
    const updatedClasses = classes.map(c => {
      if (c.id === activeClass.id) {
        return {
          ...c,
          subjectRequirements: c.subjectRequirements.filter(r => r.subjectId !== subjectId),
        };
      }
      return c;
    });
    onUpdateClasses(updatedClasses);
  };

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  // Active class assigned subjects vs unassigned available subjects
  const assignedSubjectIds = new Set(activeClass?.subjectRequirements.map(r => r.subjectId));
  const availableSubjectsForClass = subjects.filter(s => !assignedSubjectIds.has(s.id));

  // Filtered subjects list for search
  const filteredSubjects = subjects.filter(
    s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
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
                Add new subjects, edit subject names/codes, and configure subjects taught in each class.
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

        {/* Tab 1: Class-Wise Subjects */}
        {activeTab === 'class_subjects' && (
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* Left: Class Selector (Play, Nursery, KG, Class 1-10) */}
            <div className="w-full md:w-56 border-r border-slate-200 dark:border-slate-800 p-3 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/40 shrink-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-2">
                Select Class
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
                      onClick={() => setSelectedClassId(c.id)}
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

              {/* Add Subject to This Class Form */}
              <div className="p-4 rounded-xl border border-dashed border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20 space-y-3">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-blue-600" />
                  <span>Add a Subject to {activeClass.name}</span>
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

              {/* Table of active subjects in this class */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Subject Name</th>
                      <th className="py-2.5 px-3 font-semibold w-24 text-center">Periods/Wk</th>
                      <th className="py-2.5 px-3 font-semibold">Assigned Teacher</th>
                      <th className="py-2.5 px-3 font-semibold text-right w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeClass.subjectRequirements.map(req => {
                      const subject = subjectMap.get(req.subjectId);
                      const qualifiedTeachers = teachers.filter(t =>
                        t.subjectIds.includes(req.subjectId)
                      );

                      return (
                        <tr
                          key={req.subjectId}
                          className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
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
                                onClick={() =>
                                  handleUpdateClassRequirement(
                                    req.subjectId,
                                    Math.max(1, req.periodsPerWeek - 1),
                                    req.assignedTeacherId
                                  )
                                }
                                className="w-5 h-5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded text-slate-600 flex items-center justify-center font-bold text-xs"
                              >
                                -
                              </button>
                              <span className="w-8 text-center font-bold tabular-nums text-slate-900 dark:text-white">
                                {req.periodsPerWeek}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateClassRequirement(
                                    req.subjectId,
                                    req.periodsPerWeek + 1,
                                    req.assignedTeacherId
                                  )
                                }
                                className="w-5 h-5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded text-slate-600 flex items-center justify-center font-bold text-xs"
                              >
                                +
                              </button>
                            </div>
                          </td>

                          {/* Assigned Teacher */}
                          <td className="py-2 px-3">
                            <select
                              value={req.assignedTeacherId || ''}
                              onChange={e =>
                                handleUpdateClassRequirement(
                                  req.subjectId,
                                  req.periodsPerWeek,
                                  e.target.value || undefined
                                )
                              }
                              className="w-full max-w-xs py-1 px-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200 font-medium"
                            >
                              <option value="">Any Qualified Teacher</option>
                              {qualifiedTeachers.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.name} ({t.initials})
                                </option>
                              ))}
                              {/* Also list other teachers if needed */}
                              {teachers
                                .filter(t => !qualifiedTeachers.some(q => q.id === t.id))
                                .map(t => (
                                  <option key={t.id} value={t.id}>
                                    {t.name} ({t.initials}) [Other Dept]
                                  </option>
                                ))}
                            </select>
                          </td>

                          {/* Remove Button */}
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveSubjectFromClass(req.subjectId)}
                              title={`Remove ${subject?.name} from ${activeClass.name}`}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: All School Subjects (Global Manager) */}
        {activeTab === 'all_subjects' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-5">
            {/* Top Bar: Search & Add Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search subjects by name or code..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {!isAddingGlobal && !editingSubject && (
                <button
                  type="button"
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
                  <span>Add New Subject</span>
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
                          onClick={() => handleDeleteGlobalSubject(sub.id)}
                          title="Delete subject"
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700/60 truncate">
                      Taught in:{' '}
                      {classesUsingThis.length > 0
                        ? classesUsingThis.map(c => c.name).join(', ')
                        : 'Not assigned to any class yet'}
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
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
