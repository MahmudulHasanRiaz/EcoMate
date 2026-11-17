import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  fetchPublicPlans,
  trialCtaCopy,
  trialDaysForPlans,
} from '@/lib/plans';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  // Trial length comes from the live plan list, never a hardcoded number.
  // The fetch never throws; a downed API just yields the dateless copy.
  const plans = await fetchPublicPlans();
  const trialDays = trialDaysForPlans(
    plans,
    process.env.NEXT_PUBLIC_TRIAL_DAYS,
  );
  const cta = trialCtaCopy(trialDays);
  return {
    title: 'EcoMate — a commerce workspace you own',
    description: `Launch your storefront, run orders and inventory, and keep your data. ${cta}.`,
  };
}

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
