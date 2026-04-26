
'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function SmtpSettingsPage() {
    return (
        <form className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">SMTP Settings</h2>
                <p className="text-muted-foreground">
                    Configure a custom SMTP server to send emails.
                </p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>SMTP Configuration</CardTitle>
                    <CardDescription>
                        Enter the details of your SMTP server.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="smtp-host">SMTP Host</Label>
                            <Input id="smtp-host" placeholder="smtp.example.com" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp-port">SMTP Port</Label>
                            <Input id="smtp-port" placeholder="587" />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="smtp-user">Username</Label>
                        <Input id="smtp-user" placeholder="user@example.com" />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="smtp-pass">Password</Label>
                        <Input id="smtp-pass" type="password" placeholder="••••••••••••••••••••" />
                    </div>
                    <div className="space-y-2">
                         <Label htmlFor="smtp-encryption">Encryption</Label>
                        <Select defaultValue="tls">
                            <SelectTrigger>
                                <SelectValue placeholder="Select encryption" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="tls">TLS</SelectItem>
                                <SelectItem value="ssl">SSL</SelectItem>
                                <SelectItem value="none">None</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Button>Save SMTP Settings</Button>
            </div>
        </form>
    );
}
