export function normalizeBdPhone(phone: string | null | undefined): string | null {
    if (!phone) return null;

    // Remove all non-digits
    const clean = phone.replace(/\D/g, '');

    // Allow 13 digits starting with 880 (normalize to 0 + last 10 digits)
    if (clean.length === 13 && clean.startsWith('880')) {
        return '0' + clean.substring(3);
    }

    // Allow 11 digits starting with 0
    if (clean.length === 11 && clean.startsWith('0')) {
        return clean;
    }

    // Invalid length or prefix
    return null;
}
