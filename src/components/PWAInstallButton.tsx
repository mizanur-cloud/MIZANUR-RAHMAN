import React, { useState } from 'react';
import { Download, Smartphone, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  onOpenHelp?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ onOpenHelp }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running in standalone PWA mode, show subtle badge or hide
  if (isInstalled) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg border border-emerald-200/60 dark:border-emerald-800/60">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        <span>Installed App</span>
      </span>
    );
  }

  // If native browser prompt is available (Chromium / Android / Desktop)
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        title="অ্যান্ড্রয়েড ফোন বা কম্পিউটারে অ্যাপ ইনস্টল করুন (Install App)"
        className="w-full px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
      >
        <Download className="w-3.5 h-3.5" />
        <span>ইন্সটল অ্যাপ (Install App)</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          title="আইফোনে ইনস্টল করার নিয়ম"
          className="px-2.5 py-1.5 text-xs font-semibold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/40 hover:bg-[#dcebe4] border border-[#bfd5cc] dark:border-emerald-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>iOS অ্যাপ</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-[#145343] dark:text-emerald-400" />
                <span>আইফোনে অ্যাপ যুক্ত করার নিয়ম</span>
              </h3>
              <p className="mt-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                ১. Safari ব্রাউজারের নিচের টুলবার থেকে <strong>Share (⎋)</strong> বাটনে ট্যাপ করুন।<br />
                ২. নিচের দিকে স্ক্রল করে <strong>"Add to Home Screen"</strong> চাপুন।<br />
                ৩. উপরে <strong>Add</strong> চাপলেই আপনার হোম স্ক্রিনে আইকন চলে আসবে।
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-xl bg-slate-100 dark:bg-slate-800 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-200"
              >
                ঠিক আছে (Close)
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Fallback button to open the Help & APK guide modal
  return (
    <button
      onClick={onOpenHelp}
      title="মোবাইল অ্যাপ (APK) ও ব্যবহারের নিয়মাবলী"
      className="px-2.5 py-1.5 text-xs font-bold text-[#145343] dark:text-emerald-300 bg-[#eef5f2] dark:bg-emerald-950/50 hover:bg-[#dcebe4] border border-[#bfd5cc] dark:border-emerald-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-2xs"
    >
      <Smartphone className="w-3.5 h-3.5 text-[#145343] dark:text-emerald-400" />
      <span>মোবাইল অ্যাপ (APK)</span>
    </button>
  );
};
