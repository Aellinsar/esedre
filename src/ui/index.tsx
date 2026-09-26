import React from 'react';
import { createRoot } from 'react-dom/client';
import { PlannedWorkView } from './PlannedWorkView';
import './index.css';

function App() {
  // Read initial project from URL query params (e.g. ?project=Core or ?project=all)
  const urlParams = new URLSearchParams(window.location.search);
  const initialProject = urlParams.get('project') || undefined;
  const isEmbedded = urlParams.get('embedded') === 'true';

  const handleClose = React.useCallback(() => {
    try {
      if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ESEDRE_CLOSE_MODAL' }, '*');
      }
    } catch (e) {
      console.error('Failed to post ESEDRE_CLOSE_MODAL message:', e);
    }
  }, []);

  // Fallback: If unprevented Escape keypress bubbles to window
  React.useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [handleClose]);

  return (
    <div className="w-screen h-screen overflow-hidden bg-[var(--bg-main)] text-[var(--text-primary)]">
      <PlannedWorkView
        initialProject={initialProject}
        showHeader={!isEmbedded}
        isEmbedded={isEmbedded}
        onClose={handleClose}
      />
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
