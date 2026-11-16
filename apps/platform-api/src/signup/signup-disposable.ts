const BUILTIN_DISPOSABLE_DOMAINS = [
  '10minutemail.com',
  '20minutemail.com',
  '33mail.com',
  'dispostable.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.org',
  'tempail.com',
  'tempmail.com',
  'tempmail.net',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
];

function configuredDomains(): string[] {
  return (process.env.SIGNUP_DISPOSABLE_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

/** True for built-in disposable providers, their subdomains and env extras. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@').pop() || '';
  if (!domain) return false;
  return [...BUILTIN_DISPOSABLE_DOMAINS, ...configuredDomains()].some(
    (blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
  );
}
