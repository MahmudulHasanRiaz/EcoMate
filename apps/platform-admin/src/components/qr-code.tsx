import QRCode from 'react-qr-code';

/**
 * MFA setup QR (StackMate `.sm-qr` pattern: a WHITE card around the SVG
 * so authenticator apps can scan it on the dark theme).
 *
 * Library choice (Boss allows better-than-StackMate): react-qr-code
 * 2.2.0 — a purpose-built React SVG component, actively maintained
 * (2026-06-09), typed, zero-config — built on the same qrcode-generator
 * engine StackMate uses, so the QR output is equally battle-tested.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  return (
    <div className="qr-card" role="img" aria-label={label}>
      <QRCode value={value} size={180} />
    </div>
  );
}
