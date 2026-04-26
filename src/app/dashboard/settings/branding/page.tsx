
'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

type BrandingSettings = {
    standardLogoUrl: string;
    iconLogoUrl: string;
    darkLogoUrl: string;
    appIconUrl: string;
};

const defaults: BrandingSettings = {
    standardLogoUrl: '/logo-full.svg',
    iconLogoUrl: '/logo-icon.svg',
    darkLogoUrl: '/logo-white.svg',
    appIconUrl: '/icons/icon-512x512.png',
};

function LogoInput({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
}) {
    const src = value || '/placeholder.svg';
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-md overflow-hidden bg-muted">
                    <Image
                        src={src}
                        alt={label}
                        width={64}
                        height={64}
                        className="object-cover h-16 w-16"
                        onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            if (!target.src.endsWith('/placeholder.svg')) target.src = '/placeholder.svg';
                        }}
                    />
                </div>
                <Input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="https://example.com/logo.png"
                />
            </div>
        </div>
    );
}

export default function BrandingSettingsPage() {
    const { toast } = useToast();
    const [settings, setSettings] = React.useState<BrandingSettings>(defaults);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/api/settings/branding', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    setSettings({ ...defaults, ...data });
                }
            } catch {
                // ignore
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await fetch('/api/settings/branding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            if (!res.ok) throw new Error('Failed to save branding');
            toast({ title: 'Saved', description: 'Branding settings updated.' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err?.message || 'Failed to save.' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <p className="text-muted-foreground p-4">Loading branding settings...</p>;
    }

    return (
        <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Branding &amp; Appearance</h2>
                <p className="text-muted-foreground">
                    Customize your store&apos;s logo and icons.
                </p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Company Logos</CardTitle>
                    <CardDescription>
                        Set the logos used across the app, invoices, and website.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <LogoInput
                        label="Standard Logo (light backgrounds)"
                        value={settings.standardLogoUrl}
                        onChange={(v) => setSettings((s) => ({ ...s, standardLogoUrl: v }))}
                    />
                    <LogoInput
                        label="Logo Mark / Icon"
                        value={settings.iconLogoUrl}
                        onChange={(v) => setSettings((s) => ({ ...s, iconLogoUrl: v }))}
                    />
                    <LogoInput
                        label="Logo for Dark Backgrounds"
                        value={settings.darkLogoUrl}
                        onChange={(v) => setSettings((s) => ({ ...s, darkLogoUrl: v }))}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>App Icon</CardTitle>
                    <CardDescription>Used for PWA installs.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <LogoInput
                        label="PWA Icon"
                        value={settings.appIconUrl}
                        onChange={(v) => setSettings((s) => ({ ...s, appIconUrl: v }))}
                    />
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
            </div>
        </form>
    );
}
