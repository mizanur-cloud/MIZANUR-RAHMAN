import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useViewMode } from '../context/ViewModeContext';

export const OfflineIndicator: React.FC = () => {
  const { isMobileView } = useViewMode();
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      className={`no-print fixed left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xl ${
        isMobileView ? 'bottom-20 right-4 md:right-auto' : 'bottom-4'
      }`}
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>অফলাইন মোড — ক্যাশ করা লোকাল ডাটা ব্যবহার করা হচ্ছে</span>
    </div>
  );
};
