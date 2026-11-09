import React, { useState } from 'react';
import { SchoolClass, Teacher } from '../types';
import { Sparkles, X, Check, CheckCircle2, Sliders, ShieldCheck } from 'lucide-react';
import { GenerationOptions, GenerationResult } from '../services/routineGenerator';

interface AutoGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: SchoolClass[];
  selectedClassId: string;
  selectedSectionId: string;
  onExecuteGenerate: (options: GenerationOptions) => GenerationResult;
}

export const AutoGenerateModal: React.FC<AutoGenerateModalProps> = ({
  isOpen,
  onClose,
  classes,
  selectedClassId,
  selectedSectionId,
  onExecuteGenerate,
}) => {
  if (!isOpen) return null;

  const currentClass = classes.find(c => c.id === selectedClassId) || classes[0];
  const currentSection = currentClass?.sections.find(s => s.id === selectedSectionId) || currentClass?.sections[0];

  const [scope, setScope] = useState<'all' | 'class' | 'section'>('all');
  const [preserveLocked, setPreserveLocked] = useState<boolean>(false);
  const [maxConsecutive, setMaxConsecutive] = useState<number>(2);
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const handleGenerate = () => {
    setIsProcessing(true);
    // Slight timeout so UI shows feedback
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
    }, 250);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Automated Routine Generator
              </h2>
              <p className="text-xs text-slate-500">
                Constraint-satisfaction engine with zero-conflict guarantee.
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
        <div className="p-6 space-y-5">
          {generationResult ? (
            /* Result Screen */
            <div className="text-center py-4 space-y-4">
              <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Routine Generation Completed!
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  {generationResult.message}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-semibold text-slate-500">Sections Scheduled</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                    {generationResult.stats.totalClassesScheduled}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-semibold text-slate-500">Periods Assigned</div>
                  <div className="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                    {generationResult.stats.totalPeriodsAssigned}
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => {
                    setGenerationResult(null);
                    onClose();
                  }}
                  className="w-full py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors shadow-xs"
                >
                  View Updated Routines
                </button>
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
                    <div className="text-[10px] text-slate-500 mt-0.5">Classes 1 - 10</div>
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

                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Teacher Conflict Guarantee
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Ensures zero double-booking across any class or section.
                    </div>
                  </div>
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
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
