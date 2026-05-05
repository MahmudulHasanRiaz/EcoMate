'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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
import { getAllProductsLookup, createProduct } from '@/services/products';
import { getCategories, CategoryWithCount } from '@/services/categories';
import type { Product, ProductVariant } from '@/types';
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
  brandId: z.string().optional(),
  tags: z.string().optional(),

  ornaFabric: z.coerce.number().optional(),
  jamaFabric: z.coerce.number().optional(),
  selowarFabric: z.coerce.number().optional(),

  attributes: z.array(attributeSchema).optional(),
  variations: z.array(variationSchema).optional(),
  comboProductIds: z.array(z.string()).optional(),
  images: z.array(z.any()).optional(),

  wholesaleEnabled: z.boolean().optional().default(false),
  wholesaleVisible: z.boolean().optional().default(false),
  wholesalePrice: optionalWholesaleNumber,
  wholesaleMinQuantity: optionalWholesaleNumber,
  wholesalePackQuantity: optionalWholesaleNumber,
  wholesaleUnitLabel: z.string().optional(),
  wholesaleNote: z.string().optional(),
  videoUrl: z.string().optional(),
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

const rawPlaceholder = placeholderImages.find(p => p.id === "1")?.imageUrl;
const DEFAULT_PLACEHOLDER =
  typeof rawPlaceholder === "string"
    ? rawPlaceholder
    : "https://placehold.co/600x400/e2e8f0/e2e8f0";

