'use client';

import * as React from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  ChevronLeft,
  X,
  PlusCircle,
  Save,
  Loader2,
  AlertTriangle,
  CircleCheck,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useToast } from "@/hooks/use-toast";
import { getAllProductsLookup, getCategories, getProductById, updateProduct } from '@/services/products';
import type { Product, Category, ProductVariant, ProductType, ProductImage } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { ImageUploader } from '@/components/ui/image-uploader';
import { placeholderImages } from '@/lib/placeholder-images-data';
import { CategoryTreeSelect } from "@/components/products/category-tree-select";
import { ComboProductSelector, validateComboItems } from "@/components/combo-product-selector";

const attributeSchema = z.object({
  name: z.string().min(1, "Attribute name is required."),
  options: z.string().min(1, "Attribute options are required."),
});

const optionalWholesaleNumber = z.preprocess((value) => (
  value === '' || value === null || value === undefined ? undefined : value
), z.coerce.number().optional());

const variationSchema = z.object({
  id: z.string(),
  attributes: z.record(z.string()),
  sku: z.string().optional(),
  price: z.coerce.number().optional(),
  salePrice: z.coerce.number().optional(),
  image: z.string().optional(),
  wholesalePrice: optionalWholesaleNumber,
  wholesaleMinQuantity: optionalWholesaleNumber,
  wholesalePackQuantity: optionalWholesaleNumber,
});

const productSchema = z.object({
  name: z.string().min(2, "Product name must be at least 2 characters."),
  slug: z.string().optional(),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  productType: z.enum(['simple', 'variable', 'combo']).default('simple'),

  price: z.coerce.number().optional(),
  salePrice: z.coerce.number().optional(),
  sku: z.string().min(1, "SKU is required."),

  weight: z.coerce.number().optional(),
  length: z.coerce.number().optional(),
  width: z.coerce.number().optional(),
  height: z.coerce.number().optional(),

  categoryId: z.string().optional(),
  categoryIds: z.array(z.string()).optional(),
  tags: z.string().optional(),

  ornaFabric: z.coerce.number().optional(),
  jamaFabric: z.coerce.number().optional(),
  selowarFabric: z.coerce.number().optional(),

  attributes: z.array(attributeSchema).optional(),
  variations: z.array(variationSchema).optional(),
  comboProductIds: z.array(z.string()).optional(),
  clearVariants: z.boolean().optional().default(false),
  images: z.array(z.any()).optional(),
  existingImages: z.array(z.any()).optional(),

  wholesaleEnabled: z.boolean().optional().default(false),
  wholesaleVisible: z.boolean().optional().default(false),
  wholesalePrice: optionalWholesaleNumber,
  wholesaleMinQuantity: optionalWholesaleNumber,
  wholesalePackQuantity: optionalWholesaleNumber,
  wholesaleUnitLabel: z.string().optional(),
  wholesaleNote: z.string().optional(),
}).refine(data => {
  if (data.salePrice && data.price) {
    return data.salePrice < data.price;
  }
  return true;
}, {
  message: "Sale price must be less than the regular price.",
  path: ["salePrice"],
});

export type ProductFormValues = z.infer<typeof productSchema>;

const generateSlug = (text: string) =>
  text.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');

const normalizeAttrName = (name: string) => name.trim();

const normalizeOptions = (raw: string, attrName: string) => {
  const lowerName = attrName.trim().toLowerCase();
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((o) => o.trim())
        .filter((o) => Boolean(o) && o.toLowerCase() !== lowerName),
    ),
  );
};

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken';

// ---- image helpers (same pattern as details/list pages) ----
const rawPlaceholder = placeholderImages.find(p => p.id === "1")?.imageUrl;
const DEFAULT_PLACEHOLDER =
  typeof rawPlaceholder === "string"
    ? rawPlaceholder
    : "https://placehold.co/600x400/e2e8f0/e2e8f0";

