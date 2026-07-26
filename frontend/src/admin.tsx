import { createRoot } from 'react-dom/client';
import { AdminApp } from '@/admin/AdminApp';
import { ErrorBoundary } from '@/shared/ErrorBoundary';

// Design system styles
import '@/design/tokens.css';
import '@/design/components.css';
import '@/design/layout.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <ErrorBoundary>
      <AdminApp />
    </ErrorBoundary>,
  );
}
