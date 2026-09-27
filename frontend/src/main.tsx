import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { ToastProvider } from '@/shared/ToastProvider';
import { ErrorBoundary } from '@/shared/ErrorBoundary';
import { normalizeLegacyHashRoutes } from '@/routes/legacyHashRoutes';
import { UserApp } from '@/user/UserApp';
import { I18nProvider } from '@/i18n/I18nProvider';

// Design system styles
import '@/design/tokens.css';
import '@/design/components.css';
import '@/design/layout.css';
import '@/user/account-center.css';

// Redirect legacy hash routes before rendering
normalizeLegacyHashRoutes();

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <I18nProvider><UserApp /></I18nProvider>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
