import { Suspense } from 'react';
import BulkInvoicePrintClient from './client-page';

export const dynamic = 'force-dynamic';

export default function BulkInvoicePrintPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <BulkInvoicePrintClient />
        </Suspense>
    );
}
