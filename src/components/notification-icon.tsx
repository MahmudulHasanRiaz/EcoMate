
import {
    Bell,
    ShoppingCart,
    Warehouse,
    Archive,
    AlertCircle,
    User,
    LucideProps
} from 'lucide-react';
import React from 'react';

const icons = {
    Bell,
    ShoppingCart,
    Warehouse,
    Archive,
    AlertCircle,
    User,
};

export type NotificationIconName = keyof typeof icons;

interface NotificationIconProps extends LucideProps {
    name: string;
}

export function NotificationIcon({ name, ...props }: NotificationIconProps) {
    const Icon = icons[name as NotificationIconName] || Bell;
    return <Icon {...props} />;
}
