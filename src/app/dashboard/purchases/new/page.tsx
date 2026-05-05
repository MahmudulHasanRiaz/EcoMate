
'use client';

import { useState, useMemo, useEffect, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { PlusCircle, Trash2, Loader2, Save, Layers } from "lucide-react";
import LotSelectionCombobox from "@/components/lot-selection-combobox";
import Link from "next/link";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { createPurchaseOrderClient } from '@/services/purchases-client';
import { PurchaseProductAddDialog } from "@/components/purchase-product-add-dialog";
import type { Product, ProductVariant, Supplier, Vendor, PurchaseType, GeneralOrderItem, ThreePieceOrderItem, PaymentDetails, InventoryItem, Account, PurchasePaymentItem } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { getVariantLabel } from "@/lib/variant-label";


const initialOrderItemState: Omit<ThreePieceOrderItem, 'id' | 'lineTotal'> = {
  productId: '',
  variantId: undefined,
  quantity: 1,
  jamaYards: 0,
  jamaRate: 0,
  ornaYards: 0,
  ornaRate: 0,
  selowarYards: 0,
  selowarRate: 0,
};
const initialGeneralOrderItemState: Omit<GeneralOrderItem, 'id' | 'lineTotal'> = { productId: '', variantId: undefined, quantity: 1, unitCost: 0 };
const initialPaymentState: PaymentDetails = { cash: 0, check: 0, checkDate: '', paidFromAccountId: null };

type FabricPartKey = 'JAMA' | 'ORNA' | 'SELOWAR';
type LotAllocation = {
  id: string;
  inventoryItemId: string;
  yards: number;
};
type LotAllocationsByPart = Record<FabricPartKey, LotAllocation[]>;
type ThreePieceOrderItemDraft = ThreePieceOrderItem & {
  lotAllocations: LotAllocationsByPart;
};

const emptyAllocations = (): LotAllocationsByPart => ({
  JAMA: [],
  ORNA: [],
  SELOWAR: [],
});

const fmtMoney = (val: number) =>
  `Tk ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function fetchApi<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP error! status: ${res.status}`);
  }
  if (json.success && json.data !== undefined) {
    return json.data as T;
  }
  return json as T;
}


