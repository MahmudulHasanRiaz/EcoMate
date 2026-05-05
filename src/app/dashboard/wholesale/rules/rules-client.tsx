
'use client';

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createWholesaleRule,
  updateWholesaleRule,
  deleteWholesaleRule
} from "@/services/wholesale";
import { Plus, Edit, Trash, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

export default function WholesaleRulesClient({ initialRules }: { initialRules: any[] }) {
  const [rules, setRules] = useState(initialRules);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const router = useRouter();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    priority: 0,
    isActive: true,
    requireApproval: true,
    minTotalQuantity: "",
    minSubtotal: "",
    minGrandTotal: "",
    sourcePlatforms: [] as string[],
    notes: "",
  });

  const availablePlatforms = [
    "Manual", "POS", "Woo", "Messenger", "Facebook", "WhatsApp", "TikTok", "Instagram", "Website", "Call", "SR"
  ];

  const handleOpenDialog = (rule?: any) => {
    if (rule) {
      setEditingRule(rule);
      setFormData({
        name: rule.name,
        priority: rule.priority,
        isActive: rule.isActive,
        requireApproval: rule.requireApproval,
        minTotalQuantity: rule.minTotalQuantity?.toString() || "",
        minSubtotal: rule.minSubtotal?.toString() || "",
        minGrandTotal: rule.minGrandTotal?.toString() || "",
        sourcePlatforms: (rule.sourcePlatforms as string[]) || [],
        notes: rule.notes || "",
      });
    } else {
      setEditingRule(null);
      setFormData({
        name: "",
        priority: 0,
        isActive: true,
        requireApproval: true,
        minTotalQuantity: "",
        minSubtotal: "",
        minGrandTotal: "",
        sourcePlatforms: [],
        notes: "",
      });
    }
    setIsDialogOpen(true);
  };

  const togglePlatform = (platform: string) => {
    setFormData(prev => {
      const current = prev.sourcePlatforms;
      if (current.includes(platform)) {
        return { ...prev, sourcePlatforms: current.filter(p => p !== platform) };
      } else {
        return { ...prev, sourcePlatforms: [...current, platform] };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Rule name is required" });
      return;
    }

    try {
      if (editingRule) {
        await updateWholesaleRule(editingRule.id, formData);
        toast({ title: "Success", description: "Rule updated successfully" });
      } else {
        await createWholesaleRule(formData);
        toast({ title: "Success", description: "Rule created successfully" });
      }
      setIsDialogOpen(false);
      router.refresh();
    } catch (error: any) {
      const msg = error.message?.includes("409:")
        ? error.message.split("409:")[1]
        : "Failed to save rule";
      toast({ variant: "destructive", title: "Error", description: msg });
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to deactivate this rule? It will no longer be applied to new orders.")) {
      try {
        await deleteWholesaleRule(id);
        toast({ title: "Success", description: "Rule deactivated successfully" });
        router.refresh();
      } catch (error) {
        toast({ variant: "destructive", title: "Error", description: "Failed to deactivate rule" });
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Wholesale Qualification Rules</h2>
          <p className="text-sm text-muted-foreground">Rules are evaluated in order of priority (lowest number first).</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="mr-2 h-4 w-4" /> Add Rule
        </Button>
      </div>

      <div className="rounded-md border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[80px]">Priority</TableHead>
              <TableHead>Rule Details</TableHead>
              <TableHead>Conditions</TableHead>
              <TableHead>Platforms</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialRules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No rules defined. Orders will default to Retail.
                </TableCell>
              </TableRow>
            ) : (
              initialRules.map((rule) => (
                <TableRow key={rule.id} className={!rule.isActive ? "opacity-60 bg-muted/20" : ""}>
                  <TableCell className="font-medium text-center">
                    <Badge variant="outline" className="font-mono">{rule.priority}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold flex items-center gap-2">
                      {rule.name}
                      {!rule.isActive && <Badge variant="destructive" className="h-4 text-[10px] px-1">Inactive</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]">
                      {rule.notes || "No notes"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {rule.minTotalQuantity && (
                        <Badge variant="secondary" className="text-[10px]">Qty ≥ {rule.minTotalQuantity}</Badge>
                      )}
                      {rule.minSubtotal && (
                        <Badge variant="secondary" className="text-[10px]">Sub ≥ {rule.minSubtotal} BDT</Badge>
                      )}
                      {rule.minGrandTotal && (
                        <Badge variant="secondary" className="text-[10px]">Grand ≥ {rule.minGrandTotal} BDT</Badge>
                      )}
                      {!rule.minTotalQuantity && !rule.minSubtotal && !rule.minGrandTotal && (
                        <span className="text-xs text-muted-foreground italic">Always match</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[150px]">
                      {(rule.sourcePlatforms as string[] || []).length > 0 ? (
                        (rule.sourcePlatforms as string[]).map(p => (
                          <Badge key={p} variant="outline" className="text-[9px] px-1 h-4">{p}</Badge>
                        ))
                      ) : (
                        <Badge variant="outline" className="text-[9px] px-1 h-4 bg-muted">All</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[10px]", rule.requireApproval ? "bg-yellow-50 text-yellow-700 border-yellow-200" : "bg-green-50 text-green-700 border-green-200")}>
                      {rule.requireApproval ? "Manual Review" : "Auto-Approve"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(rule)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(rule.id)} disabled={!rule.isActive}>
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit Wholesale Rule" : "Create Wholesale Rule"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="name">Rule Name <span className="text-red-500">*</span></Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g. Bulk Website Orders"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="priority">Evaluation Priority</Label>
                <Input
                  id="priority"
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData({...formData, priority: parseInt(e.target.value) || 0})}
                />
                <p className="text-[10px] text-muted-foreground">Lower numbers run first.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="minTotalQuantity">Min Total Items</Label>
                <Input
                  id="minTotalQuantity"
                  type="number"
                  value={formData.minTotalQuantity}
                  onChange={(e) => setFormData({...formData, minTotalQuantity: e.target.value})}
                  placeholder="Leave empty for no limit"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="minSubtotal">Min Subtotal (BDT)</Label>
                <Input
                  id="minSubtotal"
                  type="number"
                  value={formData.minSubtotal}
                  onChange={(e) => setFormData({...formData, minSubtotal: e.target.value})}
                  placeholder="Excl. shipping"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="minGrandTotal">Min Grand Total (BDT)</Label>
                <Input
                  id="minGrandTotal"
                  type="number"
                  value={formData.minGrandTotal}
                  onChange={(e) => setFormData({...formData, minGrandTotal: e.target.value})}
                  placeholder="Incl. shipping"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Apply to Platforms</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-md bg-muted/30">
                {availablePlatforms.map(platform => (
                  <Button
                    key={platform}
                    type="button"
                    variant={formData.sourcePlatforms.includes(platform) ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-[10px] px-2"
                    onClick={() => togglePlatform(platform)}
                  >
                    {platform}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Select one or more platforms. Leave all unselected to apply to all.</p>
            </div>

            <div className="flex flex-col gap-3 p-3 border rounded-md bg-muted/10">
              <div className="flex items-center justify-between">
                <Label htmlFor="requireApproval" className="cursor-pointer">Require Review Queue</Label>
                <Switch
                  id="requireApproval"
                  checked={formData.requireApproval}
                  onCheckedChange={(checked) => setFormData({...formData, requireApproval: checked})}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="isActive" className="cursor-pointer">Rule is Active</Label>
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({...formData, isActive: checked})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Internal Audit Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                placeholder="Why was this rule created?"
                className="h-20"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="min-w-[100px]">
                {editingRule ? "Update Rule" : "Create Rule"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>

  );
}
