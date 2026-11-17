import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { AuthProvider } from './auth';
import { ToastProvider } from './components/ui';
import { BrandingProvider } from './lib/branding';
import { applyTheme, resolveThemeChoice } from './lib/theme';
import { router } from './router';
import '@fontsource-variable/inter';
import './styles.css';

// The theme is also applied by an inline script in index.html BEFORE
// React mounts (no flash of the wrong theme); re-apply here so the
// system-preference listener is attached for the "system" choice.
applyTheme(resolveThemeChoice());

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing');

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <BrandingProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </BrandingProvider>
    </AuthProvider>
  </StrictMode>,
);
