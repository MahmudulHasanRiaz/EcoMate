'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ChevronLeft,
  Edit,
  Star,
  CheckCircle,
  XCircle,
  Tag,
  Warehouse,
  Package,
  History,
  Boxes,
} from 'lucide-react';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { getProductById, getCategories } from '@/services/products';
import { getInventory } from '@/services/inventory';
import type {
  Product,
  ProductVariant,
  Category,
  ProductLog,
  InventoryItem,
  ProductImage,
} from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { placeholderImages } from '@/lib/placeholder-images-data';

interface VariantWithStock extends ProductVariant {
  stock: number;
}

const statusIcons: Record<string, React.ElementType> = {
  'Price updated': CheckCircle,
  'Stock adjusted': Warehouse,
  'Name updated': Edit,
  'Description updated': Edit,
  'Main image updated': Package,
};

// Safe placeholder: always a plain string URL
const rawPlaceholder = placeholderImages.find((p) => p.id === '1')?.imageUrl;
const DEFAULT_PLACEHOLDER =
  typeof rawPlaceholder === 'string'
    ? rawPlaceholder
    : 'https://placehold.co/600x400/e2e8f0/e2e8f0';

// Normalize any image value to a valid string URL for next/image
function getProductImageSrc(image: unknown): string {
  if (typeof image === 'string') {
    const trimmed = image.trim();

    // একদম গারবেজ / আগের bug থেকে আসা মান
    if (
      !trimmed ||
      trimmed === '[object Object]' ||
      trimmed.toLowerCase().includes('object object')
    ) {
      return DEFAULT_PLACEHOLDER;
    }

    // Already absolute URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }

    // Local path but missing leading slash — prepend it
    if (!trimmed.startsWith('/')) {
      return '/' + trimmed.replace(/^\/+/, '');
    }

    // Already something like "/uploads/..."
    return trimmed;
  }

  // Anything else (object, null, undefined, empty) → fallback placeholder
  return DEFAULT_PLACEHOLDER;
}

import { getProductLogs } from '@/services/product-logs';

