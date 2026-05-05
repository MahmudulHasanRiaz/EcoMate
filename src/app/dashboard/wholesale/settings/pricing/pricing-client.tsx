"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  createRule,
  updateRule,
  deleteRule,
  createTier,
  deleteTier,
  createPolicy,
  updatePolicy,
} from "@/services/wholesale-pricing";
import { DiscountType, CustomerType } from "@prisma/client";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Tag,
  Percent,
  Layers,
  Users,
} from "lucide-react";

interface PricingSettingsClientProps {
  initialRules: any[];
  initialPolicies: any[];
}

export default function PricingSettingsClient({
  initialRules,
  initialPolicies,
}: PricingSettingsClientProps) {
  const [rules, setRules] = useState(initialRules);
  const [policies, setPolicies] = useState(initialPolicies);
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [isTierDialogOpen, setIsTierDialogOpen] = useState(false);
  const [isPolicyDialogOpen, setIsPolicyDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [editingPolicy, setEditingPolicy] = useState<any>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const { toast } = useToast();

  // Rule form state
  const [ruleForm, setRuleForm] = useState({
    name: "",
    priority: 0,
    discountType: "Percentage" as DiscountType,
    discountValue: 0,
    minTotalQuantity: "",
    minSubtotal: "",
    minGrandTotal: "",
    sourcePlatforms: "",
    maxDiscountAmount: "",
    requireApproval: false,
  });

  // Tier form state
  const [tierForm, setTierForm] = useState({
    minQuantity: "",
    maxQuantity: "",
    minAmount: "",
    maxAmount: "",
    discountType: "Percentage" as DiscountType,
    discountValue: 0,
  });

  // Policy form state
  const [policyForm, setPolicyForm] = useState({
    name: "",
    maxDiscountPercent: "",
    maxDiscountAmount: "",
    requiresApproval: true,
    approvalThresholdPct: "",
    approvalThresholdAmt: "",
    requiresActiveTarget: false,
  });

  const toggleRuleExpand = (ruleId: string) => {
    const newExpanded = new Set(expandedRules);
    if (newExpanded.has(ruleId)) {
      newExpanded.delete(ruleId);
    } else {
      newExpanded.add(ruleId);
    }
    setExpandedRules(newExpanded);
  };

  const handleCreateRule = async () => {
    try {
      const newRule = await createRule({
        name: ruleForm.name,
        priority: Number(ruleForm.priority),
        discountType: ruleForm.discountType,
        discountValue: Number(ruleForm.discountValue),
        minTotalQuantity: ruleForm.minTotalQuantity
          ? Number(ruleForm.minTotalQuantity)
          : null,
        minSubtotal: ruleForm.minSubtotal ? Number(ruleForm.minSubtotal) : null,
        minGrandTotal: ruleForm.minGrandTotal
          ? Number(ruleForm.minGrandTotal)
          : null,
        sourcePlatforms: ruleForm.sourcePlatforms
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        maxDiscountAmount: ruleForm.maxDiscountAmount
          ? Number(ruleForm.maxDiscountAmount)
          : null,
        requireApproval: ruleForm.requireApproval,
        customerTypes: [CustomerType.Wholesaler],
      });
      setRules([...rules, newRule]);
      setIsRuleDialogOpen(false);
      resetRuleForm();
      toast({ title: "Success", description: "Pricing rule created" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleUpdateRule = async () => {
    if (!editingRule) return;
    try {
      const updated = await updateRule(editingRule.id, {
        name: ruleForm.name,
        priority: Number(ruleForm.priority),
        discountType: ruleForm.discountType,
        discountValue: Number(ruleForm.discountValue),
        minTotalQuantity: ruleForm.minTotalQuantity
          ? Number(ruleForm.minTotalQuantity)
          : null,
        minSubtotal: ruleForm.minSubtotal ? Number(ruleForm.minSubtotal) : null,
        minGrandTotal: ruleForm.minGrandTotal
          ? Number(ruleForm.minGrandTotal)
          : null,
        sourcePlatforms: ruleForm.sourcePlatforms
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        maxDiscountAmount: ruleForm.maxDiscountAmount
          ? Number(ruleForm.maxDiscountAmount)
          : null,
        requireApproval: ruleForm.requireApproval,
      });
      setRules(rules.map((r) => (r.id === updated.id ? updated : r)));
      setIsRuleDialogOpen(false);
      setEditingRule(null);
      resetRuleForm();
      toast({ title: "Success", description: "Pricing rule updated" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm("Are you sure you want to deactivate this rule?")) return;
    try {
      await deleteRule(ruleId);
      setRules(rules.filter((r) => r.id !== ruleId));
      toast({ title: "Success", description: "Pricing rule deactivated" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleCreateTier = async () => {
    if (!selectedRuleId) return;
    try {
      const newTier = await createTier(selectedRuleId, {
        minQuantity: tierForm.minQuantity ? Number(tierForm.minQuantity) : null,
        maxQuantity: tierForm.maxQuantity ? Number(tierForm.maxQuantity) : null,
        minAmount: tierForm.minAmount ? Number(tierForm.minAmount) : null,
        maxAmount: tierForm.maxAmount ? Number(tierForm.maxAmount) : null,
        discountType: tierForm.discountType,
        discountValue: Number(tierForm.discountValue),
      });
      setRules(
        rules.map((r) =>
          r.id === selectedRuleId
            ? { ...r, Tiers: [...(r.Tiers || []), newTier] }
            : r
        )
      );
      setIsTierDialogOpen(false);
      resetTierForm();
      toast({ title: "Success", description: "Pricing tier created" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleDeleteTier = async (tierId: string, ruleId: string) => {
    if (!confirm("Are you sure you want to delete this tier?")) return;
    try {
      await deleteTier(tierId);
      setRules(
        rules.map((r) =>
          r.id === ruleId
            ? { ...r, Tiers: r.Tiers?.filter((t: any) => t.id !== tierId) || [] }
            : r
        )
      );
      toast({ title: "Success", description: "Pricing tier deleted" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleCreatePolicy = async () => {
    try {
      const newPolicy = await createPolicy({
        name: policyForm.name,
        maxDiscountPercent: policyForm.maxDiscountPercent
          ? Number(policyForm.maxDiscountPercent)
          : null,
        maxDiscountAmount: policyForm.maxDiscountAmount
          ? Number(policyForm.maxDiscountAmount)
          : null,
        requiresApproval: policyForm.requiresApproval,
        approvalThresholdPct: policyForm.approvalThresholdPct
          ? Number(policyForm.approvalThresholdPct)
          : null,
        approvalThresholdAmt: policyForm.approvalThresholdAmt
          ? Number(policyForm.approvalThresholdAmt)
          : null,
        requiresActiveTarget: policyForm.requiresActiveTarget,
      });
      setPolicies([...policies, newPolicy]);
      setIsPolicyDialogOpen(false);
      resetPolicyForm();
      toast({ title: "Success", description: "SR discount policy created" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleUpdatePolicy = async () => {
    if (!editingPolicy) return;
    try {
      const updated = await updatePolicy(editingPolicy.id, {
        name: policyForm.name,
        maxDiscountPercent: policyForm.maxDiscountPercent
          ? Number(policyForm.maxDiscountPercent)
          : null,
        maxDiscountAmount: policyForm.maxDiscountAmount
          ? Number(policyForm.maxDiscountAmount)
          : null,
        requiresApproval: policyForm.requiresApproval,
        approvalThresholdPct: policyForm.approvalThresholdPct
          ? Number(policyForm.approvalThresholdPct)
          : null,
        approvalThresholdAmt: policyForm.approvalThresholdAmt
          ? Number(policyForm.approvalThresholdAmt)
          : null,
        requiresActiveTarget: policyForm.requiresActiveTarget,
      });
      setPolicies(policies.map((p) => (p.id === updated.id ? updated : p)));
      setIsPolicyDialogOpen(false);
      setEditingPolicy(null);
      resetPolicyForm();
      toast({ title: "Success", description: "SR discount policy updated" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const openEditRule = (rule: any) => {
    setEditingRule(rule);
    setRuleForm({
      name: rule.name,
      priority: rule.priority,
      discountType: rule.discountType,
      discountValue: rule.discountValue,
      minTotalQuantity: rule.minTotalQuantity?.toString() || "",
      minSubtotal: rule.minSubtotal?.toString() || "",
      minGrandTotal: rule.minGrandTotal?.toString() || "",
      sourcePlatforms: rule.sourcePlatforms?.join(", ") || "",
      maxDiscountAmount: rule.maxDiscountAmount?.toString() || "",
      requireApproval: rule.requireApproval,
    });
    setIsRuleDialogOpen(true);
  };

  const openEditPolicy = (policy: any) => {
    setEditingPolicy(policy);
    setPolicyForm({
      name: policy.name,
      maxDiscountPercent: policy.maxDiscountPercent?.toString() || "",
      maxDiscountAmount: policy.maxDiscountAmount?.toString() || "",
      requiresApproval: policy.requiresApproval,
      approvalThresholdPct: policy.approvalThresholdPct?.toString() || "",
      approvalThresholdAmt: policy.approvalThresholdAmt?.toString() || "",
      requiresActiveTarget: policy.requiresActiveTarget,
    });
    setIsPolicyDialogOpen(true);
  };

  const resetRuleForm = () => {
    setRuleForm({
      name: "",
      priority: 0,
      discountType: DiscountType.Percentage,
      discountValue: 0,
      minTotalQuantity: "",
      minSubtotal: "",
      minGrandTotal: "",
      sourcePlatforms: "",
      maxDiscountAmount: "",
      requireApproval: false,
    });
  };

  const resetTierForm = () => {
    setTierForm({
      minQuantity: "",
      maxQuantity: "",
      minAmount: "",
      maxAmount: "",
      discountType: DiscountType.Percentage,
      discountValue: 0,
    });
  };

  const resetPolicyForm = () => {
    setPolicyForm({
      name: "",
      maxDiscountPercent: "",
      maxDiscountAmount: "",
      requiresApproval: true,
      approvalThresholdPct: "",
      approvalThresholdAmt: "",
      requiresActiveTarget: false,
    });
  };

  const getDiscountTypeLabel = (type: DiscountType) => {
    switch (type) {
      case DiscountType.Percentage:
        return "%";
      case DiscountType.FlatAmount:
        return "BDT";
      case DiscountType.PerQuantity:
        return "BDT/qty";
      default:
        return type;
    }
  };

  return (
    <Tabs defaultValue="rules" className="space-y-6">
      <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
        <TabsTrigger value="rules" className="flex items-center gap-2">
          <Tag className="h-4 w-4" /> Pricing Rules
        </TabsTrigger>
        <TabsTrigger value="policies" className="flex items-center gap-2">
          <Users className="h-4 w-4" /> SR Policies
        </TabsTrigger>
      </TabsList>

      <TabsContent value="rules" className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">Pricing Rules</h2>
            <p className="text-sm text-muted-foreground">
              Configure wholesale pricing rules and quantity/amount tiers
            </p>
          </div>
          <Button onClick={() => setIsRuleDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Rule
          </Button>
        </div>

        <div className="space-y-4">
          {rules.map((rule) => (
            <Card key={rule.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{rule.name}</CardTitle>
                      <Badge
                        variant={rule.isActive ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {rule.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">
                      Priority: {rule.priority} • Discount: {rule.discountValue}
                      {getDiscountTypeLabel(rule.discountType)}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditRule(rule)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteRule(rule.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleRuleExpand(rule.id)}
                    >
                      {expandedRules.has(rule.id) ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {expandedRules.has(rule.id) && (
                <CardContent className="pt-0">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Min Qty:</span>
                        <p className="font-medium">
                          {rule.minTotalQuantity || "-"}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Min Subtotal:
                        </span>
                        <p className="font-medium">
                          {rule.minSubtotal || "-"}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Min Grand Total:
                        </span>
                        <p className="font-medium">
                          {rule.minGrandTotal || "-"}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Approval:</span>
                        <p className="font-medium">
                          {rule.requireApproval ? "Required" : "Auto"}
                        </p>
                      </div>
                    </div>

                    {rule.sourcePlatforms?.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-muted-foreground">
                          Platforms:
                        </span>
                        {rule.sourcePlatforms.map((p: string) => (
                          <Badge key={p} variant="outline" className="text-xs">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium flex items-center gap-2">
                          <Layers className="h-4 w-4" /> Tiers
                        </h4>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedRuleId(rule.id);
                            setIsTierDialogOpen(true);
                          }}
                        >
                          <Plus className="mr-1 h-3 w-3" /> Add Tier
                        </Button>
                      </div>

                      {rule.Tiers?.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Range</TableHead>
                              <TableHead className="text-xs">Discount</TableHead>
                              <TableHead className="text-xs w-16"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rule.Tiers.map((tier: any) => (
                              <TableRow key={tier.id}>
                                <TableCell className="text-sm">
                                  {tier.minQuantity && `Qty: ${tier.minQuantity}`}
                                  {tier.maxQuantity && ` - ${tier.maxQuantity}`}
                                  {tier.minAmount && `Amt: ${tier.minAmount}`}
                                  {tier.maxAmount && ` - ${tier.maxAmount}`}
                                  {!tier.minQuantity &&
                                    !tier.minAmount &&
                                    "Any"}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {tier.discountValue}
                                  {getDiscountTypeLabel(tier.discountType)}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() =>
                                      handleDeleteTier(tier.id, rule.id)
                                    }
                                  >
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No tiers configured
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}

          {rules.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">No pricing rules found</p>
              <Button
                className="mt-4"
                onClick={() => setIsRuleDialogOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" /> Create First Rule
              </Button>
            </Card>
          )}
        </div>
      </TabsContent>

      <TabsContent value="policies" className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">SR Discount Policies</h2>
            <p className="text-sm text-muted-foreground">
              Configure SR extra discount limits and approval requirements
            </p>
          </div>
          <Button onClick={() => setIsPolicyDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Policy
          </Button>
        </div>

        <div className="grid gap-4">
          {policies.map((policy) => (
            <Card key={policy.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{policy.name}</CardTitle>
                      <Badge
                        variant={policy.isActive ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {policy.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">
                      {policy.Staff?.name
                        ? `For: ${policy.Staff.name}`
                        : "Global Policy"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditPolicy(policy)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Max %:</span>
                    <p className="font-medium">
                      {policy.maxDiscountPercent
                        ? `${policy.maxDiscountPercent}%`
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Max Amount:</span>
                    <p className="font-medium">
                      {policy.maxDiscountAmount
                        ? `${policy.maxDiscountAmount} BDT`
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Approval:</span>
                    <p className="font-medium">
                      {policy.requiresApproval ? "Required" : "Auto"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Active Target:</span>
                    <p className="font-medium">
                      {policy.requiresActiveTarget ? "Required" : "No"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {policies.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">No SR policies found</p>
              <Button
                className="mt-4"
                onClick={() => setIsPolicyDialogOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" /> Create First Policy
              </Button>
            </Card>
          )}
        </div>
      </TabsContent>

      {/* Rule Dialog */}
      <Dialog
        open={isRuleDialogOpen}
        onOpenChange={(open) => {
          setIsRuleDialogOpen(open);
          if (!open) {
            setEditingRule(null);
            resetRuleForm();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? "Edit Pricing Rule" : "Create Pricing Rule"}
            </DialogTitle>
            <DialogDescription>
              Configure wholesale pricing rule conditions and discount
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Rule Name</Label>
              <Input
                value={ruleForm.name}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, name: e.target.value })
                }
                placeholder="e.g., VIP Wholesaler Discount"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Input
                  type="number"
                  value={ruleForm.priority}
                  onChange={(e) =>
                    setRuleForm({
                      ...ruleForm,
                      priority: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Max Discount (BDT)</Label>
                <Input
                  type="number"
                  value={ruleForm.maxDiscountAmount}
                  onChange={(e) =>
                    setRuleForm({
                      ...ruleForm,
                      maxDiscountAmount: e.target.value,
                    })
                  }
                  placeholder="No limit"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Discount Type</Label>
                <Select
                  value={ruleForm.discountType}
                  onValueChange={(v) =>
                    setRuleForm({ ...ruleForm, discountType: v as unknown as DiscountType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DiscountType.Percentage}>
                      Percentage
                    </SelectItem>
                    <SelectItem value={DiscountType.FlatAmount}>
                      Flat Amount
                    </SelectItem>
                    <SelectItem value={DiscountType.PerQuantity}>
                      Per Quantity
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Discount Value</Label>
                <Input
                  type="number"
                  value={ruleForm.discountValue}
                  onChange={(e) =>
                    setRuleForm({
                      ...ruleForm,
                      discountValue: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Min Total Qty</Label>
                <Input
                  type="number"
                  value={ruleForm.minTotalQuantity}
                  onChange={(e) =>
                    setRuleForm({
                      ...ruleForm,
                      minTotalQuantity: e.target.value,
                    })
                  }
                  placeholder="Any"
                />
              </div>
              <div className="space-y-2">
                <Label>Min Subtotal</Label>
                <Input
                  type="number"
                  value={ruleForm.minSubtotal}
                  onChange={(e) =>
                    setRuleForm({ ...ruleForm, minSubtotal: e.target.value })
                  }
                  placeholder="Any"
                />
              </div>
              <div className="space-y-2">
                <Label>Min Grand Total</Label>
                <Input
                  type="number"
                  value={ruleForm.minGrandTotal}
                  onChange={(e) =>
                    setRuleForm({
                      ...ruleForm,
                      minGrandTotal: e.target.value,
                    })
                  }
                  placeholder="Any"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Source Platforms (comma separated)</Label>
              <Input
                value={ruleForm.sourcePlatforms}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, sourcePlatforms: e.target.value })
                }
                placeholder="Manual, POS, Web"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="requireApproval"
                checked={ruleForm.requireApproval}
                onChange={(e) =>
                  setRuleForm({
                    ...ruleForm,
                    requireApproval: e.target.checked,
                  })
                }
                className="h-4 w-4"
              />
              <Label htmlFor="requireApproval" className="cursor-pointer">
                Require approval for this discount
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRuleDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={editingRule ? handleUpdateRule : handleCreateRule}>
              {editingRule ? "Update Rule" : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tier Dialog */}
      <Dialog
        open={isTierDialogOpen}
        onOpenChange={(open) => {
          setIsTierDialogOpen(open);
          if (!open) resetTierForm();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Pricing Tier</DialogTitle>
            <DialogDescription>
              Create a quantity or amount-based tier for this rule
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Quantity</Label>
                <Input
                  type="number"
                  value={tierForm.minQuantity}
                  onChange={(e) =>
                    setTierForm({ ...tierForm, minQuantity: e.target.value })
                  }
                  placeholder="Any"
                />
              </div>
              <div className="space-y-2">
                <Label>Max Quantity</Label>
                <Input
                  type="number"
                  value={tierForm.maxQuantity}
                  onChange={(e) =>
                    setTierForm({ ...tierForm, maxQuantity: e.target.value })
                  }
                  placeholder="Unlimited"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Amount</Label>
                <Input
                  type="number"
                  value={tierForm.minAmount}
                  onChange={(e) =>
                    setTierForm({ ...tierForm, minAmount: e.target.value })
                  }
                  placeholder="Any"
                />
              </div>
              <div className="space-y-2">
                <Label>Max Amount</Label>
                <Input
                  type="number"
                  value={tierForm.maxAmount}
                  onChange={(e) =>
                    setTierForm({ ...tierForm, maxAmount: e.target.value })
                  }
                  placeholder="Unlimited"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Discount Type</Label>
                <Select
                  value={tierForm.discountType}
                  onValueChange={(v) =>
                    setTierForm({ ...tierForm, discountType: v as unknown as DiscountType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DiscountType.Percentage}>
                      Percentage
                    </SelectItem>
                    <SelectItem value={DiscountType.FlatAmount}>
                      Flat Amount
                    </SelectItem>
                    <SelectItem value={DiscountType.PerQuantity}>
                      Per Quantity
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Discount Value</Label>
                <Input
                  type="number"
                  value={tierForm.discountValue}
                  onChange={(e) =>
                    setTierForm({
                      ...tierForm,
                      discountValue: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTierDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateTier}>Add Tier</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Policy Dialog */}
      <Dialog
        open={isPolicyDialogOpen}
        onOpenChange={(open) => {
          setIsPolicyDialogOpen(open);
          if (!open) {
            setEditingPolicy(null);
            resetPolicyForm();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingPolicy ? "Edit SR Policy" : "Create SR Discount Policy"}
            </DialogTitle>
            <DialogDescription>
              Configure SR extra discount limits and approval requirements
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Policy Name</Label>
              <Input
                value={policyForm.name}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, name: e.target.value })
                }
                placeholder="e.g., Senior SR Policy"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max Discount %</Label>
                <Input
                  type="number"
                  value={policyForm.maxDiscountPercent}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      maxDiscountPercent: e.target.value,
                    })
                  }
                  placeholder="No limit"
                />
              </div>
              <div className="space-y-2">
                <Label>Max Discount Amount</Label>
                <Input
                  type="number"
                  value={policyForm.maxDiscountAmount}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      maxDiscountAmount: e.target.value,
                    })
                  }
                  placeholder="No limit"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Approval Threshold %</Label>
                <Input
                  type="number"
                  value={policyForm.approvalThresholdPct}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      approvalThresholdPct: e.target.value,
                    })
                  }
                  placeholder="No threshold"
                />
              </div>
              <div className="space-y-2">
                <Label>Approval Threshold Amount</Label>
                <Input
                  type="number"
                  value={policyForm.approvalThresholdAmt}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      approvalThresholdAmt: e.target.value,
                    })
                  }
                  placeholder="No threshold"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="requiresApproval"
                checked={policyForm.requiresApproval}
                onChange={(e) =>
                  setPolicyForm({
                    ...policyForm,
                    requiresApproval: e.target.checked,
                  })
                }
                className="h-4 w-4"
              />
              <Label htmlFor="requiresApproval" className="cursor-pointer">
                Require approval for all extra discounts
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="requiresActiveTarget"
                checked={policyForm.requiresActiveTarget}
                onChange={(e) =>
                  setPolicyForm({
                    ...policyForm,
                    requiresActiveTarget: e.target.checked,
                  })
                }
                className="h-4 w-4"
              />
              <Label
                htmlFor="requiresActiveTarget"
                className="cursor-pointer"
              >
                Requires active SR target
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPolicyDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={editingPolicy ? handleUpdatePolicy : handleCreatePolicy}
            >
              {editingPolicy ? "Update Policy" : "Create Policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
