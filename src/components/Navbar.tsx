import React from 'react';
import {
  Calendar,
  Users,
  Grid3X3,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
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
} from 'lucide-react';
import { AdminStatus, UserRole } from '../types';

export type WorkspaceTab = 'classes' | 'teachers' | 'master' | 'proxy' | 'conflicts' | 'control-panel';

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
  const totalIssues = errorCount + warningCount;

  const roleBadge = (() => {
    if (role === 'super_admin') {
      return {
        label: 'Super Admin',
        cls: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
      };
    }
    if (role === 'admin' && adminStatus === 'active') {
      return {
        label: 'Admin (Active)',
        cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
      };
    }
    if (role === 'admin' && adminStatus === 'paused') {
      return {
        label: 'Admin (Paused)',
        cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
      };
    }
    if (role === 'admin' && adminStatus === 'blocked') {
      return {
        label: 'Blocked',
        cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
      };
    }
    return {
      label: 'Viewer',
      cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    };
  })();

  return (
    <header className="no-print sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Zone 1: Brand Wordmark & Institution Title */}
          <button
            type="button"
            onClick={() => {
              if (canEdit) onOpenSettings();
            }}
            title={canEdit ? 'Click to edit school name and institutional details' : schoolName}
            className={`flex items-center gap-3 shrink-0 text-left group min-w-0 ${
              canEdit ? 'cursor-pointer' : 'cursor-default'
            }`}
          >
            <div className="w-9 h-9 rounded-lg bg-blue-700 dark:bg-blue-600 flex items-center justify-center text-white group-hover:bg-blue-800 dark:group-hover:bg-blue-500 transition-colors shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-900 dark:text-white tracking-tight leading-none text-sm sm:text-base group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors truncate max-w-[160px] sm:max-w-[230px]">
                  {schoolName}
                </span>
                {canEdit && (
                  <Edit className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                Smart Routine · {academicYear}
              </div>
            </div>
          </button>

          {/* Zone 2: Primary Workspace Tabs (Single-Line Desktop Nav) */}
          <nav className="hidden md:flex items-center gap-1 text-xs font-medium overflow-x-auto scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveTab('classes')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'classes'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              <Calendar className="w-4 h-4 shrink-0" />
              <span>Class Routines</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('teachers')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'teachers'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>Teacher Routines</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('master')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'master'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              <Grid3X3 className="w-4 h-4 shrink-0" />
              <span>Master Timetable</span>
            </button>

            {canEdit && (
              <button
                type="button"
                onClick={() => setActiveTab('proxy')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'proxy'
                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <UserMinus className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>Proxy (বদলি)</span>
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={() => setActiveTab('conflicts')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'conflicts'
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300 font-semibold'
                    : errorCount > 0
                    ? 'text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                    : warningCount > 0
                    ? 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                {totalIssues > 0 ? (
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 ${
                      errorCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                )}
                <span>Audit & Rules</span>
                {totalIssues > 0 && (
                  <span
                    className={`ml-0.5 font-mono text-[11px] font-bold tabular-nums ${
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
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'control-panel'
                    ? 'bg-blue-700 text-white font-semibold shadow-xs'
                    : 'text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                }`}
              >
                <Shield className="w-4 h-4 shrink-0" />
                <span>Control Panel</span>
              </button>
            )}
          </nav>

          {/* Zone 3: Safety Controls + RBAC Session + Primary Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Undo / Redo (Editors only) */}
            {canEdit && (
              <div className="hidden sm:flex items-center border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/70 p-0.5">
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={!canUndo}
                  title="Undo last change (Ctrl+Z)"
                  className={`p-1.5 rounded-md transition-colors ${
                    canUndo
                      ? 'text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700'
                      : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
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
                      ? 'text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700'
                      : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Light / Dark Theme Toggle */}
            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Auto-Fill (Editors only) */}
            {canEdit && (
              <button
                type="button"
                onClick={onOpenAutoGenerate}
                className="px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-200 bg-blue-50 dark:bg-blue-950/70 hover:bg-blue-100 dark:hover:bg-blue-900/70 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="hidden lg:inline">Auto-Fill</span>
              </button>
            )}

            {/* Primary Export Action (Allowed for Viewers too for routine download/print) */}
            <button
              type="button"
              onClick={onOpenExport}
              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>

            {/* Role Status & Auth Action */}
            <span
              title={userEmail || 'সাধারণ ভিউয়ার (Read-Only)'}
              className={`hidden xl:inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold rounded-lg border ${roleBadge.cls}`}
            >
              {!canEdit && <Lock className="w-3 h-3" />}
              <span>{roleBadge.label}</span>
            </span>

            {isAuthenticated ? (
              <button
                type="button"
                onClick={onLogout}
                title={`লগআউট (${userEmail || ''})`}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenLogin}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/60 dark:hover:text-blue-300 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Admin Login</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile Secondary Tabs */}
        <div className="flex md:hidden border-t border-slate-200 dark:border-slate-800 py-2 gap-1 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('classes')}
            className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
              activeTab === 'classes'
                ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 font-semibold'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Class Routines
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('teachers')}
            className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
              activeTab === 'teachers'
                ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 font-semibold'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Teacher Routines
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('master')}
            className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
              activeTab === 'master'
                ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 font-semibold'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Master Timetable
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setActiveTab('proxy')}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap ${
                activeTab === 'proxy'
                  ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 font-semibold'
                  : 'text-slate-600 dark:text-slate-300'
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
                  ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 font-semibold'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <span>Audit & Rules</span>
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
                  ? 'bg-blue-700 text-white font-semibold'
                  : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Control Panel</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

