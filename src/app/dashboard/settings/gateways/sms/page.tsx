'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { sendSms } from '@/services/sms';
import { Switch } from '@/components/ui/switch';
import type { SmsGatewaySettings } from '@/lib/sms-settings';

const settingsSchema = z.object({
    username: z.string().email("Please enter a valid email address."),
    apiKey: z.string().min(1, "API Key is required."),
    senderName: z.string().min(1, "Sender Name is required."),
    enabled: z.boolean().default(true),
});

const testSmsSchema = z.object({
    mobileNumber: z.string().min(11, "Please enter a valid mobile number."),
    message: z.string().min(1, "Message cannot be empty."),
});

export default function SmsGatewaySettingsPage() {
    const { toast } = useToast();
    const [isSending, setIsSending] = useState(false);
    const [loading, setLoading] = useState(true);

    const settingsForm = useForm<z.infer<typeof settingsSchema>>({
        resolver: zodResolver(settingsSchema),
        defaultValues: {
            username: "",
            apiKey: "",
            senderName: "",
            enabled: true,
        },
    });

    const testSmsForm = useForm<z.infer<typeof testSmsSchema>>({
        resolver: zodResolver(testSmsSchema),
        defaultValues: {
            mobileNumber: "",
            message: "This is a test message from EcoMate.",
        },
    });

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/api/settings/sms-gateway');
                if (!res.ok) throw new Error('Failed to load settings');
                const data = (await res.json()) as SmsGatewaySettings;
                settingsForm.reset({
                    username: data.username || '',
                    apiKey: data.apiKey || '',
                    senderName: data.senderName || '',
                    enabled: data.enabled ?? true,
                });
            } catch (error) {
                console.error('[SMS_SETTINGS_LOAD]', error);
                toast({
                    variant: 'destructive',
                    title: 'Load failed',
                    description: 'Could not load SMS settings.',
                });
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [settingsForm, toast]);

    async function onSettingsSubmit(values: z.infer<typeof settingsSchema>) {
        try {
            const res = await fetch('/api/settings/sms-gateway', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to save');
            toast({
                title: "Settings Saved",
                description: "Your MiM SMS gateway settings have been saved.",
            });
        } catch (error) {
            console.error('[SMS_SETTINGS_SAVE]', error);
            toast({
                variant: "destructive",
                title: "Save failed",
                description: "Could not save SMS settings.",
            });
        }
    }

    async function onTestSmsSubmit(values: z.infer<typeof testSmsSchema>) {
        setIsSending(true);
        try {
            const result = await sendSms(values.mobileNumber, values.message);
            if ((result as any)?.status === 'Success' || result.statusCode === '200') {
                toast({
                    title: "SMS Sent Successfully",
                    description: result.responseResult || `Transaction ID: ${result.trxnId}`,
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "SMS Sending Failed",
                    description: result.responseResult || 'Request failed',
                });
            }
        } catch (error) {
            toast({
                variant: "destructive",
                title: "An Error Occurred",
                description: "Could not send the test SMS. Please try again.",
            });
        } finally {
            setIsSending(false);
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">SMS Gateway Settings</h2>
                <p className="text-muted-foreground">
                    Configure your MiM SMS provider to send SMS notifications.
                </p>
            </div>
            <Card>
                <Form {...settingsForm}>
                    <form onSubmit={settingsForm.handleSubmit(onSettingsSubmit)}>
                        <CardHeader>
                            <CardTitle>MiM SMS Configuration</CardTitle>
                            <CardDescription>
                                Enter your API credentials from your MiM SMS portal.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <FormField
                                control={settingsForm.control}
                                name="enabled"
                                render={({ field }) => (
                                    <FormItem className="flex items-center justify-between rounded-md border p-3">
                                        <div className="space-y-0.5">
                                            <FormLabel>Enable SMS Gateway</FormLabel>
                                            <FormDescription>Turn off to pause outbound SMS.</FormDescription>
                                        </div>
                                        <FormControl>
                                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={settingsForm.control}
                                name="username"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Username</FormLabel>
                                        <FormControl>
                                            <Input placeholder="you@example.com" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={settingsForm.control}
                                name="apiKey"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>API Key</FormLabel>
                                        <FormControl>
                                            <Input type="password" placeholder="API Key" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={settingsForm.control}
                                name="senderName"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Sender Name (Sender ID)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Your Registered Sender ID" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                        <CardContent>
                            <Button type="submit" disabled={loading}>
                                {loading ? 'Saving...' : 'Save Configuration'}
                            </Button>
                        </CardContent>
                    </form>
                </Form>
            </Card>

            <Separator />

            <Card>
                <Form {...testSmsForm}>
                    <form onSubmit={testSmsForm.handleSubmit(onTestSmsSubmit)}>
                        <CardHeader>
                            <CardTitle>Test SMS</CardTitle>
                            <CardDescription>
                                Send a test message to verify your configuration.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                           <FormField
                                control={testSmsForm.control}
                                name="mobileNumber"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Mobile Number</FormLabel>
                                        <FormControl>
                                            <Input placeholder="88018xxxxxxxx" {...field} />
                                        </FormControl>
                                        <FormDescription>Must be in international format without the + sign.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={testSmsForm.control}
                                name="message"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Message</FormLabel>
                                        <FormControl>
                                            <Textarea {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                        <CardContent>
                             <Button type="submit" disabled={isSending}>
                                {isSending ? 'Sending...' : 'Send Test SMS'}
                            </Button>
                        </CardContent>
                    </form>
                </Form>
            </Card>
        </div>
    );
}
