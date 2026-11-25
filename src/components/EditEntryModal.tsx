import React, { useState, useEffect } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  ProxyLogEntry,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import { X, Check, Trash2, AlertTriangle, MapPin, User, BookOpen, Plus } from 'lucide-react';
import { isSlotDismissed, getTierBadgeInfo } from '../services/scheduleTiers';
import { evaluateAssignmentLimits } from '../services/workloadService';
import {
  AGRICULTURE_ROOM,
  findParallelPartnerSubjectId,
  getCombinedHinduRoom,
  getEffectiveSectionRequirements,
  getEffectiveSubjectFixedPeriods,
  getExpectedSectionTeacherId,
  getMaxReligionConcurrentSections,
  isAgricultureSubject,
  isClassNineOrTen,
  isHigherMathSubject,
  isHinduReligionRoom,
  isHinduReligionSubject,
  isIslamReligionSubject,
  isPlayOrNursery,
  isSubjectSelectedForSection,
  isTeacherBlockedAtSlot,
  isTeacherBlockTeacher,
} from '../services/parallelSubjects';

interface EditEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  classId: string;
  sectionId: string;
  day: DayOfWeek;
  periodIndex: number;
  classes: SchoolClass[];
  teachers: Teacher[];
  subjects: Subject[];
  periodTimings: PeriodTiming[];
  entries: TimetableEntry[];
  proxyLogs?: ProxyLogEntry[];
  settings?: SchoolSettings;
  onSaveEntry: (entry: TimetableEntry, partnerEntry?: TimetableEntry) => void;
  onDeleteEntry: (entryId: string) => void;
}

