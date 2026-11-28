import React, { useState } from 'react';
import {
  Radio,
  Calendar,
  Users,
  Grid3X3,
  UserMinus,
  Menu,
  X,
  Monitor,
  BookOpen,
  UserCheck,
  Layers,
  Settings as SettingsIcon,
  UploadCloud,
  Wand2,
  Download,
  Printer,
  Globe,
  Check,
  Smartphone,
  HelpCircle,
  ShieldCheck,
  AlertTriangle,
  Shield,
  LogIn,
  LogOut,
  Lock,
  ClipboardList,
} from 'lucide-react';
import { WorkspaceTab } from './Navbar';
import { useViewMode } from '../context/ViewModeContext';
import { AdminStatus, UserRole } from '../types';

interface MobileNavigationDockProps {
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  isOpenMenu: boolean;
  setIsOpenMenu: (open: boolean) => void;
  canEdit: boolean;
  isSuperAdmin: boolean;
  isAuthenticated: boolean;
  userEmail: string | null;
  role: UserRole;
  adminStatus: AdminStatus | null;
  errorCount: number;
  warningCount: number;
  totalClasses: number;
  totalTeachers: number;
  totalEntries: number;
  onOpenClassMgmt: () => void;
  onOpenTeacherMgmt: () => void;
  onOpenSubjectMgmt: () => void;
  onOpenSettings: () => void;
  onOpenSmartImport: () => void;
  onOpenAutoGenerate: () => void;
  onOpenExport: () => void;
  onOpenHelpAndInstall: () => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}

