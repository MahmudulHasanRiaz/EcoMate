
'use client';

import * as React from 'react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ORDER_STATUSES } from '@/lib/order-statuses';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
    NotificationSettings,
    ORDER_VARIABLES,
    PURCHASE_VARIABLES,
    STAFF_VARIABLES,
    STAFF_FINE_VARIABLES,
    PARTNER_VARIABLES,
    PURCHASE_STATUSES,
} from '@/lib/notification-defaults';

type TemplateKey = 'enabled' | 'smsEnabled' | 'smsBody' | 'emailEnabled' | 'emailBody';

function TemplateEditor({
    title,
    template,
    variables,
    onChange,
}: {
    title: string;
    template: { enabled: boolean; smsEnabled: boolean; smsBody: string; emailEnabled: boolean; emailBody: string };
    variables: { name: string; value: string }[];
    onChange: (field: TemplateKey, value: boolean | string) => void;
}) {
    return (
        <AccordionContent>
            <div className="grid gap-6">
                <div className="grid gap-3 rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-4">
                        <div className="space-y-0.5">
                            <Label>Enable</Label>
                            <p className="text-xs text-muted-foreground">Turn on/off notifications for this status.</p>
                        </div>
                        <Switch checked={template.enabled} onCheckedChange={(v) => onChange('enabled', v)} />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <div className="space-y-0.5">
                            <Label>SMS</Label>
                            <p className="text-xs text-muted-foreground">Send SMS using the template below.</p>
                        </div>
                        <Switch
                            checked={template.smsEnabled}
                            onCheckedChange={(v) => onChange('smsEnabled', v)}
                            disabled={!template.enabled}
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <div className="space-y-0.5">
                            <Label>Email</Label>
                            <p className="text-xs text-muted-foreground">Optional email template.</p>
                        </div>
                        <Switch
                            checked={template.emailEnabled}
                            onCheckedChange={(v) => onChange('emailEnabled', v)}
                            disabled={!template.enabled}
                        />
                    </div>
                </div>

                <div className="grid gap-2">
                    <Label>SMS Template</Label>
                    <Textarea
                        value={template.smsBody}
                        onChange={(e) => onChange('smsBody', e.target.value)}
                        disabled={!template.enabled || !template.smsEnabled}
                    />
                </div>
                <div className="grid gap-2">
                    <Label>Email Template</Label>
                    <Textarea
                        value={template.emailBody}
                        rows={4}
                        onChange={(e) => onChange('emailBody', e.target.value)}
                        disabled={!template.enabled || !template.emailEnabled}
                    />
                </div>
                <div>
                    <p className="text-sm font-medium">Available Variables</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {variables.map((v) => (
                            <Badge key={v.value} variant="secondary" className="font-mono">
                                {v.value}
                            </Badge>
                        ))}
                    </div>
                </div>
            </div>
        </AccordionContent>
    );
}

