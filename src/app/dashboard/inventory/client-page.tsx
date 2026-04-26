'use client';

import { MoreHorizontal, Package, CircleDollarSign, TrendingUp, BarChart, Search, Loader2, ChevronDown, ChevronRight, History, ListTree, Check, ChevronsUpDown, AlertCircle } from "lucide-react";
import * as React from "react";
import Link from 'next/link';
import Image from 'next/image';

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList, // Add CommandList if available in your UI lib, otherwise omit or use grouping
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getInventory, getStockLocations, getInventoryStatsWrapper, InventoryItemWithSourceIds } from "@/services/inventory";
import { getProductsPaged, getComboProductsPaginated } from "@/services/products";
import { adjustStock, transferStock } from "./actions";
import type { InventoryItem, Product, InventoryMovement, StockLocation } from "@/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Separator } from "@/components/ui/separator";

// Stats Type
type Stats = {
  active: number;
  lowStock: number;
  lowStockAvailable: number;
  outOfStock: number;
  all: number;
  totalItems: number;
  totalCostValue: number;
  totalSaleValue: number;
  potentialProfit: number;
};

type DialogMode = 'movement' | 'viewMovement' | 'stock' | null;

type DialogState = {
  isOpen: boolean;
  mode: DialogMode;
  selectedItem: InventoryItem | null;
};

const DEFAULT_PLACEHOLDER = '/placeholder.svg';

