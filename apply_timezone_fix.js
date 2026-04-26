const fs = require('fs');

function patch(file, transforms) {
    let content = fs.readFileSync(file, 'utf8');
    for (const [search, replace] of transforms) {
        if (!content.includes(search)) {
            console.warn(`WARNING: Search string not found in ${file}.`);
        } else {
            content = content.replace(search, replace);
            console.log(`Successfully patched ${file}`);
        }
    }
    fs.writeFileSync(file, content);
}

// 1. src/app/api/attendance/route.ts
patch('src/app/api/attendance/route.ts', [
    [
        `import { getMonthRangeInStoreTz } from '@/lib/timezone';`,
        `import { getMonthRangeInStoreTz } from '@/lib/timezone';\nimport { getGeneralSettings } from '@/server/utils/app-settings';\n\nconst zonedDate = (ymd: string, tz: string, time = '00:00:00') => {\n  if (ymd.includes('T')) ymd = ymd.split('T')[0];\n  const guess = new Date(\`\${ymd}T\${time}Z\`);\n  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(guess);\n  const tzName = parts.find(p => p.type === 'timeZoneName')?.value;\n  const offset = (!tzName || tzName === 'GMT') ? '+00:00' : tzName.replace('GMT', '');\n  return new Date(\`\${ymd}T\${time}\${offset}\`);\n};`
    ],
    [
        `    let from: Date | undefined = parseDate(fromParam) || undefined;\r\n    let to: Date | undefined = parseDate(toParam) || undefined;`,
        `    const tz = (await getGeneralSettings()).timezone || 'Asia/Dhaka';\r\n    let from: Date | undefined = fromParam ? zonedDate(fromParam, tz) : undefined;\r\n    let to: Date | undefined = toParam ? zonedDate(toParam, tz, '23:59:59') : undefined;`
    ]
]);

// 2. src/server/modules/attendance.ts
patch('src/server/modules/attendance.ts', [
    [
        `if (lateGraceMinutes > 0 && workStartTime)`,
        `if (lateGraceMinutes >= 0 && workStartTime)`
    ],
    [
        `const staleEnd = new Date(\`\${openDateStr}T23:59:59.000Z\`);`,
        `const staleEnd = endOfDayInTz(openDateStr, timezone);`
    ],
    [
        `const dateFromYmd = (value: string) => new Date(\`\${value}T00:00:00.000Z\`);`,
        `const zonedDate = (ymd: string, tz: string, time = '00:00:00') => {\n  let d = ymd;\n  if (d.includes('T')) d = d.split('T')[0];\n  const guess = new Date(\`\${d}T\${time}Z\`);\n  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(guess);\n  const tzName = parts.find(p => p.type === 'timeZoneName')?.value;\n  const offset = (!tzName || tzName === 'GMT') ? '+00:00' : tzName.replace('GMT', '');\n  return new Date(\`\${d}T\${time}\${offset}\`);\n};\n\nconst endOfDayInTz = (ymd: string, tz: string) => zonedDate(ymd, tz, '23:59:59');\nconst dateFromYmdInTz = (ymd: string, tz: string) => zonedDate(ymd, tz, '00:00:00');\n\nconst dateFromYmd = (value: string) => new Date(\`\${value}T00:00:00.000Z\`);`
    ],
    [
        `const targetDate = params?.date ? params.date.trim() : formatDateYmdInTz(new Date(), timezone);`,
        `const targetDate = params?.date ? params.date.trim() : formatDateYmdInTz(new Date(), timezone);` // Just to check
    ],
    [
        `const dateKey = dateFromYmd(targetDate);`,
        `const dateKey = dateFromYmdInTz(targetDate, timezone);`
    ]
]);

// 3. src/app/api/attendance/summary/route.ts
patch('src/app/api/attendance/summary/route.ts', [
    [
        `import { getAttendanceSummary } from '@/server/modules/attendance';`,
        `import { getAttendanceSummary } from '@/server/modules/attendance';\nimport { getGeneralSettings } from '@/server/utils/app-settings';\n\nconst zonedDate = (ymd: string, tz: string, time = '00:00:00') => {\n  if (ymd.includes('T')) ymd = ymd.split('T')[0];\n  const guess = new Date(\`\${ymd}T\${time}Z\`);\n  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(guess);\n  const tzName = parts.find(p => p.type === 'timeZoneName')?.value;\n  const offset = (!tzName || tzName === 'GMT') ? '+00:00' : tzName.replace('GMT', '');\n  return new Date(\`\${ymd}T\${time}\${offset}\`);\n};\n\nfunction startOfMonthInTz(tz: string) {\n  const now = new Date();\n  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now);\n  const y = parts.find(p => p.type === 'year')?.value;\n  const m = parts.find(p => p.type === 'month')?.value;\n  return zonedDate(\`\${y}-\${m}-01\`, tz);\n}\n`
    ],
    [
        `        const from = fromStr ? new Date(fromStr) : new Date(new Date().setDate(1));\r\n        const to = toStr ? new Date(toStr) : new Date();`,
        `        const tz = (await getGeneralSettings()).timezone || 'Asia/Dhaka';\r\n        const from = fromStr ? zonedDate(fromStr, tz) : startOfMonthInTz(tz);\r\n        const to = toStr ? zonedDate(toStr, tz, '23:59:59') : new Date();`
    ]
]);
