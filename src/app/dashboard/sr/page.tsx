import { getStaffAuthDetails } from "@/server/modules/staff-auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, ShoppingCart, Users, Target, DollarSign, Award } from "lucide-react";
import { getSrPerformanceSummary, recalculateAllActiveTargets } from "@/server/modules/sr-performance";

export const dynamic = "force-dynamic";

export default async function SrDashboardPage() {
  const auth = await getStaffAuthDetails();
  if (auth.status !== "ok") {
    return (
      <div className="p-6 text-center">
        <h1 className="text-xl font-semibold text-destructive">Access Denied</h1>
        <p className="text-muted-foreground">Please sign in to access the SR Portal.</p>
      </div>
    );
  }
  const staffId = auth.staff.id;

  // Get SR's order stats
  const [orderStats, customerCount] = await Promise.all([
    prisma.order.aggregate({
      where: {
        salesRepresentativeId: staffId,
        channel: "Wholesale",
      },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.customer.count({
      where: {
        Order: {
          some: {
            salesRepresentativeId: staffId,
          },
        },
      },
    }),
  ]);

  const totalOrders = orderStats._count._all;
  const totalRevenue = orderStats._sum.total || 0;

  // Phase 7: Get performance data
  await recalculateAllActiveTargets(staffId);
  const performance = await getSrPerformanceSummary(staffId);

  const topTarget = performance.activeTargets[0];
  const topTargetPct = topTarget && topTarget.targetValue > 0
    ? Math.min(100, Math.round((topTarget.currentValue / topTarget.targetValue) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sales Representative Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <ShoppingCart className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Orders</p>
                <p className="text-xl font-bold">{totalOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Revenue</p>
                <p className="text-xl font-bold">৳{(totalRevenue / 1000).toFixed(1)}K</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">My Customers</p>
                <p className="text-xl font-bold">{customerCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Target className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Target Progress</p>
                <p className="text-xl font-bold">
                  {topTarget ? `${topTargetPct}%` : "No Target"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Phase 7: Active Targets */}
      {performance.activeTargets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-amber-500" /> Active Targets
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {performance.activeTargets.map((t: any) => {
              const pct = t.targetValue > 0
                ? Math.min(100, Math.round((t.currentValue / t.targetValue) * 100))
                : 0;
              return (
                <div key={t.id} className="space-y-2 p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.type === "SalesAmount" ? "Sales Amount" : "Quantity"} •{" "}
                        {new Date(t.startDate).toLocaleDateString()} – {new Date(t.endDate).toLocaleDateString()}
                      </p>
                    </div>
                    {t.IncentivePolicy && (
                      <Badge variant="outline" className="text-xs">
                        {t.IncentivePolicy.incentiveType === "CommissionRate"
                          ? `${t.IncentivePolicy.value}% commission`
                          : `৳${t.IncentivePolicy.value} bonus`}
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>
                        {t.type === "SalesAmount"
                          ? `৳${t.currentValue.toLocaleString()} / ৳${t.targetValue.toLocaleString()}`
                          : `${t.currentValue} / ${t.targetValue}`}
                      </span>
                      <span className="font-semibold">{pct}%</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Phase 7: Earnings Summary */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Confirmed Earnings</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                  ৳{performance.commissions.confirmed.total.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <DollarSign className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Earnings</p>
                <p className="text-xl font-bold text-amber-600 dark:text-amber-400">
                  ৳{performance.commissions.accrued.total.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Award className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Targets Completed</p>
                <p className="text-xl font-bold">{performance.completedTargetsCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Commission Log */}
      {performance.recentCommissions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-500" /> Recent Commission Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {performance.recentCommissions.slice(0, 10).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-2 rounded border text-sm">
                  <div>
                    <p className="font-medium">{c.accrualNote || `Commission on order`}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(c.accrualDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">৳{c.commissionAmount.toLocaleString()}</span>
                    <Badge
                      className={
                        c.status === "Confirmed"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : c.status === "Voided"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                      }
                    >
                      {c.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <a
            href="/dashboard/sr/orders/new"
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="p-2 rounded-lg bg-primary/10">
              <ShoppingCart className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">Create New Order</p>
              <p className="text-sm text-muted-foreground">Browse catalog and place order</p>
            </div>
          </a>
          <a
            href="/dashboard/sr/customers"
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="font-medium">Manage Customers</p>
              <p className="text-sm text-muted-foreground">View or add wholesale customers</p>
            </div>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
