'use client';

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
    DollarSign, ShoppingCart, TrendingUp, BarChart3, RefreshCcw,
    Truck, ShieldCheck
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { getMarketingOverview, getCampaigns } from "@/services/marketing";
import { getBusinesses } from "@/services/partners";
import { getCurrentStaff, getStaff } from "@/services/staff";
import { MarketingOverview, MarketingCampaign, Business, StaffMemberUI } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

import { CampaignDetailsSheet } from "../campaign-details";

const currencyPrefix = 'Tk';

export default function MarketingAdminPage() {
    const [overview, setOverview] = useState<MarketingOverview | null>(null);
    const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [businesses, setBusinesses] = useState<Business[]>([]);

    const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const { toast } = useToast();
    const router = useRouter();

    const [dateRange, setDateRange] = useState<{ start: Date | undefined; end: Date | undefined }>({ start: undefined, end: undefined });
    const [selectedBusinessId, setSelectedBusinessId] = useState<string>("all");
    const [selectedMarketerId, setSelectedMarketerId] = useState<string>("all");
    const [marketers, setMarketers] = useState<StaffMemberUI[]>([]);

    // Auth check
    useEffect(() => {
        getCurrentStaff().then(res => {
            if (res.status !== 'ok' || res.staff.role !== 'Admin') {
                toast({ title: "Access Denied", description: "Only Admin can access this page.", variant: "destructive" });
                router.replace('/dashboard/marketing');
                return;
            }
            setIsAuthorized(true);
        });
    }, []);

    const loadData = async () => {
        if (!isAuthorized) return;
        setIsLoading(true);
        try {
            const effectiveBusinessId = selectedBusinessId === 'all' ? undefined : selectedBusinessId;
            const effectiveMarketerId = selectedMarketerId === 'all' ? undefined : selectedMarketerId;
            const [ovData, camData] = await Promise.all([
                getMarketingOverview({ startDate: dateRange.start, endDate: dateRange.end, businessId: effectiveBusinessId, marketerId: effectiveMarketerId, mode: 'admin' }),
                getCampaigns({ status: undefined, pageSize: 100, businessId: effectiveBusinessId, marketerId: effectiveMarketerId, adminMode: true })
            ]);
            setOverview(ovData);
            setCampaigns(camData.items);
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to load data", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!isAuthorized) return;
        loadData();
        getBusinesses().then(setBusinesses).catch(console.error);
        getStaff({ role: 'Marketer' }).then(res => setMarketers(res.items)).catch(console.error);
    }, [dateRange, selectedBusinessId, selectedMarketerId, isAuthorized]);

    if (!isAuthorized) {
        return <div className="flex items-center justify-center h-[60vh] text-muted-foreground">Checking access...</div>;
    }

    return (
        <div className="flex flex-col gap-4 p-4 lg:gap-6 lg:p-6 h-[calc(100vh-60px)] overflow-hidden">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <ShieldCheck className="h-6 w-6 text-primary" /> Marketing Admin
                    </h1>
                    <p className="text-muted-foreground">Revenue - COGS - Courier - Spend</p>
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

                    <div className="flex items-center gap-1">
                        <Input
                            type="date"
                            className="w-[130px] h-8 text-xs"
                            value={dateRange.start ? format(dateRange.start, 'yyyy-MM-dd') : ''}
                            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value ? new Date(e.target.value) : undefined }))}
                        />
                        <span className="text-muted-foreground text-xs">-</span>
                        <Input
                            type="date"
                            className="w-[130px] h-8 text-xs"
                            value={dateRange.end ? format(dateRange.end, 'yyyy-MM-dd') : ''}
                            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value ? new Date(e.target.value) : undefined }))}
                        />
                        {(dateRange.start || dateRange.end) && (
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setDateRange({ start: undefined, end: undefined })}>Clear</Button>
                        )}
                    </div>

                    <Button onClick={loadData} variant="outline" size="sm">
                        <RefreshCcw className="h-4 w-4 mr-2" /> Refresh
                    </Button>
                </div>
            </div>

            {/* Admin KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Revenue</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{currencyPrefix} {(overview?.totalRevenue ?? 0).toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">COGS</CardTitle>
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">{currencyPrefix} {(overview?.totalCOGS ?? 0).toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Courier Expense</CardTitle>
                        <Truck className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">{currencyPrefix} {(overview?.totalCourierExpense ?? 0).toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Ad Spend</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-500">{currencyPrefix} {(overview?.totalSpend ?? 0).toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Real Profit</CardTitle>
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${(overview?.adminRealProfit ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {currencyPrefix} {(overview?.adminRealProfit ?? 0).toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground">Rev - COGS - Courier - Spend</p>
                    </CardContent>
                </Card>
            </div>

            {/* Admin Campaigns Table */}
            <div className="flex-1 overflow-auto border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Campaign</TableHead>
                            <TableHead>Marketer</TableHead>
                            <TableHead className="text-right">Spend</TableHead>
                            <TableHead className="text-right">Orders</TableHead>
                            <TableHead className="text-right">Revenue</TableHead>
                            <TableHead className="text-right">COGS</TableHead>
                            <TableHead className="text-right">Courier Expense</TableHead>
                            <TableHead className="text-right">Real Profit</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {campaigns.map((c) => (
                            <TableRow key={c.id}>
                                <TableCell className="font-medium">{c.name}</TableCell>
                                <TableCell>{c.marketerName || '-'}</TableCell>
                                <TableCell className="text-right">{currencyPrefix} {c.spent.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{c.attributedOrders}</TableCell>
                                <TableCell className="text-right">{currencyPrefix} {(c.adminRevenue ?? 0).toLocaleString()}</TableCell>
                                <TableCell className="text-right">{currencyPrefix} {(c.adminCogs ?? 0).toLocaleString()}</TableCell>
                                <TableCell className="text-right">{currencyPrefix} {(c.adminCourierExpense ?? 0).toLocaleString()}</TableCell>
                                <TableCell className={`text-right ${(c.adminRealProfit ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {currencyPrefix} {(c.adminRealProfit ?? 0).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                    <Button size="sm" variant="outline" onClick={() => {
                                        setSelectedCampaignId(c.id);
                                        setIsDetailsOpen(true);
                                    }}>
                                        Details
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {campaigns.length === 0 && !isLoading && (
                            <TableRow>
                                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                                    No campaigns found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <CampaignDetailsSheet
                campaignId={selectedCampaignId}
                open={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
            />
        </div>
    );
}
