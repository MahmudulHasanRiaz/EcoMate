import { getSession } from "@/services/wholesale-portal";
import { redirect } from "next/navigation";
import WholesaleLoginClient from "./login-client";

export default async function WholesaleLoginPage() {
  const session = await getSession();
  if (session) redirect("/wholesale");

  return <WholesaleLoginClient />;
}
