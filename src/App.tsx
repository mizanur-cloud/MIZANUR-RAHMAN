/**
 * Smart School Routine Management System
 * Class-wise & Teacher-wise routine generator with bidirectional synchronization,
 * conflict prevention, Play–10 management, and DOCX/PDF/Excel exports.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  AdminAccount,
  AuditActionType,
  AuditLogEntry,
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
import { useAuth } from './context/AuthContext';
import {
  PublishedRoutineMetadata,
  PublishedRoutineSchedule,
  saveRoutineToCloud,
  StaffContactMap,
  subscribeAllAdmins,
  subscribeAuditLogs,
  subscribePublishedRoutine,
  subscribeStaffContacts,
} from './services/rbacService';
import {
  AGRICULTURE_ROOM,
  areParallelSubjects,
  getCombinedHinduRoom,
  getEffectiveSubjectFixedPeriods,
  getMaxReligionConcurrentSections,
  isAgricultureSubject,
  isHinduReligionRoom,
  isHinduReligionSubject,
  isPlayOrNursery,
  isReligionSubject,
  isSubjectSelectedForSection,
  isTeacherBlockedAtSlot,
} from './services/parallelSubjects';
import { isSlotDismissed } from './services/scheduleTiers';

// Components
import { Navbar, WorkspaceTab } from './components/Navbar';
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
import { LoginModal } from './components/LoginModal';
import { ControlPanelView } from './components/ControlPanelView';
import { LiveDashboardView } from './components/LiveDashboardView';
import { SchoolCrestLogo } from './components/SchoolCrestLogo';
import { MobileNavigationDock } from './components/MobileNavigationDock';
import { useViewMode } from './context/ViewModeContext';

import {
  AlertTriangle,
  ArrowRight,
  Undo2,
  CheckCircle2,
  X,
  ShieldAlert,
  Lock,
  LogIn,
} from 'lucide-react';

const MAX_HISTORY = 25;

function isSecretControlRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const pathname = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  const hash = window.location.hash.toLowerCase();
  return (
    pathname === '/control-panel' ||
    pathname === '/admin' ||
    hash === '#control-panel' ||
    hash === '#admin'
  );
}

export default function App() {
  const {
    firebaseUser,
    authReady,
    role,
    adminStatus,
    canEdit,
    isSuperAdmin,
    displayName,
    email,
    statusAlert,
    dismissStatusAlert,
    logout,
  } = useAuth();

  // Primary application state + Undo/Redo stacks
  const [data, setData] = useState<AppState>(() => loadStoredData());
  const [past, setPast] = useState<AppState[]>([]);
  const [future, setFuture] = useState<AppState[]>([]);
  const latestDataRef = useRef<AppState>(data);
  const pastRef = useRef<AppState[]>(past);
  const futureRef = useRef<AppState[]>(future);

  // Super Admin Control Panel data (only subscribed when isSuperAdmin)
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [secretRouteRequested, setSecretRouteRequested] = useState<boolean>(() => isSecretControlRoute());
  const { isMobileView, isDesktopView } = useViewMode();

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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('classes');

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

  // Keep synchronous refs synced
  useEffect(() => {
    latestDataRef.current = data;
    saveStoredData(data);
  }, [data]);

  useEffect(() => {
    pastRef.current = past;
  }, [past]);

  useEffect(() => {
    futureRef.current = future;
  }, [future]);

  // Listen to browser navigation changes for secret routes (/control-panel, /admin)
  useEffect(() => {
    const handleNav = () => setSecretRouteRequested(isSecretControlRoute());
    window.addEventListener('popstate', handleNav);
    window.addEventListener('hashchange', handleNav);
    return () => {
      window.removeEventListener('popstate', handleNav);
      window.removeEventListener('hashchange', handleNav);
    };
  }, []);

  // Auto-open Control Panel if Super Admin navigates directly to secret URL
  useEffect(() => {
    if (authReady && secretRouteRequested && isSuperAdmin) {
      setActiveTab('control-panel');
    }
  }, [authReady, secretRouteRequested, isSuperAdmin]);

  const handleReturnFromBlockedRoute = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/');
    }
    setSecretRouteRequested(false);
    setActiveTab('classes');
  }, []);

  // Cloud Firestore real-time synchronization (Single Source of Truth + PII isolation)
  const canEditRef = useRef(canEdit);
  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);

  const cloudMetaRef = useRef<PublishedRoutineMetadata | null>(null);
  const cloudSchedRef = useRef<PublishedRoutineSchedule | null>(null);
  const staffContactsRef = useRef<StaffContactMap>({});
  const metaReceivedRef = useRef(false);
  const schedReceivedRef = useRef(false);
  const initialCloudSeededRef = useRef(false);

  const applyMergedCloudState = useCallback(() => {
    const meta = cloudMetaRef.current;
    const sched = cloudSchedRef.current;
    if (!meta && !sched) return;

    setData(prev => {
      const sourceTeachers = meta?.teachers && meta.teachers.length > 0 ? meta.teachers : prev.teachers;
      const mergedTeachers = sourceTeachers.map(t => {
        if (canEditRef.current) {
          const contact = staffContactsRef.current[t.id];
          return contact ? { ...t, ...contact } : t;
        }
        const { email: _e, phone: _p, ...publicOnly } = t;
        return publicOnly as Teacher;
      });

      const next: AppState = {
        classes: meta?.classes && meta.classes.length > 0 ? meta.classes : prev.classes,
        teachers: mergedTeachers,
        subjects: meta?.subjects && meta.subjects.length > 0 ? meta.subjects : prev.subjects,
        settings: meta?.settings ? meta.settings : prev.settings,
        entries: sched?.entries ? sched.entries : prev.entries,
      };
      latestDataRef.current = next;
      saveStoredData(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const unsub = subscribePublishedRoutine(
      meta => {
        metaReceivedRef.current = true;
        cloudMetaRef.current = meta;
        applyMergedCloudState();
      },
      sched => {
        schedReceivedRef.current = true;
        cloudSchedRef.current = sched;
        applyMergedCloudState();
      },
      msg => showNotice(msg)
    );
    return () => unsub();
  }, [applyMergedCloudState, showNotice]);

  useEffect(() => {
    if (!canEdit) {
      staffContactsRef.current = {};
      setData(prev => {
        const hasAnyPii = prev.teachers.some(t => Boolean(t.email || t.phone));
        if (!hasAnyPii) return prev;
        const stripped = prev.teachers.map(({ email: _e, phone: _p, ...rest }) => rest as Teacher);
        const next = { ...prev, teachers: stripped };
        latestDataRef.current = next;
        return next;
      });
      return;
    }

    const unsub = subscribeStaffContacts(true, contacts => {
      staffContactsRef.current = contacts;
      applyMergedCloudState();
    });
    return () => unsub();
  }, [canEdit, applyMergedCloudState]);

  // Seed Firestore once if an active Admin / Super Admin signs in and cloud docs are still empty
  useEffect(() => {
    if (!authReady || !canEdit || !email || initialCloudSeededRef.current) return;
    const trySeed = () => {
      if (
        metaReceivedRef.current &&
        schedReceivedRef.current &&
        !cloudMetaRef.current &&
        !cloudSchedRef.current &&
        !initialCloudSeededRef.current
      ) {
        initialCloudSeededRef.current = true;
        const actorRole: 'super_admin' | 'admin' = isSuperAdmin ? 'super_admin' : 'admin';
        void saveRoutineToCloud({
          state: latestDataRef.current,
          actorEmail: email,
          actorName: displayName,
          actorRole,
          auditAction: 'routine_update',
          auditSummary: 'প্রাথমিক রুটিন ক্লাউড ডেটাবেসে প্রকাশিত হয়েছে',
        }).catch(err => {
          console.error('Initial cloud seed error:', err);
        });
      }
    };
    trySeed();
    const timer = window.setTimeout(trySeed, 1500);
    return () => window.clearTimeout(timer);
  }, [authReady, canEdit, email, displayName, isSuperAdmin]);

  // Subscribe Admin list & Audit Logs exclusively when Super Admin
  useEffect(() => {
    return subscribeAllAdmins(isSuperAdmin, setAdmins);
  }, [isSuperAdmin]);

  useEffect(() => {
    return subscribeAuditLogs(isSuperAdmin, setAuditLogs);
  }, [isSuperAdmin]);

  // Instant Action Effect: Immediately revoke open editing modals & restricted tabs if access drops
  useEffect(() => {
    if (!canEdit) {
      setEditSlot(null);
      setIsAutoGenerateOpen(false);
      setIsClassMgmtOpen(false);
      setIsTeacherMgmtOpen(false);
      setIsSubjectMgmtOpen(false);
      setIsSettingsOpen(false);
      setIsSmartImportOpen(false);
      setIsConflictModalOpen(false);
      setActiveTab(prev => (prev === 'proxy' || prev === 'conflicts' ? 'classes' : prev));
    }
    if (!isSuperAdmin) {
      setActiveTab(prev => (prev === 'control-panel' ? 'classes' : prev));
    }
  }, [canEdit, isSuperAdmin]);

  // Helper to commit state with Undo history snapshot + RBAC guard + Cloud Sync + Audit Log
  const commitData = useCallback(
    (
      updater: (prev: AppState) => AppState,
      noticeLabel?: string,
      auditAction: AuditActionType = 'routine_update',
      auditSummary?: string
    ) => {
      if (!canEdit || !email) {
        showNotice('অনুমতি নেই: শুধুমাত্র অনুমোদিত Active Admin বা Super Admin পরিবর্তন করতে পারবেন।');
        return;
      }

      const prev = latestDataRef.current;
      const next = updater(prev);
      if (next === prev) return;

      latestDataRef.current = next;
      const nextPast = [...pastRef.current.slice(-(MAX_HISTORY - 1)), prev];
      pastRef.current = nextPast;
      futureRef.current = [];

      setData(next);
      setPast(nextPast);
      setFuture([]);
      saveStoredData(next);

      if (noticeLabel) {
        showNotice(noticeLabel);
      }

      const actorRole: 'super_admin' | 'admin' = isSuperAdmin ? 'super_admin' : 'admin';
      void saveRoutineToCloud({
        state: next,
        actorEmail: email,
        actorName: displayName,
        actorRole,
        auditAction,
        auditSummary: auditSummary || noticeLabel || 'রুটিন বা একাডেমিক তথ্য আপডেট',
      }).catch(err => {
        console.error('Cloud sync failed:', err);
        showNotice('ক্লাউড সিঙ্ক ব্যর্থ হয়েছে: আপনার এডমিন অ্যাক্সেস যাচাই করুন।');
      });
    },
    [canEdit, email, displayName, isSuperAdmin, showNotice]
  );

  const handleUndo = useCallback(() => {
    if (!canEdit || !email) return;
    const prevPast = pastRef.current;
    if (prevPast.length === 0) return;

    const previousState = prevPast[prevPast.length - 1];
    const currentData = latestDataRef.current;
    const nextPast = prevPast.slice(0, -1);
    const nextFuture = [currentData, ...futureRef.current.slice(0, MAX_HISTORY - 1)];

    latestDataRef.current = previousState;
    pastRef.current = nextPast;
    futureRef.current = nextFuture;

    setData(previousState);
    setPast(nextPast);
    setFuture(nextFuture);
    saveStoredData(previousState);
    showNotice('পূর্বের অবস্থায় ফিরে যাওয়া হয়েছে (Undo)।');

    const actorRole: 'super_admin' | 'admin' = isSuperAdmin ? 'super_admin' : 'admin';
    void saveRoutineToCloud({
      state: previousState,
      actorEmail: email,
      actorName: displayName,
      actorRole,
      auditAction: 'routine_update',
      auditSummary: 'রুটিন পূর্বের অবস্থায় ফিরিয়ে নেওয়া হয়েছে (Undo)',
    }).catch(err => {
      console.error('Undo cloud sync failed:', err);
    });
  }, [canEdit, email, displayName, isSuperAdmin, showNotice]);

  const handleRedo = useCallback(() => {
    if (!canEdit || !email) return;
    const prevFuture = futureRef.current;
    if (prevFuture.length === 0) return;

    const [nextState, ...restFuture] = prevFuture;
    const currentData = latestDataRef.current;
    const nextPast = [...pastRef.current.slice(-(MAX_HISTORY - 1)), currentData];

    latestDataRef.current = nextState;
    pastRef.current = nextPast;
    futureRef.current = restFuture;

    setData(nextState);
    setPast(nextPast);
    setFuture(restFuture);
    saveStoredData(nextState);
    showNotice('পরিবর্তনটি পুনরায় প্রয়োগ করা হয়েছে (Redo)।');

    const actorRole: 'super_admin' | 'admin' = isSuperAdmin ? 'super_admin' : 'admin';
    void saveRoutineToCloud({
      state: nextState,
      actorEmail: email,
      actorName: displayName,
      actorRole,
      auditAction: 'routine_update',
      auditSummary: 'রুটিন পরিবর্তন পুনরায় প্রয়োগ করা হয়েছে (Redo)',
    }).catch(err => {
      console.error('Redo cloud sync failed:', err);
    });
  }, [canEdit, email, displayName, isSuperAdmin, showNotice]);

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
    commitData(
      prev => {
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
      },
      partnerEntry ? 'সমান্তরাল পিরিয়ডসহ রুটিন সংরক্ষিত হয়েছে।' : 'পিরিয়ড আপডেট সংরক্ষিত হয়েছে।',
      'routine_update',
      `স্লট আপডেট: ${newEntry.day} পিরিয়ড ${newEntry.periodIndex}`
    );
  };

  const handleClearSlot = (entryId: string) => {
    commitData(
      prev => ({
        ...prev,
        entries: prev.entries.filter(e => e.id !== entryId),
      }),
      'স্লটটি রুটিন থেকে সরানো হয়েছে।',
      'routine_update',
      'রুটিন থেকে একটি পিরিয়ড স্লট মুছে ফেলা হয়েছে'
    );
  };

  const handleClearSection = (classId: string, sectionId: string) => {
    commitData(
      prev => ({
        ...prev,
        entries: prev.entries.filter(e => !(e.classId === classId && e.sectionId === sectionId)),
      }),
      'সেকশনের রুটিন খালি করা হয়েছে।',
      'routine_update',
      `সেকশন রুটিন খালি করা হয়েছে (${classId})`
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
    if (!canEdit) {
      return { ok: false, reason: 'অনুমতি নেই: শুধুমাত্র Active Admin রুটিন বদল করতে পারবেন।' };
    }
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

        const allowedFixedPeriods = getEffectiveSubjectFixedPeriods(
          cls,
          sectionId,
          entry.subjectId,
          data.subjects
        );
        if (allowedFixedPeriods && allowedFixedPeriods.length > 0 && !allowedFixedPeriods.includes(targetPeriod)) {
          const subName = subjectMap.get(entry.subjectId)?.name || 'এই বিষয়';
          return `"${subName}" বিষয়টি শুধুমাত্র নির্ধারিত পিরিয়ডে (${allowedFixedPeriods.map(p => `P${p}`).join(', ')}) রাখা যাবে — P${targetPeriod}-এ বদল করা সম্ভব নয়।`;
        }

        const isHinduCombined =
          isHinduReligionSubject(entry.subjectId, data.subjects) &&
          isHinduReligionRoom(entry.room || getCombinedHinduRoom(data.settings), data.settings);
        const maxRelConcurrent = getMaxReligionConcurrentSections(data.settings);

        if (entry.teacherId) {
          const teacherObj = teacherMap.get(entry.teacherId);
          if (teacherObj && isTeacherBlockedAtSlot(teacherObj, targetDay, targetPeriod)) {
            return `${teacherObj.name}-এর জন্য ${targetDay} (P${targetPeriod}) বন্ধ/অবসর পিরিয়ড হিসেবে নির্ধারিত রয়েছে।`;
          }

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

    commitData(
      prev => {
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
      },
      `${dayA} (P${periodA}) ও ${dayB} (P${periodB}) সফলভাবে বদল হয়েছে।`,
      'routine_update',
      `স্লট বদল: ${cls.name} — ${dayA}(P${periodA}) ↔ ${dayB}(P${periodB})`
    );

    return { ok: true };
  };

  const handleUpdateTeachers = (updatedTeachers: Teacher[]) => {
    commitData(
      prev => {
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
      },
      'শিক্ষকের তথ্য আপডেট হয়েছে।',
      'teacher_update',
      `শিক্ষক তালিকা আপডেট (${updatedTeachers.length} জন)`
    );
    if (updatedTeachers.length > 0 && !updatedTeachers.some(t => t.id === selectedTeacherId)) {
      setSelectedTeacherId(updatedTeachers[0].id);
    }
  };

  const handleUpdateClasses = (updatedClasses: SchoolClass[]) => {
    commitData(
      prev => {
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
      },
      'শ্রেণি ও সেকশন কনফিগারেশন আপডেট হয়েছে।',
      'class_update',
      `শ্রেণি ও সেকশন কনফিগারেশন আপডেট (${updatedClasses.length}টি শ্রেণি)`
    );
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
    }, 'সেকশন-ভিত্তিক বিষয় নির্বাচন সংরক্ষিত হয়েছে।', 'class_update', `সেকশন বিষয় নির্বাচন আপডেট (${classId})`);
  };

  // Strictly isolated section-level quota, teacher & fixed-period config updater (NEVER copies to sibling sections)
  const handleUpdateSectionSubjectConfig = (
    classId: string,
    sectionId: string,
    subjectId: string,
    patch: { periodsPerWeek?: number; assignedTeacherId?: string; fixedPeriodIndices?: number[] }
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
            const hasFixedPatch = 'fixedPeriodIndices' in patch;
            const nextFixedPeriods = hasFixedPatch
              ? patch.fixedPeriodIndices
              : curCfg.fixedPeriodIndices;
            return {
              ...sec,
              subjectConfigs: {
                ...prevConfigs,
                [subjectId]: {
                  periodsPerWeek: nextPeriods,
                  assignedTeacherId: nextTeacherId,
                  ...(nextFixedPeriods !== undefined ? { fixedPeriodIndices: nextFixedPeriods } : {}),
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
    }, 'সেকশন-ভিত্তিক বিষয়, শিক্ষক ও পিরিয়ড কনফিগারেশন সংরক্ষিত হয়েছে।', 'class_update', `সেকশন বিষয় কোটা/শিক্ষক/পিরিয়ড নির্ধারণ (${classId})`);
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
    }, 'বিষয়টি সম্পূর্ণ ডেটাবেস থেকে মুছে ফেলা হয়েছে।', 'subject_update', `বিষয় অপসারণ (${subjectId})`);
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
    }, 'শ্রেণি থেকে বিষয়টি সরানো হয়েছে।', 'subject_update', `শ্রেণি থেকে বিষয় সরানো হয়েছে (${classId})`);
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
    }, 'শিক্ষকের তথ্য তালিকা থেকে সরানো হয়েছে।', 'teacher_update', `শিক্ষক তালিকা থেকে অপসারণ (${teacherId})`);

    setSelectedTeacherId(currentId => {
      if (currentId === teacherId) {
        const remaining = data.teachers.filter(t => t.id !== teacherId);
        return remaining[0]?.id || '';
      }
      return currentId;
    });
  };

  const handleAutoGenerateSection = (classId: string, sectionId: string) => {
    if (!canEdit) return;
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
    commitData(
      prev => ({ ...prev, entries: result.entries }),
      notice,
      'routine_generate',
      `সেকশন অটো-রুটিন তৈরি (${classId})`
    );
  };

  const handleAutoGenerateClass = (classId: string) => {
    if (!canEdit) return;
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
    commitData(
      prev => ({ ...prev, entries: result.entries }),
      notice,
      'routine_generate',
      `শ্রেণি অটো-রুটিন তৈরি (${classId})`
    );
  };

  const handleExecuteGenerate = (options: GenerationOptions): GenerationResult => {
    if (!canEdit) {
      throw new Error('অনুমতি নেই: শুধুমাত্র Active Admin বা Super Admin রুটিন তৈরি করতে পারবেন।');
    }
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
    commitData(
      prev => ({ ...prev, entries: result.entries }),
      notice,
      'routine_generate',
      `অটো-জেনারেটর চালানো হয়েছে (${options.scope})`
    );
    return result;
  };

  const handleAutoFixRoutine = (): GenerationResult => {
    if (!canEdit) {
      throw new Error('অনুমতি নেই: শুধুমাত্র Active Admin বা Super Admin Auto Fix চালাতে পারবেন।');
    }
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
    commitData(
      prev => ({ ...prev, entries: result.entries }),
      notice,
      'routine_autofix',
      'রুটিন কনফ্লিক্ট Auto Fix সম্পন্ন'
    );
    return result;
  };

  const handleResetToDefaults = () => {
    if (!canEdit) return;
    const fresh = resetToDefaults();
    commitData(() => fresh, 'ডিফল্ট রুটিন পুনরায় লোড হয়েছে।', 'routine_reset', 'রুটিন ডিফল্ট অবস্থায় রিসেট করা হয়েছে');
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
    }, 'ফাইল থেকে রুটিন ডেটা সফলভাবে যুক্ত হয়েছে।', 'routine_import', `ফাইল ইম্পোর্ট (${mode}, ${importedEntries.length} স্লট)`);

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
    commitData(() => newState, 'ব্যাকআপ ডেটা রিস্টোর সম্পন্ন হয়েছে।', 'routine_import', 'JSON ব্যাকআপ রিস্টোর করা হয়েছে');
    if (newState.classes[0]) setSelectedClassId(newState.classes[0].id);
    if (newState.teachers[0]) setSelectedTeacherId(newState.teachers[0].id);
  };

  const routeAccessDenied = authReady && secretRouteRequested && !isSuperAdmin;

  const handleSelectTab = (tab: WorkspaceTab) => {
    if (tab === 'control-panel' && !isSuperAdmin) return;
    if ((tab === 'proxy' || tab === 'conflicts') && !canEdit) return;
    if (secretRouteRequested && tab !== 'control-panel') {
      handleReturnFromBlockedRoute();
    }
    setActiveTab(tab);
  };

  return (
    <div
      className={
        isMobileView
          ? 'min-h-screen bg-[#f7f5f0] md:bg-stone-200/75 dark:bg-[#0d1115] md:dark:bg-[#070a0d] md:py-4 md:px-4 font-sans transition-colors'
          : 'min-h-screen bg-[#f7f5f0] dark:bg-[#0d1115] text-stone-800 dark:text-stone-100 flex flex-col font-sans transition-colors'
      }
    >
      <div
        className={
          isMobileView
            ? 'w-full md:max-w-[430px] md:mx-auto bg-[#f7f5f0] dark:bg-[#0d1115] text-stone-800 dark:text-stone-100 min-h-screen md:min-h-[calc(100vh-2rem)] flex flex-col md:rounded-[2rem] md:border md:border-stone-200 md:dark:border-slate-800 md:shadow-2xl md:overflow-x-clip'
            : 'flex-1 flex flex-col'
        }
      >
      {/* Top 3-Zone Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        errorCount={errorCount}
        warningCount={warningCount}
        schoolName={data.settings.schoolName}
        academicYear={data.settings.academicYear}
        theme={theme}
        onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        canUndo={canEdit && past.length > 0}
        canRedo={canEdit && future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenAutoGenerate={() => canEdit && setIsAutoGenerateOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenSettings={() => canEdit && setIsSettingsOpen(true)}
        role={role}
        adminStatus={adminStatus}
        canEdit={canEdit}
        isSuperAdmin={isSuperAdmin}
        isAuthenticated={Boolean(firebaseUser)}
        userEmail={email}
        onOpenLogin={() => setIsLoginOpen(true)}
        onLogout={() => {
          void logout().then(() => {
            showNotice('সফলভাবে লগআউট হয়েছে।');
          });
        }}
      />

      {/* Instant Action Effect Alert Banner (Paused / Blocked / Removed / Unverified) */}
      {statusAlert && (
        <div
          className={`no-print border-b px-4 py-3 ${
            statusAlert.type === 'blocked' || statusAlert.type === 'removed'
              ? 'bg-rose-600 text-white border-rose-700'
              : 'bg-amber-500 text-slate-950 border-amber-600'
          }`}
        >
          <div className="max-w-[1440px] mx-auto flex items-start sm:items-center justify-between gap-4 text-xs">
            <div className="flex items-start sm:items-center gap-2.5">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <div className="font-bold">{statusAlert.title}</div>
                <div className="opacity-95 mt-0.5">
                  {statusAlert.message}
                  {statusAlert.reason ? ` (কারণ: ${statusAlert.reason})` : ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissStatusAlert}
              className="p-1 rounded-lg hover:bg-black/15 shrink-0"
              aria-label="Close status notice"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Persistent Conflict Alert Strip when collisions exist (Editors only) */}
      {canEdit && conflicts.length > 0 && activeTab !== 'conflicts' && !routeAccessDenied && (
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

      {/* Main 2-Column Workspace (Desktop) or Single-Column App Shell (Mobile) */}
      <div
        className={
          isMobileView
            ? 'flex-1 w-full px-3 py-4 pb-20 flex flex-col gap-4'
            : 'flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:flex-row gap-6'
        }
      >
        {isDesktopView && (
          <WorkspaceSidebar
            totalClasses={data.classes.length}
            totalTeachers={data.teachers.length}
            totalEntries={data.entries.length}
            errorCount={errorCount}
            warningCount={warningCount}
            canEdit={canEdit}
            isSuperAdmin={isSuperAdmin}
            onOpenLiveDashboard={() => setActiveTab('live')}
            onOpenClassMgmt={() => canEdit && setIsClassMgmtOpen(true)}
            onOpenTeacherMgmt={() => canEdit && setIsTeacherMgmtOpen(true)}
            onOpenSubjectMgmt={() => canEdit && setIsSubjectMgmtOpen(true)}
            onOpenSettings={() => canEdit && setIsSettingsOpen(true)}
            onOpenSmartImport={() => canEdit && setIsSmartImportOpen(true)}
            onOpenHelpAndInstall={() => setIsHelpAndInstallOpen(true)}
            onOpenCompliance={() => canEdit && setActiveTab('conflicts')}
            onOpenControlPanel={() => isSuperAdmin && setActiveTab('control-panel')}
          />
        )}

        <main className="flex-1 min-w-0">
          {routeAccessDenied ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900 p-8 text-center max-w-xl mx-auto my-8 space-y-4 shadow-sm">
              <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                <Lock className="w-7 h-7" />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                  403 — প্রবেশাধিকার সংরক্ষিত (Access Denied)
                </h1>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  কন্ট্রোল প্যানেল ও এডমিন ম্যানেজমেন্ট রাউট শুধুমাত্র নির্ধারিত <strong>Super Admin</strong> অ্যাকাউন্টের জন্য সংরক্ষিত। সাধারণ ব্যবহারকারী বা অন্য কোনো অ্যাকাউন্ট এখানে প্রবেশ করতে পারবে না।
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleReturnFromBlockedRoute}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold"
                >
                  প্রকাশিত রুটিনে ফিরে যান
                </button>
                {!firebaseUser && (
                  <button
                    type="button"
                    onClick={() => setIsLoginOpen(true)}
                    className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Super Admin লগইন</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'live' && (
                <LiveDashboardView
                  classes={data.classes}
                  teachers={data.teachers}
                  subjects={data.subjects}
                  workingDays={data.settings.workingDays}
                  periodTimings={data.settings.periodTimings}
                  entries={data.entries}
                  settings={data.settings}
                  onSelectClassSection={(cId, sId) => {
                    setSelectedClassId(cId);
                    setSelectedSectionId(sId);
                    setActiveTab('classes');
                  }}
                  onSelectTeacher={tId => {
                    setSelectedTeacherId(tId);
                    setActiveTab('teachers');
                  }}
                />
              )}

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
                  onOpenEditSlot={(classId, sectionId, day, periodIndex) => {
                    if (canEdit) setEditSlot({ classId, sectionId, day, periodIndex });
                  }}
                  onClearSlot={handleClearSlot}
                  onClearSection={handleClearSection}
                  onSwapSectionSlots={handleSwapSectionSlots}
                  onAutoGenerateSection={handleAutoGenerateSection}
                  onAutoGenerateClass={handleAutoGenerateClass}
                  onOpenSubjectMgmt={() => canEdit && setIsSubjectMgmtOpen(true)}
                  onUpdateSectionSubjects={handleUpdateSectionSubjects}
                  onUpdateSectionSubjectConfig={handleUpdateSectionSubjectConfig}
                  settings={data.settings}
                  fullAppState={data}
                  readOnly={!canEdit}
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
                  onOpenEditSlot={(classId, sectionId, day, periodIndex) => {
                    if (canEdit) setEditSlot({ classId, sectionId, day, periodIndex });
                  }}
                  onClearSlot={handleClearSlot}
                  fullAppState={data}
                  readOnly={!canEdit}
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
                  onOpenEditSlot={(classId, sectionId, day, periodIndex) => {
                    if (canEdit) setEditSlot({ classId, sectionId, day, periodIndex });
                  }}
                  readOnly={!canEdit}
                />
              )}

              {activeTab === 'proxy' && canEdit && (
                <ProxyRoutineView
                  settings={data.settings}
                  teachers={data.teachers}
                  classes={data.classes}
                  subjects={data.subjects}
                  periodTimings={data.settings.periodTimings}
                  entries={data.entries}
                />
              )}

              {activeTab === 'conflicts' && canEdit && (
                <ComplianceAuditPanel
                  classes={data.classes}
                  teachers={data.teachers}
                  subjects={data.subjects}
                  entries={data.entries}
                  conflicts={conflicts}
                  workingDays={data.settings.workingDays}
                  periodTimings={data.settings.periodTimings}
                  settings={data.settings}
                  onOpenAutoGenerate={() => canEdit && setIsAutoGenerateOpen(true)}
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

              {activeTab === 'control-panel' && isSuperAdmin && email && (
                <ControlPanelView
                  admins={admins}
                  auditLogs={auditLogs}
                  actorEmail={email}
                  actorName={displayName}
                  onNotice={showNotice}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer
        className={`no-print border-t border-stone-200 dark:border-slate-800 py-5 mt-auto bg-white/80 dark:bg-[#141a20]/80 ${
          isMobileView ? 'pb-24 px-3' : ''
        }`}
      >
        <div
          className={`${
            isMobileView ? 'px-1' : 'max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8'
          } flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-stone-500 dark:text-slate-400`}
        >
          <div className="flex items-center gap-2.5 flex-wrap justify-center sm:justify-start">
            <SchoolCrestLogo className="w-5 h-5 shrink-0" />
            <span className="font-semibold text-stone-700 dark:text-slate-300">
              {data.settings.schoolName}
            </span>
            <span>·</span>
            <span>Academic Year: {data.settings.academicYear}</span>
            <span>·</span>
            <span>Principal: {data.settings.principalName}</span>
          </div>
          <div>
            একাডেমিক টাইমটেবিল ও ক্যাম্পাস রুটিন ম্যানেজমেন্ট
          </div>
        </div>
      </footer>

      {isMobileView && (
        <MobileNavigationDock
          activeTab={activeTab}
          setActiveTab={handleSelectTab}
          isOpenMenu={isMobileMenuOpen}
          setIsOpenMenu={setIsMobileMenuOpen}
          canEdit={canEdit}
          isSuperAdmin={isSuperAdmin}
          isAuthenticated={Boolean(firebaseUser)}
          userEmail={email}
          role={role}
          adminStatus={adminStatus}
          errorCount={errorCount}
          warningCount={warningCount}
          totalClasses={data.classes.length}
          totalTeachers={data.teachers.length}
          totalEntries={data.entries.length}
          onOpenClassMgmt={() => canEdit && setIsClassMgmtOpen(true)}
          onOpenTeacherMgmt={() => canEdit && setIsTeacherMgmtOpen(true)}
          onOpenSubjectMgmt={() => canEdit && setIsSubjectMgmtOpen(true)}
          onOpenSettings={() => canEdit && setIsSettingsOpen(true)}
          onOpenSmartImport={() => canEdit && setIsSmartImportOpen(true)}
          onOpenAutoGenerate={() => canEdit && setIsAutoGenerateOpen(true)}
          onOpenExport={() => setIsExportOpen(true)}
          onOpenHelpAndInstall={() => setIsHelpAndInstallOpen(true)}
          onOpenLogin={() => setIsLoginOpen(true)}
          onLogout={() => {
            void logout().then(() => {
              showNotice('সফলভাবে লগআউট হয়েছে।');
            });
          }}
        />
      )}

      {/* Non-blocking Action Toast with Quick Undo */}
      {actionNotice && (
        <div
          className={`no-print fixed right-4 sm:right-5 z-50 bg-slate-900 dark:bg-slate-800 text-white px-4 py-2.5 rounded-xl border border-slate-700 shadow-lg flex items-center gap-3 text-xs ${
            isMobileView ? 'bottom-20 left-4 md:left-auto' : 'bottom-5'
          }`}
        >
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
      {canEdit && editSlot && (
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

      {canEdit && (
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
      )}

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

      {canEdit && (
        <>
          <ClassManagementModal
            isOpen={isClassMgmtOpen}
            onClose={() => setIsClassMgmtOpen(false)}
            classes={data.classes}
            subjects={data.subjects}
            teachers={data.teachers}
            workingDays={data.settings.workingDays}
            periodTimings={data.settings.periodTimings}
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
            workingDays={data.settings.workingDays}
            periodTimings={data.settings.periodTimings}
            initialClassId={selectedClassId}
            onUpdateSubjects={updated =>
              commitData(
                prev => ({ ...prev, subjects: updated }),
                'বিষয়ের তালিকা আপডেট হয়েছে।',
                'subject_update',
                `বিষয়ের তালিকা আপডেট (${updated.length}টি বিষয়)`
              )
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
            workingDays={data.settings.workingDays}
            periodTimings={data.settings.periodTimings}
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
              commitData(
                prev => ({ ...prev, settings }),
                'বিদ্যালয় ও বেল সেটিংস সংরক্ষিত হয়েছে।',
                'settings_update',
                'বিদ্যালয়, পিরিয়ড ও বেল সেটিংস আপডেট'
              )
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
        </>
      )}

      <HelpAndInstallModal
        isOpen={isHelpAndInstallOpen}
        onClose={() => setIsHelpAndInstallOpen(false)}
        onOpenAutoGenerate={() => canEdit && setIsAutoGenerateOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenSmartImport={() => canEdit && setIsSmartImportOpen(true)}
        onOpenSettings={() => canEdit && setIsSettingsOpen(true)}
        canEdit={canEdit}
      />

      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
      />

      <OfflineIndicator />
      </div>
    </div>
  );
}
