import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { errorMessage, readJson } from '../../lib/api';
import {
  fetchStorageSettings,
  type MediaStorageSettings,
} from '../../lib/media';
import type { SettingsSectionProps } from './sections';

/**
 * Media storage settings — which backend the media library stores NEW
 * uploads on. Local volume now; R2 is config-ready (the driver exists
 * as a fail-closed stub) and the live-migration path is documented in
 * docs/saas/media-storage.md.
 *
 * Two rules the UI must keep honest:
 * - When MEDIA_STORAGE_DRIVER / MEDIA_LOCAL_PATH is set in the server
 *   environment, env wins and the switch is locked (same rule as the
 *   SEO indexing flag). The section says so instead of letting the
 *   switch look effective.
 * - Switching the driver affects NEW uploads only. Every asset row
 *   records its own driver, so existing files keep serving from where
 *   they live — nothing is moved by flipping this switch.
 *
 * Storage writes are SUPERADMIN-only on the API; the Save button hides
 * for other roles.
 */
export function MediaSection({ onSaved, onError }: SettingsSectionProps) {
  const { api, session } = useAuth();
  const [storage, setStorage] = useState<MediaStorageSettings | null>(null);
  const [driver, setDriver] = useState<'local' | 'r2'>('local');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isSuperadmin = session?.user.role === 'SUPERADMIN';

  useEffect(() => {
    setLoading(true);
    fetchStorageSettings(api)
      .then((next) => {
        setStorage(next);
        setDriver(next.driver);
      })
      .catch((err) => onError(errorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (loading || !storage) return null;

  const envLocked = storage.driverSource === 'env';
  const pathEnvLocked = storage.localPathSource === 'env';

  async function saveStorage() {
    setBusy(true);
    onError('');
    try {
      const next = await api('/media/storage', {
        method: 'PUT',
        body: JSON.stringify({ driver }),
      }).then((r) => readJson<MediaStorageSettings>(r));
      setStorage(next);
      onSaved(
        next.driver === 'local'
          ? 'Media storage set to the local volume. New uploads will be stored there.'
          : 'Media storage set to R2. New uploads will be stored there.',
      );
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
          <h2>Media storage</h2>
          <p>
            Where the media library stores newly uploaded files. Existing
            files keep serving from where they live — switching here never
            moves them.
          </p>
        </div>
      </div>

      <div className="domain-config-grid">
        <label className="inline-field">
          <span>Storage driver</span>
          <select
            value={driver}
            onChange={(event) =>
              setDriver(event.target.value as 'local' | 'r2')
            }
            disabled={envLocked || !isSuperadmin}
            aria-label="Storage driver"
          >
            <option value="local">Local server volume</option>
            <option value="r2" disabled>
              Cloudflare R2 (coming soon)
            </option>
          </select>
        </label>
        <label className="inline-field">
          <span>Local volume path</span>
          <input
            value={storage.localPath}
            readOnly
            aria-label="Local volume path"
          />
        </label>
      </div>

      <p className="muted-note">
        Max upload size: {(storage.maxBytes / (1024 * 1024)).toFixed(0)} MB
        per file
        {storage.publicBaseUrl
          ? ` · Files are served from ${storage.publicBaseUrl}`
          : ' · Files are served from the platform API'}
        .
      </p>
      {envLocked ? (
        <p className="muted-note">
          The driver is set by the server environment
          (MEDIA_STORAGE_DRIVER), so it cannot be changed here.
        </p>
      ) : null}
      {pathEnvLocked ? (
        <p className="muted-note">
          The local path is set by the server environment
          (MEDIA_LOCAL_PATH).
        </p>
      ) : null}
      {!isSuperadmin ? (
        <p className="muted-note">
          Only a superadmin can change media storage settings.
        </p>
      ) : null}

      {isSuperadmin ? (
        <div className="dialog-actions">
          <button
            type="button"
            className="button button--accent"
            disabled={busy || envLocked || driver === storage.driver}
            onClick={() => void saveStorage()}
          >
            {busy ? 'Saving…' : 'Save media storage'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
