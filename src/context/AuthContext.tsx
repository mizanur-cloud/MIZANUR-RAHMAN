import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { AdminAccount, AdminStatus, UserRole } from '../types';
import { auth, googleProvider, SUPER_ADMIN_EMAIL } from '../services/firebase';
import { recordAdminSelfLogin, subscribeMyAdminRecord } from '../services/rbacService';

export interface StatusAlertInfo {
  type: 'paused' | 'blocked' | 'removed' | 'unverified';
  title: string;
  message: string;
  reason?: string;
}

interface AuthContextValue {
  firebaseUser: User | null;
  authReady: boolean;
  role: UserRole;
  adminStatus: AdminStatus | null;
  adminRecord: AdminAccount | null;
  canEdit: boolean;
  isSuperAdmin: boolean;
  displayName: string;
  email: string | null;
  statusAlert: StatusAlertInfo | null;
  dismissStatusAlert: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name: string) => Promise<string>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [adminRecord, setAdminRecord] = useState<AdminAccount | null>(null);
  const [adminLoaded, setAdminLoaded] = useState(false);
  const [statusAlert, setStatusAlert] = useState<StatusAlertInfo | null>(null);
  const prevAdminStatusRef = useRef<AdminStatus | null>(null);
  const hadAdminDocRef = useRef<boolean>(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setAdminRecord(null);
        setAdminLoaded(true);
        setStatusAlert(null);
        prevAdminStatusRef.current = null;
        hadAdminDocRef.current = false;
      } else {
        setAdminLoaded(false);
        const userEmail = (user.email || '').trim().toLowerCase();
        if (userEmail !== SUPER_ADMIN_EMAIL.toLowerCase() && !user.emailVerified) {
          setStatusAlert({
            type: 'unverified',
            title: 'ইমেইল ভেরিফিকেশন প্রয়োজন',
            message:
              'নিরাপত্তার জন্য আপনার ইমেইল ভেরিফাই করা হয়নি। ইনবক্সের ভেরিফিকেশন লিংকে ক্লিক করে পুনরায় লগইন করুন।',
          });
        }
      }
    });
    return () => unsub();
  }, []);

  // Real-time listener on current user's /admins/{emailKey} record for Instant Action Effect
  useEffect(() => {
    if (!authReady) return;
    if (!firebaseUser || !firebaseUser.email) {
      setAdminRecord(null);
      setAdminLoaded(true);
      return;
    }

    const cleanEmail = firebaseUser.email.trim().toLowerCase();
    if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
      setAdminRecord(null);
      setAdminLoaded(true);
      setStatusAlert(null);
      return;
    }

    if (!firebaseUser.emailVerified) {
      setAdminRecord(null);
      setAdminLoaded(true);
      return;
    }

    const unsub = subscribeMyAdminRecord(cleanEmail, (record, exists) => {
      setAdminRecord(record);
      setAdminLoaded(true);

      if (exists && record) {
        const prevStatus = prevAdminStatusRef.current;
        if (record.status === 'paused') {
          setStatusAlert({
            type: 'paused',
            title: 'এডমিন অ্যাক্সেস সাময়িকভাবে স্থগিত (Paused / Stopped)',
            message:
              'সুপার এডমিন আপনার এডমিন অ্যাক্সেস সাময়িকভাবে স্থগিত করেছেন। এই অবস্থায় কোনো রুটিন এডিট বা ম্যানেজমেন্ট কাজ করা যাবে না।',
            reason: record.statusReason,
          });
        } else if (record.status === 'blocked') {
          setStatusAlert({
            type: 'blocked',
            title: 'এডমিন অ্যাকাউন্ট ব্লক করা হয়েছে (Blocked)',
            message:
              'সুপার এডমিন আপনার অ্যাকাউন্টটি ব্লক করেছেন। আপনি শুধুমাত্র ভিউয়ার হিসেবে প্রকাশিত রুটিন দেখতে পারবেন।',
            reason: record.statusReason,
          });
        } else if (record.status === 'active') {
          if (prevStatus === 'paused' || prevStatus === 'blocked') {
            setStatusAlert(null);
          } else {
            setStatusAlert(null);
          }
          // Stamp uid & lastLoginAt if missing or on active sign-in
          if (firebaseUser.uid && record.uid !== firebaseUser.uid) {
            void recordAdminSelfLogin(cleanEmail, firebaseUser.uid);
          }
        }
        prevAdminStatusRef.current = record.status;
        hadAdminDocRef.current = true;
      } else {
        if (hadAdminDocRef.current) {
          setStatusAlert({
            type: 'removed',
            title: 'এডমিন অ্যাক্সেস অপসারণ করা হয়েছে (Removed)',
            message:
              'সুপার এডমিন আপনার এডমিন অনুমোদন সিস্টেম থেকে সরিয়ে দিয়েছেন। এখন থেকে আপনার অ্যাকাউন্ট সাধারণ ভিউয়ার হিসেবে কাজ করবে।',
          });
        }
        prevAdminStatusRef.current = null;
        hadAdminDocRef.current = false;
      }
    });

    return () => unsub();
  }, [authReady, firebaseUser]);

  const role: UserRole = useMemo(() => {
    if (!firebaseUser || !firebaseUser.email || !firebaseUser.emailVerified) {
      return 'viewer';
    }
    const cleanEmail = firebaseUser.email.trim().toLowerCase();
    if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
      return 'super_admin';
    }
    if (adminRecord && adminRecord.role === 'admin') {
      return 'admin';
    }
    return 'viewer';
  }, [firebaseUser, adminRecord]);

  const adminStatus: AdminStatus | null = useMemo(() => {
    if (role === 'super_admin') return 'active';
    if (role === 'admin' && adminRecord) return adminRecord.status;
    return null;
  }, [role, adminRecord]);

  const isSuperAdmin = role === 'super_admin';
  const canEdit =
    role === 'super_admin' || (role === 'admin' && adminRecord?.status === 'active');

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signInWithEmail = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (!cred.user.emailVerified && cred.user.email?.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
      await sendEmailVerification(cred.user).catch(() => {});
    }
  };

  const registerWithEmail = async (email: string, password: string, name: string): Promise<string> => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (name.trim()) {
      await updateProfile(cred.user, { displayName: name.trim() });
    }
    await sendEmailVerification(cred.user);
    return 'অ্যাকাউন্ট তৈরি হয়েছে। আপনার ইমেইলে একটি ভেরিফিকেশন লিংক পাঠানো হয়েছে — ভেরিফাই করার পর এডমিন সুবিধা চালু হবে।';
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const logout = async () => {
    setStatusAlert(null);
    await signOut(auth);
  };

  const value: AuthContextValue = {
    firebaseUser,
    authReady: authReady && adminLoaded,
    role,
    adminStatus,
    adminRecord,
    canEdit,
    isSuperAdmin,
    displayName:
      firebaseUser?.displayName ||
      adminRecord?.name ||
      firebaseUser?.email?.split('@')[0] ||
      'General Viewer',
    email: firebaseUser?.email?.toLowerCase() || null,
    statusAlert,
    dismissStatusAlert: () => setStatusAlert(null),
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    sendPasswordReset,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return ctx;
}
