import type { Permission } from '@/types';

export const permissionActions: (keyof Permission)[] = ['create', 'read', 'update', 'delete'];
