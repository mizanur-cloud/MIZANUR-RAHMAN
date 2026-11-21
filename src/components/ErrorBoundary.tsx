import React from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let displayMsg = error.message || 'অ্যাপ্লিকেশনে অপ্রত্যাশিত একটি ত্রুটি ঘটেছে।';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && parsed.error && parsed.operationType) {
        displayMsg = `ডাটাবেস অনুমতি ত্রুটি (${parsed.operationType}): ${parsed.error}`;
      }
    } catch {
      // Not JSON-formatted FirestoreErrorInfo
    }
    return { hasError: true, message: displayMsg };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900 shadow-lg p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 mx-auto flex items-center justify-center">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                নিরাপত্তা বা সিস্টেম ত্রুটি
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 break-words">
                {this.state.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>পুনরায় লোড করুন</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
