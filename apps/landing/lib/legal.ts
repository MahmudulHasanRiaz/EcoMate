/**
 * Managed legal content (CMS Batch 2, item 22): the plain-text body
 * format for `legal.privacy` / `legal.terms` blocks.
 *
 * Body format (deliberately tiny — no HTML, no markdown library):
 * - Paragraphs are separated by blank lines.
 * - Lines starting with "- " group into one <ul> (consecutive lines).
 * - **bold** spans render as <strong> (lead-ins like "**Account data:**").
 *
 * Everything renders as React text nodes — a managed block can never
 * inject markup. Pure functions, covered by lib/__tests__/legal.test.ts.
 */

export type LegalBodyBlock =
  | { type: 'paragraph'; segments: LegalTextSegment[] }
  | { type: 'list'; items: LegalTextSegment[][] };

export type LegalTextSegment =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string };

/** Split inline **bold** spans out of one line of text. */
export function parseLegalInline(line: string): LegalTextSegment[] {
  const segments: LegalTextSegment[] = [];
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) segments.push({ type: 'bold', text: bold[1] });
    else segments.push({ type: 'text', text: part });
  }
  return segments;
}

/**
 * Parse a managed legal body into render blocks. Empty bodies yield no
 * blocks (the caller falls back to the hardcoded copy). A "- " line
 * with no text after the marker is treated as a paragraph, not a list
 * item — an empty bullet renders nothing useful.
 */
export function parseLegalBody(body: string): LegalBodyBlock[] {
  const blocks: LegalBodyBlock[] = [];
  const chunks = body.split(/\n\s*\n/);
  for (const chunk of chunks) {
    const lines = chunk
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    const listLines = lines.filter((line) => line.startsWith('- '));
    if (listLines.length > 0 && listLines.length === lines.length) {
      blocks.push({
        type: 'list',
        items: listLines.map((line) => parseLegalInline(line.slice(2).trim())),
      });
    } else {
      // A mixed chunk (or a plain paragraph): join the lines with
      // spaces — JSX-style line wrapping must not split sentences.
      blocks.push({
        type: 'paragraph',
        segments: parseLegalInline(lines.join(' ')),
      });
    }
  }
  return blocks;
}

/**
 * "Last updated" line for a managed legal document: '17 November 2026'
 * (en-GB long form, UTC so the date never shifts with the reader's
 * timezone). Returns null for an unparseable timestamp — the caller
 * keeps the fallback date instead of printing garbage.
 */
export function formatLegalUpdatedAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
