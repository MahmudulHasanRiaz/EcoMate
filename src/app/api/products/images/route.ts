import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const DEFAULT_PLACEHOLDER = '/placeholder.svg';

function normalizeImageUrl(input?: string | null) {
  if (!input) return DEFAULT_PLACEHOLDER;
  const trimmed = String(input).trim();
  if (!trimmed) return DEFAULT_PLACEHOLDER;

  // Absolute URL: try to extract a safe pathname
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      // If it contains /uploads, prefer the pathname
      if (u.pathname?.startsWith('/uploads/')) {
        return u.pathname;
      }
      return trimmed;
    } catch {
      return trimmed;
    }
  }

  // Local path but missing leading slash
  return trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
}

// GET all unique image URLs from products
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pageSizeParam = Number(searchParams.get('pageSize') || '0');
    const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0
      ? Math.min(pageSizeParam, 500)
      : 120;
    const cursor = searchParams.get('cursor') || undefined;

    const productsWithImages = await prisma.product.findMany({
      where: {
        image: {
          not: null,
        },
      },
      select: {
        id: true,
        image: true,
      },
      orderBy: { id: 'asc' },
      take: pageSize,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
    });

    const imageUrls = new Set<string>();

    productsWithImages.forEach(p => {
      if (p.image && typeof p.image === 'string') {
        try {
          const images = JSON.parse(p.image) as { url: string, id: string }[];
          if (images && Array.isArray(images)) {
            images.forEach((img) => {
              const normalized = normalizeImageUrl(img?.url);
              if (normalized && normalized !== DEFAULT_PLACEHOLDER) {
                imageUrls.add(normalized);
              }
            });
          }
        } catch (e) {
          const normalized = normalizeImageUrl(p.image);
          if (normalized && normalized !== DEFAULT_PLACEHOLDER) {
            imageUrls.add(normalized);
          }
        }
      }
    });

    const nextCursor = productsWithImages.length === pageSize
      ? productsWithImages[productsWithImages.length - 1].id
      : null;

    return NextResponse.json({ items: Array.from(imageUrls), nextCursor });
  } catch (error) {
    console.error("[API_ERROR:GET_PRODUCT_IMAGES]", error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
