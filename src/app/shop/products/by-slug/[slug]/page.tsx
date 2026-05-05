

'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ChevronLeft,
  ShoppingBag,
  MessageCircle,
  CheckCircle2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getProductBySlug, getShopCategories } from '@/services/products';
import type { Product, Category } from '@/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { PlaceHolderImages } from '@/lib/placeholder-images';

const DEFAULT_PLACEHOLDER = PlaceHolderImages[0].imageUrl;

export default function ProductDetailsPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [selectedVariantId, setSelectedVariantId] = React.useState<string | null>(null);
  const [product, setProduct] = React.useState<Product | undefined>(undefined);
  const [category, setCategory] = React.useState<Category | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (slug) {
      setIsLoading(true);
      getShopCategories().then(categoriesData => {
        getProductBySlug(slug).then(productData => {
          setProduct(productData);
          if (productData?.categoryId) {
            setCategory(categoriesData.find(c => c.id === productData.categoryId) || null);
          }
          setIsLoading(false);
        });
      });
    }
  }, [slug]);

  const selectedVariant = React.useMemo(() =>
    product?.variants?.find(v => v.id === selectedVariantId),
    [product, selectedVariantId]
  );

  if (isLoading) {
    return (
      <div className="container px-4 sm:px-8 py-8">
        <div className="grid md:grid-cols-2 gap-8 items-start max-w-6xl mx-auto">
          <div className="grid gap-4">
            <Skeleton className="aspect-square w-full rounded-2xl" />
            <div className="grid grid-cols-5 gap-4">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="aspect-square w-full rounded-lg" />)}
            </div>
          </div>
          <div className="space-y-6">
            <Skeleton className="h-10 w-3/4 rounded-lg" />
            <Skeleton className="h-6 w-1/4 rounded-md" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container px-4 sm:px-8 text-center py-24">
        <div className="max-w-md mx-auto space-y-4">
          <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center mx-auto">
            <ShoppingBag className="h-10 w-10 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold">Product not found</h2>
          <p className="text-muted-foreground">The product you're looking for might have been removed or is temporarily unavailable.</p>
          <Button asChild variant="default" className="mt-4 rounded-full px-8">
            <Link href="/shop">Back to Shop</Link>
          </Button>
        </div>
      </div>
    );
  }

  const mainImage = selectedVariant?.image || product.image || DEFAULT_PLACEHOLDER;

  return (
    <div className="container px-4 sm:px-8 py-4 sm:py-12">
      <div className="grid md:grid-cols-2 gap-8 lg:gap-16 items-start max-w-7xl mx-auto">
        {/* Left: Image Gallery */}
        <div className="grid gap-4 sticky top-24">
          <div className="relative aspect-square overflow-hidden rounded-2xl sm:rounded-3xl border bg-white shadow-sm transition-all">
            <Image
              src={mainImage}
              alt={product.name}
              fill
              className="object-cover transition-transform duration-500 hover:scale-105"
              key={mainImage} // Force re-render on image change for smooth transition
              priority
            />
          </div>
          {product.images && product.images.length > 1 && (
            <div className="grid grid-cols-5 gap-2 sm:gap-3">
              {product.images.map((img, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "relative aspect-square rounded-lg sm:rounded-xl border overflow-hidden cursor-pointer hover:ring-2 ring-primary transition-all",
                    mainImage === img.url && "ring-2 ring-primary"
                  )}
                  onClick={() => setSelectedVariantId(null)}
                >
                  <Image src={img.url} alt={`${product.name} - ${idx}`} fill className="object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Product Info */}
        <div className="flex flex-col gap-5 lg:gap-8">
          <div className="space-y-3 sm:space-y-4">
            {category && (
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-primary/60 bg-primary/5 px-2 py-0.5 rounded-full border border-primary/10 w-fit">
                {category.name}
              </span>
            )}
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground leading-tight">
              {product.name}
            </h1>
            <div className="flex flex-wrap items-center gap-4">
              {product.salePrice && product.salePrice > 0 ? (
                <div className="flex items-center gap-3">
                  <span className="text-2xl sm:text-3xl font-bold text-primary">৳{product.salePrice.toLocaleString()}</span>
                  <span className="text-sm sm:text-lg text-muted-foreground line-through opacity-40">৳{product.price.toLocaleString()}</span>
                </div>
              ) : (
                <span className="text-2xl sm:text-3xl font-bold text-foreground">৳{product.price.toLocaleString()}</span>
              )}
              
              {product.wholesaleEnabled && product.wholesaleVisible && (
                <div className="flex flex-col">
                  <Badge variant="outline" className="text-[10px] sm:text-xs font-bold text-primary border-primary/30 bg-primary/5 px-2 py-0.5 rounded-md">
                    WS: ৳{(selectedVariant?.wholesalePrice || product.wholesalePrice || 0).toLocaleString()}
                  </Badge>
                  {product.wholesaleMinQuantity && (
                    <span className="text-[8px] text-muted-foreground ml-1 uppercase tracking-tighter">Min: {product.wholesaleMinQuantity} {product.wholesaleUnitLabel || 'Pcs'}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-border/40" />

          {/* Availability Status */}
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
            <div className={cn(
              "h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full",
              (selectedVariantId ? (selectedVariant?.inventory ?? 0) > 0 : product.inventory > 0) ? "bg-emerald-500 animate-pulse" : "bg-red-500"
            )} />
            <span className={cn(
              (selectedVariantId ? (selectedVariant?.inventory ?? 0) > 0 : product.inventory > 0) ? "text-emerald-600" : "text-red-600"
            )}>
              {(selectedVariantId ? (selectedVariant?.inventory ?? 0) > 0 : product.inventory > 0) ? 'Available in Shop' : 'Temporarily Out of Stock'}
            </span>
          </div>

          {/* Variants */}
          {product.productType === 'variable' && product.variants?.length > 0 && (
            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between px-0.5">
                <h3 className="font-bold text-[10px] sm:text-xs text-muted-foreground uppercase tracking-widest">Specifications</h3>
                {product.wholesaleVisible && (
                  <div className="text-[10px] font-bold text-primary/70 bg-primary/5 px-2 py-0.5 rounded border border-primary/10">
                    WS: ৳{(selectedVariant?.wholesalePrice || product.wholesalePrice || 0).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariantId(v.id)}
                    className={cn(
                      "group flex flex-col items-start gap-0.5 px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl border transition-all text-left",
                      selectedVariantId === v.id
                        ? "bg-primary/5 border-primary ring-1 ring-primary/20"
                        : "bg-muted/30 border-muted-foreground/10 hover:border-primary/40",
                      v.inventory <= 0 && "opacity-60"
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold">
                      <span>{(v.attributes && Object.keys(v.attributes).length > 0) ? Object.values(v.attributes).join(', ') : v.name}</span>
                      {v.inventory > 0 ? (
                        <div className="h-1 w-1 rounded-full bg-emerald-500" />
                      ) : (
                        <div className="h-1 w-1 rounded-full bg-red-500" />
                      )}
                    </div>
                    {v.wholesalePrice && v.wholesalePrice !== product.wholesalePrice && (
                      <span className="text-[9px] text-muted-foreground/70 font-bold">৳{v.wholesalePrice.toLocaleString()} (WS)</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Description Section */}
          <div className="space-y-2 sm:space-y-3 pt-2">
            <h3 className="font-bold text-[10px] sm:text-xs text-muted-foreground uppercase tracking-widest px-0.5">Details</h3>
            <div className="text-xs sm:text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap max-w-none px-0.5">
              {product.description || "No detailed description available."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
