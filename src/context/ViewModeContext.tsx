import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type AppViewMode = 'desktop' | 'mobile';

interface ViewModeContextValue {
  viewMode: AppViewMode;
  isMobileView: boolean;
  isDesktopView: boolean;
  setViewMode: (mode: AppViewMode) => void;
  toggleViewMode: () => void;
}

const STORAGE_KEY = 'idsc_view_mode';

function resolveInitialViewMode(): AppViewMode {
  if (typeof window === 'undefined') return 'desktop';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'desktop' || saved === 'mobile') {
      return saved;
    }
  } catch {
    // Ignore storage errors
  }
  return window.innerWidth < 768 ? 'mobile' : 'desktop';
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export const ViewModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [viewMode, setViewModeState] = useState<AppViewMode>(resolveInitialViewMode);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.viewMode = viewMode;
    }
    try {
      localStorage.setItem(STORAGE_KEY, viewMode);
    } catch {
      // Ignore storage errors
    }
  }, [viewMode]);

  const setViewMode = useCallback((mode: AppViewMode) => {
    setViewModeState(mode);
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewModeState(prev => (prev === 'desktop' ? 'mobile' : 'desktop'));
  }, []);

  return (
    <ViewModeContext.Provider
      value={{
        viewMode,
        isMobileView: viewMode === 'mobile',
        isDesktopView: viewMode === 'desktop',
        setViewMode,
        toggleViewMode,
      }}
    >
      {children}
    </ViewModeContext.Provider>
  );
};

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) {
    throw new Error('useViewMode must be used inside ViewModeProvider');
  }
  return ctx;
}
