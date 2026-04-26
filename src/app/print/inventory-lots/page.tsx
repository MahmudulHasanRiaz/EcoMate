import { Suspense } from 'react';
import InventoryLotPrintClient from './client-page';

export const dynamic = 'force-dynamic';

export default function InventoryLotPrintPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <InventoryLotPrintClient />
    </Suspense>
  );
}
