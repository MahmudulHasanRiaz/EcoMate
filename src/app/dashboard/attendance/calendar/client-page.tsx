'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Check, X, Minus, Clock } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths, getDay } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { AttendanceRecord, StaffMemberUI } from '@/types';

const statusConfig: Record<string, { color: string; icon: any; short: string }> = {
    Present: { color: 'bg-green-500/20 text-green-700 hover:bg-green-500/30', icon: Check, short: 'P' },
    Absent: { color: 'bg-red-500/20 text-red-700 hover:bg-red-500/30', icon: X, short: 'A' },
    'On Leave': { color: 'bg-yellow-500/20 text-yellow-700 hover:bg-yellow-500/30', icon: Minus, short: 'L' },
    Late: { color: 'bg-orange-500/20 text-orange-700 hover:bg-orange-500/30', icon: Clock, short: 'Lt' },
};

function formatDuration(minutes: number): string {
    if (minutes < 0) return '0h';
    const hours = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    if (hours === 0) return `${m}m`;
    return `${hours}h ${m}m`;
}

export default function CalendarClientPage({ timezone, staffList, currentUser }: { timezone: string, staffList: StaffMemberUI[], currentUser: any }) {
    const { toast } = useToast();
    const isManagerRole = currentUser && (
        currentUser.role === 'Admin' || 
        currentUser.role === 'Manager' || 
        currentUser.permissions?.attendance?.read === true
    );
    
    const [currentDate, setCurrentDate] = React.useState(new Date());
    const [selectedStaffId, setSelectedStaffId] = React.useState<string>('all');
    const [records, setRecords] = React.useState<AttendanceRecord[]>([]);
    const [loading, setLoading] = React.useState(false);

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

    React.useEffect(() => {
        let active = true;
        setLoading(true);
        
        // Build the URL params explicitly
        const params = new URLSearchParams();
        params.set('month', String(currentDate.getMonth() + 1));
        params.set('year', String(currentDate.getFullYear()));
        params.set('pageSize', '2000');
        if (selectedStaffId !== 'all') {
             params.set('staffId', selectedStaffId);
        }

        fetch(`/api/attendance?${params.toString()}`)
            .then(res => res.json())
            .then(data => {
                if (!active) return;
                if (data.error) throw new Error(data.error);
                setRecords(data.items || []);
            })
            .catch(err => {
                if (!active) return;
                toast({ variant: 'destructive', title: 'Error loading calendar', description: err.message });
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => { active = false; };
    }, [currentDate, selectedStaffId, toast]);

    const handlePreviousMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

    // Get a specific record safely by comparing YYYY-MM-DD strings
    const getRecordForDate = (date: Date, staffRecords: AttendanceRecord[]) => {
        // Use Intl to get the YYYY-MM-DD in the store's timezone
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const targetStr = formatter.format(date); // e.g., "2026-03-24"

        return staffRecords.find(r => {
            // Check if record date starts with target YYYY-MM-DD
            return r.date.toString().startsWith(targetStr);
        });
    };

    const renderCellContent = (date: Date, record?: AttendanceRecord) => {
        if (!record) return null;
        
        const config = statusConfig[record.status] || { color: 'bg-muted', icon: Minus, short: '-' };
        const Icon = config.icon;
        
        return (
            <div className="flex flex-col h-full justify-between items-start gap-1 p-1">
                <Badge variant="outline" className={`w-full justify-center ${config.color} border-0 text-xs py-0 px-1`}>
                     {record.status}
                </Badge>

                <div className="flex flex-wrap gap-1 mt-auto">
                    {record.isWeekend && <Badge variant="secondary" className="text-[9px] px-1 h-3 leading-none">Wknd</Badge>}
                    {record.isHoliday && <Badge variant="secondary" className="text-[9px] px-1 h-3 leading-none bg-blue-100 text-blue-700">Hol</Badge>}
                </div>
                
                {record.totalWorkDuration ? (
                     <div className="text-[10px] text-muted-foreground w-full text-right mt-1 font-mono">
                         {formatDuration(record.totalWorkDuration)}
                     </div>
                ) : null}
            </div>
        );
    };

    const renderIndividualCalendar = () => {
        // Find which staff we are rendering. If we aren't manager and haven't selected, it's us.
        // We just use the flat records array.
        
        // Pad the start of the month with empty cells based on day of week
        const startDayOfWeek = getDay(monthStart); // 0 = Sunday, 1 = Monday...
        const blanks = Array.from({ length: startDayOfWeek }).map((_, i) => <div key={`blank-${i}`} className="h-24 md:h-32 border border-muted/50 bg-muted/10 rounded-md"></div>);

        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Detailed Calendar</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-7 gap-1 md:gap-2 mb-2">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                            <div key={d} className="text-center text-sm font-medium text-muted-foreground py-2">{d}</div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1 md:gap-2">
                        {blanks}
                        {daysInMonth.map(date => {
                            const record = getRecordForDate(date, records);
                            const isTodayDate = isToday(date);
                            
                            return (
                                <div 
                                    key={date.toISOString()} 
                                    className={`relative flex flex-col h-24 md:h-32 border rounded-md overflow-hidden transition-colors hover:border-primary/50 ${isTodayDate ? 'border-primary ring-1 ring-primary/20' : 'border-border'}`}
                                >
                                    <div className={`text-xs p-1 font-medium ${isTodayDate ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'}`}>
                                        {format(date, 'd')}
                                    </div>
                                    <div className="flex-1 p-1">
                                        {renderCellContent(date, record)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        );
    };

    const renderGroupedOverview = () => {
        // Group records by staff ID computationally
        const staffMap = new Map<string, { staffName: string, staffId: string, records: AttendanceRecord[] }>();
        records.forEach(r => {
            if (!staffMap.has(r.staffId)) {
                staffMap.set(r.staffId, { staffName: r.staffName, staffId: r.staffId, records: [] });
            }
            staffMap.get(r.staffId)!.records.push(r);
        });

        // Add staff who might have zero records this month but exist in staffList
        staffList.forEach(s => {
            if (!staffMap.has(s.id)) {
                staffMap.set(s.id, { staffName: s.name, staffId: s.id, records: [] });
            }
        });

        const sortedStaff = Array.from(staffMap.values()).sort((a, b) => a.staffName.localeCompare(b.staffName));

        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Staff Monthly Overview</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0 pb-6">
                    <div className="min-w-[800px] px-6">
                        {/* Header Row */}
                        <div className="flex items-center gap-1 border-b pb-2 mb-2 text-xs font-medium text-muted-foreground">
                            <div className="w-48 shrink-0">Staff Member</div>
                            <div className="flex-1 flex gap-1">
                                {daysInMonth.map(date => (
                                    <div key={date.toISOString()} className="flex-1 text-center truncate px-0.5">
                                        {format(date, 'd')}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Staff Rows */}
                        <div className="space-y-2">
                            {sortedStaff.map(({ staffName, staffId, records: sRecords }) => (
                                <div key={staffId} className="flex items-center gap-1 group">
                                    <div className="w-48 shrink-0 text-sm font-medium truncate pr-2 group-hover:text-primary transition-colors">
                                        {staffName}
                                    </div>
                                    <TooltipProvider delayDuration={0}>
                                        <div className="flex-1 flex gap-1 h-8">
                                            {daysInMonth.map(date => {
                                                const record = getRecordForDate(date, sRecords);
                                                const config = record ? (statusConfig[record.status] || { color: 'bg-muted', icon: Minus, short: '-' }) : null;
                                                const isTodayDate = isToday(date);
                                                
                                                return (
                                                    <Tooltip key={date.toISOString()}>
                                                        <TooltipTrigger asChild>
                                                            <div className={`flex-1 rounded-sm border flex items-center justify-center text-[10px] font-medium cursor-help transition-all hover:scale-110 hover:shadow-sm ${isTodayDate ? 'ring-1 ring-primary z-10' : ''} ${config ? config.color : 'bg-muted/10 border-dashed text-muted-foreground/30'}`}>
                                                                {config ? config.short : ''}
                                                            </div>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p className="font-semibold mb-1">{format(date, 'MMM d, yyyy')}</p>
                                                            {record ? (
                                                                <div className="text-xs space-y-1">
                                                                    <p>Status: {record.status}</p>
                                                                    {record.isWeekend && <p>Weekend Bonus Applied</p>}
                                                                    {record.isHoliday && <p>Holiday</p>}
                                                                    {record.totalWorkDuration ? <p>Worked: {formatDuration(record.totalWorkDuration)}</p> : null}
                                                                </div>
                                                            ) : (
                                                                <p className="text-xs text-muted-foreground">No record</p>
                                                            )}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                );
                                            })}
                                        </div>
                                    </TooltipProvider>
                                </div>
                            ))}
                            {sortedStaff.length === 0 && !loading && (
                                <div className="text-center text-muted-foreground py-8 text-sm">No staff records found for this month</div>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    };

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Calendar View</h1>
                    <p className="text-sm text-muted-foreground">Monthly attendance calendar</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                    {/* Month Navigator */}
                    <div className="flex items-center gap-1 bg-background border rounded-md shadow-sm p-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePreviousMonth}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="text-sm font-medium w-36 text-center tabular-nums">
                            {format(currentDate, 'MMMM yyyy')}
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNextMonth}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Staff Filter (only for managers) */}
                    {isManagerRole && (
                        <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                            <SelectTrigger className="w-[180px] h-10 bg-background">
                                <SelectValue placeholder="All Staff" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Group Overview</SelectItem>
                                {staffList.map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-sm border bg-background/50 rounded-lg p-3">
                <span className="font-semibold text-muted-foreground mr-2">Legend:</span>
                <div className="flex items-center gap-1.5"><Badge variant="outline" className={statusConfig['Present'].color}>P</Badge> Present</div>
                <div className="flex items-center gap-1.5"><Badge variant="outline" className={statusConfig['Late'].color}>Lt</Badge> Late</div>
                <div className="flex items-center gap-1.5"><Badge variant="outline" className={statusConfig['Absent'].color}>A</Badge> Absent</div>
                <div className="flex items-center gap-1.5"><Badge variant="outline" className={statusConfig['On Leave'].color}>L</Badge> On Leave</div>
                <div className="w-px h-4 bg-border mx-2"></div>
                <Badge variant="secondary" className="text-[10px] h-4">Wknd</Badge> Weekend
                <Badge variant="secondary" className="text-[10px] h-4 bg-blue-100 text-blue-700">Hol</Badge> Holiday
            </div>

            {/* Main Content */}
            {loading ? (
                <div className="flex-1 flex items-center justify-center min-h-[400px]">
                    <div className="animate-pulse flex flex-col items-center gap-4">
                        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-muted-foreground text-sm">Loading calendar...</p>
                    </div>
                </div>
            ) : (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {selectedStaffId === 'all' && isManagerRole 
                        ? renderGroupedOverview()
                        : renderIndividualCalendar()
                    }
                </div>
            )}
        </div>
    );
}
