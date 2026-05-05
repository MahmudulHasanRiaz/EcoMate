
'use client'

import * as React from 'react';
import type { StaffMember, StaffRole, Permission } from '@/types';
import { useUser } from '@clerk/nextjs';
import { PERMISSIONS } from '@/lib/permissions';
import { attachPageAccess } from '@/lib/page-access';


type PermissionsContextType = StaffMember['permissions'] | null;

const PermissionsContext = React.createContext<PermissionsContextType>(null);

function UserPermissionsProvider({ children }: { children: React.ReactNode }) {
    let user: ReturnType<typeof useUser>['user'] | null = null;
    let isLoaded = false;
    try {
        const userState = useUser();
        user = userState.user;
        isLoaded = userState.isLoaded;
    } catch {
        user = null;
        isLoaded = false;
    }
    const [permissions, setPermissions] = React.useState<PermissionsContextType>(null);

    React.useEffect(() => {
        // Don't do anything until Clerk has loaded the user object.
        if (!isLoaded) {
            setPermissions(null);
            return;
        }

        // If there's no user, there are no permissions.
        if (!user) {
            setPermissions(null);
            return;
        }

        // --- MOCK ROLE OVERRIDE FOR DEVELOPMENT ---
        if (process.env.NODE_ENV === 'development') {
            const mockRoleCookie = document.cookie.split('; ').find(row => row.startsWith('mock_role='))?.split('=')[1];
            if (mockRoleCookie && PERMISSIONS[mockRoleCookie as StaffRole]) {
                setPermissions(attachPageAccess(PERMISSIONS[mockRoleCookie as StaffRole], mockRoleCookie as StaffRole));
                console.log(`Using mock role: ${mockRoleCookie}`);
                return;
            }
        }
        // --- END OF MOCK ---

        const rawRole = user.publicMetadata.role as string | undefined;
        const dbToUiRole: Record<string, StaffRole> = {
            'PackingAssistant': 'Packing Assistant',
            'CallAssistant': 'Call Assistant',
            'CallCentreManager': 'Call Centre Manager',
            'CourierManager': 'Courier Manager',
            'CourierCallAssistant': 'Courier Call Assistant',
            'VendorSupplier': 'Vendor/Supplier',
            'CuttingMan': 'Cutting Master',
            'FinanceManager': 'Finance Manager',
            'ModaratorManager': 'Modarator Manager',
            'ProjectManager': 'Project Manager',
            'SalesRepresentative': 'Sales Representative',
        };
        const roleAliases: Record<string, StaffRole> = {
            'modarator': 'Moderator',
            'modaratorr': 'Moderator',
            'callassistant': 'Call Assistant',
            'call assistant': 'Call Assistant',
            'call asistant': 'Call Assistant',
            'callcentremanager': 'Call Centre Manager',
            'callcentermanager': 'Call Centre Manager',
            'couriercallassistant': 'Courier Call Assistant',
            'courierrcallassistant': 'Courier Call Assistant',
            'modaratormanager': 'Modarator Manager',
            'modarator manager': 'Modarator Manager',
            'projectmanager': 'Project Manager',
            'project manager': 'Project Manager',
            'salesrepresentative': 'Sales Representative',
            'sales representative': 'Sales Representative',
        };

        const normalizeRole = (rawRole?: string) => {
            if (!rawRole) return undefined;
            const aliased = roleAliases[rawRole.trim().toLowerCase()];
            const mapped = (aliased ?? dbToUiRole[rawRole] ?? rawRole).trim();
            if (PERMISSIONS[mapped as StaffRole]) return mapped as StaffRole;
            const key = Object.keys(PERMISSIONS).find(
                (r) => r.toLowerCase() === mapped.toLowerCase()
            );
            return key as StaffRole | undefined;
        };

        const role = normalizeRole(rawRole);
        const customPermissions = user.publicMetadata.permissions as StaffMember['permissions'] | undefined;

        if (role && PERMISSIONS[role] && role !== 'Custom') {
            // Use predefined permissions for standard roles.
            setPermissions(attachPageAccess(PERMISSIONS[role], role));
        } else if (role === 'Custom' && customPermissions) {
            // Use custom permissions from metadata for the 'Custom' role.
            setPermissions(attachPageAccess(customPermissions, role));
        } else {
            // Default to no permissions if no role or invalid role is found.
            setPermissions(null);
        }

    }, [user, isLoaded]);

    return (
        <PermissionsContext.Provider value={permissions}>
            {children}
        </PermissionsContext.Provider>
    );
}

export function PermissionsProvider({
    children,
    forcedPermissions = null,
}: {
    children: React.ReactNode,
    forcedPermissions?: StaffMember['permissions'] | null,
}) {
    const [hydrated, setHydrated] = React.useState(false);

    React.useEffect(() => {
        setHydrated(true);
    }, []);

    if (forcedPermissions) {
        return (
            <PermissionsContext.Provider value={forcedPermissions}>
                {children}
            </PermissionsContext.Provider>
        );
    }

    if (!hydrated) {
        return (
            <PermissionsContext.Provider value={null}>
                {children}
            </PermissionsContext.Provider>
        );
    }

    return <UserPermissionsProvider>{children}</UserPermissionsProvider>;
}

export function usePermissions() {
    const context = React.useContext(PermissionsContext);
    if (context === undefined) {
        throw new Error('usePermissions must be used within a PermissionsProvider');
    }
    return context;
}
