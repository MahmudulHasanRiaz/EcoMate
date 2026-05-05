import { Metadata } from "next";
import { getPricingRules, getSrDiscountPolicies } from "@/services/wholesale-pricing";
import PricingSettingsClient from "./pricing-client";
import { checkPermission } from "@/lib/security";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Wholesale Pricing Settings | ecomate",
};

export default async function PricingSettingsPage() {
  const { allowed } = await checkPermission("wholesaleManagement", "update");
  if (!allowed) redirect("/unauthorized");

  const [rules, policies] = await Promise.all([
    getPricingRules(),
    getSrDiscountPolicies(),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Wholesale Pricing</h1>
        <p className="text-muted-foreground">
          Manage pricing rules, discount tiers, and SR policies.
        </p>
      </div>

      <PricingSettingsClient initialRules={rules} initialPolicies={policies} />
    </div>
  );
}
