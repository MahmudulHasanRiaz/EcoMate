
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useTheme } from "next-themes";
import timezones from './timezones';

type GeneralSettings = {
    storeName: string;
    storeAddress: string;
    currency: string;
    timezone: string;
    weightUnit: string;
    dimensionUnit: string;
    lowStockThreshold: number;
    weekendDays: number[];
    holidays: string[];
    theme?: string;
    lateGraceMinutes: number;
    workStartTime: string;
    overtimeRate: number;
    overtimeMaxHours: number;
    allowAutoManagerApproval: boolean;
};

const defaults: GeneralSettings = {
    storeName: 'EcoMate',
    storeAddress: '',
    currency: 'BDT',
    timezone: 'Asia/Dhaka',
    weightUnit: 'kg',
    dimensionUnit: 'cm',
    lowStockThreshold: 5,
    weekendDays: [5, 6],
    holidays: [],
    theme: 'system',
    lateGraceMinutes: 0,
    workStartTime: '09:00',
    overtimeRate: 1.0,
    overtimeMaxHours: 0,
    allowAutoManagerApproval: false,
};

const weekdayOptions = [
    { label: 'Sunday', value: 0 },
    { label: 'Monday', value: 1 },
    { label: 'Tuesday', value: 2 },
    { label: 'Wednesday', value: 3 },
    { label: 'Thursday', value: 4 },
    { label: 'Friday', value: 5 },
    { label: 'Saturday', value: 6 },
];

const parseHolidayInput = (value: string) => {
    const tokens = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    const normalized = tokens.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
    return Array.from(new Set(normalized));
};

const formatHolidayInput = (value: string[]) => value.join('\n');


