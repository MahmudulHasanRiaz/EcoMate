
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Search } from 'lucide-react';

export default function TrackOrderPage() {
    const [query, setQuery] = useState('');
    const router = useRouter();

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) {
            router.push(`/track-order/${query.trim()}`);
        }
    };

    return (
        <div className="container mx-auto w-full max-w-2xl py-12 px-4 sm:px-8">
            <Card>
                <CardHeader>
                    <CardTitle>Track Your Order</CardTitle>
                    <CardDescription>
                        Enter your Order Number or phone number to see the status of your order.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSearch} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="search-query">Order Number or Phone Number</Label>
                            <Input
                                id="search-query"
                                placeholder="e.g., 250226-01 or 01xxxxxxxxx"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                        <Button type="submit" className="w-full">
                            <Search className="mr-2 h-4 w-4" />
                            Track Order
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
