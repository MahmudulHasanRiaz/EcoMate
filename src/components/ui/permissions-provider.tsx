
'use client'

import * as React from 'react';
import type { StaffMember, StaffRole, Permission } from '@/types';
import { useUser } from '@clerk/nextjs';
import { PERMISSIONS } from '@/lib/permissions';


type PermissionsContextType = StaffMember['permissions'] | null;

const PermissionsContext = React.createContext<PermissionsContextType>(null);

export function PermissionsProvider({ 
    children,
}: { 
    children: React.ReactNode,
}) {
    const { user } = useUser();
    const [permissions, setPermissions] = React.useState<PermissionsContextType>(null);
    
    React.useEffect(() => {
        if (user && user.publicMetadata) {
            const role = user.publicMetadata.role as StaffRole | undefined;
            const customPermissions = user.publicMetadata.permissions as StaffMember['permissions'] | undefined;

            if (role && PERMISSIONS[role] && role !== 'Custom') {
                setPermissions(PERMISSIONS[role]);
            } else if (customPermissions) {
                setPermissions(customPermissions);
            } else {
                setPermissions(null); // No permissions
            }
        } else if(user) {
            setPermissions(null); // User exists but no metadata
        }
    }, [user]);

    return (
        <PermissionsContext.Provider value={permissions}>
            {children}
        </PermissionsContext.Provider>
    );
}

export function usePermissions() {
    const context = React.useContext(PermissionsContext);
    if (context === undefined) {
        throw new Error('usePermissions must be used within a PermissionsProvider');
    }
    return context;
}
