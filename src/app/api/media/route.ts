import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

type MediaItem = {
  url: string;
  id: string;
  size: number;
  updatedAt: string;
};

const uploadsDir = join(process.cwd(), 'public/uploads');

export async function GET() {
  try {
    const entries = await readdir(uploadsDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile());

    const items: MediaItem[] = [];

    for (const file of files) {
      const filePath = join(uploadsDir, file.name);
      try {
        const s = await stat(filePath);
        items.push({
          url: `/uploads/${file.name}`,
          id: file.name,
          size: s.size,
          updatedAt: s.mtime.toISOString(),
        });
      } catch (err) {
        console.warn('[MEDIA_STAT_ERROR]', file.name, err);
      }
    }

    // Newest first
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    return NextResponse.json(items);
  } catch (error) {
    console.error('[API_ERROR:MEDIA_LIST]', error);
    // Gracefully degrade with empty list to avoid client crashes
    return NextResponse.json([], { status: 200 });
  }
}
