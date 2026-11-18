import { Navigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { AppShell } from '../components/app-shell';
import { ErrorNote, PageHeader, Skeleton } from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import type { PaymentMethod, PlatformSettings } from '../types';
import {
  DEFAULT_SETTINGS_SECTION,
  getSettingsSection,
} from './settings/sections';
import { SettingsNav, SettingsTabs } from './settings/settings-nav';

/**
 * Settings page shell (StackMate SettingsShell pattern). The sections
 * live in the registry (./settings/sections.ts) — one row + one component
 * file per section, no router edit needed. This shell owns the shared
 * data (/settings + /billing/methods), the notice/error banners, and the
 * reload that follows a save; each section owns its form state and its
 * save calls.
 *
 * The old single-page settings had 6 real sections (payment methods,
 * SMTP, trial defaults, tax, branding, maintenance) — all six are in the
 * registry. The old page's seventh block was a Domains LINK CARD, not a
 * setting; Domains is a top-level nav item, so the card was dropped.
 */
export function SettingsPage() {
  const { sectionId } = useParams({ from: '/settings/$sectionId' });
  const { api } = useAuth();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextSettings, nextMethods] = await Promise.all([
        api('/settings').then((r) => readJson<PlatformSettings>(r)),
        api('/billing/methods').then((r) => readJson<PaymentMethod[]>(r)),
      ]);
      setSettings(nextSettings);
      setMethods(nextMethods);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  const section = getSettingsSection(sectionId);
  if (!section) {
    return (
      <Navigate
        to="/settings/$sectionId"
        params={{ sectionId: DEFAULT_SETTINGS_SECTION.id }}
      />
    );
  }

  const Section = section.component;

  return (
    <AppShell secondaryNav={<SettingsNav activeId={section.id} />}>
      <PageHeader
        eyebrow="Settings"
        title="Platform settings"
        description="Payment methods, mail, trial defaults, tax, branding and maintenance."
      />

      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}
      {settings?.maintenance.enabled ? (
        <div className="notice notice--error" role="alert">
          Maintenance mode is ON — writes are blocked except settings and
          auth.
          {settings.maintenance.message
            ? ` ${settings.maintenance.message}`
            : ''}
        </div>
      ) : null}
      {!settings && busy ? <Skeleton /> : null}

      <SettingsTabs activeId={section.id} />

      <div className="settings-content">
        <Section
          settings={settings}
          methods={methods}
          onSaved={(message) => {
            setNotice(message);
            setRefresh((value) => value + 1);
          }}
          onError={(message) => setError(message || null)}
        />
      </div>
    </AppShell>
  );
}
