import { NextRequest, NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { listShiftTemplates, createShiftTemplate, updateShiftTemplate, deleteShiftTemplate, getStaffShiftOverride, upsertStaffShiftOverride, deleteStaffShiftOverride } from '@/server/modules/shifts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status === 'blocked') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view'); // 'templates' | 'staff-override'

    if (view === 'staff-override') {
      const staffId = searchParams.get('staffId');
      if (!staffId) return NextResponse.json({ error: 'staffId required' }, { status: 400 });
      const override = await getStaffShiftOverride(staffId);
      return NextResponse.json(override);
    }

    // Default: list templates
    const templates = await listShiftTemplates();
    return NextResponse.json(templates);
  } catch (error: any) {
    console.error('[API:SHIFTS_GET]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { allowed } = await enforcePermission('attendance', 'create');
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const { action } = body;

    if (action === 'createTemplate') {
      const result = await createShiftTemplate(body);
      return NextResponse.json(result);
    }

    if (action === 'updateTemplate') {
      const { id, ...data } = body;
      const result = await updateShiftTemplate(id, data);
      return NextResponse.json(result);
    }

    if (action === 'deleteTemplate') {
      await deleteShiftTemplate(body.id);
      return NextResponse.json({ ok: true });
    }

    if (action === 'upsertStaffOverride') {
      const result = await upsertStaffShiftOverride(body.staffId, body);
      return NextResponse.json(result);
    }

    if (action === 'deleteStaffOverride') {
      await deleteStaffShiftOverride(body.staffId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[API:SHIFTS_POST]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
