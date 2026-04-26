'use client';

import React, { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, RefreshCw, AlertTriangle, CheckCircle, Info, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import {
    listCutoffRevisions,
    getCutoffRevision,
    createCutoffRevision,
    suggestOpeningBalances,
    suggestOpeningInventory,
    overrideBalance,
    upsertOpeningWipEntry,
    deleteOpeningWipEntry,
    validateCutoffRevision,
    applyCutoffRevision,
    CutoffRevisionDTO,
    OpeningBalanceDTO,
    OpeningInventorySnapshotDTO,
    OpeningWipEntryDTO,
    ValidationReport,
    CutoffAuditLogDTO,
    OpeningInventoryLotDTO,
    updateOpeningInventoryLots,
    upsertOpeningInventorySnapshot
} from '@/services/cutoff';
import { getCurrentStaff } from '@/services/staff';

const WIP_STEPS = ['PLANNING', 'FABRIC', 'PRINTING', 'CUTTING'] as const;

export default function CutoffSettingsPage() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [revisions, setRevisions] = useState<CutoffRevisionDTO[]>([]);
    const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);

    const [revisionData, setRevisionData] = useState<CutoffRevisionDTO | null>(null);
    const [balances, setBalances] = useState<OpeningBalanceDTO[]>([]);
    const [inventory, setInventory] = useState<OpeningInventorySnapshotDTO[]>([]);
    const [wip, setWip] = useState<OpeningWipEntryDTO[]>([]);
    const [audit, setAudit] = useState<CutoffAuditLogDTO[]>([]);
    const [validation, setValidation] = useState<ValidationReport | null>(null);

    const [isSuperAdmin, setIsSuperAdmin] = useState(false);
    
    // Creation State
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newCutoffDate, setNewCutoffDate] = useState('');
    const [newNotes, setNewNotes] = useState('');

    useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        setLoading(true);
        try {
            const staffRes = await getCurrentStaff();
            if (staffRes.status === 'ok') {
                setIsSuperAdmin(staffRes.staff.role === 'SuperAdmin');
            }
            const revs = await listCutoffRevisions();
            setRevisions(revs);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const loadRevisionDetails = async (id: string) => {
        setLoading(true);
        try {
            setSelectedRevisionId(id);
            const data: any = await getCutoffRevision(id);
            setRevisionData(data);
            if (data) {
                setBalances(data.OpeningBalance || []);
                setInventory(data.OpeningInventorySnapshot || []);
                setWip(data.OpeningWipEntry || []);
                setAudit(data.AuditLog || []);
            }
            setValidation(data?.validationReport || null);
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not load revision details' });
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRevision = async () => {
        if (!newCutoffDate) return;
        setActionLoading(true);
        try {
            await createCutoffRevision(newCutoffDate, newNotes);
            toast({ title: 'Success', description: 'Revision created.' });
            setIsCreateOpen(false);
            setNewCutoffDate('');
            setNewNotes('');
            loadInitialData();
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setActionLoading(false);
        }
    };

    const handleAction = async (actionFn: () => Promise<any>, successMsg: string) => {
        setActionLoading(true);
        try {
            await actionFn();
            toast({ title: 'Success', description: successMsg });
            if (selectedRevisionId) await loadRevisionDetails(selectedRevisionId);
            setRevisions(await listCutoffRevisions());
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setActionLoading(false);
        }
    };

    const handleValidate = async () => {
        if (!selectedRevisionId) return;
        setActionLoading(true);
        try {
            const report = await validateCutoffRevision(selectedRevisionId);
            setValidation(report);
            toast({ title: report.passed ? 'Validation Passed' : 'Validation Failed', description: `Errors: ${report.errorCount}, Warnings: ${report.warningCount}` });
            await loadRevisionDetails(selectedRevisionId); // Refresh state to show VALIDATED if passed
            setRevisions(await listCutoffRevisions());
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setActionLoading(false);
        }
    };

    // Sub-components state
    const [balanceFilter, setBalanceFilter] = useState('');
    const [balanceTypeFilter, setBalanceTypeFilter] = useState('ALL');
    const [balanceNonZeroOnly, setBalanceNonZeroOnly] = useState(false);
    const [balanceOverriddenOnly, setBalanceOverriddenOnly] = useState(false);
    
    const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
    const [editBalanceAmount, setEditBalanceAmount] = useState<number>(0);
    const [editBalanceReason, setEditBalanceReason] = useState('');

    const [wipEditingId, setWipEditingId] = useState<string | null>(null);
    const [wipProductId, setWipProductId] = useState('');
    const [wipStep, setWipStep] = useState('PLANNING');
    const [wipQuantity, setWipQuantity] = useState('');
    const [wipCost, setWipCost] = useState('');
    const [wipNotes, setWipNotes] = useState('');

    const [selectedSnapshotForLots, setSelectedSnapshotForLots] = useState<OpeningInventorySnapshotDTO | null>(null);
    const [editingLots, setEditingLots] = useState<OpeningInventoryLotDTO[]>([]);

    const [invProductId, setInvProductId] = useState('');
    const [invVariantId, setInvVariantId] = useState('');
    const [invTotalQty, setInvTotalQty] = useState('');
    const [invTotalValue, setInvTotalValue] = useState('');
    const [invLotCount, setInvLotCount] = useState('1');

    const saveBalanceOverride = async (balanceId: string) => {
        if (!selectedRevisionId) return;
        setActionLoading(true);
        try {
            await overrideBalance(selectedRevisionId, balanceId, editBalanceAmount, editBalanceReason);
            toast({ title: 'Saved', description: 'Balance overridden.' });
            setEditingBalanceId(null);
            await loadRevisionDetails(selectedRevisionId);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setActionLoading(false);
        }
    };

    const addOrUpdateInventorySnapshot = async () => {
        if (!selectedRevisionId || !invProductId.trim()) return;
        const totalQuantity = Number(invTotalQty);
        const totalValue = Number(invTotalValue);
        const lotCount = Number(invLotCount);
        if (!Number.isFinite(totalQuantity) || totalQuantity <= 0 || !Number.isFinite(totalValue) || totalValue < 0 || !Number.isFinite(lotCount) || lotCount <= 0) {
            toast({
                variant: 'destructive',
                title: 'Invalid inventory snapshot',
                description: 'Provide a valid product, positive quantity, non-negative value, and at least 1 lot.',
            });
            return;
        }
        setActionLoading(true);
        try {
            await upsertOpeningInventorySnapshot(selectedRevisionId, {
                productId: invProductId.trim(),
                variantId: invVariantId || null,
                totalQuantity,
                totalValue,
                lotCount
            });
            toast({ title: 'Success', description: 'Inventory snapshot saved.' });
            setInvProductId(''); setInvVariantId(''); setInvTotalQty(''); setInvTotalValue(''); setInvLotCount('1');
            await loadRevisionDetails(selectedRevisionId);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setActionLoading(false);
        }
    };

    const addWip = async () => {
        if (!selectedRevisionId || !wipProductId.trim()) return;
        const quantity = Number(wipQuantity);
        const estimatedCost = Number(wipCost);
        if (!WIP_STEPS.includes(wipStep as typeof WIP_STEPS[number]) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(estimatedCost) || estimatedCost < 0) {
            toast({
                variant: 'destructive',
                title: 'Invalid WIP entry',
                description: 'Select a valid step, positive quantity, and non-negative estimated cost.',
            });
            return;
        }
        setActionLoading(true);
        try {
            await upsertOpeningWipEntry(selectedRevisionId, {
                id: wipEditingId || undefined,
                productId: wipProductId.trim(),
                currentStep: wipStep,
                quantity,
                estimatedCost,
                notes: wipNotes
            });
            toast({ title: 'Success', description: wipEditingId ? 'WIP entry updated.' : 'WIP entry added.' });
            setWipEditingId(null); setWipProductId(''); setWipStep('PLANNING'); setWipQuantity(''); setWipCost(''); setWipNotes('');
            await loadRevisionDetails(selectedRevisionId);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setActionLoading(false);
        }
    };

    const cancelWipEdit = () => {
        setWipEditingId(null); setWipProductId(''); setWipStep('PLANNING'); setWipQuantity(''); setWipCost(''); setWipNotes('');
    };

    const handleSuggestInventory = async () => {
        if (!selectedRevisionId) return;
        setActionLoading(true);
        try {
            const result = await suggestOpeningInventory(selectedRevisionId);
            toast({
                title: 'Inventory Suggested',
                description: result?.message || 'Opening inventory was suggested successfully.',
            });
            await loadRevisionDetails(selectedRevisionId);
            setRevisions(await listCutoffRevisions());
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setActionLoading(false);
        }
    };

    const removeWip = async (wipId: string) => {
        if (!selectedRevisionId) return;
        setActionLoading(true);
        try {
            await deleteOpeningWipEntry(selectedRevisionId, wipId);
            toast({ title: 'Success', description: 'WIP entry removed.' });
            await loadRevisionDetails(selectedRevisionId);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setActionLoading(false);
        }
    };

    const handleEqualSplitLots = () => {
        if (!selectedSnapshotForLots || editingLots.length === 0) return;
        const totalQty = selectedSnapshotForLots.totalQuantity;
        const lotCount = editingLots.length;
        const baseQty = Math.floor(totalQty / lotCount);
        let remainder = totalQty % lotCount;

        const updated = editingLots.map(lot => {
            let qty = baseQty;
            if (remainder > 0) {
                qty++;
                remainder--;
            }
            return { ...lot, quantity: qty };
        });
        setEditingLots(updated);
    };

    const saveLots = async () => {
        if (!selectedRevisionId || !selectedSnapshotForLots) return;
        const totalLotQty = editingLots.reduce((sum, l) => sum + l.quantity, 0);
        if (totalLotQty !== selectedSnapshotForLots.totalQuantity) {
            toast({ variant: 'destructive', title: 'Quantity Mismatch', description: `Total lot quantity (${totalLotQty}) must equal snapshot quantity (${selectedSnapshotForLots.totalQuantity})`});
            return;
        }

        setActionLoading(true);
        try {
            await updateOpeningInventoryLots(selectedRevisionId, selectedSnapshotForLots.id, editingLots);
            toast({ title: 'Success', description: 'Lots updated.' });
            setSelectedSnapshotForLots(null);
            await loadRevisionDetails(selectedRevisionId);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setActionLoading(false);
        }
    };

    if (loading && !revisions.length) {
        return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Cut-Off Accounting Boundary</h2>
                <p className="text-muted-foreground">Start official accounting from a chosen date while preserving historical records.</p>
            </div>

            {!isSuperAdmin && (
                <div className="bg-blue-50 text-blue-800 p-4 rounded-lg flex items-center gap-3 text-sm">
                    <Info className="h-5 w-5" />
                    <span>You are viewing in read-only mode. Only Super Admins can manage cut-offs.</span>
                </div>
            )}

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Revisions</CardTitle>
                        <CardDescription>Select a revision to inspect or apply.</CardDescription>
                    </div>
                    {isSuperAdmin && (
                        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                            <DialogTrigger asChild>
                                <Button><Plus className="h-4 w-4 mr-2"/> Create Revision</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create Cut-Off Revision</DialogTitle>
                                    <DialogDescription>Define a boundary date for this cutoff.</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Cut-Off Date</label>
                                        <Input type="date" value={newCutoffDate} onChange={e => setNewCutoffDate(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Notes (Optional)</label>
                                        <Textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Reason for cutoff..." />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button disabled={actionLoading} onClick={handleCreateRevision}>
                                        {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}
                                        Create
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Rev #</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Created By</TableHead>
                                <TableHead>Created At</TableHead>
                                <TableHead>Applied</TableHead>
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {revisions.map(rev => (
                                <TableRow key={rev.id} className={selectedRevisionId === rev.id ? 'bg-muted/50' : ''}>
                                    <TableCell>Rev {rev.revisionNumber}</TableCell>
                                    <TableCell>{new Date(rev.cutoffDate).toLocaleDateString()}</TableCell>
                                    <TableCell>
                                        <Badge variant={rev.status === 'APPLIED' ? 'default' : rev.status === 'VALIDATED' ? 'secondary' : 'outline'}>
                                            {rev.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{rev.createdByName || '-'}</TableCell>
                                    <TableCell>{new Date(rev.createdAt).toLocaleString()}</TableCell>
                                    <TableCell>
                                        {rev.appliedAt
                                            ? `${rev.appliedByName || 'System'} · ${new Date(rev.appliedAt).toLocaleString()}`
                                            : '-'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="sm" onClick={() => loadRevisionDetails(rev.id)}>Inspect</Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {revisions.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No revisions found.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {selectedRevisionId && revisionData && (
                <div className="space-y-6">
                    <Card className="border-primary/20">
                        <CardHeader>
                            <CardTitle>Revision {revisionData.revisionNumber} Overview</CardTitle>
                            <CardDescription>Cutoff: {new Date(revisionData.cutoffDate).toLocaleDateString()} | Status: {revisionData.status}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-2">
                                {isSuperAdmin && revisionData.status !== 'APPLIED' && revisionData.status !== 'SUPERSEDED' && (
                                    <>
                                        <Button variant="outline" disabled={actionLoading} onClick={() => handleAction(() => suggestOpeningBalances(selectedRevisionId), 'Balances Suggested')}>
                                            Suggest Balances
                                        </Button>
                                        <Button variant="outline" disabled={actionLoading} onClick={handleSuggestInventory}>
                                            Suggest Inventory
                                        </Button>
                                        <Button variant="outline" disabled={actionLoading} onClick={handleValidate}>
                                            Validate
                                        </Button>
                                        {revisionData.status === 'VALIDATED' && (
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <Button disabled={actionLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white">Apply Cutoff</Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader>
                                                        <DialogTitle>Confirm Apply</DialogTitle>
                                                        <DialogDescription>
                                                            Are you sure you want to apply this cutoff? Pre-cutoff records will become historical reference. Live accounting will start from these balances. This action is irreversible.
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <DialogFooter>
                                                        <Button disabled={actionLoading} onClick={() => handleAction(() => applyCutoffRevision(selectedRevisionId), 'Cutoff Applied!')}>
                                                            Confirm Apply
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </>
                                )}
                                <Button variant="ghost" onClick={() => loadRevisionDetails(selectedRevisionId)}>
                                    <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                                </Button>
                            </div>

                            {validation && (
                                <div className={`mt-4 p-4 rounded-lg border ${validation.passed ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                                    <div className="flex items-center gap-2 mb-2 font-semibold">
                                        {validation.passed ? <CheckCircle className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
                                        <span className={validation.passed ? 'text-emerald-800' : 'text-red-800'}>
                                            Validation {validation.passed ? 'Passed' : 'Failed'}
                                        </span>
                                    </div>
                                    <div className="text-sm space-y-1 mb-3">
                                        <div>Errors: {validation.errorCount}</div>
                                        <div>Warnings: {validation.warningCount}</div>
                                    </div>
                                    <div className="max-h-40 overflow-y-auto space-y-1 text-xs">
                                        {validation.checks.map(c => (
                                            <div key={c.id} className="flex gap-2">
                                                <span className={c.passed ? 'text-emerald-600' : (c.severity === 'ERROR' ? 'text-red-600' : 'text-amber-600')}>
                                                    [{c.passed ? 'OK' : c.severity}]
                                                </span>
                                                <span>{c.label} {c.detail ? `- ${c.detail}` : ''}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Tabs defaultValue="balances">
                        <TabsList className="w-full justify-start overflow-x-auto">
                            <TabsTrigger value="balances">Balances ({balances.length})</TabsTrigger>
                            <TabsTrigger value="inventory">Inventory ({inventory.length})</TabsTrigger>
                            <TabsTrigger value="wip">WIP ({wip.length})</TabsTrigger>
                            <TabsTrigger value="audit">Audit Log ({audit.length})</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="balances" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                        <CardTitle>Opening Balances</CardTitle>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Input placeholder="Search name or type..." value={balanceFilter} onChange={e => setBalanceFilter(e.target.value)} className="w-48 h-8" />
                                            <select 
                                                className="h-8 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                value={balanceTypeFilter} 
                                                onChange={e => setBalanceTypeFilter(e.target.value)}
                                            >
                                                <option value="ALL">All Types</option>
                                                {Array.from(new Set(balances.map(b => b.entityType))).sort().map(type => (
                                                    <option key={type} value={type}>{type}</option>
                                                ))}
                                            </select>
                                            <label className="flex items-center gap-1 text-sm">
                                                <input type="checkbox" checked={balanceNonZeroOnly} onChange={e => setBalanceNonZeroOnly(e.target.checked)} />
                                                Non-Zero Only
                                            </label>
                                            <label className="flex items-center gap-1 text-sm">
                                                <input type="checkbox" checked={balanceOverriddenOnly} onChange={e => setBalanceOverriddenOnly(e.target.checked)} />
                                                Overridden
                                            </label>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="max-h-[500px] overflow-auto rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Type</TableHead>
                                                    <TableHead>Name</TableHead>
                                                    <TableHead className="text-right">Suggested</TableHead>
                                                    <TableHead className="text-right">Final</TableHead>
                                                    <TableHead></TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {balances.filter(b => {
                                                    const matchText = b.entityName.toLowerCase().includes(balanceFilter.toLowerCase()) || b.entityType.toLowerCase().includes(balanceFilter.toLowerCase());
                                                    const matchType = balanceTypeFilter === 'ALL' || b.entityType === balanceTypeFilter;
                                                    const matchNonZero = !balanceNonZeroOnly || b.finalAmount !== 0;
                                                    const matchOverridden = !balanceOverriddenOnly || b.isOverridden;
                                                    return matchText && matchType && matchNonZero && matchOverridden;
                                                }).map(b => (
                                                    <TableRow key={b.id}>
                                                        <TableCell><Badge variant="outline">{b.entityType}</Badge></TableCell>
                                                        <TableCell>{b.entityName}</TableCell>
                                                        <TableCell className="text-right">{b.suggestedAmount}</TableCell>
                                                        <TableCell className="text-right font-medium">
                                                            {editingBalanceId === b.id ? (
                                                                <Input type="number" className="h-7 w-24 ml-auto text-right" value={editBalanceAmount} onChange={e => setEditBalanceAmount(Number(e.target.value))} />
                                                            ) : (
                                                                <span className={b.isOverridden ? 'text-amber-600 font-bold' : ''}>{b.finalAmount}</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {isSuperAdmin && revisionData.status !== 'APPLIED' && (
                                                                editingBalanceId === b.id ? (
                                                                    <div className="flex items-center gap-2 justify-end">
                                                                        <Input className="h-7 w-32 text-xs" placeholder="Reason" value={editBalanceReason} onChange={e => setEditBalanceReason(e.target.value)} />
                                                                        <Button size="sm" onClick={() => saveBalanceOverride(b.id)} disabled={actionLoading}>Save</Button>
                                                                        <Button size="sm" variant="ghost" onClick={() => setEditingBalanceId(null)}>Cancel</Button>
                                                                    </div>
                                                                ) : (
                                                                    <Button size="sm" variant="ghost" onClick={() => { setEditingBalanceId(b.id); setEditBalanceAmount(b.finalAmount); setEditBalanceReason(b.overrideReason || ''); }}>Edit</Button>
                                                                )
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="inventory" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Opening Inventory</CardTitle>
                                    <CardDescription>Product snapshots and lots. Suggested inventory is treated as a current-state estimate, not a historical reconstruction.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {isSuperAdmin && revisionData.status !== 'APPLIED' && (
                                        <div className="flex flex-wrap gap-2 mb-4 bg-muted/30 p-2 rounded-lg border">
                                            <Input placeholder="Product ID" value={invProductId} onChange={e => setInvProductId(e.target.value)} className="h-8 w-40" />
                                            <Input placeholder="Variant ID (opt)" value={invVariantId} onChange={e => setInvVariantId(e.target.value)} className="h-8 w-32" />
                                            <Input type="number" placeholder="Total Qty" value={invTotalQty} onChange={e => setInvTotalQty(e.target.value)} className="h-8 w-24" />
                                            <Input type="number" placeholder="Total Value" value={invTotalValue} onChange={e => setInvTotalValue(e.target.value)} className="h-8 w-32" />
                                            <Input type="number" placeholder="Lots" value={invLotCount} onChange={e => setInvLotCount(e.target.value)} className="h-8 w-20" />
                                            <Button size="sm" onClick={addOrUpdateInventorySnapshot} disabled={actionLoading}>Save Snapshot</Button>
                                        </div>
                                    )}
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Product ID</TableHead>
                                                <TableHead className="text-right">Total Qty</TableHead>
                                                <TableHead className="text-right">Total Value</TableHead>
                                                <TableHead className="text-right">Lots</TableHead>
                                                <TableHead></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {inventory.map(inv => (
                                                <TableRow key={inv.id}>
                                                    <TableCell className="font-mono text-xs">{inv.productId}</TableCell>
                                                    <TableCell className="text-right font-medium">{inv.totalQuantity}</TableCell>
                                                    <TableCell className="text-right">{inv.totalValue}</TableCell>
                                                    <TableCell className="text-right">{inv.lotCount}</TableCell>
                                                    <TableCell className="text-right">
                                                        {isSuperAdmin && revisionData.status !== 'APPLIED' && (
                                                            <Button variant="ghost" size="sm" onClick={() => {
                                                                setInvProductId(inv.productId);
                                                                setInvVariantId(inv.variantId || '');
                                                                setInvTotalQty(String(inv.totalQuantity));
                                                                setInvTotalValue(String(inv.totalValue));
                                                                setInvLotCount(String(inv.lotCount));
                                                            }}>Edit</Button>
                                                        )}
                                                        <Button variant="ghost" size="sm" onClick={() => {
                                                            setSelectedSnapshotForLots(inv);
                                                            setEditingLots(inv.Lots || []);
                                                        }}>View / Edit Lots</Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="wip" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Opening WIP</CardTitle>
                                    <CardDescription>Work in progress items.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {isSuperAdmin && revisionData.status !== 'APPLIED' && (
                                        <div className="flex gap-2 mb-4 bg-muted/30 p-2 rounded-lg border">
                                            <Input placeholder="Product ID" value={wipProductId} onChange={e => setWipProductId(e.target.value)} className="h-8" />
                                            <select
                                                className="h-8 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                value={wipStep}
                                                onChange={e => setWipStep(e.target.value)}
                                            >
                                                {WIP_STEPS.map(step => (
                                                    <option key={step} value={step}>{step}</option>
                                                ))}
                                            </select>
                                            <Input type="number" placeholder="Qty" value={wipQuantity} onChange={e => setWipQuantity(e.target.value)} className="h-8 w-24" />
                                            <Input type="number" placeholder="Cost" value={wipCost} onChange={e => setWipCost(e.target.value)} className="h-8 w-32" />
                                            <Input placeholder="Notes" value={wipNotes} onChange={e => setWipNotes(e.target.value)} className="h-8" />
                                            <Button size="sm" onClick={addWip} disabled={actionLoading}>{wipEditingId ? 'Save' : 'Add'}</Button>
                                            {wipEditingId && <Button size="sm" variant="ghost" onClick={cancelWipEdit}>Cancel</Button>}
                                        </div>
                                    )}
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Product ID</TableHead>
                                                <TableHead>Step</TableHead>
                                                <TableHead className="text-right">Qty</TableHead>
                                                <TableHead className="text-right">Estimated Cost</TableHead>
                                                <TableHead>Notes</TableHead>
                                                <TableHead></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {wip.map(w => (
                                                <TableRow key={w.id}>
                                                    <TableCell className="font-mono text-xs">{w.productId}</TableCell>
                                                    <TableCell><Badge variant="outline">{w.currentStep}</Badge></TableCell>
                                                    <TableCell className="text-right font-medium">{w.quantity}</TableCell>
                                                    <TableCell className="text-right">{w.estimatedCost}</TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{w.notes}</TableCell>
                                                    <TableCell className="text-right">
                                                        {isSuperAdmin && revisionData.status !== 'APPLIED' && (
                                                            <>
                                                                <Button variant="ghost" size="sm" onClick={() => {
                                                                    setWipEditingId(w.id);
                                                                    setWipProductId(w.productId);
                                                                    setWipStep(w.currentStep);
                                                                    setWipQuantity(String(w.quantity));
                                                                    setWipCost(String(w.estimatedCost));
                                                                    setWipNotes(w.notes || '');
                                                                }}>Edit</Button>
                                                                <Button variant="ghost" size="sm" className="text-red-600" onClick={() => removeWip(w.id)} disabled={actionLoading}>Delete</Button>
                                                            </>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {wip.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-4">No WIP entries.</TableCell></TableRow>}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="audit" className="mt-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Audit Log</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        {audit.map(log => (
                                            <div key={log.id} className="flex gap-4 border-b pb-3 text-sm">
                                                <div className="w-32 text-muted-foreground whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</div>
                                                <div className="font-medium w-32">{log.action}</div>
                                                <div className="text-muted-foreground w-32">{log.performedByName || 'System'}</div>
                                                <div className="flex-1 text-xs font-mono break-all">{log.detail ? JSON.stringify(log.detail) : ''}</div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            )}

            {/* Edit Lots Modal */}
            {selectedSnapshotForLots && (
                <Dialog open={!!selectedSnapshotForLots} onOpenChange={(open) => !open && setSelectedSnapshotForLots(null)}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Edit Lots: {selectedSnapshotForLots.productId}</DialogTitle>
                            <DialogDescription>
                                Total Snapshot Quantity: <b>{selectedSnapshotForLots.totalQuantity}</b>
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex justify-end gap-2 mb-2">
                            {isSuperAdmin && revisionData?.status !== 'APPLIED' && (
                                <Button variant="outline" size="sm" onClick={handleEqualSplitLots}>Equal Split</Button>
                            )}
                        </div>
                        <div className="max-h-96 overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Lot Number</TableHead>
                                        <TableHead className="text-right">Quantity</TableHead>
                                        <TableHead className="text-right">Unit Cost</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {editingLots.map((lot, idx) => (
                                        <TableRow key={lot.id || idx}>
                                            <TableCell className="font-mono text-xs">{lot.lotNumber}</TableCell>
                                            <TableCell className="text-right">
                                                <Input 
                                                    type="number" 
                                                    className="h-7 w-20 ml-auto text-right" 
                                                    value={lot.quantity} 
                                                    disabled={!isSuperAdmin || revisionData?.status === 'APPLIED'}
                                                    onChange={e => {
                                                        const copy = [...editingLots];
                                                        copy[idx].quantity = Number(e.target.value);
                                                        setEditingLots(copy);
                                                    }} 
                                                />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Input 
                                                    type="number" 
                                                    className="h-7 w-24 ml-auto text-right" 
                                                    value={lot.unitCost} 
                                                    disabled={!isSuperAdmin || revisionData?.status === 'APPLIED'}
                                                    onChange={e => {
                                                        const copy = [...editingLots];
                                                        copy[idx].unitCost = Number(e.target.value);
                                                        
                                                        // Suggest copy if this is the first one being edited
                                                        if (idx === 0 && copy.slice(1).every(l => !l.unitCost)) {
                                                            copy.forEach(l => l.unitCost = Number(e.target.value));
                                                        }
                                                        
                                                        setEditingLots(copy);
                                                    }} 
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <DialogFooter>
                            <div className="flex justify-between w-full">
                                <div className="text-sm font-medium">
                                    Current Total: <span className={editingLots.reduce((s,l)=>s+l.quantity,0) !== selectedSnapshotForLots.totalQuantity ? 'text-red-600' : 'text-emerald-600'}>
                                        {editingLots.reduce((s,l)=>s+l.quantity,0)}
                                    </span>
                                </div>
                                <div>
                                    <Button variant="ghost" onClick={() => setSelectedSnapshotForLots(null)}>Cancel</Button>
                                    {isSuperAdmin && revisionData?.status !== 'APPLIED' && (
                                        <Button onClick={saveLots} disabled={actionLoading || editingLots.reduce((s,l)=>s+l.quantity,0) !== selectedSnapshotForLots.totalQuantity}>
                                            Save
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
