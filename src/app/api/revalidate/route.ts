import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

// Example: POST /api/revalidate?tag=products&secret=YOUR_SECRET_TOKEN
// This endpoint is protected by a secret token to prevent unauthorized access.

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  const tag = request.nextUrl.searchParams.get('tag');

  // 1. Check for secret token
  // Compare the secret from the request with the one in your environment variables.
  // This is crucial to prevent unauthorized cache invalidations.
  if (secret !== process.env.REVALIDATION_TOKEN) {
    return NextResponse.json({ message: 'Invalid secret' }, { status: 401 });
  }

  // 2. Check for tag
  // A tag is required to know which data cache to invalidate.
  if (!tag) {
    return NextResponse.json({ message: 'Missing tag param' }, { status: 400 });
  }

  // 3. Revalidate the cache for the given tag
  // This function will invalidate all fetch requests that have been tagged with the specified tag.
  revalidateTag(tag, 'page');

  // 4. Return a success response
  // This confirms that the revalidation request was received and processed.
  return NextResponse.json({ revalidated: true, tag, now: Date.now() });
}
