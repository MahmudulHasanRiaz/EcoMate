import { getSrOrders } from "@/services/sr-portal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Package, Clock, CheckCircle, XCircle } from "lucide-react";

function getStatusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
    New: { variant: "default", icon: Clock },
    Confirmed: { variant: "secondary", icon: CheckCircle },
    Delivered: { variant: "default", icon: CheckCircle },
    Canceled: { variant: "destructive", icon: XCircle },
  };
  const info = map[status] || { variant: "outline", icon: Package };
  const Icon = info.icon;
  return (
    <Badge variant={info.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}

export const dynamic = "force-dynamic";

export default async function SrOrdersPage() {
  const orders = await getSrOrders();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Orders</h1>
        <a
          href="/dashboard/sr/orders/new"
          className="inline-flex items-center gap-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          + New Order
        </a>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No orders yet. Start by creating a new order.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((order: any) => (
            <Card key={order.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">#{order.orderNumber}</span>
                      {getStatusBadge(order.status)}
                      {order.wholesaleApprovalStatus && (
                        <Badge variant="outline">{order.wholesaleApprovalStatus}</Badge>
                      )}
                    </div>
                    {order.customer && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {order.customer.name} · {order.customer.phone}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {order.date ? format(new Date(order.date), "dd MMM yyyy, hh:mm a") : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">৳{order.total.toLocaleString()}</p>
                    {order.due > 0 ? (
                      <p className="text-xs text-destructive">Due: ৳{order.due.toLocaleString()}</p>
                    ) : (
                      <p className="text-xs text-green-600 dark:text-green-400">Paid</p>
                    )}
                  </div>
                </div>

                {/* Items summary */}
                <div className="mt-3 pt-3 border-t text-sm text-muted-foreground">
                  {order.items.map((item: any, idx: number) => (
                    <span key={idx}>
                      {item.name} × {item.quantity}
                      {idx < order.items.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
