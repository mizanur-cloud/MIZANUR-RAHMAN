import React, { useState } from 'react';
import { SchoolClass } from '../types';
import {
  Sparkles,
  X,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { GenerationOptions, GenerationResult } from '../services/routineGenerator';

interface AutoGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: SchoolClass[];
  selectedClassId: string;
  selectedSectionId: string;
  onExecuteGenerate: (options: GenerationOptions) => GenerationResult;
  onOpenAudit?: () => void;
}

export const AutoGenerateModal: React.FC<AutoGenerateModalProps> = ({
  isOpen,
  onClose,
  classes,
  selectedClassId,
  selectedSectionId,
  onExecuteGenerate,
  onOpenAudit,
}) => {
  const currentClass = classes.find(c => c.id === selectedClassId) || classes[0];
  const currentSection =
    currentClass?.sections.find(s => s.id === selectedSectionId) || currentClass?.sections[0];

  const [scope, setScope] = useState<'all' | 'class' | 'section'>('all');
  const [preserveLocked, setPreserveLocked] = useState<boolean>(false);
  const [maxConsecutive, setMaxConsecutive] = useState<number>(2);
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleGenerate = () => {
    setIsProcessing(true);
    setTimeout(() => {
      const result = onExecuteGenerate({
        scope,
        targetClassId: currentClass?.id,
        targetSectionId: currentSection?.id,
        preserveLockedEntries: preserveLocked,
        maxConsecutiveLimit: maxConsecutive,
      });
      setIsProcessing(false);
      setGenerationResult(result);
    }, 200);
  };

  const verification = generationResult?.verification;
  const status = verification?.finalCompletionStatus || (generationResult?.success ? 'complete' : 'incomplete');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div
        className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full ${
          generationResult ? 'max-w-3xl' : 'max-w-lg'
        } max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {generationResult ? 'Final Routine Verification Dashboard' : 'Automated Routine Generator'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {generationResult
                  ? `${verification?.scopeLabel || 'School Routine'} · Post-generation integrity & conflict verification`
                  : 'Constraint-satisfaction engine with zero-unassigned & smart religion scheduling.'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setGenerationResult(null);
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {generationResult && verification ? (
            /* Final Routine Verification Dashboard */
            <div className="space-y-5">
              {/* Completion Status Banner */}
              <div
                className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  status === 'complete'
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-950 dark:text-emerald-100'
                    : status === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-950 dark:text-amber-100'
                    : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-950 dark:text-rose-100'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg shrink-0 ${
                      status === 'complete'
                        ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                        : status === 'warning'
                        ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
                        : 'bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {status === 'complete' ? (
                      <CheckCircle2 className="w-6 h-6" />
                    ) : status === 'warning' ? (
                      <AlertTriangle className="w-6 h-6" />
                    ) : (
                      <ShieldAlert className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">{verification.statusHeadline}</h3>
                    <p className="text-xs opacity-85 mt-0.5">{verification.statusSubtext}</p>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide shrink-0 self-start sm:self-center ${
                    status === 'complete'
                      ? 'bg-emerald-600 text-white'
                      : status === 'warning'
                      ? 'bg-amber-600 text-white'
                      : 'bg-rose-600 text-white'
                  }`}
                >
                  {status === 'complete'
                    ? 'Complete'
                    : status === 'warning'
                    ? 'Advisory Notice'
                    : 'Incomplete'}
                </span>
              </div>

              {/* 10 Verification Dashboard Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Total Classes Required
                  </div>
                  <div className="text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                    {verification.totalClassesRequired}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Total Classes Assigned
                  </div>
                  <div className="text-lg font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums mt-0.5">
                    {verification.totalClassesAssigned}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Total Teachers / Subjects
                  </div>
                  <div className="text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                    {verification.totalTeachers} <span className="text-xs font-normal text-slate-400">/ {verification.totalSubjects} subs</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Total Sections
                  </div>
                  <div className="text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                    {verification.totalSections}
                  </div>
                </div>

                <div
                  className={`p-3 rounded-xl border ${
                    verification.unassignedClasses > 0
                      ? 'border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Unassigned Classes
                  </div>
                  <div
                    className={`text-lg font-mono font-bold tabular-nums mt-0.5 ${
                      verification.unassignedClasses > 0
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {verification.unassignedClasses}
                  </div>
                </div>

                <div
                  className={`p-3 rounded-xl border ${
                    verification.teacherConflicts > 0
                      ? 'border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Teacher Conflicts
                  </div>
                  <div
                    className={`text-lg font-mono font-bold tabular-nums mt-0.5 ${
                      verification.teacherConflicts > 0
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {verification.teacherConflicts}
                  </div>
                </div>

                <div
                  className={`p-3 rounded-xl border ${
                    verification.classSectionConflicts > 0
                      ? 'border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Class/Section Conflicts
                  </div>
                  <div
                    className={`text-lg font-mono font-bold tabular-nums mt-0.5 ${
                      verification.classSectionConflicts > 0
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {verification.classSectionConflicts}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Religion Scheduling Status
                  </div>
                  <div
                    className={`text-xs font-bold mt-1 ${
                      verification.religionSchedulingStatus.ok
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {verification.religionSchedulingStatus.label}
                  </div>
                </div>
              </div>

              {/* Religion Scheduling Detail Strip */}
              <div className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>ধর্মীয় বিষয় সমন্বয়:</strong> {verification.religionSchedulingStatus.detail}
                </span>
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {generationResult.stats.totalClassesScheduled} sections · {generationResult.stats.totalPeriodsAssigned} slots
                </span>
              </div>

              {/* 8-Point Final Validation Statuses */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    চূড়ান্ত ৮-দফা ভ্যালিডেশন স্ট্যাটাস (Final Validation Dashboard)
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                      verification.finalValidation.allPassed
                        ? 'bg-emerald-600 text-white'
                        : 'bg-rose-600 text-white'
                    }`}
                  >
                    {verification.finalValidation.allPassed ? 'ALL PASS' : 'HAS FAIL'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-white dark:bg-slate-900">
                  {verification.finalValidation.items.map(item => (
                    <div
                      key={item.id}
                      className={`px-3 py-2 rounded-lg border flex flex-col gap-0.5 text-xs ${
                        item.status === 'PASS'
                          ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20'
                          : 'border-rose-300 dark:border-rose-900/70 bg-rose-50/60 dark:bg-rose-950/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {item.label}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                            item.status === 'PASS'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-200'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-900/70 dark:text-rose-200'
                          }`}
                        >
                          {item.valueText}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.detail}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 7-Point Automatic Policy Checks */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  স্বয়ংক্রিয় ৭-দফা রুটিন যাচাই (Automatic Verification Checks)
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {verification.checks.map(chk => (
                    <div
                      key={chk.id}
                      className="px-4 py-2 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {chk.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        ) : chk.severity === 'warning' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-semibold text-slate-800 dark:text-slate-100">
                            {chk.label}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {chk.detail}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-semibold shrink-0 ${
                          chk.passed
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : chk.severity === 'warning'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {chk.passed ? 'Passed' : chk.severity === 'warning' ? 'Notice' : 'Failed'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Unassigned Breakdown Table (if any classes remain unassigned) */}
              {verification.unassignedDetails.length > 0 && (
                <div className="border border-rose-200 dark:border-rose-900 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900 text-xs font-bold text-rose-900 dark:text-rose-200">
                    বরাদ্দ বাকি থাকা ক্লাস তালিকা (Unassigned Classes — {verification.unassignedClasses} পিরিয়ড)
                  </div>
                  <div className="overflow-x-auto max-h-52">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2 px-3 font-semibold">Class · Section</th>
                          <th className="py-2 px-3 font-semibold">Subject</th>
                          <th className="py-2 px-3 font-semibold">Teacher</th>
                          <th className="py-2 px-3 font-semibold text-right">Missing</th>
                          <th className="py-2 px-3 font-semibold">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {verification.unassignedDetails.map((item, idx) => (
                          <tr key={`${item.classId}_${item.sectionId}_${item.subjectId}_${idx}`}>
                            <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                              {item.className} · {item.sectionName}
                            </td>
                            <td className="py-2 px-3 text-slate-800 dark:text-slate-200">
                              {item.subjectName}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                              {item.assignedTeacherName || '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                              {item.missingPeriods} / {item.requiredPeriods}
                            </td>
                            <td className="py-2 px-3 text-[11px] text-slate-500 dark:text-slate-400">
                              {item.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Footer Actions */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setGenerationResult(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>পুনরায় সেটআপ</span>
                </button>
                <div className="flex items-center gap-2 ml-auto">
                  {onOpenAudit && (
                    <button
                      type="button"
                      onClick={() => {
                        setGenerationResult(null);
                        onOpenAudit();
                      }}
                      className="px-3.5 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-1.5"
                    >
                      <span>Inspect Full Audit</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setGenerationResult(null);
                      onClose();
                    }}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors shadow-xs"
                  >
                    View Updated Routines
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Configuration Screen */
            <>
              {/* Generation Scope */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
                  Select Scope
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      scope === 'all'
                        ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 ring-1 ring-blue-500'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">All School</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Play — Class 10</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('class')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      scope === 'class'
                        ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 ring-1 ring-blue-500'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">{currentClass?.name}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">All {currentClass?.sections.length} sections</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('section')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      scope === 'section'
                        ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 ring-1 ring-blue-500'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">{currentSection?.name} Only</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{currentClass?.name}</div>
                  </button>
                </div>
              </div>

              {/* Optimization Rules & Guardrails */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Rules & Scheduling Constraints
                </div>

                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>শূন্য কনফ্লিক্ট ও নির্ভুল বরাদ্দ নীতি</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200">
                      সক্রিয়
                    </span>
                  </div>
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
                    সেকশন-ভিত্তিক নির্বাচিত বিষয়, ইসলাম ও হিন্দু ধর্মের স্মার্ট সমন্বয়, শিক্ষকদের ওয়ার্কলোড ব্যালেন্সিং এবং শতভাগ শিক্ষক-সাবজেক্ট ম্যাচ নিশ্চিত করে রুটিন তৈরি হবে।
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Max Consecutive Classes Limit
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Restricts teachers from teaching more than {maxConsecutive} consecutive periods.
                    </div>
                  </div>
                  <select
                    value={maxConsecutive}
                    onChange={e => setMaxConsecutive(Number(e.target.value))}
                    className="py-1 px-2.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md font-semibold text-slate-800 dark:text-slate-200"
                  >
                    <option value={2}>Max 2 classes</option>
                    <option value={3}>Max 3 classes</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Preserve Pre-existing Slots
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Keep manually assigned periods and only fill remaining empty slots.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={preserveLocked}
                    onChange={e => setPreserveLocked(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isProcessing}
                  className="px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-2 shadow-xs disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isProcessing ? 'Generating...' : 'Start Auto-Generation'}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
