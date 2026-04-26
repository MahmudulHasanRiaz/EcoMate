'use client';

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
    Megaphone, Plus, TrendingUp, DollarSign, ShoppingCart,
    BarChart3, RefreshCcw, MoreHorizontal, Calendar as CalendarIcon,
    Search, Filter, ExternalLink, Copy, ShieldCheck
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { getMarketingOverview, getCampaigns, createCampaign } from "@/services/marketing";
import { getStaff, getCurrentStaff } from "@/services/staff";
import { getBusinesses } from "@/services/partners";
import { MarketingOverview, MarketingCampaign, StaffMemberUI, Business, StaffRole } from "@/types";
import { useToast } from "@/hooks/use-toast";

import { CampaignDetailsSheet } from "./campaign-details";

const currencyPrefix = 'Tk';

function getPerformanceBadge(status?: 'Excellent' | 'OK' | 'Loss') {
    if (!status) return null;
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
        Excellent: 'default',
        OK: 'secondary',
        Loss: 'destructive',
    };
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>;
}

export default function MarketingPage() {
    const [overview, setOverview] = useState<MarketingOverview | null>(null);
    const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
    const [staffId, setStaffId] = useState<string | null>(null);

    // Pagination
    const [campaignNextCursor, setCampaignNextCursor] = useState<string | undefined>(undefined);
    const [isLoadingMoreCampaigns, setIsLoadingMoreCampaigns] = useState(false);

    // Details Sheet
    const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    // Marketers
    const [marketers, setMarketers] = useState<StaffMemberUI[]>([]);
    const [businesses, setBusinesses] = useState<Business[]>([]);
    const [productOptions, setProductOptions] = useState<Array<{ id: string; name: string; sku?: string | null; image?: string | null }>>([]);
    const [productSearch, setProductSearch] = useState("");
    const [isLoadingProducts, setIsLoadingProducts] = useState(false);
    const [selectedProductMeta, setSelectedProductMeta] = useState<Record<string, { name: string; sku?: string | null; image?: string | null }>>({});

    const { toast } = useToast();

    // Filters
    const [dateRange, setDateRange] = useState<{ start: Date | undefined; end: Date | undefined }>({ start: undefined, end: undefined });
    const [selectedBusinessId, setSelectedBusinessId] = useState<string>("all");
    const [selectedMarketerId, setSelectedMarketerId] = useState<string>("all");

    const isMarketer = staffRole === 'Marketer';

    const [newCampaign, setNewCampaign] = useState({
        name: "",
        status: "Active",
        startDate: format(new Date(), 'yyyy-MM-dd'),
        marketerId: "none",
        targetCpr: "",
        maxCpr: "",
        trackedProductIds: [] as string[],
    });

    // Load current staff role on mount
    useEffect(() => {
        getCurrentStaff().then(res => {
            if (res.status === 'ok') {
                setStaffRole(res.staff.role);
                setStaffId(res.staff.id);
                // If Marketer, pre-set marketerId for creation and FILTER
                if (res.staff.role === 'Marketer') {
                    setNewCampaign(prev => ({ ...prev, marketerId: res.staff.id }));
                    setSelectedMarketerId(res.staff.id);
                }
            }
        });
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const effectiveBusinessId = selectedBusinessId === 'all' ? undefined : selectedBusinessId;
            const effectiveMarketerId = selectedMarketerId === 'all' ? undefined : selectedMarketerId;
            const [ovData, camData] = await Promise.all([
                getMarketingOverview({ startDate: dateRange.start, endDate: dateRange.end, businessId: effectiveBusinessId, marketerId: effectiveMarketerId }),
                getCampaigns({ status: undefined, pageSize: 50, businessId: effectiveBusinessId, marketerId: effectiveMarketerId })
            ]);
            setOverview(ovData);
            setCampaigns(camData.items);
            setCampaignNextCursor(camData.nextCursor);
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to load marketing data", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    const loadMarketers = async () => {
        try {
            const res = await getStaff({ role: 'Marketer', pageSize: 200 });
            setMarketers(res.items);
        } catch (e) {
            console.error("Failed to load marketers", e);
        }
    };

    const loadBusinesses = async () => {
        try {
            const res = await getBusinesses();
            setBusinesses(res);
        } catch (e) {
            console.error("Failed to load businesses", e);
        }
    };

    useEffect(() => {
        loadData();
        loadMarketers();
        loadBusinesses();
    }, [dateRange, selectedBusinessId, selectedMarketerId]);

    useEffect(() => {
        if (!isCreateOpen) return;
        const controller = new AbortController();
        const timeout = setTimeout(async () => {
            setIsLoadingProducts(true);
            try {
                const params = new URLSearchParams();
                params.set('mode', 'lookup');
                params.set('pageSize', '100');
                if (productSearch.trim()) params.set('search', productSearch.trim());

                const res = await fetch(`/api/products?${params.toString()}`, { signal: controller.signal });
                const payload = await res.json();
                const items = Array.isArray(payload?.data?.items)
                    ? payload.data.items
                    : (Array.isArray(payload?.items) ? payload.items : []);
                setProductOptions(
                    items.map((p: any) => ({
                        id: p.id,
                        name: p.name,
                        sku: p.sku ?? null,
                        image: p.image ?? null,
                    }))
                );
            } catch (e: any) {
                if (e?.name !== 'AbortError') {
                    console.error('Failed to load products for campaign', e);
                }
            } finally {
                setIsLoadingProducts(false);
            }
        }, 250);

        return () => {
            controller.abort();
            clearTimeout(timeout);
        };
    }, [isCreateOpen, productSearch]);

    const loadMoreCampaigns = async () => {
        if (!campaignNextCursor || isLoadingMoreCampaigns) return;
        setIsLoadingMoreCampaigns(true);
        try {
            const effectiveBusinessId = selectedBusinessId === 'all' ? undefined : selectedBusinessId;
            const effectiveMarketerId = selectedMarketerId === 'all' ? undefined : selectedMarketerId;
            const camData = await getCampaigns({ status: undefined, pageSize: 50, businessId: effectiveBusinessId, cursor: campaignNextCursor, marketerId: effectiveMarketerId });
            setCampaigns(prev => {
                const existingIds = new Set(prev.map(c => c.id));
                const newItems = camData.items.filter(c => !existingIds.has(c.id));
                return [...prev, ...newItems];
            });
            setCampaignNextCursor(camData.nextCursor);
        } catch (e) {
            console.error("Failed to load more campaigns", e);
        } finally {
            setIsLoadingMoreCampaigns(false);
        }
    };

    const handleCreate = async () => {
        if (newCampaign.trackedProductIds.length === 0) {
            toast({ title: "Required", description: "Select at least one product to create a campaign.", variant: "destructive" });
            return;
        }
        if (!newCampaign.targetCpr || !newCampaign.maxCpr) {
            toast({ title: "Required", description: "Target CPR and Max CPR are required.", variant: "destructive" });
            return;
        }
        if (parseFloat(newCampaign.targetCpr) >= parseFloat(newCampaign.maxCpr)) {
            toast({ title: "Invalid", description: "Target CPR must be less than Max CPR.", variant: "destructive" });
            return;
        }

        try {
            await createCampaign({
                name: newCampaign.name,
                status: newCampaign.status,
                startDate: newCampaign.startDate,
                marketerId: (newCampaign.marketerId === "none" || !newCampaign.marketerId) ? undefined : newCampaign.marketerId,
                trackedProductIds: newCampaign.trackedProductIds,
                targetCpr: parseFloat(newCampaign.targetCpr),
                maxCpr: parseFloat(newCampaign.maxCpr),
            } as any);
            toast({ title: "Success", description: "Campaign created" });
            setIsCreateOpen(false);
            setNewCampaign({
                name: "",
                status: "Active",
                startDate: format(new Date(), 'yyyy-MM-dd'),
                marketerId: isMarketer && staffId ? staffId : "none",
                targetCpr: "",
                maxCpr: "",
                trackedProductIds: [],
            });
            setSelectedProductMeta({});
            setProductSearch("");
            loadData();
        } catch (e: any) {
            toast({ title: "Error", description: e?.message || "Failed to create campaign", variant: "destructive" });
        }
    };

    const toggleTrackedProduct = (product: { id: string; name: string; sku?: string | null }, checked: boolean) => {
        setNewCampaign((prev) => {
            const nextIds = checked
                ? Array.from(new Set([...prev.trackedProductIds, product.id]))
                : prev.trackedProductIds.filter((id) => id !== product.id);
            return { ...prev, trackedProductIds: nextIds };
        });

        setSelectedProductMeta((prev) => {
            if (!checked) {
                const next = { ...prev };
                delete next[product.id];
                return next;
            }
            return { ...prev, [product.id]: { name: product.name, sku: product.sku ?? null, image: (product as any).image ?? null } };
        });
    };

    const openDetails = (id: string) => {
        setSelectedCampaignId(id);
        setIsDetailsOpen(true);
    };

    // Marketer specific aggregates
    const marketerProfitScore = campaigns.reduce((sum, c) => sum + ((c as any).profitScore || 0), 0);
    const totalCampOrders = campaigns.reduce((sum, c) => sum + c.attributedOrders, 0);
    const avgTarget = totalCampOrders > 0 ? campaigns.reduce((sum, c) => sum + ((c as any).targetCpr || 0) * c.attributedOrders, 0) / totalCampOrders : 0;
    const avgMax = totalCampOrders > 0 ? campaigns.reduce((sum, c) => sum + ((c as any).maxCpr || 0) * c.attributedOrders, 0) / totalCampOrders : 0;
    const overallActualCpr = overview?.attributedOrders ? overview.totalSpend / overview.attributedOrders : 0;
    
    let overallStatus: 'Excellent' | 'OK' | 'Loss' | undefined;
    if (avgMax > 0) {
        if (overallActualCpr <= avgTarget) overallStatus = 'Excellent';
        else if (overallActualCpr <= avgMax) overallStatus = 'OK';
        else overallStatus = 'Loss';
    }

    return (
        <div className="flex flex-col gap-4 p-4 lg:gap-6 lg:p-6 h-[calc(100vh-60px)] overflow-hidden">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Marketing</h1>
                    <p className="text-muted-foreground">Manage campaigns, track spend and ROI</p>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={selectedBusinessId} onValueChange={setSelectedBusinessId}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="All Businesses" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Businesses</SelectItem>
                            {businesses.map(b => (
                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {!isMarketer && (
                        <Select value={selectedMarketerId} onValueChange={setSelectedMarketerId}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="All Marketers" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Marketers</SelectItem>
                                {marketers.map(m => (
                                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    <div className="flex items-center gap-1">
                        <Input
                            type="date"
                            className="w-[130px] h-8 text-xs"
                            value={dateRange.start ? format(dateRange.start, 'yyyy-MM-dd') : ''}
                            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value ? new Date(e.target.value) : undefined }))}
                            placeholder="From"
                        />
                        <span className="text-muted-foreground text-xs">-</span>
                        <Input
                            type="date"
                            className="w-[130px] h-8 text-xs"
                            value={dateRange.end ? format(dateRange.end, 'yyyy-MM-dd') : ''}
                            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value ? new Date(e.target.value) : undefined }))}
                            placeholder="To"
                        />
                        {(dateRange.start || dateRange.end) && (
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setDateRange({ start: undefined, end: undefined })}>Clear</Button>
                        )}
                    </div>

                    <Button onClick={() => loadData()} variant="outline" size="sm">
                        <RefreshCcw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm">
                                <Plus className="h-4 w-4 mr-2" />
                                New Campaign
                            </Button>
                        </DialogTrigger>
                                        <DialogContent className="max-h-[95vh] flex flex-col p-0 gap-0">
                                            <DialogHeader className="p-6 pb-4 shrink-0 border-b">
                                                <DialogTitle>Create Campaign</DialogTitle>
                                                <DialogDescription>Start a new marketing campaign to track performance.</DialogDescription>
                                            </DialogHeader>
                                            <div className="flex-1 overflow-y-auto p-6 pt-4">
                                                <div className="grid gap-4">
                                                    <div className="grid gap-2">
                                                        <Label>Campaign Name</Label>
                                                        <Input
                                                            value={newCampaign.name}
                                                            onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                                                            placeholder="e.g. Eid Collection Promo"
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="grid gap-2">
                                                            <Label>Target CPR *</Label>
                                                            <Input
                                                                type="number"
                                                                value={newCampaign.targetCpr}
                                                                onChange={(e) => setNewCampaign({ ...newCampaign, targetCpr: e.target.value })}
                                                                placeholder="e.g. 200"
                                                            />
                                                        </div>
                                                        <div className="grid gap-2">
                                                            <Label>Max CPR *</Label>
                                                            <Input
                                                                type="number"
                                                                value={newCampaign.maxCpr}
                                                                onChange={(e) => setNewCampaign({ ...newCampaign, maxCpr: e.target.value })}
                                                                placeholder="e.g. 350"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="grid gap-2">
                                                        <Label>Start Date</Label>
                                                        <Input
                                                            type="date"
                                                            value={newCampaign.startDate}
                                                            onChange={(e) => setNewCampaign({ ...newCampaign, startDate: e.target.value })}
                                                        />
                                                    </div>

                                                    {/* Marketer selector: hidden for Marketer role */}
                                                    {!isMarketer && (
                                                        <div className="grid gap-2">
                                                            <Label>Marketer</Label>
                                                            <Select
                                                                value={newCampaign.marketerId}
                                                                onValueChange={(v) => setNewCampaign({ ...newCampaign, marketerId: v })}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select Marketer (Optional)" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="none">Unassigned</SelectItem>
                                                                    {marketers.map(m => (
                                                                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    )}

                                                    <div className="grid gap-3 mt-2">
                                                        <Label className="flex justify-between items-center">
                                                          <span>Tracked Products *</span>
                                                          <span className="text-xs text-muted-foreground font-normal">{newCampaign.trackedProductIds.length} selected</span>
                                                        </Label>
                                                        
                                                        {/* Selected Tags */}
                                                        {newCampaign.trackedProductIds.length > 0 && (
                                                            <div className="flex flex-wrap gap-2 mb-1">
                                                                {newCampaign.trackedProductIds.map((id) => {
                                                                    const meta = selectedProductMeta[id];
                                                                    return (
                                                                        <Badge key={id} variant="secondary" className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border border-border/50 shadow-sm">
                                                                            <span className="truncate max-w-[200px]" title={meta ? `${meta.name}${meta.sku ? ` (${meta.sku})` : ''}` : id}>
                                                                                {meta ? `${meta.name}${meta.sku ? ` (${meta.sku})` : ''}` : id}
                                                                            </span>
                                                                            <button 
                                                                               type="button" 
                                                                               onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleTrackedProduct({ id, name: meta?.name || id, sku: meta?.sku }, false); }}
                                                                               className="text-muted-foreground hover:text-foreground shrink-0 rounded-full bg-muted-foreground/10 p-[1px] hover:bg-destructive/20 hover:text-destructive transition-colors ml-1"
                                                                            >
                                                                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                                                            </button>
                                                                        </Badge>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}

                                                        {/* Search Input */}
                                                        <div className="relative">
                                                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                                            <Input
                                                                value={productSearch}
                                                                onChange={(e) => setProductSearch(e.target.value)}
                                                                placeholder="Search product by name or SKU..."
                                                                className="pl-9 h-9 text-sm"
                                                            />
                                                        </div>
                                                        
                                                        <div className="max-h-52 overflow-auto rounded-md border shadow-inner bg-muted/10 p-1.5">
                                                            {isLoadingProducts && (
                                                                <div className="py-6 text-center text-sm text-muted-foreground flex flex-col items-center">
                                                                   <RefreshCcw className="h-5 w-5 animate-spin mb-2 opacity-50 text-primary"/>
                                                                   Loading products...
                                                                </div>
                                                            )}
                                                            {!isLoadingProducts && productOptions.length === 0 && (
                                                                <p className="py-6 text-center text-xs text-muted-foreground">No products found matching your search.</p>
                                                            )}
                                                            <div className="space-y-1">
                                                                {productOptions.map((product) => {
                                                                    const checked = newCampaign.trackedProductIds.includes(product.id);
                                                                    return (
                                                                        <label key={product.id} className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors ${checked ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted/50 border border-transparent'}`}>
                                                                            <Checkbox
                                                                                checked={checked}
                                                                                onCheckedChange={(v) => toggleTrackedProduct(product, !!v)}
                                                                            />
                                                                            {product.image && (
                                                                                <div className="w-8 h-8 rounded shrink-0 bg-muted overflow-hidden flex items-center justify-center border border-border/50">
                                                                                    <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                                                                                </div>
                                                                            )}
                                                                            <div className="flex-1 min-w-0">
                                                                                <p className="text-sm font-medium leading-none mb-1.5 truncate" title={product.name}>{product.name}</p>
                                                                                {product.sku && <p className="text-[10px] text-muted-foreground truncate uppercase tracking-wider font-mono bg-muted/50 inline-block px-1 rounded">{product.sku}</p>}
                                                                            </div>
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <DialogFooter className="p-6 pt-4 border-t shrink-0">
                                                <Button onClick={handleCreate} disabled={!newCampaign.name.trim() || newCampaign.trackedProductIds.length === 0 || !newCampaign.targetCpr || !newCampaign.maxCpr}>
                                                    Create Campaign
                                                </Button>
                                            </DialogFooter>
                                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Spend</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{currencyPrefix} {overview?.totalSpend.toLocaleString() ?? '0'}</div>
                        <p className="text-xs text-muted-foreground">All time or filtered range</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Attributed Orders</CardTitle>
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{overview?.attributedOrders ?? 0}</div>
                        <p className="text-xs text-muted-foreground">Orders linked to campaigns</p>
                    </CardContent>
                </Card>
                
                {isMarketer ? (
                    <>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Actual CPR</CardTitle>
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{currencyPrefix} {Math.round(overview?.attributedOrders ? overview.totalSpend / overview.attributedOrders : 0)}</div>
                                <p className="text-xs text-muted-foreground">overall cost per result</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Profit Score</CardTitle>
                                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className={`text-2xl font-bold ${marketerProfitScore >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {marketerProfitScore > 0 ? '+' : ''}{Math.round(marketerProfitScore).toLocaleString()}
                                </div>
                                <p className="text-xs text-muted-foreground">total score from campaigns</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Performance</CardTitle>
                                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold mt-1">
                                    {getPerformanceBadge(overallStatus) || <span className="text-muted-foreground text-base">N/A</span>}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">aggregated status</p>
                            </CardContent>
                        </Card>
                    </>
                ) : (
                    <>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">CPR</CardTitle>
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{currencyPrefix} {Math.round(overview?.overallCPR ?? 0)}</div>
                                <p className="text-xs text-muted-foreground">Cost per Result</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Profit</CardTitle>
                                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-green-600">{currencyPrefix} {overview?.totalProfit.toLocaleString() ?? '0'}</div>
                                <p className="text-xs text-muted-foreground">Rev - COGS - Spend</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">ROAS</CardTitle>
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{(overview?.overallROAS ?? 0).toFixed(2)}x</div>
                                <p className="text-xs text-muted-foreground">Return on Ad Spend</p>
                            </CardContent>
                        </Card>
                    </>
                )}
            </div>

            <Tabs defaultValue="campaigns" className="flex-1 flex flex-col overflow-hidden">
                <TabsList>
                    <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
                    {!isMarketer && <TabsTrigger value="marketer">Marketer Performance</TabsTrigger>}
                </TabsList>

                <TabsContent value="campaigns" className="flex-1 overflow-auto border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Campaign</TableHead>
                                <TableHead>Campaign ID</TableHead>
                                <TableHead>Status</TableHead>
                                {!isMarketer && <TableHead>Marketer</TableHead>}
                                <TableHead className="text-right">Spend</TableHead>
                                <TableHead className="text-right">Orders</TableHead>
                                <TableHead className="text-right">CPR ({currencyPrefix})</TableHead>
                                <TableHead className="text-right">Target</TableHead>
                                <TableHead className="text-right">Max</TableHead>
                                <TableHead className="text-right">Profit Score</TableHead>
                                <TableHead>Performance</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {campaigns.map((c) => (
                                <TableRow key={c.id}>
                                    <TableCell className="font-medium">{c.name}</TableCell>
                                    <TableCell>
                                        {(c as any).shortCode ? (
                                            <span className="inline-flex items-center gap-1">
                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{(c as any).shortCode}</code>
                                                <button
                                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigator.clipboard.writeText((c as any).shortCode);
                                                        toast({ title: 'Copied!', description: `Campaign ID "${(c as any).shortCode}" copied to clipboard.` });
                                                    }}
                                                    title="Copy Campaign ID"
                                                >
                                                    <Copy className="h-3.5 w-3.5" />
                                                </button>
                                            </span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">&mdash;</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={c.status === 'Active' ? 'default' : 'secondary'}>
                                            {c.status}
                                        </Badge>
                                    </TableCell>
                                    {!isMarketer && <TableCell>{c.marketerName || '-'}</TableCell>}
                                    <TableCell className="text-right">{currencyPrefix} {c.spent.toLocaleString()}</TableCell>
                                    <TableCell className="text-right">{c.attributedOrders}</TableCell>
                                    <TableCell className="text-right">{Math.round(c.actualCpr ?? c.cpr)}</TableCell>
                                    <TableCell className="text-right">{c.targetCpr != null ? Math.round(c.targetCpr) : '-'}</TableCell>
                                    <TableCell className="text-right">{c.maxCpr != null ? Math.round(c.maxCpr) : '-'}</TableCell>
                                    <TableCell className="text-right">{c.profitScore != null ? Math.round(c.profitScore).toLocaleString() : '-'}</TableCell>
                                    <TableCell>{getPerformanceBadge(c.performanceStatus)}</TableCell>
                                    <TableCell>
                                        <Button size="sm" variant="outline" onClick={() => openDetails(c.id)}>
                                            Details
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {campaigns.length === 0 && !isLoading && (
                                <TableRow>
                                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                                        No campaigns found. Create one to get started.
                                    </TableCell>
                                </TableRow>
                            )}
                            {campaignNextCursor && (
                                <TableRow>
                                    <TableCell colSpan={12} className="text-center py-4">
                                        <Button variant="outline" size="sm" onClick={loadMoreCampaigns} disabled={isLoadingMoreCampaigns}>
                                            {isLoadingMoreCampaigns ? 'Loading...' : 'Load More'}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TabsContent>

                {!isMarketer && (
                    <TabsContent value="marketer" className="flex-1 overflow-auto border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Marketer</TableHead>
                                    <TableHead className="text-right">Spend</TableHead>
                                    <TableHead className="text-right">Orders</TableHead>
                                    <TableHead className="text-right">Revenue</TableHead>
                                    <TableHead className="text-right">CPR ({currencyPrefix})</TableHead>
                                    <TableHead className="text-right">Profit</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {overview?.perMarketer.map((m) => (
                                    <TableRow key={m.marketerId}>
                                        <TableCell className="font-medium">{m.marketerName}</TableCell>
                                        <TableCell className="text-right">{currencyPrefix} {m.spend.toLocaleString()}</TableCell>
                                        <TableCell className="text-right">{m.orders}</TableCell>
                                        <TableCell className="text-right">{currencyPrefix} {m.revenue.toLocaleString()}</TableCell>
                                        <TableCell className="text-right">{Math.round(m.cpr)}</TableCell>
                                        <TableCell className="text-right text-green-600">{currencyPrefix} {m.profit.toLocaleString()}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TabsContent>
                )}
            </Tabs>

            <CampaignDetailsSheet
                campaignId={selectedCampaignId}
                open={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
                isMarketer={isMarketer}
            />
        </div>
    );
}
