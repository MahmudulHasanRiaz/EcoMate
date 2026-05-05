import { Metadata } from "next";
import { checkPermission } from "@/lib/security";
import { redirect } from "next/navigation";
import { adminListTargets, adminListPolicies, adminGetSrLeaderboard } from "@/services/sr-performance";
import SrPerformanceClient from "./sr-performance-client";

export const metadata: Metadata = {
  title: "SR Performance Management | ecomate",
};

export default async function SrPerformancePage() {
  const { allowed } = await checkPermission("wholesaleManagement", "update");
  if (!allowed) redirect("/unauthorized");

  const [targets, policies, leaderboard] = await Promise.all([
    adminListTargets(),
    adminListPolicies(),
    adminGetSrLeaderboard(),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">SR Performance Management</h1>
        <p className="text-muted-foreground">
          Manage targets, incentive policies, and track SR performance.
        </p>
      </div>

      <SrPerformanceClient
        initialTargets={targets}
        initialPolicies={policies}
        initialLeaderboard={leaderboard}
      />
    </div>
  );
}
