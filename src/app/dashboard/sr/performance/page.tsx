import { Suspense } from "react";
import { srGetMyPerformance } from "@/services/sr-performance";
import { 
  TrendingUp, 
  Target, 
  Award, 
  History, 
  AlertCircle,
  CheckCircle2,
  Clock,
  Ban
} from "lucide-react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function SrPerformancePage() {
  const summary = await srGetMyPerformance();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Performance & Earnings</h1>
        <p className="text-muted-foreground">
          Track your targets, commissions, and performance metrics.
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Confirmed Earnings</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">৳{summary.commissions.confirmed.total.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              From {summary.commissions.confirmed.count} payments
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Commissions</CardTitle>
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">৳{summary.commissions.accrued.total.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Awaiting order delivery/settlement
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Targets Completed</CardTitle>
            <Award className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.completedTargetsCount}</div>
            <p className="text-xs text-muted-foreground">
              Lifetime total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Voided/Returned</CardTitle>
            <Ban className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">৳{summary.commissions.voided.total.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              From {summary.commissions.voided.count} instances
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-7">
        {/* Active Targets */}
        <Card className="md:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Active Targets
            </CardTitle>
            <CardDescription>
              Your current goals and progress toward incentives.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {summary.activeTargets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg">
                <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No active targets assigned at the moment.</p>
              </div>
            ) : (
              summary.activeTargets.map((target) => {
                const progress = Math.min(
                  Math.round((target.currentValue / target.targetValue) * 100),
                  100
                );
                const isSalesAmount = target.type === "SalesAmount";
                
                return (
                  <div key={target.id} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="font-semibold">{target.title}</div>
                        <div className="text-xs text-muted-foreground">
                          Ends {format(new Date(target.endDate), "MMM d, yyyy")}
                        </div>
                      </div>
                      <Badge variant="outline" className="font-mono">
                        {progress}%
                      </Badge>
                    </div>
                    <Progress value={progress} className="h-2" />
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {isSalesAmount ? "৳" : ""}{target.currentValue.toLocaleString()} / {isSalesAmount ? "৳" : ""}{target.targetValue.toLocaleString()} {isSalesAmount ? "" : "Units"}
                      </span>
                      <span className="font-medium text-primary">
                        {target.IncentivePolicy?.name || "No policy"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Recent Commissions */}
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Recent Earnings
            </CardTitle>
            <CardDescription>
              Last 20 commission records.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {summary.recentCommissions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No earnings recorded yet.</p>
              ) : (
                summary.recentCommissions.map((log) => (
                  <div key={log.id} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">
                        {log.orderNumber ? `#${log.orderNumber}` : "Target Bonus"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(log.accrualDate), "MMM d, HH:mm")}
                      </div>
                    </div>
                    <div className="text-right space-y-1">
                      <div className="text-sm font-bold text-green-600 dark:text-green-400">
                        +৳{log.commissionAmount.toLocaleString()}
                      </div>
                      <Badge variant={log.status === "Confirmed" ? "default" : log.status === "Voided" ? "destructive" : "secondary"} className="text-[10px] h-4 px-1">
                        {log.status}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Target History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Target History
          </CardTitle>
          <CardDescription>
            Past performance and expired/completed targets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Achieved</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Ends</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.targetHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No target history found.</td>
                  </tr>
                ) : (
                  summary.targetHistory.map((target) => (
                    <tr key={target.id}>
                      <td className="px-4 py-3 font-medium">{target.title}</td>
                      <td className="px-4 py-3">
                        <Badge variant={target.status === "Completed" ? "default" : "secondary"}>
                          {target.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{target.currentValue.toLocaleString()}</td>
                      <td className="px-4 py-3">{target.targetValue.toLocaleString()}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(new Date(target.endDate), "MMM d, yyyy")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
