const fs = require('fs');
const path = 'e:\\ecomate\\EcoMate\\draft\\ecomate-woo-plugin\\ecomate-woo-plugin.php';

try {
    const data = fs.readFileSync(path, 'utf8');
    const lines = data.split(/\r?\n/);

    // We want to keep 0 to 498 (Line 499 is index 498)
    // We want to remove 499 to 551 (Line 500 to 552)
    // We want to keep 552 to end (Line 553 onwards)

    // Check key markers to be safe
    const line499 = lines[498]; // Should be "        update_option($key, $logs);"
    const line500 = lines[499]; // Should be "    }" or empty
    const line553 = lines[552]; // Should be "    private function wpdb_like_escape($str)"

    console.log('Line 499:', line499);
    console.log('Line 500:', line500);
    console.log('Line 553:', line553);

    // Verify marker content (approximate match)
    if (!line553.includes('wpdb_like_escape')) {
        console.error('Safety Check Failed: Expected wpdb_like_escape at line 553, found:', line553);
        process.exit(1);
    }

    const newLines = [
        ...lines.slice(0, 500), // Keep lines 1-500 (indices 0-499)
        // Skip 501-552 (indices 500-551)
        ...lines.slice(552) // Keep 553-end (indices 552+)
    ];

    fs.writeFileSync(path, newLines.join('\n'));
    console.log('File fixed successfully. Removed lines 501-552.');

} catch (error) {
    console.error('Error:', error);
}
