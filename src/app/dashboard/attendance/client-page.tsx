'use client';

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Clock,
  FileDown,
  User,
  Check,
  X,
  Minus,
  TrendingUp,
  Edit2,
  RefreshCw,
  AlarmClock,
  CalendarOff,
  UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAttendanceByDay } from '@/services/attendance';
import type { AttendanceRecord, AttendanceStatus } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format, subDays, differenceInMinutes } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { AttendanceEditModal } from './edit-modal';
import { cn } from '@/lib/utils';

// ─── Status Config ──────────────────────────────────────────
const statusConfig: Record<string, { color: string; icon: any; label: string }> = {
    Present:      { color: 'bg-green-500/20 text-green-700 border-green-300',   icon: Check,      label: 'Present' },
    Absent:       { color: 'bg-red-500/20 text-red-700 border-red-300',         icon: X,          label: 'Absent' },
    'On Leave':   { color: 'bg-yellow-500/20 text-yellow-700 border-yellow-300',icon: Minus,      label: 'On Leave' },
    Late:         { color: 'bg-orange-500/20 text-orange-700 border-orange-300', icon: Clock,      label: 'Late' },
    'Not Due':    { color: 'bg-slate-500/10 text-slate-500 border-slate-200',   icon: AlarmClock,  label: 'Not Due' },
    'Not Arrived':{ color: 'bg-purple-500/20 text-purple-700 border-purple-300',icon: UserX,      label: 'Not Arrived' },
    'Off Day':    { color: 'bg-sky-500/10 text-sky-600 border-sky-200',         icon: CalendarOff, label: 'Off Day' },
};

function formatDuration(minutes: number): string {
    if (!minutes || minutes < 0) return '0h 0m';
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.floor(minutes % 60);
    return `${hours}h ${remainingMinutes}m`;
}

const formatTimeInTz = (date: Date, timezone: string) => {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(date);
};

const formatYmdInTz = (date: Date, tz: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const get = (t: string) => parts.find(p => p.type === t)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
};

// ─── Dynamic Status Computation ─────────────────────────────
function getEffectiveStatus(record: AttendanceRecord, timezone: string, selectedDate: string): AttendanceStatus {
    // Dynamic statuses only apply for today; for past dates use server status
    const todayYmd = formatYmdInTz(new Date(), timezone);
    if (selectedDate !== todayYmd) return record.status as AttendanceStatus;

    // If server already computed a non-Absent status, use it
    if (record.status !== 'Absent') return record.status as AttendanceStatus;

    // Off Day takes priority
    if (record.isWeekend || record.isHoliday) return 'Off Day';

    // For Absent records, check if shift has started
    if (!record.shiftStartTime) return 'Absent';

    const [hStr, mStr] = record.shiftStartTime.split(':');
    const shiftStartMin = (Number(hStr) || 0) * 60 + (Number(mStr) || 0);
    // Typical shift length, fallback to 9 hours (540 mins) if expectedMinutes is 0 or null
    const shiftDuration = record.expectedMinutes || 540; 

    // Get current time in the relevant timezone
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
    }).formatToParts(new Date());
    const nowHour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
    const nowMin = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
    const nowTotalMin = nowHour * 60 + nowMin;

    if (nowTotalMin < shiftStartMin) return 'Not Due';
    // If the shift is ongoing, staff is Not Arrived. If shift is over, staff is Absent.
    if (nowTotalMin < shiftStartMin + shiftDuration) return 'Not Arrived';
    return 'Absent';
}

// ─── Live State Badge ───────────────────────────────────────
function getLiveState(record: AttendanceRecord): { label: string; color: string } | null {
    const hasActiveBreak = record.breaks?.some(b => b.endTime === null);
    const hasActiveInactive = record.inactiveRecords?.some(i => i.endTime === null);
    if (hasActiveBreak) return { label: 'On Break', color: 'bg-yellow-500/10 text-yellow-600 border-yellow-200' };
    if (hasActiveInactive) return { label: 'Inactive', color: 'bg-slate-500/10 text-slate-600 border-slate-200' };
    if (record.checkInTime && !record.checkOutTime) {
        return { label: 'Running', color: 'bg-blue-500/10 text-blue-600 border-blue-200 animate-pulse' };
    }
    return null;
}

