'use client';

import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';

export function InvoicePrintButton() {
    return (
        <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print Invoice
        </Button>
    );
}
