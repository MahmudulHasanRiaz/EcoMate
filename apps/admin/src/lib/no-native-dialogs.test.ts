/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'

/**
 * Grep gate for Boss's rule: NO browser-native dialogs — every problem,
 * toast and popup is shown in-app (shared ConfirmDialog / Dialog + sonner).
 * A native call anywhere in the tenant-admin source fails this test.
 * Comments and string literals are stripped first so a mention in a
 * comment does not trip the gate; only real call sites count.
 *
 * The whole suite runs in a real browser (vitest browser mode), so
 * node:fs is unavailable — `import.meta.glob` with `?raw` is the
 * browser-compatible equivalent (same pattern as the `?raw` guards in
 * the orders tests).
 */
const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const NATIVE_DIALOG_PATTERN =
  /(?:window\s*\.\s*(?:confirm|alert|prompt)|(?<![\w$.])confirm\s*\()/

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('no native browser dialogs', () => {
  it('has no window.confirm / window.alert / window.prompt / bare confirm( call site', () => {
    const offenders: string[] = []
    for (const [path, source] of Object.entries(SOURCES)) {
      if (/\.test\.(ts|tsx)$/.test(path)) continue
      if (path.endsWith('routeTree.gen.ts')) continue
      if (NATIVE_DIALOG_PATTERN.test(stripCommentsAndStrings(source))) {
        offenders.push(path)
      }
    }
    expect(offenders).toEqual([])
  })
})
