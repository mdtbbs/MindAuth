import { createRoot } from 'react-dom/client';

function AdminApp() {
  return (
    <div>
      <h1>MindAuth Admin App</h1>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<AdminApp />);
}
