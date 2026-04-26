import { CashDrawerBalanceInfo } from '@/server/modules/cash-drawers';

export const getCashDrawers = async (): Promise<CashDrawerBalanceInfo[]> => {
  const response = await fetch('/api/settings/cash-drawers');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to fetch cash drawers');
  return data.data;
};

export const createCashDrawer = async (payload: { name: string; isDefault: boolean }) => {
  const response = await fetch('/api/settings/cash-drawers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to create cash drawer');
  return data.data;
};

export const updateCashDrawer = async (payload: { id: string; name: string; isDefault: boolean }) => {
  const response = await fetch('/api/settings/cash-drawers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to update cash drawer');
  return data.data;
};

export const deleteCashDrawer = async (id: string) => {
  const response = await fetch(`/api/settings/cash-drawers?id=${id}`, {
    method: 'DELETE',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to delete/deactivate cash drawer');
  return data;
};

export const transferCash = async (payload: { fromDrawerId: string; toDrawerId: string; amount: number; notes: string }) => {
  const response = await fetch('/api/settings/cash-drawers/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to transfer cash');
  return data.data;
};
