import React, { useEffect, useState } from 'react';
import {
  X,
  Lock,
  Mail,
  Eye,
  EyeOff,
  UserPlus,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  LogIn,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { FIREBASE_PROJECT_ID } from '../services/firebase';
import { SchoolCrestLogo } from './SchoolCrestLogo';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose }) => {
  const { signInWithGoogle, signInWithEmail, registerWithEmail, sendPasswordReset } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [unauthorizedHost, setUnauthorizedHost] = useState<string | null>(null);
  const [providerDisabled, setProviderDisabled] = useState(false);
  const [copiedHost, setCopiedHost] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccess(null);
      setUnauthorizedHost(null);
      setProviderDisabled(false);
      setCopiedHost(false);
      setLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const firebaseAuthorizedDomainsUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/settings`;
  const firebaseProvidersUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`;

  const mapAuthError = (err: unknown): string => {
    const authErr = err as { code?: string; message?: string } | null;
    const code = authErr?.code || '';
    const msg = authErr?.message || '';

    setUnauthorizedHost(null);
    setProviderDisabled(false);

    if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
      setUnauthorizedHost(currentHost || window.location.host || '');
      return 'বর্তমান ওয়েব ঠিকানাটি (Domain) Firebase Authentication-এর অনুমোদিত তালিকায় যুক্ত নেই, তাই Google লগইন ব্লক হয়েছে।';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'লগইন পপ-আপটি সম্পূর্ণ হওয়ার আগেই বন্ধ করা হয়েছে। আবার চেষ্টা করুন।';
    }
    if (code === 'auth/popup-blocked') {
      return 'ব্রাউজার লগইন পপ-আপ ব্লক করেছে। অনুগ্রহ করে ব্রাউজারের Pop-up অনুমতি চালু করে আবার চেষ্টা করুন।';
    }
    if (code === 'auth/cancelled-popup-request') {
      return 'পূর্ববর্তী লগইন অনুরোধ বাতিল হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।';
    }
    if (code === 'auth/operation-not-allowed') {
      setProviderDisabled(true);
      return 'ইমেইল ও পাসওয়ার্ড সাইন-ইন বর্তমানে Firebase Console-এ সক্রিয় নেই। প্রবেশ করতে উপরের "Google দিয়ে নিরাপদ লগইন" বাটন ব্যবহার করুন, অথবা Firebase Console থেকে Email/Password চালু করুন।';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।';
    }
    if (code === 'auth/invalid-email') {
      return 'সঠিক ইমেইল ঠিকানা লিখুন।';
    }
    if (code === 'auth/weak-password') {
      return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।';
    }
    if (code === 'auth/email-already-in-use') {
      return 'এই ইমেইল দিয়ে ইতোমধ্যেই অ্যাকাউন্ট রয়েছে।';
    }
    if (code === 'auth/account-exists-with-different-credential') {
      return 'এই ইমেইলটি অন্য একটি সাইন-ইন পদ্ধতির সাথে যুক্ত রয়েছে। Google দিয়ে লগইন চেষ্টা করুন।';
    }
    if (code === 'auth/user-disabled') {
      return 'এই অ্যাকাউন্টটি সাময়িকভাবে নিষ্ক্রিয় করা হয়েছে।';
    }
    if (code === 'auth/network-request-failed') {
      return 'ইন্টারনেট সংযোগে সমস্যা হয়েছে। নেটওয়ার্ক যাচাই করে আবার চেষ্টা করুন।';
    }
    if (code === 'auth/too-many-requests') {
      return 'অতিরিক্ত চেষ্টার কারণে সাময়িকভাবে ব্লক করা হয়েছে। কিছুক্ষণ পর চেষ্টা করুন।';
    }
    return msg || 'লগইন করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।';
  };

  const handleCopyHost = () => {
    if (!unauthorizedHost) return;
    navigator.clipboard?.writeText(unauthorizedHost).then(() => {
      setCopiedHost(true);
      setTimeout(() => setCopiedHost(false), 2500);
    }).catch(() => {});
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setSuccess(null);
    setUnauthorizedHost(null);
    setProviderDisabled(false);
    setLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setUnauthorizedHost(null);
    setProviderDisabled(false);
    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
        onClose();
      } else if (mode === 'register') {
        const msg = await registerWithEmail(email, password, name);
        setSuccess(msg);
      } else {
        await sendPasswordReset(email);
        setSuccess('পাসওয়ার্ড রিসেট লিংক আপনার ইমেইলে পাঠানো হয়েছে।');
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between bg-[#f7f5f0] dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <SchoolCrestLogo className="w-9 h-9 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-stone-900 dark:text-white">
                নিরাপদ অ্যাকাউন্ট লগইন (RBAC)
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Super Admin ও অনুমোদিত Admin অ্যাক্সেস
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Primary Google Sign-In */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-800 dark:text-slate-100 font-semibold text-xs flex items-center justify-center gap-2.5 shadow-xs transition-colors disabled:opacity-60"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>Google দিয়ে নিরাপদ লগইন (Recommended)</span>
          </button>

          <div className="relative flex items-center">
            <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
            <span className="px-3 text-[11px] font-medium text-slate-400">অথবা ইমেইল ও পাসওয়ার্ড</span>
            <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setSuccess(null);
                setUnauthorizedHost(null);
                setProviderDisabled(false);
              }}
              className={`py-1.5 rounded-md transition-colors flex items-center justify-center gap-1 ${
                mode === 'login'
                  ? 'bg-white dark:bg-slate-900 text-[#145343] dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <LogIn className="w-3 h-3" />
              <span>লগইন</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
                setSuccess(null);
                setUnauthorizedHost(null);
                setProviderDisabled(false);
              }}
              className={`py-1.5 rounded-md transition-colors flex items-center justify-center gap-1 ${
                mode === 'register'
                  ? 'bg-white dark:bg-slate-900 text-[#145343] dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <UserPlus className="w-3 h-3" />
              <span>নতুন পাসওয়ার্ড</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setError(null);
                setSuccess(null);
                setUnauthorizedHost(null);
                setProviderDisabled(false);
              }}
              className={`py-1.5 rounded-md transition-colors flex items-center justify-center gap-1 ${
                mode === 'reset'
                  ? 'bg-white dark:bg-slate-900 text-[#145343] dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <KeyRound className="w-3 h-3" />
              <span>রিসেট</span>
            </button>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs space-y-2.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                <span className="leading-relaxed">{error}</span>
              </div>

              {unauthorizedHost && (
                <div className="pt-2 border-t border-rose-200/80 dark:border-rose-800/60 space-y-2 text-[11px]">
                  <div className="font-semibold text-rose-900 dark:text-rose-100">
                    সমাধানের ধাপ (১০ সেকেন্ড):
                  </div>
                  <div className="flex items-center justify-between gap-2 bg-white/90 dark:bg-slate-900/80 border border-rose-200 dark:border-rose-800 rounded-lg px-2.5 py-1.5">
                    <code className="text-[11px] font-mono text-slate-800 dark:text-slate-200 truncate">
                      {unauthorizedHost}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyHost}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/60 dark:hover:bg-rose-900 text-rose-800 dark:text-rose-100 font-semibold transition-colors"
                    >
                      {copiedHost ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedHost ? 'কপি হয়েছে' : 'কপি'}</span>
                    </button>
                  </div>
                  <ol className="list-decimal list-inside space-y-0.5 text-rose-900/90 dark:text-rose-200/90 leading-relaxed">
                    <li>উপরের ডোমেইন নামটি কপি করুন।</li>
                    <li>নিচের বাটনে গিয়ে Authentication → Settings → Authorized domains খুলুন।</li>
                    <li>Add domain-এ ডোমেইনটি সেভ করে আবার Google দিয়ে লগইন করুন।</li>
                  </ol>
                  <a
                    href={firebaseAuthorizedDomainsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold transition-colors"
                  >
                    <span>Firebase Authorized Domains খুলুন</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {providerDisabled && (
                <div className="pt-2 border-t border-rose-200/80 dark:border-rose-800/60">
                  <a
                    href={firebaseProvidersUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-semibold transition-colors"
                  >
                    <span>Firebase Sign-in Providers খুলুন</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  পূর্ণ নাম
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="যেমন: মো. করিম"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#145343]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                ইমেইল ঠিকানা
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@school.edu"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#145343]"
                />
              </div>
            </div>

            {mode !== 'reset' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  পাসওয়ার্ড
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="কমপক্ষে ৬ অক্ষর"
                    className="w-full pl-9 pr-9 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#145343]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-[#145343] hover:bg-[#0f3f33] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white text-xs font-bold transition-colors disabled:opacity-60"
            >
              {loading
                ? 'অপেক্ষা করুন...'
                : mode === 'login'
                ? 'লগইন করুন'
                : mode === 'register'
                ? 'পাসওয়ার্ড অ্যাকাউন্ট তৈরি করুন'
                : 'রিসেট লিংক পাঠান'}
            </button>
          </form>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            সাধারণ শিক্ষার্থী, অভিভাবক বা শিক্ষকদের জন্য রুটিন দেখতে লগইন বাধ্যতামূলক নয় (Read-Only)। শুধুমাত্র সুপার এডমিন কর্তৃক অনুমোদিত এডমিনরাই লগইন করে রুটিন এডিট করতে পারবেন।
          </p>
        </div>
      </div>
    </div>
  );
};
