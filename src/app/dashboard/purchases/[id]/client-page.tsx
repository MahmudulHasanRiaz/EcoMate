
'use client';

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";  // Added import
import { PartnerAsyncSelect } from "@/components/partner-async-select";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Check, Printer, Package, Truck, Scissors, UploadCloud, Eye, ChevronLeft, Loader2, FileText, History, Trash2, Upload, Coins, ArrowRight, ExternalLink } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { getPurchaseOrderById } from "@/services/purchases";
import { getChartOfAccounts } from "@/services/accounting";
import { finalizeThreePieceReceiving, receivePurchaseOrderStock, updateThreePieceFabricPlanning, updateThreePieceStepCosts, upsertPurchasePayment, addPurchasePayment, deletePurchasePayment, updatePurchaseOrderOfflineInvoice, updateProductionStepInvoice } from "../actions";
import type { PurchaseOrder, PurchaseOrderLog, PurchaseOrderStatus, Supplier, Vendor, Payment, StockLocation, ProductionStep, ProductionStepType, InventoryItem, Account, StaffMemberUI } from "@/types";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { getCurrentStaff } from "@/services/staff";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";
import LotSelectionCombobox from "@/components/lot-selection-combobox";

const fmtMoney = (val: number) =>
    `Tk ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const paymentStatusColors: Record<string, string> = {
    'Paid': 'bg-emerald-500/20 text-emerald-700',
    'Partial': 'bg-amber-500/20 text-amber-700',
    'Unpaid': 'bg-red-500/20 text-red-700',
};
const statusColors: Record<string, string> = {
    'Received': 'bg-green-500/20 text-green-700',
    'Cutting': 'bg-purple-500/20 text-purple-700',
    'Printing': 'bg-yellow-500/20 text-yellow-700',
    'Fabric Ordered': 'bg-blue-500/20 text-blue-700',
    'Draft': 'bg-gray-500/20 text-gray-700',
    'Cancelled': 'bg-red-500/20 text-red-700',
};
const statusIcons: Record<string, React.ElementType> = {
    'Fabric Ordered': Package,
    'Printing': Printer,
    'Cutting': Scissors,
    'Received': Truck,
    'Cancelled': History,
    'Draft': History,
};

type FabricPartKey = 'JAMA' | 'ORNA' | 'SELOWAR';
type LotAllocation = {
    id: string;
    inventoryItemId: string;
    yards: number;
    unitCost?: number;
};
type LotAllocationsByPart = Record<FabricPartKey, LotAllocation[]>;

const emptyAllocations = (): LotAllocationsByPart => ({
    JAMA: [],
    ORNA: [],
    SELOWAR: [],
});

type EnrichedPayment = Payment & {
    physicalInvoiceUrl?: string;
};

const initialPaymentState: EnrichedPayment = { cash: 0, check: 0, checkDate: '', physicalInvoiceUrl: undefined, paidFromAccountId: null };
type BrandingSettings = {
    standardLogoUrl: string;
    iconLogoUrl: string;
    darkLogoUrl: string;
    appIconUrl: string;
};
type GeneralSettings = {
    storeName: string;
    storeAddress: string;
    currency: string;
    timezone: string;
    weightUnit: string;
    dimensionUnit: string;
};

const orderedStepTypes: ProductionStepType[] = ['FABRIC', 'PRINTING', 'CUTTING', 'FINISHING'];
const productionStepDefs = [
    { type: 'FABRIC' as ProductionStepType, id: 'fabric', name: 'Fabric', label: 'Fabric', icon: Package, description: 'Plan fabric supplier, cost, and yardage.' },
    { type: 'PRINTING' as ProductionStepType, id: 'printing', name: 'Printing', label: 'Printing', icon: Printer, description: 'Send fabric to printing, track damages.' },
    { type: 'CUTTING' as ProductionStepType, id: 'cutting', name: 'Cutting', label: 'Cutting', icon: Scissors, description: 'Cut pieces and log wastage/damage.' },
    { type: 'FINISHING' as ProductionStepType, id: 'finishing', name: 'Final Receiving', label: 'Final Receiving', icon: Truck, description: 'Receive finished goods and finalize costing.' },
];



const hasVendorType = (vendor: Vendor, type: string) => {
    if (!vendor.type) return false;
    // Case-insensitive check for robustness
    const types = vendor.type.split(',').map(t => t.trim().toLowerCase());
    return types.includes(type.toLowerCase());
};

const calculateDue = (totalCost: number, payment: EnrichedPayment) => {
    const paid = (Number(payment.cash) || 0) + (Number(payment.check) || 0);
    return totalCost - paid;
};

const initStepDraft = (step?: ProductionStep, fabricSourceOverride?: 'INTERNAL' | 'EXTERNAL') => ({
    vendorId: step?.vendorId ?? null,
    costAmount: step?.costAmount ?? 0,
    paidAmount: step?.paidAmount ?? 0,
    inputQty: step?.inputQty ?? 0,
    outputQty: step?.outputQty ?? 0,
    damagedQty: step?.damagedQty ?? 0,
    wastageQty: step?.wastageQty ?? 0,
    pindiOfFab: step?.pindiOfFab ?? null,
    invoiceUrl: step?.invoiceUrl ?? '',
    generatedInvoiceNumber: step?.generatedInvoiceNumber ?? '',
    isApproved: step?.isApproved ?? false,
    fabricSource: fabricSourceOverride ?? (step?.fabricInventoryId ? 'INTERNAL' : 'EXTERNAL'),
    fabricInventoryId: step?.fabricInventoryId ?? null,
    cuttingType: (step as any)?.cuttingType || 'EXTERNAL',
    assignedStaffId: (step as any)?.assignedStaffId || null,
    paymentAmount: (step as any)?.cuttingType === 'INTERNAL' ? (step?.costAmount ?? 0) : 0,
});

function PurchaseOrderHistory({ logs }: { logs: PurchaseOrderLog[] }) {
    const sortedLogs = React.useMemo(() => logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [logs]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Purchase Order History</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="relative">
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-border -translate-x-1/2"></div>
                    <ul className="space-y-6">
                        {sortedLogs.map((log, index) => {
                            const Icon = statusIcons[log.status] || History;
                            const isLast = index === 0;
                            return (
                                <li key={`${log.timestamp}-${index}`} className="relative flex items-start gap-4">
                                    <div className={cn(
                                        "w-8 h-8 rounded-full flex items-center justify-center bg-background border-2",
                                        isLast ? "border-primary" : "border-border"
                                    )}>
                                        <Icon className={cn("h-4 w-4", isLast ? "text-primary" : "text-muted-foreground")} />
                                    </div>
                                    <div className="flex-1 pt-1">
                                        <p className={cn("font-medium", isLast ? "text-foreground" : "text-muted-foreground")}>{log.status}</p>
                                        <p className="text-sm text-muted-foreground">{log.description}</p>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            <span>{format(new Date(log.timestamp), "MMM d, yyyy, h:mm a")}</span>
                                            {log.user && <span className="font-medium"> by {log.user}</span>}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
}

interface PurchaseOrderDetailsClientPageProps {
    initialPurchaseOrder: PurchaseOrder;
    suppliers: Supplier[];
    vendors: Vendor[];
    stockLocations: StockLocation[];
    inventoryLots?: InventoryItem[]; // Made optional
    brandingSettings: BrandingSettings;
    generalSettings: GeneralSettings;
    cuttingMasters?: StaffMemberUI[];
    partnerStats?: { partnerId: string; totalTx: number; totalPaid: number }[]; // Optional as it might be missing in initial load
}

export default function PurchaseOrderDetailsClientPage({
    initialPurchaseOrder,
    suppliers = [],
    vendors = [],
    stockLocations,
    inventoryLots,
    brandingSettings,
    generalSettings,
    cuttingMasters = [],
    partnerStats = []
}: PurchaseOrderDetailsClientPageProps) {
    const params = useParams();
    const router = useRouter();
    const poId = params.id as string;
    const { toast } = useToast();

    const [purchaseOrder, setPurchaseOrder] = useState(initialPurchaseOrder);

    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadTarget, setUploadTarget] = useState<'general' | ProductionStepType | null>(null);

    const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);
    const [isReceiving, setIsReceiving] = useState(false);
    const [selectedLocationId, setSelectedLocationId] = useState<string>(stockLocations[0]?.id || '');

    const [accounts, setAccounts] = useState<Account[]>([]);
    const [savingPaymentFor, setSavingPaymentFor] = useState<'general' | ProductionStepType | null>(null);
    const [isAdvancing, setIsAdvancing] = useState(false);
    const [savingStep, setSavingStep] = useState<ProductionStepType | null>(null);
    const [generalReceiveQty, setGeneralReceiveQty] = useState<number>(initialPurchaseOrder?.finalReceivedQty ?? initialPurchaseOrder?.items ?? 0);
    const [itemReceiveQtys, setItemReceiveQtys] = useState<Record<string, number>>({});
    const [itemWastageQtys, setItemWastageQtys] = useState<Record<string, number>>({});
    const [pindaRestates, setPindaRestates] = useState<Record<string, number[]>>({});
    const storeName = generalSettings?.storeName || 'EcoMate';
    const storeAddress = generalSettings?.storeAddress || '';
    const currencyCode = generalSettings?.currency || 'BDT';
    const currencyPrefix = currencyCode === 'USD' ? '$' : 'Tk';
    const brandLogo = brandingSettings?.standardLogoUrl || '/logo-full.svg';
    const [scanInputs, setScanInputs] = useState<Record<string, string>>({});
    const [lotDialogItemId, setLotDialogItemId] = useState<string | null>(null);

    const [localInventoryLots, setLocalInventoryLots] = useState<InventoryItem[]>(() => inventoryLots ?? []);
    const [isLoadingLots, setIsLoadingLots] = useState(false);

    // Update local state if prop changes (e.g. server refresh)
    useEffect(() => {
        if (!Array.isArray(inventoryLots)) return;
        setLocalInventoryLots(inventoryLots);
    }, [inventoryLots]);

    useEffect(() => {
        if (!Array.isArray(stockLocations) || stockLocations.length === 0) return;
        if (!selectedLocationId || !stockLocations.some((loc) => loc.id === selectedLocationId)) {
            setSelectedLocationId(stockLocations[0].id);
        }
    }, [stockLocations, selectedLocationId]);

    const refreshInventoryLots = async () => {
        setIsLoadingLots(true);
        try {
            const params = new URLSearchParams({ pageSize: '50', t: String(Date.now()) });

            // Scope to active item if dialog is open (improves performance significantly)
            // Scope to active item if dialog is open (improves performance significantly)
            const activeItem = purchaseOrder?.purchaseItems?.find(it => it.id === lotDialogItemId);
            if (activeItem) {
                if (activeItem.productId) params.set('productId', activeItem.productId);
                if (activeItem.variantId) params.set('variantId', activeItem.variantId);

                // P03d: Filter by location (prefer item specific, fallback to page selection)
                const locId = (activeItem as any).locationId || selectedLocationId;
                if (locId) params.set('locationId', locId);
            } else if (selectedLocationId) {
                // If no active item but location selected, use that
                params.set('locationId', selectedLocationId);
            }

            const res = await fetch(`/api/inventory/lots?${params.toString()}`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                let items: InventoryItem[] = [];
                // Handle different response shapes
                if (data?.items && Array.isArray(data.items)) {
                    items = data.items;
                } else if (data?.data?.items && Array.isArray(data.data.items)) {
                    items = data.data.items;
                } else if (Array.isArray(data)) {
                    items = data;
                }

                if (items.length >= 0) { // Update even if empty
                    setLocalInventoryLots(items);
                }
            }
        } catch (error) {
            console.error("Failed to refresh inventory lots", error);
        } finally {
            setIsLoadingLots(false);
        }
    };

    const inventoryLotMap = useMemo(() => new Map(localInventoryLots.map((lot) => [lot.id, lot])), [localInventoryLots]);
    const formatLotLabel = (lot: InventoryItem) => {
        const variantLabel = lot.variantName ? ` (${lot.variantName})` : '';
        return `${lot.lotNumber} - ${lot.productName}${variantLabel} (${lot.sku}) - ${lot.locationName} - ${lot.quantity}`;
    };
    const formatLotName = (lot?: InventoryItem) => {
        if (!lot) return 'Unknown Lot';
        const variantLabel = lot.variantName ? ` (${lot.variantName})` : '';
        return `${lot.productName}${variantLabel}`;
    };
    const lotPartConfigs: Array<{ key: FabricPartKey; label: string; yardsKey: 'jamaYards' | 'ornaYards' | 'selowarYards' }> = [
        { key: 'JAMA', label: 'Jama', yardsKey: 'jamaYards' },
        { key: 'ORNA', label: 'Orna', yardsKey: 'ornaYards' },
        { key: 'SELOWAR', label: 'Selowar', yardsKey: 'selowarYards' },
    ];
    const hasInternalFabricLots = useMemo(
        () => (purchaseOrder?.purchaseItems || []).some((item) => (item.fabricLotUsages || []).length > 0),
        [purchaseOrder]
    );
    const liquidAccounts = useMemo(
        () => accounts.filter((account) => account.group === 'LIQUID'),
        [accounts]
    );
    const defaultPaidAccountId = useMemo(() => {
        const cashAccount = liquidAccounts.find((account) =>
            account.name.toLowerCase().includes('cash')
        );
        return cashAccount?.id || liquidAccounts[0]?.id || null;
    }, [liquidAccounts]);

    useEffect(() => {
        getCurrentStaff()
            .then((res) => {
                if (res.status === 'ok') {
                    setUserRole(res.staff.role || 'Admin');
                    setActorName(res.staff.name || res.staff.role || 'Admin');
                }
            })
            .catch((error) => {
                console.error('[PURCHASE_STAFF_FETCH_ERROR]', error);
                setUserRole('Admin');
                setActorName('Admin');
                toast({
                    variant: 'destructive',
                    title: 'Staff info unavailable',
                    description: 'Using admin permissions for this session.',
                });
            });
    }, []);

    useEffect(() => {
        let isActive = true;
        getChartOfAccounts()
            .then((data) => {
                if (!isActive) return;
                setAccounts(Array.isArray(data) ? data : []);
            })
            .catch((error) => {
                console.error('[PURCHASE_ACCOUNTS_FETCH_ERROR]', error);
                toast({
                    variant: 'destructive',
                    title: 'Failed to load accounts',
                    description: error?.message || 'Check server logs.',
                });
            });
        return () => {
            isActive = false;
        };
    }, [toast]);

    useEffect(() => {
        if (!defaultPaidAccountId) return;

        setStepPayments((prev) => {
            const next = { ...prev };
            orderedStepTypes.forEach((type) => {
                if (!next[type]?.paidFromAccountId) {
                    next[type] = { ...next[type], paidFromAccountId: defaultPaidAccountId };
                }
            });
            return next;
        });
    }, [defaultPaidAccountId]);

    const onAddPayment = async (paymentData: any) => {
        if (!poId) return;
        const res = await addPurchasePayment({
            poId,
            payment: paymentData,
            user: actorName
        });
        if (res.success && res.purchaseOrder) {
            setPurchaseOrder(res.purchaseOrder as any);
            toast({ title: 'Payment Added', description: 'Payment recorded successfully.' });
        } else {
            toast({ variant: 'destructive', title: 'Error', description: res.message || 'Failed to add payment.' });
        }
    };

    const onDeletePayment = async (paymentId: string) => {
        if (!poId) return;
        if (!confirm('Are you sure you want to delete this payment?')) return;

        const res = await deletePurchasePayment(paymentId, poId);
        if (res.success && res.purchaseOrder) {
            setPurchaseOrder(res.purchaseOrder);
            toast({ title: 'Payment Deleted', description: 'Payment removed successfully.' });
        } else {
            toast({ variant: 'destructive', title: 'Error', description: res.message || 'Failed to delete payment.' });
        }
    };

    const uploadMemoFile = async (file: File): Promise<string> => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/uploads/purchase-memo', {
            method: 'POST',
            body: formData,
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok) {
            const msg = (data && (data.error || data.message)) || 'Upload failed';
            throw new Error(msg);
        }
        return data.url as string;
    };

    const apiJson = async <T,>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => {
        const res = await fetch(input, init);
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok) {
            const msg = (data && (data.error || data.message)) || res.statusText || 'Request failed';
            throw new Error(msg);
        }
        return data as T;
    };

    const patchProductionStep = async (stepId: string, data: any) => {
        return apiJson(`/api/production/steps/${stepId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    };

    const advanceProduction = async (purchaseOrderId: string) => {
        return apiJson(`/api/production/${purchaseOrderId}/advance`, { method: 'POST' });
    };

    type StepDraft = ReturnType<typeof initStepDraft>;

    const productionStepsByType = useMemo(() => {
        const map: Record<ProductionStepType, ProductionStep | undefined> = {
            FABRIC: undefined,
            PRINTING: undefined,
            CUTTING: undefined,
            FINISHING: undefined,
        };
        (purchaseOrder?.productionSteps || []).forEach((step) => {
            map[step.stepType as ProductionStepType] = step as any;
        });
        return map;
    }, [purchaseOrder]);

    const [stepDrafts, setStepDrafts] = useState<Record<ProductionStepType, StepDraft>>({
        FABRIC: initStepDraft(productionStepsByType.FABRIC),
        PRINTING: initStepDraft(productionStepsByType.PRINTING),
        CUTTING: initStepDraft(productionStepsByType.CUTTING),
        FINISHING: initStepDraft(productionStepsByType.FINISHING),
    });

    const hydrateStepPayments = (po?: PurchaseOrder) => ({
        FABRIC: po?.productionPayments?.FABRIC || initialPaymentState,
        PRINTING: po?.productionPayments?.PRINTING || initialPaymentState,
        CUTTING: po?.productionPayments?.CUTTING || initialPaymentState,
        FINISHING: po?.productionPayments?.FINISHING || initialPaymentState,
    });

    const [stepPayments, setStepPayments] = useState<Record<ProductionStepType, EnrichedPayment>>(hydrateStepPayments(initialPurchaseOrder));

    const [stepNotes, setStepNotes] = useState<Record<ProductionStepType, string>>({
        FABRIC: (initialPurchaseOrder?.productionSteps || []).find(s => s.stepType === 'FABRIC')?.note || '',
        PRINTING: (initialPurchaseOrder?.productionSteps || []).find(s => s.stepType === 'PRINTING')?.note || '',
        CUTTING: (initialPurchaseOrder?.productionSteps || []).find(s => s.stepType === 'CUTTING')?.note || '',
        FINISHING: (initialPurchaseOrder?.productionSteps || []).find(s => s.stepType === 'FINISHING')?.note || '',
    });

    type ThreePieceItemDraft = {
        id: string;
        productId: string;
        variantId?: string | null;
        productName: string;
        variantName?: string | null;
        sku?: string | null;
        quantity: number;
        finalQty: number; // This will represent the total production target (qty - dmg - wastage)
        receivedQty: number; // Historical already received
        receivingNow: number; // Current batch input in UI
        jamaYards: number;
        jamaRate: number;
        ornaYards: number;
        ornaRate: number;
        selowarYards: number;
        selowarRate: number;
        printingCost: number;
        printingDamagedQty: number;
        cuttingCost: number;
        cuttingDamagedQty: number;
        lotAllocations: LotAllocationsByPart;
        imageUrl: string | null;
        finishingWastageQty: number;
    };

    const computeRateFromAllocations = (allocations: LotAllocation[]) => {
        const totals = allocations.reduce(
            (acc, alloc) => {
                const yards = Number(alloc.yards) || 0;
                if (yards <= 0) return acc;
                // If the allocation has a unitCost (e.g. from DB FabricLotUsage), use it.
                // Otherwise fallback to inventoryLotMap
                const cost = alloc.unitCost ?? (inventoryLotMap.get(alloc.inventoryItemId)?.unitCost || 0);
                acc.yards += yards;
                acc.cost += yards * Number(cost);
                return acc;
            },
            { yards: 0, cost: 0 }
        );
        return totals.yards > 0 ? totals.cost / totals.yards : 0;
    };

    const toThreePieceDrafts = (po?: PurchaseOrder): ThreePieceItemDraft[] => {
        const items = po?.purchaseItems || [];
        return items.map((it) => {
            const lotAllocations = emptyAllocations();
            (it.fabricLotUsages || []).forEach((usage) => {
                const part = usage.part as FabricPartKey;
                if (!lotAllocations[part]) return;
                lotAllocations[part].push({
                    id: usage.id,
                    inventoryItemId: usage.inventoryItemId,
                    yards: Number(usage.yards) || 0,
                    unitCost: (usage as any).unitCost || 0,
                });
            });

            const qty = Number(it.quantity) || 0;
            const received = Number(it.receivedQty) || 0;
            const printDmg = (it as any).printingDamagedQty || 0;
            const cutDmg = (it as any).cuttingDamagedQty || 0;
            const finWastage = (it as any).finishingWastageQty || 0;

            // Calculate target production quantity
            const targetProductionTotal = Math.max(0, qty - printDmg - cutDmg - finWastage);
            const remaining = Math.max(0, targetProductionTotal - received);

            let jamaRate = Number(it.jamaRate) || 0;
            let ornaRate = Number(it.ornaRate) || 0;
            let selowarRate = Number(it.selowarRate) || 0;

            // Fallback: If rate is 0 but we have lot allocations, compute rate from lots
            if (jamaRate === 0 && lotAllocations.JAMA.length > 0) jamaRate = computeRateFromAllocations(lotAllocations.JAMA);
            if (ornaRate === 0 && lotAllocations.ORNA.length > 0) ornaRate = computeRateFromAllocations(lotAllocations.ORNA);
            if (selowarRate === 0 && lotAllocations.SELOWAR.length > 0) selowarRate = computeRateFromAllocations(lotAllocations.SELOWAR);

            return {
                id: it.id,
                productId: it.productId,
                productName: it.productName,
                variantId: it.variantId,
                variantName: it.variantName,
                sku: it.sku,
                quantity: qty,
                receivedQty: received,
                // finalQty in DB currently stores the total target.
                finalQty: (it.finalQty !== null && it.finalQty !== undefined) ? it.finalQty : targetProductionTotal,
                receivingNow: remaining, // Default to remaining for this batch
                jamaYards: Number(it.jamaYards) || 0,
                jamaRate,
                ornaYards: Number(it.ornaYards) || 0,
                ornaRate,
                selowarYards: Number(it.selowarYards) || 0,
                selowarRate,
                printingCost: (Number(it.printingCost) || 0) / (qty || 1),
                printingDamagedQty: printDmg,
                cuttingCost: (Number(it.cuttingCost) || 0) / (Math.max(1, qty - printDmg - cutDmg) || 1),
                cuttingDamagedQty: cutDmg,
                finishingWastageQty: finWastage,
                lotAllocations,
                imageUrl: it.imageUrl || null,
            };
        });
    };

    const [threePieceItems, setThreePieceItems] = useState<ThreePieceItemDraft[]>(toThreePieceDrafts(initialPurchaseOrder));
    const activeLotItem = useMemo(
        () => threePieceItems.find((item) => item.id === lotDialogItemId) || null,
        [threePieceItems, lotDialogItemId]
    );

    useEffect(() => {
        const fabricSourceOverride = hasInternalFabricLots ? 'INTERNAL' : undefined;
        setStepDrafts({
            FABRIC: initStepDraft(productionStepsByType.FABRIC, fabricSourceOverride),
            PRINTING: initStepDraft(productionStepsByType.PRINTING),
            CUTTING: initStepDraft(productionStepsByType.CUTTING),
            FINISHING: initStepDraft(productionStepsByType.FINISHING),
        });
    }, [productionStepsByType, hasInternalFabricLots]);
    useEffect(() => {
        if (purchaseOrder) {
            setGeneralReceiveQty(purchaseOrder.finalReceivedQty ?? purchaseOrder.items ?? 0);
            const qtys: Record<string, number> = {};
            (purchaseOrder.purchaseItems || []).forEach(item => {
                const remaining = (Number(item.quantity) || 0) - (Number(item.receivedQty) || 0) - (Number(item.generalWastageQty) || 0);
                qtys[item.id] = Math.max(0, remaining);
            });
            setItemReceiveQtys(qtys);
            setItemWastageQtys({});
        }
    }, [purchaseOrder]);

    useEffect(() => {
        setStepPayments(hydrateStepPayments(purchaseOrder));

    }, [purchaseOrder]);

    useEffect(() => {
        setThreePieceItems(toThreePieceDrafts(purchaseOrder));
    }, [purchaseOrder]);

    // EFFECT: Hydrate Pinda Restates from DB
    // DISABLED (P47bu): The DB `pindaBreakdown` field stores the *last received* breakdown (or cumulative).
    // Loading this into the input state (`pindaRestates`) causes the "Receive" dialog to pre-fill with
    // quantities that have *already been received*, leading to confusion and potential double-receiving.
    // By disabling this, the inputs start empty for every new receive action, which is the desired behavior.
    /*
    useEffect(() => {
        if (purchaseOrder?.purchaseItems) {
            const overrides: Record<string, number[]> = {};
            purchaseOrder.purchaseItems.forEach(item => {
                const breakdown = (item as any).pindaBreakdown;
                if (Array.isArray(breakdown) && breakdown.length > 0) {
                    overrides[item.id] = [...breakdown];
                }
            });
            setPindaRestates(overrides);
        }
    }, [purchaseOrder]);
    */

    useEffect(() => {
        if (stepDrafts.FABRIC.fabricSource !== 'INTERNAL') return;
        setThreePieceItems(prev =>
            prev.map((item) => ({
                ...item,
                jamaRate: computeRateFromAllocations(item.lotAllocations.JAMA),
                ornaRate: computeRateFromAllocations(item.lotAllocations.ORNA),
                selowarRate: computeRateFromAllocations(item.lotAllocations.SELOWAR),
            }))
        );
    }, [stepDrafts.FABRIC.fabricSource, inventoryLotMap]);

    const isThreePiece = purchaseOrder?.type === 'three-piece';

    const fabricTotalDraft = useMemo(() => {
        return threePieceItems.reduce((sum, it) => {
            const jama = (Number(it.jamaYards) || 0) * (Number(it.jamaRate) || 0);
            const orna = (Number(it.ornaYards) || 0) * (Number(it.ornaRate) || 0);
            const selowar = (Number(it.selowarYards) || 0) * (Number(it.selowarRate) || 0);
            return sum + jama + orna + selowar;
        }, 0);
    }, [threePieceItems]);

    const fabricTotalYardsDraft = useMemo(() => {
        return threePieceItems.reduce((sum, it) => {
            return sum + (Number(it.jamaYards) || 0) + (Number(it.ornaYards) || 0) + (Number(it.selowarYards) || 0);
        }, 0);
    }, [threePieceItems]);

    const printingTotalDraft = useMemo(
        () => threePieceItems.reduce((sum, it) => {
            const qty = Number(it.quantity) || 0;
            const dmg = Number(it.printingDamagedQty) || 0;
            const billable = Math.max(0, qty - dmg);
            return sum + ((Number(it.printingCost) || 0) * billable);
        }, 0),
        [threePieceItems]
    );

    const cuttingTotalDraft = useMemo(() => {
        if (stepDrafts.CUTTING.cuttingType === 'INTERNAL') {
            return Number(stepDrafts.CUTTING.paymentAmount) || 0;
        }
        return threePieceItems.reduce((sum, it) => {
            const qty = Number(it.quantity) || 0;
            const pDmg = Number(it.printingDamagedQty) || 0;
            const cDmg = Number(it.cuttingDamagedQty) || 0;
            const billable = Math.max(0, qty - pDmg - cDmg);
            return sum + (billable * (Number(it.cuttingCost) || 0));
        }, 0);
    }, [threePieceItems, stepDrafts.CUTTING]);

    const finishedQtyDraft = useMemo(() => {
        return threePieceItems.reduce((sum, it) => {
            return sum + (Number(it.receivingNow) || 0);
        }, 0);
    }, [threePieceItems]);

    const finishingQty = isThreePiece
        ? finishedQtyDraft
        : Object.values(itemReceiveQtys).reduce((sum, q) => sum + (Number(q) || 0), 0);

    const productionCostTotal = isThreePiece
        ? Number(purchaseOrder?.total) || (fabricTotalDraft + printingTotalDraft + cuttingTotalDraft)
        : Number(purchaseOrder?.total) || 0;

    const productionPaidTotal = useMemo(() => {
        const payments = purchaseOrder?.payments || [];
        const stepPaidTotal = payments.reduce((sum, p) => {
            const key = (p.paymentFor || '').toUpperCase();
            const isStep =
                Boolean(p.productionStepId) ||
                key === 'FABRIC' ||
                key === 'PRINTING' ||
                key === 'CUTTING';
            if (!isStep) return sum;
            const passedAmount = (p.checkStatus === 'Passed') ? (Number(p.check) || 0) : 0;
            return sum + (Number(p.cash) || 0) + passedAmount;
        }, 0);
        const fabricPaid = payments.reduce((sum, p) => {
            const key = (p.paymentFor || '').toUpperCase();
            if (key === 'FABRIC') {
                return sum + (Number(p.cash) || 0) + (Number(p.check) || 0);
            }
            return sum;
        }, 0);
        const internalFabricPaid = hasInternalFabricLots
            ? Math.max(0, (stepDrafts.FABRIC?.costAmount || 0) - fabricPaid)
            : 0;
        return stepPaidTotal + internalFabricPaid;
    }, [purchaseOrder, hasInternalFabricLots, stepDrafts.FABRIC?.costAmount]);

    const productionDue = productionCostTotal - productionPaidTotal;
    const perUnitCost = finishedQtyDraft > 0 ? productionCostTotal / finishedQtyDraft : 0;
    const stepLogStatuses: PurchaseOrderStatus[] = ['Fabric Ordered', 'Printing', 'Cutting', 'Received'] as any;
    const productionLogs = (purchaseOrder?.logs || []).filter(log => stepLogStatuses.includes(log.status));


    const [userRole, setUserRole] = useState<string>('Admin');
    const [actorName, setActorName] = useState<string>('Admin');

    const handleGenerateGeneralInvoice = () => {
        if (!purchaseOrder) return;
        if (typeof window === 'undefined') return;

        const w = window.open('', '_blank', 'width=900,height=1100');
        if (!w) {
            toast({ variant: 'destructive', title: 'Popup blocked', description: 'Allow popups to generate invoice.' });
            return;
        }

        const orderDate = format(new Date(purchaseOrder.date), 'PPP');
        // Calculate total paid from linked payments (excluding bounced/cancelled)
        const paidTotal = (purchaseOrder.payments || []).reduce((sum, p) => {
            if (p.checkStatus === 'Bounced' || p.checkStatus === 'Cancelled') return sum;
            const passedAmount = (p.checkStatus === 'Passed') ? (Number(p.check) || 0) : 0;
            return sum + (Number(p.cash) || 0) + passedAmount;
        }, 0);
        const due = Math.max(0, purchaseOrder.total - paidTotal);
        const items = (purchaseOrder.lineItems && purchaseOrder.lineItems.length > 0)
            ? purchaseOrder.lineItems
            : [{
                productName: 'Items (Fallback)',
                sku: null,
                quantity: purchaseOrder.items || 1,
                unitCost: purchaseOrder.total / Math.max(purchaseOrder.items || 1, 1),
                lineTotal: purchaseOrder.total,
            }];
        console.log("Invoice Items:", items);
        const totalPinda = items.reduce((sum, item) => sum + ((item as any).pindaCount || 0), 0);
        const businessName = storeName || 'Your Business';
        const logoUrl = (() => {
            const logo = brandLogo || '/logo-full.svg';
            try {
                return new URL(logo, window.location.origin).toString();
            } catch {
                return logo;
            }
        })();

        // Preload logo and embed as data URL to avoid print-time missing image
        const loadLogoAsDataUrl = async (): Promise<string> => {
            try {
                const res = await fetch(logoUrl);
                if (!res.ok) return logoUrl;
                const blob = await res.blob();
                return await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                });
            } catch {
                return logoUrl;
            }
        };

        const fmtInvoiceMoney = (val: number) =>
            `${currencyPrefix} ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        loadLogoAsDataUrl().then((logoDataUrl) => {
            const html = `
                <html>
                  <head>
                    <title>Invoice - ${purchaseOrder.id}</title>
                    <style>
                      :root { color-scheme: light; }
                      body { font-family: Arial, sans-serif; padding: 32px; color: #111; background: #f8fafc; }
                      h1 { margin: 0; }
                      .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
                      .brand { display: flex; align-items: center; gap: 12px; }
                      .badge { background: #eef2ff; color: #312e81; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; }
                      .meta { color: #444; margin-bottom: 16px; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 4px 12px; }
                      table { width: 100%; border-collapse: collapse; margin-top: 16px; background: white; }
                      th, td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; font-size: 14px; }
                      th { background: #f1f5f9; }
                      .summary { margin-top: 24px; width: 50%; background: white; border: 1px solid #e2e8f0; }
                      .summary td { border: none; padding: 8px 12px; }
                      .right { text-align: right; }
                      .footer { margin-top: 28px; font-size: 12px; color: #555; }
                    </style>
                  </head>
                  <body>
                    <div class="header">
                      <div class="brand">
                        ${logoDataUrl ? `<img data-logo="true" src="${logoDataUrl}" alt="${businessName} logo" style="width:48px;height:48px;object-fit:contain;border-radius:8px;border:1px solid #e2e8f0;" />` : ''}
                        <div>
                          <div style="font-weight:700;font-size:20px;">${businessName}</div>
                          <div style="color:#64748b;font-size:12px;">Purchase Invoice</div>
                          ${storeAddress ? `<div style="color:#94a3b8;font-size:11px;">${storeAddress}</div>` : ''}
                        </div>
                      </div>
                      <div class="badge">PO ${purchaseOrder.id}</div>
                    </div>
                    <div class="meta">
                      <div><strong>Date:</strong> ${orderDate}</div>
                      <div><strong>Supplier:</strong> ${purchaseOrder.supplierId || 'N/A'}</div>
                      <div><strong>Payment Status:</strong> ${purchaseOrder.paymentStatus}</div>
                      <div><strong>Status:</strong> ${purchaseOrder.status}</div>
                      ${totalPinda > 0 ? `<div><strong>Total Pinda:</strong> ${totalPinda}</div>` : ''}
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th style="width: 40%;">Product</th>
                          <th style="width: 15%;">SKU</th>
                          <th style="width: 15%;">Qty</th>
                          <th style="width: 15%;">Unit Cost</th>
                          <th style="width: 15%;">Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${items.map(item => {
                const pindaInfo = ((item as any).pindaBreakdown && Array.isArray((item as any).pindaBreakdown) && (item as any).pindaBreakdown.length > 0)
                    ? `<div style="font-size:11px;color:#666;margin-top:4px;">
                                       ${(item as any).pindaBreakdown.length} Pinda (${(item as any).pindaBreakdown.join(', ')})
                                     </div>`
                    : '';
                return `
                                  <tr>
                                    <td>
                                        <div>${item.productName}</div>
                                        ${pindaInfo}
                                    </td>
                                    <td>${item.sku || '-'}</td>
                                    <td>${item.quantity}</td>
                                    <td class="right">${fmtInvoiceMoney(item.unitCost)}</td>
                                    <td class="right">${fmtInvoiceMoney(item.lineTotal)}</td>
                                  </tr>
                              `;
            }).join('')}
                      </tbody>
                    </table>
                    <table class="summary">
                      <tr><td><strong>Total Bill:</strong></td><td class="right"><strong>${fmtInvoiceMoney(purchaseOrder.total)}</strong></td></tr>
                      <tr><td><strong>Paid Total:</strong></td><td class="right"><strong>${fmtInvoiceMoney(paidTotal)}</strong></td></tr>
                      <tr><td><strong>Due:</strong></td><td class="right"><strong>${fmtInvoiceMoney(due)}</strong></td></tr>
                    </table>
                    <div class="footer">Thank you for doing business with ${businessName}. Please keep this invoice for your records.</div>
                  </body>
                </html>
            `;
            w.document.write(html);
            w.document.close();

            const doPrint = () => {
                try { w.focus(); } catch { }
                try { w.print(); } catch { }
            };

            // Wait for logo to finish loading to avoid blank placeholders
            const logoEl = w.document.querySelector('img[data-logo]');
            if (logoEl) {
                let printed = false;
                const done = () => {
                    if (printed) return;
                    printed = true;
                    doPrint();
                };
                logoEl.addEventListener('load', done, { once: true });
                logoEl.addEventListener('error', done, { once: true });
                // Fallback in case load doesn't fire quickly
                setTimeout(done, 600);
            } else {
                setTimeout(doPrint, 200);
            }
        }).catch(() => {
            w.close();
            toast({ variant: 'destructive', title: 'Invoice failed', description: 'Could not generate invoice preview.' });
        });
    };

    const handleReceiveStock = async () => {
        if (!purchaseOrder || !selectedLocationId) {
            toast({ variant: 'destructive', title: 'Error', description: 'Please select a location and ensure quantity is greater than 0.' });
            return;
        }

        const qtyToReceive = isThreePiece
            ? (stepDrafts.FINISHING.outputQty || 0)
            : Object.values(itemReceiveQtys).reduce((sum, q) => sum + (Number(q) || 0), 0) + Object.values(itemWastageQtys).reduce((sum, q) => sum + (Number(q) || 0), 0);

        // For non-three-piece, we sum the actual inputs which represent QTY TO RECEIVE NOW
        const currentQtyToReceive = isThreePiece ? qtyToReceive : (Object.values(itemReceiveQtys).reduce((sum, q) => sum + (Number(q) || 0), 0) + Object.values(itemWastageQtys).reduce((sum, q) => sum + (Number(q) || 0), 0));

        if (currentQtyToReceive <= 0) {
            toast({ variant: 'destructive', title: 'Error', description: 'Please enter a quantity greater than 0.' });
            return;
        }

        if (isThreePiece) {
            const finishingStep = productionStepsByType.FINISHING;
            if (!finishingStep) {
                toast({ variant: 'destructive', title: 'Missing finishing step', description: 'Initialize production steps before receiving.' });
                return;
            }
            setIsReceiving(true);
            try {
                await patchProductionStep(finishingStep.id, stepDrafts.FINISHING);
            } catch (error: any) {
                toast({
                    variant: 'destructive',
                    title: 'Save failed',
                    description: error?.message || 'Could not save finishing step before receiving.',
                });
                setIsReceiving(false);
                return;
            }
        } else {
            setIsReceiving(true);
        }

        const result = await receivePurchaseOrderStock({
            purchaseOrderId: purchaseOrder.id,
            locationId: selectedLocationId,
            items: isThreePiece ? [] : Object.entries(itemReceiveQtys).map(([itemId, qty]) => ({
                itemId,
                quantity: qty,
                wastageQty: itemWastageQtys[itemId] || 0,
                pindaBreakdown: pindaRestates[itemId]
            })),
            user: actorName || 'Admin'
        });

        if (result.success) {
            toast({ title: 'Success', description: 'Stock received and inventory updated.' });
            await refreshInventoryLots(); // Fetch new lots immediately
            const updatedPO = await refreshPurchaseOrder();
            if (updatedPO) {
                const updatedHasInternal = (updatedPO.purchaseItems || []).some(
                    (item) => (item.fabricLotUsages || []).length > 0
                );
                setGeneralReceiveQty(updatedPO.finalReceivedQty ?? updatedPO.items ?? qtyToReceive);
                setStepDrafts({
                    FABRIC: initStepDraft(updatedPO.productionSteps.find(s => s.stepType === 'FABRIC') as any, updatedHasInternal ? 'INTERNAL' : undefined),
                    PRINTING: initStepDraft(updatedPO.productionSteps.find(s => s.stepType === 'PRINTING') as any),
                    CUTTING: initStepDraft(updatedPO.productionSteps.find(s => s.stepType === 'CUTTING') as any),
                    FINISHING: initStepDraft(updatedPO.productionSteps.find(s => s.stepType === 'FINISHING') as any),
                });
            }
            setIsReceiveDialogOpen(false);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to receive stock.' });
        }
        setIsReceiving(false);
    };

    const handlePaymentChange = (setter: React.Dispatch<React.SetStateAction<EnrichedPayment>>, field: keyof EnrichedPayment, value: string | number | null) => {
        setter(prev => ({ ...prev, [field]: value }));
    };

    const handleStepPaymentChange = (type: ProductionStepType, field: keyof EnrichedPayment, value: string | number | null) => {
        setStepPayments(prev => ({
            ...prev,
            [type]: { ...prev[type], [field]: value },
        }));
    };

    const generalPayment = useMemo<EnrichedPayment>(
        () => purchaseOrder?.payment ?? initialPaymentState,
        [purchaseOrder]
    );

    const generalDue = useMemo(() => {
        const totalPaid = (purchaseOrder?.payments || []).reduce((sum, p) => {
            const passedAmount = (p.checkStatus === 'Passed') ? (Number(p.check) || 0) : 0;
            return sum + (Number(p.cash) || 0) + passedAmount;
        }, 0);
        return (purchaseOrder?.total || 0) - totalPaid;
    }, [purchaseOrder]);
    const stepDue = (type: ProductionStepType) => {
        const cost = stepDrafts[type]?.costAmount || 0;
        const paid = (Number(stepPayments[type]?.cash) || 0) + (Number(stepPayments[type]?.check) || 0);
        return cost - paid;
    };

    const supplier = useMemo(() => (suppliers || []).find(s => s.name === purchaseOrder?.supplier), [suppliers, purchaseOrder]);

    const canUserInteract = () => userRole === 'Admin' || userRole === 'Manager';

    const handleStepDraftChange = (type: ProductionStepType, field: keyof StepDraft, value: any) => {
        setStepDrafts(prev => ({
            ...prev,
            [type]: { ...prev[type], [field]: value },
        }));
    };

    const handleFabricSourceChange = (value: 'INTERNAL' | 'EXTERNAL') => {
        setStepDrafts(prev => ({
            ...prev,
            FABRIC: {
                ...prev.FABRIC,
                fabricSource: value,
                fabricInventoryId: null,
            },
        }));
    };

    const refreshPurchaseOrder = async () => {
        try {
            const updated = await getPurchaseOrderById(poId);
            if (!updated) {
                toast({ variant: 'destructive', title: 'Refresh failed', description: 'Unable to load the latest purchase order.' });
                return undefined;
            }
            setPurchaseOrder(updated);
            return updated;
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Refresh failed', description: error?.message || 'Unable to load the latest purchase order.' });
            return undefined;
        }
    };

    const updateThreePieceItemDraft = (itemId: string, patch: Partial<ThreePieceItemDraft>) => {
        setThreePieceItems((prev) =>
            prev.map((it) => {
                if (it.id !== itemId) return it;
                const next = { ...it, ...patch };
                // Auto-calc finalQty if relevant fields change
                const qty = Number(next.quantity) || 0;
                const pDmg = Number(next.printingDamagedQty) || 0;
                const cDmg = Number(next.cuttingDamagedQty) || 0;
                const fWst = Number(next.finishingWastageQty) || 0;
                next.finalQty = Math.max(0, qty - pDmg - cDmg - fWst);
                return next;
            })
        );
    };


    const updateLotAllocations = (itemId: string, part: FabricPartKey, updater: (prev: LotAllocation[]) => LotAllocation[]) => {
        setThreePieceItems(prev =>
            prev.map(item => {
                if (item.id !== itemId) return item;
                const nextAllocations = updater(item.lotAllocations[part]);
                const lotAllocations = { ...item.lotAllocations, [part]: nextAllocations };
                let jamaRate = item.jamaRate;
                let ornaRate = item.ornaRate;
                let selowarRate = item.selowarRate;
                if (stepDrafts.FABRIC.fabricSource === 'INTERNAL') {
                    jamaRate = computeRateFromAllocations(lotAllocations.JAMA);
                    ornaRate = computeRateFromAllocations(lotAllocations.ORNA);
                    selowarRate = computeRateFromAllocations(lotAllocations.SELOWAR);
                }
                return {
                    ...item,
                    lotAllocations,
                    jamaRate,
                    ornaRate,
                    selowarRate,
                };
            })
        );
    };

    const addLotAllocation = (itemId: string, part: FabricPartKey, inventoryItemId: string) => {
        updateLotAllocations(itemId, part, (prev) => {
            if (prev.some((a) => a.inventoryItemId === inventoryItemId)) return prev;
            return [...prev, { id: `alloc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, inventoryItemId, yards: 0 }];
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

    const handleScanLot = async (itemId: string, part: FabricPartKey, lotNumber: string) => {
        const trimmed = lotNumber.trim();
        if (!trimmed) return;

        // 1. Try local search
        let matches = localInventoryLots.filter((lot) => lot.lotNumber.toLowerCase() === trimmed.toLowerCase());

        // 2. If not found, try server search (Smart Strategy)
        if (matches.length === 0) {
            try {
                const res = await fetch(`/api/inventory/lots?search=${encodeURIComponent(trimmed)}&pageSize=10`, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    const foundItems = data.items || data.data?.items || (Array.isArray(data) ? data : []);

                    if (foundItems.length > 0) {
                        // Filter strict match from server results (in case of partial matches)
                        const exactMatches = foundItems.filter((lot: InventoryItem) => lot.lotNumber.toLowerCase() === trimmed.toLowerCase());

                        if (exactMatches.length > 0) {
                            matches = exactMatches;
                            // Add to local state so it appears in dropdown/UI
                            setLocalInventoryLots(prev => {
                                const exists = prev.some(p => p.id === exactMatches[0].id);
                                return exists ? prev : [...prev, ...exactMatches];
                            });
                        }
                    }
                }
            } catch (err) {
                console.error("Smart scan failed", err);
            }
        }

        if (matches.length === 0) {
            toast({ variant: "destructive", title: "Lot not found", description: "No matching lot number in inventory (checked server)." });
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
        addLotAllocation(itemId, part, matches[0].id);
        setScanInputs((prev) => ({ ...prev, [`${itemId}-${part}`]: '' }));
    };

    const handleSaveFabricPlanningStep = async () => {
        if (!purchaseOrder) return;
        const printingVendorId = stepDrafts.PRINTING.vendorId;
        if (!printingVendorId) {
            toast({
                variant: 'destructive',
                title: 'Printing vendor required',
                description: 'Select a printing vendor before saving fabric planning.',
            });
            return;
        }
        const fabricSource = stepDrafts.FABRIC.fabricSource || 'EXTERNAL';
        if (fabricSource === 'INTERNAL') {
            const invalidAllocation = threePieceItems.find((item) => {
                const checks: Array<{ part: FabricPartKey; required: number }> = [
                    { part: 'JAMA', required: Number(item.jamaYards) || 0 },
                    { part: 'ORNA', required: Number(item.ornaYards) || 0 },
                    { part: 'SELOWAR', required: Number(item.selowarYards) || 0 },
                ];
                return checks.some(({ part, required }) => {
                    const allocated = item.lotAllocations[part].reduce((sum, alloc) => sum + (Number(alloc.yards) || 0), 0);
                    return allocated !== required;
                });
            });

            if (invalidAllocation) {
                toast({
                    variant: 'destructive',
                    title: 'Lot allocation mismatch',
                    description: 'Allocated yards must exactly match Jama/Orna/Selowar yards for each item.',
                });
                return;
            }
        }

        setSavingStep('FABRIC');
        try {
            const result = await updateThreePieceFabricPlanning({
                purchaseOrderId: purchaseOrder.id,
                printingVendorId,
                pindiOfFab: stepDrafts.FABRIC.pindiOfFab,
                fabricSource,
                items: threePieceItems.map((it) => ({
                    id: it.id,
                    productId: it.productId,
                    variantId: it.variantId ?? null,
                    quantity: Number(it.quantity) || 0,
                    jamaYards: Number(it.jamaYards) || 0,
                    jamaRate: Number(it.jamaRate) || 0,
                    ornaYards: Number(it.ornaYards) || 0,
                    ornaRate: Number(it.ornaRate) || 0,
                    selowarYards: Number(it.selowarYards) || 0,
                    selowarRate: Number(it.selowarRate) || 0,
                    lotAllocations: fabricSource === 'INTERNAL'
                        ? Object.entries(it.lotAllocations).flatMap(([part, allocations]) =>
                            allocations
                                .filter((alloc) => (Number(alloc.yards) || 0) > 0)
                                .map((alloc) => ({
                                    part: part as 'JAMA' | 'ORNA' | 'SELOWAR',
                                    inventoryItemId: alloc.inventoryItemId,
                                    yards: Number(alloc.yards) || 0,
                                }))
                        )
                        : [],
                })),
                user: actorName || userRole,
            });

            if (!result.success) {
                toast({ variant: 'destructive', title: 'Save failed', description: result.message || 'Could not save fabric planning.' });
                return;
            }

            await refreshPurchaseOrder();
            toast({ title: 'Saved', description: 'Fabric planning updated.' });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Save failed', description: error?.message || 'Could not save fabric planning.' });
        } finally {
            setSavingStep(null);
        }
    };

    const handleSavePrintingStep = async () => {
        if (!purchaseOrder) return;
        const printingVendorId = productionStepsByType.PRINTING?.vendorId || stepDrafts.PRINTING.vendorId;
        if (!printingVendorId) {
            toast({ variant: 'destructive', title: 'Printing vendor missing', description: 'Set a printing vendor in the Fabric step first.' });
            return;
        }

        // Validate Cutting setup (Next step)
        const cuttingType = stepDrafts.CUTTING.cuttingType;
        if (cuttingType === 'EXTERNAL' && !stepDrafts.CUTTING.vendorId) {
            toast({ variant: 'destructive', title: 'Cutting vendor required', description: 'Select a cutting vendor for the next step.' });
            return;
        }
        if (cuttingType === 'INTERNAL' && !stepDrafts.CUTTING.assignedStaffId) {
            toast({ variant: 'destructive', title: 'Cutting Internal Master required', description: 'Select an internal master for cutting.' });
            return;
        }

        setSavingStep('PRINTING');
        try {
            // 1. Update Printing Step (Cost, Damage, Note) via Core Action
            const result = await updateThreePieceStepCosts({
                purchaseOrderId: purchaseOrder.id,
                stepType: 'PRINTING',
                items: threePieceItems.map((it) => {
                    const qty = Number(it.quantity) || 0;
                    const dmg = Number(it.printingDamagedQty) || 0;
                    const billable = Math.max(0, qty - dmg);
                    const rate = Number(it.printingCost) || 0;
                    return {
                        id: it.id,
                        damageQty: dmg,
                        cost: billable * rate // Total cost for the line
                    };
                }),
                // Note: We don't send costAmount here, the server calculates it from items.
                // We send damagedYards = 0 or null because we track per-item damage now.
                damagedYards: 0,
                note: stepNotes.PRINTING,
                user: actorName || userRole,
                vendorId: stepDrafts.PRINTING.vendorId,
            });

            if (!result.success) throw new Error(result.message);

            // 2. Update Cutting Step (Draft Configuration for Next Step)
            // 2. Update Cutting Step (Draft Configuration for Next Step)
            if (productionStepsByType.CUTTING) {
                await patchProductionStep(productionStepsByType.CUTTING.id, {
                    vendorId: cuttingType === 'EXTERNAL' ? stepDrafts.CUTTING.vendorId : null,
                    assignedStaffId: cuttingType === 'INTERNAL' ? stepDrafts.CUTTING.assignedStaffId : null,
                    cuttingType: cuttingType,
                });
            }

            await refreshPurchaseOrder();
            toast({ title: 'Saved', description: 'Printing step updated.' });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Save failed', description: error?.message || 'Could not save printing step.' });
        } finally {
            setSavingStep(null);
        }
    };

    const handleCuttingTypeChange = (val: 'INTERNAL' | 'EXTERNAL') => {
        handleStepDraftChange('CUTTING', 'cuttingType', val);
        if (val === 'INTERNAL') {
            handleStepDraftChange('CUTTING', 'vendorId', null);
        } else {
            handleStepDraftChange('CUTTING', 'assignedStaffId', null);
            handleStepDraftChange('CUTTING', 'paymentAmount', 0);
        }
    };

    const handleSaveCuttingStep = async () => {
        if (!purchaseOrder) return;
        const cuttingType = stepDrafts.CUTTING.cuttingType;

        if (cuttingType === 'EXTERNAL') {
            const cuttingVendorId = stepDrafts.CUTTING.vendorId;
            if (!cuttingVendorId) {
                toast({ variant: 'destructive', title: 'Cutting vendor required', description: 'Select a cutting vendor.' });
                return;
            }
        } else {
            // Internal
            const staffId = stepDrafts.CUTTING.assignedStaffId;
            if (!staffId) {
                toast({ variant: 'destructive', title: 'Staff required', description: 'Select a master for internal cutting.' });
                return;
            }
        }

        setSavingStep('CUTTING');
        try {
            const cuttingType = stepDrafts.CUTTING.cuttingType || 'EXTERNAL';
            let itemsPayload: { id: string; cost: number; damageQty?: number }[] = [];

            if (cuttingType === 'INTERNAL') {
                // Internal cutting logic: usually a fixed payment amount or rate per piece?
                // The current UI has 'paymentAmount' for internal.
                // If it's internal, we might distribute the cost across items or just set step cost.
                // Current logic distributes it if possible, but let's stick to what updateThreePieceStepCostsCore expects.
                // If we pass items interactively, we should calculate cost per item.
                // If 'paymentAmount' is total, we divide by billable qty?
                // The legacy logic set 'costAmount' directly.
                // updateThreePieceStepCostsCore expects 'items' with 'cost'.
                // If Internal, let's distribute the 'paymentAmount' proportionally to items?
                // OR, just send 0 cost for items and rely on the server to handle 'paymentAmount'?
                // server/modules/purchases.ts:1592 calculates stepCostTotal from items.
                // So we MUST distribute the cost to items if we want the Total to be correct.

                const totalBillable = threePieceItems.reduce((sum, it) => sum + Math.max(0, (Number(it.quantity) || 0) - (Number(it.printingDamagedQty) || 0) - (Number(it.cuttingDamagedQty) || 0)), 0);
                const totalAmount = Number(stepDrafts.CUTTING.paymentAmount) || 0;

                itemsPayload = threePieceItems.map(it => {
                    const qty = Number(it.quantity) || 0;
                    const pDmg = Number(it.printingDamagedQty) || 0;
                    const cDmg = Number(it.cuttingDamagedQty) || 0;
                    const billable = Math.max(0, qty - pDmg - cDmg);
                    const portion = totalBillable > 0 ? (billable / totalBillable) * totalAmount : 0;
                    return {
                        id: it.id,
                        damageQty: cDmg,
                        cost: portion
                    };
                });
            } else {
                // External
                itemsPayload = threePieceItems.map(it => {
                    const qty = Number(it.quantity) || 0;
                    const pDmg = Number(it.printingDamagedQty) || 0;
                    const cDmg = Number(it.cuttingDamagedQty) || 0;
                    const billable = Math.max(0, qty - pDmg - cDmg);
                    const rate = Number(it.cuttingCost) || 0;
                    return {
                        id: it.id,
                        damageQty: cDmg,
                        cost: billable * rate
                    };
                });
            }

            const result = await updateThreePieceStepCosts({
                purchaseOrderId: purchaseOrder.id,
                stepType: 'CUTTING',
                items: itemsPayload,
                cuttingType,
                assignedStaffId: stepDrafts.CUTTING.assignedStaffId,
                note: stepNotes.CUTTING,
                user: actorName || userRole,
                vendorId: stepDrafts.CUTTING.vendorId,
            });

            if (!result.success) throw new Error(result.message);
            await refreshPurchaseOrder();
            toast({ title: 'Saved', description: 'Cutting step updated.' });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setSavingStep(null);
        }
    };

    const handleFinalizeReceivingStep = async () => {
        if (!purchaseOrder) return;
        if (!selectedLocationId) {
            toast({ variant: 'destructive', title: 'Location required', description: 'Select a stock location before receiving.' });
            return;
        }
        const totalReceivingNow = threePieceItems.reduce((sum, it) => sum + (Number(it.receivingNow) || 0), 0);
        if (totalReceivingNow <= 0) {
            toast({ variant: 'destructive', title: 'Invalid quantity', description: 'Please enter a quantity greater than 0 for at least one item.' });
            return;
        }

        setIsReceiving(true);
        try {
            const result = await finalizeThreePieceReceiving({
                purchaseOrderId: purchaseOrder.id,
                locationId: selectedLocationId,
                items: threePieceItems.map((it) => ({
                    id: it.id,
                    finalQty: Number(it.finalQty) || 0,
                    receivingNow: Number(it.receivingNow) || 0,
                    finishingWastageQty: Number(it.finishingWastageQty) || 0,
                    jamaYards: Number(it.jamaYards) || 0,
                    jamaRate: Number(it.jamaRate) || 0,
                    ornaYards: Number(it.ornaYards) || 0,
                    ornaRate: Number(it.ornaRate) || 0,
                    selowarYards: Number(it.selowarYards) || 0,
                    selowarRate: Number(it.selowarRate) || 0,
                })),
                user: actorName || userRole,
            });

            if (!result.success) {
                toast({ variant: 'destructive', title: 'Receive failed', description: result.message || 'Could not receive stock.' });
                return;
            }

            await refreshPurchaseOrder();
            toast({ title: 'Received', description: 'Stock received and inventory updated.' });
            setIsReceiveDialogOpen(false);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Receive failed', description: error?.message || 'Could not receive stock.' });
        } finally {
            setIsReceiving(false);
        }
    };

    const handleApproveAndAdvance = async (type: ProductionStepType) => {
        if (!purchaseOrder) return;
        const step = productionStepsByType[type];
        if (!step) {
            toast({ variant: 'destructive', title: 'Step missing', description: 'Production step not initialized yet.' });
            return;
        }
        setIsAdvancing(true);
        try {
            await patchProductionStep(step.id, { isApproved: true });
            await advanceProduction(purchaseOrder.id);
            await refreshPurchaseOrder();
            toast({ title: 'Advanced', description: 'Moved to next production step.' });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Advance failed', description: error?.message || 'Approve/save current step before advancing.' });
        } finally {
            setIsAdvancing(false);
        }
    };

    const handleAdvanceStep = async () => {
        if (!purchaseOrder) return;
        setIsAdvancing(true);
        try {
            await advanceProduction(poId);
            await refreshPurchaseOrder();
            toast({ title: 'Advanced', description: 'Moved to next production step.' });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Advance failed', description: error?.message || 'Approve current step before advancing.' });
        } finally {
            setIsAdvancing(false);
        }
    };

    const handleViewImage = (url: string) => {
        console.log('handleViewImage called with:', url);
        setViewingImageUrl(url);
        setIsImageViewerOpen(true);
    };

    const handleUploadClick = (target: 'general' | ProductionStepType) => {
        setUploadTarget(target);
        fileInputRef.current?.click();
    };

    // Sync state with server-updated props if they change (e.g. via router.refresh())
    useEffect(() => {
        setPurchaseOrder(initialPurchaseOrder);
    }, [initialPurchaseOrder]);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && uploadTarget && purchaseOrder) {
            try {
                const uploadedUrl = await uploadMemoFile(file);
                let res;
                if (uploadTarget === 'general') {
                    res = await updatePurchaseOrderOfflineInvoice(purchaseOrder.id, uploadedUrl, actorName || userRole);
                } else {
                    const step = productionStepsByType[uploadTarget];
                    if (!step) throw new Error('Step not initialized yet.');

                    res = await updateProductionStepInvoice(purchaseOrder.id, step.id, uploadedUrl, actorName || userRole);
                }

                if (res?.success && res.purchaseOrder) {
                    console.log('Payment Updated', res.purchaseOrder);
                    setPurchaseOrder(res.purchaseOrder);
                    router.refresh(); // Ensure server-side data (props) are also refreshed
                } else {
                    console.warn('Upsert succeeded but no PO returned', res);
                }
                toast({ title: 'Uploaded', description: 'Memo uploaded successfully.' });

            } catch (err: any) {
                toast({ variant: 'destructive', title: 'Upload failed', description: err?.message || 'Unable to upload memo.' });
            } finally {
                setUploadTarget(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        }
    };

    const handleSavePayment = async (paymentFor: 'general') => {
        if (!purchaseOrder) return;
        const paymentState = generalPayment;

        if ((Number(paymentState.check) || 0) > 0 && !paymentState.checkDate) {
            toast({ variant: 'destructive', title: 'Check date missing', description: 'Please set a check passing date.' });
            return;
        }

        setSavingPaymentFor(paymentFor);
        const result = await upsertPurchasePayment({
            purchaseOrderId: purchaseOrder.id,
            paymentFor: 'General',
            cash: Number(paymentState.cash) || 0,
            check: Number(paymentState.check) || 0,
            checkDate: paymentState.checkDate || undefined,
            checkStatus: paymentState.checkStatus,
            paidFromAccountId: paymentState.paidFromAccountId || undefined,
            paymentMethod: paymentState.paymentMethod || undefined,
            vendorId: undefined,
            physicalInvoiceUrl: paymentState.physicalInvoiceUrl,
            user: actorName || userRole,
        });

        if (result.success) {
            await refreshPurchaseOrder();
            toast({ title: 'Payment saved', description: `General payment updated.` });
        } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.message || 'Could not save payment.' });
        }
        setSavingPaymentFor(null);
    };

    const handleSaveStepPayment = async (type: ProductionStepType) => {
        if (!purchaseOrder) return;
        const step = productionStepsByType[type];
        if (!step) {
            toast({ variant: 'destructive', title: 'Step missing', description: 'Production step not initialized yet.' });
            return;
        }
        const paymentState = stepPayments[type];
        if ((Number(paymentState.check) || 0) > 0 && !paymentState.checkDate) {
            toast({ variant: 'destructive', title: 'Check date missing', description: 'Please set a check passing date.' });
            return;
        }

        setSavingPaymentFor(type);
        const result = await upsertPurchasePayment({
            purchaseOrderId: purchaseOrder.id,
            paymentFor: type,
            productionStepId: step.id,
            vendorId: step.vendorId || undefined,
            cash: Number(paymentState.cash) || 0,
            check: Number(paymentState.check) || 0,
            checkDate: paymentState.checkDate || undefined,
            checkStatus: paymentState.checkStatus,
            paidFromAccountId: paymentState.paidFromAccountId || undefined,
            paymentMethod: paymentState.paymentMethod || undefined,
            physicalInvoiceUrl: paymentState.physicalInvoiceUrl,
            user: actorName || userRole,
        });

        if (result.success) {
            const updated = await refreshPurchaseOrder();
            if (updated) {
                const updatedHasInternal = (updated.purchaseItems || []).some(
                    (item) => (item.fabricLotUsages || []).length > 0
                );
                setStepDrafts({
                    FABRIC: initStepDraft(updated.productionSteps.find(s => s.stepType === 'FABRIC'), updatedHasInternal ? 'INTERNAL' : undefined),
                    PRINTING: initStepDraft(updated.productionSteps.find(s => s.stepType === 'PRINTING')),
                    CUTTING: initStepDraft(updated.productionSteps.find(s => s.stepType === 'CUTTING')),
                    FINISHING: initStepDraft(updated.productionSteps.find(s => s.stepType === 'FINISHING')),
                });
            }
            toast({ title: `${type} payment saved`, description: 'Payment recorded and totals refreshed.' });
        } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.message || 'Could not save payment.' });
        }
        setSavingPaymentFor(null);
    };

    const handleGenerateWorkOrder = (type: ProductionStepType, mode: 'INVOICE' | 'CHALLAN' = 'INVOICE') => {
        if (!purchaseOrder) return;
        if (typeof window === 'undefined') return;

        const isChallan = mode === 'CHALLAN';
        const titleSuffix = isChallan ? '(Challan)' : '';
        const title =
            type === 'FABRIC'
                ? `Fabric Purchase ${isChallan ? 'Challan' : 'Invoice'} `
                : type === 'PRINTING'
                    ? `Printing Work Order ${titleSuffix} `
                    : type === 'CUTTING'
                        ? `Cutting Work Order ${titleSuffix} `
                        : 'Final Receiving Note';

        const poNumber = purchaseOrder.id;
        const orderDate = format(new Date(purchaseOrder.date), 'PPP');

        const printingVendor = vendors.find((v) => v.id === (productionStepsByType.PRINTING?.vendorId || stepDrafts.PRINTING.vendorId));
        const cuttingVendor = vendors.find((v) => v.id === productionStepsByType.CUTTING?.vendorId);

        const pindi = stepDrafts[type]?.pindiOfFab ?? null;

        // Pcs-based totals
        const printingDamageTotal = threePieceItems.reduce((sum, it) => sum + (Number(it.printingDamagedQty) || 0), 0);
        const cuttingDamageTotal = threePieceItems.reduce((sum, it) => sum + (Number(it.cuttingDamagedQty) || 0), 0);
        const finishingWastageTotal = threePieceItems.reduce((sum, it) => sum + (Number(it.finishingWastageQty) || 0), 0);

        const partnerName =
            type === 'FABRIC'
                ? supplier?.name
                : type === 'PRINTING'
                    ? printingVendor?.name
                    : type === 'CUTTING'
                        ? cuttingVendor?.name
                        : undefined;
        const partnerPhone =
            type === 'FABRIC'
                ? supplier?.phone
                : type === 'PRINTING'
                    ? printingVendor?.phone
                    : type === 'CUTTING'
                        ? cuttingVendor?.phone
                        : undefined;

        const sendToName =
            type === 'FABRIC'
                ? printingVendor?.name
                : type === 'PRINTING'
                    ? cuttingVendor?.name
                    : undefined;
        const sendToPhone =
            type === 'FABRIC'
                ? printingVendor?.phone
                : type === 'PRINTING'
                    ? cuttingVendor?.phone
                    : undefined;

        const fmtInvoiceMoney = (val: number) =>
            `${currencyPrefix} ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;

        const stepCost =
            type === 'FABRIC'
                ? fabricTotalDraft
                : type === 'PRINTING'
                    ? printingTotalDraft
                    : type === 'CUTTING'
                        ? cuttingTotalDraft
                        : productionCostTotal;

        const hasInternalFabric = stepDrafts.FABRIC.fabricSource === 'INTERNAL';
        const isInternalFabric = type === 'FABRIC' && hasInternalFabric;
        const payment = stepPayments[type] || initialPaymentState;
        const paidTotal = (Number(payment.cash) || 0) + (Number(payment.check) || 0);
        const due = stepCost - paidTotal;
        const checkPassing = payment.checkDate ? format(new Date(payment.checkDate), 'PPP') : '-';

        // Calculate partner-specific financials
        const partnerStat = partnerStats.find(s => s.partnerId === (
            type === 'FABRIC' ? supplier?.id :
                type === 'PRINTING' ? printingVendor?.id :
                    type === 'CUTTING' ? cuttingVendor?.id : undefined
        ));

        const partnerBalance = partnerStat ? (partnerStat.totalTx - partnerStat.totalPaid) : 0;
        const previousBalance = partnerBalance - stepCost;
        const note = previousBalance > 0 ? `(Previous Due: ${fmtInvoiceMoney(previousBalance)})` :
            previousBalance < 0 ? `(Advance: ${fmtInvoiceMoney(Math.abs(previousBalance))})` : '';

        const summaryHtml = isChallan
            ? ''
            : (isInternalFabric
                ? `
        <div class="summary-note">
                  <div><strong>Total Fabric Cost:</strong> ${fmtInvoiceMoney(stepCost)}</div>
                  <div>Internal stock used. No supplier payment required.</div>
                </div>
        `
                : `
        <table class="summary">
                  <tr><td><strong>Current Bill:</strong></td><td class="right"><strong>${fmtInvoiceMoney(stepCost)}</strong></td></tr>
                  ${previousBalance !== 0 ? `<tr><td>${previousBalance > 0 ? 'Previous Due' : 'Previous Advance'}:</td><td class="right">${fmtInvoiceMoney(Math.abs(previousBalance))} ${previousBalance > 0 ? 'Dr' : 'Cr'}</td></tr>` : ''}
                  <tr><td><strong>Net Payable:</strong></td><td class="right"><strong>${fmtInvoiceMoney(partnerBalance)}</strong></td></tr>
                </table>
        `);

        // Pre-calculate overall allocations across ALL items for accurate Rem logic
        const overallAllocatedByLotNumber = new Map<string, number>();
        if (hasInternalFabric) {
            threePieceItems.forEach(it => {
                const allocGroups = [
                    it.lotAllocations?.JAMA || [],
                    it.lotAllocations?.ORNA || [],
                    it.lotAllocations?.SELOWAR || []
                ];
                allocGroups.forEach(group => {
                    group.forEach((a: any) => {
                        const lotId = a.inventoryItemId;
                        const lot = inventoryLotMap.get(lotId);
                        if (lot?.lotNumber) {
                            const current = overallAllocatedByLotNumber.get(lot.lotNumber) || 0;
                            overallAllocatedByLotNumber.set(lot.lotNumber, current + (Number(a.yards) || 0));
                        }
                    });
                });
            });
        }

        const formatLots = (allocations: any[], totals?: { j: number; o: number; s: number }) => {
            if (!allocations || allocations.length === 0) return '';
            const byLot = new Map<string, { number: string; j: number; o: number; s: number, stock: number }>();
            allocations.forEach((a) => {
                const lot = inventoryLotMap.get(a.inventoryItemId);
                const key = lot?.lotNumber || 'Unknown';
                if (!byLot.has(key)) {
                    byLot.set(key, { number: key, j: 0, o: 0, s: 0, stock: lot?.quantity ?? 0 });
                }
                const entry = byLot.get(key)!;
                const qty = Number(a.yards) || 0;
                const t = (a.type || '').toUpperCase();
                if (t.startsWith('J')) entry.j += qty;
                else if (t.startsWith('O')) entry.o += qty;
                else if (t.startsWith('S')) entry.s += qty;
            });

            if (byLot.size === 0) return '';

            const totalsRow = totals ? `
                <div style="display:grid;grid-template-columns:1.5fr .5fr .5fr .5fr .5fr;background:#f1f5f9;font-weight:700;font-size:8px;color:#334155;padding:1px 4px;border-bottom:1px solid #e2e8f0;">
                    <div>Total</div>
                    <div style="text-align:right;">${totals.j > 0 ? Number(totals.j.toFixed(2)) : '-'}</div>
                    <div style="text-align:right;">${totals.o > 0 ? Number(totals.o.toFixed(2)) : '-'}</div>
                    <div style="text-align:right;">${totals.s > 0 ? Number(totals.s.toFixed(2)) : '-'}</div>
                    <div style="text-align:right;">-</div>
                </div>
            ` : '';

            return `
                <div style="margin-top:2px;margin-bottom:2px;border:1px solid #e2e8f0;border-radius:4px;overflow:hidden;">
                    <div style="display:grid;grid-template-columns:1.5fr .5fr .5fr .5fr .5fr;background:#f8fafc;font-weight:600;font-size:8px;color:#475569;padding:1px 4px;">
                        <div>Lot</div><div style="text-align:right;">J</div><div style="text-align:right;">O</div><div style="text-align:right;">S</div><div style="text-align:right;">Rem</div>
                    </div>
                    ${totalsRow}
                    ${Array.from(byLot.values()).map((v) => {
                const overallUsed = overallAllocatedByLotNumber.get(v.number) || 0;
                const rem = v.stock >= overallUsed ? (v.stock - overallUsed) : v.stock;
                return `
                        <div style="display:grid;grid-template-columns:1.5fr .5fr .5fr .5fr .5fr;font-size:8px;color:#334155;padding:1px 4px;border-top:1px solid #e2e8f0;line-height:1.1;align-items:center;">
                            <div style="display:flex;align-items:center;gap:4px;">
                                <span>${v.number}</span>
                                <svg class="lot-barcode"
                                    data-barcode="${v.number}"
                                    style="width:60px;height:9px;display:inline-block;">
                                </svg>
                            </div>
                            <div style="text-align:right;color:${v.j > 0 ? 'inherit' : '#cbd5e1'}">${v.j > 0 ? Number(v.j.toFixed(2)) : '-'}</div>
                            <div style="text-align:right;color:${v.o > 0 ? 'inherit' : '#cbd5e1'}">${v.o > 0 ? Number(v.o.toFixed(2)) : '-'}</div>
                            <div style="text-align:right;color:${v.s > 0 ? 'inherit' : '#cbd5e1'}">${v.s > 0 ? Number(v.s.toFixed(2)) : '-'}</div>
                            <div style="text-align:right;color:#64748b;">${Math.round(rem)}</div>
                        </div>
                    `;
            }).join('')}
                </div>
            `;
        };

        const safeImgUrl = (url: string | null) => {
            if (!url || url === 'undefined' || url.includes('placeholder') || url.includes('placehold.co') || url.includes('placehold.it')) return null;
            if (url.startsWith('http') || url.startsWith('blob')) return url;
            try { return new URL(url, window.location.origin).toString(); } catch { return null; }
        };

        const itemsHtml = (() => {
            if (type === 'FABRIC') {
                return `
        <div>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;background:white;table-layout:fixed;">
            <thead>
                <tr>
                    <th style="width:35%;">Product</th>
                    <th style="width:10%;">Qty</th>
                    <th style="width:15%;">Jama</th>
                    <th style="width:15%;">Orna</th>
                    <th style="width:15%;">Selowar</th>
                    ${!isChallan ? `<th style="width:10%;" class="right">Line Total</th>` : ''}
                </tr>
            </thead>
            <tbody>
                ${threePieceItems.map((it) => {
                    const jamaCost = (Number(it.jamaYards) || 0) * (Number(it.jamaRate) || 0);
                    const ornaCost = (Number(it.ornaYards) || 0) * (Number(it.ornaRate) || 0);
                    const selCost = (Number(it.selowarYards) || 0) * (Number(it.selowarRate) || 0);
                    const lineTotal = jamaCost + ornaCost + selCost;

                    let lotsHtml = '';
                    if (hasInternalFabric) {
                        const allocations = [
                            ...(it.lotAllocations?.JAMA || []).map(a => ({ ...a, type: 'Jama' })),
                            ...(it.lotAllocations?.ORNA || []).map(a => ({ ...a, type: 'Orna' })),
                            ...(it.lotAllocations?.SELOWAR || []).map(a => ({ ...a, type: 'Selowar' }))
                        ];
                        lotsHtml = formatLots(allocations, {
                            j: Number(it.jamaYards) || 0,
                            o: Number(it.ornaYards) || 0,
                            s: Number(it.selowarYards) || 0
                        });
                    }

                    const productLabel = it.variantName ? `${it.productName} - ${it.variantName}` : it.productName;
                    const imgUrl = safeImgUrl(it.imageUrl);

                    return `
                              <tr>
                                <td>
                                    <div style="display:flex;gap:8px;align-items:flex-start;">
                                        ${imgUrl ? `<img src="${imgUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0;flex-shrink:0;" onError="this.style.display='none'" />` : ''}
                                        <div>
                                            <div style="font-weight:600;font-size:12px;">${productLabel}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>${it.quantity}</td>
                                <td>${(Number(it.jamaYards) || 0).toFixed(2)} yd${!isChallan ? ` × ${fmtInvoiceMoney(Number(it.jamaRate) || 0)}` : ''}</td>
                                <td>${(Number(it.ornaYards) || 0).toFixed(2)} yd${!isChallan ? ` × ${fmtInvoiceMoney(Number(it.ornaRate) || 0)}` : ''}</td>
                                <td>${(Number(it.selowarYards) || 0).toFixed(2)} yd${!isChallan ? ` × ${fmtInvoiceMoney(Number(it.selowarRate) || 0)}` : ''}</td>
                                ${!isChallan ? `<td class="right"><strong>${fmtInvoiceMoney(lineTotal)}</strong></td>` : ''}
                              </tr>
                              ${lotsHtml ? `<tr><td colspan="${!isChallan ? 6 : 5}" style="padding:0 8px;">${lotsHtml}</td></tr>` : ''}
                            `;
                }).join('')
                    }
            </tbody>
        </table>
    `;
            }

            if (type === 'PRINTING') {
                return `
        <div>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;background:white;table-layout:fixed;">
            <thead>
                <tr>
                    <th style="width:35%;">Product</th>
                    <th style="width:10%;">Qty</th>
                    <th style="width:15%;">Jama</th>
                    <th style="width:15%;">Orna</th>
                    <th style="width:15%;">Selowar</th>
                    ${!isChallan ? `<th style="width:10%;" class="right">Printing Cost</th>` : ''}
                </tr>
            </thead>
            <tbody>
                ${threePieceItems.map((it) => {
                    const productLabel = it.variantName ? `${it.productName} - ${it.variantName}` : it.productName;
                    const qty = it.quantity || 0;
                    const dmg = it.printingDamagedQty || 0;
                    const billable = Math.max(0, qty - dmg);
                    const rate = Number(it.printingCost) || 0;
                    const total = billable * rate;
                    const imgUrl = safeImgUrl(it.imageUrl);

                    // Show lots in Printing too if internal fabric was used
                    let lotsHtml = '';
                    if (hasInternalFabric) {
                        const allocations = [
                            ...(it.lotAllocations?.JAMA || []).map(a => ({ ...a, type: 'Jama' })),
                            ...(it.lotAllocations?.ORNA || []).map(a => ({ ...a, type: 'Orna' })),
                            ...(it.lotAllocations?.SELOWAR || []).map(a => ({ ...a, type: 'Selowar' }))
                        ];
                        lotsHtml = formatLots(allocations, {
                            j: Number(it.jamaYards) || 0,
                            o: Number(it.ornaYards) || 0,
                            s: Number(it.selowarYards) || 0
                        });
                    }

                    return `
                              <tr>
                                <td>
                                    <div style="display:flex;gap:8px;align-items:flex-start;">
                                        ${imgUrl ? `<img src="${imgUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0;flex-shrink:0;" onError="this.style.display='none'" />` : ''}
                                        <div>
                                            <div style="font-weight:600;font-size:12px;">${productLabel}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    ${qty}
                                    ${dmg > 0 ? `<div style="font-size:9px;color:#ef4444;">Dmg: ${dmg}</div>` : ''}
                                </td>
                                <td>${(Number(it.jamaYards) || 0).toFixed(2)} yd</td>
                                <td>${(Number(it.ornaYards) || 0).toFixed(2)} yd</td>
                                <td>${(Number(it.selowarYards) || 0).toFixed(2)} yd</td>
                                ${!isChallan ? `<td class="right">
                                    <div style="font-size:11px;color:#64748b;">@ ${fmtInvoiceMoney(rate)}</div>
                                    <strong>${fmtInvoiceMoney(total)}</strong>
                                    ${dmg > 0 ? `<div style="font-size:9px;color:#64748b;">For ${billable} pcs</div>` : ''}
                                </td>` : ''}
                              </tr>
                              ${lotsHtml ? `<tr><td colspan="${!isChallan ? 6 : 5}" style="padding:0 8px;">${lotsHtml}</td></tr>` : ''}
                            `;
                }).join('')}
            </tbody>
        </table>
                </div>
        `;
            }

            if (type === 'CUTTING') {
                return `
        <div>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;background:white;table-layout:fixed;">
            <thead>
                <tr>
                    <th style="width:35%;">Product</th>
                    <th style="width:10%;">Qty</th>
                    <th style="width:15%;">Jama</th>
                    <th style="width:15%;">Orna</th>
                    <th style="width:15%;">Selowar</th>
                    ${!isChallan ? `<th style="width:10%;" class="right">Cutting Cost</th>` : ''}
                </tr>
            </thead>
            <tbody>
                ${threePieceItems.map((it) => {
                    const productLabel = it.variantName ? `${it.productName} - ${it.variantName}` : it.productName;
                    const imgUrl = safeImgUrl(it.imageUrl);

                    let lotsHtml = '';
                    if (hasInternalFabric) {
                        const allocations = [
                            ...(it.lotAllocations?.JAMA || []).map(a => ({ ...a, type: 'Jama' })),
                            ...(it.lotAllocations?.ORNA || []).map(a => ({ ...a, type: 'Orna' })),
                            ...(it.lotAllocations?.SELOWAR || []).map(a => ({ ...a, type: 'Selowar' }))
                        ];
                        lotsHtml = formatLots(allocations, {
                            j: Number(it.jamaYards) || 0,
                            o: Number(it.ornaYards) || 0,
                            s: Number(it.selowarYards) || 0
                        });
                    }

                    return `
                              <tr>
                                <td>
                                    <div style="display:flex;gap:8px;align-items:flex-start;">
                                        ${imgUrl ? `<img src="${imgUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0;flex-shrink:0;" onError="this.style.display='none'" />` : ''}
                                        <div>
                                            <div style="font-weight:600;font-size:12px;">${productLabel}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    ${it.quantity}
                                    ${(it.cuttingDamagedQty || 0) > 0 ? `<div style="font-size:9px;color:#ef4444;">Dmg: ${it.cuttingDamagedQty}</div>` : ''}
                                </td>
                                <td>${(Number(it.jamaYards) || 0).toFixed(2)} yd</td>
                                <td>${(Number(it.ornaYards) || 0).toFixed(2)} yd</td>
                                <td>${(Number(it.selowarYards) || 0).toFixed(2)} yd</td>
                                ${!isChallan ? `<td class="right">
                                    <div style="font-size:11px;color:#64748b;">@ ${fmtInvoiceMoney(Number(it.cuttingCost) || 0)}</div>
                                    <strong>${fmtInvoiceMoney(Math.max(0, (Number(it.quantity) || 0) - (Number(it.printingDamagedQty) || 0) - (Number(it.cuttingDamagedQty) || 0)) * (Number(it.cuttingCost) || 0))}</strong>
                                    ${((Number(it.printingDamagedQty) || 0) + (Number(it.cuttingDamagedQty) || 0)) > 0 ? `<div style="font-size:9px;color:#64748b;">For ${Math.max(0, (Number(it.quantity) || 0) - (Number(it.printingDamagedQty) || 0) - (Number(it.cuttingDamagedQty) || 0))} pcs</div>` : ''}
                                </td>` : ''}
                              </tr>
                              ${lotsHtml ? `<tr><td colspan="${!isChallan ? 6 : 5}" style="padding:0 8px;">${lotsHtml}</td></tr>` : ''}
                            `;
                }).join('')}
            </tbody>
        </table>
                </div>
        `;
            }

            // FINISHING
            return `
        <div>
        <table style="table-layout:fixed;">
            <thead>
                <tr>
                    <th style="width:50%;">Product</th>
                    <th style="width:10%;">Wastage</th>
                    <th style="width:10%;">Final Qty</th>
                    ${!isChallan ? `<th style="width:15%;" class="right">Unit Cost</th>` : ''}
                    ${!isChallan ? `<th style="width:15%;" class="right">Line Total</th>` : ''}
                </tr>
            </thead>
            <tbody>
                ${threePieceItems.map((it) => {
                const fabricCost =
                    (Number(it.jamaYards) || 0) * (Number(it.jamaRate) || 0) +
                    (Number(it.ornaYards) || 0) * (Number(it.ornaRate) || 0) +
                    (Number(it.selowarYards) || 0) * (Number(it.selowarRate) || 0);
                const total = fabricCost + (Number(it.printingCost) || 0) + (Number(it.cuttingCost) || 0);
                const qty = Number(it.finalQty) || 0;
                const unit = qty > 0 ? total / qty : 0;
                const productLabel = it.variantName ? `${it.productName} - ${it.variantName}` : it.productName;
                const imgUrl = safeImgUrl(it.imageUrl);

                let lotsHtml = '';
                if (hasInternalFabric) {
                    const allocations = [
                        ...(it.lotAllocations?.JAMA || []).map(a => ({ ...a, type: 'Jama' })),
                        ...(it.lotAllocations?.ORNA || []).map(a => ({ ...a, type: 'Orna' })),
                        ...(it.lotAllocations?.SELOWAR || []).map(a => ({ ...a, type: 'Selowar' }))
                    ];
                    lotsHtml = formatLots(allocations, {
                        j: Number(it.jamaYards) || 0,
                        o: Number(it.ornaYards) || 0,
                        s: Number(it.selowarYards) || 0
                    });
                }

                return `
                          <tr>
                            <td>
                                    <div style="display:flex;gap:8px;align-items:flex-start;">
                                        ${imgUrl ? `<img src="${imgUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0;flex-shrink:0;" onError="this.style.display='none'" />` : ''}
                                        <div>
                                            <div style="font-weight:600;font-size:12px;">${productLabel}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>${it.finishingWastageQty || '-'}</td>
                                <td>${qty}</td>
                                ${!isChallan ? `<td class="right">${fmtInvoiceMoney(unit)}</td>` : ''}
                                ${!isChallan ? `<td class="right"><strong>${fmtInvoiceMoney(unit * qty)}</strong></td>` : ''}
                              </tr>
                              ${lotsHtml ? `<tr><td colspan="${!isChallan ? 5 : 4}" style="padding:0 8px;">${lotsHtml}</td></tr>` : ''}
                            `;
            }).join('')}
            </tbody>
        </table>
                        </div >
        `;
        })();

        const logoUrl = (() => {
            const logo = brandLogo || '/logo-full.svg';
            try {
                return new URL(logo, window.location.origin).toString();
            } catch {
                return logo;
            }
        })();

        const w = window.open('', '_blank', 'width=900,height=1100');
        if (!w) {
            toast({ variant: 'destructive', title: 'Popup blocked', description: 'Allow popups to generate invoice.' });
            return;
        }

        const loadLogoAsDataUrl = async (): Promise<string> => {
            try {
                const res = await fetch(logoUrl);
                if (!res.ok) return logoUrl;
                const blob = await res.blob();
                return await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                });
            } catch {
                return logoUrl;
            }
        };
        const generationTime = format(new Date(), 'PPpp');

        loadLogoAsDataUrl()
            .then((logoDataUrl) => {
                const metaRows = [
                    `<div><strong>Date:</strong> ${orderDate}</div>`,
                    `<div><strong>PO:</strong> ${poNumber}</div>`,
                    partnerName ? `<div><strong>${type === 'FABRIC' ? 'Supplier' : 'Vendor'}:</strong> ${partnerName}</div>` : '',
                    partnerPhone ? `<div><strong>Phone:</strong> ${partnerPhone}</div>` : '',
                    sendToName ? `<div><strong>Send To:</strong> ${sendToName}${sendToPhone ? ` (${sendToPhone})` : ''}</div>` : '',
                    type === 'FABRIC' ? `<div><strong>Fabric Source:</strong> ${stepDrafts.FABRIC.fabricSource === 'INTERNAL' ? 'Internal Stock' : 'Supplier'}</div>` : '',
                    // Notes moved to bottom
                    // type === 'PRINTING' && stepNotes.PRINTING ? `<div><strong>Note:</strong> ${stepNotes.PRINTING}</div>` : '',
                    // type === 'CUTTING' && stepNotes.CUTTING ? `<div><strong>Note:</strong> ${stepNotes.CUTTING}</div>` : '',
                    type === 'PRINTING' && printingDamageTotal > 0 ? `<div><strong>Total Damage:</strong> ${printingDamageTotal} pcs</div>` : '',
                    type === 'CUTTING' && cuttingDamageTotal > 0 ? `<div><strong>Total Damage:</strong> ${cuttingDamageTotal} pcs</div>` : '',
                    type === 'FINISHING' && finishingWastageTotal > 0 ? `<div><strong>Total Wastage:</strong> ${finishingWastageTotal} pcs</div>` : '',
                ].filter(Boolean).join('');

                const html = `
        <html>
                      <head>
                        <title>${title} - ${poNumber}</title>
                        <script src="/vendor/jsbarcode.min.js"></script>
                        <style>
                          :root { color-scheme: light; }
                          body { font-family: Arial, sans-serif; padding: 32px; color: #111; background: #f8fafc; }
                          .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
                          .brand { display: flex; align-items: center; gap: 12px; }
                          .badge { background: #eef2ff; color: #312e81; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; }
                          .meta { color: #444; margin-bottom: 16px; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 4px 12px; }
                          table { width: 100%; border-collapse: collapse; margin-top: 16px; background: white; table-layout: fixed; }
                          th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; font-size: 12px; vertical-align: top; line-height: 1.3; }
                          th { background: #f1f5f9; }
                          .summary { margin-top: 24px; margin-left: auto; width: 45%; background: white; border: 1px solid #e2e8f0; border-collapse: collapse; }
                          .summary td { border: none; padding: 6px 12px; }
                          .summary-note { margin-top: 24px; margin-left: auto; width: 45%; background: white; border: 1px solid #e2e8f0; padding: 12px; font-size: 12px; color: #111; }
                          .note-box { margin-top: 24px; background: white; border: 1px solid #e2e8f0; padding: 12px; font-size: 12px; color: #334155; border-radius: 4px; }
                          .right { text-align: right; }
                          .footer { margin-top: 28px; font-size: 11px; color: #555; }
                          @media print { body { background: white; } .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
                        </style>
                      </head>
                      <body>
                        <div class="header">
                          <div class="brand">
                            ${logoDataUrl ? `<img data-logo="true" src="${logoDataUrl}" alt="${storeName} logo" style="width:48px;height:48px;object-fit:contain;border-radius:8px;border:1px solid #e2e8f0;background:#fff;" />` : ''}
                            <div>
                              <div style="font-weight:700;font-size:20px;">${storeName}</div>
                              <div style="color:#64748b;font-size:12px;">${title}</div>
                              ${storeAddress ? `<div style="color:#94a3b8;font-size:11px;">${storeAddress}</div>` : ''}
                            </div>
                          </div>
                          <div class="badge">${poNumber}</div>
                        </div>

                        <div class="meta">
                          ${metaRows}
                        </div>

                        ${itemsHtml}

                        ${summaryHtml}

                        ${(() => {
                        let note = '';
                        if (type === 'PRINTING') note = stepNotes.PRINTING;
                        if (type === 'CUTTING') note = stepNotes.CUTTING;
                        if (!note) return '';
                        return `
                                <div class="note-box">
                                    <div style="font-weight:600;margin-bottom:4px;font-size:11px;text-transform:uppercase;color:#64748b;">Note</div>
                                    <div style="white-space:pre-wrap;">${note}</div>
                                </div>
                            `;
                    })()}

                         <div class="footer">
                            <div>Generated by ${storeName} on ${generationTime}</div>
                            <div>Please keep this document for your records.</div>
                         </div>
                      </body>
                    </html>
        `;

                w.document.write(html);
                w.document.close();

                const waitForBarcode = () => new Promise((resolve) => {
                    const run = () => {
                        const jsbc = (w as any).JsBarcode;
                        if (!jsbc) return false;
                        const nodes = w.document.querySelectorAll('.lot-barcode');
                        nodes.forEach((node: any) => {
                            const val = node.getAttribute('data-barcode');
                            if (val) {
                                try {
                                    // Dynamic width calculation
                                    const maxWidth = 60;
                                    const len = val.length;
                                    const approxModules = Math.max(1, (len + 2) * 11);

                                    // Adaptive min width based on length
                                    let minWidth = 0.55;
                                    if (len >= 20) minWidth = 0.35;
                                    else if (len >= 16) minWidth = 0.45;

                                    const moduleWidth = Math.max(minWidth, Math.min(1.0, maxWidth / approxModules));

                                    jsbc(node, val, {
                                        format: 'CODE128',
                                        displayValue: false,
                                        height: 9,
                                        width: moduleWidth,
                                        margin: 1
                                    });
                                } catch {
                                    node.style.display = 'none';
                                }
                            } else {
                                node.style.display = 'none';
                            }
                        });
                        return true;
                    };

                    const attempt = () => {
                        if (run()) return resolve(null);
                        const script = w.document.querySelector('script[src="/vendor/jsbarcode.min.js"]');
                        if (script) {
                            script.addEventListener('load', () => { run(); resolve(null); }, { once: true });
                            script.addEventListener('error', () => resolve(null), { once: true });
                        } else {
                            resolve(null);
                        }
                    };
                    attempt();
                });

                const waitForDomReady = () => new Promise((resolve) => {
                    if (w.document.body && w.document.body.innerHTML.length > 0) return resolve(null);
                    if (w.document.readyState === 'complete') return resolve(null);
                    w.addEventListener('load', () => resolve(null), { once: true });
                });

                const waitForFonts = async () => {
                    try { await (w.document as any).fonts.ready; } catch { }
                };

                const waitForPaint = () => new Promise((resolve) => {
                    w.requestAnimationFrame(() => {
                        w.requestAnimationFrame(() => {
                            setTimeout(resolve, 200);
                        });
                    });
                });

                let printed = false;
                const safePrint = () => {
                    if (printed) return;
                    printed = true;
                    try { w.focus(); } catch { }
                    try { w.print(); } catch { }
                };

                const waitForImages = async () => {
                    const images = Array.from(w.document.images);
                    await Promise.all(images.map(img => {
                        if (img.complete) return Promise.resolve();
                        return new Promise(resolve => {
                            img.addEventListener('load', () => resolve(null), { once: true });
                            img.addEventListener('error', () => resolve(null), { once: true });
                        });
                    }));
                };

                const timeout = new Promise(resolve => setTimeout(resolve, 3000));

                Promise.race([
                    (async () => {
                        await waitForDomReady();
                        await Promise.all([waitForImages(), waitForBarcode(), waitForFonts()]);
                        await waitForPaint();
                    })(),
                    timeout
                ]).then(() => safePrint());
            })
            .catch(() => {
                w.close();
                toast({ variant: 'destructive', title: 'Invoice failed', description: 'Could not generate invoice preview.' });
            });
    };

    if (!purchaseOrder) {
        return (
            <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 items-center justify-center">
                <p>Purchase Order not found.</p>
                <Button asChild variant="outline"><Link href="/dashboard/purchases">Go Back</Link></Button>
            </div>
        );
    }

    type StepId = 'fabric' | 'printing' | 'cutting' | 'finishing';
    const stepIndex = (id: StepId) => productionStepDefs.findIndex((s) => s.id === id);
    const currentStepMap: Record<string, StepId> = {
        PLANNING: 'fabric',
        FABRIC: 'fabric',
        PRINTING: 'printing',
        CUTTING: 'cutting',
        COMPLETED: 'finishing',
    };
    const currentStepId: StepId = currentStepMap[(purchaseOrder as any).currentStep] || 'fabric';
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [activeStep, setActiveStep] = useState<StepId>(currentStepId);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        setActiveStep(currentStepId);
    }, [currentStepId]);
    const isStepEnabled = (id: StepId) => {
        if ((purchaseOrder as any).currentStep === 'COMPLETED') return true;
        return stepIndex(id) <= stepIndex(currentStepId);
    };
    const uiSteps = productionStepDefs.map((step) => {
        const idx = stepIndex(step.id as StepId);
        const cur = stepIndex(currentStepId);
        const status = idx < cur ? 'complete' : idx === cur ? 'current' : 'pending';
        return { ...step, status };
    });

    // UI for General Purchase
    if (!isThreePiece) {
        return (
            <div className="flex flex-1 flex-col gap-8 p-4 lg:gap-6 lg:p-6">
                <input type="file" accept="image/*,application/pdf" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <h1 className="font-headline text-2xl font-bold">
                            Purchase Order: {purchaseOrder.id}
                        </h1>
                        <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                            <span>General purchase for ready-made goods.</span>
                            <Badge variant={'outline'} className={cn(paymentStatusColors[purchaseOrder.paymentStatus] || '')}>{purchaseOrder.paymentStatus}</Badge>
                            <Badge variant={'outline'} className={cn(statusColors[purchaseOrder.status] || '')}>{purchaseOrder.status}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                            {brandLogo && (
                                <Image src={brandLogo} alt={`${storeName} logo`} width={28} height={28} className="rounded border bg-white" />
                            )}
                            <span>{storeName}</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                        <Button variant="outline" asChild className="w-full sm:w-auto">
                            <Link href="/dashboard/purchases">
                                <ChevronLeft className="mr-2 h-4 w-4" /> Back to List
                            </Link>
                        </Button>
                        <Button variant="default" onClick={handleGenerateGeneralInvoice} className="w-full sm:w-auto">
                            <FileText className="mr-2 h-4 w-4" /> Generate Invoice
                        </Button>
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 space-y-8">
                        <Card>
                            <CardHeader>
                                <CardTitle>Order Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Order Date:</span>
                                    <span className="font-medium">{format(new Date(purchaseOrder.date), "PPP")}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Supplier:</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{supplier?.name}</span>
                                        {supplier?.id && (
                                            <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                                                <Link href={`/dashboard/partners/suppliers?id=${supplier.id}`}>
                                                    <ExternalLink className="h-3.5 w-3.5 text-blue-600" />
                                                </Link>
                                            </Button>
                                        )}
                                    </div>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Cost:</span>
                                    <span className="font-medium font-mono">Tk {purchaseOrder.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Items:</span>
                                    <span className="font-medium">{purchaseOrder.items}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span className="font-medium">{purchaseOrder.status}</span>
                                </div>
                            </CardContent>
                        </Card>
                        <PurchaseOrderHistory logs={purchaseOrder.logs} />
                    </div>
                    <div className="lg:col-span-2 space-y-8">
                        <Card>
                            <CardHeader>
                                <CardTitle>Payment</CardTitle>
                                <CardDescription>Payment details for this purchase.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-col items-center justify-center py-6 text-center border-2 border-dashed rounded-lg bg-muted/10">
                                    <div className="mb-2 rounded-full bg-primary/10 p-2 text-primary">
                                        <Coins className="h-5 w-5" />
                                    </div>
                                    <h4 className="text-sm font-semibold">Decentralized Payments</h4>
                                    <p className="max-w-[280px] mt-1 text-xs text-muted-foreground">
                                        Payments are now managed at the partner level using a FIFO strategy.
                                    </p>
                                    <Button variant="link" size="sm" className="mt-2 h-auto p-0 text-blue-600 font-semibold" asChild>
                                        <Link href={`/dashboard/partners/suppliers?id=${supplier?.id}`}>
                                            Go to Partner Profile <ArrowRight className="ml-1 h-3 w-3" />
                                        </Link>
                                    </Button>
                                </div>
                                <div className="mt-4 flex items-center justify-between rounded-md border p-3 bg-muted/20">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-sm font-medium">Offline Invoice</span>
                                        {(() => {
                                            const invUrl = purchaseOrder.offlineInvoiceUrl;
                                            if (invUrl) {
                                                return (
                                                    <div className="flex items-center gap-2">
                                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => handleViewImage(invUrl)}>
                                                            <Eye className="mr-2 h-4 w-4" /> View
                                                        </Button>
                                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-foreground" onClick={() => handleUploadClick('general')}>
                                                            <Upload className="mr-2 h-4 w-4" /> Replace
                                                        </Button>
                                                    </div>
                                                );
                                            }
                                            return <span className="text-xs text-muted-foreground">No invoice uploaded</span>;
                                        })()}
                                    </div>
                                    {!purchaseOrder.offlineInvoiceUrl && (
                                        <Button variant="outline" size="sm" onClick={() => handleUploadClick('general')}>
                                            <Upload className="mr-2 h-4 w-4" />
                                            Upload
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Receive Goods</CardTitle>
                                <CardDescription>Receive items into your inventory.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {isThreePiece ? (
                                    <>
                                        <Label htmlFor="final-qty">Final Received Quantity</Label>
                                        <Input
                                            id="final-qty"
                                            type="number"
                                            className="mt-1 text-center"
                                            value={finishingQty}
                                            readOnly={true}
                                        />
                                    </>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <Label>Receive Quantities (Pending)</Label>
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        const newQtys: Record<string, number> = {};
                                                        (purchaseOrder.purchaseItems || []).forEach(it => {
                                                            const remaining = (Number(it.quantity) || 0) - (Number(it.receivedQty) || 0) - (Number(it.generalWastageQty) || 0);
                                                            newQtys[it.id] = Math.max(0, remaining);
                                                        });
                                                        setItemReceiveQtys(newQtys);
                                                        setItemWastageQtys({}); // Reset wastage when filling remaining
                                                    }}
                                                >
                                                    Fill Remaining
                                                </Button>
                                                <Badge variant="secondary">Rx: {Object.values(itemReceiveQtys).reduce((a, b) => a + (b || 0), 0)} | Wst: {Object.values(itemWastageQtys).reduce((a, b) => a + (b || 0), 0)}</Badge>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Input
                                                placeholder="Scan product SKU..."
                                                value={scanInputs['receive'] || ''}
                                                onChange={(e) => setScanInputs(prev => ({ ...prev, 'receive': e.target.value }))}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        const val = scanInputs['receive']?.trim();
                                                        if (val) {
                                                            const item = (purchaseOrder.purchaseItems || []).find(it =>
                                                                (it.sku && it.sku.toLowerCase() === val.toLowerCase()) ||
                                                                (it.productName.toLowerCase() === val.toLowerCase())
                                                            );
                                                            if (item) {
                                                                const remaining = (Number(item.quantity) || 0) - (Number(item.receivedQty) || 0);
                                                                setItemReceiveQtys(prev => ({
                                                                    ...prev,
                                                                    [item.id]: Math.min(remaining, (prev[item.id] ?? 0) + 1)
                                                                }));
                                                                toast({ title: "Scanned", description: `${item.productName} (+1)` });
                                                                setScanInputs(prev => ({ ...prev, 'receive': '' }));
                                                            } else {
                                                                toast({ variant: "destructive", title: "Not found", description: "Product not found in this PO." });
                                                            }
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                            {(purchaseOrder.purchaseItems || []).map((item) => (
                                                <div key={item.id} className="flex flex-col gap-1 border p-2 rounded bg-muted/10">
                                                    <div className="flex justify-between items-center gap-2">
                                                        <div className="flex-1">
                                                            <div className="font-medium text-sm">{item.productName}</div>
                                                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                                                <span>{item.variantName || 'No Variant'}</span>
                                                                <span>•</span>
                                                                <span>Ordered: {item.quantity}</span>
                                                                <span>•</span>
                                                                <span className={cn(((item.receivedQty || 0) + (item.generalWastageQty || 0)) >= item.quantity ? "text-green-600 font-bold" : "text-blue-600")}>
                                                                    Received: {item.receivedQty || 0}
                                                                </span>
                                                                {(item.generalWastageQty || 0) > 0 && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span className="text-red-500">Wasted: {item.generalWastageQty}</span>
                                                                    </>
                                                                )}
                                                                {item.sku && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span>SKU: {item.sku}</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {(pindaRestates[item.id] && pindaRestates[item.id].length > 0) ? (
                                                            <div className="flex flex-wrap gap-2 justify-end items-end max-w-[70%]">
                                                                {pindaRestates[item.id].map((val, idx) => (
                                                                    <div key={idx} className="flex flex-col items-center">
                                                                        <span className="text-[10px] text-muted-foreground uppercase opacity-70">P{idx + 1}</span>
                                                                        <Input
                                                                            type="number"
                                                                            className="w-16 h-8 text-center text-xs px-1"
                                                                            value={val}
                                                                            onChange={(e) => {
                                                                                const newVal = Number(e.target.value) || 0;
                                                                                const newArr = [...pindaRestates[item.id]];
                                                                                newArr[idx] = newVal;
                                                                                setPindaRestates(prev => ({ ...prev, [item.id]: newArr }));
                                                                                const newTotal = newArr.reduce((a, b) => a + b, 0);
                                                                                setItemReceiveQtys(prev => ({ ...prev, [item.id]: newTotal }));
                                                                            }}
                                                                        />
                                                                    </div>
                                                                ))}
                                                                <div className="pb-2 text-xs font-bold text-muted-foreground min-w-[30px] text-right">= {itemReceiveQtys[item.id] ?? Math.max(0, (Number(item.quantity) || 0) - (Number(item.receivedQty) || 0) - (Number(item.generalWastageQty) || 0))}</div>
                                                                <div className="flex flex-col items-end pl-2 border-l ml-1">
                                                                    <span className="text-[10px] text-red-500/70">Waste</span>
                                                                    <Input
                                                                        type="number"
                                                                        className="w-16 h-8 text-right bg-red-50/50 border-red-100 text-xs"
                                                                        placeholder="Wst"
                                                                        min="0"
                                                                        value={itemWastageQtys[item.id] ?? ""}
                                                                        onChange={(e) => {
                                                                            const val = Math.max(0, Number(e.target.value) || 0);
                                                                            const remaining = (Number(item.quantity) || 0) - (Number(item.receivedQty) || 0) - (Number(item.generalWastageQty) || 0);
                                                                            const currentRx = itemReceiveQtys[item.id] || 0;

                                                                            if (val + currentRx > remaining) {
                                                                                setItemWastageQtys(prev => ({ ...prev, [item.id]: Math.max(0, remaining - currentRx) }));
                                                                            } else {
                                                                                setItemWastageQtys(prev => ({ ...prev, [item.id]: val }));
                                                                            }
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <div className="flex flex-col items-end">
                                                                    <span className="text-[10px] text-muted-foreground">Receive</span>
                                                                    <Input
                                                                        type="number"
                                                                        className="w-20 h-9 text-right bg-background"
                                                                        placeholder="Qty"
                                                                        min="0"
                                                                        value={itemReceiveQtys[item.id] ?? ""}
                                                                        onChange={(e) => {
                                                                            const val = Math.max(0, Number(e.target.value) || 0);
                                                                            const remaining = (Number(item.quantity) || 0) - (Number(item.receivedQty) || 0) - (Number(item.generalWastageQty) || 0);
                                                                            const currentWst = itemWastageQtys[item.id] || 0;

                                                                            if (val + currentWst > remaining) {
                                                                                setItemReceiveQtys(prev => ({ ...prev, [item.id]: Math.max(0, remaining - currentWst) }));
                                                                            } else {
                                                                                setItemReceiveQtys(prev => ({ ...prev, [item.id]: val }));
                                                                            }
                                                                        }}
                                                                    />
                                                                </div>
                                                                <div className="flex flex-col items-end">
                                                                    <span className="text-[10px] text-red-500/70">Waste</span>
                                                                    <Input
                                                                        type="number"
                                                                        className="w-20 h-9 text-right bg-red-50/50 border-red-100"
                                                                        placeholder="Wst"
                                                                        min="0"
                                                                        value={itemWastageQtys[item.id] ?? ""}
                                                                        onChange={(e) => {
                                                                            const val = Math.max(0, Number(e.target.value) || 0);
                                                                            const remaining = (Number(item.quantity) || 0) - (Number(item.receivedQty) || 0) - (Number(item.generalWastageQty) || 0);
                                                                            const currentRx = itemReceiveQtys[item.id] || 0;

                                                                            if (val + currentRx > remaining) {
                                                                                setItemWastageQtys(prev => ({ ...prev, [item.id]: Math.max(0, remaining - currentRx) }));
                                                                            } else {
                                                                                setItemWastageQtys(prev => ({ ...prev, [item.id]: val }));
                                                                            }
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter>
                                <Dialog open={isReceiveDialogOpen} onOpenChange={setIsReceiveDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button className="w-full" disabled={purchaseOrder.status === 'Received' || finishingQty <= 0}>
                                            Receive Stock
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Receive Stock</DialogTitle>
                                            <DialogDescription>Confirm location and quantity.</DialogDescription>
                                        </DialogHeader>
                                        <div className="grid gap-4 py-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="location">Stock Location</Label>
                                                <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                                                    <SelectTrigger id="location"><SelectValue placeholder="Select a location" /></SelectTrigger>
                                                    <SelectContent>{stockLocations.map(loc => (<SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>))}</SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Total Quantity to Receive</Label>
                                                <div className="flex items-center justify-center p-4 border rounded bg-muted/20">
                                                    <span className="text-3xl font-bold">{Object.values(itemReceiveQtys).reduce((a, b) => a + (b || 0), 0) + Object.values(itemWastageQtys).reduce((a, b) => a + (b || 0), 0)}</span>
                                                    <span className="ml-2 text-sm text-muted-foreground">units (Rx + Wst)</span>
                                                </div>
                                                <div className="text-center text-xs text-muted-foreground mt-1">
                                                    Receiving: {Object.values(itemReceiveQtys).reduce((a, b) => a + (b || 0), 0)} |
                                                    Wastage: {Object.values(itemWastageQtys).reduce((a, b) => a + (b || 0), 0)}
                                                </div>
                                                {!isThreePiece && (
                                                    <div className="text-center text-xs text-muted-foreground">
                                                        Total of {Object.keys(itemReceiveQtys).length || (purchaseOrder.purchaseItems || []).length} items
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button variant="outline" onClick={() => setIsReceiveDialogOpen(false)}>Cancel</Button>
                                            <Button onClick={handleReceiveStock} disabled={isReceiving}>
                                                {isReceiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                Confirm & Receive
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </CardFooter>
                        </Card>
                    </div>
                </div>
                <Dialog open={isImageViewerOpen} onOpenChange={setIsImageViewerOpen}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Physical Invoice</DialogTitle>
                        </DialogHeader>
                        {viewingImageUrl && (
                            <div className="py-4 h-[80vh] w-full flex flex-col items-center">
                                <p className="text-xs text-muted-foreground mb-2 break-all">Debug URL: {viewingImageUrl}</p>
                                {viewingImageUrl.toLowerCase().endsWith('.pdf') ? (
                                    <iframe src={viewingImageUrl} className="w-full h-full border-none" title="Invoice PDF" />
                                ) : (
                                    <img src={viewingImageUrl} alt="Physical Invoice" className="w-full h-auto object-contain max-h-full" />
                                )}
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        )
    }

    // UI for Three-Piece Production
    return (
        <div className="flex flex-1 flex-col gap-8 p-4 lg:gap-6 lg:p-6">
            <input type="file" accept="image/*,application/pdf" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h1 className="font-headline text-xl font-bold break-words sm:text-2xl">
                        Purchase Order: {purchaseOrder.id}
                    </h1>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                        <span className="hidden sm:block">Manage and track production for this 3-piece order.</span>
                        <Badge variant={'outline'} className={cn(paymentStatusColors[purchaseOrder.paymentStatus] || '')}>{purchaseOrder.paymentStatus}</Badge>
                        <Badge variant={'outline'} className={cn(statusColors[purchaseOrder.status] || '')}>{purchaseOrder.status}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                        {brandLogo && (
                            <Image src={brandLogo} alt={`${storeName} logo`} width={28} height={28} className="rounded border bg-white" />
                        )}
                        <span>{storeName}</span>
                    </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    <Button variant="outline" asChild className="w-full sm:w-auto">
                        <Link href="/dashboard/purchases">
                            <ChevronLeft className="mr-2 h-4 w-4" /> Back to List
                        </Link>
                    </Button>
                </div>
            </div>

            <Card>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div>
                        <CardTitle>Production Status</CardTitle>
                        <CardDescription>Current step: {(purchaseOrder as any).currentStep || 'PLANNING'}</CardDescription>
                    </div>
                    <Button
                        variant="outline"
                        className="w-full sm:w-auto"
                        disabled={isAdvancing || (purchaseOrder as any).currentStep === 'COMPLETED'}
                        onClick={handleAdvanceStep}
                    >
                        {isAdvancing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                        {(purchaseOrder as any).currentStep === 'COMPLETED' ? 'Completed' : 'Advance to next step'}
                    </Button>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-3 sm:hidden">
                        {uiSteps.map((step) => (
                            <div key={step.id} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2">
                                <div
                                    className={cn(
                                        "flex h-9 w-9 items-center justify-center rounded-full",
                                        step.status === 'complete' && "bg-primary text-primary-foreground",
                                        step.status === 'current' && "border-2 border-primary bg-background text-primary",
                                        step.status === 'pending' && "border border-dashed bg-background text-muted-foreground"
                                    )}
                                >
                                    {step.status === 'complete' ? (
                                        <Check className="h-5 w-5" />
                                    ) : (
                                        <step.icon className="h-5 w-5" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p
                                        className={cn(
                                            "text-xs font-semibold",
                                            step.status === 'current' && 'text-primary',
                                            step.status === 'pending' && 'text-muted-foreground'
                                        )}
                                    >
                                        {step.label}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground capitalize">{step.status}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="hidden w-full overflow-x-auto sm:block">
                        <div className="flex items-center min-w-[520px] pr-2 sm:min-w-0 sm:pr-0">
                            {uiSteps.map((step, index) => (
                                <React.Fragment key={step.id}>
                                    <div className="flex flex-col items-center gap-2">
                                        <div
                                            className={cn(
                                                "flex h-9 w-9 items-center justify-center rounded-full sm:h-10 sm:w-10",
                                                step.status === 'complete' && "bg-primary text-primary-foreground",
                                                step.status === 'current' && "border-2 border-primary bg-background text-primary",
                                                step.status === 'pending' && "border border-dashed bg-background text-muted-foreground"
                                            )}
                                        >
                                            {step.status === 'complete' ? (
                                                <Check className="h-5 w-5 sm:h-6 sm:w-6" />
                                            ) : (
                                                <step.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                                            )}
                                        </div>
                                        <p
                                            className={cn(
                                                "text-xs font-medium text-center sm:text-sm",
                                                step.status === 'current' && 'text-primary',
                                                step.status === 'pending' && 'text-muted-foreground'
                                            )}
                                        >
                                            {step.label}
                                        </p>
                                    </div>
                                    {index < uiSteps.length - 1 && (
                                        <div
                                            className={cn(
                                                "flex-1 h-px bg-border mx-2 mb-7",
                                                step.status === 'complete' && 'bg-primary'
                                            )}
                                        />
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
                <div className="space-y-8 lg:col-span-4 xl:col-span-3">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Order Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Order Date:</span>
                                <span className="font-medium">{format(new Date(purchaseOrder.date), "PPP")}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Supplier:</span>
                                <span className="font-medium">{supplier?.name}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Fabric Cost:</span>
                                <span className="font-medium font-mono">{fmtMoney(stepDrafts.FABRIC.costAmount || 0)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Printing Cost:</span>
                                <span className="font-medium font-mono">{fmtMoney(stepDrafts.PRINTING.costAmount || 0)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Cutting Cost:</span>
                                <span className="font-medium font-mono">{fmtMoney(stepDrafts.CUTTING.costAmount || 0)}</span>
                            </div>
                            <div className="flex justify-between font-semibold">
                                <span className="text-muted-foreground">Total Cost:</span>
                                <span className="font-bold font-mono">{fmtMoney(productionCostTotal)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Status:</span>
                                <span className="font-medium">{purchaseOrder.status}</span>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Production Cost</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Total Cost</span>
                                <span className="font-medium font-mono">Tk {productionCostTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Paid</span>
                                <span className="font-medium font-mono text-emerald-700">Tk {productionPaidTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Due</span>
                                <span className="font-medium font-mono text-destructive">Tk {productionDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Final Qty (Finishing)</span>
                                <span className="font-medium">{finishingQty}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Per Unit Cost (Total / Finished)</span>
                                <span className="font-medium font-mono">Tk {perUnitCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        </CardContent>
                    </Card>
                    <PurchaseOrderHistory logs={purchaseOrder.logs} />
                </div>

                <div className="lg:col-span-8 xl:col-span-9">
                    <Card>
                        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle>Production Steps</CardTitle>
                                <CardDescription>Work through Fabric, Printing, Cutting, and Final Receiving.</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Accordion type="single" collapsible value={activeStep} onValueChange={(value) => value && setActiveStep(value as StepId)}>
                                <AccordionItem value="fabric">
                                    <AccordionTrigger>Step 1: Fabric & Planning</AccordionTrigger>
                                    <AccordionContent>
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Supplier</Label>
                                                    <div className="rounded-md border px-3 py-2 text-sm">{supplier?.name || '-'}</div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Send to Printing Vendor</Label>
                                                    <PartnerAsyncSelect
                                                        type="vendor"
                                                        value={stepDrafts.PRINTING.vendorId || undefined}
                                                        onSelect={(id) => handleStepDraftChange('PRINTING', 'vendorId', id)}
                                                        initialOptions={vendors.filter(v => hasVendorType(v, 'Printing'))}
                                                        additionalParams={{ type: 'Printing' }}
                                                        placeholder="Select printing vendor"
                                                        disabled={!isStepEnabled('fabric') || purchaseOrder.status === 'Received'}
                                                    />
                                                </div>
                                                <div className="space-y-2 hidden">
                                                    <Label>Fabric Source</Label>
                                                    <Select
                                                        value={stepDrafts.FABRIC.fabricSource || 'EXTERNAL'}
                                                        onValueChange={(val) => handleFabricSourceChange(val as 'INTERNAL' | 'EXTERNAL')}
                                                        disabled={!isStepEnabled('fabric') || purchaseOrder.status === 'Received'}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select source" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="EXTERNAL">Supplier (External)</SelectItem>
                                                            <SelectItem value="INTERNAL">Internal Stock</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {stepDrafts.FABRIC.fabricSource === 'INTERNAL' && (
                                                    <div className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground sm:col-span-2">
                                                        Allocate fabric lots per item below (scan or select lots for Jama/Orna/Selowar).
                                                    </div>
                                                )}

                                            </div>

                                            <div className="space-y-4 sm:hidden">
                                                {threePieceItems.map((it) => {
                                                    const fabricCost =
                                                        (Number(it.jamaYards) || 0) * (Number(it.jamaRate) || 0) +
                                                        (Number(it.ornaYards) || 0) * (Number(it.ornaRate) || 0) +
                                                        (Number(it.selowarYards) || 0) * (Number(it.selowarRate) || 0);
                                                    const disabled = !isStepEnabled('fabric') || purchaseOrder.status === 'Received';
                                                    const isInternal = stepDrafts.FABRIC.fabricSource === 'INTERNAL';
                                                    return (
                                                        <div key={it.id} className="rounded-lg border bg-white p-3 shadow-sm space-y-3">
                                                            <div>
                                                                <div className="font-medium">{it.productName}</div>
                                                                {it.variantName && (
                                                                    <div className="text-xs text-muted-foreground">{it.variantName}</div>
                                                                )}
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="space-y-1">
                                                                    <Label>Qty (pcs)</Label>
                                                                    <Input
                                                                        type="number"
                                                                        value={it.quantity}
                                                                        onChange={(e) => updateThreePieceItemDraft(it.id, { quantity: Number(e.target.value) || 0 })}
                                                                        disabled={disabled}
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label>Fabric Cost</Label>
                                                                    <div className="rounded-md border bg-muted/30 px-2 py-2 text-xs font-mono">
                                                                        {fmtMoney(fabricCost)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <div className="rounded-md border p-2">
                                                                    <p className="text-xs font-semibold">Jama</p>
                                                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                                                        <Input
                                                                            type="number"
                                                                            value={it.jamaYards}
                                                                            min={0}
                                                                            step={1}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { jamaYards: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                        <Input
                                                                            type="number"
                                                                            value={it.jamaRate}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { jamaRate: Number(e.target.value) || 0 })}
                                                                            disabled={disabled || isInternal}
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="rounded-md border p-2">
                                                                    <p className="text-xs font-semibold">Orna</p>
                                                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                                                        <Input
                                                                            type="number"
                                                                            value={it.ornaYards}
                                                                            min={0}
                                                                            step={1}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { ornaYards: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                        <Input
                                                                            type="number"
                                                                            value={it.ornaRate}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { ornaRate: Number(e.target.value) || 0 })}
                                                                            disabled={disabled || isInternal}
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="rounded-md border p-2">
                                                                    <p className="text-xs font-semibold">Selowar</p>
                                                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                                                        <Input
                                                                            type="number"
                                                                            value={it.selowarYards}
                                                                            min={0}
                                                                            step={1}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { selowarYards: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                        <Input
                                                                            type="number"
                                                                            value={it.selowarRate}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { selowarRate: Number(e.target.value) || 0 })}
                                                                            disabled={disabled || isInternal}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {isInternal && (
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="w-full"
                                                                    onClick={() => setLotDialogItemId(it.id)}
                                                                    disabled={disabled}
                                                                >
                                                                    Lots
                                                                </Button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="hidden w-full overflow-x-auto sm:block">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead className="min-w-[220px]">Product</TableHead>
                                                            <TableHead className="min-w-[90px]">Qty</TableHead>
                                                            <TableHead className="min-w-[130px]">Jama Yds</TableHead>
                                                            <TableHead className="min-w-[130px]">Jama Rate</TableHead>
                                                            <TableHead className="min-w-[130px]">Orna Yds</TableHead>
                                                            <TableHead className="min-w-[130px]">Orna Rate</TableHead>
                                                            <TableHead className="min-w-[140px]">Selowar Yds</TableHead>
                                                            <TableHead className="min-w-[140px]">Selowar Rate</TableHead>
                                                            <TableHead className="text-right min-w-[140px]">Fabric Cost</TableHead>
                                                            <TableHead className="text-right w-[90px]"></TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {threePieceItems.map((it) => {
                                                            const fabricCost =
                                                                (Number(it.jamaYards) || 0) * (Number(it.jamaRate) || 0) +
                                                                (Number(it.ornaYards) || 0) * (Number(it.ornaRate) || 0) +
                                                                (Number(it.selowarYards) || 0) * (Number(it.selowarRate) || 0);
                                                            const disabled = !isStepEnabled('fabric') || purchaseOrder.status === 'Received';
                                                            const isInternal = stepDrafts.FABRIC.fabricSource === 'INTERNAL';
                                                            return (
                                                                <TableRow key={it.id}>
                                                                    <TableCell>
                                                                        <div className="font-medium">{it.productName}</div>
                                                                        {it.variantName && (
                                                                            <div className="text-xs text-muted-foreground">{it.variantName}</div>
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            value={it.quantity}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { quantity: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            value={it.jamaYards}
                                                                            min={0}
                                                                            step={1}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { jamaYards: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            value={it.jamaRate}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { jamaRate: Number(e.target.value) || 0 })}
                                                                            disabled={disabled || isInternal}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            value={it.ornaYards}
                                                                            min={0}
                                                                            step={1}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { ornaYards: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            value={it.ornaRate}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { ornaRate: Number(e.target.value) || 0 })}
                                                                            disabled={disabled || isInternal}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            value={it.selowarYards}
                                                                            min={0}
                                                                            step={1}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { selowarYards: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            value={it.selowarRate}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { selowarRate: Number(e.target.value) || 0 })}
                                                                            disabled={disabled || isInternal}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-mono">{fmtMoney(fabricCost)}</TableCell>
                                                                    <TableCell className="text-right">
                                                                        {isInternal && (
                                                                            <Button
                                                                                type="button"
                                                                                variant="outline"
                                                                                size="sm"
                                                                                onClick={() => setLotDialogItemId(it.id)}
                                                                                disabled={disabled}
                                                                            >
                                                                                Lots
                                                                            </Button>
                                                                        )}
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>

                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="text-sm text-muted-foreground">
                                                    Fabric Total: <span className="font-mono text-foreground">{fmtMoney(fabricTotalDraft)}</span>
                                                </div>
                                                <div className="flex flex-wrap justify-end gap-2">
                                                    <Button variant="outline" onClick={() => handleGenerateWorkOrder('FABRIC')} disabled={!isStepEnabled('fabric')}>
                                                        <FileText className="mr-2 h-4 w-4" /> Invoice
                                                    </Button>

                                                    <Button onClick={handleSaveFabricPlanningStep} disabled={savingStep === 'FABRIC' || !isStepEnabled('fabric') || purchaseOrder.status === 'Received'}>
                                                        {savingStep === 'FABRIC' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                        Save
                                                    </Button>
                                                    {currentStepId === 'fabric' && (
                                                        <Button variant="secondary" onClick={() => handleApproveAndAdvance('FABRIC')} disabled={isAdvancing || purchaseOrder.status === 'Received'}>
                                                            {isAdvancing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                            Approve & Next
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>

                                            {stepDrafts.FABRIC.fabricSource === 'INTERNAL' ? (
                                                <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                                                    Internal stock used for fabric. No supplier payment is required.
                                                </div>
                                            ) : (
                                                <div className="rounded-md border bg-muted/30 p-3">
                                                    {stepDrafts.FABRIC.fabricSource === 'EXTERNAL' && (
                                                        <div className="flex flex-col items-center justify-center py-4 text-center border rounded-md bg-background/50">
                                                            <Coins className="h-4 w-4 mb-1 text-muted-foreground" />
                                                            <p className="text-[10px] text-muted-foreground px-4">
                                                                Manage payments via <Link href={`/dashboard/partners/suppliers?id=${purchaseOrder.supplierId}`} className="text-blue-600 font-medium hover:underline inline-flex items-center">Supplier Profile <ExternalLink className="ml-0.5 h-2 w-2" /></Link>
                                                            </p>
                                                        </div>
                                                    )}
                                                    <div className="mt-2 flex items-center justify-between border-t pt-2">
                                                        <span className="text-sm font-medium">Step Invoice</span>
                                                        <div className="flex items-center gap-2">
                                                            {(() => {
                                                                const invUrl = productionStepsByType.FABRIC?.invoiceUrl;
                                                                if (invUrl) {
                                                                    return (
                                                                        <>
                                                                            <Button variant="ghost" size="sm" className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => handleViewImage(invUrl)}>
                                                                                <Eye className="mr-2 h-4 w-4" /> View
                                                                            </Button>
                                                                            <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-foreground" onClick={() => handleUploadClick('FABRIC')}>
                                                                                <Upload className="mr-2 h-4 w-4" /> Replace
                                                                            </Button>
                                                                        </>
                                                                    );
                                                                }
                                                                return (
                                                                    <Button variant="outline" size="sm" onClick={() => handleUploadClick('FABRIC')}>
                                                                        <Upload className="mr-2 h-4 w-4" /> Upload
                                                                    </Button>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                                <AccordionItem value="printing">
                                    <AccordionTrigger>Step 2: Printing</AccordionTrigger>
                                    <AccordionContent>
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div className="space-y-2 sm:col-span-2">
                                                    <Label>Printing Vendor</Label>
                                                    <div className="rounded-md border px-3 py-2 text-sm">
                                                        {vendors.find((v) => v.id === (productionStepsByType.PRINTING?.vendorId || stepDrafts.PRINTING.vendorId))?.name || '-'}
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                </div>
                                                <div className="space-y-2">
                                                </div>
                                                <div className="space-y-2 sm:col-span-2">
                                                    <Label>Next: Cutting Source</Label>
                                                    <div className="flex items-center gap-4">
                                                        <Select
                                                            value={stepDrafts.CUTTING.cuttingType}
                                                            onValueChange={(val) => handleStepDraftChange('CUTTING', 'cuttingType', val)}
                                                            disabled={!isStepEnabled('printing') || purchaseOrder.status === 'Received'}
                                                        >
                                                            <SelectTrigger className="w-[180px]">
                                                                <SelectValue placeholder="Source" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="EXTERNAL">Vendor (External)</SelectItem>
                                                                <SelectItem value="INTERNAL">Internal Master</SelectItem>
                                                            </SelectContent>
                                                        </Select>

                                                        {stepDrafts.CUTTING.cuttingType === 'EXTERNAL' ? (
                                                            <PartnerAsyncSelect
                                                                type="vendor"
                                                                value={stepDrafts.CUTTING.vendorId || undefined}
                                                                onSelect={(id) => handleStepDraftChange('CUTTING', 'vendorId', id)}
                                                                initialOptions={(() => {
                                                                    const filtered = vendors.filter(v => hasVendorType(v, 'Cutting'));
                                                                    const selected = stepDrafts.CUTTING.vendorId ? vendors.find(v => v.id === stepDrafts.CUTTING.vendorId) : null;
                                                                    if (selected && !filtered.find(v => v.id === selected.id)) {
                                                                        return [selected, ...filtered];
                                                                    }
                                                                    return filtered;
                                                                })()}
                                                                additionalParams={{ type: 'Cutting' }}
                                                                placeholder="Select cutting vendor"
                                                                disabled={!isStepEnabled('printing') || purchaseOrder.status === 'Received'}
                                                            />
                                                        ) : (
                                                            <Select
                                                                value={stepDrafts.CUTTING.assignedStaffId || undefined}
                                                                onValueChange={(val) => handleStepDraftChange('CUTTING', 'assignedStaffId', val)}
                                                                disabled={!isStepEnabled('printing') || purchaseOrder.status === 'Received'}
                                                            >
                                                                <SelectTrigger className="flex-1">
                                                                    <SelectValue placeholder="Select cutting master" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {cuttingMasters?.map((s) => (
                                                                        <SelectItem key={s.id} value={s.id}>
                                                                            {s.name} ({s.staffCode})
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-4 sm:hidden">
                                                {threePieceItems.map((it) => {
                                                    const disabled = !isStepEnabled('printing') || purchaseOrder.status === 'Received';
                                                    return (
                                                        <div key={it.id} className="rounded-lg border bg-white p-3 shadow-sm space-y-3">
                                                            <div>
                                                                <div className="font-medium">{it.productName}</div>
                                                                {it.variantName && (
                                                                    <div className="text-xs text-muted-foreground">{it.variantName}</div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-muted-foreground">Qty</span>
                                                                <span className="font-medium">{it.quantity}</span>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label>Printing Cost</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={it.printingCost}
                                                                    onChange={(e) => updateThreePieceItemDraft(it.id, { printingCost: Number(e.target.value) || 0 })}
                                                                    disabled={disabled}
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label>Damaged (pcs)</Label>
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    max={it.quantity || 0}
                                                                    value={it.printingDamagedQty}
                                                                    onChange={(e) => updateThreePieceItemDraft(it.id, { printingDamagedQty: Number(e.target.value) || 0 })}
                                                                    disabled={disabled}
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="hidden w-full overflow-x-auto sm:block">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead className="min-w-[240px]">Product</TableHead>
                                                            <TableHead className="min-w-[90px]">Qty</TableHead>
                                                            <TableHead className="w-[120px]">Printing Rate</TableHead>
                                                            <TableHead className="w-[80px]">Damaged</TableHead>
                                                            <TableHead className="w-[100px] text-right">Total</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {threePieceItems.map((it, idx) => {
                                                            const disabled = !isStepEnabled('printing') || purchaseOrder.status === 'Received';
                                                            const qty = it.quantity || 0;
                                                            const damage = it.printingDamagedQty || 0;
                                                            const billable = Math.max(0, qty - damage);
                                                            const rate = it.printingCost || 0;
                                                            const total = billable * rate;

                                                            return (
                                                                <TableRow key={it.id}>
                                                                    <TableCell>
                                                                        <div className="font-medium">{it.productName}</div>
                                                                        {it.variantName && (
                                                                            <div className="text-xs text-muted-foreground">{it.variantName}</div>
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell>{qty}</TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            className="h-8"
                                                                            value={it.printingCost || ''}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { printingCost: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            min={0}
                                                                            max={qty}
                                                                            className="h-8 w-[80px]"
                                                                            value={it.printingDamagedQty || ''}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { printingDamagedQty: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-medium">
                                                                        {fmtMoney(total)}
                                                                        <div className="text-[10px] text-muted-foreground font-normal">for {billable} pcs</div>
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>

                                            <div className="grid gap-2 mb-6 max-w-md">
                                                <Label>Printing Note</Label>
                                                <Textarea
                                                    placeholder="Add notes about damage or printing quality..."
                                                    value={stepNotes.PRINTING}
                                                    onChange={(e) => setStepNotes(prev => ({ ...prev, PRINTING: e.target.value }))}
                                                    disabled={!isStepEnabled('printing') || purchaseOrder.status === 'Received'}
                                                />
                                            </div>

                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="text-sm text-muted-foreground">
                                                    Printing Total: <span className="font-mono text-foreground">{fmtMoney(printingTotalDraft)}</span>
                                                </div>
                                                <div className="flex flex-wrap justify-end gap-2">
                                                    <Button variant="outline" onClick={() => handleGenerateWorkOrder('PRINTING')} disabled={!isStepEnabled('printing')}>
                                                        <FileText className="mr-2 h-4 w-4" /> Invoice
                                                    </Button>

                                                    <Button onClick={handleSavePrintingStep} disabled={savingStep === 'PRINTING' || !isStepEnabled('printing') || purchaseOrder.status === 'Received'}>
                                                        {savingStep === 'PRINTING' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                        Save
                                                    </Button>
                                                    {currentStepId === 'printing' && (
                                                        <Button variant="secondary" onClick={() => handleApproveAndAdvance('PRINTING')} disabled={isAdvancing || purchaseOrder.status === 'Received'}>
                                                            {isAdvancing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                            Approve & Next
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="rounded-md border bg-muted/30 p-3">
                                                <div className="flex flex-col items-center justify-center py-4 text-center border rounded-md bg-background/50">
                                                    <Coins className="h-4 w-4 mb-1 text-muted-foreground" />
                                                    {(() => {
                                                        const vendorId = productionStepsByType.PRINTING?.vendorId || stepDrafts.PRINTING.vendorId;
                                                        if (!vendorId) return null;
                                                        return (
                                                            <p className="text-[10px] text-muted-foreground px-4">
                                                                Manage payments via <Link href={`/dashboard/partners/${vendorId}`} className="text-blue-600 font-medium hover:underline inline-flex items-center">Vendor Profile <ExternalLink className="ml-0.5 h-2 w-2" /></Link>
                                                            </p>
                                                        );
                                                    })()}
                                                </div>
                                                <div className="mt-2 flex items-center justify-between border-t pt-2">
                                                    <span className="text-sm font-medium">Step Invoice</span>
                                                    <div className="flex items-center gap-2">
                                                        {(() => {
                                                            const invUrl = productionStepsByType.PRINTING?.invoiceUrl;
                                                            if (invUrl) {
                                                                return (
                                                                    <>
                                                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => handleViewImage(invUrl)}>
                                                                            <Eye className="mr-2 h-4 w-4" /> View
                                                                        </Button>
                                                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-foreground" onClick={() => handleUploadClick('PRINTING')}>
                                                                            <Upload className="mr-2 h-4 w-4" /> Replace
                                                                        </Button>
                                                                    </>
                                                                );
                                                            }
                                                            return (
                                                                <Button variant="outline" size="sm" onClick={() => handleUploadClick('PRINTING')}>
                                                                    <Upload className="mr-2 h-4 w-4" /> Upload
                                                                </Button>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                                <AccordionItem value="cutting">
                                    <AccordionTrigger>Step 3: Cutting</AccordionTrigger>
                                    <AccordionContent>
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div className="space-y-2 sm:col-span-2">
                                                    {(productionStepsByType.CUTTING?.cuttingType === 'INTERNAL' || stepDrafts.CUTTING.cuttingType === 'INTERNAL') ? (
                                                        <>
                                                            <Label>Cutting Master (Internal)</Label>
                                                            <Select
                                                                disabled={!isStepEnabled('cutting') || purchaseOrder.status === 'Received'}
                                                                value={stepDrafts.CUTTING.assignedStaffId || undefined}
                                                                onValueChange={(val) => handleStepDraftChange('CUTTING', 'assignedStaffId', val)}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select master" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {cuttingMasters.map((s) => (
                                                                        <SelectItem key={s.id} value={s.id}>{s.name} ({s.role})</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Label>Cutting Vendor</Label>
                                                            <PartnerAsyncSelect
                                                                type="vendor"
                                                                value={stepDrafts.CUTTING.vendorId || undefined}
                                                                onSelect={(id) => handleStepDraftChange('CUTTING', 'vendorId', id)}
                                                                initialOptions={(() => {
                                                                    const filtered = vendors.filter(v => hasVendorType(v, 'Cutting'));
                                                                    const selected = stepDrafts.CUTTING.vendorId ? vendors.find(v => v.id === stepDrafts.CUTTING.vendorId) : null;
                                                                    if (selected && !filtered.find(v => v.id === selected.id)) {
                                                                        return [selected, ...filtered];
                                                                    }
                                                                    return filtered;
                                                                })()}
                                                                additionalParams={{ type: 'Cutting' }}
                                                                placeholder="Select cutting vendor"
                                                                disabled={!isStepEnabled('cutting') || purchaseOrder.status === 'Received'}
                                                            />
                                                        </>
                                                    )}
                                                </div>

                                                {/* Pindi of Fab (optional) Removed from UI */}
                                                {(productionStepsByType.CUTTING?.cuttingType === 'INTERNAL' || stepDrafts.CUTTING.cuttingType === 'INTERNAL') && (
                                                    <div className="space-y-2">
                                                        <Label>Lumpsum Amount</Label>
                                                        <Input
                                                            type="number"
                                                            value={stepDrafts.CUTTING.paymentAmount || ''}
                                                            onChange={(e) => handleStepDraftChange('CUTTING', 'paymentAmount', Number(e.target.value) || 0)}
                                                            disabled={!isStepEnabled('cutting') || purchaseOrder.status === 'Received'}
                                                            placeholder="Total Cost"
                                                        />
                                                        {(() => {
                                                            const totalCost = stepDrafts.CUTTING.paymentAmount || 0;
                                                            if (!totalCost) return null;
                                                            const totalBillable = threePieceItems.reduce((sum, item) => {
                                                                const qty = Number(item.quantity) || 0;
                                                                const pDmg = Number(item.printingDamagedQty) || 0;
                                                                const cDmg = Number(item.cuttingDamagedQty) || 0;
                                                                return sum + Math.max(0, qty - pDmg - cDmg);
                                                            }, 0);
                                                            const rate = totalBillable > 0 ? totalCost / totalBillable : 0;
                                                            return (
                                                                <div className="text-xs text-muted-foreground mt-1">
                                                                    Per-piece rate: <span className="font-mono font-medium text-foreground">{fmtMoney(rate)}</span>
                                                                    <span className="ml-1 opacity-70">({totalBillable} pcs)</span>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="space-y-4 sm:hidden">
                                                {threePieceItems.map((it) => {
                                                    const disabled = !isStepEnabled('cutting') || purchaseOrder.status === 'Received' || stepDrafts.CUTTING.cuttingType === 'INTERNAL';
                                                    return (
                                                        <div key={it.id} className="rounded-lg border bg-white p-3 shadow-sm space-y-3">
                                                            <div>
                                                                <div className="font-medium">{it.productName}</div>
                                                                {it.variantName && (
                                                                    <div className="text-xs text-muted-foreground">{it.variantName}</div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-muted-foreground">Qty</span>
                                                                <span className="font-medium">{it.quantity}</span>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label>Cutting Cost</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={it.cuttingCost}
                                                                    onChange={(e) => updateThreePieceItemDraft(it.id, { cuttingCost: Number(e.target.value) || 0 })}
                                                                    disabled={disabled || stepDrafts.CUTTING.cuttingType === 'INTERNAL'}
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label>Damaged (pcs)</Label>
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    max={(it.quantity || 0) - (it.printingDamagedQty || 0)}
                                                                    value={it.cuttingDamagedQty}
                                                                    onChange={(e) => updateThreePieceItemDraft(it.id, { cuttingDamagedQty: Number(e.target.value) || 0 })}
                                                                    disabled={disabled}
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="hidden w-full overflow-x-auto sm:block">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead className="min-w-[240px]">Product</TableHead>
                                                            <TableHead className="min-w-[90px]">Qty</TableHead>
                                                            <TableHead className="w-[80px]">Printing Dmg</TableHead>
                                                            <TableHead className="w-[80px]">Cutting Cost</TableHead>
                                                            <TableHead className="w-[80px]">Cutting Dmg</TableHead>
                                                            <TableHead className="w-[100px] text-right">Total</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {threePieceItems.map((item, idx) => {
                                                            const qty = item.quantity || 0;
                                                            const pDmg = item.printingDamagedQty || 0;
                                                            const cDmg = item.cuttingDamagedQty || 0;
                                                            const billable = Math.max(0, qty - pDmg - cDmg);
                                                            const total = billable * (item.cuttingCost || 0);
                                                            const disabled = !isStepEnabled('cutting') || purchaseOrder.status === 'Received';
                                                            const isInternal = stepDrafts.CUTTING.cuttingType === 'INTERNAL';

                                                            return (
                                                                <TableRow key={item.id}>
                                                                    <TableCell>
                                                                        <div className="font-medium">{item.productName}</div>
                                                                        {item.variantName && (
                                                                            <div className="text-xs text-muted-foreground">{item.variantName}</div>
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell>{qty}</TableCell>
                                                                    <TableCell className="text-muted-foreground text-xs">{pDmg > 0 ? pDmg : '-'}</TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            value={item.cuttingCost}
                                                                            onChange={(e) => updateThreePieceItemDraft(item.id, { cuttingCost: Number(e.target.value) || 0 })}
                                                                            disabled={disabled || isInternal}
                                                                            className="h-8 w-[80px]"
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            min={0}
                                                                            max={(item.quantity || 0) - (item.printingDamagedQty || 0)}
                                                                            className="h-8 w-[80px]"
                                                                            value={item.cuttingDamagedQty || ''}
                                                                            onChange={(e) => updateThreePieceItemDraft(item.id, { cuttingDamagedQty: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-medium">
                                                                        {fmtMoney(total)}
                                                                        <div className="text-[10px] text-muted-foreground font-normal">for {billable} pcs</div>
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>

                                            <div className="grid gap-2 mb-6 max-w-md">
                                                <Label>Cutting Note</Label>
                                                <Textarea
                                                    placeholder="Add notes about damage or cutting quality..."
                                                    value={stepNotes.CUTTING}
                                                    onChange={(e) => setStepNotes(prev => ({ ...prev, CUTTING: e.target.value }))}
                                                    disabled={!isStepEnabled('cutting') || purchaseOrder.status === 'Received'}
                                                />
                                            </div>

                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="text-sm text-muted-foreground">
                                                    Cutting Total: <span className="font-mono text-foreground">{fmtMoney(cuttingTotalDraft)}</span>
                                                </div>
                                                <div className="flex flex-wrap justify-end gap-2">
                                                    <Button variant="outline" onClick={() => handleGenerateWorkOrder('CUTTING')} disabled={!isStepEnabled('cutting')}>
                                                        <FileText className="mr-2 h-4 w-4" /> Invoice
                                                    </Button>

                                                    <Button onClick={handleSaveCuttingStep} disabled={savingStep === 'CUTTING' || !isStepEnabled('cutting') || purchaseOrder.status === 'Received'}>
                                                        {savingStep === 'CUTTING' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                        Save
                                                    </Button>
                                                    {currentStepId === 'cutting' && (
                                                        <Button variant="secondary" onClick={() => handleApproveAndAdvance('CUTTING')} disabled={isAdvancing || purchaseOrder.status === 'Received'}>
                                                            {isAdvancing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                            Approve & Next
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="rounded-md border bg-muted/30 p-3">
                                                <div className="flex flex-col items-center justify-center py-4 text-center border rounded-md bg-background/50">
                                                    <Coins className="h-4 w-4 mb-1 text-muted-foreground" />
                                                    {(() => {
                                                        const vendorId = productionStepsByType.CUTTING?.vendorId || stepDrafts.CUTTING.vendorId;
                                                        if (!vendorId) return null;
                                                        return (
                                                            <p className="text-[10px] text-muted-foreground px-4">
                                                                Manage payments via <Link href={`/dashboard/partners/${vendorId}`} className="text-blue-600 font-medium hover:underline inline-flex items-center">Vendor Profile <ExternalLink className="ml-0.5 h-2 w-2" /></Link>
                                                            </p>
                                                        );
                                                    })()}
                                                </div>
                                                <div className="mt-2 flex items-center justify-between border-t pt-2">
                                                    <span className="text-sm font-medium">Step Invoice</span>
                                                    <div className="flex items-center gap-2">
                                                        {(() => {
                                                            const invUrl = productionStepsByType.CUTTING?.invoiceUrl;
                                                            if (invUrl) {
                                                                return (
                                                                    <>
                                                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => handleViewImage(invUrl)}>
                                                                            <Eye className="mr-2 h-4 w-4" /> View
                                                                        </Button>
                                                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-foreground" onClick={() => handleUploadClick('CUTTING')}>
                                                                            <Upload className="mr-2 h-4 w-4" /> Replace
                                                                        </Button>
                                                                    </>
                                                                );
                                                            }
                                                            return (
                                                                <Button variant="outline" size="sm" onClick={() => handleUploadClick('CUTTING')}>
                                                                    <Upload className="mr-2 h-4 w-4" /> Upload
                                                                </Button>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                                <AccordionItem value="finishing">
                                    <AccordionTrigger>Step 4: Final Receiving</AccordionTrigger>
                                    <AccordionContent>
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div className="space-y-1 text-sm">
                                                    <p className="text-muted-foreground">Printing Damage</p>
                                                    <p className="font-medium">{threePieceItems.reduce((s, i) => s + (i.printingDamagedQty || 0), 0)} pcs</p>
                                                </div>
                                                <div className="space-y-1 text-sm">
                                                    <p className="text-muted-foreground">Cutting Damage</p>
                                                    <p className="font-medium">{threePieceItems.reduce((s, i) => s + (i.cuttingDamagedQty || 0), 0)} pcs</p>
                                                </div>
                                                <div className="space-y-1 text-sm">
                                                    <p className="text-muted-foreground">Finishing Wastage</p>
                                                    <p className="font-medium">{threePieceItems.reduce((s, i) => s + (i.finishingWastageQty || 0), 0)} pcs</p>
                                                </div>
                                            </div>

                                            <div className="space-y-4 sm:hidden">
                                                {threePieceItems.map((it) => {
                                                    const fabricCost =
                                                        (Number(it.jamaYards) || 0) * (Number(it.jamaRate) || 0) +
                                                        (Number(it.ornaYards) || 0) * (Number(it.ornaRate) || 0) +
                                                        (Number(it.selowarYards) || 0) * (Number(it.selowarRate) || 0);
                                                    // Sync with sidebar logic: Total Cost / Total Qty
                                                    const unit = perUnitCost > 0 ? perUnitCost : ((fabricCost / (Number(it.finalQty) || 1)) + (Number(it.printingCost) || 0) + (Number(it.cuttingCost) || 0));
                                                    const disabled = !isStepEnabled('finishing') || purchaseOrder.status === 'Received';
                                                    return (
                                                        <div key={it.id} className="rounded-lg border bg-white p-3 shadow-sm space-y-3">
                                                            <div>
                                                                <div className="font-medium">{it.productName}</div>
                                                                {it.variantName && (
                                                                    <div className="text-xs text-muted-foreground">{it.variantName}</div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-muted-foreground">Planned</span>
                                                                <span className="font-medium">{it.quantity}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-muted-foreground">Received</span>
                                                                <span className="font-medium">{it.receivedQty}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-muted-foreground">Remaining</span>
                                                                <span className="font-medium text-blue-600">{it.finalQty - it.receivedQty}</span>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label>Wastage (pcs)</Label>
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    max={(it.quantity || 0) - (it.printingDamagedQty || 0) - (it.cuttingDamagedQty || 0)}
                                                                    value={it.finishingWastageQty}
                                                                    onChange={(e) => updateThreePieceItemDraft(it.id, { finishingWastageQty: Number(e.target.value) || 0 })}
                                                                    disabled={disabled}
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label>Receiving Now</Label>
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    max={it.finalQty - it.receivedQty}
                                                                    value={it.receivingNow}
                                                                    onChange={(e) => updateThreePieceItemDraft(it.id, { receivingNow: Number(e.target.value) || 0 })}
                                                                    disabled={disabled}
                                                                />
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-muted-foreground">Unit Cost</span>
                                                                <span className="font-mono">{fmtMoney(unit)}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="hidden w-full overflow-x-auto sm:block">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead className="min-w-[220px]">Product</TableHead>
                                                            <TableHead className="min-w-[90px]">Planned</TableHead>
                                                            <TableHead className="min-w-[90px]">Wastage</TableHead>
                                                            <TableHead className="min-w-[80px]">Received</TableHead>
                                                            <TableHead className="min-w-[80px]">Balance</TableHead>
                                                            <TableHead className="min-w-[110px]">Receive Now</TableHead>
                                                            <TableHead className="min-w-[140px]">Unit Cost</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {threePieceItems.map((it) => {
                                                            const fabricCost =
                                                                (Number(it.jamaYards) || 0) * (Number(it.jamaRate) || 0) +
                                                                (Number(it.ornaYards) || 0) * (Number(it.ornaRate) || 0) +
                                                                (Number(it.selowarYards) || 0) * (Number(it.selowarRate) || 0);
                                                            const total = fabricCost;
                                                            // printingCost and cuttingCost in threePieceItems draft are RATES per unit.
                                                            // Sync with sidebar logic: Total Cost / Total Qty
                                                            const unit = perUnitCost > 0 ? perUnitCost : ((fabricCost / (Number(it.finalQty) || 1)) + (Number(it.printingCost) || 0) + (Number(it.cuttingCost) || 0));
                                                            const disabled = !isStepEnabled('finishing') || purchaseOrder.status === 'Received';
                                                            return (
                                                                <TableRow key={it.id}>
                                                                    <TableCell>
                                                                        <div className="font-medium">{it.productName}</div>
                                                                        {it.variantName && (
                                                                            <div className="text-xs text-muted-foreground">{it.variantName}</div>
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell>{it.quantity}</TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            min={0}
                                                                            max={(it.quantity || 0) - (it.printingDamagedQty || 0) - (it.cuttingDamagedQty || 0)}
                                                                            value={it.finishingWastageQty || ''}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { finishingWastageQty: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                            placeholder="Pcs"
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>{it.receivedQty}</TableCell>
                                                                    <TableCell className="font-medium text-blue-600">{it.finalQty - it.receivedQty}</TableCell>
                                                                    <TableCell>
                                                                        <Input
                                                                            type="number"
                                                                            min={0}
                                                                            max={it.finalQty - it.receivedQty}
                                                                            value={it.receivingNow}
                                                                            onChange={(e) => updateThreePieceItemDraft(it.id, { receivingNow: Number(e.target.value) || 0 })}
                                                                            disabled={disabled}
                                                                            placeholder="Qty"
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="font-mono">{fmtMoney(unit)}</TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Stock Location</Label>
                                                    <Select value={selectedLocationId} onValueChange={setSelectedLocationId} disabled={purchaseOrder.status === 'Received'}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select a location" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {stockLocations.map((loc) => (
                                                                <SelectItem key={loc.id} value={loc.id}>
                                                                    {loc.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Total Wastage (pcs)</Label>
                                                    <div className="rounded-md border px-3 py-2 text-sm">
                                                        {(threePieceItems.reduce((s, i) => s + (i.printingDamagedQty || 0), 0)) +
                                                            (threePieceItems.reduce((s, i) => s + (i.cuttingDamagedQty || 0), 0)) +
                                                            (threePieceItems.reduce((s, i) => s + (i.finishingWastageQty || 0), 0))}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap items-center justify-end gap-2">
                                                <Button variant="outline" onClick={() => handleGenerateWorkOrder('FINISHING')} disabled={!isStepEnabled('finishing')}>
                                                    <FileText className="mr-2 h-4 w-4" /> Invoice
                                                </Button>

                                            </div>

                                            <Dialog open={isReceiveDialogOpen} onOpenChange={setIsReceiveDialogOpen}>
                                                <DialogTrigger asChild>
                                                    <Button className="w-full" disabled={purchaseOrder.status === 'Received' || !isStepEnabled('finishing') || finishingQty <= 0}>
                                                        Receive Stock
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader>
                                                        <DialogTitle>Receive Stock</DialogTitle>
                                                        <DialogDescription>Confirm receiving stock into inventory.</DialogDescription>
                                                    </DialogHeader>
                                                    <div className="grid gap-4 py-4">
                                                        <div className="space-y-2">
                                                            <Label>Stock Location</Label>
                                                            <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                                                                <SelectTrigger><SelectValue placeholder="Select a location" /></SelectTrigger>
                                                                <SelectContent>
                                                                    {stockLocations.map((loc) => (
                                                                        <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-muted-foreground">Total Final Qty</span>
                                                            <span className="font-medium">{finishingQty}</span>
                                                        </div>
                                                    </div>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setIsReceiveDialogOpen(false)}>Cancel</Button>
                                                        <Button onClick={handleFinalizeReceivingStep} disabled={isReceiving}>
                                                            {isReceiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                            Confirm & Receive
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Dialog open={!!lotDialogItemId} onOpenChange={(open) => !open && setLotDialogItemId(null)}>
                <DialogContent className="w-[95vw] max-h-[90vh] flex flex-col overflow-hidden p-0 sm:max-w-3xl">
                    <div className="flex-none p-6 pb-2">
                        <DialogHeader>
                            <DialogTitle>Fabric Lot Allocation</DialogTitle>
                            <DialogDescription>Scan or select lots for each fabric part. Allocated yards must match the planned yards.</DialogDescription>
                        </DialogHeader>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
                        {activeLotItem ? (
                            <div className="space-y-4">
                                <div className="rounded-md border p-3">
                                    <div className="font-medium">{activeLotItem.productName}</div>
                                    {activeLotItem.variantName && (
                                        <div className="text-xs text-muted-foreground">{activeLotItem.variantName}</div>
                                    )}
                                    {activeLotItem.sku && (
                                        <div className="text-xs text-muted-foreground">SKU: {activeLotItem.sku}</div>
                                    )}
                                </div>
                                {lotPartConfigs.map((part) => {
                                    const required = Number(activeLotItem[part.yardsKey]) || 0;
                                    const allocations = activeLotItem.lotAllocations[part.key];
                                    const allocated = allocations.reduce((sum, alloc) => sum + (Number(alloc.yards) || 0), 0);
                                    return (
                                        <div key={part.key} className="space-y-3 rounded-md border p-3">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="font-medium">{part.label} Lots</div>
                                                <div className="text-xs text-muted-foreground">
                                                    Required: {required} yds • Allocated: {allocated} yds
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-3">
                                                <div className="space-y-2">
                                                    <Label>Select or Scan Lot</Label>
                                                    <LotSelectionCombobox
                                                        itemId={activeLotItem.id}
                                                        part={part.key}
                                                        localInventoryLots={localInventoryLots}
                                                        onSelect={(val) => addLotAllocation(activeLotItem.id as string, part.key, val.id)}
                                                        formatLotLabel={formatLotLabel}
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                {allocations.length === 0 && (
                                                    <div className="text-xs text-muted-foreground">No lots selected yet.</div>
                                                )}
                                                {allocations.map((alloc) => {
                                                    const lot = inventoryLotMap.get(alloc.inventoryItemId);
                                                    return (
                                                        <div key={alloc.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                                                            <div className="flex-1">
                                                                <div className="font-medium">{lot?.lotNumber || 'Unknown Lot'}</div>
                                                                <div className="text-xs text-muted-foreground">
                                                                    {lot ? `${formatLotName(lot)} (${lot.sku}) - ${lot.locationName} ` : 'Lot details unavailable'}
                                                                </div>
                                                            </div>
                                                            <Input
                                                                type="number"
                                                                min={0}
                                                                step={1}
                                                                className="w-28"
                                                                value={alloc.yards}
                                                                onChange={(e) => updateLotAllocationYards(activeLotItem.id, part.key, alloc.id, Number(e.target.value) || 0)}
                                                            />
                                                            <span className="text-xs text-muted-foreground">yds</span>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => removeLotAllocation(activeLotItem.id, part.key, alloc.id)}
                                                            >
                                                                <span className="sr-only">Remove</span>
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-sm text-muted-foreground">Select a fabric row to allocate lots.</div>
                        )}
                    </div>
                    
                    <div className="flex-none p-6 pt-2 border-t">
                        <DialogFooter>
                            <Button type="button" onClick={() => setLotDialogItemId(null)}>Done</Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={isImageViewerOpen} onOpenChange={setIsImageViewerOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Physical Invoice</DialogTitle>
                    </DialogHeader>
                    {viewingImageUrl && (
                        <div className="py-4 h-[80vh] w-full flex flex-col items-center">
                            <p className="text-xs text-muted-foreground mb-2 break-all">Debug URL: {viewingImageUrl}</p>
                            {viewingImageUrl.toLowerCase().endsWith('.pdf') ? (
                                <iframe src={viewingImageUrl} className="w-full h-full border-none" title="Invoice PDF" />
                            ) : (
                                <img src={viewingImageUrl} alt="Physical Invoice" className="w-full h-auto object-contain max-h-full" />
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div >
    );
}
