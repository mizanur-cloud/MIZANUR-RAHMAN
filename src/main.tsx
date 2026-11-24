import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { AuthProvider } from './context/AuthContext';
import { ViewModeProvider } from './context/ViewModeContext';
import { ErrorBoundary } from './components/ErrorBoundary';

// Register PWA service worker for offline support and auto-updates
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthProvider>
      <ViewModeProvider>
        <App />
      </ViewModeProvider>
    </AuthProvider>
  </ErrorBoundary>
);

