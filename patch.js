const fs = require('fs');

// 1. Update route.ts
const routePath = 'src/app/api/attendance/route.ts';
let routeContent = fs.readFileSync(routePath, 'utf8');
routeContent = routeContent.replace(
  "import { getGeneralSettings } from '@/server/utils/app-settings';",
  "import { getGeneralSettings } from '@/server/utils/app-settings';\nimport { formatDateYmdInTz } from '@/lib/date-utils';"
);
routeContent = routeContent.replace(
  "    const { items, nextCursor } = await getAttendanceRecords({",
  `    try {
      if (from && to) {
        const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 31) {
          const currentDate = new Date(from);
          while (currentDate <= to) {
            await ensureDailyAttendanceRecords({ date: formatDateYmdInTz(currentDate, tz) });
            currentDate.setDate(currentDate.getDate() + 1);
          }
        } else {
          await ensureDailyAttendanceRecords();
        }
      } else {
        await ensureDailyAttendanceRecords();
      }
    } catch (e) {
      console.error('[API:ATTENDANCE_GET] Failed to ensure daily records:', e);
    }

    const { items, nextCursor } = await getAttendanceRecords({`
);
fs.writeFileSync(routePath, routeContent);

// 2. Update layout-client.tsx
const layoutPath = 'src/app/dashboard/layout-client.tsx';
let layoutContent = fs.readFileSync(layoutPath, 'utf8');

// A. Insert refs and role check
const layoutReplace1 = `    const timerRef = React.useRef<NodeJS.Timeout | null>(null);
    const breakTimerRef = React.useRef<NodeJS.Timeout | null>(null);

    const { user } = useUser();
    const rawRole = (user?.publicMetadata?.role as string || '').toLowerCase().trim();
    const isTargetRole = React.useMemo(() => {
        const normalized = rawRole.replace(/\\s+/g, '');
        return ['moderator', 'modaratormanager', 'callassistant', 'callcentremanager'].includes(normalized);
    }, [rawRole]);

    const lastActivityRef = React.useRef(Date.now());
    const autoPausedRef = React.useRef(false);
    const statusRef = React.useRef(status);
    React.useEffect(() => {
        statusRef.current = status;
    }, [status]);`;

// replace timerRef lines (using regex for any line endings)
layoutContent = layoutContent.replace(
  /    const timerRef = .*?null\);\r?\n    const breakTimerRef = .*?null\);/s,
  layoutReplace1
);

// B. Update handleBreak and insert auto pause/resume logic
const layoutReplace2 = `        if (status === 'on-break') {
            try {
                setIsSubmitting(true);
                await endBreak();
                setStatus('clocked-in');
                autoPausedRef.current = false;
                stopBreakTimer();
                startTimer();
            } catch (err: any) {
                toast({ variant: 'destructive', title: 'Break failed', description: err?.message || 'Unable to end break.' });
            } finally {
                setIsSubmitting(false);
            }
        }
    };

    React.useEffect(() => {
        if (!isTargetRole) return;

        const handleActivity = async () => {
             lastActivityRef.current = Date.now();

             if (autoPausedRef.current && statusRef.current === 'on-break') {
                 autoPausedRef.current = false;
                 try {
                     setIsSubmitting(true);
                     await endBreak();
                     setStatus('clocked-in');
                     stopBreakTimer();
                     startTimer();
                     toast({ title: 'Resumed', description: 'Working time resumed due to activity.' });
                 } catch (err: any) {
                     toast({ variant: 'destructive', title: 'Resume failed', description: err?.message });
                 } finally {
                     setIsSubmitting(false);
                 }
             }
        };

        const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
        let throttleTimer: NodeJS.Timeout | null = null;
        const throttledHandler = () => {
            if (!throttleTimer) {
                throttleTimer = setTimeout(() => {
                    handleActivity();
                    throttleTimer = null;
                }, 1000);
            }
        };

        events.forEach(e => window.addEventListener(e, throttledHandler, { passive: true }));
        
        const inactivityChecker = setInterval(async () => {
            const now = Date.now();
            if (now - lastActivityRef.current > 120000 && statusRef.current === 'clocked-in' && !autoPausedRef.current) {
                autoPausedRef.current = true;
                try {
                     setIsSubmitting(true);
                     await startBreak();
                     setStatus('on-break');
                     stopTimer();
                     setBreakTimer(0);
                     startBreakTimer();
                     toast({ title: 'Paused', description: 'Working time paused due to inactivity.' });
                } catch (err: any) {
                     toast({ variant: 'destructive', title: 'Pause failed', description: err?.message });
                     autoPausedRef.current = false;
                } finally {
                     setIsSubmitting(false);
                }
            }
        }, 10000);

        return () => {
            events.forEach(e => window.removeEventListener(e, throttledHandler));
            if (throttleTimer) clearTimeout(throttleTimer);
            clearInterval(inactivityChecker);
        };
    }, [isTargetRole, toast]);

    if (status === 'clocked-out') {`;

layoutContent = layoutContent.replace(
  /        if \(status === 'on-break'\) \{[\s\S]*?        \}\r?\n    \};\r?\n\r?\n    if \(status === 'clocked-out'\) \{/s,
  layoutReplace2
);

fs.writeFileSync(layoutPath, layoutContent);
