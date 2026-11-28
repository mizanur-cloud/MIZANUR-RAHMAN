import React from 'react';
import {
  Calendar,
  Users,
  Grid3X3,
  ShieldCheck,
  AlertTriangle,
  Wand2,
  Download,
  UserMinus,
  Edit,
  Undo2,
  Redo2,
  Sun,
  Moon,
  Shield,
  LogIn,
  LogOut,
  Lock,
  Radio,
  Monitor,
  Smartphone,
  BookOpen,
} from 'lucide-react';
import { AdminStatus, UserRole } from '../types';
import { SchoolCrestLogo } from './SchoolCrestLogo';
import { useViewMode } from '../context/ViewModeContext';

export type WorkspaceTab =
  | 'live'
  | 'classes'
  | 'teachers'
  | 'master'
  | 'annual-plan'
  | 'proxy'
  | 'conflicts'
  | 'control-panel';

interface NavbarProps {
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  errorCount: number;
  warningCount: number;
  schoolName: string;
  academicYear: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenAutoGenerate: () => void;
  onOpenExport: () => void;
  onOpenSettings: () => void;
  role: UserRole;
  adminStatus: AdminStatus | null;
  canEdit: boolean;
  isSuperAdmin: boolean;
  isAuthenticated: boolean;
  userEmail: string | null;
  onOpenLogin: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  errorCount,
  warningCount,
  schoolName,
  academicYear,
  theme,
  onToggleTheme,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenAutoGenerate,
  onOpenExport,
  onOpenSettings,
  role,
  adminStatus,
  canEdit,
  isSuperAdmin,
  isAuthenticated,
  userEmail,
  onOpenLogin,
  onLogout,
}) => {
  const { isMobileView, isDesktopView, setViewMode } = useViewMode();
  const totalIssues = errorCount + warningCount;

  const roleStatus = (() => {
    if (role === 'super_admin') {
      return {
        label: 'Super Admin',
        cls: 'text-[#145343] dark:text-emerald-400',
      };
    }
    if (role === 'admin' && adminStatus === 'active') {
      return {
        label: 'Active Admin',
        cls: 'text-emerald-700 dark:text-emerald-400',
      };
    }
    if (role === 'admin' && adminStatus === 'paused') {
      return {
        label: 'Paused Admin',
        cls: 'text-amber-700 dark:text-amber-400',
      };
    }
    if (role === 'admin' && adminStatus === 'blocked') {
      return {
        label: 'Blocked',
        cls: 'text-rose-700 dark:text-rose-400',
      };
    }
    return {
      label: 'Viewer (Read-Only)',
      cls: 'text-stone-500 dark:text-slate-400',
    };
  })();

  return (
    <header className="no-print sticky top-0 z-40 bg-white/95 dark:bg-[#141a20]/95 backdrop-blur-md border-b border-stone-200 dark:border-slate-800 transition-colors">
      <div className={isMobileView ? 'px-3.5' : 'max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8'}>
        <div className={`flex items-center justify-between gap-2 ${isMobileView ? 'h-14' : 'h-16 gap-3'}`}>
          {/* Zone 1: Custom Engraved Crest Emblem & Institution Title */}
          <button
            type="button"
            onClick={() => {
              if (canEdit) onOpenSettings();
            }}
            title={canEdit ? 'Click to edit school name and institutional details' : schoolName}
            className={`flex items-center gap-2.5 text-left group min-w-0 flex-1 ${
              canEdit ? 'cursor-pointer' : 'cursor-default'
            }`}
          >
            <SchoolCrestLogo
              className={`${isMobileView ? 'w-8 h-8' : 'w-10 h-10'} shrink-0 transition-transform group-hover:scale-[1.03]`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={`font-bold text-stone-900 dark:text-white tracking-tight leading-none group-hover:text-[#145343] dark:group-hover:text-emerald-400 transition-colors truncate ${
                    isMobileView ? 'text-[13px] max-w-[195px]' : 'text-sm sm:text-base max-w-[165px] sm:max-w-[240px]'
                  }`}
                >
                  {schoolName}
                </span>
                {canEdit && !isMobileView && (
                  <Edit className="w-3 h-3 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                )}
              </div>
              <div className="text-[10px] sm:text-[11px] text-stone-500 dark:text-slate-400 mt-0.5 truncate">
                {isMobileView ? `সেশন ${academicYear}` : `একাডেমিক রুটিন ও টাইমটেবিল · ${academicYear}`}
              </div>
            </div>
          </button>

          {/* Zone 2: Clean Editorial Underline Tabs (Desktop View Only) */}
          {isDesktopView && (
          <nav className="hidden md:flex items-center gap-0.5 h-16 text-xs font-medium overflow-x-auto scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={`h-full flex items-center gap-1.5 px-2.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'live'
                  ? 'border-[#145343] text-[#145343] dark:border-emerald-400 dark:text-emerald-400 font-bold'
                  : 'border-transparent text-stone-600 dark:text-slate-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5 shrink-0" />
              <span>Live Classes</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('classes')}
              className={`h-full flex items-center gap-1.5 px-2.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'classes'
                  ? 'border-[#145343] text-[#145343] dark:border-emerald-400 dark:text-emerald-400 font-bold'
                  : 'border-transparent text-stone-600 dark:text-slate-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span>Class Routines</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('teachers')}
              className={`h-full flex items-center gap-1.5 px-2.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'teachers'
                  ? 'border-[#145343] text-[#145343] dark:border-emerald-400 dark:text-emerald-400 font-bold'
                  : 'border-transparent text-stone-600 dark:text-slate-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>Teacher Routines</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('master')}
              className={`h-full flex items-center gap-1.5 px-2.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'master'
                  ? 'border-[#145343] text-[#145343] dark:border-emerald-400 dark:text-emerald-400 font-bold'
                  : 'border-transparent text-stone-600 dark:text-slate-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5 shrink-0" />
              <span>Master Matrix</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('annual-plan')}
              className={`h-full flex items-center gap-1.5 px-2.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'annual-plan'
                  ? 'border-[#145343] text-[#145343] dark:border-emerald-400 dark:text-emerald-400 font-bold'
                  : 'border-transparent text-stone-600 dark:text-slate-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span>Annual Plan</span>
            </button>

            {canEdit && (
              <button
                type="button"
                onClick={() => setActiveTab('proxy')}
                className={`h-full flex items-center gap-1.5 px-2.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'proxy'
                    ? 'border-rose-600 text-rose-700 dark:border-rose-400 dark:text-rose-300 font-bold'
                    : 'border-transparent text-stone-600 dark:text-slate-300 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                <UserMinus className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>Proxy (বদলি)</span>
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={() => setActiveTab('conflicts')}
                className={`h-full flex items-center gap-1.5 px-2.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'conflicts'
                    ? 'border-[#145343] text-[#145343] dark:border-emerald-400 dark:text-emerald-400 font-bold'
                    : errorCount > 0
                    ? 'border-transparent text-rose-700 dark:text-rose-300'
                    : warningCount > 0
                    ? 'border-transparent text-amber-700 dark:text-amber-300'
                    : 'border-transparent text-stone-600 dark:text-slate-300 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                {totalIssues > 0 ? (
                  <AlertTriangle
                    className={`w-3.5 h-3.5 shrink-0 ${
                      errorCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                )}
                <span>Audit</span>
                {totalIssues > 0 && (
                  <span
                    className={`font-mono text-[11px] font-bold tabular-nums ${
                      errorCount > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    ({totalIssues})
                  </span>
                )}
              </button>
            )}

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab('control-panel')}
                className={`h-full flex items-center gap-1.5 px-2.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'control-panel'
                    ? 'border-[#145343] text-[#145343] dark:border-emerald-400 dark:text-emerald-400 font-bold'
                    : 'border-transparent text-stone-700 dark:text-slate-300 hover:text-[#145343] dark:hover:text-emerald-400'
                }`}
              >
                <Shield className="w-3.5 h-3.5 shrink-0" />
                <span>Control Panel</span>
              </button>
            )}
          </nav>
          )}

          {/* Zone 3: Dual View Switcher + Safety Controls + RBAC Session + Primary Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Dual View Switcher: Desktop View vs Mobile View */}
            <div
              role="group"
              aria-label="ডিসপ্লে ভিউ মোড"
              className="flex items-center border border-stone-200 dark:border-slate-700 rounded-lg bg-[#f7f5f0] dark:bg-slate-800/70 p-0.5 shrink-0"
            >
              <button
                type="button"
                onClick={() => setViewMode('desktop')}
                title="ডেক্সটপ ভিউ (Desktop View)"
                className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition-colors ${
                  isDesktopView
                    ? 'bg-white dark:bg-slate-700 text-[#145343] dark:text-emerald-300 shadow-2xs'
                    : 'text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                <Monitor className="w-3.5 h-3.5 shrink-0" />
                <span className={isMobileView ? 'hidden' : 'hidden xl:inline'}>ডেক্সটপ</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('mobile')}
                title="মোবাইল ভিউ (Mobile View)"
                className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition-colors ${
                  isMobileView
                    ? 'bg-white dark:bg-slate-700 text-[#145343] dark:text-emerald-300 shadow-2xs'
                    : 'text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5 shrink-0" />
                <span className={isMobileView ? 'hidden' : 'hidden xl:inline'}>মোবাইল</span>
              </button>
            </div>

            {canEdit && (
              <div className="hidden sm:flex items-center border border-stone-200 dark:border-slate-700 rounded-lg bg-[#f7f5f0] dark:bg-slate-800/70 p-0.5">
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={!canUndo}
                  title="Undo last change (Ctrl+Z)"
                  className={`p-1.5 rounded-md transition-colors ${
                    canUndo
                      ? 'text-stone-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700'
                      : 'text-stone-300 dark:text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onRedo}
                  disabled={!canRedo}
                  title="Redo change (Ctrl+Y)"
                  className={`p-1.5 rounded-md transition-colors ${
                    canRedo
                      ? 'text-stone-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700'
                      : 'text-stone-300 dark:text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-2 rounded-lg border border-stone-200 dark:border-slate-700 bg-[#f7f5f0] dark:bg-slate-800/70 text-stone-600 dark:text-slate-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-slate-700 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            {!isMobileView && canEdit && (
              <button
                type="button"
                onClick={onOpenAutoGenerate}
                className="px-2.5 py-1.5 text-xs font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/60 hover:bg-[#dfece6] dark:hover:bg-emerald-900/60 border border-[#bfd5cc] dark:border-emerald-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Auto-Fill</span>
              </button>
            )}

            {!isMobileView && (
              <button
                type="button"
                onClick={onOpenExport}
                className="px-2.5 py-1.5 text-xs font-semibold text-white bg-[#145343] hover:bg-[#0f3f33] dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export</span>
              </button>
            )}

            {/* Unboxed Institutional Role Status */}
            {!isMobileView && (
              <span
                title={userEmail || 'সাধারণ ভিউয়ার (Read-Only)'}
                className={`hidden xl:inline-flex items-center gap-1 px-1.5 text-[11px] font-bold ${roleStatus.cls}`}
              >
                {!canEdit && <Lock className="w-3 h-3" />}
                <span>{roleStatus.label}</span>
              </span>
            )}

            {isAuthenticated ? (
              !isMobileView && (
                <button
                  type="button"
                  onClick={onLogout}
                  title={`লগআউট (${userEmail || ''})`}
                  className="px-2.5 py-1.5 text-xs font-semibold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300 border border-stone-200 dark:border-slate-700 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={onOpenLogin}
                className={`text-xs font-semibold text-stone-800 dark:text-slate-100 bg-stone-100 dark:bg-slate-800 hover:bg-[#eef5f2] hover:text-[#145343] dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300 border border-stone-200 dark:border-slate-700 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap ${
                  isMobileView ? 'px-2.5 py-1.5 text-[11px]' : 'px-2.5 py-1.5'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{isMobileView ? 'লগইন' : 'Admin Login'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Desktop Secondary Tabs for Narrow Physical Screens (Mobile View uses Fixed Bottom Thumb Dock instead) */}
        {isDesktopView && (
        <div className="flex md:hidden border-t border-stone-200 dark:border-slate-800 py-2 gap-1 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('live')}
            className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap flex items-center gap-1 ${
              activeTab === 'live'
                ? 'bg-[#145343] text-white font-semibold'
                : 'text-stone-600 dark:text-slate-300'
            }`}
          >
            <Radio className="w-3 h-3" />
            <span>Live Classes</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('classes')}
            className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
              activeTab === 'classes'
                ? 'bg-[#eef5f2] dark:bg-emerald-950 text-[#145343] dark:text-emerald-200 font-semibold'
                : 'text-stone-600 dark:text-slate-300'
            }`}
          >
            Class Routines
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('teachers')}
            className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
              activeTab === 'teachers'
                ? 'bg-[#eef5f2] dark:bg-emerald-950 text-[#145343] dark:text-emerald-200 font-semibold'
                : 'text-stone-600 dark:text-slate-300'
            }`}
          >
            Teacher Routines
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('master')}
            className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
              activeTab === 'master'
                ? 'bg-[#eef5f2] dark:bg-emerald-950 text-[#145343] dark:text-emerald-200 font-semibold'
                : 'text-stone-600 dark:text-slate-300'
            }`}
          >
            Master Matrix
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('annual-plan')}
            className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap flex items-center gap-1 ${
              activeTab === 'annual-plan'
                ? 'bg-[#eef5f2] dark:bg-emerald-950 text-[#145343] dark:text-emerald-200 font-semibold'
                : 'text-stone-600 dark:text-slate-300'
            }`}
          >
            <BookOpen className="w-3 h-3" />
            <span>Annual Plan</span>
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setActiveTab('proxy')}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                activeTab === 'proxy'
                  ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 font-semibold'
                  : 'text-stone-600 dark:text-slate-300'
              }`}
            >
              Proxy (বদলি)
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setActiveTab('conflicts')}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap flex items-center gap-1 ${
                activeTab === 'conflicts'
                  ? 'bg-[#eef5f2] dark:bg-emerald-950 text-[#145343] dark:text-emerald-200 font-semibold'
                  : 'text-stone-600 dark:text-slate-300'
              }`}
            >
              <span>Audit</span>
              {totalIssues > 0 && (
                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">({totalIssues})</span>
              )}
            </button>
          )}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('control-panel')}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap flex items-center gap-1 ${
                activeTab === 'control-panel'
                  ? 'bg-[#145343] text-white font-semibold'
                  : 'bg-[#eef5f2] dark:bg-emerald-950/60 text-[#145343] dark:text-emerald-300 font-semibold'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Control Panel</span>
            </button>
          )}
        </div>
        )}
      </div>
    </header>
  );
};


