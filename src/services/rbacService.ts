import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  Unsubscribe,
} from 'firebase/firestore';
import {
  AdminAccount,
  AdminStatus,
  AnnualSubjectPlan,
  AnnualTopicItem,
  AuditActionType,
  AuditLogEntry,
  DailyAbsenceRecord,
  DayOfWeek,
  LessonPlanFileDoc,
  LessonPlanFileMeta,
  ProxyLogEntry,
  ProxyLogStatus,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import { AppState } from './storage';
import {
  auth,
  db,
  emailToDocId,
  handleFirestoreError,
  OperationType,
  stripUndefined,
  SUPER_ADMIN_EMAIL,
} from './firebase';

export interface PublishedRoutineMetadata {
  classes: SchoolClass[];
  teachers: Teacher[];
  subjects: Subject[];
  settings: SchoolSettings;
  updatedAt?: any;
  updatedByEmail?: string;
  updatedByName?: string;
}

export interface PublishedRoutineSchedule {
  entries: TimetableEntry[];
  updatedAt?: any;
  updatedByEmail?: string;
  updatedByName?: string;
}

export type StaffContactMap = Record<string, { email?: string; phone?: string }>;

function sanitizeTeacherForPublic(t: Teacher): Teacher {
  const { email: _email, phone: _phone, ...publicTeacher } = t;
  return stripUndefined(publicTeacher) as Teacher;
}

function extractStaffContacts(teachers: Teacher[]): StaffContactMap {
  const contacts: StaffContactMap = {};
  for (const t of teachers) {
    const cleanEmail = t.email?.trim();
    const cleanPhone = t.phone?.trim();
    if (cleanEmail || cleanPhone) {
      contacts[t.id] = stripUndefined({
        ...(cleanEmail ? { email: cleanEmail } : {}),
        ...(cleanPhone ? { phone: cleanPhone } : {}),
      });
    }
  }
  return contacts;
}

export function subscribePublishedRoutine(
  onMetadata: (meta: PublishedRoutineMetadata | null) => void,
  onSchedule: (sched: PublishedRoutineSchedule | null) => void,
  onSyncError?: (msg: string) => void
): () => void {
  const metaPath = 'routine_public/metadata';
  const schedPath = 'routine_public/schedule';

  const unsubMeta = onSnapshot(
    doc(db, 'routine_public', 'metadata'),
    snap => {
      onMetadata(snap.exists() ? (snap.data() as PublishedRoutineMetadata) : null);
    },
    err => {
      console.error('Metadata snapshot error:', err);
      onSyncError?.('প্রকাশিত রুটিন মেটাডেটা সিঙ্ক করতে সমস্যা হয়েছে।');
      try {
        handleFirestoreError(err, OperationType.GET, metaPath);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  );

  const unsubSched = onSnapshot(
    doc(db, 'routine_public', 'schedule'),
    snap => {
      onSchedule(snap.exists() ? (snap.data() as PublishedRoutineSchedule) : null);
    },
    err => {
      console.error('Schedule snapshot error:', err);
      onSyncError?.('প্রকাশিত রুটিন সিডিউল সিঙ্ক করতে সমস্যা হয়েছে।');
      try {
        handleFirestoreError(err, OperationType.GET, schedPath);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  );

  return () => {
    unsubMeta();
    unsubSched();
  };
}

export function subscribeStaffContacts(
  enabled: boolean,
  onContacts: (contacts: StaffContactMap) => void
): Unsubscribe {
  if (!enabled) {
    return () => {};
  }
  const path = 'routine_private/staff_contacts';
  return onSnapshot(
    doc(db, 'routine_private', 'staff_contacts'),
    snap => {
      if (snap.exists()) {
        const data = snap.data() as { contacts?: StaffContactMap };
        onContacts(data.contacts || {});
      }
    },
    err => {
      try {
        handleFirestoreError(err, OperationType.GET, path);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  );
}

export async function recordAuditLog(params: {
  action: AuditActionType;
  targetSummary: string;
  actorEmail: string;
  actorName: string;
  actorRole: 'super_admin' | 'admin';
}): Promise<void> {
  const id = `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const path = `audit_logs/${id}`;
  const cleanEmail = params.actorEmail.trim().toLowerCase().slice(0, 160);
  const cleanName = (params.actorName.trim() || cleanEmail).slice(0, 100);
  const cleanSummary = (params.targetSummary.trim() || params.action).slice(0, 400);

  try {
    await setDoc(doc(db, 'audit_logs', id), {
      id,
      action: params.action,
      targetSummary: cleanSummary,
      actorEmail: cleanEmail,
      actorName: cleanName,
      actorRole: params.actorRole,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function saveRoutineToCloud(params: {
  state: AppState;
  actorEmail: string;
  actorName: string;
  actorRole: 'super_admin' | 'admin';
  auditAction: AuditActionType;
  auditSummary: string;
}): Promise<void> {
  const { state, actorEmail, actorName, actorRole, auditAction, auditSummary } = params;
  const cleanEmail = actorEmail.trim().toLowerCase().slice(0, 160);
  const cleanName = (actorName.trim() || cleanEmail).slice(0, 100);

  const publicClasses = stripUndefined(state.classes).slice(0, 30);
  const publicTeachers = state.teachers.slice(0, 200).map(sanitizeTeacherForPublic);
  const publicSubjects = stripUndefined(state.subjects).slice(0, 100);
  const publicSettings = stripUndefined(state.settings);
  const publicEntries = stripUndefined(state.entries).slice(0, 4000);
  const privateContacts = extractStaffContacts(state.teachers.slice(0, 200));

  try {
    await setDoc(doc(db, 'routine_public', 'metadata'), {
      classes: publicClasses,
      teachers: publicTeachers,
      subjects: publicSubjects,
      settings: publicSettings,
      updatedAt: serverTimestamp(),
      updatedByEmail: cleanEmail,
      updatedByName: cleanName,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'routine_public/metadata');
  }

  try {
    await setDoc(doc(db, 'routine_public', 'schedule'), {
      entries: publicEntries,
      updatedAt: serverTimestamp(),
      updatedByEmail: cleanEmail,
      updatedByName: cleanName,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'routine_public/schedule');
  }

  try {
    await setDoc(doc(db, 'routine_private', 'staff_contacts'), {
      contacts: privateContacts,
      updatedAt: serverTimestamp(),
      updatedByEmail: cleanEmail,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'routine_private/staff_contacts');
  }

  await recordAuditLog({
    action: auditAction,
    targetSummary: auditSummary,
    actorEmail: cleanEmail,
    actorName: cleanName,
    actorRole,
  });
}

export function subscribeMyAdminRecord(
  email: string | null | undefined,
  onRecord: (record: AdminAccount | null, exists: boolean) => void
): Unsubscribe {
  if (!email) {
    onRecord(null, false);
    return () => {};
  }
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
    onRecord(null, false);
    return () => {};
  }
  const docId = emailToDocId(cleanEmail);
  const path = `admins/${docId}`;
  return onSnapshot(
    doc(db, 'admins', docId),
    snap => {
      if (snap.exists()) {
        onRecord(snap.data() as AdminAccount, true);
      } else {
        onRecord(null, false);
      }
    },
    err => {
      try {
        handleFirestoreError(err, OperationType.GET, path);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  );
}

export async function recordAdminSelfLogin(email: string, uid: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase()) return;
  const docId = emailToDocId(cleanEmail);
  const path = `admins/${docId}`;
  try {
    await updateDoc(doc(db, 'admins', docId), {
      uid: uid.slice(0, 128),
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Expected to be skipped if admin is paused/blocked or doc doesn't exist
  }
}

export function subscribeAllAdmins(
  isSuperAdmin: boolean,
  onAdmins: (admins: AdminAccount[]) => void
): Unsubscribe {
  if (!isSuperAdmin) {
    onAdmins([]);
    return () => {};
  }
  const path = 'admins';
  const q = query(collection(db, 'admins'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => d.data() as AdminAccount);
      onAdmins(list);
    },
    err => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  );
}

export function subscribeAuditLogs(
  isSuperAdmin: boolean,
  onLogs: (logs: AuditLogEntry[]) => void
): Unsubscribe {
  if (!isSuperAdmin) {
    onLogs([]);
    return () => {};
  }
  const path = 'audit_logs';
  const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100));
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => d.data() as AuditLogEntry);
      onLogs(list);
    },
    err => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  );
}

export async function addAdminAccount(params: {
  email: string;
  name: string;
  designation?: string;
  initialStatus?: AdminStatus;
  actorEmail: string;
  actorName: string;
}): Promise<void> {
  const cleanEmail = params.email.trim().toLowerCase().slice(0, 160);
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('সঠিক ইমেইল ঠিকানা প্রদান করুন।');
  }
  if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('নির্ধারিত সুপার এডমিন ইমেইলটি আগে থেকেই সর্বোচ্চ ক্ষমতায় রয়েছে।');
  }

  const docId = emailToDocId(cleanEmail);
  const path = `admins/${docId}`;
  const cleanName = params.name.trim().slice(0, 100);
  if (!cleanName) {
    throw new Error('এডমিনের নাম লিখুন।');
  }

  const status: AdminStatus = params.initialStatus || 'active';
  const payload = stripUndefined({
    id: docId,
    email: cleanEmail,
    name: cleanName,
    ...(params.designation?.trim() ? { designation: params.designation.trim().slice(0, 100) } : {}),
    role: 'admin' as const,
    status,
    statusReason: status === 'active' ? '' : 'সুপার এডমিন কর্তৃক প্রাথমিক স্ট্যাটাস নির্ধারিত',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByEmail: params.actorEmail.trim().toLowerCase().slice(0, 160),
  });

  try {
    await setDoc(doc(db, 'admins', docId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  await recordAuditLog({
    action: 'admin_added',
    targetSummary: `নতুন এডমিন যুক্ত: ${cleanName} (${cleanEmail}) — স্ট্যাটাস: ${status}`,
    actorEmail: params.actorEmail,
    actorName: params.actorName,
    actorRole: 'super_admin',
  });
}

export async function updateAdminStatus(params: {
  adminId: string;
  adminEmail: string;
  adminName: string;
  nextStatus: AdminStatus;
  reason?: string;
  actorEmail: string;
  actorName: string;
}): Promise<void> {
  const path = `admins/${params.adminId}`;
  const cleanReason = (params.reason || '').trim().slice(0, 300);

  try {
    await updateDoc(doc(db, 'admins', params.adminId), {
      status: params.nextStatus,
      statusReason: cleanReason,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }

  const actionMap: Record<AdminStatus, AuditActionType> = {
    active: 'admin_activated',
    paused: 'admin_paused',
    blocked: 'admin_blocked',
  };

  const labelMap: Record<AdminStatus, string> = {
    active: 'সক্রিয় (Active)',
    paused: 'সাময়িক স্থগিত (Paused/Stopped)',
    blocked: 'ব্লক (Blocked)',
  };

  await recordAuditLog({
    action: actionMap[params.nextStatus],
    targetSummary: `${params.adminName} (${params.adminEmail}) → ${labelMap[params.nextStatus]}${
      cleanReason ? ` | কারণ: ${cleanReason}` : ''
    }`,
    actorEmail: params.actorEmail,
    actorName: params.actorName,
    actorRole: 'super_admin',
  });
}

export async function removeAdminAccount(params: {
  adminId: string;
  adminEmail: string;
  adminName: string;
  actorEmail: string;
  actorName: string;
}): Promise<void> {
  const path = `admins/${params.adminId}`;
  try {
    await deleteDoc(doc(db, 'admins', params.adminId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }

  await recordAuditLog({
    action: 'admin_removed',
    targetSummary: `এডমিন অপসারণ (Removed): ${params.adminName} (${params.adminEmail})`,
    actorEmail: params.actorEmail,
    actorName: params.actorName,
    actorRole: 'super_admin',
  });
}

export async function getFreshIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export function subscribeProxyLogs(
  canAccess: boolean,
  onLogs: (logs: ProxyLogEntry[]) => void
): Unsubscribe {
  if (!canAccess) {
    onLogs([]);
    return () => {};
  }
  const path = 'proxy_logs';
  const q = query(collection(db, 'proxy_logs'), orderBy('date', 'desc'), limit(500));
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => d.data() as ProxyLogEntry);
      onLogs(list);
    },
    err => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  );
}

export async function saveProxyLogToCloud(params: {
  log: ProxyLogEntry;
  isNew: boolean;
  actorEmail: string;
  actorName: string;
  actorRole: 'super_admin' | 'admin';
}): Promise<void> {
  const { log, isNew, actorEmail, actorName, actorRole } = params;
  const cleanEmail = actorEmail.trim().toLowerCase().slice(0, 160);
  const cleanName = (actorName.trim() || cleanEmail).slice(0, 100);
  const path = `proxy_logs/${log.id}`;

  const basePayload = stripUndefined({
    id: log.id.slice(0, 160),
    date: log.date.slice(0, 10),
    day: log.day,
    periodIndex: Number(log.periodIndex),
    periodLabel: (log.periodLabel || `Period ${log.periodIndex}`).slice(0, 60),
    periodTime: (log.periodTime || '').slice(0, 60),
    classId: log.classId.slice(0, 100),
    className: log.className.slice(0, 100),
    sectionId: log.sectionId.slice(0, 100),
    sectionName: log.sectionName.slice(0, 100),
    subjectId: log.subjectId.slice(0, 100),
    subjectName: log.subjectName.slice(0, 120),
    ...(log.subjectColor ? { subjectColor: log.subjectColor.slice(0, 30) } : {}),
    absentTeacherId: log.absentTeacherId.slice(0, 100),
    absentTeacherName: log.absentTeacherName.slice(0, 120),
    proxyTeacherId: log.proxyTeacherId.slice(0, 100),
    proxyTeacherName: log.proxyTeacherName.slice(0, 120),
    assignedByEmail: (isNew ? cleanEmail : log.assignedByEmail || cleanEmail).slice(0, 160),
    assignedByName: (isNew ? cleanName : log.assignedByName || cleanName).slice(0, 100),
    assignedByRole: isNew ? actorRole : log.assignedByRole || actorRole,
    status: log.status,
    ...(log.room ? { room: log.room.slice(0, 80) } : {}),
    ...(log.matchType ? { matchType: log.matchType } : {}),
    ...(log.matchReason ? { matchReason: log.matchReason.slice(0, 200) } : {}),
    ...(log.overriddenWarning ? { overriddenWarning: log.overriddenWarning.slice(0, 400) } : {}),
  });

  try {
    if (isNew) {
      await setDoc(doc(db, 'proxy_logs', log.id), {
        ...basePayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(
        doc(db, 'proxy_logs', log.id),
        stripUndefined({
          proxyTeacherId: basePayload.proxyTeacherId,
          proxyTeacherName: basePayload.proxyTeacherName,
          status: basePayload.status,
          matchType: basePayload.matchType,
          matchReason: basePayload.matchReason,
          overriddenWarning: basePayload.overriddenWarning,
          absentTeacherId: basePayload.absentTeacherId,
          absentTeacherName: basePayload.absentTeacherName,
          room: basePayload.room,
          updatedAt: serverTimestamp(),
        })
      );
    }
  } catch (err) {
    handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }

  await recordAuditLog({
    action: isNew ? 'proxy_assigned' : 'proxy_updated',
    targetSummary: `প্রক্সি ${isNew ? 'বরাদ্দ' : 'আপডেট'} (${log.date}, P${log.periodIndex}): ${log.className} (${log.sectionName}) — ${log.absentTeacherName} → ${log.proxyTeacherName}${
      log.overriddenWarning ? ` [Override: ${log.overriddenWarning.slice(0, 80)}]` : ''
    }`,
    actorEmail: cleanEmail,
    actorName: cleanName,
    actorRole,
  });
}

export async function updateProxyLogStatusInCloud(params: {
  logId: string;
  status: ProxyLogStatus;
  summary: string;
  actorEmail: string;
  actorName: string;
  actorRole: 'super_admin' | 'admin';
}): Promise<void> {
  const path = `proxy_logs/${params.logId}`;
  try {
    await updateDoc(doc(db, 'proxy_logs', params.logId), {
      status: params.status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }

  await recordAuditLog({
    action: 'proxy_updated',
    targetSummary: params.summary,
    actorEmail: params.actorEmail,
    actorName: params.actorName,
    actorRole: params.actorRole,
  });
}

export async function deleteProxyLogFromCloud(params: {
  logId: string;
  summary: string;
  actorEmail: string;
  actorName: string;
  actorRole: 'super_admin' | 'admin';
}): Promise<void> {
  const path = `proxy_logs/${params.logId}`;
  try {
    await deleteDoc(doc(db, 'proxy_logs', params.logId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }

  await recordAuditLog({
    action: 'proxy_deleted',
    targetSummary: params.summary,
    actorEmail: params.actorEmail,
    actorName: params.actorName,
    actorRole: params.actorRole,
  });
}

export function subscribeDailyAbsences(
  canAccess: boolean,
  onAbsences: (map: Record<string, DailyAbsenceRecord>) => void
): Unsubscribe {
  if (!canAccess) {
    onAbsences({});
    return () => {};
  }
  const path = 'daily_absences';
  const q = query(collection(db, 'daily_absences'), orderBy('date', 'desc'), limit(120));
  return onSnapshot(
    q,
    snap => {
      const nextMap: Record<string, DailyAbsenceRecord> = {};
      snap.docs.forEach(d => {
        const rec = d.data() as DailyAbsenceRecord;
        if (rec?.date) nextMap[rec.date] = rec;
      });
      onAbsences(nextMap);
    },
    err => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  );
}

export async function saveDailyAbsenceToCloud(params: {
  date: string;
  day: DayOfWeek;
  absentTeacherIds: string[];
  actorEmail: string;
  actorName: string;
}): Promise<void> {
  const cleanEmail = params.actorEmail.trim().toLowerCase().slice(0, 160);
  const cleanName = (params.actorName.trim() || cleanEmail).slice(0, 100);
  const dateId = params.date.slice(0, 10);
  const path = `daily_absences/${dateId}`;

  try {
    await setDoc(doc(db, 'daily_absences', dateId), {
      id: dateId,
      date: dateId,
      day: params.day,
      absentTeacherIds: params.absentTeacherIds.slice(0, 200),
      updatedAt: serverTimestamp(),
      updatedByEmail: cleanEmail,
      updatedByName: cleanName,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

function sanitizeTopicsForCloud(topics: AnnualTopicItem[]): AnnualTopicItem[] {
  return topics.slice(0, 350).map((t, idx) =>
    stripUndefined({
      id: String(t.id || `top-${idx + 1}`).slice(0, 100),
      classNumber: Math.max(1, Math.min(500, Math.round(Number(t.classNumber) || idx + 1))),
      ...(t.date ? { date: String(t.date).slice(0, 20) } : {}),
      topic: String(t.topic || '').slice(0, 300),
      isCompleted: Boolean(t.isCompleted),
      ...(t.notes ? { notes: String(t.notes).slice(0, 400) } : {}),
    })
  );
}

function sanitizeFileRefsForCloud(fileRefs: LessonPlanFileMeta[]): LessonPlanFileMeta[] {
  return fileRefs.slice(0, 15).map(f =>
    stripUndefined({
      id: String(f.id).slice(0, 160),
      fileName: String(f.fileName || 'lesson-plan').slice(0, 160),
      mimeType: String(f.mimeType).slice(0, 120),
      fileSize: Math.max(1, Math.min(600000, Math.round(Number(f.fileSize) || 1))),
      uploadedAtIso: String(f.uploadedAtIso || new Date().toISOString()).slice(0, 40),
      uploadedByName: String(f.uploadedByName || 'Admin').slice(0, 100),
    })
  );
}

function buildSanitizedAnnualPlanDoc(plan: AnnualSubjectPlan, actorUid: string, actorName: string) {
  const cleanUid = (actorUid || auth.currentUser?.uid || 'admin').slice(0, 128);
  const cleanName = (actorName.trim() || 'Admin').slice(0, 100);
  const total = Math.max(1, Math.min(500, Math.round(Number(plan.totalClassesPlanned) || 1)));
  const completed = Math.max(0, Math.min(500, Math.round(Number(plan.completedClasses) || 0)));

  return {
    id: plan.id.slice(0, 160),
    academicYear: (plan.academicYear || '2026').slice(0, 40),
    classId: plan.classId.slice(0, 100),
    subjectId: plan.subjectId.slice(0, 100),
    totalClassesPlanned: total,
    completedClasses: completed,
    topics: sanitizeTopicsForCloud(plan.topics || []),
    fileRefs: sanitizeFileRefsForCloud(plan.fileRefs || []),
    updatedAt: serverTimestamp(),
    updatedByUid: cleanUid,
    updatedByName: cleanName,
  };
}

export function subscribeAnnualPlans(
  onPlans: (plans: AnnualSubjectPlan[]) => void,
  onSyncError?: (msg: string) => void
): Unsubscribe {
  const path = 'annual_plans';
  const q = query(collection(db, 'annual_plans'), limit(500));
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => d.data() as AnnualSubjectPlan);
      onPlans(list);
    },
    err => {
      console.error('Annual plans snapshot error:', err);
      onSyncError?.('বার্ষিক সিলেবাস ও লেসন প্ল্যান সিঙ্ক করতে সমস্যা হয়েছে।');
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  );
}

export async function saveAnnualPlanToCloud(params: {
  plan: AnnualSubjectPlan;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  actorRole: 'super_admin' | 'admin';
  summary: string;
}): Promise<void> {
  const path = `annual_plans/${params.plan.id}`;
  const payload = buildSanitizedAnnualPlanDoc(params.plan, params.actorUid, params.actorName);

  try {
    await setDoc(doc(db, 'annual_plans', params.plan.id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }

  await recordAuditLog({
    action: 'annual_plan_update',
    targetSummary: params.summary,
    actorEmail: params.actorEmail,
    actorName: params.actorName,
    actorRole: params.actorRole,
  });
}

export async function uploadLessonPlanFileToCloud(params: {
  plan: AnnualSubjectPlan;
  fileMeta: LessonPlanFileMeta;
  dataBase64: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  actorRole: 'super_admin' | 'admin';
  summary: string;
}): Promise<void> {
  const { plan, fileMeta, dataBase64, actorUid, actorEmail, actorName, actorRole, summary } = params;
  const cleanUid = (actorUid || auth.currentUser?.uid || '').slice(0, 128);
  const cleanName = (actorName.trim() || 'Admin').slice(0, 100);

  // Step 1: Ensure parent annual_plan doc exists BEFORE creating lesson_plan_files doc (enforces exists() rule)
  const parentPath = `annual_plans/${plan.id}`;
  try {
    const existingRefs = (plan.fileRefs || []).filter(r => r.id !== fileMeta.id);
    const preParentPayload = buildSanitizedAnnualPlanDoc(
      { ...plan, fileRefs: existingRefs },
      cleanUid,
      cleanName
    );
    await setDoc(doc(db, 'annual_plans', plan.id), preParentPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, parentPath);
  }

  // Step 2: Upload immutable file document in /lesson_plan_files/{fileId}
  const filePath = `lesson_plan_files/${fileMeta.id}`;
  try {
    await setDoc(doc(db, 'lesson_plan_files', fileMeta.id), {
      id: fileMeta.id.slice(0, 160),
      planId: plan.id.slice(0, 160),
      classId: plan.classId.slice(0, 100),
      subjectId: plan.subjectId.slice(0, 100),
      fileName: fileMeta.fileName.slice(0, 160),
      mimeType: fileMeta.mimeType,
      fileSize: Math.max(1, Math.min(600000, Math.round(fileMeta.fileSize))),
      dataBase64,
      uploadedAt: serverTimestamp(),
      uploadedByUid: cleanUid,
      uploadedByName: cleanName,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, filePath);
  }

  // Step 3: Update fileRefs on parent annual_plan
  try {
    const nextRefs = sanitizeFileRefsForCloud([
      fileMeta,
      ...(plan.fileRefs || []).filter(r => r.id !== fileMeta.id),
    ]);
    await updateDoc(doc(db, 'annual_plans', plan.id), {
      fileRefs: nextRefs,
      updatedAt: serverTimestamp(),
      updatedByUid: cleanUid,
      updatedByName: cleanName,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, parentPath);
  }

  await recordAuditLog({
    action: 'annual_plan_update',
    targetSummary: summary,
    actorEmail,
    actorName,
    actorRole,
  });
}

export async function fetchLessonPlanFileFromCloud(
  fileId: string
): Promise<LessonPlanFileDoc | null> {
  const path = `lesson_plan_files/${fileId}`;
  try {
    const snap = await getDoc(doc(db, 'lesson_plan_files', fileId));
    if (!snap.exists()) return null;
    return snap.data() as LessonPlanFileDoc;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return null;
  }
}

export async function deleteLessonPlanFileFromCloud(params: {
  plan: AnnualSubjectPlan;
  fileId: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  actorRole: 'super_admin' | 'admin';
  summary: string;
}): Promise<void> {
  const { plan, fileId, actorUid, actorEmail, actorName, actorRole, summary } = params;
  const filePath = `lesson_plan_files/${fileId}`;
  const planPath = `annual_plans/${plan.id}`;

  try {
    await deleteDoc(doc(db, 'lesson_plan_files', fileId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, filePath);
  }

  try {
    const nextPlanPayload = buildSanitizedAnnualPlanDoc(
      {
        ...plan,
        fileRefs: (plan.fileRefs || []).filter(f => f.id !== fileId),
      },
      actorUid,
      actorName
    );
    await setDoc(doc(db, 'annual_plans', plan.id), nextPlanPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, planPath);
  }

  await recordAuditLog({
    action: 'annual_plan_update',
    targetSummary: summary,
    actorEmail,
    actorName,
    actorRole,
  });
}
