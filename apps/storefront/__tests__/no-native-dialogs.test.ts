import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Grep gate for Boss's rule: NO browser-native dialogs — every problem,
 * toast and popup is shown in-app (in-app modals + sonner toasts). A
 * native call anywhere in the storefront source fails this test.
 * Comments and string literals are stripped first so a mention in a
 * comment does not trip the gate; only real call sites count.
 */
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = ['app', 'components', 'context', 'hooks', 'lib', 'types'];

const NATIVE_DIALOG_PATTERN =
  /(?:window\s*\.\s*(?:confirm|alert|prompt)|(?<![\w$.])confirm\s*\()/;

function stripCommentsAndStrings(source: string): string {
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
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('no native browser dialogs', () => {
  it('has no window.confirm / window.alert / window.prompt / bare confirm( call site', () => {
    const offenders: string[] = [];
    for (const dir of SOURCE_DIRS) {
      for (const file of sourceFiles(join(APP_ROOT, dir))) {
        const stripped = stripCommentsAndStrings(readFileSync(file, 'utf8'));
        if (NATIVE_DIALOG_PATTERN.test(stripped)) {
          offenders.push(file.replace(`${APP_ROOT}/`, ''));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
