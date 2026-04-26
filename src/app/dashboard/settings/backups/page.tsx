'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Database, Download, Trash2, Undo2, Play, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type BackupSettings = {
    enabled: boolean;
    r2AccessKeyId: string;
    r2SecretAccessKey: string;
    r2Endpoint: string;
    r2BucketName: string;
    r2PublicUrl?: string;
    retentionCount: number;
    frequency: 'hourly' | 'daily' | 'weekly';
    interval: number;
};

type BackupFile = {
    key: string;
    filename: string;
    size: number;
    lastModified: string;
};

export default function BackupsPage() {
    const { toast } = useToast();
    const [settings, setSettings] = useState<BackupSettings | null>(null);
    const [backups, setBackups] = useState<BackupFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);
    const [restoring, setRestoring] = useState(false);

    const fetchData = async () => {
        try {
            const [sRes, bRes] = await Promise.all([
                fetch('/api/settings/backups', { cache: 'no-store', credentials: 'include' }),
                fetch('/api/backups', { cache: 'no-store', credentials: 'include' })
            ]);
            if (sRes.ok) setSettings(await sRes.json());
            if (bRes.ok) setBackups(await bRes.json());
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!settings) return;
        setSaving(true);
        try {
            const res = await fetch('/api/settings/backups', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(settings),
            });
            if (!res.ok) throw new Error('Failed to save settings');
            toast({ title: 'Saved', description: 'Backup settings updated.' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setSaving(false);
        }
    };

    const handleRunNow = async () => {
        setRunning(true);
        try {
            const res = await fetch('/api/backups', { method: 'POST', credentials: 'include' });
            if (!res.ok) throw new Error('Backup failed');
            toast({ title: 'Success', description: 'Manual backup completed.' });
            fetchData();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Backup Error', description: err.message });
        } finally {
            setRunning(false);
        }
    };

    const handleRestore = async (key: string) => {
        setRestoring(true);
        toast({ title: 'Restoring...', description: 'System is entering maintenance mode. Please wait.' });
        try {
            const res = await fetch('/api/backups/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ key }),
            });
            if (!res.ok) throw new Error('Restore failed');
            toast({ title: 'Restored', description: 'Database restore successful. Refreshing...' });
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Restore Error', description: err.message });
            setRestoring(false);
        }
    };

    if (loading || !settings) {
        return (
            <div className="p-8 flex flex-col items-center justify-center gap-4">
                <Loader2 className="animate-spin h-8 w-8 text-primary" />
                <p className="text-muted-foreground animate-pulse">Loading backup system...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Database Backups</h2>
                <p className="text-muted-foreground">Configure automated Cloudflare R2 backups and manage restore points.</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 italic">
                        <Database className="h-5 w-5" /> R2 Configuration
                    </CardTitle>
                    <CardDescription>Securely store your database snapshots off-site.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSave} className="space-y-6">
                        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/40 border">
                            <div className="space-y-0.5">
                                <Label className="text-base font-semibold">Automated Backups</Label>
                                <p className="text-sm text-muted-foreground">Automatically backup the database based on the selected schedule.</p>
                            </div>
                            <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings({ ...settings, enabled: v })} />
                        </div>

                        <div className="grid gap-6 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Access Key ID</Label>
                                <Input 
                                    value={settings.r2AccessKeyId} 
                                    onChange={e => setSettings({...settings, r2AccessKeyId: e.target.value})} 
                                    type="password" 
                                    placeholder="Enter access key"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Secret Access Key</Label>
                                <Input 
                                    value={settings.r2SecretAccessKey} 
                                    onChange={e => setSettings({...settings, r2SecretAccessKey: e.target.value})} 
                                    type="password" 
                                    placeholder="Enter secret key"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Endpoint URL</Label>
                                <Input 
                                    value={settings.r2Endpoint} 
                                    onChange={e => setSettings({...settings, r2Endpoint: e.target.value})} 
                                    placeholder="https://<account-id>.r2.cloudflarestorage.com" 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Bucket Name</Label>
                                <Input 
                                    value={settings.r2BucketName} 
                                    onChange={e => setSettings({...settings, r2BucketName: e.target.value})} 
                                    placeholder="e.g. ecomate-backups"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Backup Frequency</Label>
                                <Select 
                                    value={settings.frequency} 
                                    onValueChange={(v: any) => setSettings({...settings, frequency: v})}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select frequency" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="hourly">Hourly</SelectItem>
                                        <SelectItem value="daily">Daily</SelectItem>
                                        <SelectItem value="weekly">Weekly</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Interval (Every X {settings.frequency === 'hourly' ? 'hours' : settings.frequency === 'daily' ? 'days' : 'weeks'})</Label>
                                <Input 
                                    type="number" 
                                    min="1"
                                    value={settings.interval} 
                                    onChange={e => setSettings({...settings, interval: parseInt(e.target.value) || 1})} 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Maximum Snapshots to Keep</Label>
                                <Input 
                                    type="number" 
                                    min="1"
                                    value={settings.retentionCount} 
                                    onChange={e => setSettings({...settings, retentionCount: parseInt(e.target.value) || 10})} 
                                />
                                <p className="text-xs text-muted-foreground">Keep the last {settings.retentionCount} backups, older ones will be deleted automatically.</p>
                            </div>
                        </div>

                        <div className="flex justify-end pt-2">
                            <Button type="submit" disabled={saving || restoring}>
                                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Save Backup Strategy
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <Card className="border-primary/10">
                <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <CardTitle className="text-xl">Available Snapshots</CardTitle>
                        <CardDescription>Download or restore previous versions of your data.</CardDescription>
                    </div>
                    <Button variant="secondary" onClick={handleRunNow} disabled={running || restoring}>
                        {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                        Run Backup Now
                    </Button>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>Backup Date</TableHead>
                                    <TableHead>File Signature</TableHead>
                                    <TableHead>Total Size</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {backups.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-10 text-muted-foreground italic">
                                            No snapshots available. Set up R2 and run your first backup.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    backups.map((b) => (
                                        <TableRow key={b.key} className="hover:bg-muted/30">
                                            <TableCell className="font-medium">
                                                {format(new Date(b.lastModified), 'MMM d, yyyy · hh:mm aa')}
                                            </TableCell>
                                            <TableCell className="font-mono text-[10px] text-muted-foreground">
                                                {b.filename}
                                            </TableCell>
                                            <TableCell className="text-sm font-semibold">
                                                {(b.size / 1024 / 1024).toFixed(2)} MB
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button 
                                                            variant="outline" 
                                                            size="sm" 
                                                            className="h-8 border-amber-200 text-amber-700 hover:bg-amber-50"
                                                            disabled={restoring || running}
                                                        >
                                                            <Undo2 className="mr-2 h-3.5 w-3.5" /> Restore
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent className="max-w-[450px]">
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                                                                <AlertTriangle className="h-6 w-6" /> Destructive Restore?
                                                            </AlertDialogTitle>
                                                            <AlertDialogDescription className="text-foreground pt-2">
                                                                This action will <strong>OVERWRITE</strong> the current database with data from 
                                                                <span className="block mt-2 p-2 bg-muted rounded font-mono text-[11px] break-all">{b.filename}</span>
                                                                <span className="block mt-4 text-destructive font-bold">The application will be offline in maintenance mode during the process.</span>
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Abort</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => handleRestore(b.key)} className="bg-destructive hover:bg-destructive/90">
                                                                {restoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                                Start Restore
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
