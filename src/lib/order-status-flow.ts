import { OrderStatus } from "@/types";

/**
 * Defines valid status transitions for the order lifecycle.
 * Keys are the current status, and values are the allowed next statuses.
 * 
 * Based on user requirements:
 * - New: Removed Incomplete
 * - In-Courier: Removed Shipped
 * - Shipped: Added In-Courier
 * - Return Pending: Removed Canceled
 * - Returned: Added Damaged
 * - Canceled: Added Confirmed
 */
// Map both standard and legacy/compatibility statuses
export const VALID_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    'Draft': ['New', 'Canceled'],
    'New': ['Confirmed', 'Confirmed_Waiting', 'Confirmed Waiting', 'Canceled', 'Hold'],
    'Confirmed': ['RTS (Ready to Ship)', 'RTS__Ready_to_Ship_', 'Packing_Hold', 'Packing Hold', 'Canceled', 'Hold'],
    'Hold': ['New', 'Confirmed', 'Confirmed_Waiting', 'Confirmed Waiting', 'Canceled', 'No_Response', 'No Response'],
    'No_Response': ['New', 'Confirmed', 'Confirmed_Waiting', 'Confirmed Waiting', 'Canceled', 'Hold'],
    'Canceled': ['New', 'Confirmed', 'C2C'],
    'C2C': ['New', 'Confirmed'],

    // Modern IDs
    'Confirmed_Waiting': ['Confirmed', 'Canceled'],
    'Packing_Hold': ['Confirmed', 'Canceled'],
    'RTS__Ready_to_Ship_': ['In_Courier', 'In-Courier', 'Shipped', 'Canceled', 'Confirmed'],
    'In_Courier': ['Delivered', 'Return_Pending', 'Return Pending', 'Partial', 'Damaged'],
    'Shipped': ['In_Courier', 'In-Courier', 'Delivered', 'Return_Pending', 'Return Pending', 'Partial', 'Damaged'],
    'Delivered': ['Return_Pending', 'Return Pending', 'Partial'],
    'Return_Pending': ['Returned', 'Paid_Return', 'Shipped'],
    'Returned': ['New', 'Paid_Return', 'Damaged'],
    'Paid_Return': ['New', 'Damaged'],
    'Partial': ['Return_Pending', 'Return Pending', 'Returned', 'Delivered'],
    'Damaged': ['Return_Pending', 'Return Pending'],
    'Incomplete': ['New', 'Canceled'],
    'Incomplete_Cancelled': ['New', 'Canceled'],

    // Legacy / Compatibility IDs (Mapping to same logic)
    'Packing Hold': ['Confirmed', 'Canceled'],
    'RTS (Ready to Ship)': ['In_Courier', 'In-Courier', 'Shipped', 'Canceled', 'Confirmed'],
    'In-Courier': ['Delivered', 'Return_Pending', 'Return Pending', 'Partial', 'Damaged'],
    'Return Pending': ['Returned', 'Paid_Return', 'Shipped'],
    'Paid Return': ['New', 'Damaged'],
    'Incomplete-Cancelled': ['New', 'Canceled'],
    'No Response': ['New', 'Confirmed', 'Confirmed_Waiting', 'Confirmed Waiting', 'Canceled', 'Hold'],

    // Legacy / Compatibility
    'Confirmed Waiting': ['Confirmed', 'Canceled'],
};

/**
 * Helper to get available next statuses.
 * If current status is not in the map (unexpected), returns all statuses 
 * to ensure the order isn't stuck.
 */
export function getAvailableStatuses(currentStatus: OrderStatus, allStatuses: OrderStatus[]): OrderStatus[] {
    const allowed = VALID_STATUS_TRANSITIONS[currentStatus];
    if (!allowed) return allStatuses;

    const filtered = allStatuses.filter(s => s === currentStatus || allowed.includes(s));

    // Guard against mixed enum/display lists:
    // if current value is missing from options, Select renders blank.
    if (!filtered.includes(currentStatus)) {
        return [currentStatus, ...filtered];
    }
    return filtered;
}

/**
 * Helper to get the intersection of available statuses for multiple orders.
 * Used for Bulk Actions.
 */
export function getCommonAvailableStatuses(currentStatuses: OrderStatus[], allStatuses: OrderStatus[]): OrderStatus[] {
    if (currentStatuses.length === 0) return [];

    // Get allowed statuses for each order
    const allowedSets = currentStatuses.map(status => {
        const allowed = VALID_STATUS_TRANSITIONS[status];
        return allowed ? new Set(allowed) : new Set(allStatuses); // If unknown status, assume all allowed (or none? safety says all to avoid deadlock)
    });

    // Find intersection
    // We start with the first set and filter keep elements present in all other sets
    const common = Array.from(allowedSets[0]).filter(status =>
        allowedSets.every(set => set.has(status))
    );

    return allStatuses.filter(s => common.includes(s)); // Maintain original order
}
