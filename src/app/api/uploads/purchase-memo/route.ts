import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const uploadsDir = join(process.cwd(), 'public/uploads');

function slugifyFilename(filename: string) {
  const dotIndex = filename.lastIndexOf('.');
  const ext = dotIndex > -1 ? filename.slice(dotIndex) : '';
  const base = (dotIndex > -1 ? filename.slice(0, dotIndex) : filename)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const suffix = Date.now().toString(36);
  return `${base || 'file'}-${suffix}${ext || '.bin'}`;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported file type.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    await mkdir(uploadsDir, { recursive: true });
    const filename = slugifyFilename(file.name);
    const filePath = join(uploadsDir, filename);
    console.log('[API:UPLOAD] Writing file to:', filePath);
    await writeFile(filePath, buffer);

    return NextResponse.json({ url: `/uploads/${filename}` });
  } catch (error) {
    console.error('[API:UPLOAD_PURCHASE_MEMO]', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
