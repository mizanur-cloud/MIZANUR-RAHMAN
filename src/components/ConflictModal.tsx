import React from 'react';
import { RoutineConflict, SchoolClass, Teacher } from '../types';
import { AlertTriangle, CheckCircle, X, ShieldAlert, ArrowRight } from 'lucide-react';

interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflicts: RoutineConflict[];
  onResolveConflict: (conflict: RoutineConflict) => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  isOpen,
  onClose,
  conflicts,
  onResolveConflict,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${conflicts.length > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}`}>
              {conflicts.length > 0 ? <ShieldAlert className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Timetable Conflict & Compliance Monitor
              </h2>
              <p className="text-xs text-slate-500">
                {conflicts.length === 0
                  ? 'All timetable entries are 100% conflict-free and compliant.'
                  : `${conflicts.length} scheduling issues detected requiring attention.`}
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

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {conflicts.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Zero Conflicts Found!
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                No teacher is double-booked, no class has overlapping subjects, and all teacher consecutive class limits are fully respected.
              </p>
            </div>
          ) : (
            conflicts.map(conf => (
              <div
                key={conf.id}
                className={`p-4 rounded-xl border flex items-start justify-between gap-4 transition-all ${
                  conf.severity === 'error'
                    ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60'
                    : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/60'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                        conf.severity === 'error'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
                      }`}
                    >
                      {conf.type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {conf.day} · Period {conf.periodIndex}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    {conf.title}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {conf.description}
                  </p>
                </div>

                <button
                  onClick={() => {
                    onResolveConflict(conf);
                    onClose();
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 hover:text-blue-600 shrink-0 flex items-center gap-1.5 shadow-xs"
                >
                  <span>Resolve</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
