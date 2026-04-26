
'use client';

import * as React from 'react';
import {
    Package,
    CheckCircle,
    XCircle,
    History,
    Truck,
    FileText,
    Edit,
    PackageSearch,
    Clock,
    User,
    UserCheck,
    AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { OrderLog, OrderStatus } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';

const statusIcons: Record<string, React.ElementType> = {
    'New': Package,
    'Confirmed': CheckCircle,
    'Canceled': XCircle,
    'C2C': XCircle,
    'Hold': History,
    'In-Courier': Truck,
    'RTS (Ready to Ship)': PackageSearch,
    'Shipped': Truck,
    'Delivered': CheckCircle,
    'Returned': History,
    'Return Pending': History,
    'Partial': Truck,
    'Damaged': AlertCircle,
    'Notes updated': FileText,
    'Order Edited': Edit,
    'Sent to Pathao': Truck,
    'Packing Hold': Clock,
};

export function OrderTimeline({ logs }: { logs: OrderLog[] }) {
    const [isClient, setIsClient] = React.useState(false);
    const legacyDelimiter = '\u2192';
    const currentDelimiter = ' -> ';

    React.useEffect(() => {
        setIsClient(true);
    }, []);

    const sortedLogs = React.useMemo(
        () => [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        [logs]
    );

    return (
        <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border -translate-x-1/2"></div>
            {isClient ? (
                <ul className="space-y-6">
                    {sortedLogs.map((log, index) => {
                        const Icon = statusIcons[log.title] || History;
                        const isLast = index === sortedLogs.length - 1;
                        const isFirst = index === 0;

                        // Parse description for rich display if it contains diffs
                        const descParts = log.description.split(' | ');

                        return (
                            <li key={`${log.id || log.timestamp}-${index}`} className="relative flex items-start gap-4 group">
                                <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center bg-background border-2 z-10 shrink-0 transition-colors",
                                    isFirst ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
                                    "group-hover:border-primary/50"
                                )}>
                                    <Icon className="h-4 w-4" />
                                </div>
                                <div className="flex-1 pt-0.5 pb-2">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                                        <p className={cn("font-semibold text-sm", isFirst ? "text-foreground" : "text-muted-foreground")}>
                                            {log.title}
                                        </p>
                                        <span className="text-[10px] text-muted-foreground/80 font-mono">
                                            {format(new Date(log.timestamp), "MMM d, h:mm a")}
                                        </span>
                                    </div>

                                    <div className="space-y-1">
                        {descParts.map((part, i) => {
                            const normalizedPart = part.includes(legacyDelimiter)
                                ? part.split(legacyDelimiter).join(currentDelimiter)
                                : part;
                            const hasDiff = normalizedPart.includes(currentDelimiter);
                            return (
                                            <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                                                {hasDiff ? (
                                                    <span className="flex flex-wrap items-center gap-1.5 leading-none">
                                                        {normalizedPart.split(currentDelimiter).map((side, j) => (
                                                            <React.Fragment key={j}>
                                                                {j > 0 && <span className="text-primary/40 font-bold shrink-0">-&gt;</span>}
                                                                <span className={cn(
                                                                    "px-1.5 py-0.5 rounded text-[11px]",
                                                                    j === 0 ? "bg-red-50 text-red-700/80 line-through decoration-red-300" : "bg-green-50 text-green-700 font-medium"
                                                                )}>
                                                                    {side.trim()}
                                                                </span>
                                                            </React.Fragment>
                                                        ))}
                                                    </span>
                                                ) : normalizedPart}
                                            </p>
                                        );
                                    })}
                                    </div>

                                    {log.user && (
                                        <div className="mt-2 flex items-center gap-1.5">
                                            <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center overflow-hidden border border-border/50">
                                                {log.staff?.id ? (
                                                    <div className="bg-primary/10 text-[8px] font-bold text-primary flex items-center justify-center w-full h-full">
                                                        {log.user.charAt(0).toUpperCase()}
                                                    </div>
                                                ) : (
                                                    <User className="w-2.5 h-2.5 text-muted-foreground" />
                                                )}
                                            </div>
                                            <span className="text-[11px] font-medium text-muted-foreground/70">
                                                {log.user}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <div className="space-y-8">
                    {logs.map((log, i) => (
                        <div key={`${log.timestamp}-${i}`} className="flex items-start gap-4">
                            <Skeleton className="w-8 h-8 rounded-full" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-1/3" />
                                <Skeleton className="h-4 w-2/3" />
                                <Skeleton className="h-3 w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
