import { Suspense } from 'react';
import BulkPrintClient from './client-page';

export const dynamic = 'force-dynamic';

export default function BulkPrintPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <BulkPrintClient />
        </Suspense>
    );
}
