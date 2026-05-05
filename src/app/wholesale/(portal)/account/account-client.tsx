"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { submitProductRequest } from "@/services/product-requests";
import { ImageUploader } from "@/components/ui/image-uploader";
import Image from "next/image";
import {
  Package, DollarSign, TrendingUp, Clock, CheckCircle,
  Percent, User, Phone, MapPin, Search, Plus, Image as ImageIcon
} from "lucide-react";

type AccountData = {
  name: string; phone: string; type: string; address: string | null;
  totalOrders: number; totalRevenue: number; totalPaid: number; totalDue: number;
  totalDiscounts: number; pendingOrders: number; completedOrders: number;
};

function StatCard({
  title, value, icon: Icon, subtitle, variant = "default",
}: {
  title: string; value: string; icon: any; subtitle?: string; variant?: "default" | "success" | "warning" | "danger";
}) {
  const colorMap = { default: "text-foreground", success: "text-green-600 dark:text-green-400", warning: "text-amber-600 dark:text-amber-400", danger: "text-destructive" };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10"><Icon className="h-5 w-5 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className={`text-xl font-bold ${colorMap[variant]}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WholesaleAccountClient({ account, initialRequests = [] }: { account: AccountData, initialRequests?: any[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requestForm, setRequestForm] = useState({ description: "", imageUrl: "" });
  const { toast } = useToast();

  async function handleSubmitRequest() {
    setLoading(true);
    try {
      if (!requestForm.description || requestForm.description.length < 3) {
        throw new Error("Please provide a description of the product you need");
      }
      await submitProductRequest(requestForm);
      toast({ title: "Product request submitted successfully" });
      setIsRequestDialogOpen(false);
      setRequestForm({ description: "", imageUrl: "" });
      // In a real app we might refetch, but here a simple reload or optimistic update works:
      window.location.reload();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case "Pending": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
      case "Reviewing": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "Sourced": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
      case "Completed": return "bg-muted text-muted-foreground";
      case "Rejected": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      default: return "bg-muted";
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Account</h1>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview"><User className="h-4 w-4 mr-2" /> Overview</TabsTrigger>
          <TabsTrigger value="requests"><Search className="h-4 w-4 mr-2" /> Product Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><User className="h-5 w-5" /> Profile</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><span className="text-sm">{account.phone}</span></div>
              {account.address && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span className="text-sm">{account.address}</span></div>}
              <div className="flex items-center gap-2"><Package className="h-4 w-4 text-muted-foreground" /><span className="text-sm capitalize">{account.type} Account</span></div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Orders" value={String(account.totalOrders)} icon={Package} subtitle={`${account.pendingOrders} pending`} />
            <StatCard title="Total Revenue" value={`৳${account.totalRevenue.toLocaleString()}`} icon={TrendingUp} />
            <StatCard title="Total Paid" value={`৳${account.totalPaid.toLocaleString()}`} icon={DollarSign} variant="success" />
            <StatCard title="Outstanding Due" value={`৳${account.totalDue.toLocaleString()}`} icon={Clock} variant={account.totalDue > 0 ? "danger" : "success"} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard title="Completed Orders" value={String(account.completedOrders)} icon={CheckCircle} variant="success" />
            <StatCard title="Pending Orders" value={String(account.pendingOrders)} icon={Clock} variant={account.pendingOrders > 0 ? "warning" : "default"} />
            <StatCard title="Total Discounts" value={`৳${account.totalDiscounts.toLocaleString()}`} icon={Percent} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-lg">Payment Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm"><span>Total Order Value</span><span className="font-medium">৳{account.totalRevenue.toLocaleString()}</span></div>
              <div className="flex justify-between text-sm"><span>Amount Paid</span><span className="font-medium text-green-600 dark:text-green-400">৳{account.totalPaid.toLocaleString()}</span></div>
              <Separator />
              <div className="flex justify-between font-bold"><span>Balance Due</span><span className={account.totalDue > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}>৳{account.totalDue.toLocaleString()}</span></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests" className="space-y-6">
          <div className="flex justify-between items-center">
            <p className="text-muted-foreground">Request new products you want to buy from us.</p>
            <Button onClick={() => setIsRequestDialogOpen(true)}><Plus className="h-4 w-4 mr-2" /> New Request</Button>
          </div>

          {requests.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">You haven't requested any products yet.</CardContent></Card>
          ) : (
            <div className="grid gap-4">
              {requests.map((req) => (
                <Card key={req.id}>
                  <CardContent className="p-4 flex gap-4">
                    {req.imageUrl ? (
                      <div className="relative w-24 h-24 rounded border flex-shrink-0 bg-muted/50 overflow-hidden">
                        <Image src={req.imageUrl} alt="Request" fill className="object-cover" />
                      </div>
                    ) : (
                      <div className="w-24 h-24 rounded border flex-shrink-0 bg-muted/50 flex items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-8 w-8 opacity-50" />
                      </div>
                    )}
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">{new Date(req.createdAt).toLocaleDateString()}</span>
                        <Badge className={statusColor(req.status)}>{req.status}</Badge>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{req.description}</p>
                      {req.LinkedProduct && (
                        <div className="mt-2 p-2 bg-muted/50 border rounded text-xs flex items-center gap-2">
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">Sourced:</span> {req.LinkedProduct.name}
                        </div>
                      )}
                      {req.status === "Rejected" && req.rejectionReason && (
                        <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border rounded text-xs text-red-700 dark:text-red-400">
                          <span className="font-semibold">Reason:</span> {req.rejectionReason}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isRequestDialogOpen} onOpenChange={setIsRequestDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request a New Product</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Product Image</Label>
              <ImageUploader 
                images={requestForm.imageUrl ? [{ id: '1', url: requestForm.imageUrl }] : []}
                onImagesChange={async (files) => {
                  if (files.length > 0) {
                    const first = files[0];
                    if (first instanceof File) {
                      setLoading(true);
                      try {
                        const formData = new FormData();
                        formData.append("file", first);
                        const res = await fetch("/api/wholesale/upload", {
                          method: "POST",
                          body: formData,
                        });
                        const data = await res.json();
                        if (res.ok && data.url) {
                          setRequestForm({ ...requestForm, imageUrl: data.url });
                        } else {
                          toast({ title: "Upload Failed", description: data.error || "Unknown error", variant: "destructive" });
                        }
                      } catch (err: any) {
                        toast({ title: "Upload Error", description: err.message, variant: "destructive" });
                      } finally {
                        setLoading(false);
                      }
                    } else {
                      setRequestForm({ ...requestForm, imageUrl: first.url });
                    }
                  } else {
                    setRequestForm({ ...requestForm, imageUrl: "" });
                  }
                }}
                isMultiple={false}
              />
              <p className="text-xs text-muted-foreground">Upload a photo of the product you are looking for.</p>
            </div>
            <div className="space-y-2">
              <Label>Description *</Label>
              <Textarea 
                placeholder="Describe what you are looking for... (e.g. Fabric type, colors, estimated quantity needed)"
                rows={4}
                value={requestForm.description}
                onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRequestDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmitRequest} disabled={loading}>{loading ? "Submitting..." : "Submit Request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
