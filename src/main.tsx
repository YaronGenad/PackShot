import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { AuthProvider } from './lib/auth-context';
import App from './App.tsx';
import './index.css';
import { initSentryClient } from './lib/observability/sentry-client';

initSentryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