function getProductImageSrc(image: unknown): string {
  if (typeof image === "string" && image.trim() !== "") {
    const trimmed = image.trim();

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }

    if (!trimmed.startsWith("/")) {
      return "/" + trimmed.replace(/^\/+/, "");
    }

    return trimmed;
  }

  return DEFAULT_PLACEHOLDER;
}

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;
  const { toast } = useToast();



  const [product, setProduct] = React.useState<Product | undefined>(undefined);
  const [allProducts, setAllProducts] = React.useState<Product[]>([]);
  const [allCategories, setAllCategories] = React.useState<Category[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isComboSelectorOpen, setIsComboSelectorOpen] = React.useState(false);
  const [comboSearchTerm, setComboSearchTerm] = React.useState('');
  const [comboItems, setComboItems] = React.useState<Array<{ childId: string; variantId?: string | null }>>([]);
  const [isSingleVariantModalOpen, setIsSingleVariantModalOpen] = React.useState(false);
  const [singleVariantData, setSingleVariantData] = React.useState<Record<string, string>>({});
  const [singleVariantSku, setSingleVariantSku] = React.useState('');
  const [singleVariantPrice, setSingleVariantPrice] = React.useState('');
  const [settings, setSettings] = React.useState<any>(null); // TODO: Type properly

  const currencySymbol = settings?.currency === 'USD' ? '$' : '৳';
  const weightUnit = settings?.weightUnit || 'kg';
  const dimensionUnit = settings?.dimensionUnit || 'cm';

  const [slugStatus, setSlugStatus] = React.useState<SlugStatus>('idle');
  const slugCheckTimeout = React.useRef<NodeJS.Timeout | null>(null);

  const variantImageFilesRef = React.useRef<Record<string, File>>({});

  const setVariantImageFile = (variationId: string, file: File | null) => {
    if (!variationId) return;
    if (!file) {
      delete variantImageFilesRef.current[variationId];
      return;
    }
    variantImageFilesRef.current[variationId] = file;
  };

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      shortDescription: '',
      productType: 'simple',
      price: undefined,
      salePrice: undefined,
      sku: '',
      weight: undefined,
      length: undefined,
      width: undefined,
      height: undefined,
      categoryId: '',
      categoryIds: [],
      tags: '',
      ornaFabric: undefined,
      jamaFabric: undefined,
      selowarFabric: undefined,
      attributes: [],
      variations: [],
      comboProductIds: [],
      images: [],
      existingImages: [],
      clearVariants: false,
      wholesaleEnabled: false,
      wholesaleVisible: false,
      wholesalePrice: undefined,
      wholesaleMinQuantity: undefined,
      wholesalePackQuantity: undefined,
      wholesaleUnitLabel: '',
      wholesaleNote: '',
    },
  });

  const nameValue = form.watch('name');
  const slugValue = form.watch('slug');
  const prevNameRef = React.useRef(nameValue);

  React.useEffect(() => {
    if (productId) {
      setIsLoading(true);
      Promise.all([
        getProductById(productId),
        getAllProductsLookup({ pageSize: 200 }),
        getCategories(),
        fetch('/api/settings/general').then(res => res.json()).catch(() => ({}))
      ]).then(([productData, productsData, categoriesData, settingsData]) => {
        setProduct(productData);
        setAllProducts(productsData.filter(p => p.id !== productId));
        setAllCategories(categoriesData);
        setSettings(settingsData);

        if (productData) {
          form.reset({
            name: productData.name || '',
            slug: productData.slug || '',
            description: productData.description || '',
            shortDescription: productData.shortDescription || '',
            productType: productData.productType as any,
            price: productData.price ?? undefined,
            salePrice: productData.salePrice ?? undefined,
            sku: productData.sku || '',
            weight: productData.weight ?? undefined,
            length: productData.length ?? undefined,
            width: productData.width ?? undefined,
            height: productData.height ?? undefined,
            categoryId: productData.categoryId ?? undefined,
            categoryIds: productData.categoryIds ?? [],
            tags: productData.tags || '',
            ornaFabric: productData.ornaFabric ?? undefined,
            jamaFabric: productData.jamaFabric ?? undefined,
            selowarFabric: productData.selowarFabric ?? undefined,
            variations: (productData.variants || []).map(variant => ({
              id: variant.id,
              attributes: variant.attributes,
              sku: variant.sku || undefined,
              price: variant.price ?? undefined,
              salePrice: variant.salePrice ?? undefined,
              image: variant.image || undefined,
              wholesalePrice: variant.wholesalePrice ?? undefined,
              wholesaleMinQuantity: variant.wholesaleMinQuantity ?? undefined,
              wholesalePackQuantity: variant.wholesalePackQuantity ?? undefined,
            })),
            comboProductIds: productData.comboItems?.map(ci => ci.childId),
            attributes: (productData.attributes || []).map((attr: any) => ({
              name: attr.name || '',
              options: Array.isArray(attr.options) ? attr.options.join(', ') : '',
            })),
            existingImages: productData.images || [],
            images: [], // Start with no new images
            wholesaleEnabled: productData.wholesaleEnabled ?? false,
            wholesaleVisible: productData.wholesaleVisible ?? false,
            wholesalePrice: productData.wholesalePrice ?? undefined,
            wholesaleMinQuantity: productData.wholesaleMinQuantity ?? undefined,
            wholesalePackQuantity: productData.wholesalePackQuantity ?? undefined,
            wholesaleUnitLabel: productData.wholesaleUnitLabel || '',
            wholesaleNote: productData.wholesaleNote || '',
          });
          prevNameRef.current = productData.name || '';

          // Initialize comboItems state from loaded product data
          if (productData.comboItems && productData.comboItems.length > 0) {
            setComboItems(productData.comboItems.map(ci => ({
              childId: ci.childId,
              variantId: ci.variantId || null,
            })));
          }
        }

        setIsLoading(false);
      });
    }
  }, [productId, form]);

  React.useEffect(() => {
    const prevNameSlug = generateSlug(prevNameRef.current);
    if (nameValue && (!slugValue || slugValue === prevNameSlug)) {
      const newSlug = generateSlug(nameValue);
      form.setValue('slug', newSlug);
    }
    prevNameRef.current = nameValue;
  }, [nameValue, slugValue, form]);

  React.useEffect(() => {
    if (slugCheckTimeout.current) {
      clearTimeout(slugCheckTimeout.current);
    }

    if (!slugValue || slugValue === product?.slug) {
      setSlugStatus('idle');
      return;
    }

    setSlugStatus('checking');

    slugCheckTimeout.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/products/validate-slug?slug=${slugValue}&productId=${productId}`);
        const data = await response.json();
        setSlugStatus(data.isAvailable ? 'available' : 'taken');
      } catch (error) {
        console.error("Slug validation failed:", error);
        setSlugStatus('idle');
      }
    }, 500); // 500ms debounce
  }, [slugValue, productId, product?.slug]);

  const { fields: attributeFields, append: appendAttribute, remove: removeAttribute } = useFieldArray({
    control: form.control,
    name: "attributes",
  });

  const { fields: variationFields, replace: replaceVariations } = useFieldArray({
    control: form.control,
    name: "variations",
  });

  const productType = form.watch("productType");
  const skuValue = form.watch("sku");
  const comboProductIds = form.watch("comboProductIds") || [];

  const comboProducts = React.useMemo(
    () => allProducts.filter(p => comboItems.some(ci => ci.childId === p.id)),
    [comboItems, allProducts]
  );

  React.useEffect(() => {
    if (productType === 'combo') {
      const total = comboProducts.reduce((sum, p) => sum + p.price, 0);
      form.setValue('price', total);
    }
  }, [comboProducts, productType, form]);

  async function onSubmit(values: ProductFormValues) {
    // Validate combo items: variable children must have variant selected
    if (values.productType === 'combo' && comboItems.length > 0) {
      const comboErrors = validateComboItems(comboItems, allProducts);
      if (comboErrors.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Invalid Combo Items',
          description: comboErrors[0],
        });
        return;
      }
    }

    setIsSaving(true);
    const formData = new FormData();

    Object.entries(values).forEach(([key, value]) => {
      if (key === 'comboProductIds') {
        // Send comboItems as JSON (new format) if combo type
        if (values.productType === 'combo' && comboItems.length > 0) {
          formData.append('comboItems', JSON.stringify(comboItems));
        } else if (Array.isArray(value)) {
          // Fallback: old format
          value.forEach(id => {
            formData.append('comboProductIds', String(id));
          });
        }
      } else if (key === 'images') {
        if (Array.isArray(value)) {
          value.forEach((img) => {
            if (!img) return;

            if (img instanceof File) {
              formData.append('images', img);
            } else if (typeof img === 'object' && 'url' in img) {
              formData.append('images', (img as any).url);
            } else if (typeof img === 'string') {
              formData.append('images', img);
            }
          });
        }
      } else if (key === 'existingImages') {
        if (Array.isArray(value)) {
          formData.append('existingImages', JSON.stringify(value));
        }
      } else if (value !== null && value !== undefined) {
        formData.append(key, String(value));
      }
    });
    // Serialize arrays as single JSON blobs to ensure server receives them
    formData.set('attributes', JSON.stringify(values.attributes || []));
    formData.set('variations', JSON.stringify(values.variations || []));
    formData.set('categoryIds', JSON.stringify(values.categoryIds || []));
    formData.set('productType', values.productType || 'simple');
    formData.set('clearVariants', String(values.clearVariants || false));

    Object.entries(variantImageFilesRef.current).forEach(([variationId, file]) => {
      formData.append(`variantImage:${variationId}`, file);
    });

    const result = await updateProduct(productId, formData);

    setIsSaving(false);

    if (result.success) {
      toast({
        title: "Product Updated!",
        description: `${values.name} has been successfully updated.`,
      });
      if (result.redirect) {
        router.push(result.redirect);
      }
    } else {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: result.message,
      });
    }
  }

  function generateVariations() {
    if (variationFields.length > 0 && !window.confirm("Are you sure? Regenerating will replace all existing variations. Click Cancel if you want to add a single variant instead.")) {
      return;
    }
    form.setValue('clearVariants', false);

    const attributes = form.getValues('attributes');
    if (!attributes || attributes.length === 0) return;

    // Normalize and sanitize first
    const normalized = attributes
      .map((attr) => {
        const name = normalizeAttrName(String(attr?.name || ''));
        return {
          name,
          options: normalizeOptions(String(attr?.options || ''), name),
        };
      })
      .filter((attr) => attr.name && attr.options.length > 0);

    if (normalized.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Invalid attributes',
        description: 'Please provide at least one attribute with valid options.',
      });
      return;
    }

    // Prevent duplicate attribute names
    const lowerNames = normalized.map((a) => a.name.toLowerCase());
    if (new Set(lowerNames).size !== lowerNames.length) {
      toast({
        variant: 'destructive',
        title: 'Duplicate attribute names',
        description: 'Each attribute name must be unique (e.g., Color, Size).',
      });
      return;
    }

    const parentSku = form.getValues('sku') || 'SKU';
    const parentPrice = form.getValues('price');
    const parentSalePrice = form.getValues('salePrice');

    const combinations = normalized.reduce((acc, attr) => {
      const options = attr.options;
      if (acc.length === 0) return options.map((o) => ({ [attr.name]: o }));
      return acc.flatMap((combo) => options.map((o) => ({ ...combo, [attr.name]: o })));
    }, [] as Record<string, string>[]);

    // Deduplicate combos defensively
    const seen = new Set<string>();
    const uniqueCombinations = combinations.filter((combo) => {
      const key = JSON.stringify(combo);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Guard against huge cartesian explosions
    const MAX_VARIATIONS = 200;
    if (uniqueCombinations.length > MAX_VARIATIONS) {
      toast({
        variant: 'destructive',
        title: 'Too many variations',
        description: `This would create ${uniqueCombinations.length} variations. Please reduce options (max ${MAX_VARIATIONS}).`,
      });
      return;
    }

    const newVariations = uniqueCombinations.map((combo, index) => {
      // Include attribute names in SKU slug to reduce collisions
      const attributeSlugs = Object.entries(combo)
        .map(([k, v]) => `${generateSlug(k)}-${generateSlug(v)}`)
        .join('-');

      return {
        id: `var_${Date.now()}_${index}`,
        attributes: combo,
        sku: `${parentSku}-${attributeSlugs}`,
        price: parentPrice,
        salePrice: parentSalePrice,
        image: '',
      };
    });

    replaceVariations(newVariations);
  }

  function handleAddSingleVariant() {
    const parentSku = form.getValues('sku') || 'SKU';
    const parentPrice = form.getValues('price');
    const parentSalePrice = form.getValues('salePrice');

    const attributeSlugs = Object.entries(singleVariantData)
      .filter(([_, v]) => v)
      .map(([k, v]) => `${generateSlug(k)}-${generateSlug(v)}`)
      .join('-');

    const finalSku = singleVariantSku.trim() || `${parentSku}-${attributeSlugs}`;
    
    // Convert current attributes format to the expected Record<string, string>
    const cleanAttributes: Record<string, string> = {};
    Object.entries(singleVariantData).forEach(([k, v]) => {
      if (v) cleanAttributes[k] = v;
    });

    const newField = {
      id: `var_${Date.now()}_single`,
      attributes: cleanAttributes,
      sku: finalSku,
      price: singleVariantPrice ? parseFloat(singleVariantPrice) : parentPrice,
      salePrice: parentSalePrice,
      image: '',
    };
    
    // We can't easily use append() if it's not extracted via useFieldArray as appendVariations, wait, we have variationFields, maybe we don't have append?
    // Let's check useFieldArray for variations.
    // We'll replace it with replaceVariation([ ...variationFields, newField ])
    replaceVariations([...(form.getValues('variations') || []), newField as any]);
    
    setIsSingleVariantModalOpen(false);
    setSingleVariantData({});
    setSingleVariantSku('');
    setSingleVariantPrice('');
    toast({ title: 'Variant added', description: 'Make sure to save changes.' });
  }

  const filteredComboProducts = allProducts.filter((product) => {
    const needle = comboSearchTerm.trim().toLowerCase();
    if (!needle) return true;
    const nameMatch = product.name.toLowerCase().includes(needle);
    const skuMatch = String(product.sku || '').toLowerCase().includes(needle);
    const variantSkuMatch = (product.variants || []).some((variant) =>
      String(variant.sku || '').toLowerCase().includes(needle)
    );
    return nameMatch || skuMatch || variantSkuMatch;
  });

  const isEditMode = Boolean(product);
  const productTypeLocked = isEditMode;
  const canEditVariations = product?.productType === 'variable';

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
        <Skeleton className="h-10 w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="md:col-span-1 space-y-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" size="icon" className="h-7 w-7" asChild>
              <Link href="/dashboard/products">
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Back</span>
              </Link>
            </Button>
            <div className="flex-1">
              <h1 className="font-headline text-xl font-semibold sm:text-2xl">
                Edit Product
              </h1>
            </div>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-2 space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Slug</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription className="flex items-center gap-2">
                      URL-friendly version of the name.
                      {slugStatus === 'checking' && (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Checking...</span>
                        </>
                      )}
                      {slugStatus === 'available' && (
                        <>
                          <CircleCheck className="h-4 w-4 text-green-500" />
                          <span>Slug is available</span>
                        </>
                      )}
                      {slugStatus === 'taken' && (
                        <>
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                          <span>Slug is already taken</span>
                        </>
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea rows={8} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Card>
                <CardHeader>
                  <CardTitle>Product Images</CardTitle>
                  <CardDescription>Upload images for your product.</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="images"
                    render={({ field }) => {
                      // বর্তমান existingImages (DB থেকে আসা পুরোনো ইমেজ)
                      const existingImagesValue: ProductImage[] = form.watch('existingImages') || [];
                      // uploader-এর জন্য পুরোনো + নতুন একসাথে
                      const combinedImages = [
                        ...existingImagesValue,
                        ...(field.value || []),
                      ];

                      return (
                        <FormItem>
                          <FormControl>
                            <ImageUploader
                              isMultiple={true}
                              images={combinedImages}
                              onImagesChange={(files) => {
                                const existingIds = new Set(
                                  existingImagesValue.map((img) => img.id),
                                );

                                const nextExisting: ProductImage[] = [];
                                const nextNew: (File | { id: string; url: string })[] = [];

                                files.forEach((f) => {
                                  if (f instanceof File) {
                                    nextNew.push(f);
                                  } else {
                                    // object {id,url}
                                    if (existingIds.has(f.id)) {
                                      nextExisting.push(f as ProductImage);
                                    } else {
                                      nextNew.push(f as { id: string; url: string });
                                    }
                                  }
                                });

                                form.setValue('existingImages', nextExisting);
                                field.onChange(nextNew);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                </CardContent>
              </Card>
              {productType === 'combo' && (
                <ComboProductSelector
                  allProducts={allProducts}
                  value={comboItems}
                  onChange={(items) => {
                    setComboItems(items);
                    form.setValue('comboProductIds', items.map(i => i.childId));
                  }}
                />
              )}
              {productType === 'variable' && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Product Attributes</CardTitle>
                      <CardDescription>
                        Define attributes like size or color.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {attributeFields.map((field, index) => (
                        <div
                          key={field.id}
                          className="grid grid-cols-10 gap-2 items-start"
                        >
                          <FormField
                            control={form.control}
                            name={`attributes.${index}.name`}
                            render={({ field }) => (
                              <FormItem className="col-span-4">
                                <FormLabel
                                  className={index !== 0 ? 'sr-only' : ''}
                                >
                                  Name
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="e.g. Color"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`attributes.${index}.options`}
                            render={({ field }) => (
                              <FormItem className="col-span-5">
                                <FormLabel
                                  className={index !== 0 ? 'sr-only' : ''}
                                >
                                  Values
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="e.g. Red, Blue, Green"
                                    {...field}
                                  />
                                </FormControl>
                                <FormDescription className="sr-only">
                                  Comma-separated values.
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div
                            className={cn(
                              'col-span-1 flex items-end h-10',
                              index === 0 && 'pt-8',
                            )}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeAttribute(index)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          appendAttribute({ name: '', options: '' })
                        }
                      >
                        Add Attribute
                      </Button>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <CardTitle>Variations</CardTitle>
                        <CardDescription>
                          Manage product variations.
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {variationFields.length > 0 && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              form.setValue('clearVariants', true);
                              replaceVariations([]);
                            }}
                            disabled={!canEditVariations}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Clear Variations
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setIsSingleVariantModalOpen(true)}
                          disabled={!canEditVariations}
                        >
                          <PlusCircle className="mr-2 h-4 w-4" />
                          Add single variant
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={generateVariations}
                          disabled={!canEditVariations}
                        >
                          <PlusCircle className="mr-2 h-4 w-4" />
                          Create variations
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {!canEditVariations && (
                        <div className="mb-4 text-sm text-muted-foreground">
                          Variations are only available for variable products. Create a new variable product if you need variants.
                        </div>
                      )}
                      <Accordion type="multiple" className="w-full">
                        {variationFields.map((field, index) => (
                          <AccordionItem value={field.id} key={field.id}>
                            <AccordionTrigger>
                              {Object.values(field.attributes).join(' / ')}
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                  <Label>Variation Image</Label>
                                  <FormField
                                    control={form.control}
                                    name={`variations.${index}.image`}
                                    render={({ field }) => {
                                      const variationId = form.getValues(`variations.${index}.id`);
                                      const pendingFile = variantImageFilesRef.current[variationId];
                                      const currentUrl = typeof field.value === 'string' && field.value && !field.value.startsWith('__file__:')
                                        ? field.value
                                        : '';

                                      const images = pendingFile
                                        ? [pendingFile]
                                        : (currentUrl ? [{ id: currentUrl, url: currentUrl }] : []);

                                      return (
                                        <FormItem>
                                          <FormControl>
                                            <ImageUploader
                                              isMultiple={false}
                                              images={images}
                                              onImagesChange={(files) => {
                                                const first = files[0];

                                                if (!first) {
                                                  setVariantImageFile(variationId, null);
                                                  field.onChange('');
                                                  return;
                                                }

                                                if (first instanceof File) {
                                                  setVariantImageFile(variationId, first);
                                                  field.onChange(`__file__:${variationId}`);
                                                  return;
                                                }

                                                setVariantImageFile(variationId, null);
                                                field.onChange(first.url);
                                              }}
                                            />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      );
                                    }}
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-4 flex-1">
                                  <FormField
                                    control={form.control}
                                    name={`variations.${index}.price`}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Regular price</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="number"
                                            placeholder="25.00"
                                            {...field}
                                            value={field.value || ''}
                                          />
                                        </FormControl>
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={form.control}
                                    name={`variations.${index}.salePrice`}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Sale price</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="number"
                                            placeholder="19.99"
                                            {...field}
                                            value={field.value || ''}
                                          />
                                        </FormControl>
                                      </FormItem>
                                    )}
                                  />
                                </div>
                                <FormField
                                  control={form.control}
                                  name={`variations.${index}.sku`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>SKU</FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder="TSHIRT-BLK-L"
                                          {...field}
                                          value={field.value || ''}
                                        />
                                      </FormControl>
                                    </FormItem>
                                  )}
                                />

                                {form.watch('wholesaleEnabled') && (
                                  <div className="col-span-2 grid grid-cols-3 gap-4 border-t pt-4 mt-2">
                                    <FormField control={form.control} name={`variations.${index}.wholesalePrice`} render={({ field }) => (<FormItem><FormLabel>Wholesale Price (Override)</FormLabel><FormControl><Input type="number" placeholder="15.00" {...field} value={field.value || ''} /></FormControl><FormDescription>Leave empty to inherit parent wholesale value.</FormDescription></FormItem>)} />
                                    <FormField control={form.control} name={`variations.${index}.wholesaleMinQuantity`} render={({ field }) => (<FormItem><FormLabel>Min Qty (Override)</FormLabel><FormControl><Input type="number" placeholder="12" {...field} value={field.value || ''} /></FormControl><FormDescription>Leave empty to inherit parent wholesale value.</FormDescription></FormItem>)} />
                                    <FormField control={form.control} name={`variations.${index}.wholesalePackQuantity`} render={({ field }) => (<FormItem><FormLabel>Pack Qty (Override)</FormLabel><FormControl><Input type="number" placeholder="6" {...field} value={field.value || ''} /></FormControl><FormDescription>Leave empty to inherit parent wholesale value.</FormDescription></FormItem>)} />
                                  </div>
                                )}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </CardContent>
                  </Card>
                </>
              )}
              <FormField
                control={form.control}
                name="shortDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product short description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="A short and catchy description."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="md:col-span-1 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Product Data</CardTitle>
                  {productTypeLocked && (
                    <CardDescription className="text-amber-600">
                      Product type is locked after creation. Create a new product if you need a different type.
                    </CardDescription>
                  )}
                  {!productTypeLocked && (
                    <CardDescription>
                      Choose the product type before adding inventory or variations.
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="productType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Product Type</FormLabel>
                        <Select
                          disabled={productTypeLocked}
                          onValueChange={(value) => {
                            field.onChange(value);
                            if (value !== 'combo') {
                              form.setValue('comboProductIds', []);
                            }
                          }}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a product type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="simple">
                              Simple product
                            </SelectItem>
                            <SelectItem value="variable">
                              Variable product
                            </SelectItem>
                            <SelectItem value="combo">
                              Combo product
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {productTypeLocked && (
                          <FormDescription className="text-xs text-muted-foreground">
                            Product type cannot be changed after creation. Create a new product for a different type.
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
              <Tabs defaultValue="general" className="w-full">
                <TabsList className="w-full">
                  <TabsTrigger value="general" className="flex-1">
                    General
                  </TabsTrigger>
                  <TabsTrigger value="inventory" className="flex-1 relative">
                    Inventory
                    {!skuValue && (
                      <span
                        className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                        title="SKU is required for inventory tracking."
                      >
                        !
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="shipping"
                    className="flex-1"
                    disabled={productType === 'combo'}
                  >
                    Shipping
                  </TabsTrigger>
                  <TabsTrigger value="wholesale" className="flex-1">
                    Wholesale
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="general" className="mt-6">
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      <FormField
                        control={form.control}
                        name="price"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Regular price ({currencySymbol})</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="25.00"
                                {...field}
                                value={field.value || ''}
                                disabled={productType === 'combo'}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="salePrice"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Sale price ({currencySymbol})</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="19.99"
                                {...field}
                                value={field.value || ''}
                              />
                            </FormControl>
                            <FormDescription>
                              Leave blank to not have a sale.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="inventory" className="mt-6">
                  <Card>
                    {!skuValue && (
                      <CardHeader className="pb-2">
                        <CardDescription className="text-amber-600">
                          SKU is required for inventory tracking. Please set a SKU before using stock features.
                        </CardDescription>
                      </CardHeader>
                    )}
                    <CardContent className="pt-6 space-y-4">
                      <FormField
                        control={form.control}
                        name="sku"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SKU</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="PARENT-SKU"
                                {...field}
                                value={field.value || ''}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="shipping" className="mt-6">
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      <FormField
                        control={form.control}
                        name="weight"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Weight ({weightUnit})</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="0.5"
                                step="0.01"
                                min="0"
                                {...field}
                                value={field.value || ''}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div>
                        <Label>Dimensions ({dimensionUnit})</Label>
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          <FormField
                            control={form.control}
                            name="length"
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input
                                    type="number"
                                    placeholder="L"
                                    step="0.01"
                                    min="0"
                                    {...field}
                                    value={field.value || ''}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="width"
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input
                                    type="number"
                                    placeholder="W"
                                    step="0.01"
                                    min="0"
                                    {...field}
                                    value={field.value || ''}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="height"
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input
                                    type="number"
                                    placeholder="H"
                                    step="0.01"
                                    min="0"
                                    {...field}
                                    value={field.value || ''}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                      {productType === 'variable' && (
                        <div className="pt-4">
                          <Label>Fabric Consumption (yards)</Label>
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            <FormField
                              control={form.control}
                              name="ornaFabric"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs font-light">
                                    Orna
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      placeholder="2.5"
                                      {...field}
                                      value={field.value || ''}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="jamaFabric"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs font-light">
                                    Jama
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      placeholder="3.0"
                                      {...field}
                                      value={field.value || ''}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="selowarFabric"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs font-light">
                                    Selowar
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      placeholder="2.0"
                                      {...field}
                                      value={field.value || ''}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="wholesale" className="mt-6">
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      <FormField control={form.control} name="wholesaleEnabled" render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                          <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel>Enable Wholesale</FormLabel>
                            <FormDescription>Allow this product to be sold at wholesale rates.</FormDescription>
                          </div>
                        </FormItem>
                      )} />

                      {form.watch('wholesaleEnabled') && (
                        <>
                          <FormField control={form.control} name="wholesaleVisible" render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                              <div className="space-y-1 leading-none">
                                <FormLabel>Visible to Wholesalers</FormLabel>
                                <FormDescription>Show this product in the wholesale catalog.</FormDescription>
                              </div>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="wholesalePrice" render={({ field }) => (<FormItem><FormLabel>Wholesale Price ({currencySymbol})</FormLabel><FormControl><Input type="number" placeholder="15.00" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />
                          <div className="grid grid-cols-2 gap-4">
                            <FormField control={form.control} name="wholesaleMinQuantity" render={({ field }) => (<FormItem><FormLabel>Min. Quantity</FormLabel><FormControl><Input type="number" placeholder="12" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />
                            <FormField control={form.control} name="wholesalePackQuantity" render={({ field }) => (<FormItem><FormLabel>Pack Multiplier</FormLabel><FormControl><Input type="number" placeholder="6" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />
                          </div>
                          <FormField control={form.control} name="wholesaleUnitLabel" render={({ field }) => (<FormItem><FormLabel>Unit Label</FormLabel><FormControl><Input placeholder="e.g. Dozen, Pack of 6" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />
                          <FormField control={form.control} name="wholesaleNote" render={({ field }) => (<FormItem><FormLabel>Wholesale Note</FormLabel><FormControl><Textarea placeholder="Special instructions for wholesalers..." rows={2} {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />
                        </>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
              <Card>
                <CardHeader>
                  <CardTitle>Organization</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="categoryIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categories</FormLabel>
                        <FormControl>
                          <CategoryTreeSelect
                            categories={allCategories as any}
                            value={field.value || []}
                            onSelect={(v) => {
                              const ids = Array.isArray(v) ? v : v ? [v] : [];
                              field.onChange(ids);
                              form.setValue('categoryId', ids[0] || '');
                            }}
                            multiple
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tags"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tags</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Cotton, Eco-friendly"
                            {...field}
                            value={field.value || ''}
                          />
                        </FormControl>
                        <FormDescription>Comma-separated values.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </form>
      {/* Single Variant Add Modal */}
      <Dialog open={isSingleVariantModalOpen} onOpenChange={setIsSingleVariantModalOpen}>
        <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh] overflow-hidden p-0">
          <div className="flex-none p-6 pb-2">
            <DialogHeader>
              <DialogTitle>Add Single Variant</DialogTitle>
              <DialogDescription>
                Add a single variation without regenerating all combinations.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
            <div className="grid gap-4 py-4">
              {form.getValues('attributes')?.map((attr, idx) => {
                const name = normalizeAttrName(String(attr?.name || ''));
                if (!name) return null;
                const options = normalizeOptions(String(attr?.options || ''), name);
                if (!options.length) return null;
                return (
                  <div key={idx} className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor={`single-attr-${name}`} className="text-right">
                      {name}
                    </Label>
                    <Select
                      value={singleVariantData[name] || ''}
                      onValueChange={(val) => setSingleVariantData(prev => ({ ...prev, [name]: val }))}
                    >
                      <SelectTrigger className="col-span-3">
                        <SelectValue placeholder={`Select ${name}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
              
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="single-sku" className="text-right">
                  SKU (optional)
                </Label>
                <Input
                  id="single-sku"
                  value={singleVariantSku}
                  onChange={e => setSingleVariantSku(e.target.value)}
                  placeholder="Auto-generated if empty"
                  className="col-span-3"
                />
              </div>
              
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="single-price" className="text-right">
                  Price (optional)
                </Label>
                <Input
                  id="single-price"
                  type="number"
                  value={singleVariantPrice}
                  onChange={e => setSingleVariantPrice(e.target.value)}
                  placeholder="Inherits parent price if empty"
                  className="col-span-3"
                />
              </div>
            </div>
          </div>
          <div className="flex-none p-6 pt-2">
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSingleVariantModalOpen(false)}>Cancel</Button>
              <Button onClick={handleAddSingleVariant}>Add Variant</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      </Form>
    </div>
  );
}
