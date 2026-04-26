

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

  const mainImage = product.image ?? DEFAULT_PLACEHOLDER;

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
              priority
            />
            {!product.inventory && (
              <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] flex items-center justify-center">
                <Badge variant="destructive" className="text-sm px-4 py-1.5 rounded-full uppercase tracking-widest shadow-xl font-bold">
                  Out of Stock
                </Badge>
              </div>
            )}
          </div>
          {product.images && product.images.length > 1 && (
            <div className="grid grid-cols-5 gap-2 sm:gap-3">
              {product.images.map((img, idx) => (
                <div key={idx} className="relative aspect-square rounded-lg sm:rounded-xl border overflow-hidden cursor-pointer hover:ring-2 ring-primary transition-all">
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
            <div className="flex items-center gap-3">
              {product.salePrice && product.salePrice > 0 ? (
                <div className="flex items-center gap-3">
                  <span className="text-2xl sm:text-3xl font-bold text-primary">৳{product.salePrice.toLocaleString()}</span>
                  <span className="text-sm sm:text-lg text-muted-foreground line-through opacity-40">৳{product.price.toLocaleString()}</span>
                </div>
              ) : (
                <span className="text-2xl sm:text-3xl font-bold text-foreground">৳{product.price.toLocaleString()}</span>
              )}
            </div>
          </div>

          <div className="h-px bg-border/40" />

          {/* Availability Status */}
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
            <div className={cn(
              "h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full",
              product.inventory > 0 ? "bg-emerald-500 animate-pulse" : "bg-red-500"
            )} />
            <span className={cn(
              product.inventory > 0 ? "text-emerald-600" : "text-red-600"
            )}>
              {product.inventory > 0 ? 'Available in Shop' : 'Temporarily Out of Stock'}
            </span>
          </div>

          {/* Variants */}
          {product.productType === 'variable' && product.variants?.length > 0 && (
            <div className="space-y-3 sm:space-y-4">
              <h3 className="font-bold text-[10px] sm:text-xs text-muted-foreground uppercase tracking-widest px-0.5">Specifications</h3>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {product.variants.map((v) => (
                  <div
                    key={v.id}
                    className={cn(
                      "group flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl border transition-all text-[11px] sm:text-xs font-semibold",
                      v.inventory > 0
                        ? "bg-muted/30 border-muted-foreground/10"
                        : "bg-muted/5 border-dashed border-muted text-muted-foreground line-through opacity-60"
                    )}
                  >
                    <span>{v.name}</span>
                    {v.inventory > 0 && (
                      <div className="h-1 w-1 rounded-full bg-emerald-500" />
                    )}
                  </div>
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