export default function NewPurchaseOrderPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [purchaseType, setPurchaseType] = useState<PurchaseType>('three-piece');
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [allVendors, setAllVendors] = useState<Vendor[]>([]);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [selectedPrintingVendorId, setSelectedPrintingVendorId] = useState<string>('');

  const [fabricSource, setFabricSource] = useState<'EXTERNAL' | 'INTERNAL'>('INTERNAL');

  const [lotStateByKey, setLotStateByKey] = useState<Record<string, {
    items: InventoryItem[];
    nextCursor: string | null;
    isLoading: boolean;
    hasLoaded?: boolean;
  }>>({});

  const [selectedLotsMap, setSelectedLotsMap] = useState<Record<string, InventoryItem>>({});
  const [lotDialogItemId, setLotDialogItemId] = useState<string | null>(null);

  const [orderItems, setOrderItems] = useState<ThreePieceOrderItemDraft[]>([]);
  const [generalOrderItems, setGeneralOrderItems] = useState<GeneralOrderItem[]>([]);

  // Payments state removed - decentralized

  const [pindaDialogItemId, setPindaDialogItemId] = useState<string | null>(null);
  const activePindaItem = useMemo(() => generalOrderItems.find(i => i.id === pindaDialogItemId), [generalOrderItems, pindaDialogItemId]);

  const updatePindaConfig = (count: number, quantities: number[]) => {
    if (!activePindaItem) return;
    const total = quantities.reduce((a, b) => a + b, 0);
    setGeneralOrderItems((prev: GeneralOrderItem[]) => prev.map((item: GeneralOrderItem) => {
      if (item.id === activePindaItem.id) {
        return {
          ...item,
          pindaCount: count,
          pindaQuantities: quantities,
          quantity: total > 0 ? total : item.quantity, // Update total only if pindas have value
          lineTotal: (total > 0 ? total : item.quantity) * item.unitCost
        };
      }
      return item;
    }));
  };

  const [availableVariants, setAvailableVariants] = useState<Record<string, ProductVariant[]>>({});

  useEffect(() => {
    setIsLoading(true);
    let isMounted = true;
    Promise.all([
      fetchApi<{ items?: Product[] } | Product[]>('/api/products?pageSize=200&mode=lookup'),
      fetchApi<{ items?: Supplier[] } | Supplier[]>('/api/partners/suppliers?pageSize=500'),
      fetchApi<{ items?: Vendor[] } | Vendor[]>('/api/partners/vendors?pageSize=500'),
      fetchApi<Account[]>('/api/accounting/accounts'),
    ]).then(([productsData, suppliersData, vendorsData, accountsData]) => {
      if (!isMounted) return;

      const products = Array.isArray(productsData)
        ? productsData
        : (productsData.items || []);

      const suppliers = Array.isArray(suppliersData)
        ? suppliersData
        : (suppliersData.items || []);

      const vendors = Array.isArray(vendorsData)
        ? vendorsData
        : (vendorsData.items || []);

      setAllProducts(products);
      setAllSuppliers(suppliers);
      setAllVendors(vendors);
      setAllAccounts(Array.isArray(accountsData) ? accountsData : []);
      setIsLoading(false);
    }).catch((error: any) => {
      if (!isMounted) return;
      console.error('DEBUG: Purchase Data Load Error:', error);
      setIsLoading(false);
      toast({
        variant: "destructive",
        title: "Failed to load purchase data",
        description: error?.message || "Unable to fetch required data.",
      });
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const assetAccounts = useMemo(
    () => allAccounts.filter((account) => account.type === 'Asset'),
    [allAccounts]
  );
  const liquidAccounts = useMemo(
    () => allAccounts.filter((account) => account.group === 'LIQUID'),
    [allAccounts]
  );

  const defaultPaidAccountId = useMemo(() => {
    const cashAccount = liquidAccounts.find((account) =>
      account.name.toLowerCase().includes('cash')
    );
    return cashAccount?.id || liquidAccounts[0]?.id || null;
  }, [liquidAccounts]);

  const lotKey = (productId: string, variantId?: string | null) =>
    `${productId}:${variantId ?? 'none'}`;

  const inventoryLots = useMemo(() => {
    return Object.values(lotStateByKey).flatMap((state) => state.items);
  }, [lotStateByKey]);

  /* 
  useEffect(() => {
    if (!defaultPaidAccountId) return;
    setFabricPayments((prev) => {
      if (prev.length === 0) return [{ accountId: defaultPaidAccountId, method: 'Cash', amount: 0 }];
      return prev;
    });
    setGeneralPayments((prev) => {
      if (prev.length === 0) return [{ accountId: defaultPaidAccountId, method: 'Cash', amount: 0 }];
      return prev;
    });
  }, [defaultPaidAccountId]);
  */

  const inventoryLotMap = useMemo(() => {
    return new Map(inventoryLots.map((lot) => [lot.id, lot]));
  }, [inventoryLots]);
  const formatLotLabel = (lot: InventoryItem) => {
    const variantLabel = lot.variantName ? ` (${lot.variantName})` : '';
    return `${lot.lotNumber} - ${lot.productName}${variantLabel} (${lot.sku}) - ${lot.locationName} - ${lot.quantity}`;
  };
  const formatLotName = (lot?: InventoryItem) => {
    if (!lot) return 'Unknown Lot';
    const variantLabel = lot.variantName ? ` (${lot.variantName})` : '';
    return `${lot.productName}${variantLabel}`;
  };

  const [scanInputs, setScanInputs] = useState<Record<string, string>>({});
  const activeLotItem = useMemo(
    () => orderItems.find((item) => item.id === lotDialogItemId) || null,
    [orderItems, lotDialogItemId]
  );
  const activeLotKey = useMemo(() => {
    if (!activeLotItem) return null;
    return lotKey(activeLotItem.productId, activeLotItem.variantId);
  }, [activeLotItem]);
  const activeLotState = activeLotKey ? lotStateByKey[activeLotKey] : undefined;
  const activeLotItems = activeLotState?.items || [];
  const activeLotNextCursor = activeLotState?.nextCursor ?? null;
  const isActiveLotLoading = activeLotState?.isLoading ?? false;
  const lotPartConfigs: Array<{ key: FabricPartKey; label: string; yardsKey: 'jamaYards' | 'ornaYards' | 'selowarYards' }> = [
    { key: 'JAMA', label: 'Jama', yardsKey: 'jamaYards' },
    { key: 'ORNA', label: 'Orna', yardsKey: 'ornaYards' },
    { key: 'SELOWAR', label: 'Selowar', yardsKey: 'selowarYards' },
  ];

  const mergeLots = (prevItems: InventoryItem[], nextItems: InventoryItem[]) => {
    const merged = new Map(prevItems.map((lot) => [lot.id, lot]));
    nextItems.forEach((lot) => merged.set(lot.id, lot));
    return Array.from(merged.values());
  };

  const loadLotsForItem = async (item: ThreePieceOrderItemDraft, options?: { append?: boolean }) => {
    if (!item?.productId) return;
    const key = lotKey(item.productId, item.variantId);
    const append = Boolean(options?.append);
    const currentState = lotStateByKey[key];
    if (currentState?.isLoading) return;
    if (append && !currentState?.nextCursor) return;

    setLotStateByKey((prev) => ({
      ...prev,
      [key]: {
        items: currentState?.items || [],
        nextCursor: currentState?.nextCursor ?? null,
        isLoading: true,
        hasLoaded: currentState?.hasLoaded,
      },
    }));

    const params = new URLSearchParams();
    params.set('productId', item.productId);
    if (item.variantId) params.set('variantId', item.variantId);
    params.set('pageSize', '50');
    if (append && currentState?.nextCursor) {
      params.set('cursor', currentState.nextCursor);
    }

    try {
      const data = await fetchApi<{ items: InventoryItem[]; nextCursor: string | null }>(
        `/api/inventory/lots?${params.toString()}`
      );
      setLotStateByKey((prev) => {
        const existing = append ? prev[key]?.items || [] : [];
        const merged = append ? mergeLots(existing, data.items || []) : (data.items || []);
        return {
          ...prev,
          [key]: {
            items: merged,
            nextCursor: data.nextCursor ?? null,
            isLoading: false,
            hasLoaded: true,
          },
        };
      });
    } catch (error: any) {
      setLotStateByKey((prev) => ({
        ...prev,
        [key]: {
          items: prev[key]?.items || [],
          nextCursor: prev[key]?.nextCursor ?? null,
          isLoading: false,
          hasLoaded: true, // Mark as loaded even on error to stop loop
        },
      }));
      toast({
        variant: "destructive",
        title: "Failed to load inventory lots",
        description: error?.message || "Unable to fetch lot data.",
      });
    }
  };

  useEffect(() => {
    if (!activeLotItem || fabricSource !== 'INTERNAL') return;
    const key = lotKey(activeLotItem.productId, activeLotItem.variantId);
    const existing = lotStateByKey[key];
    // Check if loading or ALREADY LOADED (even if empty) to return
    if (existing?.isLoading || existing?.hasLoaded) return;
    loadLotsForItem(activeLotItem);
  }, [activeLotItem, fabricSource, lotStateByKey]);

  const fabricBillSummary = useMemo(() => {
    let totalOrnaYards = 0;
    let totalJamaYards = 0;
    let totalSelowarYards = 0;
    let totalOrnaCost = 0;
    let totalJamaCost = 0;
    let totalSelowarCost = 0;

    orderItems.forEach(item => {
      const quantity = Number(item.quantity) || 0;
      const ornaYardsPerPiece = Number(item.ornaYards) || 0;
      const jamaYardsPerPiece = Number(item.jamaYards) || 0;
      const selowarYardsPerPiece = Number(item.selowarYards) || 0;

      const ornaTotalYards = quantity * ornaYardsPerPiece;
      const jamaTotalYards = quantity * jamaYardsPerPiece;
      const selowarTotalYards = quantity * selowarYardsPerPiece;

      totalOrnaYards += ornaTotalYards;
      totalJamaYards += jamaTotalYards;
      totalSelowarYards += selowarTotalYards;

      totalOrnaCost += ornaTotalYards * (Number(item.ornaRate) || 0);
      totalJamaCost += jamaTotalYards * (Number(item.jamaRate) || 0);
      totalSelowarCost += selowarTotalYards * (Number(item.selowarRate) || 0);
    });

    const grandTotalYards = totalOrnaYards + totalJamaYards + totalSelowarYards;
    const grandTotalCost = totalOrnaCost + totalJamaCost + totalSelowarCost;

    return {
      totalOrnaYards,
      totalJamaYards,
      totalSelowarYards,
      totalOrnaCost,
      totalJamaCost,
      totalSelowarCost,
      grandTotalYards,
      grandTotalCost,
    };
  }, [orderItems]);

  useEffect(() => {
    if (fabricSource !== 'INTERNAL') return;
    setOrderItems((prevItems) =>
      prevItems.map((item) => {
        const jamaRate = computeRateFromAllocations(item.lotAllocations.JAMA);
        const ornaRate = computeRateFromAllocations(item.lotAllocations.ORNA);
        const selowarRate = computeRateFromAllocations(item.lotAllocations.SELOWAR);
        const lineTotal =
          (Number(item.quantity) || 0) * (
            (Number(item.jamaYards) || 0) * (Number(jamaRate) || 0) +
            (Number(item.ornaYards) || 0) * (Number(ornaRate) || 0) +
            (Number(item.selowarYards) || 0) * (Number(selowarRate) || 0)
          );
        return { ...item, jamaRate, ornaRate, selowarRate, lineTotal };
      })
    );
  }, [fabricSource, inventoryLotMap]);

  const generalBillSummary = useMemo(() => {
    return generalOrderItems.reduce((acc, item) => acc + item.lineTotal, 0);
  }, [generalOrderItems]);

  const handleAddItem = () => {
    setOrderItems([...orderItems, { id: `item-${Date.now()}`, ...initialOrderItemState, lineTotal: 0, lotAllocations: emptyAllocations() }]);
  };

  const handleRemoveItem = (id: string) => {
    setOrderItems(orderItems.filter(item => item.id !== id));
  };

  const handleAddGeneralItem = () => {
    setGeneralOrderItems([...generalOrderItems, { id: `gen-item-${Date.now()}`, ...initialGeneralOrderItemState, lineTotal: 0 }]);
  };

  const handleRemoveGeneralItem = (id: string) => {
    setGeneralOrderItems(generalOrderItems.filter(item => item.id !== id));
  };

  const handleItemChange = (id: string, field: keyof Omit<ThreePieceOrderItem, 'id' | 'lineTotal'>, value: string | number) => {
    setOrderItems(prevItems => prevItems.map(item => {
      if (item.id === id) {
        let updatedItem = { ...item, [field]: value };

        if (field === 'productId') {
          const selectedProduct = allProducts.find(p => p.id === value);
          setAvailableVariants(prev => ({ ...prev, [id]: selectedProduct?.variants || [] }));
          updatedItem.variantId = undefined; // Reset variant selection
        }

        const lineTotal =
          (Number(updatedItem.quantity) || 0) * (
            (Number(updatedItem.jamaYards) || 0) * (Number(updatedItem.jamaRate) || 0) +
            (Number(updatedItem.ornaYards) || 0) * (Number(updatedItem.ornaRate) || 0) +
            (Number(updatedItem.selowarYards) || 0) * (Number(updatedItem.selowarRate) || 0)
          );
        return { ...updatedItem, lineTotal };
      }
      return item;
    }));
  };

  const computeRateFromAllocations = (allocations: LotAllocation[] = []) => {
    const totals = allocations.reduce(
      (acc, alloc) => {
        const lot = selectedLotsMap[alloc.inventoryItemId] || inventoryLotMap.get(alloc.inventoryItemId);
        const yards = Number(alloc.yards) || 0;
        if (!lot || yards <= 0) return acc;
        acc.yards += yards;
        acc.cost += yards * (Number(lot.unitCost) || 0);
        return acc;
      },
      { yards: 0, cost: 0 }
    );
    return totals.yards > 0 ? totals.cost / totals.yards : 0;
  };

  const updateLotAllocations = (itemId: string, part: FabricPartKey, updater: (prev: LotAllocation[]) => LotAllocation[]) => {
    setOrderItems(prevItems =>
      prevItems.map(item => {
        if (item.id !== itemId) return item;
        const nextAllocations = updater(item.lotAllocations[part]);
        const lotAllocations = { ...item.lotAllocations, [part]: nextAllocations };
        let jamaRate = item.jamaRate;
        let ornaRate = item.ornaRate;
        let selowarRate = item.selowarRate;
        if (fabricSource === 'INTERNAL') {
          jamaRate = computeRateFromAllocations(lotAllocations.JAMA);
          ornaRate = computeRateFromAllocations(lotAllocations.ORNA);
          selowarRate = computeRateFromAllocations(lotAllocations.SELOWAR);
        }
        const lineTotal =
          (Number(item.quantity) || 0) * (
            (Number(item.jamaYards) || 0) * (Number(jamaRate) || 0) +
            (Number(item.ornaYards) || 0) * (Number(ornaRate) || 0) +
            (Number(item.selowarYards) || 0) * (Number(selowarRate) || 0)
          );
        return {
          ...item,
          lotAllocations,
          jamaRate,
          ornaRate,
          selowarRate,
          lineTotal,
        };
      })
    );
  };

  const addLotAllocation = (itemId: string, part: FabricPartKey, lot: InventoryItem) => {
    // 1. Ensure the lot detail is saved in the global map (fixes "Unknown Lot")
    setSelectedLotsMap(prev => ({
      ...prev,
      [lot.id]: lot
    }));

    updateLotAllocations(itemId, part, (prev) => {
      if (prev.some((a) => a.inventoryItemId === lot.id)) return prev;
      return [...prev, { id: `alloc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, inventoryItemId: lot.id, yards: 0 }];
    });
  };

  const updateLotAllocationYards = (itemId: string, part: FabricPartKey, allocationId: string, yards: number) => {
    updateLotAllocations(itemId, part, (prev) =>
      prev.map((a) => (a.id === allocationId ? { ...a, yards } : a))
    );
  };

  const removeLotAllocation = (itemId: string, part: FabricPartKey, allocationId: string) => {
    updateLotAllocations(itemId, part, (prev) => prev.filter((a) => a.id !== allocationId));
  };

  const getLotsForItem = (itemId: string) => {
    const item = orderItems.find((entry) => entry.id === itemId);
    if (!item) return [];
    const key = lotKey(item.productId, item.variantId);
    return lotStateByKey[key]?.items || [];
  };

  const handleScanLot = async (itemId: string, part: FabricPartKey, lotNumber: string) => {
    const trimmed = lotNumber.trim();
    if (!trimmed) return;

    // 1. Try local cache first
    let matches = getLotsForItem(itemId).filter(
      (lot) => lot.lotNumber.toLowerCase() === trimmed.toLowerCase()
    );

    // 2. Fallback to Server Search
    if (matches.length === 0) {
      try {
        const data = await fetchApi<{ items: InventoryItem[] }>(`/api/inventory/lots?pageSize=5&search=${encodeURIComponent(trimmed)}`);
        if (data.items && data.items.length > 0) {
          // Filter for exact match on lotNumber to be safe, or take the best one
          const exact = data.items.find(l => l.lotNumber.toLowerCase() === trimmed.toLowerCase());
          if (exact) matches = [exact];
        }
      } catch (error) {
        console.error("Lot lookup failed", error);
      }
    }

    if (matches.length === 0) {
      toast({ variant: "destructive", title: "Lot not found", description: "No matching lot number in inventory." });
      return;
    }
    if (matches.length > 1) {
      toast({
        variant: "destructive",
        title: "Multiple lots found",
        description: "This lot number exists for multiple products. Please select the correct lot from the list.",
      });
      return;
    }
    addLotAllocation(itemId, part, matches[0]);
    setScanInputs((prev) => ({ ...prev, [`${itemId}-${part}`]: '' }));
  };

  const handleGeneralItemChange = (id: string, field: keyof Omit<GeneralOrderItem, 'id' | 'lineTotal'>, value: string | number) => {
    setGeneralOrderItems(prevItems => prevItems.map(item => {
      if (item.id === id) {
        let updatedItem = { ...item, [field]: value };

        if (field === 'productId') {
          const selectedProduct = allProducts.find(p => p.id === value);
          setAvailableVariants(prev => ({ ...prev, [id]: selectedProduct?.variants || [] }));
          updatedItem.variantId = undefined; // Reset variant
        }

        const lineTotal = (Number(updatedItem.quantity) || 0) * (Number(updatedItem.unitCost) || 0);
        return { ...updatedItem, lineTotal };
      }
      return item;
    }));
  };

  /* Payment handlers removed */

  const calculateDue = (totalCost: number, payments: PurchasePaymentItem[]) => {
    const paid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    return totalCost - paid;
  };

  // const fabricDue = ... 
  // const generalDue = ...

  const handleCreatePurchase = async () => {
    if (purchaseType === 'three-piece' && fabricSource !== 'INTERNAL' && !selectedSupplierId) {
      toast({ variant: "destructive", title: "Supplier required", description: "Please select a supplier." });
      return;
    }
    if (purchaseType === 'three-piece' && !selectedPrintingVendorId) {
      toast({ variant: "destructive", title: "Printing vendor required", description: "Please select a printing vendor." });
      return;
    }

    const requiresVariant = (productId: string) => {
      const product = allProducts.find((p) => p.id === productId);
      return (product?.variants?.length || 0) > 0;
    };

    const invalidItem = purchaseType === 'general'
      ? generalOrderItems.find(item => !item.productId || item.quantity <= 0 || item.unitCost <= 0 || (requiresVariant(item.productId) && !item.variantId))
      : orderItems.find(item => !item.productId || item.quantity <= 0 || (requiresVariant(item.productId) && !item.variantId));

    if (invalidItem) {
      toast({
        variant: "destructive",
        title: "Invalid items",
        description:
          purchaseType === "general"
            ? "Please select product/variant, quantity and unit cost for every item."
            : "Please select product/variant and quantity for every item.",
      });
      return;
    }



    if (purchaseType === 'three-piece' && fabricSource === 'INTERNAL') {
      const invalidAllocation = orderItems.find((item) => {
        const checks: Array<{ part: FabricPartKey; required: number }> = [
          { part: 'JAMA', required: (Number(item.quantity) || 0) * (Number(item.jamaYards) || 0) },
          { part: 'ORNA', required: (Number(item.quantity) || 0) * (Number(item.ornaYards) || 0) },
          { part: 'SELOWAR', required: (Number(item.quantity) || 0) * (Number(item.selowarYards) || 0) },
        ];
        return checks.some(({ part, required }) => {
          const allocated = item.lotAllocations[part].reduce((sum: number, alloc: LotAllocation) => sum + (Number(alloc.yards) || 0), 0);
          return Math.abs(allocated - required) > 0.01;
        });
      });

      if (invalidAllocation) {
        toast({
          variant: "destructive",
          title: "Lot allocation mismatch",
          description: "Allocated yards must exactly match Jama/Orna/Selowar yards for each item.",
        });
        return;
      }
    }

    setIsCreating(true);

    const payload = {
      type: purchaseType,
      supplierId: purchaseType === 'general' || fabricSource === 'EXTERNAL' ? selectedSupplierId : '',
      items: purchaseType === 'general'
        ? generalOrderItems
        : orderItems.map((item) => ({
          ...item,
          lotAllocations: fabricSource === 'INTERNAL'
            ? (Object.entries(item.lotAllocations as LotAllocationsByPart).flatMap(([part, allocations]) =>
              (allocations as LotAllocation[])
                .filter((alloc) => (Number(alloc.yards) || 0) > 0)
                .map((alloc) => ({
                  part: part as FabricPartKey,
                  inventoryItemId: alloc.inventoryItemId,
                  yards: Number(alloc.yards) || 0,
                }))
            ))
            : [],
        })),
      payments: [],
      printingVendorId: purchaseType === 'three-piece' ? (selectedPrintingVendorId || undefined) : undefined,
      pindiOfFab: undefined,
      fabricSource: purchaseType === 'three-piece' ? fabricSource : undefined,
      fabricInventoryId: undefined,
    };

    try {
      const result = await createPurchaseOrderClient(payload);

      if (result.success && result.poId) {
        toast({
          title: "Purchase Order Created",
          description: `PO #${result.poId} has been successfully created.`,
        });
        router.push(`/dashboard/purchases/${result.poId}`);
      } else {
        toast({
          variant: "destructive",
          title: "Creation Failed",
          description: result.message || "An unknown error occurred.",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Creation Failed",
        description: error?.message || "An unknown error occurred.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading...</div>
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:gap-8 lg:p-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-6">
        <div className="space-y-1.5">
          <h1 className="font-headline text-2xl font-bold tracking-tight sm:text-3xl">
            Create Purchase Order
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Create a new production batch or record a purchase from suppliers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" asChild size="default" className="w-full sm:w-auto">
            <Link href="/dashboard/purchases">Cancel</Link>
          </Button>
          <Button onClick={handleCreatePurchase} disabled={isCreating} size="default" className="w-full sm:w-auto shadow-md">
            {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {isCreating ? 'Creating...' : 'Create Order'}
          </Button>
        </div>
      </div>

      <Card className="border-muted/60 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium">Purchase Type</CardTitle>
          <CardDescription>Select the type of purchase order you want to create.</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={purchaseType} onValueChange={(value: PurchaseType) => setPurchaseType(value)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Label htmlFor="three-piece" className="flex flex-col gap-2 rounded-xl border border-muted p-4 hover:border-primary/50 hover:bg-accent/50 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5 cursor-pointer transition-all">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="three-piece" id="three-piece" />
                <span className="font-semibold text-base">Three-Piece Production</span>
              </div>
              <p className="text-sm text-muted-foreground pl-6 leading-relaxed">
                Order raw fabric for manufacturing three-piece suits. Calculates fabric needs based on product specifications.
              </p>
            </Label>
            <Label htmlFor="general" className="flex flex-col gap-2 rounded-xl border border-muted p-4 hover:border-primary/50 hover:bg-accent/50 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5 cursor-pointer transition-all">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="general" id="general" />
                <span className="font-semibold text-base">General Purchase</span>
              </div>
              <p className="text-sm text-muted-foreground pl-6 leading-relaxed">
                Purchase ready-made products directly from a supplier. Ideal for items that do not require production.
              </p>
            </Label>
          </RadioGroup>
        </CardContent>
      </Card>


      {purchaseType === 'three-piece' && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 mt-6">
          <div className="lg:col-span-8 xl:col-span-9 space-y-6">
            <Card className="border-muted/60 shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/10 pb-4">
                <CardTitle className="text-lg">Fabric Order Details</CardTitle>
                <CardDescription>Select products/variants, enter planned quantity and fabric yards + rate for Jama/Orna/Selowar.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="space-y-4 sm:hidden p-4">
                  {orderItems.map((item, idx) => (
                    <div key={item.id} className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="font-semibold text-sm">Item #{idx + 1}</span>
                        {orderItems.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveItem(item.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-[60px_1fr] gap-4">
                        <div className="aspect-square relative rounded-md overflow-hidden bg-muted/20 border">
                          {allProducts.find(p => p.id === item.productId)?.image ? (
                            <img
                              src={allProducts.find(p => p.id === item.productId)?.image || ''}
                              alt="Product"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground/20">
                              <Layers className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-3">
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Product</Label>
                            <div className="font-medium text-sm leading-tight">{allProducts.find(p => p.id === item.productId)?.name || 'Unknown'}</div>
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Variant</Label>
                            <div className="text-sm">
                              {item.variantId
                                ? getVariantLabel(
                                  allProducts.find(p => p.id === item.productId)?.variants?.find(v => v.id === item.variantId),
                                  allProducts.find(p => p.id === item.productId)?.name
                                )
                                : '-'}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Qty (pcs)</Label>
                          <Input type="number" className="h-8" value={item.quantity || ''} onChange={(e) => handleItemChange(item.id, 'quantity', parseInt(e.target.value) || 0)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Line Total</Label>
                          <div className="h-8 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-mono text-right justify-end">
                            {fmtMoney(Number(item.lineTotal) || 0)}
                          </div>
                        </div>
                      </div>

                      <Separator />

                      <div className="space-y-3">
                        {['Jama', 'Orna', 'Selowar'].map((part) => (
                          <div key={part} className="space-y-2">
                            <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{part}</span>
                            <div className="grid grid-cols-2 gap-2">
                              <Input
                                className="h-8 text-xs"
                                placeholder="Yards"
                                type="number"
                                value={(item as any)[`${part.toLowerCase()}Yards`] || ''}
                                onChange={(e) => handleItemChange(item.id, `${part.toLowerCase()}Yards` as any, parseFloat(e.target.value) || 0)}
                              />
                              <Input
                                className="h-8 text-xs"
                                placeholder="Rate"
                                type="number"
                                value={(item as any)[`${part.toLowerCase()}Rate`] || ''}
                                onChange={(e) => handleItemChange(item.id, `${part.toLowerCase()}Rate` as any, parseFloat(e.target.value) || 0)}
                                disabled={fabricSource === 'INTERNAL'}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {fabricSource === 'INTERNAL' && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full text-xs"
                          onClick={() => setLotDialogItemId(item.id)}
                        >
                          Allocate Lots
                        </Button>
                      )}
                    </div>
                  ))}
                  {orderItems.length === 0 && <div className="text-center py-6 text-muted-foreground bg-muted/20 rounded-lg border-2 border-dashed">No items added. Click "Add Products" to start.</div>}
                </div>

                <div className="hidden w-full overflow-x-auto sm:block">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="w-[60px]">Image</TableHead>
                        <TableHead className="w-[180px]">Product</TableHead>
                        <TableHead className="w-[120px]">Variant</TableHead>
                        <TableHead className="w-[80px]">Qty</TableHead>
                        <TableHead className="text-center w-[160px] border-l">Jama (Yd / Rate)</TableHead>
                        <TableHead className="text-center w-[160px] border-l">Orna (Yd / Rate)</TableHead>
                        <TableHead className="text-center w-[160px] border-l">Selowar (Yd / Rate)</TableHead>
                        <TableHead className="text-right w-[100px]">Total</TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderItems.map((item) => (
                        <TableRow key={item.id} className="group">
                          <TableCell className="align-top py-4">
                            <div className="h-10 w-10 rounded-md overflow-hidden border bg-muted/20">
                              {allProducts.find(p => p.id === item.productId)?.image && (
                                <img
                                  src={allProducts.find(p => p.id === item.productId)?.image || ''}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium align-top py-4">
                            <div className="line-clamp-2" title={allProducts.find(p => p.id === item.productId)?.name}>{allProducts.find(p => p.id === item.productId)?.name || 'Unknown Identifier'}</div>
                          </TableCell>
                          <TableCell className="align-top py-4">
                            <div className="text-sm text-muted-foreground">
                              {item.variantId
                                ? getVariantLabel(
                                  allProducts.find(p => p.id === item.productId)?.variants?.find(v => v.id === item.variantId),
                                  allProducts.find(p => p.id === item.productId)?.name
                                )
                                : '-'}
                            </div>
                          </TableCell>
                          <TableCell className="align-top py-4">
                            <Input className="h-8 w-16" type="number" value={item.quantity || ''} onChange={(e) => handleItemChange(item.id, 'quantity', parseInt(e.target.value) || 0)} />
                          </TableCell>

                          <TableCell className="border-l bg-muted/5 align-top py-4 px-2">
                            <div className="grid grid-cols-2 gap-1">
                              <Input className="h-7 px-1 text-center text-xs" placeholder="Yds" type="number" value={item.jamaYards || ''} onChange={(e) => handleItemChange(item.id, 'jamaYards', parseFloat(e.target.value) || 0)} />
                              <Input className="h-7 px-1 text-center text-xs" placeholder="Rate" type="number" disabled={fabricSource === 'INTERNAL'} value={item.jamaRate || ''} onChange={(e) => handleItemChange(item.id, 'jamaRate', parseFloat(e.target.value) || 0)} />
                            </div>
                          </TableCell>
                          <TableCell className="border-l bg-muted/5 align-top py-4 px-2">
                            <div className="grid grid-cols-2 gap-1">
                              <Input className="h-7 px-1 text-center text-xs" placeholder="Yds" type="number" value={item.ornaYards || ''} onChange={(e) => handleItemChange(item.id, 'ornaYards', parseFloat(e.target.value) || 0)} />
                              <Input className="h-7 px-1 text-center text-xs" placeholder="Rate" type="number" disabled={fabricSource === 'INTERNAL'} value={item.ornaRate || ''} onChange={(e) => handleItemChange(item.id, 'ornaRate', parseFloat(e.target.value) || 0)} />
                            </div>
                          </TableCell>
                          <TableCell className="border-l bg-muted/5 align-top py-4 px-2">
                            <div className="grid grid-cols-2 gap-1">
                              <Input className="h-7 px-1 text-center text-xs" placeholder="Yds" type="number" value={item.selowarYards || ''} onChange={(e) => handleItemChange(item.id, 'selowarYards', parseFloat(e.target.value) || 0)} />
                              <Input className="h-7 px-1 text-center text-xs" placeholder="Rate" type="number" disabled={fabricSource === 'INTERNAL'} value={item.selowarRate || ''} onChange={(e) => handleItemChange(item.id, 'selowarRate', parseFloat(e.target.value) || 0)} />
                            </div>
                          </TableCell>

                          <TableCell className="text-right font-mono font-medium align-top py-4">
                            {fmtMoney(Number(item.lineTotal) || 0)}
                          </TableCell>
                          <TableCell className="text-right align-top py-4">
                            <div className="flex flex-col gap-2 items-end">
                              {fabricSource === 'INTERNAL' && (
                                <Button variant="outline" size="sm" className="h-7 text-[10px] w-full" onClick={() => setLotDialogItemId(item.id)}>Lots</Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                onClick={() => handleRemoveItem(item.id)}
                                title="Remove Item"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {orderItems.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                            No items added yet. Click "Add Products" below.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="p-4 border-t bg-muted/5">
                  <PurchaseProductAddDialog
                    allProducts={allProducts}
                    existingSelections={orderItems.filter(i => i.productId).map(i => ({ productId: i.productId, variantId: i.variantId || null }))}
                    onAdd={(product, vid) => {
                      setAllProducts(prev => prev.some(p => p.id === product.id) ? prev : [...prev, product]);
                      const newItem: ThreePieceOrderItem = {
                        id: `item-${Date.now()}-${Math.random()}`,
                        productId: product.id,
                        variantId: vid || undefined,
                        quantity: 0,
                        jamaYards: 0,
                        jamaRate: 0,
                        ornaYards: 0,
                        ornaRate: 0,
                        selowarYards: 0,
                        selowarRate: 0,
                        printingCost: 0,
                        cuttingCost: 0,
                        lineTotal: 0,
                        lotAllocations: emptyAllocations()
                      };
                      setOrderItems(prev => [...prev, newItem as ThreePieceOrderItemDraft]);
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 lg:col-span-4 xl:col-span-3">
            <Card className="border-muted/60 shadow-sm">
              <CardHeader className="bg-muted/10 pb-4">
                <CardTitle className="text-lg">Fabric Bill & Source</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6 p-6">
                <div className="hidden">
                  {/* External Source Removed - Enforcing Internal */}
                </div>

                {fabricSource === 'EXTERNAL' ? (
                  <>
                    <div className="space-y-3">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Supplier</Label>
                      <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select Supplier" /></SelectTrigger>
                        <SelectContent>{allSuppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Printing Vendor</Label>
                      <Select value={selectedPrintingVendorId} onValueChange={setSelectedPrintingVendorId}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select Vendor" /></SelectTrigger>
                        <SelectContent>{allVendors.filter(v => v.type.toLowerCase().includes('print')).map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>



                    <Separator className="my-2" />

                    <Separator className="my-2" />

                    <div className="pt-4 mt-2 border-t space-y-2">
                      <div className="space-y-2 text-sm bg-muted/30 p-3 rounded-md">
                        <div className="flex justify-between text-xs text-muted-foreground"><span className="w-16">Jama:</span> <span className="text-right">{fabricBillSummary.totalJamaYards.toFixed(1)} yds</span> <span className="font-mono">{fmtMoney(fabricBillSummary.totalJamaCost)}</span></div>
                        <div className="flex justify-between text-xs text-muted-foreground"><span className="w-16">Orna:</span> <span className="text-right">{fabricBillSummary.totalOrnaYards.toFixed(1)} yds</span> <span className="font-mono">{fmtMoney(fabricBillSummary.totalOrnaCost)}</span></div>
                        <div className="flex justify-between text-xs text-muted-foreground"><span className="w-16">Selowar:</span> <span className="text-right">{fabricBillSummary.totalSelowarYards.toFixed(1)} yds</span> <span className="font-mono">{fmtMoney(fabricBillSummary.totalSelowarCost)}</span></div>
                        <Separator className="my-1" />
                        <div className="flex justify-between font-bold text-base"><span className="w-16">Total:</span> <span className="text-right">{fabricBillSummary.grandTotalYards.toFixed(1)} yds</span> <span className="font-mono">{fmtMoney(fabricBillSummary.grandTotalCost)}</span></div>
                      </div>
                      <div className="text-[10px] text-muted-foreground italic mt-2 text-center">
                        Note: Fabric payments can be recorded after creation via the Partner profile.
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-md bg-blue-50 p-4 text-xs text-blue-700 border border-blue-100">
                      <p className="font-semibold mb-1 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
                        Internal Stock Transfer
                      </p>
                      Items will be deducted from your warehouse inventory. Use the "Lots" button on each item to specify which lots to use.
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Printing Vendor</Label>
                      <Select value={selectedPrintingVendorId} onValueChange={setSelectedPrintingVendorId}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select Vendor" /></SelectTrigger>
                        <SelectContent>{allVendors.filter(v => v.type.toLowerCase().includes('print')).map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {purchaseType === 'general' && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 mt-6">
          <div className="lg:col-span-8 xl:col-span-9 space-y-6">
            <Card className="border-muted/60 shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/10 pb-4">
                <CardTitle className="text-lg">General Purchase Details</CardTitle>
                <CardDescription>Add the ready-made products you are purchasing.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="space-y-4 sm:hidden p-4">
                  {generalOrderItems.map((item, idx) => (
                    <div key={item.id} className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="font-semibold text-sm">Item #{idx + 1}</span>
                        {generalOrderItems.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveGeneralItem(item.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-[60px_1fr] gap-4">
                        <div className="aspect-square relative rounded-md overflow-hidden bg-muted/20 border">
                          {allProducts.find(p => p.id === item.productId)?.image ? (
                            <img
                              src={allProducts.find(p => p.id === item.productId)?.image || ''}
                              alt="Product"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground/20">
                              <Layers className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-3">
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Product</Label>
                            <div className="font-medium text-sm leading-tight">{allProducts.find(p => p.id === item.productId)?.name || 'Unknown'}</div>
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Variant</Label>
                            <div className="text-sm">
                              {(() => {
                                const product = allProducts.find(p => p.id === item.productId);
                                if (!item.variantId || !product) return 'N/A';
                                const variant = product.variants?.find(v => v.id === item.variantId);
                                return getVariantLabel(variant, product.name);
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Qty</Label>
                          <Input type="number" className="h-8" value={item.quantity || ''} onChange={e => handleGeneralItemChange(item.id, 'quantity', parseInt(e.target.value) || 0)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Unit Cost</Label>
                          <Input type="number" className="h-8" value={item.unitCost || ''} onChange={e => handleGeneralItemChange(item.id, 'unitCost', parseFloat(e.target.value) || 0)} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-2 border-t mt-2">
                        <span className="text-muted-foreground font-medium">Line Total</span>
                        <span className="font-mono font-bold">{fmtMoney(Number(item.lineTotal) || 0)}</span>
                      </div>
                    </div>
                  ))}
                  {generalOrderItems.length === 0 && <div className="text-center py-6 text-muted-foreground bg-muted/20 rounded-lg border-2 border-dashed">No items added. Click "Add Products" to start.</div>}
                </div>

                <div className="hidden w-full overflow-x-auto sm:block">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="w-[60px]">Image</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Variant</TableHead>
                        <TableHead className="w-[120px]">Quantity</TableHead>
                        <TableHead className="w-[140px]">Unit Cost</TableHead>
                        <TableHead className="text-right">Line Total</TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {generalOrderItems.map(item => (
                        <TableRow key={item.id} className="group">
                          <TableCell className="align-middle">
                            <div className="h-10 w-10 rounded-md overflow-hidden border bg-muted/20">
                              {allProducts.find(p => p.id === item.productId)?.image && (
                                <img
                                  src={allProducts.find(p => p.id === item.productId)?.image || ''}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium align-middle">
                            <div className="line-clamp-2" title={allProducts.find(p => p.id === item.productId)?.name}>{allProducts.find(p => p.id === item.productId)?.name || 'Unknown Product'}</div>
                          </TableCell>
                          <TableCell className="align-middle">
                            <div className="text-sm text-muted-foreground">
                              {(() => {
                                const product = allProducts.find(p => p.id === item.productId);
                                if (!item.variantId || !product) return 'N/A';
                                const variant = product.variants?.find(v => v.id === item.variantId);
                                return getVariantLabel(variant, product.name);
                              })()}
                            </div>
                          </TableCell>
                          <TableCell className="align-middle">
                            <Input className="h-9 w-24" type="number" value={item.quantity || ''} onChange={e => handleGeneralItemChange(item.id, 'quantity', parseInt(e.target.value) || 0)} />
                          </TableCell>
                          <TableCell className="align-middle">
                            <Input className="h-9 w-28" type="number" value={item.unitCost || ''} onChange={e => handleGeneralItemChange(item.id, 'unitCost', parseFloat(e.target.value) || 0)} />
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium align-middle">{fmtMoney(Number(item.lineTotal) || 0)}</TableCell>
                          <TableCell className="text-right align-middle">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-destructive hover:bg-destructive/10"
                              onClick={() => handleRemoveGeneralItem(item.id)}
                              title="Remove Item"
                            >
                              <Trash2 className="h-5 w-5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-primary opacity-50 group-hover:opacity-100" onClick={() => setPindaDialogItemId(item.id)} title="Configure Pinda/Rolls">
                              <Layers className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {generalOrderItems.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                            No items added yet. Click &quot;Add Products&quot; below.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="p-4 border-t bg-muted/5">
                  <PurchaseProductAddDialog
                    allProducts={allProducts}
                    existingSelections={generalOrderItems.filter(i => i.productId).map(i => ({ productId: i.productId, variantId: i.variantId || null }))}
                    onAdd={(product, vid) => {
                      setAllProducts(prev => prev.some(p => p.id === product.id) ? prev : [...prev, product]);
                      const newItem: GeneralOrderItem = {
                        id: `gen-item-${Date.now()}-${Math.random()}`,
                        productId: product.id,
                        variantId: vid || undefined,
                        quantity: 0,
                        unitCost: 0,
                        lineTotal: 0
                      };
                      setGeneralOrderItems(prev => [...prev, newItem]);
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 lg:col-span-4 xl:col-span-3">
            <Card className="border-muted/60 shadow-sm">
              <CardHeader className="bg-muted/10 pb-4">
                <CardTitle className="text-lg">General Purchase Bill</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6 p-6">
                <div className="space-y-3">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Supplier</Label>
                  <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select a supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {allSuppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <Separator className="my-2" />

                <div className="pt-4 mt-2 border-t space-y-2">
                  <div className="flex justify-between text-base">
                    <span className="text-muted-foreground uppercase text-xs font-semibold tracking-wider">Total Bill</span>
                    <span className="font-bold font-mono text-xl">{fmtMoney(generalBillSummary)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground italic mt-2 text-center">
                    Note: Payments can be recorded after creation via the Partner profile.
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {fabricSource === 'INTERNAL' && (
        <Dialog open={!!lotDialogItemId} onOpenChange={(open) => !open && setLotDialogItemId(null)}>
          <DialogContent className="w-[95vw] max-h-[90vh] flex flex-col sm:max-w-3xl overflow-hidden p-0">
            <div className="flex-none p-6 pb-2">
              <DialogHeader>
                <DialogTitle>Fabric Lot Allocation</DialogTitle>
                <DialogDescription>
                  Allocate lots for Jama, Orna, and Selowar. Allocated yards must match the planned yards.
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
              {activeLotItem ? (
                <div className="space-y-4">
                  <div className="rounded-md border p-3 text-sm">
                    <div className="font-medium">
                      {allProducts.find((p) => p.id === activeLotItem.productId)?.name || 'Product'}
                    </div>
                    {activeLotItem.variantId && (
                      <div className="text-xs text-muted-foreground">
                        {allProducts
                          .find((p) => p.id === activeLotItem.productId)
                          ?.variants?.find((v) => v.id === activeLotItem.variantId)?.name || 'Variant'}
                      </div>
                    )}
                  </div>
                  {(isActiveLotLoading || activeLotItems.length === 0 || activeLotNextCursor) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {isActiveLotLoading
                          ? 'Loading lots...'
                          : activeLotItems.length === 0
                            ? 'No lots available for this item.'
                            : ''}
                      </span>
                      {activeLotNextCursor && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => activeLotItem && loadLotsForItem(activeLotItem, { append: true })}
                          disabled={isActiveLotLoading}
                        >
                          Load more lots
                        </Button>
                      )}
                    </div>
                  )}
                  {lotPartConfigs.map((part) => {
                    const quantity = activeLotItem.quantity || 0;
                    const yardsPerPiece = Number((activeLotItem as any)[part.yardsKey]) || 0;
                    const required = quantity * yardsPerPiece;
                    const allocations = activeLotItem.lotAllocations[part.key] as LotAllocation[];
                    const allocated = allocations.reduce((sum: number, alloc: LotAllocation) => sum + (Number(alloc.yards) || 0), 0);
                    const mismatch = allocated !== required;
                    return (
                      <div key={part.key} className="rounded-md border p-3 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">{part.label}</div>
                          <div className={mismatch ? "text-xs text-destructive font-semibold" : "text-xs text-muted-foreground"}>
                            Required: {required} yds ({quantity} pcs × {yardsPerPiece} yd) / Allocated: {allocated} yds
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <LotSelectionCombobox
                            itemId={activeLotItem.id}
                            part={part.key}
                            localInventoryLots={activeLotItems}
                            onSelect={(lot) => addLotAllocation(activeLotItem.id, part.key, lot)}
                            formatLotLabel={formatLotLabel}
                          />
                        </div>
                        {allocations.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No lots selected yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {allocations.map((alloc) => {
                              const lot = selectedLotsMap[alloc.inventoryItemId] || inventoryLotMap.get(alloc.inventoryItemId);

                              // Calculate total used for this lot across ALL parts for this item
                              const totalUsedAllParts = (['JAMA', 'ORNA', 'SELOWAR'] as const).reduce((sum: number, key: 'JAMA' | 'ORNA' | 'SELOWAR') => {
                                const allocations = (activeLotItem.lotAllocations[key] as LotAllocation[]) || [];
                                const lotAllocations = allocations.filter((a: LotAllocation) => a.inventoryItemId === alloc.inventoryItemId);
                                return sum + lotAllocations.reduce((s: number, a: LotAllocation) => s + (Number(a.yards) || 0), 0);
                              }, 0);

                              const totalStock = lot?.quantity || 0;
                              const usedOthers = totalUsedAllParts - (Number(alloc.yards) || 0);
                              const effectiveAvailable = Math.max(0, totalStock - usedOthers);

                              const isExceeded = (alloc.yards || 0) > effectiveAvailable;

                              return (
                                <div key={alloc.id} className={cn(
                                  "flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center",
                                  isExceeded ? "border-destructive/50 bg-destructive/5" : "bg-muted/30 border-border"
                                )}>
                                  <div className="flex-1 text-xs">
                                    <div className="font-medium flex items-center gap-2">
                                      {lot?.lotNumber || 'Unknown Lot'}
                                      <span className={cn(
                                        "text-[10px] px-1.5 py-0.5 rounded-full border",
                                        isExceeded ? "bg-white text-destructive border-destructive" : "bg-background text-muted-foreground border-border"
                                      )}>
                                        Available: {effectiveAvailable}
                                      </span>
                                    </div>
                                    <div className="text-xs font-medium text-right">
                                      Total: {allocations.reduce((s: number, a: LotAllocation) => s + (Number(a.yards) || 0), 0).toFixed(2)}y / {required.toFixed(2)}y
                                    </div>
                                    <div className="text-muted-foreground mt-0.5">
                                      {formatLotName(lot)} ({lot?.sku}) - {lot?.locationName}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number"
                                      className={cn(
                                        "w-24 bg-background",
                                        isExceeded && "border-destructive text-destructive focus-visible:ring-destructive"
                                      )}
                                      value={alloc.yards}
                                      min={0}
                                      step={1}
                                      onChange={(e) => updateLotAllocationYards(activeLotItem.id, part.key, alloc.id, Number(e.target.value) || 0)}
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => removeLotAllocation(activeLotItem.id, part.key, alloc.id)}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Select an item to allocate lots.</div>
              )}
            </div>
            <div className="flex-none p-6 pt-2 border-t">
              <DialogFooter>
                <Button type="button" onClick={() => setLotDialogItemId(null)}>Done</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Pinda Configuration Dialog */}
      <Dialog open={!!pindaDialogItemId} onOpenChange={(open) => !open && setPindaDialogItemId(null)}>
        <DialogContent className="sm:max-w-[425px] overflow-hidden max-h-[90vh] flex flex-col p-0">
          <div className="flex-none p-6 pb-2">
            <DialogHeader>
              <DialogTitle>Configure Pinda/Rolls</DialogTitle>
              <DialogDescription>
                Specify the number of rolls (pindas) and the quantity in each roll. The total quantity will be updated automatically.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
            {activePindaItem && (
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="pinda-count" className="text-right">
                    Count
                  </Label>
                  <Input
                    id="pinda-count"
                    type="number"
                    value={activePindaItem.pindaCount || ''}
                    onChange={(e) => {
                      const count = parseInt(e.target.value) || 0;
                      // Initialize quantities array with 0s or existing values resized
                      const current = activePindaItem.pindaQuantities || [];
                      const newQuantities = Array(count).fill(0).map((_, i) => current[i] || 0);
                      updatePindaConfig(count, newQuantities);
                    }}
                    className="col-span-3"
                    placeholder="Number of rolls"
                  />
                </div>

                {(activePindaItem.pindaCount || 0) > 0 && (
                  <div className="max-h-[300px] overflow-y-auto space-y-2 border rounded-md p-2">
                    {Array.from({ length: activePindaItem.pindaCount || 0 }).map((_, idx) => (
                      <div key={idx} className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right text-xs text-muted-foreground">
                          Roll #{idx + 1}
                        </Label>
                        <Input
                          type="number"
                          value={activePindaItem.pindaQuantities?.[idx] || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const newQuantities = [...(activePindaItem.pindaQuantities || [])];
                            newQuantities[idx] = val;
                            updatePindaConfig(activePindaItem.pindaCount || 0, newQuantities);
                          }}
                          className="col-span-3 h-8"
                          placeholder="Qty"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end pt-2 border-t">
                  <div className="text-sm font-medium">
                    Total Quantity: <span className="font-mono ml-2">{activePindaItem.quantity}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-none p-6 pt-2 border-t">
            <DialogFooter>
              <Button onClick={() => setPindaDialogItemId(null)}>Done</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
