
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Ban } from 'lucide-react';

export function UnauthorizedAccessModal() {
  const router = useRouter();

  return (
    <AlertDialog open={true}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                    <Ban className="h-6 w-6 text-destructive" />
                    Access Denied
                </AlertDialogTitle>
                <AlertDialogDescription>
                    You do not have permission to view this page. You will be redirected to the dashboard.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex justify-end">
                 <Button onClick={() => router.replace('/dashboard')}>
                    Go to Dashboard
                </Button>
            </div>
        </AlertDialogContent>
    </AlertDialog>
  );
}
