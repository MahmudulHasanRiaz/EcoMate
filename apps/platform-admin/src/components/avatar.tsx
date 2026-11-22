import { useEffect, useState } from 'react';
import { gravatarUrl } from '../lib/gravatar';

/* ------------------------------------------------------------------ */
/* Avatar — square tile (Neon: 28px md / 40px lg, accent-soft bg,     */
/* accent text). Fallback chain (StackMate M-23, ported): custom       */
/* uploaded photo first, Gravatar second (d=404 → the <img> errors     */
/* and the next fallback shows), initials otherwise. Two initials:     */
/* first + last word.                                                  */
/*                                                                     */
/* Own module (not account-menu): the Profile dialog and the users     */
/* list render it too, and account-menu already imports the dialogs —  */
/* keeping Avatar here avoids a circular import.                       */
/* ------------------------------------------------------------------ */

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + second).toUpperCase();
}

export function Avatar({
  name,
  email,
  avatarUrl,
  size = 'md',
}: {
  name: string;
  email?: string | null;
  /** Custom avatar URL (GET /api/public/avatar/:id?k=<key> — see
   *  userAvatarUrl in lib/media). null/undefined means "no custom photo". */
  avatarUrl?: string | null;
  size?: 'md' | 'lg';
}) {
  const [customFailed, setCustomFailed] = useState(false);
  const [gravatarFailed, setGravatarFailed] = useState(false);
  // A new photo/email retries the photo (e.g. switching accounts or
  // after uploading a new avatar).
  useEffect(() => {
    setCustomFailed(false);
    setGravatarFailed(false);
  }, [avatarUrl, email]);
  const customUrl = avatarUrl && !customFailed ? avatarUrl : null;
  const gravatar =
    !customUrl && !gravatarFailed
      ? gravatarUrl(email, size === 'lg' ? 80 : 56)
      : null;
  const url = customUrl ?? gravatar;
  return (
    <span
      className={`account-avatar${size === 'lg' ? ' account-avatar--lg' : ''}`}
      aria-hidden="true"
    >
      {url ? (
        <img
          src={url}
          alt=""
          onError={() => {
            if (customUrl) setCustomFailed(true);
            else setGravatarFailed(true);
          }}
        />
      ) : (
        getInitials(name)
      )}
    </span>
  );
}
