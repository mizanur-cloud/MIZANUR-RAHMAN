import React, { useMemo, useState } from 'react';
import {
  Shield,
  UserPlus,
  PauseCircle,
  Ban,
  CheckCircle2,
  Trash2,
  Clock,
  Activity,
  Search,
  AlertTriangle,
  Lock,
  Mail,
  User,
  Briefcase,
} from 'lucide-react';
import { AdminAccount, AdminStatus, AuditLogEntry } from '../types';
import { SUPER_ADMIN_EMAIL } from '../services/firebase';
import {
  addAdminAccount,
  removeAdminAccount,
  updateAdminStatus,
} from '../services/rbacService';

interface ControlPanelViewProps {
  admins: AdminAccount[];
  auditLogs: AuditLogEntry[];
  actorEmail: string;
  actorName: string;
  onNotice: (msg: string) => void;
}

export const ControlPanelView: React.FC<ControlPanelViewProps> = ({
  admins,
  auditLogs,
  actorEmail,
  actorName,
  onNotice,
}) => {
  const [subTab, setSubTab] = useState<'admins' | 'logs'>('admins');

  // Add Admin form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDesignation, setNewDesignation] = useState('');
  const [newInitialStatus, setNewInitialStatus] = useState<AdminStatus>('active');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filter & reason modal state
  const [adminSearch, setAdminSearch] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [statusReasonPrompt, setStatusReasonPrompt] = useState<{
    admin: AdminAccount;
    nextStatus: AdminStatus;
  } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [confirmRemoveAdmin, setConfirmRemoveAdmin] = useState<AdminAccount | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const active = admins.filter(a => a.status === 'active').length;
    const paused = admins.filter(a => a.status === 'paused').length;
    const blocked = admins.filter(a => a.status === 'blocked').length;
    return { total: admins.length, active, paused, blocked };
  }, [admins]);

  const filteredAdmins = useMemo(() => {
    const q = adminSearch.trim().toLowerCase();
    if (!q) return admins;
    return admins.filter(
      a =>
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.designation || '').toLowerCase().includes(q)
    );
  }, [admins, adminSearch]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      l =>
        l.targetSummary.toLowerCase().includes(q) ||
        l.actorName.toLowerCase().includes(q) ||
        l.actorEmail.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q)
    );
  }, [auditLogs, logSearch]);

  const formatTimestamp = (ts: any): string => {
    if (!ts) return '—';
    try {
      const date: Date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
      return date.toLocaleString('bn-BD', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await addAdminAccount({
        email: newEmail,
        name: newName,
        designation: newDesignation,
        initialStatus: newInitialStatus,
        actorEmail,
        actorName,
      });
      setNewName('');
      setNewEmail('');
      setNewDesignation('');
      setNewInitialStatus('active');
      onNotice('নতুন এডমিন সফলভাবে যুক্ত হয়েছে।');
    } catch (err: any) {
      setFormError(err?.message || 'এডমিন যুক্ত করতে সমস্যা হয়েছে।');
    } finally {
      setSubmitting(false);
    }
  };

  const executeStatusChange = async (
    admin: AdminAccount,
    nextStatus: AdminStatus,
    reason?: string
  ) => {
    setActionBusyId(admin.id);
    try {
      await updateAdminStatus({
        adminId: admin.id,
        adminEmail: admin.email,
        adminName: admin.name,
        nextStatus,
        reason,
        actorEmail,
        actorName,
      });
      const msgMap: Record<AdminStatus, string> = {
        active: `${admin.name}-কে পুনরায় Active করা হয়েছে।`,
        paused: `${admin.name}-এর অ্যাক্সেস সাময়িকভাবে স্থগিত (Paused) করা হয়েছে।`,
        blocked: `${admin.name}-কে স্থায়ীভাবে Block করা হয়েছে।`,
      };
      onNotice(msgMap[nextStatus]);
    } catch (err: any) {
      onNotice(err?.message || 'স্ট্যাটাস পরিবর্তনে ত্রুটি হয়েছে।');
    } finally {
      setActionBusyId(null);
      setStatusReasonPrompt(null);
      setReasonText('');
    }
  };

  const executeRemoveAdmin = async (admin: AdminAccount) => {
    setActionBusyId(admin.id);
    try {
      await removeAdminAccount({
        adminId: admin.id,
        adminEmail: admin.email,
        adminName: admin.name,
        actorEmail,
        actorName,
      });
      onNotice(`${admin.name}-কে এডমিন তালিকা থেকে স্থায়ীভাবে রিমুভ করা হয়েছে।`);
    } catch (err: any) {
      onNotice(err?.message || 'এডমিন রিমুভ করতে ত্রুটি হয়েছে।');
    } finally {
      setActionBusyId(null);
      setConfirmRemoveAdmin(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Super Admin Security Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-blue-700 text-white flex items-center justify-center shrink-0">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                  Super Admin কন্ট্রোল প্যানেল
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  Root Security
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                সর্বোচ্চ ক্ষমতা: <strong className="text-slate-700 dark:text-slate-200">{SUPER_ADMIN_EMAIL}</strong> ·
                যেকোনো এডমিনের অ্যাক্সেস সাথে সাথে Stop/Pause, Block বা Remove করলে ডাটাবেস ও সার্ভার লেভেল থেকে তাৎক্ষণিক কার্যকর হয়।
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 self-start">
            <button
              type="button"
              onClick={() => setSubTab('admins')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                subTab === 'admins'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Admin Management ({stats.total})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('logs')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                subTab === 'logs'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Audit Log ({auditLogs.length})</span>
            </button>
          </div>
        </div>

        {/* Clean Tabular Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-200 dark:border-slate-800">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">মোট অনুমোদিত এডমিন</div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
              {stats.total}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
            <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Active এডমিন</div>
            <div className="text-xl font-bold font-mono tabular-nums text-emerald-800 dark:text-emerald-300 mt-0.5">
              {stats.active}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
            <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Paused / Stopped</div>
            <div className="text-xl font-bold font-mono tabular-nums text-amber-800 dark:text-amber-300 mt-0.5">
              {stats.paused}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
            <div className="text-[11px] font-medium text-rose-700 dark:text-rose-400">Blocked এডমিন</div>
            <div className="text-xl font-bold font-mono tabular-nums text-rose-800 dark:text-rose-300 mt-0.5">
              {stats.blocked}
            </div>
          </div>
        </div>
      </div>

      {subTab === 'admins' ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Add New Admin Form */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 h-fit">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                নতুন Admin যুক্ত করুন
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              শুধুমাত্র এখানে অনুমোদিত ইমেইলধারীরাই রুটিন এডিট ও ম্যানেজমেন্ট ক্ষমতা পাবেন।
            </p>

            {formError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleAddAdmin} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  নাম *
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="যেমন: মো. হাসান আলী"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ইমেইল ঠিকানা *
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    maxLength={160}
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="teacher.admin@gmail.com"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  পদবি / দায়িত্ব (ঐচ্ছিক)
                </label>
                <div className="relative">
                  <Briefcase className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    maxLength={100}
                    value={newDesignation}
                    onChange={e => setNewDesignation(e.target.value)}
                    placeholder="যেমন: Routine Coordinator"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  প্রাথমিক স্ট্যাটাস
                </label>
                <select
                  value={newInitialStatus}
                  onChange={e => setNewInitialStatus(e.target.value as AdminStatus)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">Active (তাৎক্ষণিক অনুমোদন)</option>
                  <option value="paused">Paused (অস্থায়ীভাবে স্থগিত)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? 'যুক্ত হচ্ছে...' : 'এডমিন হিসেবে অনুমোদন দিন'}</span>
              </button>
            </form>
          </div>

          {/* Admin Directory & Live Controls */}
          <div className="xl:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  অনুমোদিত এডমিন তালিকা ও স্ট্যাটাস নিয়ন্ত্রণ
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Stop/Pause বা Block করলে সাথে সাথেই ওই এডমিনের সকল এডিট ক্ষমতা বন্ধ হয়ে যাবে।
                </p>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={adminSearch}
                  onChange={e => setAdminSearch(e.target.value)}
                  placeholder="নাম বা ইমেইল খুঁজুন..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {filteredAdmins.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                <Lock className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  এখনো কোনো এডমিন যুক্ত করা হয়নি।
                </p>
                <p className="text-[11px] text-slate-400">
                  বাম পাশের ফর্ম ব্যবহার করে অনুমোদিত এডমিনের ইমেইল যোগ করুন।
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAdmins.map(admin => {
                  const busy = actionBusyId === admin.id;
                  return (
                    <div
                      key={admin.id}
                      className={`p-4 rounded-xl border transition-colors ${
                        admin.status === 'blocked'
                          ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900'
                          : admin.status === 'paused'
                          ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
                          : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-900 dark:text-white">
                              {admin.name}
                            </span>
                            {admin.designation && (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                ({admin.designation})
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-md border ${
                                admin.status === 'active'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                                  : admin.status === 'paused'
                                  ? 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
                                  : 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800'
                              }`}
                            >
                              {admin.status === 'active'
                                ? 'Active'
                                : admin.status === 'paused'
                                ? 'Paused / Stopped'
                                : 'Blocked'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                            {admin.email}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-3 flex-wrap">
                            <span>যুক্ত: {formatTimestamp(admin.createdAt)}</span>
                            {admin.lastLoginAt && <span>শেষ লগইন: {formatTimestamp(admin.lastLoginAt)}</span>}
                          </div>
                          {admin.statusReason && admin.status !== 'active' && (
                            <div className="text-[11px] text-rose-700 dark:text-rose-300 bg-white/70 dark:bg-slate-900/60 px-2.5 py-1 rounded-md border border-rose-200/60 dark:border-rose-900/50 mt-1 inline-block">
                              কারণ: {admin.statusReason}
                            </div>
                          )}
                        </div>

                        {/* Super Admin Action Buttons */}
                        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                          {admin.status !== 'active' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => executeStatusChange(admin, 'active', '')}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 transition-colors disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Activate</span>
                            </button>
                          )}

                          {admin.status !== 'paused' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setStatusReasonPrompt({ admin, nextStatus: 'paused' });
                                setReasonText(admin.statusReason || '');
                              }}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/70 dark:text-amber-300 dark:border-amber-800 flex items-center gap-1 transition-colors disabled:opacity-50"
                            >
                              <PauseCircle className="w-3.5 h-3.5" />
                              <span>Stop / Pause</span>
                            </button>
                          )}

                          {admin.status !== 'blocked' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setStatusReasonPrompt({ admin, nextStatus: 'blocked' });
                                setReasonText(admin.statusReason || '');
                              }}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:hover:bg-rose-900/70 dark:text-rose-300 dark:border-rose-800 flex items-center gap-1 transition-colors disabled:opacity-50"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>Block</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmRemoveAdmin(admin)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-rose-700 hover:bg-rose-50 dark:text-slate-400 dark:hover:text-rose-300 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700 flex items-center gap-1 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Immutable Audit / Activity Log Section */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                <span>অডিট ও অ্যাক্টিভিটি লগ (সর্বশেষ ১০০টি পরিবর্তন)</span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                কে কখন কোন রুটিন এডিট বা সিকিউরিটি পরিবর্তন করেছে — এটি পরিবর্তন বা মুছে ফেলা যায় না।
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                placeholder="ইউজার বা কাজের বিবরণ খুঁজুন..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              কোনো অ্যাক্টিভিটি লগ পাওয়া যায়নি।
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-3 font-semibold">সময়</th>
                    <th className="py-2.5 px-3 font-semibold">ব্যবহারকারী</th>
                    <th className="py-2.5 px-3 font-semibold">রোল</th>
                    <th className="py-2.5 px-3 font-semibold">কাজের বিবরণ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{log.actorName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{log.actorEmail}</div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                            log.actorRole === 'super_admin'
                              ? 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800'
                              : 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800'
                          }`}
                        >
                          {log.actorRole === 'super_admin' ? 'Super Admin' : 'Admin'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {log.targetSummary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pause / Block Reason Modal */}
      {statusReasonPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              {statusReasonPrompt.nextStatus === 'paused' ? (
                <PauseCircle className="w-5 h-5 text-amber-600" />
              ) : (
                <Ban className="w-5 h-5 text-rose-600" />
              )}
              <span>
                {statusReasonPrompt.nextStatus === 'paused'
                  ? 'এডমিন অ্যাক্সেস সাময়িক স্থগিত (Stop/Pause)'
                  : 'এডমিন অ্যাকাউন্ট ব্লক (Block)'}
              </span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              <strong>{statusReasonPrompt.admin.name}</strong> ({statusReasonPrompt.admin.email})-এর রুটিন এডিট ক্ষমতা সাথে সাথেই বন্ধ হয়ে যাবে।
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                কারণ / মন্তব্য (ঐচ্ছিক)
              </label>
              <input
                type="text"
                maxLength={300}
                value={reasonText}
                onChange={e => setReasonText(e.target.value)}
                placeholder="যেমন: রুটিন অনুমোদন শেষ / নিরাপত্তা যাচাই চলছে"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setStatusReasonPrompt(null);
                  setReasonText('');
                }}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                বাতিল
              </button>
              <button
                type="button"
                disabled={actionBusyId === statusReasonPrompt.admin.id}
                onClick={() =>
                  executeStatusChange(
                    statusReasonPrompt.admin,
                    statusReasonPrompt.nextStatus,
                    reasonText
                  )
                }
                className={`px-4 py-2 text-xs font-bold text-white rounded-xl ${
                  statusReasonPrompt.nextStatus === 'paused'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                নিশ্চিত করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Remove Confirmation Modal */}
      {confirmRemoveAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900 shadow-xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-sm font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              <span>এডমিন স্থায়ীভাবে রিমুভ করবেন?</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              <strong>{confirmRemoveAdmin.name}</strong> ({confirmRemoveAdmin.email})-কে সিস্টেম থেকে রিমুভ করলে তিনি আর এডমিন থাকবেন না এবং সাধারণ ভিউয়ার হিসেবে থাকবেন।
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemoveAdmin(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                বাতিল
              </button>
              <button
                type="button"
                disabled={actionBusyId === confirmRemoveAdmin.id}
                onClick={() => executeRemoveAdmin(confirmRemoveAdmin)}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl"
              >
                হ্যাঁ, রিমুভ করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
