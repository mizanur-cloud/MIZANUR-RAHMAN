/**
 * Smart School Routine Management System
 * Class-wise & Teacher-wise routine generator with bidirectional synchronization,
 * conflict prevention, Classes 1-10 management, and DOCX/PDF/Excel exports.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  DayOfWeek,
  PeriodTiming,
  RoutineConflict,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from './types';
import {
  AppState,
  loadStoredData,
  resetToDefaults,
  saveStoredData,
} from './services/storage';
import { detectAllConflicts } from './services/conflictDetector';
import { generateSmartTimetable, GenerationOptions, GenerationResult } from './services/routineGenerator';

// Components
import { Navbar } from './components/Navbar';
import { ClassRoutineView } from './components/ClassRoutineView';
import { TeacherRoutineView } from './components/TeacherRoutineView';
import { MasterTimetableView } from './components/MasterTimetableView';
import { EditEntryModal } from './components/EditEntryModal';
import { AutoGenerateModal } from './components/AutoGenerateModal';
import { ExportModal } from './components/ExportModal';
import { ClassManagementModal } from './components/ClassManagementModal';
import { TeacherManagementModal } from './components/TeacherManagementModal';
import { SettingsModal } from './components/SettingsModal';
import { ConflictModal } from './components/ConflictModal';
import { ProxyRoutineView } from './components/ProxyRoutineView';
import { SmartImportModal } from './components/SmartImportModal';
import { SubjectManagementModal } from './components/SubjectManagementModal';

import {
  AlertTriangle,
  Sparkles,
  Download,
  Calendar,
  Users,
  Grid3X3,
  ShieldAlert,
  ArrowRight,
  School,
  CheckCircle2,
} from 'lucide-react';

export default function App() {
  // Primary application state
  const [data, setData] = useState<AppState>(() => loadStoredData());

  // Active view tab
  const [activeTab, setActiveTab] = useState<'classes' | 'teachers' | 'master' | 'proxy' | 'conflicts'>('classes');

  // Selected class and section
  const [selectedClassId, setSelectedClassId] = useState<string>(() => data.classes[0]?.id || 'cls-play');
  const [selectedSectionId, setSelectedSectionId] = useState<string>(() => {
    const cls = data.classes[0];
    return cls?.sections[0]?.id || 'sec-play-a';
  });

  // Selected teacher
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(() => data.teachers[0]?.id || 'tch-rahman');

  // Modals state
  const [isAutoGenerateOpen, setIsAutoGenerateOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isSmartImportOpen, setIsSmartImportOpen] = useState(false);
  const [isClassMgmtOpen, setIsClassMgmtOpen] = useState(false);
  const [isTeacherMgmtOpen, setIsTeacherMgmtOpen] = useState(false);
  const [isSubjectMgmtOpen, setIsSubjectMgmtOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);

  // Edit slot modal
  const [editSlot, setEditSlot] = useState<{
    classId: string;
    sectionId: string;
    day: DayOfWeek;
    periodIndex: number;
  } | null>(null);

  // Auto-save to localStorage whenever data changes
  useEffect(() => {
    saveStoredData(data);
  }, [data]);

  // Compute live conflicts across the entire school timetable
  const activeTeachingPeriodIndices = useMemo(() => {
    return data.settings.periodTimings.filter(p => !p.isBreak).map(p => p.periodIndex);
  }, [data.settings.periodTimings]);

  const conflicts: RoutineConflict[] = useMemo(() => {
    return detectAllConflicts(
      data.entries,
      data.teachers,
      data.classes,
      data.settings.workingDays,
      activeTeachingPeriodIndices
    );
  }, [data.entries, data.teachers, data.classes, data.settings.workingDays, activeTeachingPeriodIndices]);

  // Update entry in central database (enforces 100% bidirectional sync)
  const handleSaveEntry = (newEntry: TimetableEntry) => {
    setData(prev => {
      // Remove any previous entry in this class & section & day & periodIndex
      const filtered = prev.entries.filter(
        e => !(e.classId === newEntry.classId && e.sectionId === newEntry.sectionId && e.day === newEntry.day && e.periodIndex === newEntry.periodIndex)
      );
      return {
        ...prev,
        entries: [...filtered, newEntry],
      };
    });
  };

  const handleClearSlot = (entryId: string) => {
    setData(prev => ({
      ...prev,
      entries: prev.entries.filter(e => e.id !== entryId),
    }));
  };

  const handleClearSection = (classId: string, sectionId: string) => {
    setData(prev => ({
      ...prev,
      entries: prev.entries.filter(e => !(e.classId === classId && e.sectionId === sectionId)),
    }));
  };

  // Quick auto-generate helpers
  const handleAutoGenerateSection = (classId: string, sectionId: string) => {
    const result = generateSmartTimetable(
      data.classes,
      data.teachers,
      data.settings.workingDays,
      data.settings.periodTimings,
      data.entries,
      {
        scope: 'section',
        targetClassId: classId,
        targetSectionId: sectionId,
        preserveLockedEntries: false,
        maxConsecutiveLimit: 2,
      }
    );
    setData(prev => ({ ...prev, entries: result.entries }));
  };

  const handleAutoGenerateClass = (classId: string) => {
    const result = generateSmartTimetable(
      data.classes,
      data.teachers,
      data.settings.workingDays,
      data.settings.periodTimings,
      data.entries,
      {
        scope: 'class',
        targetClassId: classId,
        preserveLockedEntries: false,
        maxConsecutiveLimit: 2,
      }
    );
    setData(prev => ({ ...prev, entries: result.entries }));
  };

  const handleExecuteGenerate = (options: GenerationOptions): GenerationResult => {
    const result = generateSmartTimetable(
      data.classes,
      data.teachers,
      data.settings.workingDays,
      data.settings.periodTimings,
      data.entries,
      options
    );
    setData(prev => ({ ...prev, entries: result.entries }));
    return result;
  };

  const handleResetToDefaults = () => {
    const fresh = resetToDefaults();
    setData(fresh);
    setSelectedClassId(fresh.classes[7]?.id || fresh.classes[0].id);
    setSelectedSectionId(fresh.classes[7]?.sections[0]?.id || fresh.classes[0].sections[0].id);
    setSelectedTeacherId(fresh.teachers[0].id);
  };

  const handleApplyImport = (
    importedClasses: SchoolClass[],
    importedTeachers: Teacher[],
    importedSubjects: Subject[],
    importedEntries: TimetableEntry[],
    mode: 'merge' | 'replace',
    newSchoolName?: string
  ) => {
    setData(prev => {
      const updatedSettings = newSchoolName && newSchoolName.trim()
        ? { ...prev.settings, schoolName: newSchoolName.trim() }
        : prev.settings;

      if (mode === 'replace') {
        return {
          classes: importedClasses,
          teachers: importedTeachers,
          subjects: importedSubjects,
          entries: importedEntries,
          settings: updatedSettings,
        };
      } else {
        const existingKeys = new Set(
          importedEntries.map(e => `${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`)
        );
        const kept = prev.entries.filter(
          e => !existingKeys.has(`${e.classId}_${e.sectionId}_${e.day}_${e.periodIndex}`)
        );
        return {
          classes: importedClasses,
          teachers: importedTeachers,
          subjects: importedSubjects,
          entries: [...kept, ...importedEntries],
          settings: updatedSettings,
        };
      }
    });

    if (importedClasses.length > 0) {
      setSelectedClassId(importedClasses[0].id);
      if (importedClasses[0].sections[0]) {
        setSelectedSectionId(importedClasses[0].sections[0].id);
      }
    }
    if (importedTeachers.length > 0) {
      setSelectedTeacherId(importedTeachers[0].id);
    }
  };

  const handleImportBackup = (newState: AppState) => {
    setData(newState);
    if (newState.classes[0]) setSelectedClassId(newState.classes[0].id);
    if (newState.teachers[0]) setSelectedTeacherId(newState.teachers[0].id);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col font-sans transition-colors">
      {/* Top 3-Zone Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        conflictCount={conflicts.length}
        schoolName={data.settings.schoolName}
        academicYear={data.settings.academicYear}
        onOpenAutoGenerate={() => setIsAutoGenerateOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenSmartImport={() => setIsSmartImportOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenClassMgmt={() => setIsClassMgmtOpen(true)}
        onOpenTeacherMgmt={() => setIsTeacherMgmtOpen(true)}
        onOpenSubjectMgmt={() => setIsSubjectMgmtOpen(true)}
        onReset={handleResetToDefaults}
      />

      {/* Persistent Conflict Alert Banner if collisions detected */}
      {conflicts.length > 0 && activeTab !== 'conflicts' && (
        <div className="bg-amber-500/10 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-800/80 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>{conflicts.length} schedule conflict{conflicts.length > 1 ? 's' : ''} detected:</strong>{' '}
                {conflicts[0].title}.
              </span>
            </div>
            <button
              onClick={() => setActiveTab('conflicts')}
              className="text-amber-800 dark:text-amber-300 font-bold hover:underline flex items-center gap-1 shrink-0"
            >
              <span>View & Resolve All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Canvas */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Tab 1: Class Routine Management */}
        {activeTab === 'classes' && (
          <ClassRoutineView
            classes={data.classes}
            selectedClassId={selectedClassId}
            setSelectedClassId={setSelectedClassId}
            selectedSectionId={selectedSectionId}
            setSelectedSectionId={setSelectedSectionId}
            subjects={data.subjects}
            teachers={data.teachers}
            workingDays={data.settings.workingDays}
            periodTimings={data.settings.periodTimings}
            entries={data.entries}
            conflicts={conflicts}
            onOpenEditSlot={(classId, sectionId, day, periodIndex) =>
              setEditSlot({ classId, sectionId, day, periodIndex })
            }
            onClearSlot={handleClearSlot}
            onClearSection={handleClearSection}
            onAutoGenerateSection={handleAutoGenerateSection}
            onAutoGenerateClass={handleAutoGenerateClass}
            onOpenSubjectMgmt={() => setIsSubjectMgmtOpen(true)}
            fullAppState={data}
          />
        )}

        {/* Tab 2: Teacher Routine Management */}
        {activeTab === 'teachers' && (
          <TeacherRoutineView
            teachers={data.teachers}
            selectedTeacherId={selectedTeacherId}
            setSelectedTeacherId={setSelectedTeacherId}
            classes={data.classes}
            subjects={data.subjects}
            workingDays={data.settings.workingDays}
            periodTimings={data.settings.periodTimings}
            entries={data.entries}
            conflicts={conflicts}
            onOpenEditSlot={(classId, sectionId, day, periodIndex) =>
              setEditSlot({ classId, sectionId, day, periodIndex })
            }
            onClearSlot={handleClearSlot}
            fullAppState={data}
          />
        )}

        {/* Tab 3: Master School Timetable */}
        {activeTab === 'master' && (
          <MasterTimetableView
            classes={data.classes}
            teachers={data.teachers}
            subjects={data.subjects}
            workingDays={data.settings.workingDays}
            periodTimings={data.settings.periodTimings}
            entries={data.entries}
            onOpenEditSlot={(classId, sectionId, day, periodIndex) =>
              setEditSlot({ classId, sectionId, day, periodIndex })
            }
          />
        )}

        {/* Tab 4: Proxy Routine Management (দৈনিক বদলি / প্রক্সি ক্লাস) */}
        {activeTab === 'proxy' && (
          <ProxyRoutineView
            settings={data.settings}
            teachers={data.teachers}
            classes={data.classes}
            subjects={data.subjects}
            periodTimings={data.settings.periodTimings}
            entries={data.entries}
          />
        )}

        {/* Tab 5: Conflicts & Compliance View */}
        {activeTab === 'conflicts' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-3 rounded-xl ${
                      conflicts.length > 0
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    }`}
                  >
                    {conflicts.length > 0 ? (
                      <ShieldAlert className="w-6 h-6" />
                    ) : (
                      <CheckCircle2 className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Timetable Conflict & Compliance Center
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Continuously auditing teacher collisions, section overlaps, and consecutive class policies.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsAutoGenerateOpen(true)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg flex items-center gap-1.5 shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Auto-Resolve via Generator</span>
                  </button>
                </div>
              </div>
            </div>

            {/* List of conflicts */}
            {conflicts.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Zero Conflicts Found
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Every class and teacher schedule is fully aligned, non-overlapping, and compliant with all institutional rules.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {conflicts.map(conf => (
                  <div
                    key={conf.id}
                    className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                            conf.severity === 'error'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
                          }`}
                        >
                          {conf.type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                          {conf.day} · Period {conf.periodIndex}
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
                      <div className="text-[11px] text-slate-400">
                        {conf.entryIds.length} period slots affected
                      </div>
                      {conf.teacherId ? (
                        <button
                          onClick={() => {
                            setSelectedTeacherId(conf.teacherId!);
                            setActiveTab('teachers');
                          }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 flex items-center gap-1"
                        >
                          <span>Open Teacher Routine</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (conf.classId) setSelectedClassId(conf.classId);
                            if (conf.sectionId) setSelectedSectionId(conf.sectionId);
                            setActiveTab('classes');
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
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-6 mt-auto bg-white/50 dark:bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <School className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {data.settings.schoolName}
            </span>
            <span>·</span>
            <span>Academic Year: {data.settings.academicYear}</span>
            <span>·</span>
            <span>Principal: {data.settings.principalName}</span>
          </div>
          <div>
            Smart School Routine Management System • Centralized Timetable Engine
          </div>
        </div>
      </footer>

      {/* Modals */}
      {/* 1. Edit Entry Modal */}
      {editSlot && (
        <EditEntryModal
          isOpen={true}
          onClose={() => setEditSlot(null)}
          classId={editSlot.classId}
          sectionId={editSlot.sectionId}
          day={editSlot.day}
          periodIndex={editSlot.periodIndex}
          classes={data.classes}
          teachers={data.teachers}
          subjects={data.subjects}
          periodTimings={data.settings.periodTimings}
          entries={data.entries}
          onSaveEntry={handleSaveEntry}
          onDeleteEntry={handleClearSlot}
        />
      )}

      {/* 2. Auto-Generate Modal */}
      <AutoGenerateModal
        isOpen={isAutoGenerateOpen}
        onClose={() => setIsAutoGenerateOpen(false)}
        classes={data.classes}
        selectedClassId={selectedClassId}
        selectedSectionId={selectedSectionId}
        onExecuteGenerate={handleExecuteGenerate}
      />

      {/* 3. Export Center Modal (All 5 Word & PDF download options + Excel) */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        fullAppState={data}
        classes={data.classes}
        teachers={data.teachers}
        initialClassId={selectedClassId}
        initialSectionId={selectedSectionId}
        initialTeacherId={selectedTeacherId}
      />

      {/* 4. Class & Section Management Modal */}
      <ClassManagementModal
        isOpen={isClassMgmtOpen}
        onClose={() => setIsClassMgmtOpen(false)}
        classes={data.classes}
        subjects={data.subjects}
        teachers={data.teachers}
        onUpdateClasses={updated => setData(prev => ({ ...prev, classes: updated }))}
        onOpenSubjectMgmt={() => setIsSubjectMgmtOpen(true)}
      />

      {/* 4b. Subject Management & Class Allocation Modal */}
      <SubjectManagementModal
        isOpen={isSubjectMgmtOpen}
        onClose={() => setIsSubjectMgmtOpen(false)}
        classes={data.classes}
        subjects={data.subjects}
        teachers={data.teachers}
        initialClassId={selectedClassId}
        onUpdateSubjects={updated => setData(prev => ({ ...prev, subjects: updated }))}
        onUpdateClasses={updated => setData(prev => ({ ...prev, classes: updated }))}
      />

      {/* 5. Teacher Management Modal */}
      <TeacherManagementModal
        isOpen={isTeacherMgmtOpen}
        onClose={() => setIsTeacherMgmtOpen(false)}
        teachers={data.teachers}
        subjects={data.subjects}
        onUpdateTeachers={updated => setData(prev => ({ ...prev, teachers: updated }))}
      />

      {/* 6. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={data.settings}
        onUpdateSettings={settings => setData(prev => ({ ...prev, settings }))}
        onResetToDefaults={handleResetToDefaults}
        fullAppState={data}
        onImportBackup={handleImportBackup}
      />

      {/* 7. Smart Import Modal (Excel, PDF, Word, Image) */}
      <SmartImportModal
        isOpen={isSmartImportOpen}
        onClose={() => setIsSmartImportOpen(false)}
        classes={data.classes}
        teachers={data.teachers}
        subjects={data.subjects}
        settings={data.settings}
        onApplyImport={handleApplyImport}
      />

      {/* 8. Quick Conflict Modal */}
      <ConflictModal
        isOpen={isConflictModalOpen}
        onClose={() => setIsConflictModalOpen(false)}
        conflicts={conflicts}
        onResolveConflict={conf => {
          if (conf.teacherId) {
            setSelectedTeacherId(conf.teacherId);
            setActiveTab('teachers');
          } else if (conf.classId) {
            setSelectedClassId(conf.classId);
            if (conf.sectionId) setSelectedSectionId(conf.sectionId);
            setActiveTab('classes');
          }
        }}
      />
    </div>
  );
}
