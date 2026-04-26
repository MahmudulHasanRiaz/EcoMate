
'use client';

import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { MoreHorizontal, PlusCircle, Package, Printer, ScanLine, Loader2, RefreshCw } from "lucide-react";
import * as React from "react";
import Link from "next/link";
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteProduct, setProductPublished } from "@/services/products";
import type { Product, Category } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CategoryCombobox } from "@/components/products/category-combobox";

const ITEMS_PER_PAGE = 20;

const fetcher = (url: string) => fetch(url).then(res => res.json()).then(d => d.data || d);

type LabelScope = 'parent' | 'variants' | 'all';
type PriceMode = 'both' | 'regular' | 'sale';

const DEFAULT_PLACEHOLDER =
  PlaceHolderImages.find(p => p.id === "1")?.imageUrl ||
  "https://placehold.co/600x400/e2e8f0/e2e8f0";

function getProductImageSrc(image: string | null): string {
  if (!image) return DEFAULT_PLACEHOLDER;
  const trimmed = image.trim();
  if (!trimmed) return DEFAULT_PLACEHOLDER;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return trimmed.startsWith("/") ? trimmed : "/" + trimmed.replace(/^\/+/, "");
}

export default function ProductsClientPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get('categoryId') || 'all';
  const initialSearch = searchParams.get('search') || '';

  const [searchTerm, setSearchTerm] = React.useState(initialSearch);
  const [deferredSearch, setDeferredSearch] = React.useState(initialSearch);
  const [, startTransition] = React.useTransition();
  const [categoryFilter, setCategoryFilter] = React.useState(initialCategory);
  const [selectedProducts, setSelectedProducts] = React.useState<string[]>([]);
  const [printDialogOpen, setPrintDialogOpen] = React.useState(false);
  const [printScope, setPrintScope] = React.useState<LabelScope>('parent');
  const [printPriceMode, setPrintPriceMode] = React.useState<PriceMode>('both');
  const [printTargets, setPrintTargets] = React.useState<string[]>([]);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  const [deleteDialog, setDeleteDialog] = React.useState({
    isOpen: false,
    productId: '',
    productName: '',
  });

  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isSyncing, setIsSyncing] = React.useState(false);

  // Fetch Categories
  const { data: allCategories = [] } = useSWR<Category[]>('/api/products/categories', fetcher);

  // Infinite Loading for Products
  const getKey = (pageIndex: number, previousPageData: any) => {
    if (previousPageData && !previousPageData.nextCursor) return null;
    const cursor = previousPageData?.nextCursor || '';
    return `/api/products?search=${deferredSearch}&categoryId=${categoryFilter}&cursor=${cursor}&pageSize=${ITEMS_PER_PAGE}`;
  };

  const { data: infiniteData, size, setSize, isValidating, mutate } = useSWRInfinite(getKey, fetcher);

  const allProducts = React.useMemo(() => {
    return infiniteData ? infiniteData.flatMap(page => page.items || []) : [];
  }, [infiniteData]);

  const hasMore = infiniteData && infiniteData[infiniteData.length - 1]?.nextCursor;
  const isLoading = !infiniteData && isValidating;

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    startTransition(() => {
      setDeferredSearch(val);
    });
  };

  const openDeleteDialogFor = React.useCallback((productId: string, productName: string) => {
    setDeleteDialog({ isOpen: true, productId, productName });
  }, []);

  const closeDeleteDialog = React.useCallback(() => {
    setDeleteDialog({ isOpen: false, productId: '', productName: '' });
  }, []);

  const confirmDeleteFromDialog = React.useCallback(async () => {
    if (!deleteDialog.productId) return;
    setIsDeleting(true);
    try {
      const result = await deleteProduct(deleteDialog.productId);
      if (result.success) {
        mutate();
        toast({ title: "Product Deleted", description: `Product "${deleteDialog.productName}" deleted.` });
      } else {
        toast({ variant: "destructive", title: "Deletion Failed", description: result.message });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsDeleting(false);
      closeDeleteDialog();
    }
  }, [deleteDialog, mutate, toast, closeDeleteDialog]);

  const handleBulkSync = React.useCallback(async () => {
    if (selectedProducts.length === 0) return;
    setIsSyncing(true);
    try {
      const selectedSKUs = allProducts
        .filter(p => selectedProducts.includes(p.id))
        .flatMap(p => [p.sku, ...(p.variants?.map((v: any) => v.sku) || [])])
        .filter(Boolean) as string[];

      const res = await fetch('/api/products/sync-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus: selectedSKUs }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Bulk Sync Success", description: data.message });
        setSelectedProducts([]);
      } else {
        toast({ variant: "destructive", title: "Sync Failed", description: data.message });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsSyncing(false);
    }
  }, [selectedProducts, allProducts, toast]);

  const handleBulkDelete = React.useCallback(async () => {
    if (selectedProducts.length === 0) return;
    let successCount = 0;
    for (const productId of selectedProducts) {
      try {
        const res = await deleteProduct(productId);
        if (res.success) successCount++;
      } catch { }
    }
    if (successCount > 0) {
      toast({ title: "Bulk Delete", description: `${successCount} products deleted.` });
      mutate();
      setSelectedProducts([]);
    }
  }, [selectedProducts, mutate, toast]);

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedProducts(allProducts.map(p => p.id));
    } else {
      setSelectedProducts([]);
    }
  };

  const handleSelectProduct = (productId: string, checked: boolean) => {
    if (checked) setSelectedProducts(prev => [...prev, productId]);
    else setSelectedProducts(prev => prev.filter(id => id !== productId));
  };

  const openPrintDialog = (ids: string[]) => {
    const targets = ids.length > 0 ? ids : selectedProducts;
    if (targets.length === 0) {
      toast({ variant: "destructive", title: "Selection Required" });
      return;
    }
    setPrintTargets(targets);
    setPrintDialogOpen(true);
  };

  const handleConfirmPrint = () => {
    const ids = printTargets.length ? printTargets : selectedProducts;
    const params = new URLSearchParams({
      ids: ids.join(','),
      scope: printScope,
      price: printPriceMode,
    });
    window.open(`/print/products/bulk?${params.toString()}`, '_blank');
    setPrintDialogOpen(false);
  };

  const isAllSelected = allProducts.length > 0 && selectedProducts.length === allProducts.length;
  const isSomeSelected = selectedProducts.length > 0 && selectedProducts.length < allProducts.length;

  const handleTogglePublished = async (productId: string, current: boolean) => {
    try {
      const res = await setProductPublished(productId, !current);
      if (res.success) {
        mutate();
        toast({ title: "Status Updated", description: `Product is now ${!current ? 'published' : 'unpublished'}.` });
      } else {
        toast({ variant: "destructive", title: "Update Failed", description: res.message });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  };

  const renderCards = () => (
    <div className="grid grid-cols-1 gap-4 p-4">
      {allProducts.map((product: Product) => (
        <Card key={product.id} className="relative overflow-hidden border-none shadow-sm bg-background/60 backdrop-blur-md">
          <div className="absolute top-3 left-3 z-10">
            <Checkbox checked={selectedProducts.includes(product.id)} onCheckedChange={(c) => handleSelectProduct(product.id, !!c)} className="bg-background shadow-sm" />
          </div>
          <CardContent className="p-0">
            <div className="flex items-start gap-4 p-4">
              <Link href={`/dashboard/products/${product.id}`} className="flex-shrink-0">
                <div className="relative h-20 w-20 overflow-hidden rounded-xl border border-muted shadow-inner">
                  <Image fill alt={product.name} src={getProductImageSrc(product.image)} className="object-cover" />
                </div>
              </Link>
              <div className="flex-1 min-w-0 py-1">
                <Link href={`/dashboard/products/${product.id}`} className="font-black text-sm hover:text-primary transition-colors line-clamp-2 leading-snug">
                  {product.name}
                </Link>
                <div className="text-[10px] text-muted-foreground font-bold mt-0.5 tracking-tight">{product.sku}</div>

                <div className="flex items-center justify-between mt-3">
                  <div className="flex flex-col">
                    {product.salePrice && product.salePrice > 0 ? (
                      <>
                        <span className="font-black text-sm text-primary leading-none">৳{product.salePrice.toLocaleString()}</span>
                        <span className="text-[10px] text-muted-foreground line-through opacity-60">৳{product.price.toLocaleString()}</span>
                      </>
                    ) : (
                      <span className="font-extrabold text-sm">৳{product.price.toLocaleString()}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-tighter">Stock:</span>
                    <Badge variant={product.inventory > 5 ? "secondary" : "destructive"} className="px-2 py-0 text-[10px] font-black rounded-full">
                      {product.inventory}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <Separator className="bg-muted/50" />

            <div className="flex items-center justify-between p-3 bg-muted/20">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 scale-90 origin-left">
                  <Switch
                    checked={product.isPublished ?? true}
                    onCheckedChange={() => handleTogglePublished(product.id, product.isPublished ?? true)}
                  />
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    {product.isPublished ? 'Live' : 'Hidden'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" asChild className="h-8 w-8 rounded-full">
                  <Link href={`/dashboard/products/${product.id}/edit`}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="icon" variant="ghost" onClick={() => openPrintDialog([product.id])} className="h-8 w-8 rounded-full text-blue-600">
                  <Printer className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => openDeleteDialogFor(product.id, product.name)} className="h-8 w-8 rounded-full text-destructive">
                  <PlusCircle className="h-4 w-4 rotate-45" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );


  return (
    <div className="flex flex-1 flex-col gap-4 overflow-x-hidden p-4 lg:gap-6 lg:p-6">
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Print Product Labels</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Label Scope</Label>
              <Select value={printScope} onValueChange={(v) => setPrintScope(v as LabelScope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">Parent only</SelectItem>
                  <SelectItem value="variants">Variants only</SelectItem>
                  <SelectItem value="all">Parent + variants</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Price Format</Label>
              <Select value={printPriceMode} onValueChange={(v) => setPrintPriceMode(v as PriceMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both Regular & Sale</SelectItem>
                  <SelectItem value="regular">Regular only</SelectItem>
                  <SelectItem value="sale">Sale price</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmPrint}>Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 min-w-0">
          <h1 className="font-headline text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground hidden sm:block">Manage inventory with enterprise-grade performance.</p>
        </div>
        <div className="flex items-center gap-2">
          <CategoryCombobox
            categories={allCategories}
            value={categoryFilter}
            onChange={setCategoryFilter}
          />
          <Button size="sm" asChild className="shadow-sm">
            <Link href="/dashboard/products/new">
              <PlusCircle className="h-4 w-4 mr-2" />
              <span>Add Product</span>
            </Link>
          </Button>
        </div>
      </div>

      <AlertDialog open={deleteDialog.isOpen} onOpenChange={(o) => !o && closeDeleteDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanent Deletion</AlertDialogTitle>
            <AlertDialogDescription>Delete <strong>{deleteDialog.productName}</strong>? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteDialog}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteFromDialog} disabled={isDeleting} className="bg-destructive text-destructive-foreground">
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="shadow-sm border-none bg-background/50 backdrop-blur-sm overflow-hidden">
        <CardHeader className="pb-4 space-y-4">
          {selectedProducts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 p-2 bg-primary/5 rounded-xl border border-primary/10">
              <div className="flex items-center gap-2 px-2">
                <Checkbox checked={isAllSelected} onCheckedChange={handleSelectAll} />
                <span className="text-xs font-black uppercase tracking-widest text-primary/80">{selectedProducts.length} selected</span>
              </div>
              <Separator orientation="vertical" className="hidden sm:block h-4 mx-1" />
              <div className="flex flex-wrap gap-1 items-center flex-1">
                <Button variant="ghost" size="sm" onClick={() => openPrintDialog(selectedProducts)} className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary/10 rounded-lg">
                  <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBulkSync}
                  disabled={isSyncing}
                  className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest text-amber-600 hover:bg-amber-50 rounded-lg"
                >
                  {isSyncing ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Sync
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest text-destructive hover:bg-destructive/10 rounded-lg">Delete</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="max-w-[90vw] sm:max-w-md rounded-2xl">
                    <AlertDialogHeader><AlertDialogTitle>Delete {selectedProducts.length} items?</AlertDialogTitle></AlertDialogHeader>
                    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                      <AlertDialogCancel className="w-full sm:w-auto rounded-xl">Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleBulkDelete} className="w-full sm:w-auto bg-destructive text-destructive-foreground rounded-xl">Confirm</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search products or scan..."
                className="pl-10 h-10 rounded-xl"
              />
            </div>
            {isValidating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm font-bold uppercase tracking-widest opacity-50">Loading products...</p>
            </div>
          ) : allProducts.length > 0 ? (
            <>
              <div className="hidden sm:block rounded-md border-t">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[50px] pl-4">
                        <Checkbox checked={isAllSelected || (isSomeSelected ? 'indeterminate' : false)} onCheckedChange={handleSelectAll} />
                      </TableHead>
                      <TableHead className="w-[80px]">Image</TableHead>
                      <TableHead>Name & SDK</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Inventory</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allProducts.map((product: Product) => (
                      <TableRow key={product.id} className="group transition-colors hover:bg-muted/30">
                        <TableCell className="pl-4">
                          <Checkbox checked={selectedProducts.includes(product.id)} onCheckedChange={(c) => handleSelectProduct(product.id, !!c)} />
                        </TableCell>
                        <TableCell>
                          <Link href={`/dashboard/products/${product.id}`}>
                            <div className="relative h-12 w-12 overflow-hidden rounded-md border shadow-sm">
                              <Image fill alt={product.name} src={getProductImageSrc(product.image)} className="object-cover" />
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link href={`/dashboard/products/${product.id}`} className="font-medium hover:text-primary transition-colors line-clamp-1">
                            {product.name}
                          </Link>
                          <div className="text-xs text-muted-foreground font-mono">{product.sku}</div>
                        </TableCell>
                        <TableCell>
                          {product.salePrice && product.salePrice > 0 ? (
                            <div className="flex flex-col">
                              <span className="font-bold text-primary">৳{product.salePrice.toLocaleString()}</span>
                              <span className="text-[10px] text-muted-foreground line-through opacity-70">৳{product.price.toLocaleString()}</span>
                            </div>
                          ) : (
                            <span className="font-medium">৳{product.price.toLocaleString()}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={product.isPublished ?? true}
                              onCheckedChange={() => handleTogglePublished(product.id, product.isPublished ?? true)}
                            />
                            <Badge variant={product.isPublished ? "outline" : "secondary"} className="text-[10px] py-0">
                              {product.isPublished ? 'Published' : 'Hidden'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {product.productType === 'combo' ? (
                            <div className="space-y-1">
                              <Badge variant={product.inventory > 5 ? "secondary" : "destructive"} className="font-mono">
                                {product.inventory}
                              </Badge>
                              <div className="text-[10px] text-muted-foreground line-clamp-2 max-w-[140px]">
                                {product.comboItems?.length
                                  ? product.comboItems
                                    .map((item) => {
                                      const sku = item.variantSku || item.childProduct?.sku || item.childId;
                                      const qty = item.available ?? 0;
                                      return `${sku}: ${qty}`;
                                    })
                                    .join(', ')
                                  : 'No components'}
                              </div>
                            </div>
                          ) : (
                            <Badge variant={product.inventory > 5 ? "secondary" : "destructive"} className="font-mono">
                              {product.inventory}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem asChild><Link href={`/dashboard/products/${product.id}/edit`}>Edit Details</Link></DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => openPrintDialog([product.id])}>Print Labels</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialogFor(product.id, product.name)}>Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="sm:hidden border-t">
                {renderCards()}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Package className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground font-medium">No products found</p>
              <Button variant="link" size="sm" onClick={() => { setSearchTerm(''); setCategoryFilter('all'); }}>Clear filters</Button>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-center border-t bg-muted/30 p-4">
          {hasMore ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSize(size + 1)}
              disabled={isValidating}
              className="bg-background shadow-sm px-8"
            >
              {isValidating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Fetching...
                </>
              ) : 'Load More Products'}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {allProducts.length > 0 ? "End of inventory reached." : ""}
            </p>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
