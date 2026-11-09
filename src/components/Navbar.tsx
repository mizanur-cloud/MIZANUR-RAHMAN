import React from 'react';
import {
  Calendar,
  Users,
  Grid3X3,
  AlertTriangle,
  Settings as SettingsIcon,
  Download,
  Sparkles,
  RotateCcw,
  BookOpen,
  UserCheck,
  UserMinus,
  UploadCloud,
  Edit,
  Layers,
} from 'lucide-react';

interface NavbarProps {
  activeTab: 'classes' | 'teachers' | 'master' | 'proxy' | 'conflicts';
  setActiveTab: (tab: 'classes' | 'teachers' | 'master' | 'proxy' | 'conflicts') => void;
  conflictCount: number;
  schoolName: string;
  academicYear: string;
  onOpenAutoGenerate: () => void;
  onOpenExport: () => void;
  onOpenSmartImport: () => void;
  onOpenSettings: () => void;
  onOpenClassMgmt: () => void;
  onOpenTeacherMgmt: () => void;
  onOpenSubjectMgmt: () => void;
  onReset: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  conflictCount,
  schoolName,
  academicYear,
  onOpenAutoGenerate,
  onOpenExport,
  onOpenSmartImport,
  onOpenSettings,
  onOpenClassMgmt,
  onOpenTeacherMgmt,
  onOpenSubjectMgmt,
  onReset,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Zone 1: Brand Wordmark (Editable School Info) */}
          <div
            onClick={onOpenSettings}
            title="Click to edit school name and institutional information"
            className="flex items-center gap-3 shrink-0 cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-lg bg-blue-700 dark:bg-blue-600 flex items-center justify-center text-white shadow-sm group-hover:bg-blue-800 transition-colors">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-900 dark:text-white tracking-tight leading-none text-base group-hover:text-blue-600 transition-colors">
                  {schoolName}
                </span>
                <Edit className="w-3 h-3 text-slate-400 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[200px] sm:max-w-[280px]">
                Smart Routine & Proxy System · {academicYear}
              </div>
            </div>
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            <button
              onClick={() => setActiveTab('classes')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                activeTab === 'classes'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Class Routines</span>
            </button>

            <button
              onClick={() => setActiveTab('teachers')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                activeTab === 'teachers'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Teacher Routines</span>
            </button>

            <button
              onClick={() => setActiveTab('master')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                activeTab === 'master'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <Grid3X3 className="w-4 h-4" />
              <span>Master Timetable</span>
            </button>

            <button
              onClick={() => setActiveTab('proxy')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                activeTab === 'proxy'
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <UserMinus className="w-4 h-4 text-rose-600" />
              <span>Proxy Routine (বদলি)</span>
            </button>

            <button
              onClick={() => setActiveTab('conflicts')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                conflictCount > 0
                  ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100'
                  : activeTab === 'conflicts'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <AlertTriangle className={`w-4 h-4 ${conflictCount > 0 ? 'text-amber-600 animate-pulse' : ''}`} />
              <span>Conflicts</span>
              {conflictCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 text-xs rounded-full font-bold">
                  {conflictCount}
                </span>
              )}
            </button>
          </nav>

          {/* Zone 3: Primary Action & Quick Modals */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Import File Button */}
            <button
              onClick={onOpenSmartImport}
              title="Import routine from Excel, PDF, Word, or Photo"
              className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-2xs"
            >
              <UploadCloud className="w-3.5 h-3.5 text-emerald-600" />
              <span>Import File</span>
            </button>

            {/* Setup Dropdown / Quick Buttons */}
            <div className="hidden lg:flex items-center gap-1">
              <button
                onClick={onOpenClassMgmt}
                title="Manage All Classes (Play to Class 10)"
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>All Classes</span>
              </button>

              <button
                onClick={onOpenTeacherMgmt}
                title="Manage Teachers & Quotas"
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Teachers</span>
              </button>

              <button
                onClick={onOpenSubjectMgmt}
                title="Manage All Subjects & Class Allocation (বিষয় যোগ ও পরিবর্তন)"
                className="px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-white bg-blue-50/80 dark:bg-blue-950/40 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap border border-blue-200/60 dark:border-blue-900/60"
              >
                <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Subjects</span>
              </button>

              <button
                onClick={onOpenSettings}
                title="School & Timing Settings"
                className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <SettingsIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Auto Generate Button */}
            <button
              onClick={onOpenAutoGenerate}
              className="px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Auto-Fill</span>
            </button>

            {/* Export Routine Downloads Modal */}
            <button
              onClick={onOpenExport}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Word / PDF</span>
            </button>
          </div>
        </div>

        {/* Mobile Navigation bar */}
        <div className="flex md:hidden border-t border-slate-200 dark:border-slate-800 py-2 gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab('classes')}
            className={`px-3 py-1.5 text-xs rounded-md whitespace-nowrap ${
              activeTab === 'classes' ? 'bg-blue-100 text-blue-800 font-semibold' : 'text-slate-600'
            }`}
          >
            Class Routines
          </button>
          <button
            onClick={() => setActiveTab('teachers')}
            className={`px-3 py-1.5 text-xs rounded-md whitespace-nowrap ${
              activeTab === 'teachers' ? 'bg-blue-100 text-blue-800 font-semibold' : 'text-slate-600'
            }`}
          >
            Teacher Routines
          </button>
          <button
            onClick={() => setActiveTab('master')}
            className={`px-3 py-1.5 text-xs rounded-md whitespace-nowrap ${
              activeTab === 'master' ? 'bg-blue-100 text-blue-800 font-semibold' : 'text-slate-600'
            }`}
          >
            Master Timetable
          </button>
          <button
            onClick={() => setActiveTab('proxy')}
            className={`px-3 py-1.5 text-xs rounded-md whitespace-nowrap ${
              activeTab === 'proxy' ? 'bg-rose-100 text-rose-800 font-semibold' : 'text-slate-600'
            }`}
          >
            Proxy Routine
          </button>
          <button
            onClick={() => setActiveTab('conflicts')}
            className={`px-3 py-1.5 text-xs rounded-md whitespace-nowrap flex items-center gap-1 ${
              activeTab === 'conflicts' ? 'bg-blue-100 text-blue-800 font-semibold' : 'text-slate-600'
            }`}
          >
            <span>Conflicts</span>
            {conflictCount > 0 && <span className="text-amber-600 font-bold">({conflictCount})</span>}
          </button>
        </div>
      </div>
    </header>
  );
};
