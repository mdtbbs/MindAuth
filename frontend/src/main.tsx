import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div>
      <h1>MindAuth User App</h1>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