export default function GeneralSettingsPage() {
    const { toast } = useToast();
    const [settings, setSettings] = useState<GeneralSettings>(defaults);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [holidayInput, setHolidayInput] = useState('');
    const { setTheme } = useTheme();

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/api/settings/general', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    const next = {
                        ...defaults,
                        ...data,
                    };
                    setSettings(next);
                    setHolidayInput(formatHolidayInput(next.holidays || []));
                    setTheme(next.theme || 'system');
                }
            } catch {
                // ignore, keep defaults
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                ...settings,
                weekendDays: Array.from(new Set(settings.weekendDays)).sort((a, b) => a - b),
                holidays: Array.from(new Set(settings.holidays)).sort(),
            };
            const res = await fetch('/api/settings/general', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error('Failed to save settings');
            toast({ title: 'Saved', description: 'General settings updated.' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err?.message || 'Failed to save.' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="p-4">
                <p className="text-muted-foreground">Loading general settings...</p>
            </div>
        );
    }

    return (
        <form className="space-y-6" onSubmit={handleSave}>
            <div>
                <h2 className="text-2xl font-bold tracking-tight">General Settings</h2>
                <p className="text-muted-foreground">
                    Manage your basic store information and preferences.
                </p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Store Details</CardTitle>
                    <CardDescription>
                        Update your business name, contact, and address.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="store-name">Store Name</Label>
                        <Input
                            id="store-name"
                            value={settings.storeName}
                            onChange={(e) => setSettings((s) => ({ ...s, storeName: e.target.value }))}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="store-address">Store Address</Label>
                        <Input
                            id="store-address"
                            value={settings.storeAddress}
                            onChange={(e) => setSettings((s) => ({ ...s, storeAddress: e.target.value }))}
                        />
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Localization</CardTitle>
                    <CardDescription>
                        Set your store's currency and timezone.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="currency">Currency</Label>
                        <Select
                            value={settings.currency}
                            onValueChange={(v) => setSettings((s) => ({ ...s, currency: v }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select currency" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="BDT">Bangladeshi Taka (BDT)</SelectItem>
                                <SelectItem value="USD">US Dollar (USD)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="timezone">Timezone</Label>
                        <Select
                            value={settings.timezone}
                            onValueChange={(v) => setSettings((s) => ({ ...s, timezone: v }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select timezone" />
                            </SelectTrigger>
                            <SelectContent>
                                {timezones.map((tz) => (
                                    <SelectItem key={tz.value} value={tz.value}>
                                        {tz.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Units of Measurement</CardTitle>
                    <CardDescription>
                        Define how units like weight and dimensions are displayed.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="weight-unit">Weight Unit</Label>
                        <Select
                            value={settings.weightUnit}
                            onValueChange={(v) => setSettings((s) => ({ ...s, weightUnit: v }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select weight unit" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="kg">Kilogram (kg)</SelectItem>
                                <SelectItem value="g">Gram (g)</SelectItem>
                                <SelectItem value="lb">Pound (lb)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="dimension-unit">Dimension Unit</Label>
                        <Select
                            value={settings.dimensionUnit}
                            onValueChange={(v) => setSettings((s) => ({ ...s, dimensionUnit: v }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select dimension unit" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cm">Centimeter (cm)</SelectItem>
                                <SelectItem value="m">Meter (m)</SelectItem>
                                <SelectItem value="in">Inch (in)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Inventory Alerts</CardTitle>
                    <CardDescription>
                        Configure stock alerts and notifications.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="low-stock-threshold">Low Stock Threshold</Label>
                        <Input
                            id="low-stock-threshold"
                            type="number"
                            min="1"
                            value={settings.lowStockThreshold}
                            onChange={(e) => setSettings((s) => ({ ...s, lowStockThreshold: parseInt(e.target.value) || 5 }))}
                            placeholder="5"
                        />
                        <p className="text-sm text-muted-foreground">
                            Get notified when available stock falls to or below this number.
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Attendance Calendar</CardTitle>
                    <CardDescription>
                        Configure weekends and holidays used for attendance auto-marking.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="work-start-time">Work Start Time</Label>
                            <Input
                                id="work-start-time"
                                type="time"
                                value={settings.workStartTime}
                                onChange={(e) => setSettings((s) => ({ ...s, workStartTime: e.target.value }))}
                            />
                            <p className="text-xs text-muted-foreground">Standard daily check-in time (e.g. 09:00).</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="late-grace-minutes">Late Grace Period (Minutes)</Label>
                            <Input
                                id="late-grace-minutes"
                                type="number"
                                min="0"
                                value={settings.lateGraceMinutes}
                                onChange={(e) => setSettings((s) => ({ ...s, lateGraceMinutes: parseInt(e.target.value) || 0 }))}
                            />
                            <p className="text-xs text-muted-foreground">Allowed delay before status shifts to Late.</p>
                        </div>
                    </div>
                    
                    <div className="space-y-3">
                        <Label>Weekend Days</Label>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {weekdayOptions.map((day) => {
                                const checked = settings.weekendDays.includes(day.value);
                                return (
                                    <label key={day.value} className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(value) => {
                                                const isChecked = value === true;
                                                setSettings((prev) => ({
                                                    ...prev,
                                                    weekendDays: isChecked
                                                        ? Array.from(new Set([...prev.weekendDays, day.value]))
                                                        : prev.weekendDays.filter((d) => d !== day.value),
                                                }));
                                            }}
                                        />
                                        {day.label}
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="holiday-dates">Holiday Dates (YYYY-MM-DD)</Label>
                        <textarea
                            id="holiday-dates"
                            className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={holidayInput}
                            placeholder="2025-01-01&#10;2025-02-21"
                            onChange={(e) => {
                                const value = e.target.value;
                                setHolidayInput(value);
                                setSettings((prev) => ({
                                    ...prev,
                                    holidays: parseHolidayInput(value),
                                }));
                            }}
                        />
                        <p className="text-xs text-muted-foreground">
                            Enter one date per line (or separated by commas). Invalid dates will be ignored.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="overtimeRate">Overtime Rate Multiplier</Label>
                            <Input
                                id="overtimeRate"
                                type="number"
                                step="0.1"
                                min="0"
                                value={settings.overtimeRate}
                                onChange={(e) => setSettings((prev) => ({ ...prev, overtimeRate: parseFloat(e.target.value) || 1.0 }))}
                            />
                            <p className="text-xs text-muted-foreground">1.0 = normal rate, 1.5 = time and a half</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="overtimeMaxHours">Overtime Cap (hours, 0=no cap)</Label>
                            <Input
                                id="overtimeMaxHours"
                                type="number"
                                min="0"
                                value={settings.overtimeMaxHours}
                                onChange={(e) => setSettings((prev) => ({ ...prev, overtimeMaxHours: parseInt(e.target.value) || 0 }))}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="allowAutoManagerApproval"
                            checked={settings.allowAutoManagerApproval}
                            onCheckedChange={(v) => setSettings((prev) => ({ ...prev, allowAutoManagerApproval: v === true }))}
                        />
                        <Label htmlFor="allowAutoManagerApproval">Auto-approve leave requests at Manager level</Label>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Appearance</CardTitle>
                    <CardDescription>
                        Customize how the application looks for you and your staff.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="theme">Theme</Label>
                        <Select
                            value={settings.theme || 'system'}
                            onValueChange={(v) => {
                                setSettings((s) => ({ ...s, theme: v }));
                                setTheme(v);
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select theme" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="light">Light</SelectItem>
                                <SelectItem value="dark">Dark (Premium)</SelectItem>
                                <SelectItem value="system">System</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-sm text-muted-foreground">
                            This setting will be the default for all users unless overridden by their device.
                        </p>
                    </div>
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