export default function NewProductPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [allProducts, setAllProducts] = React.useState<Product[]>([]);
  const [allCategories, setAllCategories] = React.useState<CategoryWithCount[]>([]);
  const [allBrands, setAllBrands] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [comboItems, setComboItems] = React.useState<Array<{ childId: string; variantId?: string | null }>>([]);
  const [isSingleVariantModalOpen, setIsSingleVariantModalOpen] = React.useState(false);
  const [singleVariantData, setSingleVariantData] = React.useState<Record<string, string>>({});
  const [singleVariantSku, setSingleVariantSku] = React.useState('');
  const [singleVariantPrice, setSingleVariantPrice] = React.useState('');
  const [settings, setSettings] = React.useState<any>(null);

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
      brandId: '',
      tags: '',
      ornaFabric: undefined,
      jamaFabric: undefined,
      selowarFabric: undefined,
      attributes: [],
      variations: [],
      comboProductIds: [],
      images: [],
      wholesaleEnabled: false,
      wholesaleVisible: false,
      wholesalePrice: undefined,
      wholesaleMinQuantity: undefined,
      wholesalePackQuantity: undefined,
      wholesaleUnitLabel: '',
      wholesaleNote: '',
      videoUrl: '',
    },
  });

  const nameValue = form.watch('name');
  const slugValue = form.watch('slug');
  const prevNameRef = React.useRef(nameValue);

  React.useEffect(() => {
    setIsLoading(true);
    Promise.all([
      getAllProductsLookup({ pageSize: 200 }),
      getCategories(),
      fetch('/api/brands?isActive=true').then(res => res.json()).catch(() => ({ data: [] })),
      fetch('/api/settings/general').then(res => res.json()).catch(() => ({}))
    ]).then(([productsData, categoriesData, brandsData, settingsData]) => {
      setAllProducts(productsData || []);
      setAllCategories(categoriesData || []);
      setAllBrands(brandsData.data || []);
      setSettings(settingsData);
      setIsLoading(false);
    });
  }, []);

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

    if (!slugValue) {
      setSlugStatus('idle');
      return;
    }

    setSlugStatus('checking');

    slugCheckTimeout.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/products/validate-slug?slug=${slugValue}`);
        const data = await response.json();
        setSlugStatus(data.isAvailable ? 'available' : 'taken');
      } catch (error) {
        console.error("Slug validation failed:", error);
        setSlugStatus('idle');
      }
    }, 500);
  }, [slugValue]);

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
        if (values.productType === 'combo' && comboItems.length > 0) {
          formData.append('comboItems', JSON.stringify(comboItems));
        }
      } else if (key === 'images') {
        if (Array.isArray(value)) {
          value.forEach((img) => {
            if (img instanceof File) {
              formData.append('images', img);
            }
          });
        }
      } else if (value !== null && value !== undefined) {
        formData.append(key, String(value));
      }
    });

    formData.set('attributes', JSON.stringify(values.attributes || []));
    formData.set('variations', JSON.stringify(values.variations || []));
    formData.set('categoryIds', JSON.stringify(values.categoryIds || []));
    formData.set('productType', values.productType || 'simple');

    Object.entries(variantImageFilesRef.current).forEach(([variationId, file]) => {
      formData.append(`variantImage:${variationId}`, file);
    });

    const result = await createProduct(formData);

    setIsSaving(false);

    if (result.success) {
      toast({
        title: "Product Created!",
        description: `${values.name} has been successfully created.`,
      });
      if (result.redirect) {
        router.push(result.redirect);
      }
    } else {
      toast({
        variant: "destructive",
        title: "Creation Failed",
        description: result.message,
      });
    }
  }

  function generateVariations() {
    if (variationFields.length > 0 && !window.confirm("Are you sure? Regenerating will replace all existing variations.")) {
      return;
    }

    const attributes = form.getValues('attributes');
    if (!attributes || attributes.length === 0) return;

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

    const parentSku = form.getValues('sku') || 'SKU';
    const parentPrice = form.getValues('price');
    const parentSalePrice = form.getValues('salePrice');

    const combinations = normalized.reduce((acc, attr) => {
      const options = attr.options;
      if (acc.length === 0) return options.map((o) => ({ [attr.name]: o }));
      return acc.flatMap((combo) => options.map((o) => ({ ...combo, [attr.name]: o })));
    }, [] as Record<string, string>[]);

    const seen = new Set<string>();
    const uniqueCombinations = combinations.filter((combo) => {
      const key = JSON.stringify(combo);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const MAX_VARIATIONS = 200;
    if (uniqueCombinations.length > MAX_VARIATIONS) {
      toast({
        variant: 'destructive',
        title: 'Too many variations',
        description: `This would create ${uniqueCombinations.length} variations. Max ${MAX_VARIATIONS}.`,
      });
      return;
    }

    const newVariations = uniqueCombinations.map((combo, index) => {
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

    const attributeSlugs = Object.entries(singleVariantData)
      .filter(([_, v]) => v)
      .map(([k, v]) => `${generateSlug(k)}-${generateSlug(v)}`)
      .join('-');

    const finalSku = singleVariantSku.trim() || `${parentSku}-${attributeSlugs}`;
    const cleanAttributes: Record<string, string> = {};
    Object.entries(singleVariantData).forEach(([k, v]) => {
      if (v) cleanAttributes[k] = v;
    });

    const newField = {
      id: `var_${Date.now()}_single`,
      attributes: cleanAttributes,
      sku: finalSku,
      price: singleVariantPrice ? parseFloat(singleVariantPrice) : parentPrice,
      image: '',
    };

    replaceVariations([...(form.getValues('variations') || []), newField as any]);
    setIsSingleVariantModalOpen(false);
    setSingleVariantData({});
    setSingleVariantSku('');
    setSingleVariantPrice('');
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
        <div className="h-10 w-1/3 bg-muted animate-pulse rounded" />
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
                New Product
              </h1>
            </div>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {isSaving ? 'Saving...' : 'Create Product'}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-2 space-y-6">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Product Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />

              <FormField control={form.control} name="slug" render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormDescription className="flex items-center gap-2">
                    {slugStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin" />}
                    {slugStatus === 'available' && <CircleCheck className="h-4 w-4 text-green-500" />}
                    {slugStatus === 'taken' && <AlertTriangle className="h-4 w-4 text-destructive" />}
                    <span>URL-friendly name</span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={8} {...field} /></FormControl><FormMessage /></FormItem>
              )} />

              <Card>
                <CardHeader><CardTitle>Product Images</CardTitle></CardHeader>
                <CardContent>
                  <FormField control={form.control} name="images" render={({ field }) => (
                    <FormItem><FormControl><ImageUploader isMultiple={true} images={field.value || []} onImagesChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                  )} />
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
                    <CardHeader><CardTitle>Attributes</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      {attributeFields.map((field, index) => (
                        <div key={field.id} className="grid grid-cols-10 gap-2 items-start">
                          <FormField control={form.control} name={`attributes.${index}.name`} render={({ field }) => (
                            <FormItem className="col-span-4"><FormControl><Input placeholder="Color" {...field} /></FormControl></FormItem>
                          )} />
                          <FormField control={form.control} name={`attributes.${index}.options`} render={({ field }) => (
                            <FormItem className="col-span-5"><FormControl><Input placeholder="Red, Blue" {...field} /></FormControl></FormItem>
                          )} />
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeAttribute(index)} className="h-10"><X className="h-4 w-4" /></Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => appendAttribute({ name: '', options: '' })}>Add Attribute</Button>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle>Variations</CardTitle>
                      <div className="flex gap-2">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setIsSingleVariantModalOpen(true)}>Add single variant</Button>
                        <Button type="button" variant="outline" size="sm" onClick={generateVariations}>Create variations</Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Accordion type="multiple" className="w-full">
                        {variationFields.map((field, index) => (
                          <AccordionItem value={field.id} key={field.id}>
                            <AccordionTrigger>{Object.values(field.attributes).join(' / ')}</AccordionTrigger>
                            <AccordionContent>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                  <Label>Variation Image</Label>
                                  <FormField control={form.control} name={`variations.${index}.image`} render={({ field: vField }) => (
                                    <FormItem>
                                      <FormControl>
                                        <ImageUploader
                                          isMultiple={false}
                                          images={variantImageFilesRef.current[field.id] ? [variantImageFilesRef.current[field.id]] : []}
                                          onImagesChange={(files) => {
                                            const f = files[0];
                                            if (f instanceof File) {
                                              setVariantImageFile(field.id, f);
                                              vField.onChange(`__file__:${field.id}`);
                                            } else {
                                              setVariantImageFile(field.id, null);
                                              vField.onChange('');
                                            }
                                          }}
                                        />
                                      </FormControl>
                                    </FormItem>
                                  )} />
                                </div>
                                <FormField control={form.control} name={`variations.${index}.price`} render={({ field }) => (
                                  <FormItem><FormLabel>Price</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} /></FormControl></FormItem>
                                )} />
                                <FormField control={form.control} name={`variations.${index}.sku`} render={({ field }) => (
                                  <FormItem><FormLabel>SKU</FormLabel><FormControl><Input {...field} value={field.value || ''} /></FormControl></FormItem>
                                )} />
                                <FormField control={form.control} name={`variations.${index}.wholesalePrice`} render={({ field }) => (
                                  <FormItem><FormLabel>Wholesale Price</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} placeholder="Inherit from parent" /></FormControl></FormItem>
                                )} />
                                <FormField control={form.control} name={`variations.${index}.wholesaleMinQuantity`} render={({ field }) => (
                                  <FormItem><FormLabel>WS Min Qty</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} placeholder="Inherit" /></FormControl></FormItem>
                                )} />
                                <FormField control={form.control} name={`variations.${index}.wholesalePackQuantity`} render={({ field }) => (
                                  <FormItem><FormLabel>WS Pack Qty</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} placeholder="Inherit" /></FormControl></FormItem>
                                )} />
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>

            <div className="md:col-span-1 space-y-6">
              <Card>
                <CardHeader><CardTitle>Product Data</CardTitle></CardHeader>
                <CardContent>
                  <FormField control={form.control} name="productType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="simple">Simple</SelectItem>
                          <SelectItem value="variable">Variable</SelectItem>
                          <SelectItem value="combo">Combo</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Organization</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Categories</Label>
                    <CategoryTreeSelect
                      categories={allCategories as any}
                      value={form.watch('categoryIds') || []}
                      onSelect={(v) => form.setValue('categoryIds', Array.isArray(v) ? v : [v])}
                      multiple
                    />
                  </div>
                  <FormField control={form.control} name="brandId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Brand</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || 'none'}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">No Brand</SelectItem>
                          {allBrands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {allBrands.length === 0 && (
                        <FormDescription className="text-xs">
                          No active brands found.{' '}
                          <Link href="/dashboard/settings/brands" className="text-primary hover:underline">
                            Configure brands
                          </Link>
                        </FormDescription>
                      )}
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Tabs defaultValue="general">
                <TabsList className="w-full">
                  <TabsTrigger value="general" className="flex-1">General</TabsTrigger>
                  <TabsTrigger value="inventory" className="flex-1">Inventory</TabsTrigger>
                  <TabsTrigger value="wholesale" className="flex-1">Wholesale</TabsTrigger>
                </TabsList>
                <TabsContent value="general" className="mt-4">
                  <Card><CardContent className="pt-4 space-y-4">
                    <FormField control={form.control} name="price" render={({ field }) => (
                      <FormItem><FormLabel>Price</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="salePrice" render={({ field }) => (
                      <FormItem><FormLabel>Sale Price</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="videoUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Product Video URL</FormLabel>
                        <FormControl><Input {...field} value={field.value || ''} placeholder="https://youtube.com/watch?v=... or https://facebook.com/..." /></FormControl>
                        <FormDescription>YouTube or Facebook video link for product showcase</FormDescription>
                      </FormItem>
                    )} />
                  </CardContent></Card>
                </TabsContent>
                <TabsContent value="inventory" className="mt-4">
                  <Card><CardContent className="pt-4">
                    <FormField control={form.control} name="sku" render={({ field }) => (
                      <FormItem><FormLabel>SKU</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                  </CardContent></Card>
                </TabsContent>
                <TabsContent value="wholesale" className="mt-4">
                  <Card><CardContent className="pt-4 space-y-4">
                    <FormField control={form.control} name="wholesaleEnabled" render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Enable Wholesale</FormLabel>
                          <FormDescription>Allow this product to be sold at wholesale price.</FormDescription>
                        </div>
                      </FormItem>
                    )} />
                    {form.watch('wholesaleEnabled') && (
                      <div className="space-y-4 pt-4 border-t">
                        <FormField control={form.control} name="wholesaleVisible" render={({ field }) => (
                          <FormItem className="flex items-center gap-2">
                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>Visible to Wholesalers / SR</FormLabel>
                              <FormDescription>Show this product in the Wholesaler and SR portals.</FormDescription>
                            </div>
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="wholesalePrice" render={({ field }) => (
                            <FormItem><FormLabel>Wholesale Price</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} /></FormControl></FormItem>
                          )} />
                          <FormField control={form.control} name="wholesaleMinQuantity" render={({ field }) => (
                            <FormItem><FormLabel>Min Quantity</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} /></FormControl></FormItem>
                          )} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="wholesalePackQuantity" render={({ field }) => (
                            <FormItem><FormLabel>Pack Multiplier / Qty</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} placeholder="e.g. 6" /></FormControl></FormItem>
                          )} />
                          <FormField control={form.control} name="wholesaleUnitLabel" render={({ field }) => (
                            <FormItem><FormLabel>Unit Label</FormLabel><FormControl><Input {...field} placeholder="e.g. Set, Pack, Dozen" /></FormControl></FormItem>
                          )} />
                        </div>
                        <FormField control={form.control} name="wholesaleNote" render={({ field }) => (
                          <FormItem><FormLabel>Wholesale Note</FormLabel><FormControl><Textarea {...field} placeholder="e.g. Sold in sets of 6 colors only." /></FormControl></FormItem>
                        )} />
                      </div>
                    )}
                  </CardContent></Card>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </form>
      </Form>

      {/* Single Variant Dialog */}
      <Dialog open={isSingleVariantModalOpen} onOpenChange={setIsSingleVariantModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Single Variant</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            {form.getValues('attributes')?.map((attr, idx) => (
              <div key={idx} className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">{attr.name}</Label>
                <Select onValueChange={(val) => setSingleVariantData(prev => ({ ...prev, [attr.name]: val }))}>
                  <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                  <SelectContent>{attr.options.split(',').map(o => <SelectItem key={o.trim()} value={o.trim()}>{o.trim()}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter><Button onClick={handleAddSingleVariant}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
