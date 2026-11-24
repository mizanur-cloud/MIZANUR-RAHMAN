import React, { useState, useEffect } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  SchoolClass,
  Section,
  SectionSubjectConfig,
  Subject,
  SubjectRequirement,
  Teacher,
} from '../types';
import { INITIAL_SETTINGS } from '../data/initialData';
import { X, Plus, Trash2, Check, BookOpen, Layers, Calendar, AlertTriangle, CheckSquare } from 'lucide-react';
import { BENGALI_DAY_NAMES, getExtendedDayForSection, isSeventhPeriodDisabled } from '../services/scheduleTiers';
import {
  getEffectiveSectionRequirements,
  getEffectiveSubjectFixedPeriods,
  isPlayOrNursery,
  isTeacherBlockTeacher,
} from '../services/parallelSubjects';

interface ClassManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: SchoolClass[];
  subjects: Subject[];
  teachers: Teacher[];
  workingDays?: DayOfWeek[];
  periodTimings?: PeriodTiming[];
  onUpdateClasses: (updated: SchoolClass[]) => void;
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
  onOpenSubjectMgmt?: () => void;
}

export const ClassManagementModal: React.FC<ClassManagementModalProps> = ({
  isOpen,
  onClose,
  classes,
  subjects,
  teachers,
  workingDays = INITIAL_SETTINGS.workingDays,
  periodTimings = INITIAL_SETTINGS.periodTimings,
  onUpdateClasses,
  onUpdateSectionSubjects,
  onUpdateSectionSubjectConfig,
  onOpenSubjectMgmt,
}) => {
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id || '');
  const activeClass = classes.find(c => c.id === selectedClassId) || classes[0];
  const [selectedSectionId, setSelectedSectionId] = useState<string>(
    activeClass?.sections[0]?.id || ''
  );

  useEffect(() => {
    if (activeClass && !activeClass.sections.some(s => s.id === selectedSectionId)) {
      setSelectedSectionId(activeClass.sections[0]?.id || '');
    }
  }, [activeClass, selectedSectionId]);

  const activeSection =
    activeClass?.sections.find(s => s.id === selectedSectionId) || activeClass?.sections[0];

  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionRoom, setNewSectionRoom] = useState('');
  const [sectionNotice, setSectionNotice] = useState('');
  const [extraSubjectId, setExtraSubjectId] = useState('');
  const [extraPeriods, setExtraPeriods] = useState(4);
  const teachingPeriods = periodTimings.filter(p => !p.isBreak && !p.isLocked);

  if (!isOpen) return null;

  const isPlayNur = isPlayOrNursery(activeClass);

  // Add new section to active class (clean slate: NEVER copies sibling section teachers)
  const handleAddSection = () => {
    if (isPlayNur && activeClass.sections.length >= 2) {
      setSectionNotice('প্লে ও নার্সারি শ্রেণিতে শুধুমাত্র দুটি শিফট (মর্নিং ও ডে শিফট) অনুমোদিত।');
      setTimeout(() => setSectionNotice(''), 3500);
      return;
    }
    if (!newSectionName.trim()) return;

    const initialConfigs: Record<string, SectionSubjectConfig> = {};
    if (!isPlayNur) {
      activeClass.subjectRequirements.forEach(req => {
        initialConfigs[req.subjectId] = {
          periodsPerWeek: req.periodsPerWeek,
          assignedTeacherId: '',
        };
      });
    }

    const newSection: Section = {
      id: `sec-${activeClass.id}-${Date.now().toString(36)}`,
      name: newSectionName.trim(),
      roomNumber: newSectionRoom.trim() || undefined,
      selectedSubjectIds: isPlayNur ? undefined : activeClass.subjectRequirements.map(r => r.subjectId),
      subjectConfigs: isPlayNur ? undefined : initialConfigs,
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
      setSectionNotice('প্রতিটি শ্রেণিতে কমপক্ষে একটি সেকশন/শিফট থাকতে হবে।');
      setTimeout(() => setSectionNotice(''), 3500);
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
              ...newReqs[existingIdx],
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

  // Section-wise subject selection helpers
  const activeSectionEffectiveReqs =
    activeClass && activeSection && !isPlayNur
      ? getEffectiveSectionRequirements(activeClass, activeSection.id, teachers)
      : [];
  const activeSectionSelectedIds = new Set(activeSectionEffectiveReqs.map(r => r.subjectId));

  const applySectionSubjects = (
    nextIds: string[] | undefined,
    extraReqs?: { subjectId: string; periodsPerWeek: number; assignedTeacherId?: string }[]
  ) => {
    if (!activeClass || !activeSection) return;
    if (onUpdateSectionSubjects) {
      onUpdateSectionSubjects(activeClass.id, activeSection.id, nextIds, extraReqs);
      return;
    }
    const updated = classes.map(c => {
      if (c.id !== activeClass.id) return c;
      let nextClassReqs = [...c.subjectRequirements];
      let siblingSeedIds: string[] | undefined;
      if (extraReqs && extraReqs.length > 0) {
        const oldIds = c.subjectRequirements.map(r => r.subjectId);
        extraReqs.forEach(extra => {
          if (!nextClassReqs.some(r => r.subjectId === extra.subjectId)) {
            nextClassReqs.push(extra);
            siblingSeedIds = oldIds;
          }
        });
      }
      return {
        ...c,
        subjectRequirements: nextClassReqs,
        sections: c.sections.map(s => {
          if (s.id === activeSection.id) return { ...s, selectedSubjectIds: nextIds };
          if (siblingSeedIds && s.selectedSubjectIds === undefined) {
            return { ...s, selectedSubjectIds: [...siblingSeedIds] };
          }
          return s;
        }),
      };
    });
    onUpdateClasses(updated);
  };

  const handleToggleSectionSubject = (subjectId: string) => {
    if (!activeClass || !activeSection) return;
    const allClassSubjectIds = activeClass.subjectRequirements.map(r => r.subjectId);
    const currentSet = new Set(
      activeSection.selectedSubjectIds !== undefined
        ? activeSection.selectedSubjectIds
        : allClassSubjectIds
    );
    if (currentSet.has(subjectId)) {
      currentSet.delete(subjectId);
    } else {
      currentSet.add(subjectId);
    }
    applySectionSubjects(Array.from(currentSet));
  };

  const handleAddExtraSubjectToSection = () => {
    if (!extraSubjectId || !activeClass || !activeSection) return;
    const allClassSubjectIds = activeClass.subjectRequirements.map(r => r.subjectId);
    const currentSet = new Set(
      activeSection.selectedSubjectIds !== undefined
        ? activeSection.selectedSubjectIds
        : allClassSubjectIds
    );
    currentSet.add(extraSubjectId);
    const needsClassReq = !activeClass.subjectRequirements.some(r => r.subjectId === extraSubjectId);
    applySectionSubjects(
      Array.from(currentSet),
      needsClassReq
        ? [{ subjectId: extraSubjectId, periodsPerWeek: Math.max(1, extraPeriods) }]
        : undefined
    );
    setExtraSubjectId('');
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
            {/* Block Teacher Setup (Specifically Play & Nursery with 2 Block Teachers & 2 Shifts) */}
            {(isPlayNur || activeClass.isJuniorClass) && (
              <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-indigo-950 dark:text-indigo-200 uppercase tracking-wide flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-600" />
                      <span>ব্লক টিচার সেটআপ (Play & Nursery — সকল বিষয়)</span>
                    </h3>
                    <p className="text-[11px] text-indigo-700 dark:text-indigo-300 mt-0.5">
                      প্লে ও নার্সারিতে কোনো আলাদা বিষয় থাকে না; ২ জন করে ব্লক টিচার মর্নিং ও ডে শিফটে সকল বিষয় পড়াবেন। ব্লক টিচারদের অন্য কোনো ক্লাসে বা প্রক্সি ক্লাসে দেওয়া যাবে না।
                    </p>
                  </div>
                  {!isPlayNur && (
                    <label className="flex items-center gap-2 cursor-pointer shrink-0">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        ব্লক মডেল:
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(activeClass.isJuniorClass)}
                        onChange={e => {
                          const isJunior = e.target.checked;
                          const updated = classes.map(c => {
                            if (c.id === activeClass.id) {
                              return {
                                ...c,
                                isJuniorClass: isJunior,
                                maxPeriods: isJunior ? (c.maxPeriods || 4) : undefined,
                                blockTeacherIds: isJunior ? (c.blockTeacherIds || [teachers[0]?.id].filter(Boolean)) : undefined,
                              };
                            }
                            return c;
                          });
                          onUpdateClasses(updated);
                        }}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                      />
                    </label>
                  )}
                </div>

                {(isPlayNur || activeClass.isJuniorClass) && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-indigo-100 dark:border-indigo-900/40">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        সর্বোচ্চ পিরিয়ড সংখ্যা (Max Periods)
                      </label>
                      <select
                        value={activeClass.maxPeriods || 4}
                        onChange={e => {
                          const maxP = Number(e.target.value);
                          const updated = classes.map(c =>
                            c.id === activeClass.id ? { ...c, maxPeriods: maxP } : c
                          );
                          onUpdateClasses(updated);
                        }}
                        className="w-full py-1.5 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100"
                      >
                        <option value={3}>৩য় পিরিয়ড পর্যন্ত (Periods 1 - 3)</option>
                        <option value={4}>৪র্থ পিরিয়ড পর্যন্ত (Periods 1 - 4, Standard)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        ব্লক শিক্ষক ১ (Block Teacher 1) *
                      </label>
                      <select
                        value={activeClass.blockTeacherIds?.[0] || ''}
                        onChange={e => {
                          const tId = e.target.value;
                          const secondId = activeClass.blockTeacherIds?.[1];
                          const newIds = [tId, secondId].filter(Boolean) as string[];
                          const updated = classes.map(c =>
                            c.id === activeClass.id ? { ...c, blockTeacherIds: newIds, isJuniorClass: true, usesShifts: isPlayNur } : c
                          );
                          onUpdateClasses(updated);
                        }}
                        className="w-full py-1.5 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100 font-medium"
                      >
                        <option value="">শিক্ষক নির্বাচন করুন...</option>
                        {teachers.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.initials})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        ব্লক শিক্ষক ২ (Block Teacher 2) *
                      </label>
                      <select
                        value={activeClass.blockTeacherIds?.[1] || ''}
                        onChange={e => {
                          const secondId = e.target.value;
                          const firstId = activeClass.blockTeacherIds?.[0] || teachers[0]?.id;
                          const newIds = [firstId, secondId].filter(Boolean) as string[];
                          const updated = classes.map(c =>
                            c.id === activeClass.id ? { ...c, blockTeacherIds: newIds, isJuniorClass: true, usesShifts: isPlayNur } : c
                          );
                          onUpdateClasses(updated);
                        }}
                        className="w-full py-1.5 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100"
                      >
                        <option value="">শিক্ষক ২ নির্বাচন করুন...</option>
                        {teachers.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.initials})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Class 6-8 Staggered 7th Period Configuration (with Section & Class-wide OFF option) */}
            {activeClass.numericGrade >= 6 && activeClass.numericGrade <= 8 && (() => {
              const allSectionsOff =
                Boolean(activeClass.disableSeventhPeriod) ||
                (activeClass.sections.length > 0 && activeClass.sections.every(s => Boolean(s.disableSeventhPeriod)));

              const toggleClassSeventhPeriod = (disable: boolean) => {
                const updated = classes.map(c => {
                  if (c.id !== activeClass.id) return c;
                  return {
                    ...c,
                    disableSeventhPeriod: disable,
                    sections: c.sections.map(s => ({
                      ...s,
                      disableSeventhPeriod: disable,
                    })),
                  };
                });
                onUpdateClasses(updated);
              };

              return (
                <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/70 dark:bg-purple-950/30 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-purple-900 dark:text-purple-200 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-purple-600" />
                        <span>৭ম পিরিয়ড বণ্টন (Staggered 7th Period per Section)</span>
                      </h3>
                      <p className="text-[11px] text-purple-700 dark:text-purple-300 mt-0.5">
                        প্রতিটি সেকশনের জন্য ৭ম পিরিয়ডের দিন নির্ধারণ করুন অথবা চাইলে নির্দিষ্ট সেকশন কিংবা সম্পূর্ণ শ্রেণির রুটিনে ৭ম পিরিয়ড বন্ধ (Off) রাখুন।
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleClassSeventhPeriod(!allSectionsOff)}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border shrink-0 transition-colors ${
                        allSectionsOff
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                          : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:hover:bg-rose-950 dark:text-rose-300 dark:border-rose-800'
                      }`}
                    >
                      {allSectionsOff
                        ? 'সম্পূর্ণ ক্লাসে ৭ম পিরিয়ড চালু করুন'
                        : 'সম্পূর্ণ ক্লাসে ৭ম পিরিয়ড বন্ধ রাখুন'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {activeClass.sections.map(sec => {
                      const isOff = isSeventhPeriodDisabled(activeClass, sec.id);
                      const currentExtDay = getExtendedDayForSection(activeClass, sec.id);
                      return (
                        <div
                          key={sec.id}
                          className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 ${
                            isOff
                              ? 'bg-slate-100/80 dark:bg-slate-800/70 border-slate-300 dark:border-slate-700'
                              : 'bg-white dark:bg-slate-800 border-purple-200 dark:border-purple-800'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-xs text-slate-800 dark:text-slate-100">
                              সেকশন {sec.name}
                            </div>
                            <div
                              className={`text-[10px] font-semibold ${
                                isOff
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-purple-600 dark:text-purple-400'
                              }`}
                            >
                              {isOff
                                ? '৭ম পিরিয়ড বন্ধ (৬ষ্ঠ পিরিয়ড পর্যন্ত)'
                                : `৭ম পিরিয়ড: ${BENGALI_DAY_NAMES[currentExtDay]} (${currentExtDay})`}
                            </div>
                          </div>

                          <select
                            value={isOff ? '__OFF__' : currentExtDay}
                            onChange={e => {
                              const val = e.target.value;
                              const updated = classes.map(c => {
                                if (c.id !== activeClass.id) return c;
                                if (val === '__OFF__') {
                                  const newSecs = c.sections.map(s =>
                                    s.id === sec.id ? { ...s, disableSeventhPeriod: true } : s
                                  );
                                  return { ...c, sections: newSecs };
                                }
                                const newDay = val as DayOfWeek;
                                const classWasDisabled = Boolean(c.disableSeventhPeriod);
                                const newSecs = c.sections.map(s =>
                                  s.id === sec.id
                                    ? { ...s, extendedDay: newDay, disableSeventhPeriod: false }
                                    : classWasDisabled && s.disableSeventhPeriod === undefined
                                    ? { ...s, disableSeventhPeriod: true }
                                    : s
                                );
                                const newSecDays = { ...(c.sectionExtendedDays || {}), [sec.id]: newDay };
                                return {
                                  ...c,
                                  disableSeventhPeriod: false,
                                  sections: newSecs,
                                  sectionExtendedDays: newSecDays,
                                };
                              });
                              onUpdateClasses(updated);
                            }}
                            className={`py-1 px-2 text-[11px] font-semibold border rounded-md ${
                              isOff
                                ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                                : 'bg-purple-50 dark:bg-slate-700 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                            }`}
                          >
                            <option value="__OFF__">৭ম পিরিয়ড বন্ধ (Off)</option>
                            {(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'] as DayOfWeek[]).map(d => (
                              <option key={d} value={d}>
                                {BENGALI_DAY_NAMES[d]}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Class 9-10 Optional 7th Period On/Off Control per Section & Class */}
            {activeClass.numericGrade >= 9 && (() => {
              const allSectionsOff =
                Boolean(activeClass.disableSeventhPeriod) ||
                (activeClass.sections.length > 0 && activeClass.sections.every(s => Boolean(s.disableSeventhPeriod)));

              const toggleClassSeventhPeriod = (disable: boolean) => {
                const updated = classes.map(c => {
                  if (c.id !== activeClass.id) return c;
                  return {
                    ...c,
                    disableSeventhPeriod: disable,
                    sections: c.sections.map(s => ({
                      ...s,
                      disableSeventhPeriod: disable,
                    })),
                  };
                });
                onUpdateClasses(updated);
              };

              return (
                <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-amber-950 dark:text-amber-200 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-amber-600" />
                        <span>৭ম পিরিয়ড নিয়ন্ত্রণ (7th Period Control — {activeClass.name})</span>
                      </h3>
                      <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                        স্বাভাবিকভাবে নবম-দশম শ্রেণিতে ৭ম পিরিয়ড চালু থাকে। চাইলে নির্দিষ্ট সেকশন বা সম্পূর্ণ শ্রেণির রুটিনে ৭ম পিরিয়ড বন্ধ (Off) করতে পারেন।
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleClassSeventhPeriod(!allSectionsOff)}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border shrink-0 transition-colors ${
                        allSectionsOff
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                          : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:hover:bg-rose-950 dark:text-rose-300 dark:border-rose-800'
                      }`}
                    >
                      {allSectionsOff
                        ? 'সম্পূর্ণ ক্লাসে ৭ম পিরিয়ড চালু করুন'
                        : 'সম্পূর্ণ ক্লাসে ৭ম পিরিয়ড বন্ধ রাখুন'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {activeClass.sections.map(sec => {
                      const isOff = isSeventhPeriodDisabled(activeClass, sec.id);
                      return (
                        <div
                          key={sec.id}
                          className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 ${
                            isOff
                              ? 'bg-slate-100/80 dark:bg-slate-800/70 border-slate-300 dark:border-slate-700'
                              : 'bg-white dark:bg-slate-800 border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-xs text-slate-800 dark:text-slate-100">
                              সেকশন {sec.name}
                            </div>
                            <div
                              className={`text-[10px] font-semibold ${
                                isOff
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {isOff ? '৭ম পিরিয়ড বন্ধ (৬ষ্ঠ পিরিয়ড পর্যন্ত)' : 'সকল দিনে ৭ম পিরিয়ড চালু'}
                            </div>
                          </div>

                          <select
                            value={isOff ? 'OFF' : 'ON'}
                            onChange={e => {
                              const nextOff = e.target.value === 'OFF';
                              const updated = classes.map(c => {
                                if (c.id !== activeClass.id) return c;
                                const classWasDisabled = Boolean(c.disableSeventhPeriod);
                                const newSecs = c.sections.map(s =>
                                  s.id === sec.id
                                    ? { ...s, disableSeventhPeriod: nextOff }
                                    : classWasDisabled && !nextOff && s.disableSeventhPeriod === undefined
                                    ? { ...s, disableSeventhPeriod: true }
                                    : s
                                );
                                return {
                                  ...c,
                                  disableSeventhPeriod: nextOff ? c.disableSeventhPeriod : false,
                                  sections: newSecs,
                                };
                              });
                              onUpdateClasses(updated);
                            }}
                            className={`py-1 px-2 text-[11px] font-semibold border rounded-md ${
                              isOff
                                ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                                : 'bg-amber-50 dark:bg-slate-700 border-amber-300 dark:border-amber-600 text-amber-900 dark:text-amber-200'
                            }`}
                          >
                            <option value="ON">৭ম পিরিয়ড চালু (On)</option>
                            <option value="OFF">৭ম পিরিয়ড বন্ধ (Off)</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Sections / Shifts Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <span>
                      {isPlayNur ? `Shifts for ${activeClass.name} (মর্নিং ও ডে শিফট)` : `Sections for ${activeClass.name}`}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isPlayNur
                      ? 'প্লে ও নার্সারির জন্য শুধুমাত্র দুটি শিফট রয়েছে: মর্নিং শিফট এবং ডে শিফট।'
                      : 'Each class can have up to 4 sections by default (A, B, C, D).'}
                  </p>
                </div>
              </div>

              {sectionNotice && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{sectionNotice}</span>
                </div>
              )}

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
                    {!isPlayNur && activeClass.sections.length > 1 && (
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

              {/* Add Section Form (Hidden for Play/Nursery which strictly use Morning & Day Shifts) */}
              {!isPlayNur && activeClass.sections.length < 6 && (
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

            {/* Section-wise Subject Selection (সেকশন-ভিত্তিক বিষয় নির্বাচন) */}
            {!isPlayNur && activeSection && (
              <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>সেকশন-ভিত্তিক বিষয় নির্বাচন ({activeClass.name})</span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      প্রতিটি সেকশনের জন্য আলাদাভাবে নির্ধারিত বিষয় নির্বাচন করুন। শুধুমাত্র নির্বাচিত বিষয়গুলোই ওই সেকশনের রুটিনে অন্তর্ভুক্ত হবে।
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        applySectionSubjects(activeClass.subjectRequirements.map(r => r.subjectId))
                      }
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      সব নির্বাচন
                    </button>
                    <button
                      type="button"
                      onClick={() => applySectionSubjects(undefined)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      ডিফল্ট রিসেট
                    </button>
                  </div>
                </div>

                {/* Section Tabs inside Class */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {activeClass.sections.map(sec => {
                    const isSecSelected = sec.id === activeSection.id;
                    const secReqs = getEffectiveSectionRequirements(activeClass, sec.id, teachers);
                    const totalSecPeriods = secReqs.reduce((acc, r) => acc + r.periodsPerWeek, 0);
                    return (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() => setSelectedSectionId(sec.id)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-2 ${
                          isSecSelected
                            ? 'bg-blue-700 text-white border-blue-700'
                            : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span>{sec.name}</span>
                        <span
                          className={`font-mono text-[10px] tabular-nums ${
                            isSecSelected ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {secReqs.length} subs · {totalSecPeriods}p
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Checklist, Weekly Quota & Section-wise Teacher Assignment for Active Section */}
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {activeClass.name} · {activeSection.name} — স্বতন্ত্র বিষয়, ক্লাস সংখ্যা ও শিক্ষক
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                      নির্বাচিত: {activeSectionSelectedIds.size} / {activeClass.subjectRequirements.length} বিষয়
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {activeClass.subjectRequirements.map(req => {
                      const sub = subjectMap.get(req.subjectId);
                      if (!sub) return null;
                      const isChecked = activeSectionSelectedIds.has(req.subjectId);
                      const effReq = activeSectionEffectiveReqs.find(r => r.subjectId === req.subjectId);
                      const secPeriods = effReq?.periodsPerWeek ?? req.periodsPerWeek;
                      const secTeacherId = effReq?.assignedTeacherId ?? '';
                      const nonBlockTeachers = teachers.filter(t => !isTeacherBlockTeacher(t, classes));
                      const qualified = nonBlockTeachers.filter(t => t.subjectIds.includes(req.subjectId));

                      const updateLocalSectionConfig = (patch: {
                        periodsPerWeek?: number;
                        assignedTeacherId?: string;
                        fixedPeriodIndices?: number[];
                      }) => {
                        if (onUpdateSectionSubjectConfig) {
                          onUpdateSectionSubjectConfig(activeClass.id, activeSection.id, req.subjectId, patch);
                        } else {
                          const updated = classes.map(c => {
                            if (c.id !== activeClass.id) return c;
                            return {
                              ...c,
                              sections: c.sections.map(s => {
                                if (s.id !== activeSection.id) return s;
                                const prev = s.subjectConfigs || {};
                                const cur = prev[req.subjectId] || {};
                                const nextFixed =
                                  'fixedPeriodIndices' in patch
                                    ? patch.fixedPeriodIndices
                                    : cur.fixedPeriodIndices;
                                return {
                                  ...s,
                                  subjectConfigs: {
                                    ...prev,
                                    [req.subjectId]: {
                                      periodsPerWeek:
                                        patch.periodsPerWeek !== undefined
                                          ? Math.max(0, Math.min(12, patch.periodsPerWeek))
                                          : cur.periodsPerWeek ?? req.periodsPerWeek,
                                      assignedTeacherId:
                                        patch.assignedTeacherId !== undefined
                                          ? patch.assignedTeacherId
                                          : cur.assignedTeacherId,
                                      ...(nextFixed !== undefined ? { fixedPeriodIndices: nextFixed } : {}),
                                    },
                                  },
                                };
                              }),
                            };
                          });
                          onUpdateClasses(updated);
                        }
                      };

                      const effectiveFixed = getEffectiveSubjectFixedPeriods(
                        activeClass,
                        activeSection.id,
                        req.subjectId,
                        subjects
                      );
                      const hasParentDefault = Boolean(
                        (req.fixedPeriodIndices !== undefined
                          ? req.fixedPeriodIndices.length > 0
                          : sub.fixedPeriodIndices && sub.fixedPeriodIndices.length > 0)
                      );
                      const toggleSecFixed = (pIdx: number) => {
                        const cur = effectiveFixed || [];
                        const next = cur.includes(pIdx)
                          ? cur.filter(p => p !== pIdx)
                          : [...cur, pIdx].sort((a, b) => a - b);
                        updateLocalSectionConfig({
                          fixedPeriodIndices: next.length > 0 ? next : hasParentDefault ? [] : undefined,
                        });
                      };
                      const maxPossibleInFixed =
                        effectiveFixed && effectiveFixed.length > 0
                          ? effectiveFixed.length * workingDays.length
                          : null;

                      return (
                        <div
                          key={req.subjectId}
                          className={`p-2.5 rounded-lg border space-y-2 transition-colors ${
                            isChecked
                              ? 'bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-800 text-slate-900 dark:text-white'
                              : 'bg-slate-100/70 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <label className="flex items-center gap-2 min-w-0 cursor-pointer flex-1">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleSectionSubject(req.subjectId)}
                                className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 shrink-0"
                              />
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: sub.color }}
                              />
                              <span className="text-xs font-semibold truncate">{sub.name}</span>
                            </label>
                            {isChecked && (
                              <div className="flex items-center gap-1 shrink-0">
                                <input
                                  type="number"
                                  min={1}
                                  max={12}
                                  value={secPeriods}
                                  onChange={e =>
                                    updateLocalSectionConfig({ periodsPerWeek: Number(e.target.value) })
                                  }
                                  className="w-12 px-1.5 py-0.5 text-center font-mono text-[11px] font-bold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white"
                                  title="এই সেকশনের সাপ্তাহিক ক্লাস সংখ্যা"
                                />
                                <span className="text-[10px] text-slate-400">/wk</span>
                              </div>
                            )}
                          </div>

                          {isChecked && (
                            <>
                              <select
                                value={secTeacherId}
                                onChange={e =>
                                  updateLocalSectionConfig({ assignedTeacherId: e.target.value })
                                }
                                className="w-full px-2 py-1 text-[11px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                                title="শুধুমাত্র এই সেকশনের শিক্ষক"
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

                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <span className="text-[10px] text-slate-500 mr-0.5">পিরিয়ড:</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateLocalSectionConfig({
                                      fixedPeriodIndices: hasParentDefault ? [] : undefined,
                                    })
                                  }
                                  className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                                    !effectiveFixed || effectiveFixed.length === 0
                                      ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-900'
                                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  যেকোনো
                                </button>
                                {teachingPeriods.map(tp => {
                                  const isPinned = effectiveFixed?.includes(tp.periodIndex);
                                  return (
                                    <button
                                      key={tp.periodIndex}
                                      type="button"
                                      onClick={() => toggleSecFixed(tp.periodIndex)}
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
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Optional: Enable an additional global subject exclusively for this section */}
                  {subjects.some(
                    s =>
                      s.id !== 'sub-block-play-nur' &&
                      !activeClass.subjectRequirements.some(r => r.subjectId === s.id)
                  ) && (
                    <div className="pt-2.5 border-t border-slate-200 dark:border-slate-700/70 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                        অতিরিক্ত বিষয় যোগ ({activeSection.name}):
                      </span>
                      <select
                        value={extraSubjectId}
                        onChange={e => setExtraSubjectId(e.target.value)}
                        className="flex-1 min-w-[180px] px-2.5 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100"
                      >
                        <option value="">— অন্যান্য বিষয় নির্বাচন করুন —</option>
                        {subjects
                          .filter(
                            s =>
                              s.id !== 'sub-block-play-nur' &&
                              !activeClass.subjectRequirements.some(r => r.subjectId === s.id)
                          )
                          .map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.code})
                            </option>
                          ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={extraPeriods}
                        onChange={e => setExtraPeriods(Number(e.target.value))}
                        className="w-14 px-2 py-1 text-xs text-center font-mono tabular-nums bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg"
                        title="Periods per week"
                      />
                      <button
                        type="button"
                        onClick={handleAddExtraSubjectToSection}
                        disabled={!extraSubjectId}
                        className="px-2.5 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>সেকশনে যোগ</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Subject Allocation & Quota Requirements */}
            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Weekly Subject Requirements for {activeClass.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isPlayNur
                      ? 'প্লে ও নার্সারি শ্রেণিতে কোনো আলাদা বিষয় থাকে না — উপরের ২ জন ব্লক টিচার সকল বিষয় পড়াবেন।'
                      : 'Set how many periods each subject must have per week, and designate preferred teachers (ব্লক টিচার ব্যতীত)।'}
                  </p>
                </div>
                {onOpenSubjectMgmt && !isPlayNur && (
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

              {isPlayNur ? (
                <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 text-xs text-indigo-800 dark:text-indigo-200">
                  <strong>নোট:</strong> {activeClass.name} শ্রেণিতে <strong>"সকল বিষয় (ব্লক টিচার)"</strong> পদ্ধতিতে রুটিন পরিচালিত হয়। কোনো আলাদা সাবজেক্ট বরাদ্দের প্রয়োজন নেই।
                </div>
              ) : (
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
                      {subjects.filter(s => s.id !== 'sub-block-play-nur').map(subject => {
                        const req = activeClass.subjectRequirements.find(r => r.subjectId === subject.id);
                        const currentPeriods = req?.periodsPerWeek || 0;
                        const qualifiedTeachers = teachers.filter(
                          t => !isTeacherBlockTeacher(t, classes) && t.subjectIds.includes(subject.id)
                        );

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
              )}
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
