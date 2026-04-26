import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';

const API_BASE_URL = `${getBaseUrl()}/api`;

// ─── Types ──────────────────────────────────────────────────────────

export type CutoffRevisionDTO = {
    id: string;
    revisionNumber: number;
    cutoffDate: string;
    status: 'DRAFT' | 'VALIDATED' | 'APPLIED' | 'SUPERSEDED';
    notes?: string | null;
    validatedAt?: string | null;
    validationReport?: any;
    appliedAt?: string | null;
    appliedByName?: string | null;
    createdByName?: string | null;
    createdAt: string;
    _count?: {
        OpeningBalance: number;
        OpeningInventorySnapshot: number;
        OpeningWipEntry: number;
    };
};

export type OpeningBalanceDTO = {
    id: string;
    revisionId: string;
    entityType: string;
    entityId: string;
    entityName: string;
    suggestedAmount: number;
    finalAmount: number;
    isOverridden: boolean;
    overrideReason?: string | null;
};

export type ValidationReport = {
    checks: {
        id: string;
        label: string;
        severity: 'ERROR' | 'WARNING';
        passed: boolean;
        detail?: string;
    }[];
    passed: boolean;
    errorCount: number;
    warningCount: number;
};

export type InventorySuggestionResult = {
    created?: number;
    isEstimate?: boolean;
    message?: string;
};

export type OpeningInventoryLotDTO = {
    id: string;
    snapshotId: string;
    lotNumber: string;
    quantity: number;
    unitCost: number;
};

export type OpeningInventorySnapshotDTO = {
    id: string;
    revisionId: string;
    productId: string;
    variantId?: string | null;
    totalQuantity: number;
    totalValue: number;
    lotCount: number;
    Lots: OpeningInventoryLotDTO[];
};

export type OpeningWipEntryDTO = {
    id: string;
    revisionId: string;
    productId: string;
    variantId?: string | null;
    currentStep: string;
    quantity: number;
    estimatedCost: number;
    notes?: string | null;
};

export type CutoffAuditLogDTO = {
    id: string;
    action: string;
    detail?: any;
    performedByName?: string | null;
    createdAt: string;
};

// ─── API Functions ──────────────────────────────────────────────────

export async function listCutoffRevisions(): Promise<CutoffRevisionDTO[]> {
    try {
        const res = await fetch(`${API_BASE_URL}/cutoff`, {
            next: { revalidate: 60, tags: ['cutoff'] },
        });
        return handleApiResponse<CutoffRevisionDTO[]>(res);
    } catch (error) {
        console.error('[SERVICE_ERROR:listCutoffRevisions]', error);
        return [];
    }
}

export async function getCutoffRevision(id: string) {
    const res = await fetch(`${API_BASE_URL}/cutoff/${id}`);
    return handleApiResponse(res);
}

export async function createCutoffRevision(cutoffDate: string, notes?: string): Promise<CutoffRevisionDTO> {
    const res = await fetch(`${API_BASE_URL}/cutoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutoffDate, notes }),
    });
    return handleApiResponse<CutoffRevisionDTO>(res);
}

export async function suggestOpeningBalances(revisionId: string) {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suggest_balances' }),
    });
    return handleApiResponse(res);
}

export async function suggestOpeningInventory(revisionId: string): Promise<InventorySuggestionResult> {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suggest_inventory' }),
    });
    return handleApiResponse<InventorySuggestionResult>(res);
}

export async function getOpeningBalances(revisionId: string): Promise<OpeningBalanceDTO[]> {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}/balances`);
    return handleApiResponse<OpeningBalanceDTO[]>(res);
}

export async function overrideBalance(
    revisionId: string,
    balanceId: string,
    finalAmount: number,
    reason: string
) {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}/balances`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balanceId, finalAmount, reason }),
    });
    return handleApiResponse(res);
}

export async function upsertOpeningInventorySnapshot(revisionId: string, payload: any): Promise<OpeningInventorySnapshotDTO> {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert_snapshot', payload }),
    });
    return handleApiResponse<OpeningInventorySnapshotDTO>(res);
}

export async function updateOpeningInventoryLots(revisionId: string, snapshotId: string, lots: any[]): Promise<OpeningInventorySnapshotDTO> {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_lots', snapshotId, lots }),
    });
    return handleApiResponse<OpeningInventorySnapshotDTO>(res);
}

export async function upsertOpeningWipEntry(revisionId: string, payload: any): Promise<OpeningWipEntryDTO> {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}/wip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert', payload }),
    });
    return handleApiResponse<OpeningWipEntryDTO>(res);
}

export async function deleteOpeningWipEntry(revisionId: string, wipId: string) {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}/wip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', wipId }),
    });
    return handleApiResponse(res);
}

export async function validateCutoffRevision(revisionId: string): Promise<ValidationReport> {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}/validate`, {
        method: 'POST',
    });
    return handleApiResponse<ValidationReport>(res);
}

export async function applyCutoffRevision(revisionId: string) {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}/apply`, {
        method: 'POST',
    });
    return handleApiResponse(res);
}

export async function getCutoffAuditLog(revisionId: string): Promise<CutoffAuditLogDTO[]> {
    const res = await fetch(`${API_BASE_URL}/cutoff/${revisionId}/audit`);
    return handleApiResponse<CutoffAuditLogDTO[]>(res);
}
