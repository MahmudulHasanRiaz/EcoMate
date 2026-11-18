import { useEffect, useState } from 'react';
import { useBranding } from '../../lib/branding';
import { errorMessage, readJson } from '../../lib/api';
import { resolveAbsoluteMediaUrl, type MediaAsset } from '../../lib/media';
import { MediaPicker } from '../../components/media-picker';
import { useAuth } from '../../auth';
import type { SettingsSectionProps } from './sections';

const MAX_LOGO_BYTES = 200 * 1024;
const MAX_FAVICON_BYTES = 100 * 1024;
/** The image types a logo/favicon may be (matches the file inputs below). */
const BRANDING_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

/**
 * Reads an uploaded image as a data URL (F11). The data URL is stored in
 * the branding setting — no new storage infra needed. The server caps the
 * stored value at 300_000 characters; these client caps keep uploads
 * comfortably inside it.
 */
function readImageFile(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Choose an image file (PNG, JPG, GIF, WebP or SVG).'));
      return;
    }
    if (file.size > maxBytes) {
      reject(
        new Error(
          `That file is ${Math.round(file.size / 1024)} KB — keep it under ${Math.round(maxBytes / 1024)} KB.`,
        ),
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export function BrandingSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api } = useAuth();
  const { refresh: refreshBranding } = useBranding();
  const [platformName, setPlatformName] = useState('EcoMate');
  const [supportEmail, setSupportEmail] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [pickerFor, setPickerFor] = useState<'logo' | 'favicon' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setPlatformName(settings.branding.platformName);
    setSupportEmail(settings.branding.supportEmail);
    setLogoUrl(settings.branding.logoUrl);
    setFaviconUrl(settings.branding.faviconUrl ?? '');
  }, [settings]);

  if (!settings) return null;

  async function saveBranding() {
    setBusy(true);
    onError('');
    try {
      await api('/settings/branding', {
        method: 'PATCH',
        body: JSON.stringify({
          platformName: platformName.trim(),
          supportEmail: supportEmail.trim(),
          logoUrl: logoUrl.trim(),
          faviconUrl: faviconUrl.trim(),
        }),
      }).then((r) => readJson(r));
      await refreshBranding();
      onSaved('Branding saved and applied to this console.');
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    onError('');
    try {
      setLogoUrl(await readImageFile(file, MAX_LOGO_BYTES));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  async function uploadFavicon(file: File | undefined) {
    if (!file) return;
    onError('');
    try {
      setFaviconUrl(await readImageFile(file, MAX_FAVICON_BYTES));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  /**
   * A library pick stores the asset's ABSOLUTE content URL (branding
   * values are consumed by the landing from another origin, so a
   * relative path would not survive). Library picks are NOT subject
   * to the data-URL size caps — the stored value is a short URL, and
   * the file itself lives on the media volume.
   */
  function pickFromLibrary(asset: MediaAsset) {
    const url = resolveAbsoluteMediaUrl(asset.contentUrl);
    if (pickerFor === 'logo') setLogoUrl(url);
    else if (pickerFor === 'favicon') setFaviconUrl(url);
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Branding</h2>
          <p>
            The platform name, logo and favicon appear in this console —
            sidebar, tab title, login page — and in outgoing platform
            emails. Changes apply as soon as you save.
          </p>
        </div>
      </div>
      <div className="domain-config-grid">
        <label className="inline-field">
          <span>Platform name</span>
          <input
            value={platformName}
            onChange={(event) => setPlatformName(event.target.value)}
            aria-label="Platform name"
          />
        </label>
        <label className="inline-field">
          <span>Support email</span>
          <input
            type="email"
            value={supportEmail}
            onChange={(event) => setSupportEmail(event.target.value)}
            placeholder="support@ecomate.bd"
            aria-label="Support email"
          />
        </label>
        <label className="inline-field">
          <span>Logo URL</span>
          <input
            value={logoUrl.startsWith('data:') ? '' : logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            placeholder={
              logoUrl.startsWith('data:')
                ? 'Uploaded image — see the preview below'
                : 'https://… (optional)'
            }
            aria-label="Logo URL"
            disabled={logoUrl.startsWith('data:')}
          />
          {logoUrl.startsWith('data:') ? (
            <span className="muted-note">
              Clear it below to use a URL again.
            </span>
          ) : null}
        </label>
        <label className="inline-field">
          <span>Favicon URL</span>
          <input
            value={faviconUrl.startsWith('data:') ? '' : faviconUrl}
            onChange={(event) => setFaviconUrl(event.target.value)}
            placeholder={
              faviconUrl.startsWith('data:')
                ? 'Uploaded image — see the preview below'
                : 'https://… (optional, falls back to the logo)'
            }
            aria-label="Favicon URL"
            disabled={faviconUrl.startsWith('data:')}
          />
          {faviconUrl.startsWith('data:') ? (
            <span className="muted-note">
              Clear it below to use a URL again.
            </span>
          ) : null}
        </label>
      </div>
      <div className="domain-config-grid domain-config-grid--gap-top">
        <div>
          <p className="muted-note">Logo file (max 200 KB)</p>
          <div className="upload-box">
            {logoUrl ? (
              <img
                className="logo-preview"
                src={logoUrl}
                alt="Logo preview"
              />
            ) : null}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              aria-label="Upload a logo file"
              onChange={(event) => {
                void uploadLogo(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="button button--sm"
              onClick={() => setPickerFor('logo')}
            >
              Choose from library
            </button>
            {logoUrl ? (
              <button
                type="button"
                className="button button--sm"
                onClick={() => setLogoUrl('')}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        <div>
          <p className="muted-note">Favicon file (max 100 KB)</p>
          <div className="upload-box">
            {faviconUrl ? (
              <img
                className="logo-preview logo-preview--favicon"
                src={faviconUrl}
                alt="Favicon preview"
              />
            ) : null}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              aria-label="Upload a favicon file"
              onChange={(event) => {
                void uploadFavicon(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="button button--sm"
              onClick={() => setPickerFor('favicon')}
            >
              Choose from library
            </button>
            {faviconUrl ? (
              <button
                type="button"
                className="button button--sm"
                onClick={() => setFaviconUrl('')}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <p className="muted-note">
        Files picked from the media library are served from the platform
        API, so the size caps above do not apply to them.
      </p>
      <div className="progress-actions">
        <button
          type="button"
          className="button button--accent"
          onClick={() => void saveBranding()}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save branding'}
        </button>
      </div>
      <MediaPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onSelect={pickFromLibrary}
        mimes={BRANDING_IMAGE_MIMES}
        title={
          pickerFor === 'favicon' ? 'Choose a favicon' : 'Choose a logo'
        }
      />
    </section>
  );
}
