
import { COURIER_SERVICES } from '@/lib/courier-services';
import { WooCommerceIntegration, CourierIntegration, CourierService } from '@/types';

export async function getWooCommerceIntegrations(): Promise<WooCommerceIntegration[]> {
    try {
        const res = await fetch('/api/settings/integrations/woo', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load integrations');
        return res.json();
    } catch (error) {
        console.error('[SERVICE_ERROR:getWooCommerceIntegrations]', error);
        return [];
    }
}

export async function getCourierIntegrations(): Promise<CourierIntegration[]> {
    try {
        const res = await fetch('/api/settings/integrations/courier', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load courier integrations');
        return res.json();
    } catch (error) {
        console.error('[SERVICE_ERROR:getCourierIntegrations]', error);
        return [];
    }
}

export async function getCourierServices(): Promise<CourierService[]> {
    return Promise.resolve(COURIER_SERVICES);
}
