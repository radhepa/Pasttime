import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { CrashScreen } from './components/CrashScreen';
import { applyTheme } from './lib/settings';
import './lib/sync';
import './index.css';

// Updates: iPhone home-screen apps are often resumed rather than reloaded, which skips the browser's own
// update check. So also look for a new version whenever the app comes back into view, and every 30 minutes.
// A new version installs and reloads the page by itself (autoUpdate).
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => navigator.onLine && registration.update().catch(() => undefined);
    setInterval(check, 30 * 60_000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  },
});
applyTheme();

// Your library lives on this device, so ask the browser not to clear it when space runs low.
navigator.storage?.persist?.().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashScreen>
      <HashRouter>
        <App />
      </HashRouter>
    </CrashScreen>
  </StrictMode>,
);
