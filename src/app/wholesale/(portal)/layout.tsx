import { getSession } from "@/services/wholesale-portal";
import { redirect } from "next/navigation";
import WholesalePortalLayout from "./portal-layout";

export default async function WholesaleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/wholesale/login");

  return <WholesalePortalLayout session={session}>{children}</WholesalePortalLayout>;
}