export const MobileNavigationDock: React.FC<MobileNavigationDockProps> = ({
  activeTab,
  setActiveTab,
  isOpenMenu,
  setIsOpenMenu,
  canEdit,
  isSuperAdmin,
  isAuthenticated,
  userEmail,
  role,
  adminStatus,
  errorCount,
  warningCount,
  totalClasses,
  totalTeachers,
  totalEntries,
  onOpenClassMgmt,
  onOpenTeacherMgmt,
  onOpenSubjectMgmt,
  onOpenSettings,
  onOpenSmartImport,
  onOpenAutoGenerate,
  onOpenExport,
  onOpenHelpAndInstall,
  onOpenLogin,
  onLogout,
}) => {
  const { setViewMode } = useViewMode();
  const [copiedLink, setCopiedLink] = useState(false);

  const totalIssues = errorCount + warningCount;

  const handleCopyShareLink = () => {
    const fallbackUrl = 'https://ais-pre-24ugampdbbfry7osz7xs3e-734890175875.asia-southeast1.run.app';
    const urlToCopy =
      typeof window !== 'undefined' && window.location.origin.includes('.run.app')
        ? window.location.origin
        : fallbackUrl;
    navigator.clipboard.writeText(urlToCopy);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2400);
  };

  const roleLabel =
    role === 'super_admin'
      ? 'Super Admin'
      : role === 'admin' && adminStatus === 'active'
      ? 'Active Admin'
      : role === 'admin' && adminStatus === 'paused'
      ? 'Paused Admin'
      : role === 'admin' && adminStatus === 'blocked'
      ? 'Blocked'
      : 'Viewer (Read-Only)';

  return (
    <>
      {/* Fixed Bottom Thumb Navigation Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="no-print fixed bottom-0 left-0 right-0 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-[430px] z-40 bg-white/95 dark:bg-[#141a20]/95 backdrop-blur-lg border-t border-stone-200/90 dark:border-slate-800 md:rounded-b-[2rem] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 h-16 items-center">
          <button
            type="button"
            onClick={() => {
              setActiveTab('live');
              setIsOpenMenu(false);
            }}
            className={`relative min-h-[44px] h-full flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === 'live'
                ? 'text-[#145343] dark:text-emerald-400 font-bold'
                : 'text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            {activeTab === 'live' && (
              <span className="absolute top-0 w-7 h-0.5 rounded-full bg-[#145343] dark:bg-emerald-400" />
            )}
            <Radio className="w-[19px] h-[19px]" />
            <span className="text-[10px] leading-none tracking-tight">লাইভ</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('classes');
              setIsOpenMenu(false);
            }}
            className={`relative min-h-[44px] h-full flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === 'classes'
                ? 'text-[#145343] dark:text-emerald-400 font-bold'
                : 'text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            {activeTab === 'classes' && (
              <span className="absolute top-0 w-7 h-0.5 rounded-full bg-[#145343] dark:bg-emerald-400" />
            )}
            <Calendar className="w-[19px] h-[19px]" />
            <span className="text-[10px] leading-none tracking-tight">ক্লাস</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('teachers');
              setIsOpenMenu(false);
            }}
            className={`relative min-h-[44px] h-full flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === 'teachers'
                ? 'text-[#145343] dark:text-emerald-400 font-bold'
                : 'text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            {activeTab === 'teachers' && (
              <span className="absolute top-0 w-7 h-0.5 rounded-full bg-[#145343] dark:bg-emerald-400" />
            )}
            <Users className="w-[19px] h-[19px]" />
            <span className="text-[10px] leading-none tracking-tight">শিক্ষক</span>
          </button>

          {canEdit ? (
            <button
              type="button"
              onClick={() => {
                setActiveTab('proxy');
                setIsOpenMenu(false);
              }}
              className={`relative min-h-[44px] h-full flex flex-col items-center justify-center gap-1 transition-colors ${
                activeTab === 'proxy'
                  ? 'text-rose-600 dark:text-rose-400 font-bold'
                  : 'text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              {activeTab === 'proxy' && (
                <span className="absolute top-0 w-7 h-0.5 rounded-full bg-rose-600 dark:bg-rose-400" />
              )}
              <UserMinus className="w-[19px] h-[19px]" />
              <span className="text-[10px] leading-none tracking-tight">প্রক্সি</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setActiveTab('master');
                setIsOpenMenu(false);
              }}
              className={`relative min-h-[44px] h-full flex flex-col items-center justify-center gap-1 transition-colors ${
                activeTab === 'master'
                  ? 'text-[#145343] dark:text-emerald-400 font-bold'
                  : 'text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              {activeTab === 'master' && (
                <span className="absolute top-0 w-7 h-0.5 rounded-full bg-[#145343] dark:bg-emerald-400" />
              )}
              <Grid3X3 className="w-[19px] h-[19px]" />
              <span className="text-[10px] leading-none tracking-tight">ম্যাট্রিক্স</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsOpenMenu(!isOpenMenu)}
            className={`relative min-h-[44px] h-full flex flex-col items-center justify-center gap-1 transition-colors ${
              isOpenMenu || activeTab === 'annual-plan' || activeTab === 'conflicts' || activeTab === 'control-panel' || (canEdit && activeTab === 'master')
                ? 'text-[#145343] dark:text-emerald-400 font-bold'
                : 'text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            {(isOpenMenu || activeTab === 'annual-plan' || activeTab === 'conflicts' || activeTab === 'control-panel') && (
              <span className="absolute top-0 w-7 h-0.5 rounded-full bg-[#145343] dark:bg-emerald-400" />
            )}
            <Menu className="w-[19px] h-[19px]" />
            <span className="text-[10px] leading-none tracking-tight">মেনু</span>
            {canEdit && totalIssues > 0 && (
              <span className="absolute top-1.5 right-3 text-[9px] font-mono font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                {totalIssues}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile Action Sheet / Drawer */}
      {isOpenMenu && (
        <div
          className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs"
          onClick={() => setIsOpenMenu(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[430px] max-h-[85vh] bg-white dark:bg-[#141a20] rounded-t-3xl border-t border-stone-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Drag handle + Sheet Header */}
            <div className="pt-2.5 pb-3 px-5 border-b border-stone-200 dark:border-slate-800 shrink-0">
              <div className="w-10 h-1.5 bg-stone-300 dark:bg-slate-700 rounded-full mx-auto mb-3" />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-stone-900 dark:text-white">
                    কুইক মেনু ও সেটিংস
                  </div>
                  <div className="text-[11px] text-stone-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                    {!canEdit && <Lock className="w-3 h-3" />}
                    <span>{roleLabel}</span>
                    {userEmail && (
                      <>
                        <span>·</span>
                        <span className="truncate max-w-[180px]">{userEmail}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpenMenu(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 dark:hover:bg-slate-800"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="p-4 space-y-4 overflow-y-auto">
              {/* View Switcher Action Banner */}
              <div className="p-3 rounded-2xl bg-[#f7f5f0] dark:bg-slate-900 border border-stone-200 dark:border-slate-800 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-stone-900 dark:text-white">
                    ডিসপ্লে ভিউ মোড
                  </div>
                  <div className="text-[11px] text-stone-500 dark:text-slate-400">
                    বর্তমানে মোবাইল ভিউ চালু আছে
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('desktop');
                    setIsOpenMenu(false);
                  }}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#145343] hover:bg-[#0f3f33] text-white text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <Monitor className="w-4 h-4" />
                  <span>ডেক্সটপ ভিউ</span>
                </button>
              </div>

              {/* Navigation Destinations */}
              <div className="space-y-1.5">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                  অন্যান্য পেজ
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('master');
                      setIsOpenMenu(false);
                    }}
                    className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 text-left transition-colors ${
                      activeTab === 'master'
                        ? 'bg-[#eef5f2] dark:bg-emerald-950/60 border-[#145343] text-[#145343] dark:text-emerald-300'
                        : 'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-800 text-stone-700 dark:text-slate-200'
                    }`}
                  >
                    <Grid3X3 className="w-4 h-4 shrink-0" />
                    <span className="truncate">মাস্টার ম্যাট্রিক্স</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('annual-plan');
                      setIsOpenMenu(false);
                    }}
                    className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 text-left transition-colors ${
                      activeTab === 'annual-plan'
                        ? 'bg-[#eef5f2] dark:bg-emerald-950/60 border-[#145343] text-[#145343] dark:text-emerald-300'
                        : 'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-800 text-stone-700 dark:text-slate-200'
                    }`}
                  >
                    <ClipboardList className="w-4 h-4 shrink-0" />
                    <span className="truncate">বার্ষিক সিলেবাস ও প্ল্যান</span>
                  </button>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('conflicts');
                        setIsOpenMenu(false);
                      }}
                      className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 text-left transition-colors ${
                        activeTab === 'conflicts'
                          ? 'bg-[#eef5f2] dark:bg-emerald-950/60 border-[#145343] text-[#145343] dark:text-emerald-300'
                          : 'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-800 text-stone-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        {totalIssues > 0 ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                        )}
                        <span className="truncate">অডিট রিপোর্ট</span>
                      </span>
                      {totalIssues > 0 && (
                        <span className="font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                          {totalIssues}
                        </span>
                      )}
                    </button>
                  )}

                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('control-panel');
                        setIsOpenMenu(false);
                      }}
                      className="col-span-2 min-h-[44px] px-3 py-2.5 rounded-xl bg-[#145343] text-white text-xs font-bold flex items-center gap-2"
                    >
                      <Shield className="w-4 h-4 shrink-0" />
                      <span>Super Admin Control Panel</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Admin Academic Setup */}
              {canEdit && (
                <div className="space-y-1.5">
                  <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                    একাডেমিক ম্যানেজমেন্ট
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpenMenu(false);
                        onOpenClassMgmt();
                      }}
                      className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-stone-800 dark:text-slate-200 flex items-center gap-2 text-left"
                    >
                      <BookOpen className="w-4 h-4 text-[#145343] dark:text-emerald-400 shrink-0" />
                      <span className="truncate">শ্রেণি (Play–10)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOpenMenu(false);
                        onOpenTeacherMgmt();
                      }}
                      className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-stone-800 dark:text-slate-200 flex items-center gap-2 text-left"
                    >
                      <UserCheck className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                      <span className="truncate">শিক্ষকমণ্ডলী</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOpenMenu(false);
                        onOpenSubjectMgmt();
                      }}
                      className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-stone-800 dark:text-slate-200 flex items-center gap-2 text-left"
                    >
                      <Layers className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                      <span className="truncate">বিষয় ও কোটা</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOpenMenu(false);
                        onOpenAutoGenerate();
                      }}
                      className="min-h-[44px] px-3 py-2.5 rounded-xl border border-[#bfd5cc] dark:border-emerald-800 bg-[#eef5f2] dark:bg-emerald-950/60 text-xs font-bold text-[#145343] dark:text-emerald-300 flex items-center gap-2 text-left"
                    >
                      <Wand2 className="w-4 h-4 shrink-0" />
                      <span className="truncate">অটো-ফিল রুটিন</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOpenMenu(false);
                        onOpenSettings();
                      }}
                      className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-stone-800 dark:text-slate-200 flex items-center gap-2 text-left"
                    >
                      <SettingsIcon className="w-4 h-4 text-stone-500 shrink-0" />
                      <span className="truncate">বেল ও ব্যাকআপ</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOpenMenu(false);
                        onOpenSmartImport();
                      }}
                      className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-stone-800 dark:text-slate-200 flex items-center gap-2 text-left"
                    >
                      <UploadCloud className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                      <span className="truncate">ফাইল ইম্পোর্ট</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Export, Share & App Install */}
              <div className="space-y-1.5">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-slate-400">
                  এক্সপোর্ট ও শেয়ার
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpenMenu(false);
                      onOpenExport();
                    }}
                    className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#145343] text-white text-xs font-bold flex items-center gap-2 text-left"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span className="truncate">PDF / Word / Excel</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsOpenMenu(false);
                      window.print();
                    }}
                    className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-stone-800 dark:text-slate-200 flex items-center gap-2 text-left"
                  >
                    <Printer className="w-4 h-4 text-stone-500 shrink-0" />
                    <span className="truncate">প্রিন্ট করুন</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-stone-800 dark:text-slate-200 flex items-center gap-2 text-left"
                  >
                    {copiedLink ? (
                      <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Globe className="w-4 h-4 text-[#145343] dark:text-emerald-400 shrink-0" />
                    )}
                    <span className="truncate">{copiedLink ? 'লিংক কপি হয়েছে!' : 'শেয়ার লিংক'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsOpenMenu(false);
                      onOpenHelpAndInstall();
                    }}
                    className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-stone-800 dark:text-slate-200 flex items-center gap-2 text-left"
                  >
                    <Smartphone className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    <span className="truncate">অ্যাপ ইনস্টল (PWA)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsOpenMenu(false);
                      onOpenHelpAndInstall();
                    }}
                    className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-stone-800 dark:text-slate-200 flex items-center gap-2 text-left"
                  >
                    <HelpCircle className="w-4 h-4 text-stone-500 shrink-0" />
                    <span className="truncate">সহায়িকা ও গাইড</span>
                  </button>

                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpenMenu(false);
                        onLogout();
                      }}
                      className="min-h-[44px] px-3 py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2 text-left"
                    >
                      <LogOut className="w-4 h-4 shrink-0" />
                      <span className="truncate">লগআউট</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpenMenu(false);
                        onOpenLogin();
                      }}
                      className="min-h-[44px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-stone-100 dark:bg-slate-800 text-xs font-bold text-stone-800 dark:text-slate-100 flex items-center gap-2 text-left"
                    >
                      <LogIn className="w-4 h-4 shrink-0" />
                      <span className="truncate">অ্যাডমিন লগইন</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Compact Tabular Summary */}
              <div className="pt-2 border-t border-stone-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-stone-500 dark:text-slate-400">
                <span>শ্রেণি: <strong className="font-mono text-stone-800 dark:text-slate-200 tabular-nums">{totalClasses}</strong></span>
                <span>শিক্ষক: <strong className="font-mono text-stone-800 dark:text-slate-200 tabular-nums">{totalTeachers}</strong></span>
                <span>মোট পিরিয়ড: <strong className="font-mono text-stone-800 dark:text-slate-200 tabular-nums">{totalEntries}</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