// ─── Live Duration Computation ──────────────────────────────
function computeLiveDurations(record: AttendanceRecord, now: Date) {
    if (!record.checkInTime || record.checkOutTime) {
        return {
            liveWorkMinutes: record.totalWorkDuration || 0,
            liveBreakMinutes: record.totalBreakDuration || 0,
            liveInactiveMinutes: record.totalInactiveDuration || 0,
        };
    }
    const checkIn = new Date(record.checkInTime);
    const elapsedMin = differenceInMinutes(now, checkIn);

    // Completed breaks
    let completedBreakMin = 0;
    let activeBreakMin = 0;
    for (const b of record.breaks || []) {
        if (b.endTime) {
            completedBreakMin += Math.max(0, differenceInMinutes(new Date(b.endTime), new Date(b.startTime)));
        } else {
            activeBreakMin = Math.max(0, differenceInMinutes(now, new Date(b.startTime)));
        }
    }

    // Completed inactives
    let completedInactiveMin = 0;
    let activeInactiveMin = 0;
    for (const i of record.inactiveRecords || []) {
        if (i.endTime) {
            completedInactiveMin += Math.max(0, differenceInMinutes(new Date(i.endTime), new Date(i.startTime)));
        } else {
            activeInactiveMin = Math.max(0, differenceInMinutes(now, new Date(i.startTime)));
        }
    }

    const totalBreak = completedBreakMin + activeBreakMin;
    const totalInactive = completedInactiveMin + activeInactiveMin;
    const liveWork = Math.max(0, elapsedMin - totalBreak - totalInactive);

    return {
        liveWorkMinutes: liveWork,
        liveBreakMinutes: totalBreak,
        liveInactiveMinutes: totalInactive,
    };
}


