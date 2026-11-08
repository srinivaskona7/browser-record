import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { syncBuildCacheVersion } from './app/actions';
import './styles.css';

void syncBuildCacheVersion();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// Hash routing keeps direct navigation and refresh working on GitHub Pages,
// where a server rewrite for deep paths is not available.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
