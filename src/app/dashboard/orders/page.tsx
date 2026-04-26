
import { redirect } from 'next/navigation';

// This page will instantly redirect to the /all sub-route.
// It exists to handle the case where a user navigates to /dashboard/orders directly.
export default function OrdersPage() {
    redirect('/dashboard/orders/all');
}
