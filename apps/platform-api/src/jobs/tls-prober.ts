import https from 'node:https';
import tls from 'node:tls';

export interface TlsProbeResult {
  /** The TLS handshake completed and the chain validated. */
  tlsOk: boolean;
  /** Days until the leaf certificate expires (null when no cert was seen). */
  expiryDays: number | null;
  /** Certificate not-after, ISO string (null when no cert was seen). */
  expiresAt: string | null;
  /** The leaf certificate's subject CN, when available. */
  subjectCn: string | null;
  /** Chain validation error (e.g. self-signed), if any. */
  tlsError: string | null;
  /** An HTTPS GET / answered with any HTTP status < 500. */
  reachable: boolean;
  /** HTTP status of the reachability probe (null when no response). */
  httpStatus: number | null;
  /** Reachability failure detail, if any. */
  httpError: string | null;
  /** Overall probe outcome: TLS ok AND reachable. */
  ok: boolean;
}

export interface TlsProber {
  probe(host: string): Promise<TlsProbeResult>;
}

function expiryDaysFrom(validTo: string, now = Date.now()): number {
  const expires = new Date(validTo).getTime();
  return Math.floor((expires - now) / 86_400_000);
}

/** Probe port (443 in production; override for local TLS test servers). */
export function tlsProbePort(): number {
  const raw = Number(process.env.TLS_PROBE_PORT);
  return Number.isFinite(raw) && raw > 0 && raw < 65536 ? raw : 443;
}

function tlsProbeTimeoutMs(): number {
  const raw = Number(process.env.TLS_PROBE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 10_000;
}

/**
 * Real prober: a TLS handshake (SNI = host) to read the leaf certificate
 * and chain validity, then an HTTPS GET / for reachability. Both legs use
 * a short timeout so one dead domain cannot stall the whole sweep.
 *
 * rejectUnauthorized: false on BOTH legs is deliberate: this prober
 * OBSERVES certificates, it does not trust them. With strict verification
 * the handshake fails before the peer certificate is exposed, so an
 * expired cert is indistinguishable from a dead host (both surface as
 * "no cert seen" → UNREACHABLE). With verification off, the handshake
 * completes, getPeerCertificate() returns the leaf, and `authorized` /
 * `authorizationError` still record whether the chain validated — so the
 * classifier can tell EXPIRED (cert seen, past not-after) from
 * UNREACHABLE (no cert, or chain invalid for another reason). No secrets
 * are ever sent over these connections.
 */
export class NodeTlsProber implements TlsProber {
  async probe(host: string): Promise<TlsProbeResult> {
    const port = tlsProbePort();
    const timeoutMs = tlsProbeTimeoutMs();
    const result: TlsProbeResult = {
      tlsOk: false,
      expiryDays: null,
      expiresAt: null,
      subjectCn: null,
      tlsError: null,
      reachable: false,
      httpStatus: null,
      httpError: null,
      ok: false,
    };

    const cert = await new Promise<{
      validTo: string;
      subjectCn: string | null;
      authorized: boolean;
      authorizationError: string | null;
    } | null>((resolve) => {
      let settled = false;
      const done = (
        value: {
          validTo: string;
          subjectCn: string | null;
          authorized: boolean;
          authorizationError: string | null;
        } | null,
      ) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      let socket: tls.TLSSocket;
      try {
        socket = tls.connect(
          {
            host,
            port,
            servername: host,
            timeout: timeoutMs,
            rejectUnauthorized: false,
          },
          () => {
            const peer = socket.getPeerCertificate();
            const validTo =
              typeof peer?.valid_to === 'string' ? peer.valid_to : '';
            done({
              validTo,
              subjectCn:
                typeof (peer?.subject as { CN?: unknown } | undefined)?.CN ===
                'string'
                  ? ((peer.subject as { CN: string }).CN ?? null)
                  : null,
              authorized: socket.authorized,
              authorizationError: socket.authorizationError
                ? String(socket.authorizationError)
                : null,
            });
            socket.destroy();
          },
        );
      } catch (error) {
        result.tlsError =
          error instanceof Error ? error.message : String(error);
        done(null);
        return;
      }
      socket.once('timeout', () => {
        result.tlsError = `TLS handshake timed out after ${timeoutMs}ms`;
        socket.destroy();
        done(null);
      });
      socket.once('error', (error) => {
        result.tlsError = error.message;
        done(null);
      });
    });

    if (cert) {
      if (cert.validTo) {
        result.expiresAt = new Date(cert.validTo).toISOString();
        result.expiryDays = expiryDaysFrom(cert.validTo);
      }
      result.subjectCn = cert.subjectCn;
      result.tlsOk = cert.authorized;
      if (!cert.authorized && cert.authorizationError) {
        result.tlsError = cert.authorizationError;
      }
    }

    // Reachability: any HTTP answer < 500 counts (a 404 from the edge
    // still proves the domain resolves, TLS terminates, and the edge
    // answers; a 5xx or a hang does not).
    const http = await new Promise<{
      status: number | null;
      error: string | null;
    }>((resolve) => {
      let settled = false;
      const done = (value: { status: number | null; error: string | null }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      let request: ReturnType<typeof https.get>;
      try {
        request = https.get(
          {
            host,
            port,
            path: '/',
            servername: host,
            timeout: timeoutMs,
            // Reachability is measured independently of chain validity
            // (see the class comment): a host with a broken chain that
            // still answers HTTP is reachable=true, tlsOk=false.
            rejectUnauthorized: false,
            headers: { 'user-agent': 'EcoMate-TLS-Health/1.0' },
          },
          (response) => {
            response.resume();
            done({ status: response.statusCode ?? null, error: null });
          },
        );
      } catch (error) {
        done({
          status: null,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      request.once('timeout', () => {
        request.destroy(new Error(`HTTPS probe timed out after ${timeoutMs}ms`));
      });
      request.once('error', (error) => {
        done({ status: null, error: error.message });
      });
    });
    result.httpStatus = http.status;
    result.httpError = http.error;
    result.reachable =
      http.status !== null && http.status >= 200 && http.status < 500;
    result.ok = result.tlsOk && result.reachable;
    return result;
  }
}