export const EditEntryModal: React.FC<EditEntryModalProps> = ({
  isOpen,
  onClose,
  classId,
  sectionId,
  day,
  periodIndex,
  classes,
  teachers,
  subjects,
  periodTimings,
  entries,
  proxyLogs = [],
  settings,
  onSaveEntry,
  onDeleteEntry,
}) => {
  const currentClass = classes.find(c => c.id === classId);
  const currentSection = currentClass?.sections.find(s => s.id === sectionId);
  const period = periodTimings.find(p => p.periodIndex === periodIndex);
  const combinedHinduRoom = getCombinedHinduRoom(settings);
  const maxRelConcurrent = getMaxReligionConcurrentSections(settings);

  const isPlayNur = currentClass ? isPlayOrNursery(currentClass) : false;

  // All existing entries for this slot (can be 1 or 2 for parallel classes)
  const slotEntries = entries.filter(
    e => e.classId === classId && e.sectionId === sectionId && e.day === day && e.periodIndex === periodIndex
  );

  const [activeEntryId, setActiveEntryId] = useState<string | null>(slotEntries[0]?.id || null);
  const existingEntry = activeEntryId ? slotEntries.find(e => e.id === activeEntryId) : undefined;

  const defaultBlockSubId =
    subjects.find(s => s.id === 'sub-block-play-nur' || s.code === 'ALL')?.id || subjects[0]?.id || '';
  const defaultBlockTeacherId =
    currentClass?.blockTeacherIds?.[0] ||
    teachers.find(t => t.isBlockTeacher)?.id ||
    teachers[0]?.id ||
    '';

  const nonBlockTeachers = teachers.filter(t => !isTeacherBlockTeacher(t, classes));

  const effectiveReqs =
    currentClass && currentSection && !isPlayNur
      ? getEffectiveSectionRequirements(currentClass, currentSection.id, teachers)
      : [];

  const initialSubId =
    existingEntry?.subjectId ||
    (isPlayNur
      ? defaultBlockSubId
      : effectiveReqs[0]?.subjectId || currentClass?.subjectRequirements[0]?.subjectId || subjects[0]?.id || '');

  const initialSecTeacherId =
    !isPlayNur && currentClass && currentSection && initialSubId
      ? getExpectedSectionTeacherId(currentClass, currentSection.id, initialSubId, teachers)
      : undefined;

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(initialSubId);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(
    existingEntry?.teacherId ||
      (isPlayNur
        ? defaultBlockTeacherId
        : initialSecTeacherId || nonBlockTeachers[0]?.id || teachers[0]?.id || '')
  );
  const [room, setRoom] = useState<string>(
    existingEntry?.room || currentSection?.roomNumber || ''
  );

  // Automatic parallel pairing (especially Higher Math + Agriculture in Class 9 & 10), only if partner is selected for this section
  const isNineOrTen = currentClass ? isClassNineOrTen(currentClass) : false;
  const effectiveGradeForParallel = isNineOrTen ? Math.max(9, currentClass?.numericGrade || 9) : currentClass?.numericGrade;
  const rawSelectedPartnerId =
    !isPlayNur && slotEntries.length === 0
      ? findParallelPartnerSubjectId(selectedSubjectId, subjects, effectiveGradeForParallel)
      : null;
  const selectedPartnerSubjectId =
    rawSelectedPartnerId &&
    currentClass &&
    currentSection &&
    isSubjectSelectedForSection(currentClass, currentSection.id, rawSelectedPartnerId)
      ? rawSelectedPartnerId
      : null;
  const selectedPartnerSubject = selectedPartnerSubjectId
    ? subjects.find(s => s.id === selectedPartnerSubjectId) || null
    : null;

  const findDefaultPartnerTeacherId = (partnerSubId: string | null): string => {
    if (!partnerSubId) return '';
    if (currentClass && currentSection) {
      const expected = getExpectedSectionTeacherId(currentClass, currentSection.id, partnerSubId, teachers);
      if (expected) return expected;
    }
    const qualified = nonBlockTeachers.find(
      t =>
        t.id !== selectedTeacherId &&
        t.subjectIds.includes(partnerSubId) &&
        !entries.some(e => e.teacherId === t.id && e.day === day && e.periodIndex === periodIndex)
    );
    return qualified?.id || nonBlockTeachers.find(t => t.subjectIds.includes(partnerSubId))?.id || '';
  };

  const resolveSubjectRoom = (subId: string, fallback: string = currentSection?.roomNumber || ''): string => {
    if (isHinduReligionSubject(subId, subjects)) return combinedHinduRoom;
    if (isAgricultureSubject(subId, subjects)) return AGRICULTURE_ROOM;
    return fallback;
  };

  const [autoPairEnabled, setAutoPairEnabled] = useState<boolean>(Boolean(selectedPartnerSubjectId));
  const [selectedPartnerTeacherId, setSelectedPartnerTeacherId] = useState<string>(() =>
    findDefaultPartnerTeacherId(selectedPartnerSubjectId)
  );
  const [overrideConfirmed, setOverrideConfirmed] = useState<boolean>(false);

  useEffect(() => {
    if (existingEntry) {
      setSelectedSubjectId(existingEntry.subjectId);
      setSelectedTeacherId(existingEntry.teacherId);
      setRoom(existingEntry.room || currentSection?.roomNumber || '');
    } else if (!activeEntryId && slotEntries.length > 0) {
      // Adding parallel partner mode — pre-select partner subject if available
      const partnerId = findParallelPartnerSubjectId(
        slotEntries[0].subjectId,
        subjects,
        effectiveGradeForParallel
      );
      if (partnerId) {
        setSelectedSubjectId(partnerId);
        const expected =
          currentClass && currentSection
            ? getExpectedSectionTeacherId(currentClass, currentSection.id, partnerId, teachers)
            : undefined;
        if (expected) {
          setSelectedTeacherId(expected);
        } else {
          const qualified = nonBlockTeachers.find(t => t.subjectIds.includes(partnerId));
          if (qualified) setSelectedTeacherId(qualified.id);
        }
        setRoom(resolveSubjectRoom(partnerId));
      } else {
        setRoom(currentSection?.roomNumber || '');
      }
    } else if (isPlayNur) {
      setSelectedSubjectId(defaultBlockSubId);
      setSelectedTeacherId(defaultBlockTeacherId);
      setRoom(currentSection?.roomNumber || '');
    } else {
      const expected =
        currentClass && currentSection
          ? getExpectedSectionTeacherId(currentClass, currentSection.id, selectedSubjectId, teachers)
          : undefined;
      if (expected) {
        setSelectedTeacherId(expected);
      }
      setRoom(resolveSubjectRoom(selectedSubjectId));
    }
    setOverrideConfirmed(false);
  }, [activeEntryId, classId, sectionId, day, periodIndex]);

  if (!isOpen) return null;

  // If this period is locked as Tiffin Break, prevent scheduling
  if (period?.isBreak || period?.isLocked) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-amber-200 dark:border-amber-900/80 shadow-xl w-full max-w-md p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 mx-auto flex items-center justify-center text-xl shadow-xs">
            ☕
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              টিফিন বিরতি (লক পিরিয়ড 🔒)
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {period.label} ({period.startTime} - {period.endTime}) একটি সংরক্ষিত টিফিন বিরতি। স্কুল নীতি অনুযায়ী এই পিরিয়ডে কোনো ক্লাস শিডিউল করা সম্ভব নয়।
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-full py-2.5 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 rounded-xl"
          >
            ঠিক আছে, বন্ধ করুন
          </button>
        </div>
      </div>
    );
  }

  // If this slot is dismissed for this class according to school tier rules
  if (currentClass && isSlotDismissed(currentClass, day, periodIndex, sectionId, settings?.workingDays)) {
    const tier = getTierBadgeInfo(currentClass, sectionId, settings?.workingDays);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-indigo-200 dark:border-indigo-900/80 shadow-xl w-full max-w-md p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 mx-auto flex items-center justify-center text-xl shadow-xs">
            🏠
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {currentClass.name} - ছুটি (Class Dismissed)
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              স্কুলের নীতিমালা অনুযায়ী {currentClass.name}-এর ক্লাস এই সময়ে সমাপ্ত থাকে ({tier.label})।
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-full py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl"
          >
            ঠিক আছে, বন্ধ করুন
          </button>
        </div>
      </div>
    );
  }

  // When subject changes, suggest section-specific teacher & parallel partner teacher
  const handleSubjectChange = (newSubjectId: string) => {
    setSelectedSubjectId(newSubjectId);
    if (isPlayNur) {
      setSelectedTeacherId(defaultBlockTeacherId);
      return;
    }
    if (isHinduReligionSubject(newSubjectId, subjects)) {
      setRoom(combinedHinduRoom);
    } else if (isAgricultureSubject(newSubjectId, subjects)) {
      setRoom(AGRICULTURE_ROOM);
    } else if (isHinduReligionRoom(room, settings) || room === AGRICULTURE_ROOM) {
      setRoom(currentSection?.roomNumber || '');
    }
    const expectedId =
      currentClass && currentSection
        ? getExpectedSectionTeacherId(currentClass, currentSection.id, newSubjectId, teachers)
        : undefined;
    const prefTeacher = expectedId ? teachers.find(t => t.id === expectedId) : undefined;
    if (prefTeacher && !isTeacherBlockTeacher(prefTeacher, classes)) {
      setSelectedTeacherId(prefTeacher.id);
    } else {
      const qualified = nonBlockTeachers.find(t => t.subjectIds.includes(newSubjectId));
      if (qualified) setSelectedTeacherId(qualified.id);
    }

    const nextPartnerId =
      slotEntries.length === 0
        ? findParallelPartnerSubjectId(newSubjectId, subjects, effectiveGradeForParallel)
        : null;
    if (nextPartnerId) {
      setAutoPairEnabled(true);
      setSelectedPartnerTeacherId(findDefaultPartnerTeacherId(nextPartnerId));
    } else {
      setAutoPairEnabled(false);
      setSelectedPartnerTeacherId('');
    }
  };

  // Helper: is an existing slot entry compatible with Combined Hindu Room sharing?
  const isHinduSlotCompatible = (tId: string, subId: string, slotRoom: string | undefined): boolean => {
    if (!isHinduReligionSubject(subId, subjects) || !isHinduReligionRoom(slotRoom, settings)) return false;
    const otherEntries = entries.filter(
      e =>
        e.teacherId === tId &&
        e.day === day &&
        e.periodIndex === periodIndex &&
        e.id !== existingEntry?.id
    );
    if (otherEntries.length === 0) return true;
    const allHindu = otherEntries.every(
      e => isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)
    );
    return allHindu && otherEntries.length < maxRelConcurrent;
  };

  // Check if selected teacher is busy elsewhere at this exact slot (exempting Combined Hindu Room 307 <= 3 sections)
  const slotTeacherOtherEntries = entries.filter(
    e =>
      e.teacherId === selectedTeacherId &&
      e.day === day &&
      e.periodIndex === periodIndex &&
      e.id !== existingEntry?.id
  );
  const teacherClashEntry = isHinduSlotCompatible(selectedTeacherId, selectedSubjectId, room)
    ? undefined
    : slotTeacherOtherEntries[0];

  const selectedTeacherObj = teachers.find(t => t.id === selectedTeacherId);
  const blockTeacherViolation = Boolean(
    !isPlayNur && selectedTeacherObj && isTeacherBlockTeacher(selectedTeacherObj, classes)
  );

  const teacherWorkloadEval = selectedTeacherObj
    ? evaluateAssignmentLimits({
        mode: 'regular',
        teacher: selectedTeacherObj,
        day,
        periodIndex,
        entries,
        proxyLogs,
        ignoreEntryId: existingEntry?.id,
      })
    : null;
  const requiresWorkloadOverride = Boolean(
    teacherWorkloadEval && teacherWorkloadEval.hasOverloadWarning && !blockTeacherViolation
  );

  // Check max-1-per-day per subject & exact weekly quota limits (KG - Class 10)
  const selectedSubjectObj = subjects.find(s => s.id === selectedSubjectId);
  const selectedSubjectReq = effectiveReqs.find(r => r.subjectId === selectedSubjectId);
  const unselectedSubjectViolation = Boolean(
    !isPlayNur &&
      currentClass &&
      currentSection &&
      selectedSubjectId &&
      !isSubjectSelectedForSection(currentClass, currentSection.id, selectedSubjectId)
  );
  const otherWeeklySubjectCount = entries.filter(
    e =>
      e.classId === classId &&
      e.sectionId === sectionId &&
      e.subjectId === selectedSubjectId &&
      e.id !== existingEntry?.id
  ).length;

  const sameDaySubjectConflict =
    !isPlayNur &&
    Boolean(
      entries.find(
        e =>
          e.classId === classId &&
          e.sectionId === sectionId &&
          e.day === day &&
          e.id !== existingEntry?.id &&
          (e.subjectId === selectedSubjectId ||
            (slotEntries.length === 0 &&
              autoPairEnabled &&
              selectedPartnerSubjectId &&
              e.subjectId === selectedPartnerSubjectId))
      )
    );

  let effectiveWeeklyLimit = selectedSubjectReq?.periodsPerWeek;
  if (!isPlayNur && currentClass && effectiveWeeklyLimit !== undefined) {
    const hasHmt =
      isClassNineOrTen(currentClass) &&
      effectiveReqs.some(r => isHigherMathSubject(r.subjectId, subjects));
    if (hasHmt && isAgricultureSubject(selectedSubjectId, subjects)) {
      const hmtReq = effectiveReqs.find(r => isHigherMathSubject(r.subjectId, subjects));
      if (hmtReq) effectiveWeeklyLimit = Math.max(effectiveWeeklyLimit, hmtReq.periodsPerWeek);
    }
  }

  const weeklyOverQuotaViolation = Boolean(
    !isPlayNur &&
      effectiveWeeklyLimit !== undefined &&
      otherWeeklySubjectCount + 1 > effectiveWeeklyLimit
  );

  const allowedFixedPeriods =
    !isPlayNur && currentClass && currentSection && selectedSubjectId
      ? getEffectiveSubjectFixedPeriods(currentClass, currentSection.id, selectedSubjectId, subjects)
      : undefined;
  const fixedPeriodViolation = Boolean(
    allowedFixedPeriods && allowedFixedPeriods.length > 0 && !allowedFixedPeriods.includes(periodIndex)
  );
  const teacherBlockedAtSlot = Boolean(
    selectedTeacherObj && isTeacherBlockedAtSlot(selectedTeacherObj, day, periodIndex)
  );

  const clashClass = teacherClashEntry ? classes.find(c => c.id === teacherClashEntry.classId) : null;
  const clashSection = clashClass?.sections.find(s => s.id === teacherClashEntry?.sectionId);

  // Check if current slot supports adding a parallel partner (only if partner is selected for this section!)
  const rawParallelPartnerId =
    slotEntries.length === 1
      ? findParallelPartnerSubjectId(slotEntries[0].subjectId, subjects, effectiveGradeForParallel)
      : null;
  const parallelPartnerId =
    rawParallelPartnerId && currentClass && currentSection && isSubjectSelectedForSection(currentClass, currentSection.id, rawParallelPartnerId)
      ? rawParallelPartnerId
      : null;
  const canAddParallelPartner = !isPlayNur && slotEntries.length === 1 && Boolean(parallelPartnerId);
  const parallelPartnerSub = parallelPartnerId ? subjects.find(s => s.id === parallelPartnerId) : null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubjectId || !selectedTeacherId) return;
    if (
      blockTeacherViolation ||
      unselectedSubjectViolation ||
      sameDaySubjectConflict ||
      weeklyOverQuotaViolation ||
      (requiresWorkloadOverride && !overrideConfirmed)
    ) {
      return;
    }

    const entryToSave: TimetableEntry = {
      id: existingEntry?.id || `entry-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      classId,
      sectionId,
      day,
      periodIndex,
      subjectId: selectedSubjectId,
      teacherId: selectedTeacherId,
      room: room.trim() || undefined,
    };

    let partnerEntryToSave: TimetableEntry | undefined;
    if (slotEntries.length === 0 && autoPairEnabled && selectedPartnerSubjectId && selectedPartnerTeacherId) {
      partnerEntryToSave = {
        id: `entry-par-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        classId,
        sectionId,
        day,
        periodIndex,
        subjectId: selectedPartnerSubjectId,
        teacherId: selectedPartnerTeacherId,
        room: resolveSubjectRoom(
          selectedPartnerSubjectId,
          room.trim() || currentSection?.roomNumber || ''
        ) || undefined,
      };
    }

    onSaveEntry(entryToSave, partnerEntryToSave);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {existingEntry ? 'Edit Class Schedule' : 'Assign Class Period'}
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
              <span className="font-semibold text-blue-700 dark:text-blue-400">
                {currentClass?.name} ({currentSection?.name})
              </span>
              <span>•</span>
              <span>{day}</span>
              <span>•</span>
              <span>{period?.label || `Period ${periodIndex}`} ({period?.startTime} - {period?.endTime})</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {/* Parallel Entry Switcher (for HMT+AGR or Islam+Hindu Religion in same slot) */}
          {(slotEntries.length > 1 || canAddParallelPartner) && (
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 space-y-2">
              <div className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
                একই পিরিয়ডে সমান্তরাল (Parallel) ক্লাস:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {slotEntries.map(se => {
                  const sub = subjects.find(s => s.id === se.subjectId);
                  const isActive = activeEntryId === se.id;
                  return (
                    <button
                      key={se.id}
                      type="button"
                      onClick={() => setActiveEntryId(se.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-indigo-200 dark:border-indigo-800'
                      }`}
                    >
                      {sub?.name || se.subjectId}
                    </button>
                  );
                })}
                {canAddParallelPartner && parallelPartnerSub && (
                  <button
                    type="button"
                    onClick={() => setActiveEntryId(null)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
                      activeEntryId === null
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                    }`}
                  >
                    <Plus className="w-3 h-3" />
                    <span>{parallelPartnerSub.name} যুক্ত করুন</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Subject Selection */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
              <span>Subject {isPlayNur ? '(ব্লক পদ্ধতি)' : ''}</span>
            </label>
            <select
              value={selectedSubjectId}
              onChange={e => handleSubjectChange(e.target.value)}
              disabled={isPlayNur}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-75"
            >
              {(isPlayNur
                ? subjects.filter(s => s.id === defaultBlockSubId)
                : subjects.filter(s => {
                    if (s.id === 'sub-block-play-nur') return false;
                    if (existingEntry?.subjectId === s.id) return true;
                    if (!currentClass || !currentSection) return true;
                    return isSubjectSelectedForSection(currentClass, currentSection.id, s.id);
                  })
              ).map(s => {
                const req = effectiveReqs.find(r => r.subjectId === s.id);
                const isSelectedForSec =
                  isPlayNur ||
                  (currentClass && currentSection
                    ? isSubjectSelectedForSection(currentClass, currentSection.id, s.id)
                    : true);
                return (
                  <option key={s.id} value={s.id} disabled={!isSelectedForSec}>
                    {s.name} ({s.code}) {req ? `— ${req.periodsPerWeek} per week` : !isSelectedForSec ? '— [সেকশনে অনির্বাচিত]' : ''}
                  </option>
                );
              })}
            </select>
            {isPlayNur && (
              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1">
                প্লে ও নার্সারি শ্রেণিতে কোনো আলাদা সাবজেক্ট থাকে না — ব্লক টিচার সকল বিষয় পড়ান।
              </p>
            )}
            {!isPlayNur && effectiveWeeklyLimit !== undefined && (
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>সাপ্তাহিক পিরিয়ড কোটা:</span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    weeklyOverQuotaViolation
                      ? 'text-rose-600 dark:text-rose-400'
                      : otherWeeklySubjectCount + 1 === effectiveWeeklyLimit
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {otherWeeklySubjectCount + 1} / {effectiveWeeklyLimit}
                </span>
              </div>
            )}
            {unselectedSubjectViolation && (
              <div className="mt-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-800 dark:text-rose-300">
                  <strong>সেকশনে অনির্বাচিত বিষয়:</strong> "{selectedSubjectObj?.name}" বিষয়টি {currentClass?.name} ({currentSection?.name})-এর জন্য নির্বাচিত নয়। অনির্বাচিত বিষয় রুটিনে যুক্ত করা যাবে না।
                </div>
              </div>
            )}
            {sameDaySubjectConflict && (
              <div className="mt-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-800 dark:text-rose-300">
                  <strong>একই দিনে পুনরাবৃত্তি নিষিদ্ধ:</strong> {day} দিনে "{selectedSubjectObj?.name}" (অথবা এর সমান্তরাল বিষয়) ইতোমধ্যেই নির্ধারিত আছে। একই দিনে একটি বিষয় একবারের বেশি দেওয়া যাবে না।
                </div>
              </div>
            )}
            {weeklyOverQuotaViolation && !sameDaySubjectConflict && (
              <div className="mt-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-800 dark:text-rose-300">
                  <strong>সাপ্তাহিক কোটা অতিক্রম:</strong> "{selectedSubjectObj?.name}" সপ্তাহে সর্বোচ্চ {effectiveWeeklyLimit}টি নির্ধারিত আছে — এর বেশি ক্লাস দেওয়া যাবে না।
                </div>
              </div>
            )}
            {fixedPeriodViolation && allowedFixedPeriods && (
              <div className="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-300">
                  <strong>নির্দিষ্ট পিরিয়ড সতর্কতা:</strong> "{selectedSubjectObj?.name}" বিষয়টি শুধুমাত্র{' '}
                  <span className="font-mono font-bold">
                    {allowedFixedPeriods.map(p => `P${p}`).join(', ')}
                  </span>{' '}
                  পিরিয়ডে রাখার জন্য নির্ধারিত রয়েছে।
                </div>
              </div>
            )}
          </div>

          {/* Teacher Selection */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-blue-600" />
              <span>Assigned Teacher</span>
            </label>
            <select
              value={selectedTeacherId}
              onChange={e => setSelectedTeacherId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {teachers.map(t => {
                const slotMatches = entries.filter(
                  e =>
                    e.teacherId === t.id &&
                    e.day === day &&
                    e.periodIndex === periodIndex &&
                    e.id !== existingEntry?.id
                );
                const compatibleHindu = isHinduSlotCompatible(t.id, selectedSubjectId, room);
                const isClashing = slotMatches.length > 0 && !compatibleHindu;
                const isCombinedRoomShare = slotMatches.length > 0 && compatibleHindu;
                const isClassBlockTeacher = Boolean(isPlayNur && currentClass?.blockTeacherIds?.includes(t.id));
                const isAnyBlockTeacher = isTeacherBlockTeacher(t, classes);
                const isBlockedHere = isTeacherBlockedAtSlot(t, day, periodIndex);

                return (
                  <option key={t.id} value={t.id} disabled={!isPlayNur && isAnyBlockTeacher}>
                    {t.name} ({t.initials}) - {t.designation}{' '}
                    {isClassBlockTeacher
                      ? isBlockedHere
                        ? '⭐ [ব্লক শিক্ষক · ⛔ বন্ধ পিরিয়ড]'
                        : '⭐ [ব্লক শিক্ষক]'
                      : !isPlayNur && isAnyBlockTeacher
                      ? '🚫 [ব্লক টিচার - অন্য ক্লাসে নিষিদ্ধ]'
                      : isBlockedHere
                      ? '⛔ [বন্ধ পিরিয়ড]'
                      : isCombinedRoomShare
                      ? `🕌 [Combined ${combinedHinduRoom} · ${slotMatches.length}/${maxRelConcurrent}]`
                      : isClashing
                      ? '⚠️ [BUSY]'
                      : '✓ [Available]'}
                  </option>
                );
              })}
            </select>

            {blockTeacherViolation && (
              <div className="mt-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-800 dark:text-rose-300">
                  <strong>প্রাতিষ্ঠানিক নীতি লঙ্ঘন:</strong> {selectedTeacherObj?.name} একজন প্লে/নার্সারি ব্লক টিচার। তাঁকে অন্য কোনো শ্রেণিতে ক্লাস দেওয়া যাবে না। অনুগ্রহ করে অন্য শিক্ষক নির্বাচন করুন।
                </div>
              </div>
            )}

            {teacherBlockedAtSlot && !blockTeacherViolation && (
              <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-300">
                  <strong>বন্ধ/অবসর পিরিয়ড সতর্কতা:</strong> {selectedTeacherObj?.name}-এর জন্য {day} (Period {periodIndex}) বন্ধ নির্ধারিত রয়েছে। এখানে যুক্ত করলে অডিটে কনফ্লিক্ট হিসেবে চিহ্নিত হবে।
                </div>
              </div>
            )}

            {/* Live Conflict Warning Callout */}
            {teacherClashEntry && !blockTeacherViolation && (
              <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-300">
                  <strong>Conflict Alert:</strong> This teacher is already scheduled in{' '}
                  <span className="font-semibold">{clashClass?.name} ({clashSection?.name})</span> during this period.
                  Assigning them here will generate a teacher double-booking clash.
                </div>
              </div>
            )}

            {/* Weekly + Daily + Consecutive Workload Warning & Override Confirmation */}
            {teacherWorkloadEval && !blockTeacherViolation && teacherWorkloadEval.warnings.filter(w => w.code !== 'blocked_slot').length > 0 && (
              <div
                className={`mt-2 p-3 rounded-lg border space-y-2 ${
                  teacherWorkloadEval.hasOverloadWarning
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/80'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80'
                }`}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      teacherWorkloadEval.hasOverloadWarning ? 'text-rose-600' : 'text-amber-600'
                    }`}
                  />
                  <div
                    className={`text-xs space-y-1 ${
                      teacherWorkloadEval.hasOverloadWarning
                        ? 'text-rose-800 dark:text-rose-200'
                        : 'text-amber-800 dark:text-amber-200'
                    }`}
                  >
                    <div className="font-bold">
                      সাপ্তাহিক লোড সতর্কতা ({teacherWorkloadEval.projectedWeekly}/{teacherWorkloadEval.weeklyMax} ক্লাস · নিয়মিত {teacherWorkloadEval.regularWeeklyPeriods} + প্রক্সি {teacherWorkloadEval.proxyWeeklyPeriods})
                    </div>
                    {teacherWorkloadEval.warnings
                      .filter(w => w.code !== 'blocked_slot')
                      .map((w, idx) => (
                        <div key={idx}>• {w.message}</div>
                      ))}
                  </div>
                </div>

                {requiresWorkloadOverride && (
                  <label className="flex items-start gap-2 pt-1.5 border-t border-rose-200/80 dark:border-rose-800/60 text-xs font-semibold text-rose-900 dark:text-rose-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideConfirmed}
                      onChange={e => setOverrideConfirmed(e.target.checked)}
                      className="mt-0.5 rounded text-rose-600 focus:ring-rose-500"
                    />
                    <span>লিমিট অতিক্রম করার পরেও এডমিন ওভাররাইড হিসেবে সংরক্ষণ করতে সম্মত</span>
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Auto-Pair Parallel Subject Panel (Class 9-10 HMT+AGR or KG-10 Islam+Hindu) */}
          {slotEntries.length === 0 && selectedPartnerSubject && (
            <div className="p-3 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 space-y-2.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-indigo-950 dark:text-indigo-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPairEnabled}
                  onChange={e => {
                    const checked = e.target.checked;
                    setAutoPairEnabled(checked);
                    if (checked && !selectedPartnerTeacherId) {
                      setSelectedPartnerTeacherId(findDefaultPartnerTeacherId(selectedPartnerSubject.id));
                    }
                  }}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span>
                  একই পিরিয়ডে সমান্তরাল বিষয় ({selectedPartnerSubject.name}) একসাথে নির্ধারণ করুন
                </span>
              </label>

              {autoPairEnabled && (
                <div>
                  <label className="block text-[11px] font-medium text-indigo-800 dark:text-indigo-300 mb-1">
                    {selectedPartnerSubject.name}-এর শিক্ষক নির্বাচন:
                  </label>
                  <select
                    value={selectedPartnerTeacherId}
                    onChange={e => setSelectedPartnerTeacherId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {nonBlockTeachers
                      .filter(t => t.id !== selectedTeacherId)
                      .map(t => {
                        const partnerSlotMatches = entries.filter(
                          e => e.teacherId === t.id && e.day === day && e.periodIndex === periodIndex
                        );
                        const compatibleHinduPartner = isHinduSlotCompatible(
                          t.id,
                          selectedPartnerSubject.id,
                          resolveSubjectRoom(selectedPartnerSubject.id)
                        );
                        const isBusy = partnerSlotMatches.length > 0 && !compatibleHinduPartner;
                        const isPartnerBlocked = isTeacherBlockedAtSlot(t, day, periodIndex);
                        return (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.initials}){' '}
                            {isPartnerBlocked
                              ? '⛔ [বন্ধ পিরিয়ড]'
                              : partnerSlotMatches.length > 0 && compatibleHinduPartner
                              ? `🕌 [Combined ${combinedHinduRoom} · ${partnerSlotMatches.length}/${maxRelConcurrent}]`
                              : isBusy
                              ? '⚠️ [BUSY]'
                              : '✓ [Available]'}
                          </option>
                        );
                      })}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Room Number */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              <span>Room / Location</span>
            </label>
            <input
              type="text"
              value={room}
              onChange={e => setRoom(e.target.value)}
              placeholder="e.g. Room 404, Science Lab, Ground"
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            {existingEntry ? (
              <button
                type="button"
                onClick={() => {
                  onDeleteEntry(existingEntry.id);
                  onClose();
                }}
                className="px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>Remove Slot</span>
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  blockTeacherViolation ||
                  unselectedSubjectViolation ||
                  sameDaySubjectConflict ||
                  weeklyOverQuotaViolation ||
                  (requiresWorkloadOverride && !overrideConfirmed)
                }
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
              >
                <Check className="w-4 h-4" />
                <span>Save & Sync</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
