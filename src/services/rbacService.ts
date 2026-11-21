import {
  collection,
  deleteDoc,
  doc,
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
  AuditActionType,
  AuditLogEntry,
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
