import { NextRequest } from 'next/server';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';
import { enforcePermission } from '@/lib/security';
import { formatBdPhoneWithCountryCode } from '@/lib/phone';
import { getSmsGatewaySettings, isSmsGatewayConfigured } from '@/server/utils/sms-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('settings', 'update');
    if (!allowed) return error;

    const body = await req.json().catch(() => ({} as any));
    const rawNumber = typeof body?.mobileNumber === 'string' ? body.mobileNumber : '';
    const message = typeof body?.message === 'string' ? body.message.trim() : '';

    if (!message) {
      return apiError('Message is required', 400);
    }

    const mobileNumber = formatBdPhoneWithCountryCode(rawNumber);
    if (!mobileNumber) {
      return apiError('Invalid phone number', 400);
    }

    // Load saved settings (fallback to env if missing)
    const saved = await getSmsGatewaySettings();
    const username = saved.username || process.env.NEXT_PUBLIC_MIM_SMS_USERNAME || '';
    const apiKey = saved.apiKey || process.env.NEXT_PUBLIC_MIM_SMS_API_KEY || '';
    const senderName = saved.senderName || process.env.NEXT_PUBLIC_MIM_SMS_SENDER_NAME || '';
    const enabled = typeof saved.enabled === 'boolean' ? saved.enabled : true;

    if (!enabled) {
      return apiError('SMS gateway is disabled', 400);
    }
    if (!username || !apiKey || !senderName) {
      return apiError('SMS gateway is not configured', 400);
    }

    const response = await fetch('https://api.mimsms.com/api/SmsSending/SMS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        UserName: username,
        Apikey: apiKey,
        SenderName: senderName,
        MobileNumber: mobileNumber,
        CampaignId: "null",
        TransactionType: 'T',
        Message: message,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return apiError(data?.responseResult || 'SMS request failed', response.status, data);
    }

    return apiSuccess(data, data?.responseResult || 'SMS response received');
  } catch (error: any) {
    return apiServerError(error);
  }
}