const humanize = (value: string) =>
    value
        .replace(/([A-Z])/g, ' $1')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export default function NotificationsSettingsPage() {
    const { toast } = useToast();
    const [settings, setSettings] = useState<NotificationSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/api/settings/notifications');
                const data = await res.json();
                setSettings(data);
            } catch (err) {
                console.error('[NOTIFICATION_SETTINGS_LOAD]', err);
                toast({
                    variant: 'destructive',
                    title: 'Failed to load',
                    description: 'Could not load notification settings.',
                });
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [toast]);

    const handleChange = (
        section: 'orders' | 'purchases' | 'staff' | 'partners',
        key: string,
        field: TemplateKey,
        value: boolean | string,
    ) => {
        setSettings((prev) => {
            if (!prev) return prev;
            const next = { ...prev };
            if (section === 'staff') {
                next.staff = {
                    ...next.staff,
                    [key]: {
                        ...(next.staff as any)[key],
                        [field]: value,
                    },
                };
            } else if (section === 'partners') {
                next.partners = {
                    ...next.partners,
                    [key]: {
                        ...(next.partners as any)[key],
                        [field]: value,
                    },
                };
            } else {
                const bucket = { ...(next as any)[section] };
                bucket[key] = {
                    ...(bucket[key] || {}),
                    [field]: value,
                };
                (next as any)[section] = bucket;
            }
            return next;
        });
    };

    const handleSave = async () => {
        if (!settings) return;
        setSaving(true);
        try {
            const res = await fetch('/api/settings/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to save');
            }
            toast({ title: 'Saved', description: 'Notification settings updated.' });
        } catch (err) {
            console.error('[NOTIFICATION_SETTINGS_SAVE]', err);
            toast({
                variant: 'destructive',
                title: 'Save failed',
                description: 'Could not save notification settings.',
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="text-sm text-muted-foreground">Loading notification settings...</div>;
    }

    if (!settings) {
        return <div className="text-sm text-muted-foreground">No settings found.</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Notification Settings</h2>
                    <p className="text-muted-foreground">
                        Customize SMS and Email templates for various events.
                    </p>
                </div>
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save All'}
                </Button>
            </div>

            <Tabs defaultValue="orders">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="orders">Order Status</TabsTrigger>
                    <TabsTrigger value="purchases">Purchases</TabsTrigger>
                    <TabsTrigger value="staff">Staff</TabsTrigger>
                    <TabsTrigger value="partners">Partners</TabsTrigger>
                </TabsList>

                <TabsContent value="orders">
                    <Card>
                        <CardHeader>
                            <CardTitle>Customer Order Notifications</CardTitle>
                            <CardDescription>
                                Templates for automated messages when order status changes.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Accordion type="single" collapsible className="w-full">
                                {Object.keys(settings.orders).map((status) => (
                                    <AccordionItem value={status} key={status}>
                                        <AccordionTrigger>{humanize(status)}</AccordionTrigger>
                                        <TemplateEditor
                                            title={status}
                                            template={settings.orders[status]}
                                            variables={ORDER_VARIABLES}
                                            onChange={(field, value) => handleChange('orders', status, field, value)}
                                        />
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="purchases">
                    <Card>
                        <CardHeader>
                            <CardTitle>Purchase Order Notifications</CardTitle>
                            <CardDescription>Messages to suppliers or vendors for PO updates.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Accordion type="single" collapsible className="w-full">
                                {PURCHASE_STATUSES.map((status) => (
                                    <AccordionItem value={status} key={status}>
                                        <AccordionTrigger>{humanize(status)}</AccordionTrigger>
                                        <TemplateEditor
                                            title={status}
                                            template={settings.purchases[status]}
                                            variables={PURCHASE_VARIABLES}
                                            onChange={(field, value) => handleChange('purchases', status, field, value)}
                                        />
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="staff">
                    <Card>
                        <CardHeader>
                            <CardTitle>Staff Notifications</CardTitle>
                            <CardDescription>Templates for messages sent to staff members for payments and fines.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Accordion type="single" collapsible className="w-full">
                                <AccordionItem value="payment-cleared">
                                    <AccordionTrigger>Payment Cleared</AccordionTrigger>
                                    <TemplateEditor
                                        title="Payment Cleared"
                                        template={settings.staff.paymentCleared}
                                        variables={STAFF_VARIABLES}
                                        onChange={(field, value) => handleChange('staff', 'paymentCleared', field, value)}
                                    />
                                </AccordionItem>
                                <AccordionItem value="fine-recorded">
                                    <AccordionTrigger>Fine Recorded</AccordionTrigger>
                                    <TemplateEditor
                                        title="Fine Recorded"
                                        template={settings.staff.fineRecorded}
                                        variables={STAFF_FINE_VARIABLES}
                                        onChange={(field, value) => handleChange('staff', 'fineRecorded', field, value)}
                                    />
                                </AccordionItem>
                            </Accordion>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="partners">
                    <Card>
                        <CardHeader>
                            <CardTitle>Partner Notifications</CardTitle>
                            <CardDescription>Templates for automated messages related to supplier and vendor bills/payments.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Accordion type="single" collapsible className="w-full">
                                <AccordionItem value="payment-received">
                                    <AccordionTrigger>Partner Payment</AccordionTrigger>
                                    <TemplateEditor
                                        title="Partner Payment"
                                        template={settings.partners.paymentReceived}
                                        variables={PARTNER_VARIABLES}
                                        onChange={(field, value) => handleChange('partners', 'paymentReceived', field, value)}
                                    />
                                </AccordionItem>
                                <AccordionItem value="bill-created">
                                    <AccordionTrigger>Bill Created</AccordionTrigger>
                                    <TemplateEditor
                                        title="Bill Created"
                                        template={settings.partners.billCreated}
                                        variables={PARTNER_VARIABLES}
                                        onChange={(field, value) => handleChange('partners', 'billCreated', field, value)}
                                    />
                                </AccordionItem>
                            </Accordion>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
