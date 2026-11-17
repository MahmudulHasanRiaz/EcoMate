import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Grep gate for Boss's console rule: NO browser-native dialogs — every
 * problem, toast and popup is shown in-app. A native call anywhere in the
 * console source fails this test. Comments and string literals are
 * stripped first so a mention in a comment (or a test fixture) does not
 * trip the gate; only real call sites count.
 */
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

const NATIVE_DIALOG_PATTERN =
  /(?:window\s*\.\s*(?:confirm|alert|prompt)|(?<![\w$.])confirm\s*\()/;

function stripCommentsAndStrings(source: string): string {
  // Strings first (a "//" inside a string is not a comment), then comments.
  return source
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('no native browser dialogs', () => {
  it('has no window.confirm / window.alert / window.prompt / bare confirm( call site', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const stripped = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      if (NATIVE_DIALOG_PATTERN.test(stripped)) {
        offenders.push(file.replace(`${SRC_DIR}/`, ''));
      }
    }
    expect(offenders).toEqual([]);
  });
});
