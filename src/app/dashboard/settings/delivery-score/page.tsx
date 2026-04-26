'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    apiKey: z.string().default(''),
    referer: z.string().default(''),
  })
  .superRefine((val, ctx) => {
    if (val.enabled && !val.apiKey.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message: 'API Key is required when enabled.',
      });
    }
  });

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function DeliveryScoreSettingsPage() {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const settingsForm = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      enabled: true,
      apiKey: '',
      referer: '',
    },
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/settings/delivery-score', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        settingsForm.reset({
          enabled: Boolean(data?.enabled ?? true),
          apiKey: String(data?.apiKey || ''),
          referer: String(data?.referer || ''),
        });
      } catch {
        // ignore
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [settingsForm]);

  async function onSubmit(values: SettingsFormValues) {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/delivery-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: values.enabled,
          apiKey: values.apiKey,
          referer: values.referer,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Save failed',
          description: payload?.error || 'Failed to save settings',
          variant: 'destructive',
        });
        return;
      }

      settingsForm.reset({
        enabled: Boolean(payload?.enabled ?? values.enabled),
        apiKey: String(payload?.apiKey || values.apiKey),
        referer: String(payload?.referer || values.referer),
      });

      toast({
        title: 'Settings Saved',
        description: 'Your Hoorin Courier Search settings have been saved.',
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Delivery Score Settings</h2>
        <p className="text-muted-foreground">
          Configure the API key for the Hoorin Courier Search service and manage related features.
        </p>
      </div>

      <Card>
        <Form {...settingsForm}>
          <form onSubmit={settingsForm.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle>API Configuration</CardTitle>
              <CardDescription>
                Enter your API key from the Hoorin Dash portal. The key is stored server-side and never exposed to
                staff.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={settingsForm.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••••••••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={settingsForm.control}
                name="referer"
                render={({ field }) => (
                  <FormItem className="mt-4">
                    <FormLabel>Referer (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://your-domain.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardContent>
              <Button type="submit" disabled={isSaving || isLoading}>
                {isSaving ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardContent>
          </form>
        </Form>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Feature Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-row items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="enable-report-page" className="text-base">
                Enable Courier Report Page
              </Label>
              <p className="text-sm text-muted-foreground">
                Temporarily pause courier report lookups to avoid API key misuse.
              </p>
            </div>
            <FormField
              control={settingsForm.control}
              name="enabled"
              render={({ field }) => (
                <Switch
                  id="enable-report-page"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

