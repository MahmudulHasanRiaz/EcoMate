const fs = require('fs');

function patch(file, transforms) {
    let content = fs.readFileSync(file, 'utf8');
    for (const [search, replace] of transforms) {
        // use Regex to ignore CRLF/LF issues
        const escapedSearch = search.replace(/[.*+?^$\{key\}()|[\\]\\\\]/g, '\\\\$&').replace(/\\r\\n/g, '\\n').replace(/\\n/g, '\\r?\\n');
        const regex = new RegExp(escapedSearch, 'g');
        if (!regex.test(content)) {
            console.warn(`WARNING: Search string not found in ${file}. Regex: ${escapedSearch}`);
        } else {
            content = content.replace(regex, replace);
            console.log(`Successfully patched ${file}`);
        }
    }
    fs.writeFileSync(file, content);
}

patch('src/app/api/attendance/summary/route.ts', [
    [
        `const from = fromStr ? new Date(fromStr) : new Date(new Date().setDate(1)); // Default to 1st of month\n        const to = toStr ? new Date(toStr) : new Date();`,
        `const tz = (await getGeneralSettings()).timezone || 'Asia/Dhaka';\n        const from = fromStr ? zonedDate(fromStr, tz) : startOfMonthInTz(tz); // Default to 1st of month\n        const to = toStr ? zonedDate(toStr, tz, '23:59:59') : new Date();`
    ]
]);
