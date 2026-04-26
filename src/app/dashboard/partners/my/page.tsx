import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getPartnerById, getPurchaseOrdersByPartner } from "@/services/partners";
import { format } from "date-fns";
import Link from "next/link";
import { PurchaseOrder } from "@/types";

type PageProps = {
  searchParams: Promise<{ partnerId?: string }>;
};

function Summary({ orders }: { orders: PurchaseOrder[] }) {
  const totals = orders.reduce(
    (acc, po) => {
      acc.count += 1;
      acc.total += po.total;
      const paid =
        (po.payment?.cash || 0) + (po.payment?.check || 0) +
        (po.fabricPayment?.cash || 0) + (po.fabricPayment?.check || 0) +
        (po.printingPayment?.cash || 0) + (po.printingPayment?.check || 0) +
        (po.cuttingPayment?.cash || 0) + (po.cuttingPayment?.check || 0);
      acc.paid += paid;
      acc.due += Math.max(po.total - paid, 0);
      return acc;
    },
    { count: 0, total: 0, paid: 0, due: 0 }
  );

  const fmt = (v: number) =>
    `Tk ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Total POs</p>
          <p className="text-xl font-bold">{totals.count}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total Value</p>
          <p className="text-xl font-bold">{fmt(totals.total)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Paid / Due</p>
          <p className="text-lg font-bold">
            {fmt(totals.paid)} <span className="text-muted-foreground">/</span> <span className="text-destructive">{fmt(totals.due)}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

async function PartnerOrders({ partnerId }: { partnerId: string }) {
  const partner = await getPartnerById(partnerId);
  if (!partner) {
    notFound();
  }
  const orders = await getPurchaseOrdersByPartner(partner.name);

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{partner.name}</h1>
        <p className="text-muted-foreground">
          Partner self-view · showing purchase orders assigned to you.
        </p>
      </div>

      <Summary orders={orders} />

      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {orders.length === 0 && (
            <div className="text-sm text-muted-foreground">No purchase orders found for this partner.</div>
          )}
          {orders.map((po) => (
            <div key={po.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Link href={`/dashboard/purchases/${po.id}`} className="font-semibold hover:underline">
                    {po.id}
                  </Link>
                  <p className="text-xs text-muted-foreground">{format(new Date(po.date), "PPP")}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline">{po.type === "general" ? "General" : "3-Piece"}</Badge>
                  <Badge variant="outline">{po.paymentStatus}</Badge>
                  <Badge variant="outline">{po.status}</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-muted-foreground">Supplier</p>
                  <p className="font-medium">{po.supplier}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Total</p>
                  <p className="font-semibold">
                    Tk {po.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="text-xs text-muted-foreground">
                You can view details and uploads, but only your own bills are visible.
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default async function PartnerSelfPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const partnerId = sp.partnerId;
  if (!partnerId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Provide <code>?partnerId=</code> in the URL to view your orders.
        </p>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading partner orders...</div>}>
      <PartnerOrders partnerId={partnerId} />
    </Suspense>
  );
}
