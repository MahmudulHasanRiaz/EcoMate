
'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ChevronLeft,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getProductBySlug, getCategories } from '@/services/products';
import type { Product, Category } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProductDetailsPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [product, setProduct] = React.useState<Product | undefined>(undefined);
  const [category, setCategory] = React.useState<Category | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (slug) {
      setIsLoading(true);
      Promise.all([getProductBySlug(slug), getCategories()]).then(([productData, categoriesData]) => {
        setProduct(productData);
        if (productData?.categoryId) {
          setCategory(categoriesData.find(c => c.id === productData.categoryId) || null);
        }
        setIsLoading(false);
      });
    }
  }, [slug]);


  if (isLoading) {
      return (
          <div className="container px-4 sm:px-8 py-8">
              <div className="grid md:grid-cols-2 gap-8 items-start max-w-6xl mx-auto">
                  <div className="grid gap-4">
                      <Skeleton className="aspect-square w-full" />
                      <div className="grid grid-cols-5 gap-4">
                          {[...Array(4)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}
                      </div>
                  </div>
                  <div className="space-y-6">
                      <Skeleton className="h-10 w-3/4" />
                      <Skeleton className="h-6 w-1/4" />
                      <Skeleton className="h-24 w-full" />
                      <Skeleton className="h-10 w-1/2" />
                  </div>
              </div>
          </div>
      );
  }

  if (!product) {
    return (
      <div className="container px-4 sm:px-8 text-center py-16">
        <p>Product not found.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/shop">Back to Shop</Link>
        </Button>
      </div>
    );
  }
  
  const mainImage = product.image ?? '/placeholder.svg';

  return (
    <div className="container px-4 sm:px-8 py-8">
        <div className="mb-6">
             <Button variant="outline" size="sm" asChild>
                <Link href="/shop">
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Back to Shop
                </Link>
            </Button>
        </div>
        <div className="grid md:grid-cols-2 gap-8 items-start max-w-6xl mx-auto">
            <div className="grid gap-4 md:gap-8">
                <Image
                src={mainImage}
                alt={product.name}
                width={600}
                height={600}
                className="aspect-square object-cover border w-full rounded-lg overflow-hidden"
                />
            </div>
            <div className="grid gap-6">
                <div className="space-y-2">
                    {category && <Badge variant="outline">{category.name}</Badge>}
                    <h1 className="text-3xl font-bold">{product.name}</h1>
                    <p className="text-3xl font-bold">৳{product.price.toFixed(2)}</p>
                </div>
                
                <Card>
                    <CardHeader>
                        <CardTitle>Description</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">{product.description}</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    </div>
  );
}
