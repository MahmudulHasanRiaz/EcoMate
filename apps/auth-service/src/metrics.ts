// Minimal in-memory metrics for GET /metrics (Prometheus text format).
// Counters only — no histograms, no per-user labels. Route labels use the
// normalized Better Auth endpoint path (e.g. /sign-in/email), never raw
// URLs, so cardinality stays bounded.
const requestCounts = new Map<string, number>();
const authFailures = new Map<string, number>();
let unknownHostRejects = 0;
let listSessionsStripped = 0;

function key(route: string, status: string): string {
  return `${route}|${status}`;
}

export const metrics = {
  observeRequest(route: string, status: number): void {
    const k = key(route, String(status));
    requestCounts.set(k, (requestCounts.get(k) ?? 0) + 1);
    if (status === 401 || status === 403) {
      authFailures.set(route, (authFailures.get(route) ?? 0) + 1);
    }
  },
  observeUnknownHost(): void {
    unknownHostRejects += 1;
  },
  observeListSessionsStripped(count: number): void {
    listSessionsStripped += count;
  },
  snapshot(): {
    requests: Array<{ route: string; status: string; count: number }>;
    authFailures: Array<{ route: string; count: number }>;
    unknownHostRejects: number;
    listSessionsStripped: number;
  } {
    return {
      requests: [...requestCounts.entries()].map(([k, count]) => {
        const [route, status] = k.split('|');
        return { route, status, count };
      }),
      authFailures: [...authFailures.entries()].map(([route, count]) => ({
        route,
        count,
      })),
      unknownHostRejects,
      listSessionsStripped,
    };
  },
  renderPrometheus(): string {
    const snap = this.snapshot();
    const lines: string[] = [
      '# HELP auth_service_http_requests_total HTTP requests by route and status',
      '# TYPE auth_service_http_requests_total counter',
    ];
    for (const r of snap.requests) {
      lines.push(
        `auth_service_http_requests_total{route="${r.route}",status="${r.status}"} ${r.count}`,
      );
    }
    lines.push(
      '# HELP auth_service_auth_failures_total Auth failures (401/403) by route',
      '# TYPE auth_service_auth_failures_total counter',
    );
    for (const f of snap.authFailures) {
      lines.push(
        `auth_service_auth_failures_total{route="${f.route}"} ${f.count}`,
      );
    }
    lines.push(
      '# HELP auth_service_unknown_host_rejects_total Requests rejected for an unknown Host',
      '# TYPE auth_service_unknown_host_rejects_total counter',
      `auth_service_unknown_host_rejects_total ${snap.unknownHostRejects}`,
      '# HELP auth_service_list_sessions_tokens_stripped_total Session tokens stripped from list-sessions responses',
      '# TYPE auth_service_list_sessions_tokens_stripped_total counter',
      `auth_service_list_sessions_tokens_stripped_total ${snap.listSessionsStripped}`,
    );
    return lines.join('\n') + '\n';
  },
  /** Test-only reset. */
  __reset(): void {
    requestCounts.clear();
    authFailures.clear();
    unknownHostRejects = 0;
    listSessionsStripped = 0;
  },
};
