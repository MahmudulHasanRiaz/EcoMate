import { Metadata } from "next";
import { TransactionsClientPage } from "./client-page";
import { getStaffAuthDetails } from '@server/modules/staff-auth';
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Order Transactions | Admin",
};

export default async function TransactionsPage() {
  const result = await getStaffAuthDetails();
  if (result.status !== 'ok') {
      redirect('/auth/login');
  }

  return <TransactionsClientPage />;
}
