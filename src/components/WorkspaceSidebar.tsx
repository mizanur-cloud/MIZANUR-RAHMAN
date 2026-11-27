import React, { useState } from 'react';
import {
  BookOpen,
  UserCheck,
  Layers,
  Settings as SettingsIcon,
  UploadCloud,
  Printer,
  Globe,
  Check,
  HelpCircle,
  ShieldCheck,
  AlertTriangle,
  Shield,
  Lock,
  Radio,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface WorkspaceSidebarProps {
  totalClasses: number;
  totalTeachers: number;
  totalEntries: number;
  errorCount: number;
  warningCount: number;
  canEdit: boolean;
  isSuperAdmin: boolean;
  onOpenLiveDashboard: () => void;
  onOpenClassMgmt: () => void;
  onOpenTeacherMgmt: () => void;
  onOpenSubjectMgmt: () => void;
  onOpenSettings: () => void;
  onOpenSmartImport: () => void;
  onOpenHelpAndInstall: () => void;
  onOpenCompliance: () => void;
  onOpenControlPanel: () => void;
}

export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  totalClasses,
  totalTeachers,
  totalEntries,
  errorCount,
  warningCount,
  canEdit,
  isSuperAdmin,
  onOpenLiveDashboard,
  onOpenClassMgmt,
  onOpenTeacherMgmt,
  onOpenSubjectMgmt,
  onOpenSettings,
  onOpenSmartImport,
  onOpenHelpAndInstall,
  onOpenCompliance,
  onOpenControlPanel,
}) => {
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  const PUBLIC_DOMAIN_URL = 'https://ais-pre-24ugampdbbfry7osz7xs3e-734890175875.asia-southeast1.run.app';

  const handleCopyShareLink = () => {
    const urlToCopy =
      typeof window !== 'undefined' && window.location.origin.includes('.run.app')
        ? window.location.origin
        : PUBLIC_DOMAIN_URL;
    navigator.clipboard.writeText(urlToCopy);
    setCopiedShareLink(true);
    setTimeout(() => setCopiedShareLink(false), 2500);
  };

  return (
    <aside className="no-print w-full lg:w-60 shrink-0 space-y-4">
      <div className="bg-white dark:bg-[#141a20] rounded-xl border border-stone-200 dark:border-slate-800 p-3 space-y-4">
        {/* Live Campus Monitor Quick Shortcut */}
        <div>
          <button
            type="button"
            onClick={onOpenLiveDashboard}
            className="w-full px-2.5 py-2 text-xs font-bold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/50 hover:bg-[#dfece6] dark:hover:bg-emerald-900/60 border border-[#bfd5cc] dark:border-emerald-800/80 rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap"
          >
            <Radio className="w-4 h-4 shrink-0" />
            <span className="truncate">লাইভ ক্লাস ড্যাশবোর্ড</span>
          </button>
        </div>

        {/* Super Admin Control Panel Shortcut */}
        {isSuperAdmin && (
          <>
            <div className="border-t border-stone-100 dark:border-slate-800" />
            <div>
              <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-[#145343] dark:text-emerald-400">
                Security & RBAC
              </div>
              <button
                type="button"
                onClick={onOpenControlPanel}
                className="w-full px-2.5 py-2 text-xs font-bold text-white bg-[#145343] hover:bg-[#0f3f33] dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap"
              >
                <Shield className="w-4 h-4 shrink-0" />
                <span className="truncate">Control Panel (Admins)</span>
              </button>
            </div>
          </>
        )}

        <div className="border-t border-stone-100 dark:border-slate-800" />

        {/* Academic Setup (Editors only) */}
        {canEdit ? (
          <>
            <div>
              <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-stone-500 dark:text-slate-400">
                Academic Setup
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-1">
                <button
                  type="button"
                  onClick={onOpenClassMgmt}
                  className="w-full px-2.5 py-2 text-xs font-medium text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap"
                >
                  <BookOpen className="w-4 h-4 text-[#145343] dark:text-emerald-400 shrink-0" />
                  <span className="truncate">Classes (Play–10)</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenTeacherMgmt}
                  className="w-full px-2.5 py-2 text-xs font-medium text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap"
                >
                  <UserCheck className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <span className="truncate">Faculty & Teachers</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenSubjectMgmt}
                  className="w-full px-2.5 py-2 text-xs font-medium text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap"
                >
                  <Layers className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                  <span className="truncate">Subjects & Quotas</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="w-full px-2.5 py-2 text-xs font-medium text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap"
                >
                  <SettingsIcon className="w-4 h-4 text-stone-500 dark:text-slate-400 shrink-0" />
                  <span className="truncate">Bell & Backup Settings</span>
                </button>
              </div>
            </div>

            <div className="border-t border-stone-100 dark:border-slate-800" />
          </>
        ) : (
          <div className="px-2.5 py-2 rounded-lg bg-[#f7f5f0] dark:bg-slate-800/60 border border-stone-200 dark:border-slate-700 text-[11px] text-stone-600 dark:text-slate-300 flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
            <span>প্রকাশিত রুটিন দেখার মোড (Read-Only)।</span>
          </div>
        )}

        {/* Data, Sharing & Print */}
        <div>
          <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-stone-500 dark:text-slate-400">
            Tools & Distribution
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-1">
            {canEdit && (
              <button
                type="button"
                onClick={onOpenSmartImport}
                className="w-full px-2.5 py-2 text-xs font-medium text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap"
              >
                <UploadCloud className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span className="truncate">Import File / Photo</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              className="w-full px-2.5 py-2 text-xs font-medium text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap"
            >
              <Printer className="w-4 h-4 text-stone-600 dark:text-slate-400 shrink-0" />
              <span className="truncate">Print Active View</span>
            </button>

            <button
              type="button"
              onClick={handleCopyShareLink}
              className={`w-full px-2.5 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap ${
                copiedShareLink
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold'
                  : 'text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800/80'
              }`}
            >
              {copiedShareLink ? (
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <Globe className="w-4 h-4 text-[#145343] dark:text-emerald-400 shrink-0" />
              )}
              <span className="truncate">{copiedShareLink ? 'লিংক কপি হয়েছে!' : 'Copy Share Link'}</span>
            </button>

            <button
              type="button"
              onClick={onOpenHelpAndInstall}
              className="w-full px-2.5 py-2 text-xs font-medium text-stone-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors flex items-center gap-2.5 text-left whitespace-nowrap"
            >
              <HelpCircle className="w-4 h-4 text-stone-500 dark:text-slate-400 shrink-0" />
              <span className="truncate">User Guide & App Install</span>
            </button>
          </div>

          <div className="mt-2 px-1 hidden lg:block">
            <PWAInstallButton onOpenHelp={onOpenHelpAndInstall} />
          </div>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 hidden lg:block" />

        {/* Live Institution Snapshot */}
        <div className="hidden lg:block px-2.5 space-y-2.5">
          <div className="text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400">
            Schedule Summary
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Classes Active</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                {totalClasses}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Faculty Members</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                {totalTeachers}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Scheduled Slots</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                {totalEntries}
              </span>
            </div>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={onOpenCompliance}
              className={`w-full mt-1 px-2.5 py-2 rounded-lg border text-xs font-medium flex items-center justify-between transition-colors ${
                errorCount > 0
                  ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200'
                  : warningCount > 0
                  ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'
                  : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
              }`}
            >
              <span className="flex items-center gap-1.5 truncate">
                {errorCount > 0 || warningCount > 0 ? (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="truncate">
                  {errorCount > 0
                    ? `${errorCount} Collision${errorCount > 1 ? 's' : ''}`
                    : warningCount > 0
                    ? `${warningCount} Pacing Notice${warningCount > 1 ? 's' : ''}`
                    : 'All Rules Verified'}
                </span>
              </span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
