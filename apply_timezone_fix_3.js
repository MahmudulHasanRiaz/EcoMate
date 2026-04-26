const fs = require('fs');

let content = fs.readFileSync('src/app/api/attendance/summary/route.ts', 'utf8');

const s1 = `const from = fromStr ? new Date(fromStr) : new Date(new Date().setDate(1)); // Default to 1st of month\r\n        const to = toStr ? new Date(toStr) : new Date();`;
const s2 = `const from = fromStr ? new Date(fromStr) : new Date(new Date().setDate(1)); // Default to 1st of month\n        const to = toStr ? new Date(toStr) : new Date();`;

const replacement = `const tz = (await getGeneralSettings()).timezone || 'Asia/Dhaka';\n        const from = fromStr ? zonedDate(fromStr, tz) : startOfMonthInTz(tz); // Default to 1st of month\n        const to = toStr ? zonedDate(toStr, tz, '23:59:59') : new Date();`;

let found = false;
if (content.includes(s1)) { content = content.replace(s1, replacement); found = true; }
else if (content.includes(s2)) { content = content.replace(s2, replacement); found = true; }

if(found) {
  fs.writeFileSync('src/app/api/attendance/summary/route.ts', content);
  console.log('Patched');
} else {
  console.error('Failed to find string');
}
