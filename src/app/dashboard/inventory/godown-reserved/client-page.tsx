'use client';

import * as React from "react";
import useSWR from "swr";
import Image from "next/image";
import { Loader2, Search, ArrowRight, AlertCircle, RefreshCw } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type GodownReservedItem = {
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
  godown: { total: number; reserved: number; available: number };
  packing: { total: number; reserved: number; available: number };
  reservedInGodown: number;
  recommendedTransferQty: number;
  ordersCount: number;
};

type FetchResponse = {
  data: GodownReservedItem[];
  meta: { total: number; page: number; pageSize: number; };
};

const fetcher = async (url: string): Promise<FetchResponse> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json?.success) {
    throw new Error(json?.message || 'Failed to load Godown reserved stock');
  }
  return json.data as FetchResponse;
};

export default function GodownReservedClientPage() {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const pageSize = 50;
  
  // Row selection and transfer values
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set());
  const [transferValues, setTransferValues] = React.useState<Record<string, number>>({});
  const [isTransferring, setIsTransferring] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, isLoading, mutate } = useSWR<FetchResponse>(
    `/api/inventory/godown-reserved?q=${encodeURIComponent(debouncedSearch)}&page=${page}&pageSize=${pageSize}`,
    fetcher
  );

  const items = data?.data || [];
  const totalReservedInGodown = React.useMemo(
    () => items.reduce((sum, item) => sum + (item.reservedInGodown || 0), 0),
    [items]
  );

  // Initialize transfer values to max valid default
  React.useEffect(() => {
    if (items.length > 0) {
      setTransferValues(prev => {
        const next = { ...prev };
        items.forEach(item => {
          if (next[item.key] === undefined) {
            next[item.key] = item.recommendedTransferQty;
          }
        });
        return next;
      });
    }
  }, [items]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedKeys(new Set(items.map(i => i.key)));
    } else {
      setSelectedKeys(new Set());
    }
  };

  const handleSelectRow = (key: string, checked: boolean) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleTransferChange = (key: string, val: string, maxQty: number) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) {
      setTransferValues(p => ({ ...p, [key]: 0 }));
      return;
    }
    const clamped = Math.max(0, Math.min(num, maxQty));
    setTransferValues(p => ({ ...p, [key]: clamped }));
  };

  const doTransfer = async (payloads: { key: string; productId: string; variantId?: string; quantity: number }[]) => {
    setIsTransferring(true);
    const successKeys = new Set<string>();
    const failedKeys = new Set<string>();
    
    // Throttle concurrency: e.g. chunk by 3
    const CHUNK_SIZE = 3;
    for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
      const chunk = payloads.slice(i, i + CHUNK_SIZE);
      const promises = chunk.map(async (payload) => {
        try {
          const res = await fetch('/api/inventory/godown-reserved/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: payload.productId, variantId: payload.variantId, quantity: payload.quantity })
          }).then(r => r.json());
          
          if (res.success) {
            successKeys.add(payload.key);
          } else {
            failedKeys.add(payload.key);
            toast({ title: 'Transfer failed', description: res.message, variant: 'destructive' });
          }
        } catch (err: any) {
          failedKeys.add(payload.key);
          toast({ title: 'Transfer error', description: err.message, variant: 'destructive' });
        }
      });
      await Promise.all(promises);
    }
    
    if (successKeys.size > 0) {
      toast({ title: 'Success', description: `Transferred ${successKeys.size} item(s) reserved stock to Packing Section.`});
      setSelectedKeys(prev => {
        const next = new Set(prev);
        for (const k of successKeys) next.delete(k);
        return next;
      });
      setTransferValues(prev => {
        const next = { ...prev };
        for (const k of successKeys) delete next[k];
        return next;
      });
      mutate(); // Reload data so rows with 0 reserved disappear
    } else if (failedKeys.size > 0) {
      toast({ title: 'No transfers applied', description: 'All selected transfers failed. Fix the errors and retry.', variant: 'destructive' });
    }
    setIsTransferring(false);
  };

  const handleTransferSingle = (item: GodownReservedItem) => {
    const qty = transferValues[item.key] || 0;
    if (qty <= 0) return;
    doTransfer([{
      key: item.key,
      productId: item.productId,
      variantId: item.variantId,
      quantity: qty
    }]);
  };

  const handleTransferBulk = () => {
    if (selectedKeys.size === 0) return;
    const payloads = Array.from(selectedKeys).map(key => {
      const item = items.find(i => i.key === key);
      const qty = transferValues[key] || 0;
      if (!item || qty <= 0) return null;
      return {
        key,
        productId: item.productId,
        variantId: item.variantId,
        quantity: qty
      };
    }).filter(Boolean) as { key: string; productId: string; variantId?: string; quantity: number }[];

    if (payloads.length === 0) return;
    doTransfer(payloads);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive space-x-2">
        <AlertCircle className="h-6 w-6" />
        <span>Error loading Godown reservations.</span>
        <Button variant="outline" size="sm" onClick={() => mutate()}><RefreshCw className="h-4 w-4 mr-2" /> Retry</Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>Godown Reserved Stock</CardTitle>
          <div className="text-sm text-muted-foreground mt-1">
            Products that are reserved in Godown (due to active orders) and need to physically transfer to Packing Section.
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <div className="text-sm bg-muted/30 px-4 py-2 rounded-md font-medium border hidden md:block">
            {items.length} PV(s) | Reserved: {totalReservedInGodown}
          </div>
          {selectedKeys.size > 0 && (
            <Button disabled={isTransferring} onClick={handleTransferBulk} variant="default">
              {isTransferring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Transfer Selected ({selectedKeys.size})
            </Button>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-64"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">
                  <Checkbox 
                    checked={items.length > 0 && selectedKeys.size === items.length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-center bg-blue-50/50">Godown Stock</TableHead>
                <TableHead className="text-center bg-orange-50/50">Packing Section</TableHead>
                <TableHead className="w-48 text-right">Transfer Amount</TableHead>
                <TableHead className="w-24 text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No products with Godown reservations found.
                  </TableCell>
                </TableRow>
              ) : (
                items.map(item => {
                  const maxTransfer = item.reservedInGodown;
                  const currentTransVal = transferValues[item.key] ?? 0;
                  const isSelected = selectedKeys.has(item.key);

                  return (
                    <TableRow key={item.key} className={isSelected ? "bg-muted/50" : ""}>
                      <TableCell className="text-center">
                        <Checkbox 
                          checked={isSelected}
                          onCheckedChange={(c) => handleSelectRow(item.key, !!c)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-3">
                          <div className="h-10 w-10 shrink-0 border rounded overflow-hidden bg-muted">
                            <Image 
                              src={item.variantImage || item.productImage || '/placeholder.svg'} 
                              alt={item.productName} 
                              width={40} height={40} 
                              className="object-cover h-full w-full"
                            />
                          </div>
                          <div>
                            <div className="font-medium text-sm">{item.productName}</div>
                            <div className="text-xs text-muted-foreground">
                              SKU: <span className="font-mono">{item.productSku}</span>
                              {item.variantSku ? (
                                <> · Variant: <span className="font-mono">{item.variantSku}</span></>
                              ) : null}
                            </div>
                            {item.variantName && (
                              <div className="text-xs text-muted-foreground">
                                Variant: <span className="text-primary font-medium">{item.variantName}</span>
                              </div>
                            )}
                            <div className="text-xs font-semibold text-orange-600 mt-0.5">
                              {item.ordersCount} Open Order(s)
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="bg-blue-50/20 text-center text-sm">
                        <div>
                          Tot: {item.godown.total} | <span className="text-red-500 font-medium">Res: {item.godown.reserved}</span>
                        </div>
                        <div className="text-green-600 font-medium mt-0.5">Avail: {item.godown.available}</div>
                      </TableCell>
                      <TableCell className="bg-orange-50/20 text-center text-sm">
                        <div>Tot: {item.packing.total} | Res: {item.packing.reserved}</div>
                        <div className="text-green-600 font-medium mt-0.5">Avail: {item.packing.available}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end space-y-1">
                          <Input 
                            type="number"
                            min="0"
                            max={maxTransfer}
                            value={currentTransVal.toString()}
                            onChange={(e) => handleTransferChange(item.key, e.target.value, maxTransfer)}
                            className="w-24 text-right h-8"
                            disabled={maxTransfer <= 0}
                          />
                          {maxTransfer <= 0 && (
                            <span className="text-[10px] text-red-500">No reserved stock</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          disabled={maxTransfer <= 0 || currentTransVal <= 0 || isTransferring}
                          onClick={() => handleTransferSingle(item)}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Basic Pagination Controls (if needed, though relying on scroll/limit mostly) */}
        {!isLoading && items.length > 0 && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, data!.meta.total)} of {data!.meta.total}
            </div>
            <div className="space-x-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page * pageSize >= data!.meta.total}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
