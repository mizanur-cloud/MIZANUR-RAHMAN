import React, { useEffect, useState } from 'react';
import { DayOfWeek, PeriodTiming, RoutineSnapshot, SchoolSettings, Subject, Teacher } from '../types';
import { X, Settings as SettingsIcon, RotateCcw, Download, Upload, Lock, Plus, Trash2, Coffee, SlidersHorizontal, History, ShieldCheck } from 'lucide-react';
import { AppState, deleteRoutineSnapshot, exportBackupJSON, importBackupJSON, loadRoutineSnapshots, saveRoutineSnapshot } from '../services/storage';
import { isHinduReligionTeacher } from '../services/parallelSubjects';
import { DEFAULT_DAILY_MAX_PERIODS, DEFAULT_MAX_WORKING_DAYS } from '../services/workloadService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SchoolSettings;
  teachers?: Teacher[];
  subjects?: Subject[];
  onUpdateSettings: (settings: SchoolSettings) => void;
  onResetToDefaults: () => void;
  fullAppState: AppState;
  onImportBackup: (newState: AppState) => void;
  onRestoreSnapshot?: (snapshot: RoutineSnapshot) => void;
  onApplyGlobalWorkloadLimits?: (dailyMax: number, workingDaysCount: number) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  teachers = [],
  subjects,
  onUpdateSettings,
  onResetToDefaults,
  fullAppState,
  onImportBackup,
  onRestoreSnapshot,
  onApplyGlobalWorkloadLimits,
}) => {
  const [schoolName, setSchoolName] = useState(settings.schoolName);
  const [academicYear, setAcademicYear] = useState(settings.academicYear);
  const [schoolAddress, setSchoolAddress] = useState(settings.schoolAddress);
  const [principalName, setPrincipalName] = useState(settings.principalName);
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>(settings.workingDays);
  const [periodTimings, setPeriodTimings] = useState<PeriodTiming[]>(settings.periodTimings);
  const [hinduRoom, setHinduRoom] = useState(settings.religionSchedule?.hinduRoom || '307');
  const [maxConcurrentSections, setMaxConcurrentSections] = useState<number>(
    settings.religionSchedule?.maxConcurrentSections || 3
  );
  const [combinedHinduTeacherId, setCombinedHinduTeacherId] = useState<string>(
    settings.religionSchedule?.combinedHinduTeacherId || 'tch-tapash'
  );
  const [combinedSlots, setCombinedSlots] = useState<{ day: DayOfWeek; periodIndex: number }[]>(
    settings.religionSchedule?.combinedSlots || []
  );
  const [defaultMaxDailyPeriods, setDefaultMaxDailyPeriods] = useState<number>(
    settings.defaultMaxDailyPeriods || DEFAULT_DAILY_MAX_PERIODS
  );
  const [defaultMaxWorkingDays, setDefaultMaxWorkingDays] = useState<number>(
    settings.defaultMaxWorkingDays || DEFAULT_MAX_WORKING_DAYS
  );
  const [snapshots, setSnapshots] = useState<RoutineSnapshot[]>([]);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [confirmApplyGlobal, setConfirmApplyGlobal] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSchoolName(settings.schoolName);
      setAcademicYear(settings.academicYear);
      setSchoolAddress(settings.schoolAddress);
      setPrincipalName(settings.principalName);
      setWorkingDays(settings.workingDays);
      setPeriodTimings(settings.periodTimings);
      setHinduRoom(settings.religionSchedule?.hinduRoom || '307');
      setMaxConcurrentSections(settings.religionSchedule?.maxConcurrentSections || 3);
      setCombinedHinduTeacherId(settings.religionSchedule?.combinedHinduTeacherId || 'tch-tapash');
      setCombinedSlots(settings.religionSchedule?.combinedSlots || []);
      setDefaultMaxDailyPeriods(settings.defaultMaxDailyPeriods || DEFAULT_DAILY_MAX_PERIODS);
      setDefaultMaxWorkingDays(settings.defaultMaxWorkingDays || DEFAULT_MAX_WORKING_DAYS);
      setSnapshots(loadRoutineSnapshots());
      setConfirmRestoreId(null);
      setConfirmApplyGlobal(false);
      setConfirmReset(false);
      setStatusMessage(null);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

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

  const handleToggleBreak = (index: number) => {
    const updated = [...periodTimings];
    const cur = updated[index];
    const willBeBreak = !cur.isBreak;
    updated[index] = {
      ...cur,
      isBreak: willBeBreak,
      isLocked: willBeBreak,
      label: willBeBreak
        ? (cur.label.includes('টিফিন') ? cur.label : `${cur.label.replace(' (টিফিন বিরতি)', '')} (টিফিন বিরতি)`)
        : cur.label.replace(' (টিফিন বিরতি)', ''),
    };
    setPeriodTimings(updated);
  };

  const handleAddPeriod = () => {
    const nextIdx = periodTimings.length + 1;
    // Calculate simple default start/end times
    const last = periodTimings[periodTimings.length - 1];
    const newPeriod: PeriodTiming = {
      periodIndex: nextIdx,
      label: `${nextIdx}${nextIdx === 1 ? 'st' : nextIdx === 2 ? 'nd' : nextIdx === 3 ? 'rd' : 'th'} Period`,
      startTime: last ? last.endTime : '01:30 PM',
      endTime: '02:15 PM',
      isBreak: false,
      isLocked: false,
    };
    setPeriodTimings([...periodTimings, newPeriod]);
  };

  const handleRemovePeriod = () => {
    if (periodTimings.length <= 4) {
      setStatusMessage({ type: 'error', text: 'ন্যূনতম ৪টি পিরিয়ড রাখা আবশ্যক।' });
      return;
    }
    setStatusMessage(null);
    setPeriodTimings(periodTimings.slice(0, periodTimings.length - 1));
  };

  const handleSetDefaultTiffin = () => {
    const updated = periodTimings.map((p, idx) => {
      if (idx === 3) {
        return {
          ...p,
          label: p.label.includes('টিফিন') ? p.label : `${p.label.replace(' (টিফিন বিরতি)', '')} (টিফিন বিরতি)`,
          isBreak: true,
          isLocked: true,
        };
      }
      return {
        ...p,
        label: p.label.replace(' (টিফিন বিরতি)', ''),
        isBreak: false,
        isLocked: false,
      };
    });
    setPeriodTimings(updated);
  };

  const handleTimingChange = (index: number, field: keyof PeriodTiming, value: any) => {
    const updated = [...periodTimings];
    updated[index] = { ...updated[index], [field]: value };
    setPeriodTimings(updated);
  };

  const handleToggleCombinedSlot = (day: DayOfWeek, periodIndex: number) => {
    const exists = combinedSlots.some(s => s.day === day && s.periodIndex === periodIndex);
    if (exists) {
      setCombinedSlots(combinedSlots.filter(s => !(s.day === day && s.periodIndex === periodIndex)));
    } else {
      setCombinedSlots([...combinedSlots, { day, periodIndex }]);
    }
  };

  const hinduTeachers = teachers.filter(t => !t.isBlockTeacher && isHinduReligionTeacher(t, subjects));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings({
      schoolName: schoolName.trim() || 'My School',
      academicYear: academicYear.trim() || '2026-2027',
      schoolAddress: schoolAddress.trim(),
      principalName: principalName.trim(),
      workingDays,
      periodTimings,
      defaultMaxDailyPeriods: Math.max(1, Math.min(8, Number(defaultMaxDailyPeriods) || DEFAULT_DAILY_MAX_PERIODS)),
      defaultMaxWorkingDays: Math.max(1, Math.min(6, Number(defaultMaxWorkingDays) || DEFAULT_MAX_WORKING_DAYS)),
      religionSchedule: {
        hinduRoom: hinduRoom.trim() || '307',
        maxConcurrentSections: Math.max(1, Math.min(6, Number(maxConcurrentSections) || 3)),
        combinedHinduTeacherId: combinedHinduTeacherId || undefined,
        combinedSlots,
      },
    });
    onClose();
  };

  const handleCreateManualSnapshot = () => {
    const created = saveRoutineSnapshot(`ম্যানুয়াল ব্যাকআপ (${new Date().toLocaleTimeString()})`, fullAppState);
    if (created) {
      setSnapshots(loadRoutineSnapshots());
      setStatusMessage({ type: 'success', text: 'বর্তমান রুটিন ও কনফিগারেশনের নিরাপদ স্ন্যাপশট সংরক্ষণ করা হয়েছে।' });
    } else {
      setStatusMessage({ type: 'error', text: 'ব্রাউজার স্টোরেজ সীমার কারণে স্ন্যাপশট সংরক্ষণ করা যায়নি।' });
    }
  };

  const handleDeleteSnapshotItem = (id: string) => {
    const next = deleteRoutineSnapshot(id);
    setSnapshots(next);
    if (confirmRestoreId === id) setConfirmRestoreId(null);
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
        setStatusMessage({ type: 'success', text: 'ব্যাকআপ ফাইল থেকে সম্পূর্ণ রুটিন সফলভাবে রিস্টোর হয়েছে।' });
      } catch (err: any) {
        setStatusMessage({ type: 'error', text: 'ব্যাকআপ ফাইল পড়া যায়নি: ' + (err?.message || 'Invalid JSON') });
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
          {statusMessage && (
            <div
              className={`px-3.5 py-2.5 rounded-lg border text-xs font-medium flex items-center justify-between gap-2 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              }`}
            >
              <span>{statusMessage.text}</span>
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                className="underline font-semibold shrink-0"
              >
                বন্ধ করুন
              </button>
            </div>
          )}
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
                  className="text-[10px] text-[#145343] dark:text-emerald-400 hover:underline px-1.5"
                >
                  Sun–Thu (Default)
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setWorkingDays(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])}
                  className="text-[10px] text-[#145343] dark:text-emerald-400 hover:underline px-1.5"
                >
                  Mon–Fri
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setWorkingDays(['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'])}
                  className="text-[10px] text-[#145343] dark:text-emerald-400 hover:underline px-1.5"
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
                        ? 'bg-[#145343] text-white shadow-2xs'
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
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 block">
                  Daily Period Bell Schedule & Tiffin Break
                </span>
                <span className="text-[11px] text-slate-500 font-normal">
                  মোট {periodTimings.length}টি পিরিয়ড কনফিগার করা আছে (যেকোনো পিরিয়ডকে টিফিন লক হিসেবে রাখতে পারেন)
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleSetDefaultTiffin}
                  title="৪র্থ পিরিয়ডকে টিফিন বিরতি হিসেবে লক করুন"
                  className="px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 rounded-lg border border-amber-200 dark:border-amber-800 flex items-center gap-1"
                >
                  <Coffee className="w-3 h-3 text-amber-600" />
                  <span>৪র্থ পিরিয়ড টিফিন</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddPeriod}
                  className="px-2.5 py-1 text-[11px] font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/50 hover:bg-[#dcebe4] rounded-lg border border-[#bfd5cc] dark:border-emerald-800 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3 text-[#145343] dark:text-emerald-400" />
                  <span>+ পিরিয়ড বৃদ্ধি</span>
                </button>
                <button
                  type="button"
                  onClick={handleRemovePeriod}
                  className="px-2 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 rounded-lg border border-rose-200 dark:border-rose-800 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3 text-rose-600" />
                  <span>- কমান</span>
                </button>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">পিরিয়ড নাম (Period)</th>
                    <th className="py-2.5 px-3 font-semibold">শুরু (Start)</th>
                    <th className="py-2.5 px-3 font-semibold">শেষ (End)</th>
                    <th className="py-2.5 px-3 font-semibold text-center">টিফিন বিরতি (লক 🔒)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {periodTimings.map((p, idx) => {
                    const isTiffin = Boolean(p.isBreak || p.isLocked);
                    return (
                      <tr
                        key={p.periodIndex}
                        className={`transition-colors ${
                          isTiffin
                            ? 'bg-amber-50/70 dark:bg-amber-950/30 font-medium'
                            : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20'
                        }`}
                      >
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                              {p.periodIndex}
                            </span>
                            <input
                              type="text"
                              value={p.label}
                              onChange={e => handleTimingChange(idx, 'label', e.target.value)}
                              className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-semibold"
                            />
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={p.startTime}
                            onChange={e => handleTimingChange(idx, 'startTime', e.target.value)}
                            className="w-24 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={p.endTime}
                            onChange={e => handleTimingChange(idx, 'endTime', e.target.value)}
                            className="w-24 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono"
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleBreak(idx)}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 mx-auto ${
                              isTiffin
                                ? 'bg-amber-600 text-white shadow-xs hover:bg-amber-700'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                            }`}
                          >
                            {isTiffin ? (
                              <>
                                <Lock className="w-3.5 h-3.5 text-white" />
                                <span>টিফিন লক (Break)</span>
                              </>
                            ) : (
                              <span>সাধারণ ক্লাস</span>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500">
              💡 <strong>টিফিন বিরতি ও লক সিস্টেম:</strong> যেকোনো পিরিয়ডকে টিফিন লক হিসেবে নির্বাচন করলে ঐ সময়ে সব শ্রেণির জন্য ক্লাস লক থাকবে এবং রুটিনে কোনো ক্লাস শিডিউল হবে না।
            </p>
          </div>

          {/* Combined Religious Class Scheduling */}
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Combined Religious Class Scheduling (ইসলাম ও হিন্দু ধর্ম সমন্বয়)</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  ইসলাম ধর্মের শিক্ষার্থীরা নিজ নিজ শ্রেণিকক্ষে আলাদা শিক্ষকের কাছে এবং হিন্দু ধর্মের শিক্ষার্থীরা সম্মিলিতভাবে নির্ধারিত রুমে সর্বোচ্চ নির্দিষ্ট সংখ্যক সেকশন একসাথে ক্লাস করবে।
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Hindu Combined Room
                </label>
                <input
                  type="text"
                  value={hinduRoom}
                  onChange={e => setHinduRoom(e.target.value)}
                  placeholder="307"
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Max Sections / Period
                </label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={maxConcurrentSections}
                  onChange={e => setMaxConcurrentSections(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Combined Hindu Teacher
                </label>
                <select
                  value={combinedHinduTeacherId}
                  onChange={e => setCombinedHinduTeacherId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-medium"
                >
                  <option value="">Any Qualified Teacher</option>
                  {(hinduTeachers.length > 0 ? hinduTeachers : teachers.filter(t => !t.isBlockTeacher)).map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.initials})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Preferred Combined Religion Periods (ঐচ্ছিক — অগ্রাধিকার পাবে):
                </span>
                {combinedSlots.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCombinedSlots([])}
                    className="text-[10px] text-rose-600 dark:text-rose-400 hover:underline font-semibold"
                  >
                    সব পরিষ্কার করুন
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {workingDays.map(day =>
                  periodTimings
                    .filter(p => !p.isBreak && !p.isLocked)
                    .slice(0, 6)
                    .map(p => {
                      const active = combinedSlots.some(
                        s => s.day === day && s.periodIndex === p.periodIndex
                      );
                      return (
                        <button
                          key={`${day}_${p.periodIndex}`}
                          type="button"
                          onClick={() => handleToggleCombinedSlot(day, p.periodIndex)}
                          className={`px-2 py-1 text-[10px] font-semibold rounded-md border transition-colors ${
                            active
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-amber-400'
                          }`}
                        >
                          {day.slice(0, 3)} P{p.periodIndex}
                        </button>
                      );
                    })
                )}
              </div>
            </div>
          </div>

          {/* Global Teacher Workload Limits Policy */}
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[#145343] dark:text-emerald-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Teacher Daily & Weekly Workload Policy (গ্লোবাল ওয়ার্কলোড নীতি)</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  ডিফল্ট দৈনিক ক্লাস সীমা (৪টি) ও সর্বোচ্চ সাপ্তাহিক কর্মদিবস (৫ দিন) নির্ধারণ করুন এবং প্রয়োজনে সকল নিয়মিত শিক্ষকে প্রয়োগ করুন।
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl border border-[#bfd5cc] dark:border-emerald-900/60 bg-[#eef5f2]/60 dark:bg-emerald-950/20">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Default Max Daily Classes (দৈনিক সর্বোচ্চ পিরিয়ড)
                </label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={defaultMaxDailyPeriods}
                  onChange={e => setDefaultMaxDailyPeriods(Math.max(1, Math.min(8, Number(e.target.value) || DEFAULT_DAILY_MAX_PERIODS)))}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Default Max Working Days / Week (সাপ্তাহিক সর্বোচ্চ দিন)
                </label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={defaultMaxWorkingDays}
                  onChange={e => setDefaultMaxWorkingDays(Math.max(1, Math.min(6, Number(e.target.value) || DEFAULT_MAX_WORKING_DAYS)))}
                  className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {onApplyGlobalWorkloadLimits && (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {confirmApplyGlobal ? (
                  <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-1.5 w-full justify-between">
                    <span className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-200">
                      সব নিয়মিত শিক্ষকের দৈনিক সীমা {defaultMaxDailyPeriods} ও কর্মদিবস {defaultMaxWorkingDays} দিন সেট করবেন?
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onApplyGlobalWorkloadLimits(defaultMaxDailyPeriods, defaultMaxWorkingDays);
                          setConfirmApplyGlobal(false);
                          setStatusMessage({
                            type: 'success',
                            text: `সকল নিয়মিত শিক্ষকে দৈনিক ${defaultMaxDailyPeriods} পিরিয়ড এবং সপ্তাহে ${defaultMaxWorkingDays} কর্মদিবস প্রয়োগ হয়েছে।`,
                          });
                        }}
                        className="px-2.5 py-1 text-[11px] font-bold text-white bg-[#145343] hover:bg-[#0f3f33] rounded"
                      >
                        হ্যাঁ, প্রয়োগ করুন
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmApplyGlobal(false)}
                        className="px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded"
                      >
                        বাতিল
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmApplyGlobal(true)}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/50 hover:bg-[#dfece7] rounded-lg border border-[#bfd5cc] dark:border-emerald-800 transition-colors"
                  >
                    সকল নিয়মিত শিক্ষকে সীমা প্রয়োগ করুন (Apply to All Regular Teachers)
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Snapshot Undo / Restore Safety Vault */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  <span>Routine Snapshots & Restore (অটো-সেভড ইতিহাস)</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  রুটিন তৈরি, অটো-ফিক্স বা রিসেটের পূর্বে স্বয়ংক্রিয়ভাবে সংরক্ষিত পূর্ববর্তী অবস্থা ১ ক্লিকে ফিরিয়ে আনুন।
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreateManualSnapshot}
                className="min-h-[36px] px-2.5 py-1 text-[11px] font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/50 hover:bg-[#dfece7] rounded-lg border border-[#bfd5cc] dark:border-emerald-800 transition-colors"
              >
                + বর্তমান স্ন্যাপশট সংরক্ষণ
              </button>
            </div>

            {snapshots.length === 0 ? (
              <div className="p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400 text-center">
                এখনো কোনো রুটিন স্ন্যাপশট সংরক্ষিত হয়নি। অটো-জেনারেট বা Auto Fix চালালে স্বয়ংক্রিয়ভাবে ব্যাকআপ জমা হবে।
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {snapshots.map(snap => (
                  <div
                    key={snap.id}
                    className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {snap.label}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono tabular-nums">
                          {new Date(snap.createdAt).toLocaleString()} · {snap.entryCount} slots
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {onRestoreSnapshot && (
                          <button
                            type="button"
                            onClick={() => setConfirmRestoreId(confirmRestoreId === snap.id ? null : snap.id)}
                            className="min-h-[36px] px-2.5 py-1 text-[11px] font-semibold text-[#145343] dark:text-emerald-300 bg-white dark:bg-slate-900 border border-[#bfd5cc] dark:border-emerald-800 hover:bg-[#eef5f2] rounded-lg"
                          >
                            Restore
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteSnapshotItem(snap.id)}
                          title="Delete snapshot"
                          className="min-h-[36px] p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {confirmRestoreId === snap.id && onRestoreSnapshot && (
                      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200 dark:border-slate-700 text-[11px]">
                        <span className="font-semibold text-amber-800 dark:text-amber-300">
                          এই স্ন্যাপশটে ফিরে যেতে চান? (বর্তমান রুটিন ব্যাকআপ রাখা হবে)
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onRestoreSnapshot(snap);
                              setConfirmRestoreId(null);
                              setSnapshots(loadRoutineSnapshots());
                              setStatusMessage({ type: 'success', text: `"${snap.label}" সফলভাবে রিস্টোর করা হয়েছে।` });
                            }}
                            className="px-2.5 py-1 font-bold text-white bg-[#145343] hover:bg-[#0f3f33] rounded"
                          >
                            হ্যাঁ, রিস্টোর করুন
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRestoreId(null)}
                            className="px-2 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"
                          >
                            বাতিল
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
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
                className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export JSON Backup</span>
              </button>

              <label className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                <span>Restore JSON Backup</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleBackupImport}
                  className="hidden"
                />
              </label>

              {confirmReset ? (
                <div className="flex items-center gap-1.5 ml-auto bg-rose-50 dark:bg-rose-950/60 p-1 rounded-lg border border-rose-200 dark:border-rose-800">
                  <span className="text-[11px] text-rose-700 dark:text-rose-300 font-semibold px-1">
                    সব রিসেট করবেন?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onResetToDefaults();
                      onClose();
                    }}
                    className="px-2 py-1 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors"
                  >
                    হ্যাঁ, রিসেট করুন
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
                  >
                    বাতিল
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg flex items-center gap-1.5 transition-colors ml-auto"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset to Factory Defaults</span>
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-[44px] px-5 py-2 text-xs font-semibold text-white bg-[#145343] hover:bg-[#0f3f33] dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg shadow-xs transition-colors"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
