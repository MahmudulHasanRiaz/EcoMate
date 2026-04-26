'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Loader2, RefreshCw, Search, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

type Location = { id: string; name: string };

type TransferRow = {
  key: string;
  productId: string;
  variantId?: string;
  productName: string;
  productSku: string;
  productType: string;
  productImage?: string;
  variantName?: string;
  variantSku?: string;
  variantImage?: string;
  fromLocation: { total: number; reserved: number; available: number };
  toLocation: { total: number; reserved: number; available: number };
  reservedInSource: number;
  recommendedTransferQty: number;
  ordersCount: number;
};

type ApiResponse<T> = { success: boolean; message?: string; data?: T };

export default function ReservedTransfersClient({
  locations,
  defaultFromId,
}: {
  locations: Location[];
  defaultFromId: string;
}) {
  const { toast } = useToast();

  const [fromLocationId, setFromLocationId] = useState(defaultFromId);
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [transferQtys, setTransferQtys] = useState<Record<string, number>>({});
  const [transferring, setTransferring] = useState<Set<string>>(new Set());
  const [bulkTransferring, setBulkTransferring] = useState(false);

  const pageSize = 50;

  const fetchData = useCallback(async (opts?: { reset?: boolean; pageOverride?: number }) => {
    const reset = !!opts?.reset;
    const fetchPage = opts?.pageOverride ?? (reset ? 1 : page);
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        fromLocationId,
        page: String(fetchPage),
        pageSize: String(pageSize),
        ...(searchQuery ? { q: searchQuery } : {}),
      });
      const res = await fetch(`/api/inventory/reserved-transfers?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as ApiResponse<{ data: TransferRow[]; meta: { total: number } }> | null;
      if (!res.ok || !json?.success) {
        toast({ title: 'Error', description: json?.message || 'Failed to load', variant: 'destructive' });
        return;
      }
      const items = json.data?.data || [];
      const total = json.data?.meta?.total || 0;
      setRows(items);
      setTotalCount(total);
      if (reset) setPage(1);

      // Set default transfer quantities
      const qtys: Record<string, number> = {};
      for (const row of items) {
        qtys[row.key] = row.reservedInSource;
      }
      setTransferQtys(qtys);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to load data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [fromLocationId, page, searchQuery, toast]);

  useEffect(() => {
    fetchData({ reset: true, pageOverride: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLocationId]);

  const handleSearch = () => {
    setPage(1);
    fetchData({ reset: true, pageOverride: 1 });
  };

  const transferSingle = async (row: TransferRow): Promise<boolean> => {
    const qty = transferQtys[row.key] || 0;
    if (qty <= 0) {
      toast({ title: 'Invalid', description: 'Quantity must be > 0', variant: 'destructive' });
      return false;
    }
    try {
      const res = await fetch('/api/inventory/reserved-transfers/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: row.productId,
          variantId: row.variantId || null,
          fromLocationId,
          quantity: qty,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<any> | null;
      if (!res.ok || !json?.success) {
        toast({
          title: `Failed: ${row.variantSku || row.productSku}`,
          description: json?.message || 'Transfer failed',
          variant: 'destructive',
        });
        return false;
      }
      return true;
    } catch (err: any) {
      toast({
        title: `Error: ${row.variantSku || row.productSku}`,
        description: err?.message || 'Transfer error',
        variant: 'destructive',
      });
      return false;
    }
  };

  const handleTransferRow = async (row: TransferRow) => {
    setTransferring((prev) => new Set(prev).add(row.key));
    const success = await transferSingle(row);
    setTransferring((prev) => {
      const next = new Set(prev);
      next.delete(row.key);
      return next;
    });
    if (success) {
      toast({ title: 'Success', description: `${row.variantSku || row.productSku} transferred` });
      // Remove row if reserved should be 0 now, otherwise refresh
      setRows((prev) => prev.filter((r) => r.key !== row.key));
    }
  };

  const handleBulkTransfer = async () => {
    setBulkTransferring(true);
    const CHUNK_SIZE = 3;
    let successCount = 0;
    const failedKeys = new Set<string>();

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(chunk.map((row) => transferSingle(row)));
      results.forEach((ok, idx) => {
        if (ok) successCount++;
        else failedKeys.add(chunk[idx].key);
      });
    }

    // Remove successful rows
    setRows((prev) => prev.filter((r) => failedKeys.has(r.key)));
    toast({
      title: 'Bulk Transfer',
      description: `${successCount} transferred, ${failedKeys.size} failed`,
      variant: failedKeys.size > 0 ? 'destructive' : 'default',
    });
    setBulkTransferring(false);
  };

  const fromLocationName = locations.find((l) => l.id === fromLocationId)?.name || 'Source';

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h2 className="text-2xl font-bold">Reserved Stock Transfers</h2>
        <p className="text-muted-foreground">Transfer reserved stock from any location to Packing Section.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="space-y-1 flex-1 max-w-xs">
          <Label>Source Location</Label>
          <Select value={fromLocationId} onValueChange={setFromLocationId}>
            <SelectTrigger>
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
          <ArrowRight className="w-4 h-4" />
          <span>Packing Section</span>
        </div>

        <div className="space-y-1 flex-1 max-w-xs">
          <Label>Search</Label>
          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Product name or SKU..."
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button variant="outline" size="icon" onClick={handleSearch}>
              <Search className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <Button variant="outline" onClick={() => fetchData()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Bulk Transfer */}
      {rows.length > 0 && (
        <div className="flex items-center gap-4">
          <Button
            onClick={handleBulkTransfer}
            disabled={bulkTransferring || rows.length === 0}
          >
            {bulkTransferring && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Transfer All ({rows.length} items)
          </Button>
          <span className="text-sm text-muted-foreground">
            Total reserved in {fromLocationName}: {rows.reduce((sum, r) => sum + r.reservedInSource, 0)}
          </span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left font-medium">Product / Variant</th>
              <th className="p-3 text-center font-medium">
                <span className="block text-xs text-muted-foreground">{fromLocationName}</span>
                Total / Reserved / Avail
              </th>
              <th className="p-3 text-center font-medium">
                <span className="block text-xs text-muted-foreground">Packing</span>
                Total / Reserved / Avail
              </th>
              <th className="p-3 text-center font-medium">Orders</th>
              <th className="p-3 text-center font-medium">Transfer Qty</th>
              <th className="p-3 text-center font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="p-10 text-center text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-10 text-center text-muted-foreground">
                  No reserved stock found in {fromLocationName}.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => {
                const isRowTransferring = transferring.has(row.key);
                const displaySku = row.variantSku || row.productSku;
                const displayName = row.variantName
                  ? `${row.productName} — ${row.variantName}`
                  : row.productName;
                const imgSrc = row.variantImage || row.productImage;

                return (
                  <tr key={row.key} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {imgSrc && (
                          <img
                            src={imgSrc}
                            alt=""
                            className="w-10 h-10 rounded object-cover border"
                          />
                        )}
                        <div>
                          <p className="font-medium">{displayName}</p>
                          <p className="text-xs text-muted-foreground">{displaySku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-center tabular-nums">
                      <span>{row.fromLocation.total}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-orange-600 font-medium">{row.fromLocation.reserved}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-green-600">{row.fromLocation.available}</span>
                    </td>
                    <td className="p-3 text-center tabular-nums">
                      <span>{row.toLocation.total}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-orange-600 font-medium">{row.toLocation.reserved}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-green-600">{row.toLocation.available}</span>
                    </td>
                    <td className="p-3 text-center tabular-nums">{row.ordersCount}</td>
                    <td className="p-3 text-center">
                      <Input
                        type="number"
                        className="w-20 mx-auto text-center"
                        value={transferQtys[row.key] ?? row.reservedInSource}
                        onChange={(e) =>
                          setTransferQtys((prev) => ({
                            ...prev,
                            [row.key]: Math.max(0, parseInt(e.target.value, 10) || 0),
                          }))
                        }
                        disabled={isRowTransferring}
                        min={0}
                        max={row.reservedInSource}
                      />
                    </td>
                    <td className="p-3 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTransferRow(row)}
                        disabled={isRowTransferring || (transferQtys[row.key] || 0) <= 0}
                      >
                        {isRowTransferring ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalCount > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                const nextPage = Math.max(1, page - 1);
                setPage(nextPage);
                fetchData({ pageOverride: nextPage });
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * pageSize >= totalCount}
              onClick={() => {
                const nextPage = page + 1;
                setPage(nextPage);
                fetchData({ pageOverride: nextPage });
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
