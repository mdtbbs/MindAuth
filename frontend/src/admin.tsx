import { createRoot } from 'react-dom/client';
import { ToastProvider } from '@/shared/ToastProvider';

// Design system styles
import '@/design/tokens.css';
import '@/design/components.css';
import '@/design/layout.css';

function AdminApp() {
  return (
    <ToastProvider>
      <div className="layout--sidebar">
        <aside className="sidebar">
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
            Admin Panel
          </h2>
        </aside>
        <main className="content">
          <h1>MindAuth Admin</h1>
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)' }}>
            Admin application — pages coming in Task 12.
          </p>
        </main>
      </div>
    </ToastProvider>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<AdminApp />);
}
