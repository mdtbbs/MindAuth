import { createRoot } from 'react-dom/client';
import { AdminApp } from '@/admin/AdminApp';

// Design system styles
import '@/design/tokens.css';
import '@/design/components.css';
import '@/design/layout.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<AdminApp />);
}
