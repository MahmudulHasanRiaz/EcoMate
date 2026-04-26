import { getMaintenanceMode } from "@/server/utils/app-settings";
import { Database } from "lucide-react";

export default async function MaintenanceGuard({ children }: { children: React.ReactNode }) {
    const isMaintenance = await getMaintenanceMode();
    if (isMaintenance) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center bg-slate-50 dark:bg-slate-950">
                <div className="rounded-full bg-amber-100 p-6 dark:bg-amber-900/20 mb-6">
                    <Database className="h-12 w-12 text-amber-600 dark:text-amber-500 animate-pulse" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">System Maintenance</h1>
                <p className="text-muted-foreground max-w-md mx-auto mb-8">
                    The database is currently being restored or updated. We'll be back online in a few minutes.
                </p>
                <div className="w-16 h-1 bg-amber-500 rounded-full mx-auto animate-bounce" />
            </div>
        );
    }
    return <>{children}</>;
}
