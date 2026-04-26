'use client';

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { X, Loader2 } from "lucide-react";

import {
    getCampaignDetails, addCampaignSpend,
    addCampaignAttributions, removeCampaignAttribution
} from "@/services/marketing";
import { MarketingCampaign, MarketingSpend } from "@/types";

const currencyPrefix = 'Tk';

interface CampaignDetailsProps {
    campaignId: string | null;
    open: boolean;
    onClose: () => void;
    isMarketer?: boolean;
}

export function CampaignDetailsSheet({ campaignId, open, onClose, isMarketer }: CampaignDetailsProps) {
    const [campaign, setCampaign] = useState<MarketingCampaign & { spends: MarketingSpend[], attributions: any[] } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    // Spend Form
    const [spendForm, setSpendForm] = useState({ amount: "", date: format(new Date(), 'yyyy-MM-dd'), notes: "" });

    // Attribution Form
    const [orderSearch, setOrderSearch] = useState("");

    const loadDetails = async () => {
        if (!campaignId) return;
        setIsLoading(true);
        try {
            const data = await getCampaignDetails(campaignId);
            setCampaign(data);
        } catch (e) {
            toast({ title: "Error", description: "Failed to load details", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (open && campaignId) {
            loadDetails();
        } else {
            setCampaign(null);
        }
    }, [open, campaignId]);

    const handleAddSpend = async () => {
        if (!campaignId) return;
        try {
            await addCampaignSpend(campaignId, {
                amount: parseFloat(spendForm.amount),
                date: new Date(spendForm.date),
                notes: spendForm.notes
            });
            toast({ title: "Success", description: "Spend added" });
            setSpendForm({ amount: "", date: format(new Date(), 'yyyy-MM-dd'), notes: "" });
            loadDetails();
        } catch (e) {
            toast({ title: "Error", description: "Failed to add spend", variant: "destructive" });
        }
    };

    const handleAssignOrder = async (orderNum: string) => {
        if (!campaignId || !orderNum.trim()) return;
        try {
            await addCampaignAttributions(campaignId, undefined, { orderNumber: orderNum.trim() });
            toast({ title: "Success", description: "Order attributed" });
            loadDetails();
            setOrderSearch(""); // Clear search
        } catch (e: any) {
            toast({ title: "Error", description: e?.message || "Failed to attribute order", variant: "destructive" });
        }
    };

    const handleRemoveAttribution = async (orderId: string) => {
        if (!campaignId) return;
        try {
            await removeCampaignAttribution(campaignId, orderId);
            toast({ title: "Success", description: "Attribution removed" });
            loadDetails();
        } catch (e) {
            toast({ title: "Error", description: "Failed to remove attribution", variant: "destructive" });
        }
    }

    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>Campaign Details</SheetTitle>
                    <SheetDescription>
                        Manage spend and orders for {campaign?.name || 'Loading...'}
                    </SheetDescription>
                </SheetHeader>

                {isLoading && <div className="py-8 flex justify-center"><Loader2 className="animate-spin" /></div>}

                {!isLoading && campaign && (
                    <div className="py-6 space-y-6">
                        {/* Stats Summary */}
                        <div className="grid grid-cols-3 gap-2 text-center bg-muted p-2 rounded-md">
                            <div>
                                <div className="text-xs text-muted-foreground">Spend</div>
                                <div className="font-bold">{currencyPrefix} {campaign.spent.toLocaleString()}</div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Orders</div>
                                <div className="font-bold">{campaign.attributedOrders}</div>
                            </div>
                            <div>
                                <div className="text-xs text-muted-foreground">Revenue</div>
                                <div className="font-bold">{currencyPrefix} {campaign.attributedRevenue.toLocaleString()}</div>
                            </div>
                            {/* Row 2 */}
                            {isMarketer ? (
                                <>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Target / Max CPR</div>
                                        <div className="font-bold">{(campaign as any).targetCpr || '-'} / {(campaign as any).maxCpr || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Actual CPR</div>
                                        <div className="font-bold">{currencyPrefix} {Math.round((campaign as any).actualCpr || campaign.cpr || 0)}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Performance</div>
                                        <div className={`font-bold ${((campaign as any).profitScore || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {(campaign as any).performanceStatus || 'N/A'} {((campaign as any).profitScore || 0) > 0 ? '+' : ''}{Math.round((campaign as any).profitScore || 0).toLocaleString()}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <div className="text-xs text-muted-foreground">CPR</div>
                                        <div className="font-bold">{currencyPrefix} {Math.round(campaign.cpr)}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">ROAS</div>
                                        <div className="font-bold text-green-600">{campaign.roas.toFixed(2)}x</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Profit</div>
                                        <div className={`font-bold ${campaign.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{currencyPrefix} {campaign.profit.toLocaleString()}</div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="rounded-md border p-2">
                            <p className="text-xs font-medium text-muted-foreground mb-1">Tracked Products</p>
                            {Array.isArray(campaign.trackedProducts) && campaign.trackedProducts.length > 0 ? (
                                <div className="space-y-1">
                                    {campaign.trackedProducts.map((p: any) => (
                                        <div key={p.id} className="text-xs">
                                            <span className="font-medium">{p.name}</span>
                                            {p.sku ? <span className="text-muted-foreground ml-1">({p.sku})</span> : null}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">No tracked products set.</p>
                            )}
                        </div>

                        <Tabs defaultValue="spend" className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="spend">Spend Log</TabsTrigger>
                                <TabsTrigger value="orders">Orders</TabsTrigger>
                            </TabsList>

                            <TabsContent value="spend" className="space-y-4">
                                <div className="flex gap-2 items-end border p-2 rounded-md bg-accent/10">
                                    <div className="grid gap-1 flex-1">
                                        <Label className="text-xs">Amount</Label>
                                        <Input
                                            type="number"
                                            placeholder="Amount"
                                            value={spendForm.amount}
                                            onChange={(e) => setSpendForm({ ...spendForm, amount: e.target.value })}
                                            className="h-8"
                                        />
                                    </div>
                                    <div className="grid gap-1 flex-1">
                                        <Label className="text-xs">Date</Label>
                                        <Input
                                            type="date"
                                            value={spendForm.date}
                                            onChange={(e) => setSpendForm({ ...spendForm, date: e.target.value })}
                                            className="h-8"
                                        />
                                    </div>
                                    <Button size="sm" onClick={handleAddSpend} disabled={!spendForm.amount}>Add</Button>
                                </div>

                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Amount</TableHead>
                                            <TableHead>By</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {campaign.spends.map((s) => (
                                            <TableRow key={s.id}>
                                                <TableCell>{format(new Date(s.date), 'MMM d')}</TableCell>
                                                <TableCell>{currencyPrefix} {s.amount}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{s.createdByName}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TabsContent>

                            <TabsContent value="orders" className="space-y-4">
                                <div className="flex gap-2 items-center">
                                    <Input
                                        placeholder="Order number (e.g. 190326-06)"
                                        value={orderSearch}
                                        onChange={(e) => setOrderSearch(e.target.value)}
                                        className="h-8"
                                    />
                                    <Button size="sm" onClick={() => handleAssignOrder(orderSearch)} disabled={!orderSearch}>
                                        Assign
                                    </Button>
                                </div>

                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Order #</TableHead>
                                            <TableHead>Total</TableHead>
                                            <TableHead className="w-[30px]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {campaign.attributions.map((a) => (
                                            <TableRow key={a.id}>
                                                <TableCell className="font-medium">{a.orderNumber}</TableCell>
                                                <TableCell>{currencyPrefix} {a.orderTotal?.toLocaleString()}</TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6 text-destructive"
                                                        onClick={() => handleRemoveAttribution(a.orderId)}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TabsContent>
                        </Tabs>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