// ═════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════
export default function AttendanceClientPage({ timezone }: { timezone: string }) {
    const { toast } = useToast();
    const [allAttendanceRecords, setAllAttendanceRecords] = React.useState<AttendanceRecord[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [refreshKey, setRefreshKey] = React.useState(0);
    const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
    const [selectedEditRecord, setSelectedEditRecord] = React.useState<AttendanceRecord | null>(null);
    const isMobile = useIsMobile();

    // Day Selection
    const [selectedDate, setSelectedDate] = React.useState<string>(() => formatYmdInTz(new Date(), timezone));
    const [showDatePicker, setShowDatePicker] = React.useState(false);

    // Filters
    const [workType, setWorkType] = React.useState<string>('Office');
    const [statusFilter, setStatusFilter] = React.useState<string>('all');
    const [designationFilter, setDesignationFilter] = React.useState<string>('all');

    // Live tick
    const [now, setNow] = React.useState(new Date());
    React.useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    // ─── Data Fetch ─────────────────────────────────────────
    const fetchData = React.useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const statusForApi = statusFilter === 'Not Due' || statusFilter === 'Not Arrived' || statusFilter === 'Off Day' ? 'all' : statusFilter;
            const data = await getAttendanceByDay(selectedDate, workType, statusForApi, designationFilter);
            setAllAttendanceRecords(data.items);
            if (data.uniqueDesignations?.length) {
                setUniqueDesignations(data.uniqueDesignations);
            }
            setLoadError(null);
        } catch (err: any) {
            if (!silent) {
                setAllAttendanceRecords([]);
                setLoadError(err?.message || 'Could not load attendance records.');
                toast({ variant: 'destructive', title: 'Load failed', description: err?.message || 'Could not load.' });
            }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [selectedDate, workType, statusFilter, designationFilter, toast]);

    React.useEffect(() => { fetchData(); }, [fetchData, refreshKey]);

    // Auto-refresh
    React.useEffect(() => {
        const interval = setInterval(() => { if (!isLoading) fetchData(true); }, 30000);
        const handleFocus = () => { if (!isLoading) fetchData(true); };
        window.addEventListener('focus', handleFocus);
        return () => { clearInterval(interval); window.removeEventListener('focus', handleFocus); };
    }, [fetchData, isLoading]);

    // ─── Computed Data ──────────────────────────────────────
    const enrichedRecords = React.useMemo(() => {
        return allAttendanceRecords.map(r => ({
            ...r,
            effectiveStatus: getEffectiveStatus(r, timezone, selectedDate),
            liveState: getLiveState(r),
            ...computeLiveDurations(r, now),
        }));
    }, [allAttendanceRecords, timezone, now]);

    // Client-side status filtering (for dynamic statuses like Not Due)
    const filteredRecords = React.useMemo(() => {
        if (statusFilter === 'all') return enrichedRecords;
        return enrichedRecords.filter(r => r.effectiveStatus === statusFilter);
    }, [enrichedRecords, statusFilter]);

    const summaryStats = React.useMemo(() => {
        const present = enrichedRecords.filter(r => r.effectiveStatus === 'Present' || r.effectiveStatus === 'Late').length;
        const onLeave = enrichedRecords.filter(r => r.effectiveStatus === 'On Leave').length;
        const absent = enrichedRecords.filter(r => r.effectiveStatus === 'Absent').length;
        const offDay = enrichedRecords.filter(r => r.effectiveStatus === 'Off Day').length;
        const notArrived = enrichedRecords.filter(r => r.effectiveStatus === 'Not Arrived' || r.effectiveStatus === 'Not Due').length;

        const workingRecords = enrichedRecords.filter(r => (r.effectiveStatus === 'Present' || r.effectiveStatus === 'Late') && r.liveWorkMinutes);
        const totalWorkMinutes = workingRecords.reduce((acc, r) => acc + (r.liveWorkMinutes || 0), 0);
        const avgWorkDuration = workingRecords.length > 0 ? totalWorkMinutes / workingRecords.length : 0;

        return { present, onLeave, absent, offDay, notArrived, avgWorkDuration };
    }, [enrichedRecords]);

    const [uniqueDesignations, setUniqueDesignations] = React.useState<string[]>([]);

    // ─── Export ──────────────────────────────────────────────
    const handleExport = () => {
        const headers = ["Date","Staff Name","Role","Designation","Work Type","Status","Check-in","Check-out","Work (min)","Break (min)","Inactive (min)","Expected (min)","OT (min)","OT Bonus"];
        const rows = filteredRecords.map(r => [
            `"${format(new Date(r.date), 'yyyy-MM-dd')}"`, `"${r.staffName}"`, `"${r.staffRole}"`,
            `"${r.staffDesignation || ''}"`, `"${r.staffWorkType}"`, r.effectiveStatus,
            r.checkInTime ? `"${format(new Date(r.checkInTime), 'h:mm a')}"` : 'N/A',
            r.checkOutTime ? `"${format(new Date(r.checkOutTime), 'h:mm a')}"` : 'N/A',
            r.liveWorkMinutes || 0, r.liveBreakMinutes || 0, r.liveInactiveMinutes || 0,
            r.expectedMinutes || 0, r.overtimeMinutes ?? 0, r.overtimeBonusAmount ?? 0,
        ].join(','));
        if (!rows.length) { toast({ title: 'Nothing to export' }); return; }
        const csv = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csv));
        link.setAttribute("download", `attendance_${selectedDate}.csv`);
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    // ─── Render Helpers ─────────────────────────────────────
    type EnrichedRecord = typeof enrichedRecords[number];

    const renderStatusBadge = (r: EnrichedRecord) => {
        const config = statusConfig[r.effectiveStatus] || statusConfig['Absent'];
        const StatusIcon = config.icon;
        return (
            <div className="flex flex-col gap-1 items-start">
                <Badge variant="outline" className={config.color}>
                    <StatusIcon className="mr-1 h-3 w-3" />
                    {config.label}
                </Badge>
                <div className="flex gap-1">
                    {r.liveState && (
                        <Badge variant="outline" className={cn("text-[8px] h-3.5 px-1 py-0 uppercase font-bold", r.liveState.color)}>
                            {r.liveState.label}
                        </Badge>
                    )}
                    {r.isWeekend && r.effectiveStatus !== 'Off Day' && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">Weekend</Badge>}
                    {r.isHoliday && r.effectiveStatus !== 'Off Day' && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">Holiday</Badge>}
                </div>
            </div>
        );
    };

    const renderTable = (records: EnrichedRecord[]) => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Staff Member</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Check-in</TableHead>
                    <TableHead className="hidden md:table-cell">Check-out</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">Break</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">Inactive</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">Expected</TableHead>
                    <TableHead className="text-right">Work</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {records.map(r => (
                    <TableRow key={r.id} className={r.effectiveStatus === 'Off Day' || r.effectiveStatus === 'Not Due' ? 'opacity-50' : ''}>
                        <TableCell>
                            <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                    {r.staffAvatar && <AvatarImage src={r.staffAvatar} alt={r.staffName} />}
                                    <AvatarFallback className="text-xs">{r.staffName.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <p className="font-medium text-sm">{r.staffName}</p>
                                    <div className="flex gap-1 text-[10px] text-muted-foreground items-center">
                                        <span>{r.staffRole}</span>
                                        {r.staffDesignation && (<><span className="opacity-50">-</span><span>{r.staffDesignation}</span></>)}
                                    </div>
                                </div>
                            </div>
                        </TableCell>
                        <TableCell>{renderStatusBadge(r)}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{r.checkInTime ? formatTimeInTz(new Date(r.checkInTime), timezone) : '-'}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{r.checkOutTime ? formatTimeInTz(new Date(r.checkOutTime), timezone) : '-'}</TableCell>
                        <TableCell className="hidden lg:table-cell text-right font-mono text-xs text-muted-foreground">{formatDuration(r.liveBreakMinutes)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-right font-mono text-xs text-muted-foreground">{formatDuration(r.liveInactiveMinutes)}</TableCell>
                        <TableCell className="hidden sm:table-cell text-right font-mono text-xs text-muted-foreground">{r.expectedMinutes ? formatDuration(r.expectedMinutes) : '-'}</TableCell>
                        <TableCell className="text-right">
                            <div className="flex flex-col items-end">
                                <span className="font-mono font-bold text-primary text-sm">{formatDuration(r.liveWorkMinutes)}</span>
                                {r.overtimeMinutes && r.overtimeMinutes > 0 && (
                                    <span className="text-[10px] text-orange-600 font-medium">OT: {formatDuration(r.overtimeMinutes)}</span>
                                )}
                            </div>
                        </TableCell>
                        <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSelectedEditRecord(r); setIsEditModalOpen(true); }}>
                                <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );

    const renderCards = (records: EnrichedRecord[]) => (
        <div className="space-y-3">
            {records.map(r => (
                <Card key={r.id} className={r.effectiveStatus === 'Off Day' || r.effectiveStatus === 'Not Due' ? 'opacity-50' : ''}>
                    <CardContent className="p-4 space-y-3">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                    {r.staffAvatar && <AvatarImage src={r.staffAvatar} alt={r.staffName} />}
                                    <AvatarFallback className="text-xs">{r.staffName.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <p className="font-medium text-sm">{r.staffName}</p>
                                    <p className="text-[10px] text-muted-foreground">{r.staffRole}{r.staffDesignation ? ` - ${r.staffDesignation}` : ''}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                {renderStatusBadge(r)}
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setSelectedEditRecord(r); setIsEditModalOpen(true); }}>
                                    <Edit2 className="h-3 w-3 text-muted-foreground" />
                                </Button>
                            </div>
                        </div>
                        {(r.checkInTime || r.effectiveStatus === 'Present' || r.effectiveStatus === 'Late') && (
                            <>
                                <Separator />
                                <div className="grid grid-cols-5 gap-1 text-center text-xs">
                                    <div>
                                        <p className="text-muted-foreground">In</p>
                                        <p className="font-medium">{r.checkInTime ? formatTimeInTz(new Date(r.checkInTime), timezone) : '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground">Out</p>
                                        <p className="font-medium">{r.checkOutTime ? formatTimeInTz(new Date(r.checkOutTime), timezone) : '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground hidden sm:block">Break</p>
                                        <p className="text-muted-foreground sm:hidden">Brk</p>
                                        <p className="font-medium">{formatDuration(r.liveBreakMinutes)}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground hidden sm:block">Expected</p>
                                        <p className="text-muted-foreground sm:hidden">Exp</p>
                                        <p className="font-medium">{r.expectedMinutes ? formatDuration(r.expectedMinutes) : '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground">Work</p>
                                        <p className="font-semibold font-mono text-primary">{formatDuration(r.liveWorkMinutes)}</p>
                                    </div>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            ))}
        </div>
    );

    // ─── Main Render ────────────────────────────────────────
    const todayYmd = formatYmdInTz(new Date(), timezone);
    const yesterdayYmd = formatYmdInTz(subDays(new Date(), 1), timezone);

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            {/* Header */}
            <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
                <div className="flex-1 w-full">
                    <div className="flex items-center gap-3">
                        <h1 className="font-headline text-2xl font-bold">Attendance Report</h1>
                        {isLoading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    <p className="text-muted-foreground hidden sm:block text-sm">Daily attendance view with real-time tracking.</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                    {/* Day Selector */}
                    <div className="flex items-center rounded-lg border bg-background p-1 shadow-sm">
                        <Button variant={selectedDate === todayYmd ? 'secondary' : 'ghost'} size="sm" className="h-8 rounded-md px-3 text-xs font-medium"
                            onClick={() => { setSelectedDate(todayYmd); setShowDatePicker(false); }}>Today</Button>
                        <Button variant={selectedDate === yesterdayYmd ? 'secondary' : 'ghost'} size="sm" className="h-8 rounded-md px-3 text-xs font-medium"
                            onClick={() => { setSelectedDate(yesterdayYmd); setShowDatePicker(false); }}>Yesterday</Button>
                        <div className="flex items-center gap-2 px-1">
                            <Separator orientation="vertical" className="h-4" />
                            {showDatePicker ? (
                                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                                    className="h-8 bg-transparent text-xs font-medium outline-none" autoFocus />
                            ) : (
                                <Button variant={selectedDate !== todayYmd && selectedDate !== yesterdayYmd ? 'secondary' : 'ghost'} size="sm"
                                    className="h-8 rounded-md px-3 text-xs font-medium" onClick={() => setShowDatePicker(true)}>
                                    {selectedDate !== todayYmd && selectedDate !== yesterdayYmd ? selectedDate : 'Custom'}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="h-8 w-px bg-border hidden xl:block mx-1" />

                    <div className="flex flex-wrap items-center gap-2">
                        <Select value={workType} onValueChange={setWorkType}>
                            <SelectTrigger className="h-9 w-[110px] text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="Office">Office</SelectItem>
                                <SelectItem value="Remote">Remote</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-9 w-[120px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="Present">Present</SelectItem>
                                <SelectItem value="Late">Late</SelectItem>
                                <SelectItem value="Absent">Absent</SelectItem>
                                <SelectItem value="Not Arrived">Not Arrived</SelectItem>
                                <SelectItem value="Not Due">Not Due</SelectItem>
                                <SelectItem value="On Leave">On Leave</SelectItem>
                                <SelectItem value="Off Day">Off Day</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={designationFilter} onValueChange={setDesignationFilter}>
                            <SelectTrigger className="h-9 w-[140px] text-xs"><SelectValue placeholder="Designation" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Designations</SelectItem>
                                {uniqueDesignations.map(d => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
                            </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" className="h-9" onClick={handleExport} disabled={isLoading}>
                            <FileDown className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Export</span>
                        </Button>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Present</CardTitle>
                        <Check className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent><div className="text-2xl font-bold">{summaryStats.present}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Avg. Work</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent><div className="text-2xl font-bold">{formatDuration(summaryStats.avgWorkDuration)}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Absent</CardTitle>
                        <X className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent><div className="text-2xl font-bold">{summaryStats.absent}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Not Arrived</CardTitle>
                        <UserX className="h-4 w-4 text-purple-500" />
                    </CardHeader>
                    <CardContent><div className="text-2xl font-bold">{summaryStats.notArrived}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">On Leave</CardTitle>
                        <Minus className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent><div className="text-2xl font-bold">{summaryStats.onLeave}</div></CardContent>
                </Card>
            </div>

            {/* Main Roster */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Roster for {selectedDate}</CardTitle>
                        <CardDescription>Showing {filteredRecords.length} of {enrichedRecords.length} staff records</CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setRefreshKey(k => k + 1)}>
                        <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    </Button>
                </CardHeader>
                <CardContent>
                    {isLoading && allAttendanceRecords.length === 0 ? (
                        <div className="space-y-4">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                    ) : loadError ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                            <p className="text-sm text-muted-foreground">{loadError}</p>
                            <Button variant="outline" onClick={() => setRefreshKey(key => key + 1)}>Try Again</Button>
                        </div>
                    ) : filteredRecords.length > 0 ? (
                        isMobile ? renderCards(filteredRecords) : renderTable(filteredRecords)
                    ) : (
                        <div className="h-48 flex items-center justify-center text-muted-foreground">
                            No records match the selected filters.
                        </div>
                    )}
                </CardContent>
            </Card>

            <AttendanceEditModal isOpen={isEditModalOpen} onOpenChange={setIsEditModalOpen} record={selectedEditRecord} onSuccess={() => setRefreshKey(k => k + 1)} />
        </div>
    );
}
