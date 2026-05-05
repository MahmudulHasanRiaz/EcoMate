"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Package, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";

type OrderItem = {
  name: string;
  quantity: number;
  price: number;
};

type Transaction = {
  amount: number;
  method: string;
  createdAt: Date;
};

type Order = {
  id: string;
  orderNumber: string | null;
  status: string;
  wholesaleApprovalStatus: string | null;
  total: number;
  discount: number;
  shipping: number;
  paidAmount: number;
  due: number;
  date: Date;
  items: OrderItem[];
  transactions: Transaction[];
};

function getStatusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: any; label: string }> = {
    New: { variant: "default", icon: Clock, label: "New" },
    Confirmed: { variant: "secondary", icon: CheckCircle, label: "Confirmed" },
    Delivered: { variant: "default", icon: CheckCircle, label: "Delivered" },
    Canceled: { variant: "destructive", icon: XCircle, label: "Cancelled" },
    Shipped: { variant: "secondary", icon: Package, label: "Shipped" },
    In_Courier: { variant: "secondary", icon: Package, label: "In Courier" },
    Hold: { variant: "outline", icon: AlertCircle, label: "Hold" },
    Return_Pending: { variant: "outline", icon: AlertCircle, label: "Return Pending" },
    Returned: { variant: "outline", icon: XCircle, label: "Returned" },
  };
  const info = map[status] || { variant: "outline" as const, icon: Package, label: status.replace(/_/g, " ") };
  const Icon = info.icon;
  return (
    <Badge variant={info.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {info.label}
    </Badge>
  );
}

function getApprovalBadge(status: string | null) {
  if (!status) return null;
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    Pending: "outline",
    Approved: "default",
    Rejected: "destructive",
    EditedApproved: "secondary",
  };
  return (
    <Badge variant={map[status] || "outline"} className="ml-2">
      {status}
    </Badge>
  );
}

export default function WholesaleOrdersClient({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return (
      <div className="text-center py-20 space-y-4">
        <Package className="h-16 w-16 mx-auto text-muted-foreground" />
        <h2 className="text-xl font-semibold">No orders yet</h2>
        <p className="text-muted-foreground">Your wholesale orders will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Orders</h1>

      <div className="space-y-4">
        {orders.map((order) => (
          <Card key={order.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">
                    #{order.orderNumber || order.id.slice(-8)}
                  </CardTitle>
                  {getStatusBadge(order.status)}
                  {getApprovalBadge(order.wholesaleApprovalStatus)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {order.date ? format(new Date(order.date), "dd MMM yyyy, hh:mm a") : "—"}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Items */}
              <div className="space-y-1">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span>
                      {item.name} × {item.quantity}
                    </span>
                    <span>৳{(item.price * item.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              <Separator />

              {/* Totals */}
              <div className="space-y-1 text-sm">
                {order.discount > 0 && (
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Discount</span>
                    <span>-৳{order.discount.toLocaleString()}</span>
                  </div>
                )}
                {order.shipping > 0 && (
                  <div className="flex justify-between">
                    <span>Shipping</span>
                    <span>৳{order.shipping.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span>৳{order.total.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Paid</span>
                  <span className="text-green-600 dark:text-green-400">৳{order.paidAmount.toLocaleString()}</span>
                </div>
                {order.due > 0 && (
                  <div className="flex justify-between">
                    <span>Due</span>
                    <span className="text-destructive">৳{order.due.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Transactions */}
              {order.transactions.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Payments</p>
                    {order.transactions.map((t, idx) => (
                      <div key={idx} className="flex justify-between text-xs text-muted-foreground">
                        <span>{t.method} — {format(new Date(t.createdAt), "dd MMM yyyy")}</span>
                        <span>৳{t.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
