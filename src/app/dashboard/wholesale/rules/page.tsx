
import { Metadata } from "next";
import WholesaleRulesClient from "./rules-client";
import { getWholesaleRules } from "@/services/wholesale";
import { checkPermission } from "@/lib/security";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Wholesale Qualification Rules | ecomate",
};

export default async function WholesaleRulesPage() {
  const { allowed } = await checkPermission('wholesaleManagement', 'read');
  if (!allowed) redirect('/unauthorized');

  const rules = await getWholesaleRules();

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wholesale Rules</h1>
          <p className="text-muted-foreground">
            Configure rules to automatically classify orders as wholesale.
          </p>
        </div>
      </div>

      <WholesaleRulesClient initialRules={rules} />
    </div>
  );
}
