function getTzOffset(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(date);
  const tzName = parts.find(p => p.type === 'timeZoneName')?.value; 
  if (!tzName || tzName === 'GMT') return '+00:00';
  return tzName.replace('GMT', '');
}

function dateInTz(ymd, time, tz) {
  const guess = new Date(`${ymd}T${time}Z`);
  const offset = getTzOffset(guess, tz);
  return new Date(`${ymd}T${time}${offset}`);
}

console.log(dateInTz('2026-03-22', '23:59:59', 'Asia/Dhaka').toISOString());
console.log(dateInTz('2026-03-22', '00:00:00', 'Asia/Dhaka').toISOString());
console.log(dateInTz('2026-03-22', '00:00:00', 'America/New_York').toISOString());
