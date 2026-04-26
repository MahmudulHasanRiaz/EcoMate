'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarDays, Building, Laptop, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const DAYS = [
    { label: 'Saturday', value: 6 },
    { label: 'Sunday', value: 0 },
    { label: 'Monday', value: 1 },
    { label: 'Tuesday', value: 2 },
    { label: 'Wednesday', value: 3 },
    { label: 'Thursday', value: 4 },
    { label: 'Friday', value: 5 },
];

export default function OffDaysPage() {
    const { toast } = useToast();
    const [staff, setStaff] = React.useState<any[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [workType, setWorkType] = React.useState<string>('Office');

    const fetchOffDays = React.useCallback(async () => {
        setIsLoading(true);
        try {
            const url = `/api/staff/off-days?workType=${workType}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch off days');
            const data = await res.json();
            setStaff(data);
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err.message || 'Could not load off days',
            });
        } finally {
            setIsLoading(false);
        }
    }, [workType, toast]);

    React.useEffect(() => {
        fetchOffDays();
    }, [fetchOffDays]);

    const isOffOnDay = (effectiveWeekendDays: any, dayValue: number) => {
        if (!Array.isArray(effectiveWeekendDays)) return false;
        return effectiveWeekendDays.some(d => Number(d) === dayValue);
    };

    const getStaffOffOnDay = (dayValue: number) => {
        return staff.filter(member => isOffOnDay(member.effectiveWeekendDays, dayValue));
    };

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex-1 w-full">
                    <h1 className="font-headline text-2xl font-bold">Off Day Schedule</h1>
                    <p className="text-muted-foreground hidden sm:block">
                        Weekly roster view showing scheduled off days for staff members.
                    </p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Select value={workType} onValueChange={setWorkType}>
                        <SelectTrigger className="w-[150px]">
                            <SelectValue placeholder="Work Type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Types</SelectItem>
                            <SelectItem value="Office">Office Only</SelectItem>
                            <SelectItem value="Remote">Remote Only</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[1, 2, 3, 4, 5, 6, 7].map(i => (
                        <Skeleton key={i} className="h-48 w-full rounded-xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {DAYS.map(day => {
                        const offStaff = getStaffOffOnDay(day.value);
                        return (
                            <Card key={day.value} className={offStaff.length > 0 ? "border-red-100 dark:border-red-900/30 shadow-sm" : "opacity-60"}>
                                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                                        {day.label}
                                    </CardTitle>
                                    <Badge variant={offStaff.length > 0 ? "destructive" : "outline"} className="font-mono">
                                        Off: {offStaff.length}
                                    </Badge>
                                </CardHeader>
                                <CardContent>
                                    {offStaff.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {offStaff.map(member => (
                                                <Badge 
                                                    key={member.id} 
                                                    variant="secondary" 
                                                    className="px-2 py-0.5 text-[11px] font-medium bg-muted/50 hover:bg-muted"
                                                >
                                                    {member.name}
                                                </Badge>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center h-12 text-xs text-muted-foreground italic bg-muted/20 rounded-md mt-2">
                                            No one scheduled off
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
            
            {!isLoading && staff.length === 0 && (
                <div className="h-60 flex flex-col items-center justify-center text-muted-foreground gap-2 border-2 border-dashed rounded-xl">
                    <User className="h-10 w-10 opacity-10" />
                    <p className="font-medium">No staff members found for the selected filter.</p>
                </div>
            )}
        </div>
    );
}
