import { Suspense } from 'react';
import ProductLabelsBulkClient from './client-page';

export const dynamic = 'force-dynamic';

export default function ProductLabelsBulkPage() {
  return (
    <Suspense fallback={<div>Loading labels...</div>}>
      <ProductLabelsBulkClient />
    </Suspense>
  );
}
