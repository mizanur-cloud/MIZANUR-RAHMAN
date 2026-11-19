/**
 * Smart School Routine Management System
 * Class-wise & Teacher-wise routine generator with bidirectional synchronization,
 * conflict prevention, Play–10 management, and DOCX/PDF/Excel exports.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  DayOfWeek,
  RoutineConflict,
  SchoolClass,
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
import { generateSmartTimetable, autoFixRoutine, GenerationOptions, GenerationResult } from './services/routineGenerator';
import { syncTeacherAssignmentsToClasses, syncClassesToTeachers } from './services/teacherSubjectSync';
import {
  AGRICULTURE_ROOM,
  areParallelSubjects,
  getCombinedHinduRoom,
  getMaxReligionConcurrentSections,
  isAgricultureSubject,
  isHinduReligionRoom,
  isHinduReligionSubject,
  isPlayOrNursery,
  isReligionSubject,
  isSubjectSelectedForSection,
} from './services/parallelSubjects';
import { isSlotDismissed } from './services/scheduleTiers';

// Components
import { Navbar } from './components/Navbar';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { ComplianceAuditPanel } from './components/ComplianceAuditPanel';
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
import { HelpAndInstallModal } from './components/HelpAndInstallModal';
import { OfflineIndicator } from './components/OfflineIndicator';

import {
  AlertTriangle,
  ArrowRight,
  School,
  Undo2,
  CheckCircle2,
  X,
} from 'lucide-react';

const MAX_HISTORY = 25;

export default function App() {
  // Primary application state + Undo/Redo stacks
  const [data, setData] = useState<AppState>(() => loadStoredData());
  const [past, setPast] = useState<AppState[]>([]);
  const [future, setFuture] = useState<AppState[]>([]);

  // Dual-Theme Light / Dark mode state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark';
    }
    try {
      return localStorage.getItem('idsc_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  // Non-blocking feedback toast
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((message: string) => {
    setActionNotice(message);
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setActionNotice(null);
    }, 3600);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('idsc_theme', theme);
    } catch {
      // Ignore storage quota errors
    }
  }, [theme]);

  // Active workspace tab
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
  const [isHelpAndInstallOpen, setIsHelpAndInstallOpen] = useState(false);

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

  // Helper to commit state with Undo history snapshot
  const commitData = useCallback(
    (updater: (prev: AppState) => AppState, noticeLabel?: string) => {
      setData(prev => {
        const next = updater(prev);
        if (next === prev) return prev;
        setPast(p => [...p.slice(-(MAX_HISTORY - 1)), prev]);
        setFuture([]);
        return next;
      });
      if (noticeLabel) {
        showNotice(noticeLabel);
      }
    },
    [showNotice]
  );

  const handleUndo = useCallback(() => {
    setPast(prevPast => {
      if (prevPast.length === 0) return prevPast;
      const previousState = prevPast[prevPast.length - 1];
      setData(currentData => {
        setFuture(f => [currentData, ...f.slice(0, MAX_HISTORY - 1)]);
        return previousState;
      });
      showNotice('পূর্বের অবস্থায় ফিরে যাওয়া হয়েছে (Undo)।');
      return prevPast.slice(0, -1);
    });
  }, [showNotice]);

  const handleRedo = useCallback(() => {
    setFuture(prevFuture => {
      if (prevFuture.length === 0) return prevFuture;
      const [nextState, ...restFuture] = prevFuture;
      setData(currentData => {
        setPast(p => [...p.slice(-(MAX_HISTORY - 1)), currentData]);
        return nextState;
      });
      showNotice('পরিবর্তনটি পুনরায় প্রয়োগ করা হয়েছে (Redo)।');
      return restFuture;
    });
  }, [showNotice]);

  // Global keyboard shortcuts: Ctrl+Z (Undo) / Ctrl+Shift+Z or Ctrl+Y (Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

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
      activeTeachingPeriodIndices,
      data.subjects,
      data.settings
    );
  }, [
    data.entries,
    data.teachers,
    data.classes,
    data.settings,
    activeTeachingPeriodIndices,
    data.subjects,
  ]);

  const errorCount = useMemo(() => conflicts.filter(c => c.severity === 'error').length, [conflicts]);
  const warningCount = useMemo(() => conflicts.filter(c => c.severity === 'warning').length, [conflicts]);

  // Update entry in central database (enforces 100% bidirectional sync & parallel slots)
  const handleSaveEntry = (newEntry: TimetableEntry, partnerEntry?: TimetableEntry) => {
    commitData(prev => {
      const cls = prev.classes.find(c => c.id === newEntry.classId);
      const filtered = prev.entries.filter(e => {
        if (e.id === newEntry.id || (partnerEntry && e.id === partnerEntry.id)) return false;
        const isSameSlot =
          e.classId === newEntry.classId &&
          e.sectionId === newEntry.sectionId &&
          e.day === newEntry.day &&
          e.periodIndex === newEntry.periodIndex;
        if (!isSameSlot) return true;
        if (e.subjectId === newEntry.subjectId) return false;
        if (partnerEntry && e.subjectId === partnerEntry.subjectId) return false;
        if (areParallelSubjects(e.subjectId, newEntry.subjectId, prev.subjects, cls?.numericGrade)) {
          return true;
        }
        return false;
      });
      return {
        ...prev,
        entries: partnerEntry ? [...filtered, newEntry, partnerEntry] : [...filtered, newEntry],
      };
    }, partnerEntry ? 'সমান্তরাল পিরিয়ডসহ রুটিন সংরক্ষিত হয়েছে।' : 'পিরিয়ড আপডেট সংরক্ষিত হয়েছে।');
  };

  const handleClearSlot = (entryId: string) => {
    commitData(
      prev => ({
        ...prev,
        entries: prev.entries.filter(e => e.id !== entryId),
      }),
      'স্লটটি রুটিন থেকে সরানো হয়েছে।'
    );
  };

  const handleClearSection = (classId: string, sectionId: string) => {
    commitData(
      prev => ({
        ...prev,
        entries: prev.entries.filter(e => !(e.classId === classId && e.sectionId === sectionId)),
      }),
      'সেকশনের রুটিন খালি করা হয়েছে।'
    );
  };

  // Safe Slot Swap inside a section (validates teacher collision & Hindu room collision)
  const handleSwapSectionSlots = (
    classId: string,
    sectionId: string,
    dayA: DayOfWeek,
    periodA: number,
    dayB: DayOfWeek,
    periodB: number
  ): { ok: boolean; reason?: string } => {
    const cls = data.classes.find(c => c.id === classId);
    if (!cls) return { ok: false, reason: 'শ্রেণি পাওয়া যায়নি।' };

    if (
      isSlotDismissed(cls, dayA, periodA, sectionId, data.settings.workingDays) ||
      isSlotDismissed(cls, dayB, periodB, sectionId, data.settings.workingDays)
    ) {
      return { ok: false, reason: 'ছুটির পিরিয়ডে ক্লাস বদল করা যাবে না।' };
    }

    const slotAEntries = data.entries.filter(
      e => e.classId === classId && e.sectionId === sectionId && e.day === dayA && e.periodIndex === periodA
    );
    const slotBEntries = data.entries.filter(
      e => e.classId === classId && e.sectionId === sectionId && e.day === dayB && e.periodIndex === periodB
    );

    if (slotAEntries.length === 0 && slotBEntries.length === 0) {
      return { ok: false, reason: 'দুটি স্লটই বর্তমানে খালি।' };
    }

    const isPlayNur = isPlayOrNursery(cls);
    const teacherMap = new Map(data.teachers.map(t => [t.id, t]));
    const classMap = new Map(data.classes.map(c => [c.id, c]));
    const subjectMap = new Map(data.subjects.map(s => [s.id, s]));

    const checkMove = (
      moving: TimetableEntry[],
      targetDay: DayOfWeek,
      targetPeriod: number,
      leavingFromTargetSlot: TimetableEntry[]
    ): string | null => {
      const leavingIds = new Set(leavingFromTargetSlot.map(e => e.id));
      for (const entry of moving) {
        // Strict same-day rule for KG - Class 10: cannot swap across days if same subject already exists on targetDay
        if (!isPlayNur && entry.day !== targetDay) {
          const sameDayDuplicate = data.entries.find(
            other =>
              other.classId === classId &&
              other.sectionId === sectionId &&
              other.day === targetDay &&
              other.subjectId === entry.subjectId &&
              !leavingIds.has(other.id)
          );
          if (sameDayDuplicate) {
            const subName = subjectMap.get(entry.subjectId)?.name || 'এই বিষয়';
            return `${targetDay} দিনে "${subName}" ক্লাস ইতোমধ্যেই রয়েছে — একই দিনে একটি বিষয় একবারের বেশি রাখা যাবে না।`;
          }
        }

        const isHinduCombined =
          isHinduReligionSubject(entry.subjectId, data.subjects) &&
          isHinduReligionRoom(entry.room || getCombinedHinduRoom(data.settings), data.settings);
        const maxRelConcurrent = getMaxReligionConcurrentSections(data.settings);

        if (entry.teacherId) {
          const teacherCollisions = data.entries.filter(
            other =>
              !(other.classId === classId && other.sectionId === sectionId) &&
              other.day === targetDay &&
              other.periodIndex === targetPeriod &&
              other.teacherId === entry.teacherId
          );
          if (teacherCollisions.length > 0) {
            const allCombinedHindu =
              isHinduCombined &&
              teacherCollisions.every(
                o =>
                  isHinduReligionSubject(o.subjectId, data.subjects) &&
                  isHinduReligionRoom(o.room, data.settings)
              );
            const relSectionsAtSlot = new Set(
              data.entries
                .filter(
                  o =>
                    !(o.classId === classId && o.sectionId === sectionId) &&
                    o.day === targetDay &&
                    o.periodIndex === targetPeriod &&
                    isReligionSubject(o.subjectId, data.subjects)
                )
                .map(o => `${o.classId}_${o.sectionId}`)
            );
            if (!allCombinedHindu || relSectionsAtSlot.size >= maxRelConcurrent) {
              const tName = teacherMap.get(entry.teacherId)?.name || 'Teacher';
              const otherCls = classMap.get(teacherCollisions[0].classId)?.name || 'অন্য শ্রেণি';
              return `${tName} ঐ সময়ে (${targetDay}, P${targetPeriod}) ${otherCls}-এ ব্যস্ত আছেন।`;
            }
          }
        }

        if (isReligionSubject(entry.subjectId, data.subjects)) {
          const relSectionsAtSlot = new Set(
            data.entries
              .filter(
                o =>
                  !(o.classId === classId && o.sectionId === sectionId) &&
                  o.day === targetDay &&
                  o.periodIndex === targetPeriod &&
                  isReligionSubject(o.subjectId, data.subjects)
              )
              .map(o => `${o.classId}_${o.sectionId}`)
          );
          if (relSectionsAtSlot.size >= maxRelConcurrent) {
            return `${targetDay} (P${targetPeriod}) স্লটে সর্বোচ্চ ${maxRelConcurrent}টি সেকশনের সম্মিলিত ধর্ম ক্লাস পূর্ণ হয়ে গেছে।`;
          }
        }

        const usesAgricultureRoom =
          entry.room === AGRICULTURE_ROOM || isAgricultureSubject(entry.subjectId, data.subjects);
        if (usesAgricultureRoom) {
          const roomCollision = data.entries.find(
            other =>
              !(other.classId === classId && other.sectionId === sectionId) &&
              other.day === targetDay &&
              other.periodIndex === targetPeriod &&
              (other.room === AGRICULTURE_ROOM || isAgricultureSubject(other.subjectId, data.subjects))
          );
          if (roomCollision) {
            const otherCls = classMap.get(roomCollision.classId)?.name || 'অন্য শ্রেণি';
            return `${AGRICULTURE_ROOM} ঐ সময়ে (${targetDay}, P${targetPeriod}) ${otherCls}-এর জন্য নির্ধারিত।`;
          }
        } else if (entry.room && !isHinduCombined) {
          const normTargetRoom = entry.room.trim().toLowerCase();
          const roomCollision = data.entries.find(
            other =>
              !(other.classId === classId && other.sectionId === sectionId) &&
              other.day === targetDay &&
              other.periodIndex === targetPeriod &&
              (other.room || '').trim().toLowerCase() === normTargetRoom
          );
          if (roomCollision) {
            const otherCls = classMap.get(roomCollision.classId)?.name || 'অন্য শ্রেণি';
            return `রুম "${entry.room}" ঐ সময়ে (${targetDay}, P${targetPeriod}) ${otherCls}-এ ব্যবহৃত হচ্ছে।`;
          }
        }
      }
      return null;
    };

    const errA = checkMove(slotAEntries, dayB, periodB, slotBEntries);
    if (errA) return { ok: false, reason: errA };
    const errB = checkMove(slotBEntries, dayA, periodA, slotAEntries);
    if (errB) return { ok: false, reason: errB };

    commitData(prev => {
      const updated = prev.entries.map(e => {
        if (e.classId === classId && e.sectionId === sectionId) {
          if (e.day === dayA && e.periodIndex === periodA) {
            return { ...e, day: dayB, periodIndex: periodB };
          }
          if (e.day === dayB && e.periodIndex === periodB) {
            return { ...e, day: dayA, periodIndex: periodA };
          }
        }
        return e;
      });
      return { ...prev, entries: updated };
    }, `${dayA} (P${periodA}) ও ${dayB} (P${periodB}) সফলভাবে বদল হয়েছে।`);

    return { ok: true };
  };

  const handleUpdateTeachers = (updatedTeachers: Teacher[]) => {
    commitData(prev => {
      const syncedClasses = syncTeacherAssignmentsToClasses(
        prev.classes,
        updatedTeachers,
        prev.subjects,
        prev.teachers
      );
      return {
        ...prev,
        teachers: updatedTeachers,
        classes: syncedClasses,
      };
    });
    if (updatedTeachers.length > 0 && !updatedTeachers.some(t => t.id === selectedTeacherId)) {
      setSelectedTeacherId(updatedTeachers[0].id);
    }
  };

  const handleUpdateClasses = (updatedClasses: SchoolClass[]) => {
    commitData(prev => {
      const syncedTeachers = syncClassesToTeachers(updatedClasses, prev.teachers);
      const classLookup = new Map(updatedClasses.map(c => [c.id, c]));
      const filteredEntries = prev.entries.filter(e => {
        const cls = classLookup.get(e.classId);
        if (!cls) return false;
        if (!cls.sections.some(s => s.id === e.sectionId)) return false;
        if (!isSubjectSelectedForSection(cls, e.sectionId, e.subjectId)) return false;
        if (isSlotDismissed(cls, e.day, e.periodIndex, e.sectionId, prev.settings.workingDays)) return false;
        return true;
      });
      return {
        ...prev,
        classes: updatedClasses,
        teachers: syncedTeachers,
        entries: filteredEntries,
      };
    });
  };

  const handleUpdateSectionSubjects = (
    classId: string,
    sectionId: string,
    selectedSubjectIds: string[] | undefined,
    extraClassRequirements?: { subjectId: string; periodsPerWeek: number; assignedTeacherId?: string }[]
  ) => {
    commitData(prev => {
      const updatedClasses = prev.classes.map(cls => {
        if (cls.id !== classId) return cls;
        let nextReqs = [...cls.subjectRequirements];
        let siblingSeedIds: string[] | undefined;

        if (extraClassRequirements && extraClassRequirements.length > 0) {
          const existingIds = cls.subjectRequirements.map(r => r.subjectId);
          extraClassRequirements.forEach(extra => {
            if (!nextReqs.some(r => r.subjectId === extra.subjectId)) {
              nextReqs.push(extra);
              siblingSeedIds = existingIds;
            }
          });
        }

        const nextSections = cls.sections.map(sec => {
          if (sec.id === sectionId) {
            return { ...sec, selectedSubjectIds };
          }
          // Preserve sibling sections' previous default subjects when a new subject is added exclusively for another section
          if (siblingSeedIds && sec.selectedSubjectIds === undefined) {
            return { ...sec, selectedSubjectIds: [...siblingSeedIds] };
          }
          return sec;
        });

        return {
          ...cls,
          subjectRequirements: nextReqs,
          sections: nextSections,
        };
      });

      const classLookup = new Map(updatedClasses.map(c => [c.id, c]));
      const filteredEntries = prev.entries.filter(e => {
        const cls = classLookup.get(e.classId);
        if (!cls) return false;
        return isSubjectSelectedForSection(cls, e.sectionId, e.subjectId);
      });

      const syncedTeachers = syncClassesToTeachers(updatedClasses, prev.teachers);

      return {
        ...prev,
        classes: updatedClasses,
        teachers: syncedTeachers,
        entries: filteredEntries,
      };
    }, 'সেকশন-ভিত্তিক বিষয় নির্বাচন সংরক্ষিত হয়েছে।');
  };

  // Strictly isolated section-level quota & teacher config updater (NEVER copies to sibling sections)
  const handleUpdateSectionSubjectConfig = (
    classId: string,
    sectionId: string,
    subjectId: string,
    patch: { periodsPerWeek?: number; assignedTeacherId?: string }
  ) => {
    commitData(prev => {
      const updatedClasses = prev.classes.map(cls => {
        if (cls.id !== classId) return cls;
        const baseReq = cls.subjectRequirements.find(r => r.subjectId === subjectId);
        return {
          ...cls,
          sections: cls.sections.map(sec => {
            if (sec.id !== sectionId) return sec;
            const prevConfigs = sec.subjectConfigs || {};
            const curCfg = prevConfigs[subjectId] || {};
            const nextPeriods =
              patch.periodsPerWeek !== undefined
                ? Math.max(0, Math.min(12, patch.periodsPerWeek))
                : curCfg.periodsPerWeek ?? baseReq?.periodsPerWeek ?? 4;
            const nextTeacherId =
              patch.assignedTeacherId !== undefined
                ? patch.assignedTeacherId
                : curCfg.assignedTeacherId;
            return {
              ...sec,
              subjectConfigs: {
                ...prevConfigs,
                [subjectId]: {
                  periodsPerWeek: nextPeriods,
                  assignedTeacherId: nextTeacherId,
                },
              },
            };
          }),
        };
      });

      const syncedTeachers = syncClassesToTeachers(updatedClasses, prev.teachers);
      return {
        ...prev,
        classes: updatedClasses,
        teachers: syncedTeachers,
      };
    }, 'সেকশন-ভিত্তিক বিষয় ও শিক্ষক কনফিগারেশন সংরক্ষিত হয়েছে।');
  };

  const handleDeleteGlobalSubject = (subjectId: string) => {
    commitData(prev => {
      const updatedSubjects = prev.subjects.filter(s => s.id !== subjectId);
      const updatedClasses = prev.classes.map(c => ({
        ...c,
        subjectRequirements: c.subjectRequirements.filter(r => r.subjectId !== subjectId),
      }));
      const updatedTeachers = prev.teachers.map(t => ({
        ...t,
        subjectIds: t.subjectIds.filter(id => id !== subjectId),
        assignedClassSections: t.assignedClassSections?.filter(a => a.subjectId !== subjectId),
      }));
      const updatedEntries = prev.entries.filter(e => e.subjectId !== subjectId);

      return {
        ...prev,
        subjects: updatedSubjects,
        classes: updatedClasses,
        teachers: updatedTeachers,
        entries: updatedEntries,
      };
    }, 'বিষয়টি সম্পূর্ণ ডেটাবেস থেকে মুছে ফেলা হয়েছে।');
  };

  const handleRemoveSubjectFromClass = (classId: string, subjectId: string) => {
    commitData(prev => {
      const updatedClasses = prev.classes.map(c => {
        if (c.id === classId) {
          return {
            ...c,
            subjectRequirements: c.subjectRequirements.filter(r => r.subjectId !== subjectId),
          };
        }
        return c;
      });
      const updatedTeachers = prev.teachers.map(t => ({
        ...t,
        assignedClassSections: t.assignedClassSections?.filter(
          a => !(a.classId === classId && a.subjectId === subjectId)
        ),
      }));
      const updatedEntries = prev.entries.filter(
        e => !(e.classId === classId && e.subjectId === subjectId)
      );

      return {
        ...prev,
        classes: updatedClasses,
        teachers: updatedTeachers,
        entries: updatedEntries,
      };
    });
  };

  const handleDeleteTeacher = (teacherId: string, removeAssignedEntries: boolean = true) => {
    commitData(prev => {
      const remainingTeachers = prev.teachers.filter(t => t.id !== teacherId);
      const remainingEntries = removeAssignedEntries
        ? prev.entries.filter(e => e.teacherId !== teacherId)
        : prev.entries.map(e => (e.teacherId === teacherId ? { ...e, teacherId: '' } : e));
      const updatedClasses = prev.classes.map(c => ({
        ...c,
        blockTeacherIds: c.blockTeacherIds ? c.blockTeacherIds.filter(id => id !== teacherId) : undefined,
        subjectRequirements: c.subjectRequirements.map(req =>
          req.assignedTeacherId === teacherId ? { ...req, assignedTeacherId: undefined } : req
        ),
      }));
      return {
        ...prev,
        teachers: remainingTeachers,
        entries: remainingEntries,
        classes: updatedClasses,
      };
    }, 'শিক্ষকের তথ্য তালিকা থেকে সরানো হয়েছে।');

    setSelectedTeacherId(currentId => {
      if (currentId === teacherId) {
        const remaining = data.teachers.filter(t => t.id !== teacherId);
        return remaining[0]?.id || '';
      }
      return currentId;
    });
  };

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
      },
      data.subjects,
      data.settings
    );
    const notice =
      result.stats.unassignedPeriods > 0
        ? `সতর্কতা: সেকশন রুটিনে ${result.stats.unassignedPeriods}টি পিরিয়ড বরাদ্দ করা যায়নি (Audit দেখুন)।`
        : 'সেকশন রুটিন শতভাগ পূর্ণভাবে অটো-ফিল সম্পন্ন হয়েছে।';
    commitData(prev => ({ ...prev, entries: result.entries }), notice);
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
      },
      data.subjects,
      data.settings
    );
    const notice =
      result.stats.unassignedPeriods > 0
        ? `সতর্কতা: এই শ্রেণিতে ${result.stats.unassignedPeriods}টি পিরিয়ড বরাদ্দ বাকি রয়েছে (Audit দেখুন)।`
        : 'সম্পূর্ণ শ্রেণির রুটিন শতভাগ পূর্ণভাবে অটো-ফিল সম্পন্ন হয়েছে।';
    commitData(prev => ({ ...prev, entries: result.entries }), notice);
  };

  const handleExecuteGenerate = (options: GenerationOptions): GenerationResult => {
    const result = generateSmartTimetable(
      data.classes,
      data.teachers,
      data.settings.workingDays,
      data.settings.periodTimings,
      data.entries,
      options,
      data.subjects,
      data.settings
    );
    const notice =
      result.verification?.finalCompletionStatus === 'complete'
        ? 'Routine Successfully Generated — শূন্য কনফ্লিক্ট ও শূন্য বাকি ক্লাস।'
        : `অটো-জেনারেটর সম্পন্ন (${result.stats.unassignedPeriods}টি অনির্ধারিত পিরিয়ড/নোটিশ রয়েছে)।`;
    commitData(prev => ({ ...prev, entries: result.entries }), notice);
    return result;
  };

  const handleAutoFixRoutine = (): GenerationResult => {
    const result = autoFixRoutine(
      data.classes,
      data.teachers,
      data.settings.workingDays,
      data.settings.periodTimings,
      data.entries,
      data.settings,
      data.subjects
    );
    const allPass = result.verification?.finalValidation?.allPassed ?? result.success;
    const notice = allPass
      ? 'Auto Fix সফল: সকল কনফ্লিক্ট, শিক্ষক/রুম সমস্যা ও বাকি ক্লাস সমাধান হয়েছে!'
      : `Auto Fix সম্পন্ন (${result.stats.unassignedPeriods}টি অনির্ধারিত ক্লাস/সতর্কতা বাকি — বিস্তারিত Audit-এ দেখুন)।`;
    commitData(prev => ({ ...prev, entries: result.entries }), notice);
    return result;
  };

  const handleResetToDefaults = () => {
    const fresh = resetToDefaults();
    commitData(() => fresh, 'ডিফল্ট রুটিন পুনরায় লোড হয়েছে।');
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
    commitData(prev => {
      const updatedSettings =
        newSchoolName && newSchoolName.trim()
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
      }
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
    }, 'ফাইল থেকে রুটিন ডেটা সফলভাবে যুক্ত হয়েছে।');

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
    commitData(() => newState, 'ব্যাকআপ ডেটা রিস্টোর সম্পন্ন হয়েছে।');
    if (newState.classes[0]) setSelectedClassId(newState.classes[0].id);
    if (newState.teachers[0]) setSelectedTeacherId(newState.teachers[0].id);
  };

  return (
    <div className="min-h-screen bg-[#f6f8fb] dark:bg-[#090e1a] text-slate-800 dark:text-slate-100 flex flex-col font-sans transition-colors">
      {/* Top 3-Zone Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        errorCount={errorCount}
        warningCount={warningCount}
        schoolName={data.settings.schoolName}
        academicYear={data.settings.academicYear}
        theme={theme}
        onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenAutoGenerate={() => setIsAutoGenerateOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Persistent Conflict Alert Strip when collisions exist */}
      {conflicts.length > 0 && activeTab !== 'conflicts' && (
        <div
          className={`no-print border-b px-4 py-2 ${
            errorCount > 0
              ? 'bg-rose-500/10 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900'
              : 'bg-amber-500/10 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900'
          }`}
        >
          <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4 text-xs">
            <div
              className={`flex items-center gap-2 ${
                errorCount > 0 ? 'text-rose-900 dark:text-rose-200' : 'text-amber-900 dark:text-amber-200'
              }`}
            >
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${errorCount > 0 ? 'text-rose-600' : 'text-amber-600'}`}
              />
              <span>
                <strong>
                  {conflicts.length} schedule {conflicts.length > 1 ? 'notices' : 'notice'}:
                </strong>{' '}
                {conflicts[0].title}.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('conflicts')}
              className={`font-bold hover:underline flex items-center gap-1 shrink-0 ${
                errorCount > 0 ? 'text-rose-800 dark:text-rose-300' : 'text-amber-800 dark:text-amber-300'
              }`}
            >
              <span>Inspect Audit</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main 2-Column Workspace */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:flex-row gap-6">
        <WorkspaceSidebar
          totalClasses={data.classes.length}
          totalTeachers={data.teachers.length}
          totalEntries={data.entries.length}
          errorCount={errorCount}
          warningCount={warningCount}
          onOpenClassMgmt={() => setIsClassMgmtOpen(true)}
          onOpenTeacherMgmt={() => setIsTeacherMgmtOpen(true)}
          onOpenSubjectMgmt={() => setIsSubjectMgmtOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenSmartImport={() => setIsSmartImportOpen(true)}
          onOpenHelpAndInstall={() => setIsHelpAndInstallOpen(true)}
          onOpenCompliance={() => setActiveTab('conflicts')}
        />

        <main className="flex-1 min-w-0">
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
              onSwapSectionSlots={handleSwapSectionSlots}
              onAutoGenerateSection={handleAutoGenerateSection}
              onAutoGenerateClass={handleAutoGenerateClass}
              onOpenSubjectMgmt={() => setIsSubjectMgmtOpen(true)}
              onUpdateSectionSubjects={handleUpdateSectionSubjects}
              onUpdateSectionSubjectConfig={handleUpdateSectionSubjectConfig}
              settings={data.settings}
              fullAppState={data}
            />
          )}

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
              settings={data.settings}
              onOpenEditSlot={(classId, sectionId, day, periodIndex) =>
                setEditSlot({ classId, sectionId, day, periodIndex })
              }
              onClearSlot={handleClearSlot}
              fullAppState={data}
            />
          )}

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

          {activeTab === 'conflicts' && (
            <ComplianceAuditPanel
              classes={data.classes}
              teachers={data.teachers}
              subjects={data.subjects}
              entries={data.entries}
              conflicts={conflicts}
              workingDays={data.settings.workingDays}
              periodTimings={data.settings.periodTimings}
              settings={data.settings}
              onOpenAutoGenerate={() => setIsAutoGenerateOpen(true)}
              onAutoFixRoutine={handleAutoFixRoutine}
              onSelectTeacher={tId => {
                setSelectedTeacherId(tId);
                setActiveTab('teachers');
              }}
              onSelectClassSection={(cId, sId) => {
                setSelectedClassId(cId);
                setSelectedSectionId(sId);
                setActiveTab('classes');
              }}
            />
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="no-print border-t border-slate-200 dark:border-slate-800 py-5 mt-auto bg-white/70 dark:bg-slate-900/60">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2 flex-wrap">
            <School className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {data.settings.schoolName}
            </span>
            <span>·</span>
            <span>Academic Year: {data.settings.academicYear}</span>
            <span>·</span>
            <span>Principal: {data.settings.principalName}</span>
          </div>
          <div>
            Smart School Routine Management System · Centralized Timetable Engine
          </div>
        </div>
      </footer>

      {/* Non-blocking Action Toast with Quick Undo */}
      {actionNotice && (
        <div className="no-print fixed bottom-5 right-5 z-50 bg-slate-900 dark:bg-slate-800 text-white px-4 py-2.5 rounded-xl border border-slate-700 shadow-lg flex items-center gap-3 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{actionNotice}</span>
          {past.length > 0 && (
            <button
              type="button"
              onClick={handleUndo}
              className="ml-1 px-2 py-1 rounded-md bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 text-blue-300 font-semibold flex items-center gap-1"
            >
              <Undo2 className="w-3 h-3" />
              <span>Undo</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-slate-400 hover:text-white"
            aria-label="Close notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Modals */}
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
          settings={data.settings}
          onSaveEntry={handleSaveEntry}
          onDeleteEntry={handleClearSlot}
        />
      )}

      <AutoGenerateModal
        isOpen={isAutoGenerateOpen}
        onClose={() => setIsAutoGenerateOpen(false)}
        classes={data.classes}
        selectedClassId={selectedClassId}
        selectedSectionId={selectedSectionId}
        onExecuteGenerate={handleExecuteGenerate}
        onOpenAudit={() => {
          setIsAutoGenerateOpen(false);
          setActiveTab('conflicts');
        }}
      />

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

      <ClassManagementModal
        isOpen={isClassMgmtOpen}
        onClose={() => setIsClassMgmtOpen(false)}
        classes={data.classes}
        subjects={data.subjects}
        teachers={data.teachers}
        onUpdateClasses={handleUpdateClasses}
        onUpdateSectionSubjects={handleUpdateSectionSubjects}
        onUpdateSectionSubjectConfig={handleUpdateSectionSubjectConfig}
        onOpenSubjectMgmt={() => setIsSubjectMgmtOpen(true)}
      />

      <SubjectManagementModal
        isOpen={isSubjectMgmtOpen}
        onClose={() => setIsSubjectMgmtOpen(false)}
        classes={data.classes}
        subjects={data.subjects}
        teachers={data.teachers}
        entries={data.entries}
        initialClassId={selectedClassId}
        onUpdateSubjects={updated =>
          commitData(prev => ({ ...prev, subjects: updated }), 'বিষয়ের তালিকা আপডেট হয়েছে।')
        }
        onUpdateClasses={handleUpdateClasses}
        onUpdateTeachers={handleUpdateTeachers}
        onUpdateSectionSubjectConfig={handleUpdateSectionSubjectConfig}
        onDeleteGlobalSubject={handleDeleteGlobalSubject}
        onRemoveSubjectFromClass={handleRemoveSubjectFromClass}
      />

      <TeacherManagementModal
        isOpen={isTeacherMgmtOpen}
        onClose={() => setIsTeacherMgmtOpen(false)}
        teachers={data.teachers}
        subjects={data.subjects}
        classes={data.classes}
        entries={data.entries}
        onUpdateTeachers={handleUpdateTeachers}
        onUpdateClasses={handleUpdateClasses}
        onDeleteTeacher={handleDeleteTeacher}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={data.settings}
        teachers={data.teachers}
        subjects={data.subjects}
        onUpdateSettings={settings =>
          commitData(prev => ({ ...prev, settings }), 'বিদ্যালয় ও বেল সেটিংস সংরক্ষিত হয়েছে।')
        }
        onResetToDefaults={handleResetToDefaults}
        fullAppState={data}
        onImportBackup={handleImportBackup}
      />

      <SmartImportModal
        isOpen={isSmartImportOpen}
        onClose={() => setIsSmartImportOpen(false)}
        classes={data.classes}
        teachers={data.teachers}
        subjects={data.subjects}
        settings={data.settings}
        onApplyImport={handleApplyImport}
      />

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

      <HelpAndInstallModal
        isOpen={isHelpAndInstallOpen}
        onClose={() => setIsHelpAndInstallOpen(false)}
        onOpenAutoGenerate={() => setIsAutoGenerateOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenSmartImport={() => setIsSmartImportOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <OfflineIndicator />
    </div>
  );
}
