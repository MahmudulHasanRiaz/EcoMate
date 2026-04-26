const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/server/modules/purchases.ts');
const snippetPath = path.join(__dirname, 'src/server/modules/purchases.ts_snippet.ts');

const fileContent = fs.readFileSync(filePath, 'utf8');
const snippetContent = fs.readFileSync(snippetPath, 'utf8');

// Find the end of getPurchaseStats function
const marker = 'export async function getPurchaseStats(';
const markerIdx = fileContent.lastIndexOf(marker);

if (markerIdx === -1) {
    console.error('Could not find getPurchaseStats');
    process.exit(1);
}

// Find the closing brace of the function
// It should be the last closing brace before the corrupted section, or we can just look for the pattern
// based on the view_file output, getPurchaseStats ends around line 1970.
// We can scan for the matching brace counting logic?
// Or simpler: The corruption likely starts immediately after the valid file ended.
// If I search for the marker, I can try to find the last valid character?
// The corrupted file has spaced chars. "e x p o r t".
// I can just find the index of "e x p o r t" (spaced) if it exists and cut there?
// Or better: the snippet I added starts with "export type AddPurchasePaymentPayload".
// If I search for "e x p o r t", I might find it.

let cutIdx = -1;
// Try to find the start of the corruption
// It looks like it follows "}\n" or "}\r\n" of the previous function.
// Let's rely on the marker for getPurchaseStats and assume it's valid code.
// We will count braces to find the end of getPurchaseStats.

let openBraces = 0;
let foundStart = false;
let i = markerIdx;

while (i < fileContent.length) {
    if (fileContent[i] === '{') {
        openBraces++;
        foundStart = true;
    } else if (fileContent[i] === '}') {
        openBraces--;
    }

    if (foundStart && openBraces === 0) {
        cutIdx = i + 1;
        break;
    }
    i++;
}

if (cutIdx !== -1) {
    const cleanContent = fileContent.substring(0, cutIdx);
    const newContent = cleanContent + '\n\n' + snippetContent;
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('Fixed purchases.ts');
} else {
    console.error('Could not find end of getPurchaseStats');
    process.exit(1);
}
