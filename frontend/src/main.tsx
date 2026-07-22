import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { ToastProvider } from '@/shared/ToastProvider';
import { normalizeLegacyHashRoutes } from '@/routes/legacyHashRoutes';
import { UserApp } from '@/user/UserApp';

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
        <UserApp />
      </ToastProvider>
    </AuthProvider>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
