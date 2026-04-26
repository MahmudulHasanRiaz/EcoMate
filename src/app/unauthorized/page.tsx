'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useEffect } from 'react';

export default function UnauthorizedPage() {
  useEffect(() => {
    // Attempt to auto-clean any uninvited account
    fetch('/api/auth/cleanup', { method: 'POST' }).catch((err) =>
      console.warn('[UNAUTHORIZED] cleanup failed', err),
    );
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangle className="h-12 w-12 text-destructive" />
      <h1 className="text-2xl font-bold">Access denied</h1>
      <p className="text-muted-foreground max-w-md">
        You need a valid staff invite to sign in. Please contact an admin to get an invitation.
      </p>
      <Card className="max-w-lg text-left">
        <CardHeader className="flex flex-row items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-amber-500" />
          <div>
            <CardTitle className="text-base">How to get access</CardTitle>
            <CardDescription>Follow these steps to continue.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex gap-2">
            <span className="font-semibold text-foreground">1.</span>
            <span>Ask an admin/manager to send you a staff invitation to this email address.</span>
          </div>
          <Separator />
          <div className="flex gap-2">
            <span className="font-semibold text-foreground">2.</span>
            <span>Open the invite email, accept it, and then sign in again.</span>
          </div>
          <Separator />
          <div className="flex gap-2">
            <span className="font-semibold text-foreground">3.</span>
            <span>If you think this is a mistake, reach out to support with your email/phone.</span>
          </div>
        </CardContent>
      </Card>
      <Button asChild variant="outline">
        <Link href="/sign-in">Back to Sign In</Link>
      </Button>
    </div>
  );
}