const fetchApi = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP error! status: ${res.status}`);
  }
  if (json.success && json.data !== undefined) {
    return json.data as T;
  }
  return json as T;
};

// Search Combo Component
// Search Combo Component
function ProductSearchCombo({ value, onChange, selectedName }: { value: string; onChange: (val: string, product: Product) => void; selectedName?: string }) {
  const [open, setOpen] = React.useState(false);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fall back to product search
        const res = await getProductsPaged({ search, pageSize: 50 });
        if (res) {
          setProducts(res.items || []);
          setNextCursor(res.nextCursor || null);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    const t = setTimeout(fetchData, 300);
    return () => clearTimeout(t);
  }, [open, search]);

  const loadMore = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await getProductsPaged({ search, pageSize: 50, cursor: nextCursor });
      if (res) {
        setProducts(prev => {
          const existing = new Set(prev.map(p => p.id));
          const newItems = (res.items || []).filter(p => !existing.has(p.id));
          return [...prev, ...newItems];
        });
        setNextCursor(res.nextCursor || null);
      }
    } catch (e) { console.error(e); }
    setLoadingMore(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {value ? (selectedName || "Loading...") : "Select product..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search product..." value={search} onValueChange={setSearch} />
          <CommandList>
            {loading && <div className="py-6 text-center text-sm"><Loader2 className="animate-spin h-4 w-4 mx-auto" /></div>}
            {!loading && products.length === 0 && <CommandEmpty>No product found.</CommandEmpty>}
            {products.map((product) => (
              <CommandItem
                key={product.id}
                value={product.id}
                onSelect={() => {
                  onChange(product.id, product);
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", value === product.id ? "opacity-100" : "opacity-0")} />
                {product.name}
              </CommandItem>
            ))}
            {nextCursor && (
              <div className="p-2 border-t text-center">
                <Button variant="ghost" size="sm" onClick={loadMore} disabled={loadingMore} className="w-full h-8 text-xs">
                  {loadingMore ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                  Load More
                </Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function InventoryProductPickerDialog({
  onSelect,
  trigger
}: {
  onSelect: (product: InventoryItem, variant?: { id: string, name: string }, meta?: { fromLotScan?: boolean }) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [items, setItems] = React.useState<InventoryItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [selectedLocationId, setSelectedLocationId] = React.useState('all');
  const [locations, setLocations] = React.useState<StockLocation[]>([]);
  const [lotScanResult, setLotScanResult] = React.useState<any>(null);

  // Fetch locations for filter
  React.useEffect(() => {
    if (open && locations.length === 0) {
      getStockLocations().then(setLocations).catch(console.error);
    }
  }, [open, locations.length]);

  // Try lot scan when search changes - auto select on unique match
  React.useEffect(() => {
    if (!open || !search.trim()) {
      setLotScanResult(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const lotRes = await fetchApi<{ items: InventoryItem[] }>(`/api/inventory/lots?search=${encodeURIComponent(search)}&pageSize=5`);
        const lots = lotRes?.items || [];
        if (lots.length === 1) {
          const lot = lots[0];
          // Auto select: call onSelect with lot data and close dialog
          onSelect({
            id: lot.id,
            productId: lot.productId,
            variantId: lot.variantId,
            locationId: lot.locationId,
            quantity: lot.quantity,
            sku: lot.sku,
            productName: lot.productName || lot.sku,
          } as any, undefined, { fromLotScan: true });
          setOpen(false);
          setLotScanResult(null);
        } else {
          setLotScanResult(null);
        }
      } catch (e) { console.error(e); setLotScanResult(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [open, search, onSelect, setOpen]);

  const loadItems = async (reset = false) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await getInventory({
        search,
        locationId: selectedLocationId,
        pageSize: 50,
        cursor: reset ? undefined : (cursor || undefined),
        status: 'all'
      });
      setItems(prev => reset ? res.items : [...prev, ...res.items]);
      setCursor(res.nextCursor);
    } catch (e) { console.error(e); }
    if (reset) setLoading(false);
    else setLoadingMore(false);
  };

  React.useEffect(() => {
    if (open) {
      // debounce search
      const t = setTimeout(() => loadItems(true), 300);
      return () => clearTimeout(t);
    }
  }, [open, search, selectedLocationId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Product</DialogTitle>
          <DialogDescription>Search and select a product from inventory. Or scan lot number in search.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search or scan lot number..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 border rounded-md p-2 space-y-2">
          {loading && <div className="py-8 flex justify-center"><Loader2 className="animate-spin" /></div>}
          {!loading && items.length === 0 && <div className="text-center py-8 text-muted-foreground">No items found.</div>}
          {items.map(item => (
            <div
              key={`${item.id}-${item.productId}-${item.variantId}`}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
              onClick={() => {
                onSelect(item, item.variantId ? { id: item.variantId, name: item.variantName || 'Variant' } : undefined);
                setOpen(false);
              }}
            >
              <div className="flex items-start gap-3">
                {item.productImage && (
                  <div className="h-10 w-10 rounded overflow-hidden border bg-muted">
                    <Image src={item.productImage} alt={item.productName} width={40} height={40} className="object-cover h-full w-full" />
                  </div>
                )}
                <div>
                  <div className="font-medium">{item.productName}</div>
                  <div className="text-sm text-muted-foreground">
                    {item.variantName ? <span className="text-primary">{item.variantName}</span> : null}
                    {item.variantName && <span className="mx-1"> - </span>}
                    <span>SKU: {item.variantSku || item.sku}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {item.locationName || 'Unknown Location'}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium text-lg">{item.quantity}</div>
                <div className="text-xs text-muted-foreground">Available</div>
              </div>
            </div>
          ))}
          {cursor && (
            <div className="pt-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => loadItems(false)} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Load More
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function InventoryClientPage() {
  const { toast } = useToast();
  // State for paginated items
  const [items, setItems] = React.useState<InventoryItemWithSourceIds[]>([]);
  const [itemsCursor, setItemsCursor] = React.useState<string | null>(null);
  const itemsCursorRef = React.useRef<string | null>(null);
  // Keep ref in sync with state
  React.useEffect(() => { itemsCursorRef.current = itemsCursor; }, [itemsCursor]);
  const [stats, setStats] = React.useState<Stats>({
    active: 0,
    lowStock: 0,
    lowStockAvailable: 0,
    outOfStock: 0,
    all: 0,
    totalItems: 0,
    totalCostValue: 0,
    totalSaleValue: 0,
    potentialProfit: 0
  });

  // Products Map (P03e) derived from items
  const productsFromItems = React.useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      sku: string;
      image?: string;
      variants: { id: string; name: string; sku: string; image?: string }[]
    }>();

    const hasVariantInventoryByProductId = new Set<string>();
    const directStockMetaByProductId = new Map<string, { sku?: string; image?: string }>();

    items.forEach(item => {
      // Helper for variant attributes
      const formatAttrs = (attrs?: Record<string, string>) => {
        if (!attrs || Object.keys(attrs).length === 0) return undefined;
        return Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(', ');
      };

      if (!map.has(item.productId)) {
        map.set(item.productId, {
          id: item.productId,
          name: item.productName || 'Unknown Product',
          sku: item.productSku || item.sku,
          image: item.productImage, // Use mapped product image
          variants: []
        });
      }
      const prod = map.get(item.productId)!;
      if (!item.variantId) {
        const qty = Number(item.quantity || 0);
        const reserved = Number(item.reservedQuantity || 0);
        if (qty > 0 || reserved > 0) {
          directStockMetaByProductId.set(item.productId, {
            sku: item.productSku || item.sku,
            image: item.productImage,
          });
        }
      }
      // If item has variantId, add to variants list if not exists
      if (item.variantId && !prod.variants.find(v => v.id === item.variantId)) {
        hasVariantInventoryByProductId.add(item.productId);
        const vName = item.variantName;
        const pName = item.productName;
        // If variant name is same as product name, it's not useful (API issue). Use attributes instead.
        const effectiveName = (vName && vName !== pName) ? vName : undefined;
        prod.variants.push({
          id: item.variantId,
          name: effectiveName || formatAttrs(item.variantAttributes) || item.variantSku || 'Variant',
          sku: item.variantSku || item.sku,
          image: item.variantImage || item.productImage
        });
      }
      // Simple products (no variantId) no longer get a synthetic variant row.
      // This keeps isExpandable = false for simple products → no expand chevron.
    });

    // Only show a synthetic "Parent SKU" row for variable products when parent stock exists (unexpected).
    for (const [productId, meta] of directStockMetaByProductId) {
      if (!hasVariantInventoryByProductId.has(productId)) continue; // simple products: no dropdown
      const prod = map.get(productId);
      if (!prod) continue;

      const directId = `direct-${productId}`;
      if (!prod.variants.find(v => v.id === directId)) {
        prod.variants.unshift({
          id: directId,
          name: 'Parent SKU Stock (Unexpected)',
          sku: meta.sku || prod.sku || 'N/A',
          image: meta.image || prod.image,
        });
      }
    }
    return map;
  }, [items]);

  // Combo products state
  const [comboProducts, setComboProducts] = React.useState<Product[]>([]);
  const [comboCursor, setComboCursor] = React.useState<string | null>(null);
  const comboCursorRef = React.useRef<string | null>(null);
  React.useEffect(() => { comboCursorRef.current = comboCursor; }, [comboCursor]);
  const [isLoadingCombos, setIsLoadingCombos] = React.useState(false);

  const [movementStateByKey, setMovementStateByKey] = React.useState<Record<string, {
    items: InventoryMovement[];
    nextCursor: string | null;
    isLoading: boolean;
  }>>({});
  const [lotStateByKey, setLotStateByKey] = React.useState<Record<string, {
    items: InventoryItem[];
    nextCursor: string | null;
    isLoading: boolean;
  }>>({});
  const [allLocations, setAllLocations] = React.useState<StockLocation[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);

  const [isClient, setIsClient] = React.useState(false);
  const [locationFilter, setLocationFilter] = React.useState<string>('all');
  const [searchTerm, setSearchTerm] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<'active' | 'low-stock' | 'low-stock-available' | 'out-of-stock' | 'all'>('all');

  const [menuResetKey, setMenuResetKey] = React.useState(0);
  const [expandedProducts, setExpandedProducts] = React.useState<Record<string, boolean>>({});
  const [lowStockThreshold, setLowStockThreshold] = React.useState<number>(5);

  // Initial Load (Settings, Locs, Products)
  const init = React.useCallback(async () => {
    try {
      const [locs, settingsRes] = await Promise.all([
        getStockLocations(),
        fetch('/api/settings/general').then(r => r.json()).catch(() => ({}))
      ]);
      setAllLocations(locs);
      // Removed initial products load

      if (settingsRes?.lowStockThreshold) setLowStockThreshold(settingsRes.lowStockThreshold);
    } catch (e) { console.error(e); }
  }, []);

  React.useEffect(() => {
    setIsClient(true);
    init();
  }, [init]);

  // Fetch Inventory List
  const fetchInventory = React.useCallback(async (reset: boolean = false) => {
    if (reset) setIsLoading(true);
    else setIsLoadingMore(true);

    try {
      // Read cursor from ref to avoid dependency-cycle resets
      const currentCursor = reset ? undefined : itemsCursorRef.current;
      if (!reset && !currentCursor) return;

      const params: any = {
        pageSize: 50,
        cursor: currentCursor || undefined,
        locationId: locationFilter,
        search: searchTerm,
        status: statusFilter,
        lowStockThreshold
      };

      const { items: newItems, nextCursor } = await getInventory(params);

      setItems(prev => reset ? newItems : [...prev, ...newItems]);
      setItemsCursor(nextCursor);
    } catch (err) {
      console.error("Inventory fetch failed", err);
      toast({ title: "Failed to load inventory", variant: 'destructive' });
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [locationFilter, searchTerm, statusFilter, lowStockThreshold, toast]);

  // Fetch Stats
  const fetchStats = React.useCallback(async () => {
    try {
      const s = await getInventoryStatsWrapper({
        search: searchTerm,
        locationId: locationFilter,
        lowStockThreshold
      });
      // Safety mapping
      setStats({
        active: s.active || 0,
        lowStock: s.lowStock || 0,
        lowStockAvailable: s.lowStockAvailable || 0,
        outOfStock: s.outOfStock || 0,
        all: s.all || 0,
        totalItems: s.totalItems || 0,
        totalCostValue: s.totalCostValue || 0,
        totalSaleValue: s.totalSaleValue || 0,
        potentialProfit: s.potentialProfit || 0
      });
    } catch (e) { console.error("Stats error", e); }
  }, [searchTerm, locationFilter, lowStockThreshold]);

  // Fetch Combos
  const fetchCombos = React.useCallback(async (reset = false) => {
    if (reset) setIsLoadingCombos(true);
    try {
      // P03e: Fetch combos separately — read cursor from ref to avoid dep cycle
      const res = await getComboProductsPaginated({
        locationId: locationFilter,
        search: searchTerm,
        pageSize: 50,
        cursor: reset ? undefined : (comboCursorRef.current || undefined)
      });
      setComboProducts(prev => reset ? res.items : [...prev, ...res.items]);
      setComboCursor(res.nextCursor);
    } catch (e) { console.error(e); }
    if (reset) setIsLoadingCombos(false);
  }, [locationFilter, searchTerm]);

  // Define fetchAllData helper
  const fetchAllData = React.useCallback(() => {
    fetchStats();
    fetchInventory(true);
    fetchCombos(true);
  }, [fetchStats, fetchInventory, fetchCombos]);

  // Trigger Fetches — use a stable ref so cursor changes don't re-trigger
  const fetchAllDataRef = React.useRef(fetchAllData);
  React.useEffect(() => { fetchAllDataRef.current = fetchAllData; }, [fetchAllData]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      fetchAllDataRef.current();
    }, 500);
    return () => clearTimeout(t);
  }, [searchTerm, locationFilter, statusFilter, lowStockThreshold]);

  const [viewMode, setViewMode] = React.useState<'normal' | 'combo'>('normal');

  const [dialogState, setDialogState] = React.useState<DialogState>({
    isOpen: false,
    mode: null,
    selectedItem: null,

  });

  const [breakdownLoading, setBreakdownLoading] = React.useState(false);
  const [breakdownData, setBreakdownData] = React.useState<{ locationName: string; quantity: number }[]>([]);

  const [adjustmentData, setAdjustmentData] = React.useState({
    productId: '',
    variantId: '',
    locationId: 'LOC001',
    inventoryItemId: '',
    adjustmentType: 'add' as 'add' | 'remove',
    quantity: 0,
    notes: '',
  });

  const [transferData, setTransferData] = React.useState({
    productId: '',
    variantId: '',
    fromLocationId: '',
    toLocationId: '',
    inventoryItemId: '',
    quantity: 0,
    notes: '',
  });

  const lotKey = (productId: string, variantId?: string | null, locationId?: string | null) =>
    `${productId}:${variantId ?? 'none'}:${locationId ?? 'all'}`;

  const loadLotsForSelection = async (
    params: { productId: string; variantId?: string | null; locationId?: string | null },
    options?: { append?: boolean }
  ) => {
    if (!params.productId) return;
    const append = Boolean(options?.append);
    const key = lotKey(params.productId, params.variantId, params.locationId);
    const currentState = lotStateByKey[key];

    // if (currentState?.isLoading) return; // Removed to allow pre-seeded loading to proceed to fetch
    if (append && !currentState?.nextCursor) return;

    setLotStateByKey((prev) => ({
      ...prev,
      [key]: {
        items: currentState?.items || [],
        nextCursor: currentState?.nextCursor ?? null,
        isLoading: true,
      },
    }));

    const search = new URLSearchParams();
    search.set('productId', params.productId);
    if (params.variantId) search.set('variantId', params.variantId);
    if (params.locationId && params.locationId !== 'all') search.set('locationId', params.locationId);
    search.set('pageSize', '50');
    if (append && currentState?.nextCursor) search.set('cursor', currentState.nextCursor);

    try {
      const data = await fetchApi<{ items: InventoryItem[]; nextCursor: string | null }>(
        `/api/inventory/lots?${search.toString()}`
      );
      setLotStateByKey((prev) => {
        const existing = append ? prev[key]?.items || [] : [];
        const merged = append ? [...existing, ...(data.items || [])] : (data.items || []);
        return {
          ...prev,
          [key]: {
            items: merged,
            nextCursor: data.nextCursor ?? null,
            isLoading: false,
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
        },
      }));
      toast({
        variant: 'destructive',
        title: 'Failed to load lots',
        description: error?.message || 'Unable to fetch lot data.',
      });
    }
  };

  const loadMovementsForItem = async (
    item: InventoryItem,
    options?: { append?: boolean }
  ) => {
    if (!item?.sourceItemIds?.length) return;
    const key = item.id;
    const append = Boolean(options?.append);
    const currentState = movementStateByKey[key];

    // if (currentState?.isLoading) return; // Removed to allow pre-seeded loading to proceed to fetch
    if (append && !currentState?.nextCursor) return;

    setMovementStateByKey((prev) => ({
      ...prev,
      [key]: {
        items: currentState?.items || [],
        nextCursor: currentState?.nextCursor ?? null,
        isLoading: true,
      },
    }));

    const search = new URLSearchParams();
    search.set('pageSize', '50');
    // If append, use cursor
    if (append && currentState?.nextCursor) search.set('cursor', currentState.nextCursor);

    // Contextual Fetch Strategy
    // If item has no sourceItemIds (e.g. virtual product item) or we want full view:
    // 1. If we have a variantId, filter by that Variant.
    // 2. If no variantId, filter by Product ID (shows all history for product).
    if (item.productId) search.set('productId', item.productId);
    if (item.variantId) search.set('variantId', item.variantId);

    // Fallback? If we are looking at a specific Lot, we might want inventoryItemIds?
    // But "View Movement" usually implies general history. 
    // If user wants specific lot history, they click on the Lot card.

    // For now, removing `inventoryItemIds` constraint to allow broader history (as requested by user)
    // search.set('inventoryItemIds', item.sourceItemIds.join(','));

    try {
      const data = await fetchApi<{ items: InventoryMovement[]; nextCursor: string | null }>(
        `/api/inventory/movements?${search.toString()}`
      );
      setMovementStateByKey((prev) => {
        const existing = append ? prev[key]?.items || [] : [];
        const merged = append ? [...existing, ...(data.items || [])] : (data.items || []);
        return {
          ...prev,
          [key]: {
            items: merged,
            nextCursor: data.nextCursor ?? null,
            isLoading: false,
          },
        };
      });
    } catch (error: any) {
      setMovementStateByKey((prev) => ({
        ...prev,
        [key]: {
          items: prev[key]?.items || [],
          nextCursor: prev[key]?.nextCursor ?? null,
          isLoading: false,
        },
      }));
      toast({
        variant: 'destructive',
        title: 'Failed to load movements',
        description: error?.message || 'Unable to fetch movement history.',
      });
    }
  };



  React.useEffect(() => {
    if (dialogState.isOpen && dialogState.mode === 'viewMovement' && dialogState.selectedItem) {
      loadMovementsForItem(dialogState.selectedItem);
    }
  }, [dialogState.isOpen, dialogState.mode, dialogState.selectedItem]);

  React.useEffect(() => {
    if (dialogState.isOpen && dialogState.mode === 'movement') {
      if (adjustmentData.productId && adjustmentData.locationId) {
        loadLotsForSelection({
          productId: adjustmentData.productId,
          variantId: adjustmentData.variantId,
          locationId: adjustmentData.locationId
        });
      }
      if (transferData.productId && transferData.fromLocationId) {
        loadLotsForSelection({
          productId: transferData.productId,
          variantId: transferData.variantId,
          locationId: transferData.fromLocationId
        });
      }
    }
  }, [dialogState.isOpen, dialogState.mode, adjustmentData.productId, adjustmentData.variantId, adjustmentData.locationId, transferData.productId, transferData.variantId, transferData.fromLocationId]);



  const focusRelease = () => {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch { /* noop */ }
  };

  const openDialog = (mode: DialogMode, item?: InventoryItem) => {
    focusRelease();
    window.setTimeout(() => {
      setDialogState({ isOpen: true, mode, selectedItem: item || null });

      // Pre-seed loading state if needed (P03g)
      if (mode === 'viewMovement' && item) {
        setMovementStateByKey(prev => {
          if (prev[item.id]) return prev;
          return { ...prev, [item.id]: { items: [], nextCursor: null, isLoading: true } };
        });
      }


      if (mode === 'movement') {
        const defaultLocation = locationFilter !== 'all' ? locationFilter : 'LOC001';
        setAdjustmentData({
          productId: item?.productId || '',
          variantId: item?.variantId || '',
          locationId: item?.locationId || defaultLocation,
          inventoryItemId: '',
          adjustmentType: 'add',
          quantity: 0,
          notes: '',
        });
        setTransferData({
          productId: item?.productId || '',
          variantId: item?.variantId || '',
          fromLocationId: item?.locationId || defaultLocation,
          toLocationId: '',
          inventoryItemId: '',
          quantity: 0,
          notes: '',
        });
      }
    }, 0);
  };

  const openDialogForVariant = (productId: string, variantId?: string, mode: DialogMode = 'movement') => {
    focusRelease();
    window.setTimeout(() => {
      setDialogState({ isOpen: true, mode, selectedItem: null }); // selectedItem is null here, but logic typically relies on it?
      // Wait, render logic uses 'dialogState.selectedItem'.
      // openDialogForVariant sets 'selectedItem' to null?
      // Then how does 'viewMovement' generic dialog work? 
      // It seems openDialogForVariant is primarily for 'movement' (Adjust/Transfer) or specific actions?
      // The Actions menu calls `openDialog('viewMovement', findItemForVariant(pid))`.
      // `openDialogForVariant` is used for "Adjust/Transfer Stock" menuItem.
      // But if I want to support pre-seeding here just in case:
      // Actually `openDialogForVariant` sets selectedItem to null, so those modals won't render anyway if they rely on selectedItem.
      // Checking used calls:
      // DropdownMenuItem onClick={() => openDialogForVariant(pid)} -> Adjust/Transfer
      // DropdownMenuItem onClick={() => openDialog('viewMovement', findItemForVariant(pid))} -> View Movement
      // So `openDialogForVariant` is ONLY for Adjust/Transfer which doesn't use the generic list views (Lots/Movements) in the same way (it uses its own state).
      // So I only need to update `openDialogForVariant` if it opens Lots/Movement? 
      // Line 719: mode: DialogMode = 'movement'. Default is movement.
      // If it's used for other modes, we might need logic.
      // But based on usage, it seems safe to leave it or just add generic checks derived from args if we were creating an item.
      // However, `openDialogForVariant` sets selectedItem to NULL. The other dialogs (Lots/Movement) REQUIRE a selectedItem to render (lines 2019, 2109).
      // So `openDialogForVariant` probably isn't used for those.
      // I will leave `openDialogForVariant` alone for pre-seeding Lots/Movement.
      const defaultLocation = locationFilter !== 'all' ? locationFilter : 'LOC001';
      setAdjustmentData({
        productId,
        variantId: variantId || '',
        locationId: defaultLocation,
        inventoryItemId: '',
        adjustmentType: 'add',
        quantity: 0,
        notes: '',
      });
      setTransferData({
        productId,
        variantId: variantId || '',
        fromLocationId: defaultLocation,
        toLocationId: '',
        inventoryItemId: '',
        quantity: 0,
        notes: '',
      });
    }, 0);
  };

  const closeDialog = () => {
    setDialogState({ isOpen: false, mode: null, selectedItem: null });
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch { }
    window.setTimeout(() => {
      try { document.body?.focus?.(); } catch { }
      setMenuResetKey(k => k + 1);
    }, 0);
  };

  const handleAdjustmentProductChange = (productId: string) => {
    setAdjustmentData(prev => ({ ...prev, productId, variantId: '', inventoryItemId: '' }));
    setTransferData(prev => ({ ...prev, productId, variantId: '', inventoryItemId: '' }));
  };

  const handleSaveAdjustment = async () => {
    if (!adjustmentData.productId || adjustmentData.quantity <= 0 || !adjustmentData.inventoryItemId) {
      toast({ variant: 'destructive', title: 'Invalid Input', description: 'Please select a lot and enter a valid quantity.' });
      return;
    }

    setIsSubmitting(true);
    const result = await adjustStock({
      productId: adjustmentData.productId,
      variantId: adjustmentData.variantId || undefined,
      locationId: adjustmentData.locationId,
      inventoryItemId: adjustmentData.inventoryItemId,
      quantityChange: adjustmentData.quantity,
      adjustmentType: adjustmentData.adjustmentType,
      notes: adjustmentData.notes,
      user: 'Admin',
    });

    if (result.success) {
      toast({ title: 'Success', description: result.message });
      closeDialog();
      fetchAllData();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleSaveTransfer = async () => {
    if (!transferData.productId || !transferData.fromLocationId || !transferData.toLocationId || transferData.quantity <= 0 || !transferData.inventoryItemId) {
      toast({ variant: 'destructive', title: 'Invalid Input', description: 'Please select a lot and fill all transfer details correctly.' });
      return;
    }

    setIsSubmitting(true);
    const result = await transferStock({
      productId: transferData.productId,
      variantId: transferData.variantId || undefined,
      fromLocationId: transferData.fromLocationId,
      toLocationId: transferData.toLocationId,
      inventoryItemId: transferData.inventoryItemId,
      quantity: transferData.quantity,
      notes: transferData.notes,
      user: 'Admin',
    });

    if (result.success) {
      toast({ title: 'Success', description: result.message });
      closeDialog();
      fetchAllData();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  const currentItem = dialogState.selectedItem;
  const movementState = currentItem ? movementStateByKey[currentItem.id] : undefined;
  const movementsForDialog: InventoryMovement[] = movementState?.items || [];
  const movementNextCursor = movementState?.nextCursor ?? null;
  const isMovementLoading = movementState?.isLoading ?? false;



  const getProductImage = (productId: string): string => {
    return productsFromItems.get(productId)?.image || DEFAULT_PLACEHOLDER;
  };

  const getVariantImage = (productId: string, variantId: string): string => {
    const p = productsFromItems.get(productId);
    if (variantId.startsWith('direct-')) return p?.image || DEFAULT_PLACEHOLDER;
    const v = p?.variants.find(variant => variant.id === variantId);
    return v?.image || p?.image || DEFAULT_PLACEHOLDER;
  };

  const productIds = React.useMemo(
    () => Array.from(productsFromItems.keys()),
    [productsFromItems]
  );

  const qtyByProduct = React.useMemo(() => {
    const m: Record<string, { total: number; reserved: number; available: number }> = {};
    for (const it of items) {
      if (!m[it.productId]) m[it.productId] = { total: 0, reserved: 0, available: 0 };
      m[it.productId].total += it.quantity;
      m[it.productId].reserved += it.reservedQuantity || 0;
      m[it.productId].available += (it.quantity - (it.reservedQuantity || 0));
    }
    return m;
  }, [items]);

  const qtyByVariant = React.useMemo(() => {
    const m: Record<string, { total: number; reserved: number; available: number }> = {};
    for (const it of items) {
      const key = it.variantId || `direct-${it.productId}`;

      if (!m[key]) m[key] = { total: 0, reserved: 0, available: 0 };
      m[key].total += it.quantity;
      m[key].reserved += it.reservedQuantity || 0;
      m[key].available += (it.quantity - (it.reservedQuantity || 0));
    }
    return m;
  }, [items]);

  // removed inventoryForLocation - not needed if we rely on server filtering



  const toggleExpand = (productId: string) => {
    setExpandedProducts(prev => ({ ...prev, [productId]: !prev[productId] }));
  };

  const handlePrintLots = (productId: string, variantId?: string) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams({ productId });
    if (variantId && !variantId.startsWith('direct-')) params.set('variantId', variantId);
    window.open(`/print/inventory-lots?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const findItemForVariant = (productId: string, variantId?: string): InventoryItem | undefined => {
    // Look in loaded items first
    // This is used for "View Movement" etc.
    const itemsForProduct = items.filter(i => i.productId === productId);
    const normalizedVariantId = variantId && variantId.startsWith('direct-') ? undefined : variantId;
    if (normalizedVariantId) return itemsForProduct.find(i => i.variantId === normalizedVariantId);
    return itemsForProduct.find(i => !i.variantId) || itemsForProduct[0]; // Fallback to any item for the product if explicit group rep is missing (e.g. all items are variants)
  };

  const adjustmentSelectedProduct = productsFromItems.get(adjustmentData.productId);
  const transferSelectedProduct = productsFromItems.get(transferData.productId);
  const adjustmentAvailableVariants = adjustmentSelectedProduct?.variants || [];
  const transferAvailableVariants = transferSelectedProduct?.variants || [];
  const adjustmentLots = React.useMemo(() => {
    if (!adjustmentData.productId || !adjustmentData.locationId) return [];
    const key = lotKey(adjustmentData.productId, adjustmentData.variantId || null, adjustmentData.locationId);
    return lotStateByKey[key]?.items || [];
  }, [lotStateByKey, adjustmentData, lotKey]);
  const transferLots = React.useMemo(() => {
    if (!transferData.productId || !transferData.fromLocationId) return [];
    const key = lotKey(transferData.productId, transferData.variantId || null, transferData.fromLocationId);
    return lotStateByKey[key]?.items || [];
  }, [lotStateByKey, transferData, lotKey]);

  // Async Current Stock (Adjustment)
  const [currentStockVal, setCurrentStockVal] = React.useState<number>(0);

  React.useEffect(() => {
    if (dialogState.isOpen && dialogState.mode === 'movement' && adjustmentData.productId && adjustmentData.locationId) {
      if (adjustmentData.inventoryItemId) {
        const lot = adjustmentLots.find(l => l.id === adjustmentData.inventoryItemId);
        setCurrentStockVal(lot?.quantity || 0);
        return;
      }
      const sub = async () => {
        try {
          const params = new URLSearchParams({
            productId: adjustmentData.productId,
            locationId: adjustmentData.locationId
          });
          if (adjustmentData.variantId) params.set('variantId', adjustmentData.variantId);
          const data = await fetchApi<{ items: InventoryItem[] }>(`/api/inventory?${params.toString()}`);
          const item = data.items?.[0];
          setCurrentStockVal(item?.quantity || 0);
        } catch (e) { console.error(e); }
      }
      sub();
    } else {
      setCurrentStockVal(0);
    }
  }, [dialogState.isOpen, adjustmentData.productId, adjustmentData.variantId, adjustmentData.locationId, adjustmentData.inventoryItemId, adjustmentLots]);

  const currentStock = currentStockVal;


  const [variantBreakdownItems, setVariantBreakdownItems] = React.useState<{ id: string; name: string; sku: string; quantity: number }[]>([]);
  const [transferStockVal, setTransferStockVal] = React.useState<number>(0);

  React.useEffect(() => {
    if (dialogState.isOpen && dialogState.mode === 'stock' && dialogState.selectedItem) {
      const { productId, variantId } = dialogState.selectedItem;
      setBreakdownLoading(true);
      setBreakdownData([]);
      setVariantBreakdownItems([]);

      const sub = async () => {
        try {
          const params = new URLSearchParams({ productId, pageSize: '200' });
          if (variantId) params.set('variantId', variantId);
          if (locationFilter !== 'all') params.set('locationId', locationFilter);

          const data = await fetchApi<{ items: InventoryItem[] }>(`/api/inventory?${params.toString()}`);
          const items = data.items || [];

          // Agregate by Location
          const locMap: Record<string, number> = {};
          for (const item of items) {
            const locName = item.locationName || 'Unknown';
            locMap[locName] = (locMap[locName] || 0) + item.quantity;
          }
          setBreakdownData(Object.entries(locMap).map(([k, v]) => ({ locationName: k, quantity: v })).sort((a, b) => b.quantity - a.quantity));

          // Aggregate by Variant (only for Parent View)
          if (!variantId) {
            const varMap: Record<string, { id: string; name: string; sku: string; quantity: number }> = {};
            for (const item of items) {
              const vid = item.variantId || `direct-${item.productId}`;
              if (!varMap[vid]) {
                // Try to resolve name from client-side product map first for accuracy
                let resolvedName = item.variantName;
                if (item.variantId) {
                  const p = productsFromItems.get(item.productId);
                  const v = p?.variants.find(v => v.id === item.variantId);
                  if (v?.name) resolvedName = v.name;
                }

                varMap[vid] = {
                  id: vid,
                  name: resolvedName || (item.variantId ? 'Variant' : 'Direct Stock / No Variant'),
                  sku: item.variantSku || '',
                  quantity: 0
                };
              }
              varMap[vid].quantity += item.quantity;
            }
            setVariantBreakdownItems(Object.values(varMap).sort((a, b) => b.quantity - a.quantity));
          }
        } catch (e) { console.error(e); } finally { setBreakdownLoading(false); }
      }
      sub();
    }
  }, [dialogState.isOpen, dialogState.mode, dialogState.selectedItem, locationFilter]);

  // Fetch Transfer Source Stock
  React.useEffect(() => {
    if (dialogState.isOpen && dialogState.mode === 'movement' && transferData.productId && transferData.fromLocationId) {
      if (transferData.inventoryItemId) {
        const lot = transferLots.find(l => l.id === transferData.inventoryItemId);
        setTransferStockVal(lot?.quantity || 0);
        return;
      }
      // Fetch item stock at source
      const sub = async () => {
        try {
          const params = new URLSearchParams({
            productId: transferData.productId,
            locationId: transferData.fromLocationId
          });
          if (transferData.variantId) params.set('variantId', transferData.variantId);

          const data = await fetchApi<{ items: InventoryItem[] }>(`/api/inventory?${params.toString()}`);
          const item = data.items?.[0];
          setTransferStockVal(item?.quantity || 0);
        } catch (e) { console.error(e); }
      }
      sub();
    } else {
      setTransferStockVal(0);
    }
  }, [dialogState.isOpen, transferData.productId, transferData.variantId, transferData.fromLocationId, transferData.inventoryItemId, transferLots]);

  // Mapped getters for UI

  const transferSourceStock = transferStockVal;

  const lotRows = React.useMemo(() => {
    const sel = (dialogState.mode === 'stock') ? dialogState.selectedItem : null;
    if (!sel) return [];
    const locationKey = locationFilter === 'all' ? 'all' : locationFilter;
    const key = lotKey(sel.productId, sel.variantId || null, locationKey);
    const items = lotStateByKey[key]?.items || [];
    return items
      .slice()
      .sort((a, b) => new Date(b.receivedDate).getTime() - new Date(a.receivedDate).getTime());
  }, [dialogState, lotStateByKey, locationFilter, lotKey]);

  const formatCost = (val?: number) =>
    `Tk ${Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;



  const formatLotProduct = (lot: InventoryItem) => {
    const variantLabel = lot.variantName ? ` (${lot.variantName})` : '';
    return `${lot.productName}${variantLabel} (${lot.sku})`;
  };

  const toCsv = (rows: Array<Record<string, string | number>>, headers: string[]) => {
    const escapeValue = (value: string | number) => {
      const raw = String(value ?? '');
      if (/[",\n\r]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    };
    return [
      headers.join(','),
      ...rows.map(row => headers.map(header => escapeValue(row[header] ?? '')).join(',')),
    ].join('\r\n');
  };

  const downloadCsv = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const productById = React.useMemo(() => {
    const map: Record<string, any> = {};
    // We can't easily populate this without all products, but we can try to use what we have in inventory
    items.forEach(item => {
      if (item.productName) {
        map[item.productId] = { id: item.productId, name: item.productName };
      }
    });
    return map;
  }, [items]);

  const getVariantName = React.useCallback((productId: string, variantId?: string | null) => {
    if (!variantId) return '';
    const item = items.find(i => i.productId === productId && i.variantId === variantId);
    return item?.variantName || variantId;
  }, [items]);

  const handleExportSummary = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const normalizedSearch = searchTerm.trim().toLowerCase();
      const summaryMap = new Map<string, { product: string; variant: string; sku: string; location: string; quantity: number; totalCost: number }>();

      let cursor: string | null = null;
      do {
        const params = new URLSearchParams();
        params.set('pageSize', '200');
        if (locationFilter !== 'all') params.set('locationId', locationFilter);
        if (searchTerm) params.set('search', searchTerm);
        if (cursor) params.set('cursor', cursor);
        if (statusFilter !== 'all') params.set('status', statusFilter);
        params.set('lowStockThreshold', String(lowStockThreshold));

        const data = await fetchApi<{ items: InventoryItem[]; nextCursor: string | null }>(`/api/inventory?${params.toString()}`);
        const batch = data.items || [];

        batch.forEach(item => {
          const product = (productById as any)[item.productId]; // Might miss products if not all loaded? 
          // We rely on 'item' having product info?
          // getInventoryPaginated returns InventoryItemWithSourceIds which has product/variant relations included?
          // No, Prisma include. Yes.
          // Wait, module `getInventoryPaginated` uses `activeInventory` which groups. It constructs items.
          // It puts `productName`, `variantName` on the item object.
          // Check services/inventory.ts type `InventoryItemWithSourceIds`.
          // It inherits `InventoryItem`.
          // Does `InventoryItem` have productName? Yes (usually flattened or joined).
          // Server module `getInventoryPaginated` returns constructed objects.
          // Line 360 in module: `productName: p.name`.
          // So we don't need `productById` for name.

          const productName = item.productName || '';
          const variantName = item.variantName || '';
          const sku = item.sku || '';

          const key = `${item.productId}|${item.variantId || ''}|${item.locationId}`;
          const existing = summaryMap.get(key) || {
            product: productName,
            variant: variantName,
            sku,
            location: item.locationName,
            quantity: 0,
            totalCost: 0,
          };
          const unitCost = Number(item.avgUnitCost ?? item.unitCost ?? 0);
          existing.quantity += item.quantity;
          existing.totalCost += unitCost * item.quantity;
          summaryMap.set(key, existing);
        });

        cursor = data.nextCursor ?? null;
      } while (cursor);

      const rows = Array.from(summaryMap.values()).map(entry => {
        const unitCost = entry.quantity > 0 ? entry.totalCost / entry.quantity : 0;
        return {
          Product: entry.product,
          Variant: entry.variant,
          SKU: entry.sku,
          Location: entry.location,
          Quantity: entry.quantity,
          UnitCost: unitCost.toFixed(2),
          TotalCost: entry.totalCost.toFixed(2),
        };
      });

      const headers = ['Product', 'Variant', 'SKU', 'Location', 'Quantity', 'UnitCost', 'TotalCost'];
      const stamp = format(new Date(), 'yyyyMMdd-HHmm');
      downloadCsv(toCsv(rows, headers), `inventory-summary-${stamp}.csv`);
    } catch (err: any) {
      toast({ title: 'Export failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const fetchAllLotsForExport = async () => {
    const items: InventoryItem[] = [];
    let cursor: string | null = null;

    do {
      const params = new URLSearchParams();
      params.set('pageSize', '200');
      if (locationFilter !== 'all') params.set('locationId', locationFilter);
      if (cursor) params.set('cursor', cursor);
      const data = await fetchApi<{ items: InventoryItem[]; nextCursor: string | null }>(`/api/inventory/lots?${params.toString()}`);
      if (Array.isArray(data.items)) {
        items.push(...data.items);
      }
      cursor = data.nextCursor ?? null;
    } while (cursor);

    return items;
  };

  const fetchAllMovementsForExport = async () => {
    const items: Array<Record<string, any>> = [];
    let cursor: string | null = null;

    do {
      const params = new URLSearchParams();
      params.set('pageSize', '200');
      if (locationFilter !== 'all') params.set('locationId', locationFilter);
      if (cursor) params.set('cursor', cursor);
      const data = await fetchApi<{ items: Array<Record<string, any>>; nextCursor: string | null }>(`/api/inventory/movements?${params.toString()}`);
      if (Array.isArray(data.items)) {
        items.push(...data.items);
      }
      cursor = data.nextCursor ?? null;
    } while (cursor);

    return items;
  };

  const handleExportLots = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const normalizedSearch = searchTerm.trim().toLowerCase();
      const lots = await fetchAllLotsForExport();
      const rows = lots
        .filter(lot => (locationFilter === 'all' ? true : lot.locationId === locationFilter))
        .filter(lot => {
          if (!normalizedSearch) return true;
          const searchBlob = `${lot.productName} ${lot.variantName || ''} ${lot.sku} ${lot.lotNumber}`.toLowerCase();
          return searchBlob.includes(normalizedSearch);
        })
        .map(lot => ({
          LotNumber: lot.lotNumber,
          Product: lot.productName,
          Variant: getVariantName(lot.productId, lot.variantId),
          SKU: lot.sku,
          Location: lot.locationName,
          Quantity: lot.quantity,
          UnitCost: (lot.unitCost || 0).toFixed(2),
          TotalCost: ((lot.unitCost || 0) * lot.quantity).toFixed(2),
          ReceivedDate: lot.receivedDate ? format(new Date(lot.receivedDate), 'PP') : '',
        }));

      const headers = ['LotNumber', 'Product', 'Variant', 'SKU', 'Location', 'Quantity', 'UnitCost', 'TotalCost', 'ReceivedDate'];
      const stamp = format(new Date(), 'yyyyMMdd-HHmm');
      downloadCsv(toCsv(rows, headers), `inventory-lots-${stamp}.csv`);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to export lots',
        description: err?.message || 'Unable to export lot data.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMovements = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const normalizedSearch = searchTerm.trim().toLowerCase();
      const rows: Array<Record<string, string | number>> = [];
      const movements = await fetchAllMovementsForExport();

      movements.forEach((mov) => {
        const productName = mov.productName || '';
        const variantName = mov.variantName || '';
        const sku = mov.sku || '';
        if (normalizedSearch) {
          const searchBlob = `${productName} ${variantName} ${sku}`.toLowerCase();
          if (!searchBlob.includes(normalizedSearch)) return;
        }

        rows.push({
          Date: mov.date ? format(new Date(mov.date), 'PP p') : '',
          Type: mov.type || '',
          Quantity: Number(mov.quantityChange || 0),
          Balance: Number(mov.balance || 0),
          User: mov.user || '',
          Notes: mov.notes || '',
          Reference: mov.reference || '',
          Product: productName,
          Variant: variantName,
          SKU: sku,
          Location: mov.locationName || '',
          LotNumber: mov.lotNumber || '',
        });
      });

      rows.sort((a, b) => String(b.Date).localeCompare(String(a.Date)));

      const headers = ['Date', 'Type', 'Quantity', 'Balance', 'User', 'Notes', 'Reference', 'Product', 'Variant', 'SKU', 'Location', 'LotNumber'];
      const stamp = format(new Date(), 'yyyyMMdd-HHmm');
      downloadCsv(toCsv(rows, headers), `inventory-movements-${stamp}.csv`);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to export movements',
        description: err?.message || 'Unable to export movement data.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const renderTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[80px] hidden sm:table-cell">Image</TableHead>
          <TableHead>Product</TableHead>
          <TableHead className="hidden md:table-cell">Location</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {productIds.map((pid) => {
          const product = productsFromItems.get(pid);
          const stats = qtyByProduct[pid] || { total: 0, reserved: 0, available: 0 };
          const isExpandable = !!product?.variants.length;
          const isExpanded = !!expandedProducts[pid];

          return (
            <React.Fragment key={pid}>
              <TableRow className={stats.available <= lowStockThreshold ? "bg-destructive/10" : ""}>
                <TableCell className="hidden sm:table-cell">
                  <Image
                    alt={product?.name || 'Product'}
                    className="aspect-square rounded-md object-cover"
                    height={64}
                    src={getProductImage(pid)}
                    width={64}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {isExpandable ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(pid)}
                        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-muted"
                        aria-label={isExpanded ? 'Collapse variants' : 'Expand variants'}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    ) : <span className="inline-block w-6" aria-hidden />}
                    <div className="min-w-0">
                      <div className="truncate">{product?.name || '—'}</div>
                      {!isExpandable && product?.sku && (
                        <div className="text-xs text-muted-foreground truncate">SKU: {product.sku}</div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {locationFilter === 'all'
                    ? <Badge variant="outline">All Locations</Badge>
                    : <Badge variant="outline">{allLocations.find(l => l.id === locationFilter)?.name || '—'}</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span>{`Available: ${stats.available} (Total: ${stats.total})`}</span>
                    {stats.available <= lowStockThreshold && <Badge variant="destructive" className="ml-2 hidden sm:inline-flex">Low Stock</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <DropdownMenu key={`${pid}-p-${menuResetKey}`}>
                    <DropdownMenuTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Toggle menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => openDialogForVariant(pid)}>Adjust/Transfer Stock</DropdownMenuItem>
                      {findItemForVariant(pid) && (
                        <DropdownMenuItem onClick={() => {
                          const it = findItemForVariant(pid);
                          if (it) openDialog('viewMovement', { ...it, variantId: undefined, variantName: undefined });
                        }}>
                          View Movement
                        </DropdownMenuItem>
                      )}
                      {findItemForVariant(pid) && (
                        <DropdownMenuItem onClick={() => {
                          const firstItem = findItemForVariant(pid);
                          if (firstItem) {
                            const productItem = { ...firstItem, variantId: undefined, variantName: undefined, sku: productsFromItems.get(pid)?.sku || '' };
                            openDialog('stock', productItem);
                          }
                        }}>
                          <span className="inline-flex items-center gap-2"><ListTree className="h-4 w-4" /> View Stock</span>
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuItem onClick={() => handlePrintLots(pid)}>
                        Print Lot Barcode
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>

              {isExpandable && isExpanded && product?.variants.map((v) => {
                const vStats = qtyByVariant[v.id] || { total: 0, reserved: 0, available: 0 };
                const repItem = findItemForVariant(pid, v.id);
                return (
                  <TableRow key={v.id} className={vStats.available <= lowStockThreshold ? "bg-destructive/5" : ""}>
                    <TableCell className="hidden sm:table-cell">
                      <Image
                        alt={v.name || product?.name || 'Variant'}
                        className="aspect-square rounded-md object-cover"
                        height={48}
                        src={getVariantImage(pid, v.id)}
                        width={48}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="pl-8">
                        <div className="font-medium">{v.name}</div>
                        {v.sku && <div className="text-xs text-muted-foreground">SKU: {v.sku}</div>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {locationFilter === 'all'
                        ? <Badge variant="outline">All Locations</Badge>
                        : <Badge variant="outline">{allLocations.find(l => l.id === locationFilter)?.name || '—'}</Badge>}
                    </TableCell>
                    <TableCell className="text-right flex flex-col items-end gap-1">
                      <span>Available: {vStats.available} <span className="text-xs text-muted-foreground">(Total: {vStats.total})</span></span>
                      {vStats.available <= lowStockThreshold && <Badge variant="destructive" className="text-[10px] py-0 h-4">Low</Badge>}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu key={`${v.id}-v-${menuResetKey}`}>
                        <DropdownMenuTrigger asChild>
                          <Button aria-haspopup="true" size="icon" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Variant Actions</DropdownMenuLabel>
                          {repItem && (
                            <>
                              <DropdownMenuItem onClick={() => openDialog('stock', repItem)}>
                                <span className="inline-flex items-center gap-2"><ListTree className="h-4 w-4" /> View Stock</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDialog('viewMovement', repItem)}>
                                <span className="inline-flex items-center gap-2"><History className="h-4 w-4" /> View Movement</span>
                              </DropdownMenuItem>
                            </>
                          )}

                          <DropdownMenuItem onClick={() => handlePrintLots(pid, v.id)}>
                            Print Lot Barcode
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );

  const renderCardList = () => (
    <div className="space-y-4">
      {productIds.map((pid) => {
        const product = productsFromItems.get(pid);
        const stats = qtyByProduct[pid] || { total: 0, reserved: 0, available: 0 };
        const isExpandable = !!product?.variants?.length;
        const isExpanded = !!expandedProducts[pid];

        return (
          <Card key={pid} className={cn("overflow-hidden", stats.available <= lowStockThreshold && "bg-destructive/10")}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3 sm:gap-4">
                <Image
                  alt={product?.name || 'Product'}
                  className="h-16 w-16 sm:h-20 sm:w-20 aspect-square rounded-md object-cover shrink-0"
                  height="80"
                  src={getProductImage(pid)}
                  width="80"
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      {isExpandable ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(pid)}
                          className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-muted"
                          aria-label={isExpanded ? 'Collapse variants' : 'Expand variants'}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      ) : <span className="inline-block w-6" aria-hidden />}
                      <div className="min-w-0">
                        <p className="font-semibold break-words">{product?.name}</p>
                        {!isExpandable && product?.sku && (
                          <p className="text-xs text-muted-foreground break-words">SKU: {product.sku}</p>
                        )}
                        <p className="text-xs text-muted-foreground break-words">
                          {locationFilter === 'all'
                            ? 'All Locations'
                            : (allLocations.find(l => l.id === locationFilter)?.name || '—')}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu key={`${pid}-pm-${menuResetKey}`} onOpenChange={(open) => {
                      if (open) {
                        try {
                          loadLotsForSelection({
                            productId: pid,
                            locationId: locationFilter !== 'all' ? locationFilter : null
                          });
                          const item = findItemForVariant(pid);
                          if (item) loadMovementsForItem(item);
                        } catch (e) { console.error('Prefetch failed', e); }
                      }
                    }}>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => openDialogForVariant(pid)}>Adjust/Transfer Stock</DropdownMenuItem>

                        <DropdownMenuItem onClick={() => handlePrintLots(pid)}>
                          Print Lot Barcode
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div><Badge variant="outline" className="mt-1">Stock Status</Badge></div>
                    <div className="text-left sm:text-right">
                      <div className="flex items-center gap-2 justify-start sm:justify-end">
                        <p className="font-semibold text-lg">
                          {stats.available} <span className="text-sm text-muted-foreground font-normal">avail</span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          / {stats.total} total
                        </p>
                      </div>
                      {stats.available <= lowStockThreshold && <Badge variant="destructive" className="mt-1">Low Stock</Badge>}
                    </div>
                  </div>

                  {isExpandable && isExpanded && (
                    <div className="mt-3 space-y-3">
                      {product?.variants?.map(v => {
                        const vStats = qtyByVariant[v.id] || { total: 0, reserved: 0, available: 0 };
                        const itemForView = findItemForVariant(pid, v.id);
                        return (
                          <div key={v.id} className={cn("rounded-md border p-2 sm:p-3", vStats.available <= lowStockThreshold && "bg-destructive/5")}>
                            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                              <Image
                                alt={v.name || product?.name || 'Variant'}
                                className="h-9 w-9 rounded-md object-cover shrink-0"
                                height={36}
                                src={getVariantImage(pid, v.id)}
                                width={36}
                              />
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate">{v.name}</div>
                                {v.sku && <div className="text-xs text-muted-foreground truncate">SKU: {v.sku}</div>}
                              </div>
                              <div className="text-right text-xs">
                                <div className="font-semibold text-sm">{vStats.available}</div>
                                <div className="text-muted-foreground">avail (total: {vStats.total})</div>
                                {vStats.available <= lowStockThreshold && <div className="text-destructive font-bold text-[10px]">LOW</div>}
                              </div>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className={cn("h-8 text-xs", !itemForView && "col-span-2")}
                                onClick={() => openDialogForVariant(pid, v.id)}
                              >
                                Adjust
                              </Button>
                              {itemForView && (
                                <>
                                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => openDialog('viewMovement', itemForView)}>
                                    History
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => openDialog('stock', itemForView)}>
                                    Stock
                                  </Button>
                                  <Button size="sm" variant="ghost" className="col-span-2 h-8 text-xs" onClick={() => handlePrintLots(pid, v.id)}>
                                    Print Lot
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  const renderComboTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Combo Product</TableHead>
          <TableHead className="text-right">Available</TableHead>
          <TableHead>Components (Derived)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {comboProducts.map(combo => (
          <TableRow key={combo.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                {combo.image && (
                  <div className="h-10 w-10 rounded overflow-hidden border bg-muted">
                    <Image src={combo.image} alt={combo.name} width={40} height={40} className="object-cover h-full w-full" />
                  </div>
                )}
                <div>
                  <div className="font-medium">{combo.name}</div>
                  {combo.sku && <div className="text-xs text-muted-foreground">SKU: {combo.sku}</div>}
                </div>
              </div>
            </TableCell>
            <TableCell className="text-right">
              <span className="font-medium">{combo.inventory}</span>
            </TableCell>
            <TableCell>
              <div className="text-xs text-muted-foreground space-y-1">
                {combo.comboItems?.map((component, idx) => (
                  <div key={`${combo.id}-component-${idx}`}>
                    {component.childProduct.name}{component.variantSku ? ` (SKU: ${component.variantSku})` : (component.childProduct.sku ? ` (SKU: ${component.childProduct.sku})` : '')} - {component.available} avail
                  </div>
                ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderComboCards = () => {
    return (
      <div className="space-y-3">
        {comboProducts.map(combo => (
          <Card key={combo.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {combo.image && (
                    <div className="h-10 w-10 rounded overflow-hidden border bg-muted shrink-0">
                      <Image src={combo.image} alt={combo.name} width={40} height={40} className="object-cover h-full w-full" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{combo.name}</p>
                    {combo.sku && <p className="text-xs text-muted-foreground break-words">SKU: {combo.sku}</p>}
                  </div>
                </div>
                <Badge variant="outline">Avail: {combo.inventory}</Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-1 pl-[52px]">
                {combo.comboItems?.map((component, idx) => (
                  <div key={`${combo.id}-component-card-${idx}`}>
                    {component.childProduct.name}{component.variantSku ? ` (SKU: ${component.variantSku})` : (component.childProduct.sku ? ` (SKU: ${component.childProduct.sku})` : '')} - {component.available} avail
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-4">
        <div className="flex-1">
          <h1 className="font-headline text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">Track stock levels and movements across all locations.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Select Location" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {allLocations.map(loc => (
              <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active ({stats.active})</SelectItem>
            <SelectItem value="low-stock">Low Stock ({stats.lowStock})</SelectItem>
            <SelectItem value="low-stock-available">Low Available ({stats.lowStockAvailable})</SelectItem>
            <SelectItem value="out-of-stock">Out of Stock ({stats.outOfStock})</SelectItem>
            <SelectItem value="all">All ({stats.all})</SelectItem>
          </SelectContent>
        </Select>
        <div className="w-full sm:w-auto flex-1 sm:flex-none">
          <Button size="sm" onClick={() => openDialog('movement')} className="w-full">
            Stock Movement
          </Button>
        </div>
        <div className="w-full sm:w-auto flex-1 sm:flex-none">
          <Button size="sm" variant={viewMode === 'combo' ? 'default' : 'outline'} onClick={() => setViewMode(viewMode === 'normal' ? 'combo' : 'normal')} className="w-full">
            <Package className="mr-2 h-4 w-4" /> Combo Stock
          </Button>
        </div>
        <div className="w-full sm:w-auto flex-1 sm:flex-none">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="w-full">
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Export CSV</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleExportSummary}>Summary CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportLots}>Lots CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportMovements}>Movements CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-4 pt-2">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Items</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalItems.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">units in stock</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Stock Value (Cost)</CardTitle>
              <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">৳{stats.totalCostValue.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Estimated cost price</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Stock Value (Sale)</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">৳{stats.totalSaleValue.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Total retail value</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Potential Profit</CardTitle>
              <BarChart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">৳{stats.potentialProfit.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Estimated profit from current stock</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by product name or SKU..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {!isClient || isLoading ? (
            <div>
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                Loading inventory...
              </div>
              <Skeleton className="h-96 w-full" />
            </div>
          ) : (
            <>
              {viewMode === 'normal' ? (
                <>
                  <div className="hidden sm:block">{renderTable()}</div>
                  <div className="sm:hidden">{renderCardList()}</div>

                  {/* Load More */}
                  {itemsCursor && (
                    <div className="mt-4 text-center">
                      <Button variant="outline" onClick={() => fetchInventory(false)} disabled={isLoadingMore}>
                        {isLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Load More
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {comboProducts.length > 0 ? (
                    <div className="mt-4">
                      <div className="hidden sm:block">{renderComboTable()}</div>
                      <div className="sm:hidden">{renderComboCards()}</div>
                    </div>
                  ) : (
                    <div className="h-48 flex items-center justify-center text-muted-foreground">
                      No combo products found.
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>

        <CardFooter>
          <div className="text-xs text-muted-foreground">
            {viewMode === 'normal' ? (
              <>Showing <strong>{productIds.length}</strong> stocked products.</>
            ) : (
              <>Showing <strong>{comboProducts.length}</strong> combo products (derived).</>
            )}
          </div>
        </CardFooter>
      </Card>

      <Dialog open={dialogState.isOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent
          className={cn(
            "w-[95vw] max-h-[85vh] overflow-y-auto sm:max-w-xl",
            dialogState.mode === 'viewMovement' && 'sm:max-w-3xl',
            dialogState.mode === 'stock' && 'sm:max-w-4xl'
          )}
        >
          {dialogState.mode === 'movement' && (
            <>
              <DialogHeader>
                <DialogTitle>Stock Movement</DialogTitle>
                <DialogDescription>Receive, adjust, or transfer inventory.</DialogDescription>
              </DialogHeader>
              <Tabs defaultValue="adjust" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mt-4">
                  <TabsTrigger value="receive">Receive</TabsTrigger>
                  <TabsTrigger value="adjust">Adjust</TabsTrigger>
                  <TabsTrigger value="transfer">Transfer</TabsTrigger>
                </TabsList>
                <TabsContent value="receive">
                  <p className="text-muted-foreground p-4 text-center">Use the Purchase Order module to receive new stock.</p>
                </TabsContent>
                <TabsContent value="adjust">
                  <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-1 gap-4">
                      <div className="grid gap-3">
                        <Label htmlFor="product-adj">Product</Label>
                        <InventoryProductPickerDialog
                          trigger={<Button variant="outline" className="w-full justify-between font-normal">
                            <span className="truncate mr-2">
                              {adjustmentData.productId ? (productsFromItems.get(adjustmentData.productId)?.name || 'Selected Product') : "Select product..."}
                            </span>
                            <Search className="h-4 w-4 shrink-0 opacity-50" />
                          </Button>}
                          onSelect={(item, variant, meta) => {
                            if (meta?.fromLotScan) {
                              // Auto-fill from lot scan
                              setAdjustmentData(prev => ({
                                ...prev,
                                productId: item.productId,
                                variantId: item.variantId || '',
                                locationId: item.locationId,
                                inventoryItemId: (item as any).id || '',
                                quantity: item.quantity
                              }));
                              return;
                            }
                            handleAdjustmentProductChange(item.productId);
                            if (variant) {
                              setAdjustmentData(prev => ({ ...prev, variantId: variant.id, inventoryItemId: '' }));
                            }
                          }}
                        />
                      </div>
                      {(adjustmentAvailableVariants?.length ?? 0) > 0 && (
                        <div className="grid gap-3">
                          <Label htmlFor="variant-adj">Variant</Label>
                          <Select
                            value={adjustmentData.variantId}
                            onValueChange={(value) => setAdjustmentData(prev => ({ ...prev, variantId: value, inventoryItemId: '' }))}
                          >
                            <SelectTrigger id="variant-adj"><SelectValue placeholder="Select variant" /></SelectTrigger>
                            <SelectContent>{adjustmentAvailableVariants.map(variant => (<SelectItem key={variant.id} value={variant.id}>{variant.name}</SelectItem>))}</SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="location-adj">Location</Label>
                      <Select
                        value={adjustmentData.locationId}
                        onValueChange={(value) => setAdjustmentData(prev => ({ ...prev, locationId: value, inventoryItemId: '' }))}
                      >
                        <SelectTrigger id="location-adj"><SelectValue placeholder="Select location" /></SelectTrigger>
                        <SelectContent>{allLocations.map(loc => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="lot-adj">Lot</Label>
                      <Select
                        value={adjustmentData.inventoryItemId}
                        onValueChange={(value) => setAdjustmentData(prev => ({ ...prev, inventoryItemId: value }))}
                      >
                        <SelectTrigger id="lot-adj"><SelectValue placeholder="Select lot" /></SelectTrigger>
                        <SelectContent>
                          {adjustmentLots.length > 0 ? (
                            adjustmentLots.map((lot) => (
                              <SelectItem key={lot.id} value={lot.id}>
                                {`${lot.lotNumber} • ${lot.quantity} • ${formatCost(lot.unitCost)}`}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="__none__" disabled>
                              No lots available
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      {adjustmentLots.length === 0 && (
                        <p className="text-xs text-muted-foreground">No lots found. Use PO receive to add new stock.</p>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground -mt-2">Current stock at this location: {currentStock} units</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="grid gap-3">
                        <Label>Adjustment Type</Label>
                        <RadioGroup value={adjustmentData.adjustmentType} onValueChange={(value: 'add' | 'remove') => setAdjustmentData(prev => ({ ...prev, adjustmentType: value }))} className="flex gap-4 items-center">
                          <Label htmlFor="add" className="flex items-center gap-2 cursor-pointer text-sm font-normal"><RadioGroupItem value="add" id="add" />Add</Label>
                          <Label htmlFor="remove" className="flex items-center gap-2 cursor-pointer text-sm font-normal"><RadioGroupItem value="remove" id="remove" />Remove</Label>
                        </RadioGroup>
                      </div>
                      <div className="grid gap-3">
                        <Label htmlFor="quantity-adj">Quantity</Label>
                        <Input id="quantity-adj" type="number" placeholder="e.g., 10" value={adjustmentData.quantity || ''} onChange={e => setAdjustmentData(prev => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))} />
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="notes-adj">Reason / Note</Label>
                      <Textarea id="notes-adj" placeholder="e.g., Damaged goods, stock count correction" value={adjustmentData.notes} onChange={e => setAdjustmentData(prev => ({ ...prev, notes: e.target.value }))} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={closeDialog} disabled={isSubmitting}>Cancel</Button>
                    <Button onClick={handleSaveAdjustment} disabled={isSubmitting}>
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save Adjustment
                    </Button>
                  </DialogFooter>
                </TabsContent>
                <TabsContent value="transfer">
                  <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-1 gap-4">
                      <div className="grid gap-3">
                        <Label htmlFor="product-transfer">Product</Label>
                        <InventoryProductPickerDialog
                          trigger={<Button variant="outline" className="w-full justify-between font-normal">
                            <span className="truncate mr-2">
                              {transferData.productId ? (productsFromItems.get(transferData.productId)?.name || 'Selected Product') : "Select product..."}
                            </span>
                            <Search className="h-4 w-4 shrink-0 opacity-50" />
                          </Button>}
                          onSelect={(item, variant, meta) => {
                            if (meta?.fromLotScan) {
                              // Auto-fill from lot scan
                              setTransferData(prev => ({
                                ...prev,
                                productId: item.productId,
                                variantId: item.variantId || '',
                                fromLocationId: item.locationId,
                                inventoryItemId: (item as any).id || '',
                                quantity: item.quantity
                              }));
                              return;
                            }
                            handleAdjustmentProductChange(item.productId);
                            setTransferData(prev => ({
                              ...prev,
                              productId: item.productId,
                              variantId: variant?.id || '',
                              inventoryItemId: ''
                            }));
                          }}
                        />
                      </div>
                      {transferAvailableVariants.length > 0 && (
                        <div className="grid gap-3">
                          <Label htmlFor="variant-transfer">Variant</Label>
                          <Select
                            value={transferData.variantId}
                            onValueChange={(value) => setTransferData(prev => ({ ...prev, variantId: value, inventoryItemId: '' }))}
                          >
                            <SelectTrigger id="variant-transfer"><SelectValue placeholder="Select variant" /></SelectTrigger>
                            <SelectContent>{transferAvailableVariants.map(variant => (<SelectItem key={variant.id} value={variant.id}>{variant.name}</SelectItem>))}</SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="grid gap-3">
                        <Label htmlFor="from-location">From Location</Label>
                        <Select
                          value={transferData.fromLocationId}
                          onValueChange={(value) => setTransferData(prev => ({ ...prev, fromLocationId: value, inventoryItemId: '' }))}
                        >
                          <SelectTrigger id="from-location"><SelectValue placeholder="Select source" /></SelectTrigger>
                          <SelectContent>{allLocations.map(loc => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}</SelectContent>
                        </Select>
                        <p className="text-sm text-muted-foreground -mt-1">Available: {transferSourceStock} units</p>
                      </div>
                      <div className="grid gap-3">
                        <Label htmlFor="to-location">To Location</Label>
                        <Select value={transferData.toLocationId} onValueChange={(value) => setTransferData(prev => ({ ...prev, toLocationId: value }))}>
                          <SelectTrigger id="to-location"><SelectValue placeholder="Select destination" /></SelectTrigger>
                          <SelectContent>{allLocations.map(loc => (<SelectItem key={loc.id} value={loc.id} disabled={loc.id === transferData.fromLocationId}>{loc.name}</SelectItem>))}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="lot-transfer">Lot</Label>
                      <Select
                        value={transferData.inventoryItemId}
                        onValueChange={(value) => setTransferData(prev => ({ ...prev, inventoryItemId: value }))}
                      >
                        <SelectTrigger id="lot-transfer"><SelectValue placeholder="Select lot" /></SelectTrigger>
                        <SelectContent>
                          {transferLots.length > 0 ? (
                            transferLots.map((lot) => (
                              <SelectItem key={lot.id} value={lot.id}>
                                {`${lot.lotNumber} • ${lot.quantity} • ${formatCost(lot.unitCost)}`}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="__none__" disabled>
                              No lots available
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      {transferLots.length === 0 && (
                        <p className="text-xs text-muted-foreground">No lots found in this location.</p>
                      )}
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="quantity-transfer">Quantity</Label>
                      <Input id="quantity-transfer" type="number" placeholder="e.g., 5" value={transferData.quantity || ''} onChange={e => setTransferData(prev => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))} max={transferSourceStock} />
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="notes-transfer">Reason / Note</Label>
                      <Textarea id="notes-transfer" placeholder="e.g., Stock for new showroom display" value={transferData.notes} onChange={e => setTransferData(prev => ({ ...prev, notes: e.target.value }))} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={closeDialog} disabled={isSubmitting}>Cancel</Button>
                    <Button onClick={handleSaveTransfer} disabled={isSubmitting}>
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save Transfer
                    </Button>
                  </DialogFooter>
                </TabsContent>
              </Tabs>
            </>
          )}

          {dialogState.mode === 'viewMovement' && dialogState.selectedItem && (
            <>
        <DialogHeader>
          <DialogTitle>Movement History</DialogTitle>
          <DialogDescription>
            View stock movement history for this product/variant.
          </DialogDescription>
        </DialogHeader>
              <div className="py-4 max-h-[60vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>SKU</TableHead>
                      {!dialogState.selectedItem.variantId && <TableHead>Variant</TableHead>}
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Global Bal.</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Notes / Ref</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isMovementLoading && movementsForDialog.length === 0 ? (
                      <TableRow>
                           <TableCell colSpan={!dialogState.selectedItem.variantId ? 9 : 8} className="h-24 text-center">
                          <Loader2 className="inline mr-2 h-4 w-4 animate-spin" /> Loading history...
                        </TableCell>
                      </TableRow>
                    ) : movementsForDialog.length === 0 ? (
                      <TableRow>
                           <TableCell colSpan={!dialogState.selectedItem.variantId ? 9 : 8} className="h-24 text-center text-muted-foreground">
                          No movement history found for this item.
                        </TableCell>
                      </TableRow>
                    ) : (
                      movementsForDialog.map((move) => (
                        <TableRow key={move.id}>
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {(() => {
                              const d = new Date(move.date);
                              return !isNaN(d.getTime()) ? format(d, 'PP p') : '-';
                            })()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="uppercase text-[10px]">
                              {move.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{move.sku || '-'}</TableCell>
                          {!dialogState.selectedItem?.variantId && (
                            <TableCell className="text-xs">
                              {move.variantName || 'Direct Stock'}
                            </TableCell>
                          )}
                          <TableCell className={cn(
                            "text-right font-medium",
                            move.quantityChange > 0 ? "text-green-600" : "text-red-600"
                          )}>
                            {move.quantityChange > 0 ? '+' : ''}{move.quantityChange}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {move.balance !== undefined ? move.balance : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {(move as any).globalBalance !== undefined ? (move as any).globalBalance : '-'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {move.user || 'System'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[300px] whitespace-normal">
                            {move.notes}
                            {move.reference && <span className="block text-[10px] opacity-70">Ref: {move.reference}</span>}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                    {isMovementLoading && movementsForDialog.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={!dialogState.selectedItem.variantId ? 9 : 8} className="text-center py-2">
                          <Loader2 className="inline h-4 w-4 animate-spin" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {movementNextCursor && (
                  <div className="mt-4 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => currentItem && loadMovementsForItem(currentItem, { append: true })}
                      disabled={isMovementLoading}
                    >
                      {isMovementLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Load More
                    </Button>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={closeDialog}>Close</Button>
              </DialogFooter>
            </>
          )}

          {dialogState.mode === 'stock' && dialogState.selectedItem && (
            <Tabs defaultValue="summary" className="w-full" onValueChange={(val) => {
              if (val === 'lots' && dialogState.selectedItem) {
                try {
                  loadLotsForSelection({
                    productId: dialogState.selectedItem.productId,
                    variantId: dialogState.selectedItem.variantId,
                    locationId: locationFilter !== 'all' ? locationFilter : null
                  });
                } catch (e) { console.error(e); }
              }
            }}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" /> Stock Details
                </DialogTitle>
                <DialogDescription>
                  {productsFromItems.get(dialogState.selectedItem.productId)?.name}
                  {dialogState.selectedItem.variantId
                    ? ` · ${productsFromItems.get(dialogState.selectedItem.productId)?.variants.find(v => v.id === dialogState.selectedItem?.variantId)?.name || 'Variant'}`
                    : ''}
                  {locationFilter !== 'all'
                    ? ` · ${allLocations.find(l => l.id === locationFilter)?.name || 'Location'}`
                    : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="px-1">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="lots">Lots</TabsTrigger>
                </TabsList>
              </div>

              <div className="py-2 max-h-[60vh] overflow-y-auto">
                <TabsContent value="summary" className="mt-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {breakdownLoading ? (
                        <TableRow>
                          <TableCell colSpan={2} className="h-24 text-center">
                            <div className="flex items-center justify-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading breakdown...</div>
                          </TableCell>
                        </TableRow>
                      ) : breakdownData.length > 0 ? (
                        <>
                          {breakdownData.map((r, idx) => (
                            <TableRow key={`${r.locationName}-${idx}`}>
                              <TableCell>{r.locationName}</TableCell>
                              <TableCell className="text-right">{r.quantity}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="font-bold bg-muted/50">
                            <TableCell>Total</TableCell>
                            <TableCell className="text-right">{breakdownData.reduce((acc, curr) => acc + curr.quantity, 0)}</TableCell>
                          </TableRow>
                        </>
                      ) : (
                        <TableRow>
                          <TableCell colSpan={2} className="h-24 text-center">No stock found for this selection.</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>

                  {/* Variant Breakdown Table (Parent Only) */}
                  {variantBreakdownItems.length > 0 && (
                    <div className="mt-6">
                      <div className="mb-2 px-2 text-sm font-semibold text-muted-foreground flex items-center gap-2">
                        <Package className="h-4 w-4" /> Variant Breakdown
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Variant</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead className="text-right">Quantity</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {variantBreakdownItems.map(v => (
                            <TableRow key={v.id}>
                              <TableCell className="font-medium">{v.name}</TableCell>
                              <TableCell className="text-muted-foreground text-xs">{v.sku}</TableCell>
                              <TableCell className="text-right">{v.quantity}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="lots" className="mt-0">
                  {lotRows.length > 0 ? (
                    <>
                      <div className="hidden sm:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Lot</TableHead>
                              <TableHead>Location</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">Unit Cost</TableHead>
                              <TableHead className="text-right">Total Cost</TableHead>
                              <TableHead>Received</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lotRows.map((lot) => (
                              <TableRow key={lot.id}>
                                <TableCell>
                                  <div className="font-medium">{lot.lotNumber}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatLotProduct(lot)}
                                  </div>
                                </TableCell>
                                <TableCell>{lot.locationName}</TableCell>
                                <TableCell className="text-right">{lot.quantity}</TableCell>
                                <TableCell className="text-right font-mono">{formatCost(lot.unitCost)}</TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatCost((lot.unitCost || 0) * lot.quantity)}
                                </TableCell>
                                <TableCell>{format(new Date(lot.receivedDate), 'PP')}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="sm:hidden space-y-3">
                        {lotRows.map((lot) => (
                          <Card key={lot.id}>
                            <CardContent className="p-4 space-y-2">
                              <div className="font-medium">{lot.lotNumber}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatLotProduct(lot)}
                              </div>
                              <div className="flex justify-between text-sm">
                                <span>Location</span>
                                <span>{lot.locationName}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span>Qty</span>
                                <span>{lot.quantity}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span>Unit Cost</span>
                                <span className="font-mono">{formatCost(lot.unitCost)}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span>Total Cost</span>
                                <span className="font-mono">{formatCost((lot.unitCost || 0) * lot.quantity)}</span>
                              </div>
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Received</span>
                                <span>{format(new Date(lot.receivedDate), 'PP')}</span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </>
                  ) : (
                    (lotStateByKey[lotKey(dialogState.selectedItem.productId, dialogState.selectedItem.variantId || null, locationFilter !== 'all' ? locationFilter : 'all')]?.isLoading) ? (
                      <div className="p-4 text-center text-sm text-muted-foreground"><Loader2 className="inline mr-2 h-4 w-4 animate-spin" /> Loading lots...</div>
                    ) : <p className="text-sm text-muted-foreground p-4 text-center">No lots found for this selection.</p>
                  )}
                </TabsContent>
              </div>

              <DialogFooter>
                <Button onClick={closeDialog}>Close</Button>
              </DialogFooter>
            </Tabs >
          )
          }
        </DialogContent >
      </Dialog >
    </div >
  );
}
