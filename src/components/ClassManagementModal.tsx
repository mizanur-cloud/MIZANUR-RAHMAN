import React, { useState } from 'react';
import { SchoolClass, Section, Subject, SubjectRequirement, Teacher } from '../types';
import { X, Plus, Trash2, Edit2, Check, BookOpen, Layers } from 'lucide-react';

interface ClassManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: SchoolClass[];
  subjects: Subject[];
  teachers: Teacher[];
  onUpdateClasses: (updated: SchoolClass[]) => void;
  onOpenSubjectMgmt?: () => void;
}

export const ClassManagementModal: React.FC<ClassManagementModalProps> = ({
  isOpen,
  onClose,
  classes,
  subjects,
  teachers,
  onUpdateClasses,
  onOpenSubjectMgmt,
}) => {
  if (!isOpen) return null;

  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id || '');
  const activeClass = classes.find(c => c.id === selectedClassId) || classes[0];

  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionRoom, setNewSectionRoom] = useState('');

  // Add new section to active class
  const handleAddSection = () => {
    if (!newSectionName.trim()) return;
    const newSection: Section = {
      id: `sec-${activeClass.id}-${Date.now().toString(36)}`,
      name: newSectionName.trim(),
      roomNumber: newSectionRoom.trim() || undefined,
    };

    const updated = classes.map(c => {
      if (c.id === activeClass.id) {
        return { ...c, sections: [...c.sections, newSection] };
      }
      return c;
    });

    onUpdateClasses(updated);
    setNewSectionName('');
    setNewSectionRoom('');
  };

  // Remove section
  const handleRemoveSection = (sectionId: string) => {
    if (activeClass.sections.length <= 1) {
      alert('Every class must have at least one section.');
      return;
    }
    const updated = classes.map(c => {
      if (c.id === activeClass.id) {
        return { ...c, sections: c.sections.filter(s => s.id !== sectionId) };
      }
      return c;
    });
    onUpdateClasses(updated);
  };

  // Update subject requirement periods/week
  const handleUpdateRequirement = (
    subjectId: string,
    periodsPerWeek: number,
    assignedTeacherId?: string
  ) => {
    const updated = classes.map(c => {
      if (c.id === activeClass.id) {
        const existingIdx = c.subjectRequirements.findIndex(r => r.subjectId === subjectId);
        let newReqs = [...c.subjectRequirements];
        if (existingIdx >= 0) {
          if (periodsPerWeek <= 0) {
            newReqs.splice(existingIdx, 1);
          } else {
            newReqs[existingIdx] = {
              subjectId,
              periodsPerWeek,
              assignedTeacherId: assignedTeacherId || undefined,
            };
          }
        } else if (periodsPerWeek > 0) {
          newReqs.push({
            subjectId,
            periodsPerWeek,
            assignedTeacherId: assignedTeacherId || undefined,
          });
        }
        return { ...c, subjectRequirements: newReqs };
      }
      return c;
    });
    onUpdateClasses(updated);
  };

  const subjectMap = new Map(subjects.map(s => [s.id, s]));

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
                Class & Section Management (Play, Nursery, KG, Classes 1 — 10)
              </h2>
              <p className="text-xs text-slate-500">
                Configure sections (up to 4 per class), subject allocations, and weekly period requirements.
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
          {/* Left: Class List */}
          <div className="w-full md:w-56 border-r border-slate-200 dark:border-slate-800 p-3 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/40 shrink-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-2">
              Select Class
            </div>
            <div className="space-y-1">
              {classes.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedClassId(c.id)}
                  className={`w-full px-3 py-2 text-xs font-semibold rounded-lg text-left transition-colors flex items-center justify-between ${
                    c.id === activeClass.id
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{c.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      c.id === activeClass.id
                        ? 'bg-blue-700 text-blue-100'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {c.sections.length} sec
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Active Class Details */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            {/* Sections Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <span>Sections for {activeClass.name}</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Each class can have up to 4 sections by default (A, B, C, D).
                  </p>
                </div>
              </div>

              {/* Sections list */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {activeClass.sections.map(sec => (
                  <div
                    key={sec.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-xs text-slate-900 dark:text-white">
                        {sec.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {sec.roomNumber || 'No room designated'}
                      </div>
                    </div>
                    {activeClass.sections.length > 1 && (
                      <button
                        onClick={() => handleRemoveSection(sec.id)}
                        title="Delete section"
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Section Form */}
              {activeClass.sections.length < 6 && (
                <div className="p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Section Name (e.g. Section E)"
                    value={newSectionName}
                    onChange={e => setNewSectionName(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100"
                  />
                  <input
                    type="text"
                    placeholder="Room # (optional)"
                    value={newSectionRoom}
                    onChange={e => setNewSectionRoom(e.target.value)}
                    className="w-32 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100"
                  />
                  <button
                    onClick={handleAddSection}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Section</span>
                  </button>
                </div>
              )}
            </div>

            {/* Subject Allocation & Quota Requirements */}
            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Weekly Subject Requirements for {activeClass.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Set how many periods each subject must have per week, and designate preferred teachers.
                  </p>
                </div>
                {onOpenSubjectMgmt && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSubjectMgmt();
                    }}
                    className="px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 rounded-lg flex items-center gap-1.5 shrink-0 border border-blue-200 dark:border-blue-900"
                  >
                    <Layers className="w-3.5 h-3.5 text-blue-600" />
                    <span>Manage Global Subjects / বিষয় যোগ বা পরিবর্তন</span>
                  </button>
                )}
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Subject</th>
                      <th className="py-2.5 px-3 font-semibold w-28">Periods / Week</th>
                      <th className="py-2.5 px-3 font-semibold">Assigned Teacher</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {subjects.map(subject => {
                      const req = activeClass.subjectRequirements.find(r => r.subjectId === subject.id);
                      const currentPeriods = req?.periodsPerWeek || 0;
                      const qualifiedTeachers = teachers.filter(t => t.subjectIds.includes(subject.id));

                      return (
                        <tr key={subject.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: subject.color }}
                              />
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {subject.name}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={0}
                              max={10}
                              value={currentPeriods}
                              onChange={e =>
                                handleUpdateRequirement(
                                  subject.id,
                                  Number(e.target.value),
                                  req?.assignedTeacherId
                                )
                              }
                              className="w-16 px-2 py-1 text-center bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md font-bold tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={req?.assignedTeacherId || ''}
                              onChange={e =>
                                handleUpdateRequirement(
                                  subject.id,
                                  currentPeriods,
                                  e.target.value || undefined
                                )
                              }
                              className="w-full max-w-xs py-1 px-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-slate-800 dark:text-slate-200"
                            >
                              <option value="">Any Qualified Teacher</option>
                              {qualifiedTeachers.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.name} ({t.initials})
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
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
