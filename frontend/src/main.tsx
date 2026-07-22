import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { ToastProvider } from '@/shared/ToastProvider';
import { normalizeLegacyHashRoutes } from '@/routes/legacyHashRoutes';

// Design system styles
import '@/design/tokens.css';
import '@/design/components.css';
import '@/design/layout.css';

// Redirect legacy hash routes before rendering
normalizeLegacyHashRoutes();

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <div className="page">
          <main className="page__main">
            <div className="container">
              <h1>MindAuth</h1>
              <p style={{ color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)' }}>
                User application — pages coming in Task 11.
              </p>
            </div>
          </main>
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
