import { handleApiResponse } from '@/lib/api-helper';

export type SmsSendResponse = {
    statusCode: string;
    status: "Success" | "Failed";
    trxnId: string;
    responseResult: string;
};

export async function sendSms(mobileNumber: string, message: string): Promise<SmsSendResponse> {
    const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber, message }),
    });
    return handleApiResponse<SmsSendResponse>(res);
}
