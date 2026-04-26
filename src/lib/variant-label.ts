/**
 * Canonical variant label helper.
 *
 * Priority:
 *  1. Attribute values  — e.g. `Red / XL`   (preferred, most informative)
 *  2. Variant name      — only if it differs from the product name
 *  3. Variant SKU
 *  4. `'Default'`       — final fallback
 */
export function getVariantLabel(
    variant: { attributes?: Record<string, string> | null; name?: string | null; sku?: string | null } | null | undefined,
    productName?: string | null
): string {
    if (!variant) return 'Default';

    // 1. Attributes: prefer joined attribute values
    const attrValues = variant.attributes
        ? Object.values(variant.attributes).filter(Boolean)
        : [];
    if (attrValues.length > 0) {
        return attrValues.join(' / ');
    }

    // 2. Variant name if it's distinct from product name
    const vName = variant.name?.trim() ?? '';
    if (vName && vName !== (productName?.trim() ?? '')) {
        return vName;
    }

    // 3. SKU
    const vSku = variant.sku?.trim() ?? '';
    if (vSku) return vSku;

    return 'Default';
}