function ProductHistory({ initialLogs, productId }: { initialLogs: ProductLog[], productId: string }) {
  const [logs, setLogs] = React.useState<ProductLog[]>(initialLogs);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(initialLogs.length >= 5);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [initialized, setInitialized] = React.useState(false);

  // If initialLogs comes from server without cursor info, we might need to fetch first batch to get cursor
  // OR we assume initialLogs is just the plain list.
  // Actually, getProductById includes logs but maybe not cursor. 
  // Ideally, we should fetch logs separately or assume first batch is loaded and next call is with cursor of last item.
  // But getProductLogs uses id as cursor. So safe to use last item's id as cursor if we don't have explicit nextCursor.

  const handleLoadMore = async () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const cursor = nextCursor || (logs.length > 0 ? logs[logs.length - 1].id : undefined);
      if (!cursor) return;

      const result = await getProductLogs(productId, { cursor, pageSize: 5 });

      if (result.items.length > 0) {
        setLogs(prev => {
          const seen = new Set(prev.map(l => l.id));
          return [...prev, ...result.items.filter((l: ProductLog) => !seen.has(l.id))];
        });
        setNextCursor(result.nextCursor || null);
        setHasMore(!!result.nextCursor);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Failed to load more logs", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  React.useEffect(() => {
    // If initialLogs passed, we might want to check if there is more.
    // If we have <= 5 items, maybe we are done.
    if (initialLogs.length > 0 && initialLogs.length < 5) {
      setHasMore(false);
    }
  }, [initialLogs]);

  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Product History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No history found for this product.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" /> Product History
        </CardTitle>
        <CardDescription>
          A log of all changes made to this product.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border -translate-x-1/2"></div>
          <ul className="space-y-6">
            {logs.map((log, index) => {
              const Icon = statusIcons[log.action] || History;
              const isLast = index === 0;
              return (
                <li key={log.id} className="relative flex items-start gap-4">
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center bg-background border-2',
                      isLast ? 'border-primary' : 'border-border',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4',
                        isLast ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                  </div>
                  <div className="flex-1 pt-1">
                    <p
                      className={cn(
                        'font-medium',
                        isLast ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {log.action}
                    </p>
                    {log.details && (
                      <p className="text-sm text-muted-foreground">
                        {log.details}
                      </p>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      {log.timestamp && (
                        <span>
                          {format(
                            new Date(log.timestamp),
                            'MMM d, yyyy, h:mm a',
                          )}
                        </span>
                      )}
                      {log.user && (
                        <span className="font-medium"> by {log.user}</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div className="mt-4 text-center pl-8">
              <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading...' : 'Load Older History'}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProductDetailsPage() {
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = React.useState<Product | undefined>(undefined);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [variantsWithStock, setVariantsWithStock] = React.useState<
    VariantWithStock[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [activeImage, setActiveImage] = React.useState<string>('');
  const [totalStock, setTotalStock] = React.useState<number>(0);
  const [settings, setSettings] = React.useState<any>(null);

  const currencySymbol = settings?.currency === 'USD' ? '$' : '৳';

  React.useEffect(() => {
    if (productId) {
      setIsLoading(true);
      // Fetch specifically for this product
      Promise.all([
        getProductById(productId),
        getCategories(),
        getInventory({ productId, pageSize: 100 }), // Filtered fetch
        fetch('/api/settings/general').then(r => r.json()).catch(() => ({}))
      ]).then(
        ([productData, categoriesData, inventoryResponse, settingsData]) => {
          setProduct(productData);
          setSettings(settingsData);

          // inventoryResponse is now { items: ..., nextCursor: ... }
          const inventoryData = inventoryResponse.items || [];

          if (productData) {
            // Resolve categories from categoryIds (multi) or fallback to categoryId (single)
            const catIds = productData.categoryIds?.length
              ? productData.categoryIds
              : productData.categoryId ? [productData.categoryId] : [];
            if (catIds.length > 0) {
              setCategories(categoriesData.filter(c => catIds.includes(c.id)));
            }

            let calculatedTotal = 0;

            if (productData.variants) {
              const variantsData = productData.variants.map((variant) => {
                const stock = inventoryData
                  .filter((item) => item.sku === variant.sku || item.variantId === variant.id)
                  // Note: getInventory groups by product/variant/location. 
                  // If we filter by product, we get all its entries.
                  // We sum quantity across locations.
                  .reduce((sum, item) => sum + item.quantity, 0);
                return { ...variant, stock };
              });
              setVariantsWithStock(variantsData);

              if (productData.productType === 'variable') {
                calculatedTotal = variantsData.reduce((sum, v) => sum + v.stock, 0);
              }
            }

            if (productData.productType !== 'variable') {
              // Simple or Combo
              calculatedTotal = inventoryData
                .reduce((sum, item) => sum + item.quantity, 0);
            }

            setTotalStock(calculatedTotal);

            // Prefer first gallery image URL, then main image, then placeholder
            const initialImage =
              (productData.images && productData.images.length > 0
                ? productData.images[0]?.url
                : productData.image) ?? DEFAULT_PLACEHOLDER;

            setActiveImage(getProductImageSrc(initialImage));
          }

          setIsLoading(false);
        },
      );
    }
  }, [productId]);

  const stockStatus = (quantity: number) => {
    if (quantity > 10)
      return { text: 'In Stock', icon: CheckCircle, color: 'text-green-600' };
    if (quantity > 0)
      return { text: 'Low Stock', icon: XCircle, color: 'text-yellow-600' };
    return { text: 'Out of Stock', icon: XCircle, color: 'text-red-600' };
  };

  const thumbnailGallery = React.useMemo(() => {
    if (!product || !product.images) return [];
    return product.images;
  }, [product]);

  if (isLoading) {
    return <div className="p-6">Loading product...</div>;
  }

  if (!product) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 lg:gap-6 lg:p-6">
        <p>Product not found.</p>
        <Button asChild variant="outline">
          <Link href="/dashboard/products">Back to Products</Link>
        </Button>
      </div>
    );
  }

  const currentStockStatus = stockStatus(totalStock);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" className="h-7 w-7" asChild>
          <Link href="/dashboard/products">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Back</span>
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="font-headline text-xl font-semibold sm:text-2xl">
            {product.name}
          </h1>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/dashboard/products/${product.id}/edit`}>
            <Edit className="mr-2 h-4 w-4" />
            Edit Product
          </Link>
        </Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 items-start max-w-7xl mx-auto">
        <div className="md:col-span-1 lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          <div className="grid gap-4">
            <Image
              src={getProductImageSrc(activeImage)}
              alt={product.name}
              width={600}
              height={600}
              className="aspect-square object-cover border w-full rounded-lg overflow-hidden"
            />
            <div className="grid grid-cols-5 gap-4">
              {thumbnailGallery.map((image, index) => (
                <button
                  key={image.id || image.url || index}
                  className={cn(
                    'border rounded-lg overflow-hidden aspect-square',
                    activeImage === image.url ? 'ring-2 ring-primary' : '',
                  )}
                  type="button"
                  onClick={() =>
                    setActiveImage(getProductImageSrc(image.url))
                  }
                >
                  <Image
                    src={getProductImageSrc(image.url)}
                    alt={`Thumbnail for ${product.name}`}
                    width={100}
                    height={100}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{product.name}</CardTitle>
                <CardDescription>
                  <div className="flex items-center gap-2 mt-2">
                    <currentStockStatus.icon
                      className={cn(
                        'h-4 w-4',
                        currentStockStatus.color,
                      )}
                    />
                    <span
                      className={cn(
                        'font-medium',
                        currentStockStatus.color,
                      )}
                    >
                      {currentStockStatus.text}
                    </span>
                    <span className="text-muted-foreground">
                      ({totalStock} units available)
                    </span>
                  </div>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  {product.salePrice && product.salePrice > 0 ? (
                    <>
                      <span className="text-3xl font-bold">
                        {currencySymbol}{product.salePrice.toFixed(2)}
                      </span>
                      <span className="text-xl text-muted-foreground line-through">
                        {currencySymbol}{product.price.toFixed(2)}
                      </span>
                    </>
                  ) : (
                    <span className="text-3xl font-bold">
                      {currencySymbol}{product.price.toFixed(2)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {product.description}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center gap-4 space-y-0">
                <Package className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Organization</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {categories.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-muted-foreground">
                      {categories.length === 1 ? 'Category:' : 'Categories:'}
                    </span>
                    {categories.map(cat => (
                      <Badge key={cat.id} variant="outline">{cat.name}</Badge>
                    ))}
                  </div>
                )}
                {product.sku && (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-muted-foreground">
                      SKU:
                    </span>
                    <Badge variant="outline" className="font-mono">{product.sku}</Badge>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-muted-foreground">
                    Tags:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {product.tags
                      ?.split(',')
                      .map(
                        (tag) =>
                          tag.trim() && (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ),
                      )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {product.productType === 'combo' &&
              product.comboItems &&
              product.comboItems.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Boxes className="h-5 w-5 text-muted-foreground" /> Combo
                      Products
                    </CardTitle>
                    <CardDescription>
                      Products included in this combo.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product Name</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Variant</TableHead>
                          <TableHead className="text-right">Stock</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {product.comboItems.map((item) => (
                          <TableRow key={item.childId}>
                            <TableCell className="flex items-center gap-2">
                              {item.variantImage ? (
                                <Image 
                                  src={item.variantImage} 
                                  alt={item.variantName || item.childProduct.name} 
                                  width={40} height={40} 
                                  className="rounded object-cover mr-2" 
                                />
                              ) : null}
                              <Link
                                href={`/dashboard/products/${item.childProduct.id}`}
                                className="font-medium hover:underline"
                              >
                                {item.childProduct.name}
                              </Link>
                            </TableCell>
                            <TableCell>{item.variantSku || item.childProduct.sku}</TableCell>
                            <TableCell>
                              {item.variantName ? item.variantName : 
                               (item.childProduct as any).productType === 'variable' ? 
                               <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-sm flex items-center w-fit gap-1">⚠️ MISSING VARIANT</span> 
                               : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono">{item.available ?? 0}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
          </div>
        </div>
        <div className="md:col-span-1 lg:col-span-1 space-y-6">
          <ProductHistory initialLogs={product.logs || []} productId={product.id} />
        </div>
      </div>

      {product.variants && product.variants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="h-5 w-5" /> Variants & Inventory
            </CardTitle>
            <CardDescription>
              Stock levels for each product variant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variant</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variantsWithStock.map((variant) => {
                  const variantStockStatus = stockStatus(variant.stock);
                  return (
                    <TableRow key={variant.id}>
                      <TableCell className="font-medium">
                        {variant.name}
                      </TableCell>
                      <TableCell>{variant.sku}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className={variantStockStatus.color}>
                            {variant.stock}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {currencySymbol}{product.price.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
