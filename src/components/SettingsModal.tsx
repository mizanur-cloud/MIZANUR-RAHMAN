import React, { useState } from 'react';
import { DayOfWeek, PeriodTiming, SchoolSettings } from '../types';
import { X, Settings as SettingsIcon, RotateCcw, Download, Upload, Check, Clock, Calendar } from 'lucide-react';
import { AppState, exportBackupJSON, importBackupJSON } from '../services/storage';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SchoolSettings;
  onUpdateSettings: (settings: SchoolSettings) => void;
  onResetToDefaults: () => void;
  fullAppState: AppState;
  onImportBackup: (newState: AppState) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onResetToDefaults,
  fullAppState,
  onImportBackup,
}) => {
  if (!isOpen) return null;

  const [schoolName, setSchoolName] = useState(settings.schoolName);
  const [academicYear, setAcademicYear] = useState(settings.academicYear);
  const [schoolAddress, setSchoolAddress] = useState(settings.schoolAddress);
  const [principalName, setPrincipalName] = useState(settings.principalName);
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>(settings.workingDays);
  const [periodTimings, setPeriodTimings] = useState<PeriodTiming[]>(settings.periodTimings);

  const ALL_DAYS: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const toggleDay = (day: DayOfWeek) => {
    if (workingDays.includes(day)) {
      if (workingDays.length > 2) {
        setWorkingDays(workingDays.filter(d => d !== day));
      }
    } else {
      // Keep in standard calendar order
      const next = ALL_DAYS.filter(d => workingDays.includes(d) || d === day);
      setWorkingDays(next);
    }
  };

  const handleTimingChange = (index: number, field: keyof PeriodTiming, value: string) => {
    const updated = [...periodTimings];
    updated[index] = { ...updated[index], [field]: value };
    setPeriodTimings(updated);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings({
      schoolName: schoolName.trim() || 'My School',
      academicYear: academicYear.trim() || '2026-2027',
      schoolAddress: schoolAddress.trim(),
      principalName: principalName.trim(),
      workingDays,
      periodTimings,
    });
    onClose();
  };

  const handleBackupExport = () => {
    const jsonStr = exportBackupJSON(fullAppState);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Routine_Backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBackupImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const content = ev.target?.result as string;
        const restored = importBackupJSON(content);
        onImportBackup(restored);
        alert('Timetable database successfully restored from backup.');
        onClose();
      } catch (err: any) {
        alert('Failed to parse backup file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <SettingsIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                School & Bell Schedule Settings
              </h2>
              <p className="text-xs text-slate-500">
                School branding, working days, and period timing bell schedule.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* General Info */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              School Header & Identification
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  School Name
                </label>
                <input
                  type="text"
                  value={schoolName}
                  onChange={e => setSchoolName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Academic Year
                </label>
                <input
                  type="text"
                  value={academicYear}
                  onChange={e => setAcademicYear(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Campus Address / City
                </label>
                <input
                  type="text"
                  value={schoolAddress}
                  onChange={e => setSchoolAddress(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Headmaster / Principal
                </label>
                <input
                  type="text"
                  value={principalName}
                  onChange={e => setPrincipalName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Working Days */}
          <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                School Working Days
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setWorkingDays(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'])}
                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline px-1.5"
                >
                  Sun–Thu (Default)
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setWorkingDays(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])}
                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline px-1.5"
                >
                  Mon–Fri
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setWorkingDays(['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'])}
                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline px-1.5"
                >
                  Sat–Thu (6-Day)
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ALL_DAYS.map(day => {
                const isActive = workingDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Period Timings & Bell Schedule */}
          <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center justify-between">
              <span>Daily Period Bell Schedule</span>
              <span className="text-[11px] text-slate-400 font-normal">
                {periodTimings.length} periods configured
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2 px-3 font-semibold">Period</th>
                    <th className="py-2 px-3 font-semibold">Start Time</th>
                    <th className="py-2 px-3 font-semibold">End Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {periodTimings.map((p, idx) => (
                    <tr key={p.periodIndex} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                      <td className="py-1.5 px-3">
                        <input
                          type="text"
                          value={p.label}
                          onChange={e => handleTimingChange(idx, 'label', e.target.value)}
                          className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-semibold"
                        />
                      </td>
                      <td className="py-1.5 px-3">
                        <input
                          type="text"
                          value={p.startTime}
                          onChange={e => handleTimingChange(idx, 'startTime', e.target.value)}
                          className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono"
                        />
                      </td>
                      <td className="py-1.5 px-3">
                        <input
                          type="text"
                          value={p.endTime}
                          onChange={e => handleTimingChange(idx, 'endTime', e.target.value)}
                          className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Backup, Restore & Reset */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Database Backup & Management
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleBackupExport}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export JSON Backup</span>
              </button>

              <label className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                <span>Restore JSON Backup</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleBackupImport}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  if (confirm('Reset entire timetable to initial default data? All changes will be replaced with clean seed data.')) {
                    onResetToDefaults();
                    onClose();
                  }
                }}
                className="px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg flex items-center gap-1.5 transition-colors ml-auto"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Factory Defaults</span>
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-xs"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
