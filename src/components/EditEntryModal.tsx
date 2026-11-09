import React, { useState, useEffect } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  SchoolClass,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import { X, Check, Trash2, AlertTriangle, Clock, MapPin, User, BookOpen } from 'lucide-react';

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
  onSaveEntry: (entry: TimetableEntry) => void;
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
  onSaveEntry,
  onDeleteEntry,
}) => {
  if (!isOpen) return null;

  const currentClass = classes.find(c => c.id === classId);
  const currentSection = currentClass?.sections.find(s => s.id === sectionId);
  const period = periodTimings.find(p => p.periodIndex === periodIndex);

  // Existing entry for this slot if any
  const existingEntry = entries.find(
    e => e.classId === classId && e.sectionId === sectionId && e.day === day && e.periodIndex === periodIndex
  );

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    existingEntry?.subjectId || currentClass?.subjectRequirements[0]?.subjectId || subjects[0]?.id || ''
  );
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(
    existingEntry?.teacherId || currentClass?.subjectRequirements[0]?.assignedTeacherId || teachers[0]?.id || ''
  );
  const [room, setRoom] = useState<string>(
    existingEntry?.room || currentSection?.roomNumber || ''
  );

  useEffect(() => {
    if (existingEntry) {
      setSelectedSubjectId(existingEntry.subjectId);
      setSelectedTeacherId(existingEntry.teacherId);
      setRoom(existingEntry.room || currentSection?.roomNumber || '');
    } else {
      // Pick default matching subject requirement
      const req = currentClass?.subjectRequirements.find(r => r.subjectId === selectedSubjectId);
      if (req?.assignedTeacherId) {
        setSelectedTeacherId(req.assignedTeacherId);
      }
      setRoom(currentSection?.roomNumber || '');
    }
  }, [existingEntry, classId, sectionId, day, periodIndex]);

  // When subject changes, suggest preferred teacher if configured
  const handleSubjectChange = (newSubjectId: string) => {
    setSelectedSubjectId(newSubjectId);
    const req = currentClass?.subjectRequirements.find(r => r.subjectId === newSubjectId);
    if (req?.assignedTeacherId) {
      setSelectedTeacherId(req.assignedTeacherId);
    } else {
      // find first qualified teacher
      const qualified = teachers.find(t => t.subjectIds.includes(newSubjectId));
      if (qualified) setSelectedTeacherId(qualified.id);
    }
  };

  // Check if selected teacher is busy elsewhere at this exact slot
  const teacherClashEntry = entries.find(
    e =>
      e.teacherId === selectedTeacherId &&
      e.day === day &&
      e.periodIndex === periodIndex &&
      e.id !== existingEntry?.id
  );

  const clashClass = teacherClashEntry ? classes.find(c => c.id === teacherClashEntry.classId) : null;
  const clashSection = clashClass?.sections.find(s => s.id === teacherClashEntry?.sectionId);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubjectId || !selectedTeacherId) return;

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

    onSaveEntry(entryToSave);
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
          {/* Subject Selection */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
              <span>Subject</span>
            </label>
            <select
              value={selectedSubjectId}
              onChange={e => handleSubjectChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {subjects.map(s => {
                const req = currentClass?.subjectRequirements.find(r => r.subjectId === s.id);
                return (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code}) {req ? `— ${req.periodsPerWeek} per week` : ''}
                  </option>
                );
              })}
            </select>
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
                const isClashing = entries.some(
                  e =>
                    e.teacherId === t.id &&
                    e.day === day &&
                    e.periodIndex === periodIndex &&
                    e.id !== existingEntry?.id
                );

                return (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.initials}) - {t.designation} {isClashing ? '⚠️ [BUSY]' : '✓ [Available]'}
                  </option>
                );
              })}
            </select>

            {/* Live Conflict Warning Warning Callout */}
            {teacherClashEntry && (
              <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-300">
                  <strong>Conflict Alert:</strong> This teacher is already scheduled in{' '}
                  <span className="font-semibold">{clashClass?.name} ({clashSection?.name})</span> during this period.
                  Assigning them here will generate a teacher double-booking clash.
                </div>
              </div>
            )}
          </div>

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
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
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
