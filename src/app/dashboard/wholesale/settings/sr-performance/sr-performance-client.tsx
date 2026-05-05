"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  adminCreateTarget,
  adminUpdateTarget,
  adminCreatePolicy,
  adminUpdatePolicy,
  adminRecalculateTarget,
  adminExpireTargets,
  adminListTargets,
  adminListPolicies,
  adminGetSrLeaderboard,
  adminListCommissions,
} from "@/services/sr-performance";
import { Plus, Pencil, Target, Trophy, DollarSign, RefreshCw, Award, TrendingUp, Users } from "lucide-react";

interface Props {
  initialTargets: any[];
  initialPolicies: any[];
  initialLeaderboard: any[];
}

export default function SrPerformanceClient({ initialTargets, initialPolicies, initialLeaderboard }: Props) {
  const [targets, setTargets] = useState(initialTargets);
  const [policies, setPolicies] = useState(initialPolicies);
  const [leaderboard, setLeaderboard] = useState(initialLeaderboard);
  const [isTargetDialogOpen, setIsTargetDialogOpen] = useState(false);
  const [isPolicyDialogOpen, setIsPolicyDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<any>(null);
  const [editingPolicy, setEditingPolicy] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // ── Target Form State ──
  const [targetForm, setTargetForm] = useState({
    staffId: "", title: "", type: "SalesAmount" as string,
    targetValue: "", startDate: "", endDate: "",
    incentivePolicyId: "", notes: "",
  });

  // ── Policy Form State ──
  const [policyForm, setPolicyForm] = useState({
    name: "", description: "", incentiveType: "CommissionRate" as string, value: "",
  });

  async function refreshData() {
    try {
      const [t, p, l] = await Promise.all([adminListTargets(), adminListPolicies(), adminGetSrLeaderboard()]);
      setTargets(t); setPolicies(p); setLeaderboard(l);
    } catch {}
  }

  // ── Target CRUD ──
  function openCreateTarget() {
    setEditingTarget(null);
    setTargetForm({ staffId: "", title: "", type: "SalesAmount", targetValue: "", startDate: "", endDate: "", incentivePolicyId: "", notes: "" });
    setIsTargetDialogOpen(true);
  }

  function openEditTarget(t: any) {
    setEditingTarget(t);
    setTargetForm({
      staffId: t.staffId, title: t.title, type: t.type,
      targetValue: String(t.targetValue),
      startDate: new Date(t.startDate).toISOString().split("T")[0],
      endDate: new Date(t.endDate).toISOString().split("T")[0],
      incentivePolicyId: t.incentivePolicyId || "",
      notes: t.notes || "",
    });
    setIsTargetDialogOpen(true);
  }

  async function handleSaveTarget() {
    setLoading(true);
    try {
      if (!targetForm.staffId || !targetForm.title || !targetForm.targetValue || !targetForm.startDate || !targetForm.endDate) {
        toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
        return;
      }
      if (editingTarget) {
        await adminUpdateTarget(editingTarget.id, {
          title: targetForm.title,
          targetValue: parseFloat(targetForm.targetValue),
          startDate: targetForm.startDate,
          endDate: targetForm.endDate,
          incentivePolicyId: targetForm.incentivePolicyId || null,
          notes: targetForm.notes,
        });
        toast({ title: "Target updated" });
      } else {
        await adminCreateTarget({
          staffId: targetForm.staffId,
          title: targetForm.title,
          type: targetForm.type as any,
          targetValue: parseFloat(targetForm.targetValue),
          startDate: targetForm.startDate,
          endDate: targetForm.endDate,
          incentivePolicyId: targetForm.incentivePolicyId || undefined,
          notes: targetForm.notes,
        });
        toast({ title: "Target created" });
      }
      setIsTargetDialogOpen(false);
      await refreshData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelTarget(id: string) {
    setLoading(true);
    try {
      await adminUpdateTarget(id, { status: "Cancelled" });
      toast({ title: "Target cancelled" });
      await refreshData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleRecalculate(id: string) {
    setLoading(true);
    try {
      await adminRecalculateTarget(id);
      toast({ title: "Target recalculated" });
      await refreshData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleExpireAll() {
    setLoading(true);
    try {
      const result = await adminExpireTargets();
      toast({ title: `${result.expired} target(s) expired` });
      await refreshData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // ── Policy CRUD ──
  function openCreatePolicy() {
    setEditingPolicy(null);
    setPolicyForm({ name: "", description: "", incentiveType: "CommissionRate", value: "" });
    setIsPolicyDialogOpen(true);
  }

  function openEditPolicy(p: any) {
    setEditingPolicy(p);
    setPolicyForm({ name: p.name, description: p.description || "", incentiveType: p.incentiveType, value: String(p.value) });
    setIsPolicyDialogOpen(true);
  }

  async function handleSavePolicy() {
    setLoading(true);
    try {
      if (!policyForm.name || !policyForm.value) {
        toast({ title: "Error", description: "Name and value required", variant: "destructive" });
        return;
      }
      if (editingPolicy) {
        await adminUpdatePolicy(editingPolicy.id, {
          name: policyForm.name, description: policyForm.description,
          incentiveType: policyForm.incentiveType as any,
          value: parseFloat(policyForm.value),
        });
        toast({ title: "Policy updated" });
      } else {
        await adminCreatePolicy({
          name: policyForm.name, description: policyForm.description,
          incentiveType: policyForm.incentiveType as any,
          value: parseFloat(policyForm.value),
        });
        toast({ title: "Policy created" });
      }
      setIsPolicyDialogOpen(false);
      await refreshData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleTogglePolicy(id: string, isActive: boolean) {
    try {
      await adminUpdatePolicy(id, { isActive: !isActive });
      await refreshData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case "Active": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
      case "Completed": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "Expired": return "bg-muted text-muted-foreground";
      case "Cancelled": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      default: return "bg-muted";
    }
  };

  // Unique SRs from targets for the dropdown
  const uniqueSRs = Array.from(new Map(
    [...targets.map((t: any) => t.Staff), ...leaderboard].filter(Boolean).map((s: any) => [s.id, s])
  ).values());

  return (
    <Tabs defaultValue="leaderboard" className="space-y-4">
      <TabsList>
        <TabsTrigger value="leaderboard"><Trophy className="h-4 w-4 mr-1" /> Leaderboard</TabsTrigger>
        <TabsTrigger value="targets"><Target className="h-4 w-4 mr-1" /> Targets</TabsTrigger>
        <TabsTrigger value="policies"><Award className="h-4 w-4 mr-1" /> Policies</TabsTrigger>
      </TabsList>

      {/* ── Leaderboard Tab ── */}
      <TabsContent value="leaderboard" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-500" /> SR Leaderboard</CardTitle>
            <CardDescription>Performance ranking of all Sales Representatives</CardDescription>
          </CardHeader>
          <CardContent>
            {leaderboard.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No Sales Representatives found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-center">Active Targets</TableHead>
                    <TableHead className="text-center">Completed</TableHead>
                    <TableHead className="text-right">Confirmed ৳</TableHead>
                    <TableHead className="text-right">Pending ৳</TableHead>
                    <TableHead className="text-right">Total ৳</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard.map((sr: any, i: number) => (
                    <TableRow key={sr.id}>
                      <TableCell className="font-bold">{i + 1}</TableCell>
                      <TableCell className="font-medium">{sr.name}</TableCell>
                      <TableCell><Badge variant="outline">{sr.staffCode}</Badge></TableCell>
                      <TableCell className="text-center">{sr.activeTargets}</TableCell>
                      <TableCell className="text-center">{sr.completedTargets}</TableCell>
                      <TableCell className="text-right text-emerald-600 dark:text-emerald-400 font-medium">৳{sr.confirmedEarnings.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-amber-600 dark:text-amber-400">৳{sr.pendingEarnings.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold">৳{sr.totalEarned.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Targets Tab ── */}
      <TabsContent value="targets" className="space-y-4">
        <div className="flex items-center justify-between">
          <div />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExpireAll} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-1" /> Expire Overdue
            </Button>
            <Button size="sm" onClick={openCreateTarget}>
              <Plus className="h-4 w-4 mr-1" /> New Target
            </Button>
          </div>
        </div>

        {targets.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No targets defined yet.</CardContent></Card>
        ) : (
          <div className="grid gap-4">
            {targets.map((t: any) => {
              const pct = t.targetValue > 0 ? Math.min(100, Math.round((t.currentValue / t.targetValue) * 100)) : 0;
              return (
                <Card key={t.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold">{t.title}</h3>
                        <p className="text-sm text-muted-foreground">
                          SR: {t.Staff?.name} • {t.type === "SalesAmount" ? "Sales Amount" : "Quantity"} •{" "}
                          {new Date(t.startDate).toLocaleDateString()} – {new Date(t.endDate).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={statusColor(t.status)}>{t.status}</Badge>
                        {t.status === "Active" && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => handleRecalculate(t.id)} disabled={loading}>
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openEditTarget(t)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleCancelTarget(t.id)} disabled={loading}>
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>Progress: {t.type === "SalesAmount" ? `৳${t.currentValue.toLocaleString()}` : t.currentValue} / {t.type === "SalesAmount" ? `৳${t.targetValue.toLocaleString()}` : t.targetValue}</span>
                        <span className="font-medium">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                    </div>
                    {t.IncentivePolicy && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Policy: {t.IncentivePolicy.name} ({t.IncentivePolicy.incentiveType === "CommissionRate" ? `${t.IncentivePolicy.value}%` : `৳${t.IncentivePolicy.value}`})
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </TabsContent>

      {/* ── Policies Tab ── */}
      <TabsContent value="policies" className="space-y-4">
        <div className="flex justify-end">
          <Button size="sm" onClick={openCreatePolicy}><Plus className="h-4 w-4 mr-1" /> New Policy</Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No policies defined.</TableCell></TableRow>
                ) : policies.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><Badge variant="outline">{p.incentiveType === "CommissionRate" ? "Commission %" : "Flat Bonus"}</Badge></TableCell>
                    <TableCell>{p.incentiveType === "CommissionRate" ? `${p.value}%` : `৳${p.value.toLocaleString()}`}</TableCell>
                    <TableCell>
                      <Badge className={p.isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground"}>
                        {p.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEditPolicy(p)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => handleTogglePolicy(p.id, p.isActive)}>
                        {p.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Target Dialog ── */}
      <Dialog open={isTargetDialogOpen} onOpenChange={setIsTargetDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTarget ? "Edit Target" : "Create Target"}</DialogTitle>
            <DialogDescription>Define a time-bound performance target for an SR.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {!editingTarget && (
              <div className="space-y-1">
                <Label>Sales Representative *</Label>
                <Input placeholder="Enter SR Staff ID" value={targetForm.staffId} onChange={(e) => setTargetForm({ ...targetForm, staffId: e.target.value })} />
                {uniqueSRs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {uniqueSRs.map((sr: any) => (
                      <button key={sr.id} type="button" className="text-xs px-2 py-0.5 rounded bg-muted hover:bg-muted/80" onClick={() => setTargetForm({ ...targetForm, staffId: sr.id })}>
                        {sr.name} ({sr.staffCode})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input placeholder="e.g. May 2026 Sales Target" value={targetForm.title} onChange={(e) => setTargetForm({ ...targetForm, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Type *</Label>
                <Select value={targetForm.type} onValueChange={(v) => setTargetForm({ ...targetForm, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SalesAmount">Sales Amount (৳)</SelectItem>
                    <SelectItem value="Quantity">Quantity (units)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Target Value *</Label>
                <Input type="number" placeholder={targetForm.type === "SalesAmount" ? "e.g. 500000" : "e.g. 100"} value={targetForm.targetValue} onChange={(e) => setTargetForm({ ...targetForm, targetValue: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Start Date *</Label>
                <Input type="date" value={targetForm.startDate} onChange={(e) => setTargetForm({ ...targetForm, startDate: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>End Date *</Label>
                <Input type="date" value={targetForm.endDate} onChange={(e) => setTargetForm({ ...targetForm, endDate: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Incentive Policy (optional)</Label>
              <Select value={targetForm.incentivePolicyId} onValueChange={(v) => setTargetForm({ ...targetForm, incentivePolicyId: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {policies.filter((p: any) => p.isActive).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.incentiveType === "CommissionRate" ? `${p.value}%` : `৳${p.value}`})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea placeholder="Optional notes..." value={targetForm.notes} onChange={(e) => setTargetForm({ ...targetForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTargetDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveTarget} disabled={loading}>{loading ? "Saving..." : editingTarget ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Policy Dialog ── */}
      <Dialog open={isPolicyDialogOpen} onOpenChange={setIsPolicyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPolicy ? "Edit Policy" : "Create Incentive Policy"}</DialogTitle>
            <DialogDescription>Define commission or bonus rules for SR targets.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input placeholder="e.g. 5% Commission" value={policyForm.name} onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea placeholder="Optional description..." value={policyForm.description} onChange={(e) => setPolicyForm({ ...policyForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Type *</Label>
                <Select value={policyForm.incentiveType} onValueChange={(v) => setPolicyForm({ ...policyForm, incentiveType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CommissionRate">Commission %</SelectItem>
                    <SelectItem value="FlatBonus">Flat Bonus ৳</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Value *</Label>
                <Input type="number" step="0.01" placeholder={policyForm.incentiveType === "CommissionRate" ? "e.g. 5" : "e.g. 5000"} value={policyForm.value} onChange={(e) => setPolicyForm({ ...policyForm, value: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPolicyDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePolicy} disabled={loading}>{loading ? "Saving..." : editingPolicy ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
