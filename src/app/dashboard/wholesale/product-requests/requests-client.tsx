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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  adminListProductRequests,
  adminUpdateProductRequest,
  adminGetProductRequestCounts
} from "@/services/product-requests";
import { Image as ImageIcon, Eye, ExternalLink } from "lucide-react";
import type { ProductRequestStatus } from "@prisma/client";
import Image from "next/image";
import Link from "next/link";

interface Props {
  initialRequests: any[];
  initialCounts: any;
}

export default function ProductRequestsClient({ initialRequests, initialCounts }: Props) {
  const [requests, setRequests] = useState(initialRequests);
  const [counts, setCounts] = useState(initialCounts);
  const [statusFilter, setStatusFilter] = useState<ProductRequestStatus | "All">("All");
  
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const [updateForm, setUpdateForm] = useState({
    status: "Pending" as ProductRequestStatus,
    linkedProductId: "",
    adminNote: "",
    rejectionReason: "",
  });

  async function refreshData() {
    try {
      const [r, c] = await Promise.all([
        adminListProductRequests(statusFilter !== "All" ? { status: statusFilter } : undefined),
        adminGetProductRequestCounts()
      ]);
      setRequests(r);
      setCounts(c);
    } catch (e) {
      console.error(e);
    }
  }

  function openUpdateDialog(req: any) {
    setSelectedRequest(req);
    setUpdateForm({
      status: req.status,
      linkedProductId: req.linkedProductId || "",
      adminNote: req.adminNote || "",
      rejectionReason: req.rejectionReason || "",
    });
    setIsUpdateDialogOpen(true);
  }

  async function handleUpdate() {
    if (!selectedRequest) return;
    setLoading(true);
    try {
      await adminUpdateProductRequest(selectedRequest.id, {
        status: updateForm.status,
        linkedProductId: updateForm.linkedProductId || null,
        adminNote: updateForm.adminNote,
        rejectionReason: updateForm.status === "Rejected" ? updateForm.rejectionReason : undefined,
      });
      toast({ title: "Request updated" });
      setIsUpdateDialogOpen(false);
      await refreshData();
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card className={statusFilter === "All" ? "border-primary" : ""} onClick={() => { setStatusFilter("All"); refreshData(); }}>
          <CardContent className="p-3 text-center cursor-pointer hover:bg-muted/50">
            <p className="text-xs text-muted-foreground font-medium uppercase">All</p>
            <p className="text-2xl font-bold">{counts.total}</p>
          </CardContent>
        </Card>
        <Card className={statusFilter === "Pending" ? "border-amber-500" : ""} onClick={() => { setStatusFilter("Pending"); refreshData(); }}>
          <CardContent className="p-3 text-center cursor-pointer hover:bg-muted/50">
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium uppercase">Pending</p>
            <p className="text-2xl font-bold">{counts.pending}</p>
          </CardContent>
        </Card>
        <Card className={statusFilter === "Reviewing" ? "border-blue-500" : ""} onClick={() => { setStatusFilter("Reviewing"); refreshData(); }}>
          <CardContent className="p-3 text-center cursor-pointer hover:bg-muted/50">
            <p className="text-xs text-blue-600 dark:text-blue-400 font-medium uppercase">Reviewing</p>
            <p className="text-2xl font-bold">{counts.reviewing}</p>
          </CardContent>
        </Card>
        <Card className={statusFilter === "Sourced" ? "border-emerald-500" : ""} onClick={() => { setStatusFilter("Sourced"); refreshData(); }}>
          <CardContent className="p-3 text-center cursor-pointer hover:bg-muted/50">
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium uppercase">Sourced</p>
            <p className="text-2xl font-bold">{counts.sourced}</p>
          </CardContent>
        </Card>
        <Card className={statusFilter === "Rejected" ? "border-red-500" : ""} onClick={() => { setStatusFilter("Rejected"); refreshData(); }}>
          <CardContent className="p-3 text-center cursor-pointer hover:bg-muted/50">
            <p className="text-xs text-red-600 dark:text-red-400 font-medium uppercase">Rejected</p>
            <p className="text-2xl font-bold">{counts.rejected}</p>
          </CardContent>
        </Card>
        <Card className={statusFilter === "Completed" ? "border-slate-500 dark:border-slate-400" : ""} onClick={() => { setStatusFilter("Completed"); refreshData(); }}>
          <CardContent className="p-3 text-center cursor-pointer hover:bg-muted/50">
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium uppercase">Completed</p>
            <p className="text-2xl font-bold">{counts.completed}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Image</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No requests found.
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell>
                      {req.imageUrl ? (
                        <div className="relative w-12 h-12 rounded overflow-hidden border">
                          <Image src={req.imageUrl} alt="Request" fill className="object-cover" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded border bg-muted/50 flex items-center justify-center">
                          <ImageIcon className="h-4 w-4 text-slate-300" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{req.customerName}</div>
                      <div className="text-xs text-muted-foreground">{req.customerPhone}</div>
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <p className="truncate" title={req.description}>{req.description}</p>
                      {req.LinkedProduct && (
                        <Link href={`/dashboard/products/${req.LinkedProduct.id}`} className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 mt-1 hover:underline">
                          <ExternalLink className="h-3 w-3" /> Linked: {req.LinkedProduct.name}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColor(req.status)}>{req.status}</Badge>
                      {req.assignedToName && <div className="text-xs mt-1 text-muted-foreground">By: {req.assignedToName}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openUpdateDialog(req)}>
                        <Eye className="h-4 w-4 mr-1" /> View / Update
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Product Request Details</DialogTitle>
          </DialogHeader>
          
          {selectedRequest && (
            <div className="grid gap-6 py-4">
              <div className="flex gap-4 p-4 border rounded-lg bg-muted/50">
                {selectedRequest.imageUrl ? (
                  <div className="relative w-32 h-32 rounded-lg overflow-hidden border bg-background flex-shrink-0">
                    <Image src={selectedRequest.imageUrl} alt="Request" fill className="object-contain" />
                  </div>
                ) : (
                  <div className="w-32 h-32 rounded-lg border bg-background flex flex-col items-center justify-center flex-shrink-0 text-muted-foreground">
                    <ImageIcon className="h-8 w-8 mb-2 opacity-50" />
                    <span className="text-xs">No image</span>
                  </div>
                )}
                <div className="space-y-2 flex-1">
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground">Customer</p>
                    <p>{selectedRequest.customerName} ({selectedRequest.customerPhone})</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground">Description</p>
                    <p className="text-sm whitespace-pre-wrap">{selectedRequest.description}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Requested on: {new Date(selectedRequest.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-semibold border-b pb-2">Update Status & Admin Notes</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={updateForm.status} onValueChange={(v: any) => setUpdateForm({ ...updateForm, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pending">Pending</SelectItem>
                        <SelectItem value="Reviewing">Reviewing</SelectItem>
                        <SelectItem value="Sourced">Sourced</SelectItem>
                        <SelectItem value="Rejected">Rejected</SelectItem>
                        <SelectItem value="Completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Linked Product ID</Label>
                    <Input 
                      placeholder="e.g. clg123xyz..." 
                      value={updateForm.linkedProductId} 
                      onChange={(e) => setUpdateForm({ ...updateForm, linkedProductId: e.target.value })} 
                    />
                    <p className="text-xs text-muted-foreground">Optional: Paste internal Product ID if matched</p>
                  </div>
                </div>

                {updateForm.status === "Rejected" && (
                  <div className="space-y-2">
                    <Label>Rejection Reason</Label>
                    <Input 
                      placeholder="e.g. Item out of print / Cannot source" 
                      value={updateForm.rejectionReason} 
                      onChange={(e) => setUpdateForm({ ...updateForm, rejectionReason: e.target.value })} 
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Internal Admin Notes</Label>
                  <Textarea 
                    placeholder="Notes for other staff members..." 
                    value={updateForm.adminNote} 
                    onChange={(e) => setUpdateForm({ ...updateForm, adminNote: e.target.value })} 
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUpdateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={loading}>{loading ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
