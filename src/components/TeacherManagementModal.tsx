import React, { useState } from 'react';
import { Subject, Teacher } from '../types';
import { X, Plus, Trash2, Edit2, Users, Check, Shield } from 'lucide-react';

interface TeacherManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  teachers: Teacher[];
  subjects: Subject[];
  onUpdateTeachers: (updated: Teacher[]) => void;
}

export const TeacherManagementModal: React.FC<TeacherManagementModalProps> = ({
  isOpen,
  onClose,
  teachers,
  subjects,
  onUpdateTeachers,
}) => {
  if (!isOpen) return null;

  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [isAddingNew, setIsAddingNew] = useState<boolean>(false);

  // Form states
  const [name, setName] = useState('');
  const [initials, setInitials] = useState('');
  const [designation, setDesignation] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [maxConsecutive, setMaxConsecutive] = useState<number>(2);

  const startEdit = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setIsAddingNew(false);
    setName(teacher.name);
    setInitials(teacher.initials);
    setDesignation(teacher.designation);
    setEmail(teacher.email || '');
    setPhone(teacher.phone || '');
    setSelectedSubjectIds(teacher.subjectIds || []);
    setMaxConsecutive(teacher.maxConsecutivePeriods || 2);
  };

  const startAddNew = () => {
    setEditingTeacher(null);
    setIsAddingNew(true);
    setName('');
    setInitials('');
    setDesignation('Assistant Teacher');
    setEmail('');
    setPhone('');
    setSelectedSubjectIds([subjects[0]?.id || '']);
    setMaxConsecutive(2);
  };

  const handleToggleSubject = (subId: string) => {
    if (selectedSubjectIds.includes(subId)) {
      if (selectedSubjectIds.length > 1) {
        setSelectedSubjectIds(selectedSubjectIds.filter(id => id !== subId));
      }
    } else {
      setSelectedSubjectIds([...selectedSubjectIds, subId]);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const initialsVal = initials.trim() || name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();

    if (isAddingNew) {
      const newTeacher: Teacher = {
        id: `tch-${Date.now().toString(36)}`,
        name: name.trim(),
        initials: initialsVal,
        designation: designation.trim() || 'Teacher',
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        subjectIds: selectedSubjectIds,
        maxConsecutivePeriods: maxConsecutive,
        maxDailyPeriods: 4,
      };
      onUpdateTeachers([...teachers, newTeacher]);
    } else if (editingTeacher) {
      const updated = teachers.map(t => {
        if (t.id === editingTeacher.id) {
          return {
            ...t,
            name: name.trim(),
            initials: initialsVal,
            designation: designation.trim(),
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            subjectIds: selectedSubjectIds,
            maxConsecutivePeriods: maxConsecutive,
          };
        }
        return t;
      });
      onUpdateTeachers(updated);
    }

    setEditingTeacher(null);
    setIsAddingNew(false);
  };

  const handleDelete = (teacherId: string) => {
    if (confirm('Delete this teacher profile?')) {
      onUpdateTeachers(teachers.filter(t => t.id !== teacherId));
      if (editingTeacher?.id === teacherId) {
        setEditingTeacher(null);
        setIsAddingNew(false);
      }
    }
  };

  const subjectMap = new Map(subjects.map(s => [s.id, s]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Faculty & Teacher Management
              </h2>
              <p className="text-xs text-slate-500">
                Manage teaching faculty, subject specializations, and consecutive teaching policies.
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

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Teacher List on Left */}
          <div className="w-full md:w-80 border-r border-slate-200 dark:border-slate-800 p-3 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/40 shrink-0">
            <div className="flex items-center justify-between mb-3 px-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Faculty ({teachers.length})
              </span>
              <button
                onClick={startAddNew}
                className="px-2 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md flex items-center gap-1 shadow-2xs"
              >
                <Plus className="w-3 h-3" />
                <span>New</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {teachers.map(t => {
                const isSelected = editingTeacher?.id === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => startEdit(t)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/40'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-xs text-slate-900 dark:text-white">
                        {t.name}
                      </div>
                      <span className="text-[10px] px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded font-bold">
                        {t.initials}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {t.designation}
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {t.subjectIds.slice(0, 3).map(sId => (
                        <span
                          key={sId}
                          className="text-[9px] px-1.5 py-0.2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded"
                        >
                          {subjectMap.get(sId)?.code || sId}
                        </span>
                      ))}
                      {t.subjectIds.length > 3 && (
                        <span className="text-[9px] text-slate-400">+{t.subjectIds.length - 3}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Form / Profile Editor */}
          <div className="flex-1 p-6 overflow-y-auto">
            {editingTeacher || isAddingNew ? (
              <form onSubmit={handleSave} className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {isAddingNew ? 'Add New Faculty Member' : `Edit: ${editingTeacher?.name}`}
                  </h3>
                  {!isAddingNew && editingTeacher && (
                    <button
                      type="button"
                      onClick={() => handleDelete(editingTeacher.id)}
                      className="text-xs text-rose-600 hover:text-rose-700 flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Teacher</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Mr. A. Rahman"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                      Initials / Routine Code
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. AR"
                      value={initials}
                      onChange={e => setInitials(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 uppercase"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                      Designation
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
                      Max Consecutive Classes
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
                </div>

                {/* Multiple Qualified Subjects Assignment */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
                    Subjects Qualified to Teach (Select multiple)
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

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTeacher(null);
                      setIsAddingNew(false);
                    }}
                    className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-xs"
                  >
                    Save Teacher
                  </button>
                </div>
              </form>
            ) : (
              <div className="py-16 text-center text-slate-500">
                <Users className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Select a Teacher to View or Edit
                </div>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  Or click "+ New" to add a new faculty member to the school roster.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
