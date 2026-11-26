// Structured JSON logging. One JSON object per line on stdout; no secrets,
// tokens, passwords, or authorization headers are ever logged. Callers pass
// only the fields the event needs.
export type LogLevel = 'info' | 'warn' | 'error' | 'audit';

export interface LogFields {
  [key: string]: unknown;
}

function write(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: 'auth-service',
    msg,
    ...fields,
  });
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  info(msg: string, fields: LogFields = {}): void {
    write('info', msg, fields);
  },
  warn(msg: string, fields: LogFields = {}): void {
    write('warn', msg, fields);
  },
  error(msg: string, fields: LogFields = {}): void {
    write('error', msg, fields);
  },
  /**
   * Security audit event. Auth security events are logged from day one:
   * sign-in success/failure, sign-up, password-reset request, org create,
   * TOTP enable/verify, session revoke. `email` is the account identifier
   * (needed for incident response); never a password, token, or code.
   */
  audit(event: string, fields: LogFields = {}): void {
    write('audit', event, { event, ...fields });
  },
};
