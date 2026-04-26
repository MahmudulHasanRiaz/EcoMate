
import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import mime from 'mime';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path: pathArray } = await params;

        // Safety check against traversal
        const filename = pathArray.join('/');
        if (filename.includes('..') || filename.includes('\0')) {
            return new NextResponse('Forbidden', { status: 403 });
        }

        const uploadsDir = join(process.cwd(), 'public/uploads');
        const filePath = join(uploadsDir, filename);

        try {
            // Check if file exists
            const fileStat = await stat(filePath);
            if (!fileStat.isFile()) {
                return new NextResponse('Not Found', { status: 404 });
            }

            // Read file
            const fileBuffer = await readFile(filePath);

            // Determine content type
            const contentType = mime.getType(filePath) || 'application/octet-stream';

            // Serve file
            return new NextResponse(fileBuffer, {
                headers: {
                    'Content-Type': contentType,
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
            });

        } catch (err) {
            // File not found or other read error
            return new NextResponse('Not Found', { status: 404 });
        }

    } catch (error) {
        console.error('[UPLOADS_SERVE_ERROR]', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
