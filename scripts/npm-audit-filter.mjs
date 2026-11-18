#!/usr/bin/env node
// CI gate: `npm audit --audit-level=high`, with ONE reviewed exception.
//
// GHSA-fc5q-39xc-vjpf (picomatch ReDoS, CVE-2026-112366) is filtered out:
// no fixed release exists (latest picomatch 4.0.7 is affected; the fix is
// only in unreleased PR micromatch/picomatch#194), and picomatch is reachable
// only via dev/build tooling (vite, vitest, jest, micromatch, anymatch,
// knip, ts-loader, rollup pluginutils, unplugin, tinyglobby, @angular-devkit).
// Re-check when a fixed picomatch release lands — then delete this exception.
//
// Any OTHER high+ finding still fails the job. If the audit itself errors
// or its output is unparseable, this script fails loudly — never silently
// green.
//
// Attribution is transitive: the picomatch entries carry the advisory object
// (with its GHSA URL); dependents carry string names of vulnerable deps they
// depend on, so a dependent is picomatch-caused only if EVERY via element is
// either the ignored advisory or an already-attributed package. An entry
// with no provenance, or with any other advisory in its chain, stays failing.

import { execSync } from 'node:child_process';

const IGNORED_GHSA = 'GHSA-fc5q-39xc-vjpf';

function runAudit() {
  try {
    return execSync('npm audit --audit-level=high --json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // npm audit exits 1 when findings exist — stdout still holds the JSON.
    if (err && typeof err.stdout === 'string' && err.stdout.trim()) return err.stdout;
    throw new Error(`npm audit failed to run: ${err?.message ?? err}`);
  }
}

function main() {
  let raw;
  try {
    raw = runAudit();
  } catch (err) {
    console.error(`FATAL: ${err.message} — refusing to pass.`);
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('FATAL: npm audit output is not valid JSON — refusing to pass.');
    console.error(String(raw).slice(0, 2000));
    process.exit(1);
  }
  const vulns = data.vulnerabilities ?? {};
  const names = Object.keys(vulns);
  if (names.length === 0) {
    console.log('npm audit: no high+ findings. PASS.');
    return;
  }

  const caused = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of names) {
      if (caused.has(name)) continue;
      const via = vulns[name].via ?? [];
      if (via.length === 0) continue; // no provenance — cannot attribute; stays failing
      const ok = via.every((v) => {
        if (typeof v === 'string') return caused.has(v);
        if (v && typeof v === 'object') {
          return typeof v.url === 'string' && v.url.includes(IGNORED_GHSA);
        }
        return false;
      });
      if (ok) {
        caused.add(name);
        changed = true;
      }
    }
  }

  const remaining = names.filter((n) => !caused.has(n));
  if (remaining.length === 0) {
    console.log(
      `npm audit: ${names.length} high+ finding(s), all caused by ignored ${IGNORED_GHSA} (picomatch, no fixed release). PASS.`,
    );
    return;
  }
  console.error(
    `npm audit: ${remaining.length} high+ finding(s) NOT caused by ignored ${IGNORED_GHSA}:`,
  );
  for (const n of remaining) {
    const v = vulns[n];
    const vias = (v.via ?? [])
      .map((x) => (typeof x === 'string' ? x : (x.title ?? x.url ?? JSON.stringify(x))))
      .join(' <- ');
    console.error(`- ${n} [${v.severity}] via ${vias}`);
  }
  process.exit(1);
}

main();
