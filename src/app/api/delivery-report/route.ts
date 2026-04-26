
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { requirePermission } = await import('@/server/auth/guards');
  const { checkRateLimit } = await import('@/server/utils/rate-limit');

  // Guard
  let user: any;
  try {
    user = await requirePermission('courierReport', 'read');
  } catch (error: any) {
    if (error?.name === 'PermissionError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[DELIVERY_REPORT_GUARD_ERROR]', error);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate Limit (External API protection)
  if (!await checkRateLimit(`report:${user.id}`, 20, 60)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const { searchParams } = new URL(request.url);
  const phone = searchParams.get('phone');

  if (!phone) {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
  }

  // Mock data for testing purposes
  if (phone === '01234567890') {
    const mockReport = {
      Summaries: {
        "Steadfast": {
          "Total Parcels": 218,
          "Delivered Parcels": 2,
          "Canceled Parcels": 216,
        },
        "RedX": {
          "Total Parcels": 0,
          "Delivered Parcels": 0,
          "Canceled Parcels": 0,
        },
        "Pathao": {
          "Total Delivery": 0,
          "Successful Delivery": 0,
          "Canceled Delivery": 0,
        },
        "Carrybee": {
          "Total Delivery": 0,
          "Successful Delivery": 0,
          "Canceled Delivery": 0,
        }
      },
      totalSummary: {
        "Total Parcels": 218,
        "Delivered Parcels": 2,
        "Canceled Parcels": 216,
      }
    };
    return NextResponse.json(mockReport);
  }
  const { fetchCourierReport } = await import('@/server/utils/courier');

  try {
    const report = await fetchCourierReport(phone, { throwOnError: true });

    if (!report) {
      return NextResponse.json({ error: 'Invalid phone number.' }, { status: 400 });
    }

    return NextResponse.json(report);
  } catch (error: any) {
    const code = error?.code;
    if (code === 'COURIER_REPORT_DISABLED') {
      return NextResponse.json({ error: error.message, code }, { status: 503 });
    }
    if (code === 'COURIER_API_KEY_MISSING') {
      return NextResponse.json({ error: error.message, code }, { status: 503 });
    }
    if (code === 'HOORIN_HTTP_ERROR') {
      return NextResponse.json({ error: error.message, code }, { status: 502 });
    }

    console.error('Internal server error while fetching delivery report:', error);
    return NextResponse.json({ error: 'An internal error occurred.' }, { status: 500 });
  }
}
