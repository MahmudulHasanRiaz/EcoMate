
import { NextResponse } from 'next/server';
import { validateProductSlug } from '@server/modules/products-api';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  const productId = searchParams.get('productId'); // Optional, for excluding the current product in edit mode

  if (!slug) {
    return NextResponse.json({ message: 'Slug is required.' }, { status: 400 });
  }

  try {
    const result = await validateProductSlug({ slug, productId: productId || undefined });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API_ERROR:VALIDATE_SLUG]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
