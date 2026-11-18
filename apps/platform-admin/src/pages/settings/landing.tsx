import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { errorMessage, readJson } from '../../lib/api';
import type { SettingsSectionProps } from './sections';

/**
 * Landing settings (Batch 1, items 2 + 5): the default locale a
 * first-time visitor sees and the search-engine indexing flag. The
 * indexing toggle is a kill-switch: off = the landing serves noindex
 * meta + robots disallow-all + an empty sitemap. When the
 * SEO_INDEXING_ENABLED env var is set it wins over this toggle, and the
 * section says so instead of letting the toggle look effective.
 */
export function LandingSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api } = useAuth();
  const [defaultLocale, setDefaultLocale] = useState<'en' | 'bn'>('en');
  const [seoIndexingEnabled, setSeoIndexingEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setDefaultLocale(settings.landing.defaultLocale);
    setSeoIndexingEnabled(settings.landing.seoIndexingEnabled);
  }, [settings]);

  if (!settings) return null;

  const envWins = settings.landing.seoIndexingSource === 'env';

  async function saveLanding() {
    setBusy(true);
    onError('');
    try {
      await api('/settings/landing', {
        method: 'PATCH',
        body: JSON.stringify({
          defaultLocale,
          seoIndexingEnabled,
        }),
      }).then((r) => readJson(r));
      onSaved('Landing settings saved.');
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Landing</h2>
          <p>
            The public landing page&apos;s default language and whether
            search engines may index it.
          </p>
        </div>
      </div>
      <div className="domain-config-grid">
        <label className="inline-field">
          <span>Default locale</span>
          <select
            value={defaultLocale}
            onChange={(event) =>
              setDefaultLocale(event.target.value as 'en' | 'bn')
            }
            aria-label="Default locale"
          >
            <option value="en">English</option>
            <option value="bn">Bangla</option>
          </select>
        </label>
      </div>
      <p className="muted-note">
        First-time visitors see the landing in this language. Visitors who
        already picked a language keep their choice.
      </p>
      <div className="domain-flags">
        <label>
          <input
            type="checkbox"
            checked={seoIndexingEnabled}
            onChange={(event) => setSeoIndexingEnabled(event.target.checked)}
            disabled={envWins}
          />
          Allow search engines to index the landing
        </label>
      </div>
      <p className="muted-note">
        {envWins ? (
          <>
            The SEO_INDEXING_ENABLED environment variable is set, so it
            controls indexing and this toggle is read-only. Unset the
            variable (or remove it from the stack env) to manage indexing
            from here.
          </>
        ) : (
          <>
            Off hides the landing from search engines (noindex meta,
            robots disallow-all, empty sitemap) — keep it off on staging.
          </>
        )}
      </p>
      <div className="progress-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => void saveLanding()}
        >
          {busy ? 'Saving…' : 'Save landing settings'}
        </button>
      </div>
    </section>
  );
}
