
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { processWholesaleApproval } from "@/services/wholesale";
import { CheckCircle2, XCircle, Eye, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

export default function WholesaleQueueClient({ initialQueue }: { initialQueue: any[] }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [actionType, setActionType] = useState<'Approve' | 'Reject' | 'EditAndApprove'>('Approve');
  const [note, setNote] = useState("");
  const router = useRouter();
  const { toast } = useToast();

  const handleOpenDialog = (order: any, type: 'Approve' | 'Reject' | 'EditAndApprove') => {
    if (type === 'EditAndApprove') {
      window.open(`/dashboard/orders/${order.id}?mode=wholesale-review`, '_blank');
      return;
    }
    setSelectedOrder(order);
    setActionType(type);
    setNote("");
    setIsDialogOpen(true);
  };

  const handleProcess = async () => {
    if (!note) {
      toast({ variant: "destructive", title: "Error", description: "Please provide a review note" });
      return;
    }

    try {
      await processWholesaleApproval({
        orderId: selectedOrder.id,
        action: actionType === 'Approve' ? 'Approved' : actionType === 'EditAndApprove' ? 'EditAndApprove' : 'Rejected',
        note,
      });

      let successMsg = "";
      if (actionType === 'Approve') successMsg = "Order approved successfully";
      else if (actionType === 'EditAndApprove') successMsg = "Order edited and approved successfully";
      else successMsg = "Order rejected successfully";

      toast({ title: "Success", description: successMsg });
      setIsDialogOpen(false);
      router.refresh();
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to process approval" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Order #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Detected By</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialQueue.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Queue is empty. No pending wholesale approvals.
                </TableCell>
              </TableRow>
            ) : (
              initialQueue.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono font-medium">
                    #{order.orderNumber}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{order.customerName}</div>
                    <div className="text-xs text-muted-foreground">{order.customerPhone}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold">{order.total} BDT</div>
                  </TableCell>
                  <TableCell>
                    {order.WholesaleRule ? (
                      <Badge variant="outline" className="flex items-center gap-1 w-fit bg-yellow-50 text-yellow-700 border-yellow-200">
                        <AlertCircle className="h-3 w-3" />
                        {order.WholesaleRule.name}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Manual</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {format(new Date(order.createdAt), "MMM d, h:mm a")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => window.open(`/dashboard/orders/${order.id}`, '_blank')}>
                        <Eye className="mr-1 h-3 w-3" /> View
                      </Button>
                      <Button variant="outline" size="sm" className="border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => handleOpenDialog(order, 'EditAndApprove')}>
                        Edit & Approve
                      </Button>
                      <Button variant="default" size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleOpenDialog(order, 'Approve')}>
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleOpenDialog(order, 'Reject')}>
                        <XCircle className="mr-1 h-3 w-3" /> Reject
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
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {actionType === 'Approve' ? 'Approve Wholesale Order' : actionType === 'EditAndApprove' ? 'Edit & Approve Wholesale Order' : 'Reject Wholesale Order'}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'Approve'
                ? "Confirm wholesale pricing and conditions for this order."
                : actionType === 'EditAndApprove'
                ? "This marks the order as manually adjusted and approved for wholesale."
                : "Reject this order as wholesale. It will remain in the wholesale module but marked as Rejected."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="note">Review Note <span className="text-red-500">*</span></Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Mandatory note for audit trail..."
                required
              />
              <p className="text-[10px] text-muted-foreground">Notes are required for all review actions.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button
              variant={actionType === 'Reject' ? "destructive" : "default"}
              className={(actionType === 'Approve' || actionType === 'EditAndApprove') ? "bg-green-600 hover:bg-green-700" : ""}
              onClick={handleProcess}
            >
              Confirm {actionType === 'EditAndApprove' ? 'Edit & Approve' : actionType}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
