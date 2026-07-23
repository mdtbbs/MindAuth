import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { ToastProvider } from '@/shared/ToastProvider';
import { normalizeLegacyHashRoutes } from '@/routes/legacyHashRoutes';
import { UserApp } from '@/user/UserApp';
import { Component, type ReactNode } from 'react';

// Design system styles
import '@/design/tokens.css';
import '@/design/components.css';
import '@/design/layout.css';

// Error boundary to catch React errors
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('React Error:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
          <h1 style={{ color: 'red' }}>应用加载错误</h1>
          <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '4px' }}>
            {this.state.error.toString()}
            {'\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Redirect legacy hash routes before rendering
normalizeLegacyHashRoutes();

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <UserApp />
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
