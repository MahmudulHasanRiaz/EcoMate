// Verifies a session from a SECOND process: given a base URL and a
// session cookie header, fetches /api/better-auth/get-session and prints
// the session user's email. Exits 0 only when a live session is returned.
const [baseUrl, cookie] = process.argv.slice(2);
if (!baseUrl || !cookie) {
  console.error('usage: second-process-check.mjs <baseUrl> <cookie>');
  process.exit(2);
}
const res = await fetch(`${baseUrl}/api/better-auth/get-session`, {
  headers: { origin: baseUrl, cookie },
});
const text = await res.text();
let json = null;
try {
  json = JSON.parse(text);
} catch {
  // keep null
}
if (res.status === 200 && json?.session && json?.user?.email) {
  console.log(`second-process session ok: ${json.user.email}`);
  process.exit(0);
}
console.error(`second-process session failed: ${res.status} ${text.slice(0, 200)}`);
process.exit(1);
