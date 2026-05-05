import { redirect } from "next/navigation";
import { getStaffAuthDetails } from "@/server/modules/staff-auth";
import SrPortalLayout from "./sr-portal-layout";

export const dynamic = "force-dynamic";

export default async function SrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getStaffAuthDetails();

  if (auth.status === "blocked") {
    redirect("/unauthorized");
  }

  if (!auth.staff) {
    redirect("/sign-in");
  }

  // Only Sales Representatives, Admins, and Managers can access SR portal
  const role = auth.staff.role;
  if (
    role !== "Sales Representative" && 
    role !== "SalesRepresentative" &&
    role !== "Admin" &&
    role !== "Manager"
  ) {
    redirect("/dashboard");
  }

  return <SrPortalLayout staff={auth.staff}>{children}</SrPortalLayout>;
}
