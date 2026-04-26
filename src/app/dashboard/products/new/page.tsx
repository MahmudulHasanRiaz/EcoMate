
'use client';

import React, { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle, Save, Loader2, ChevronLeft, X, AlertTriangle, CircleCheck, Trash2 } from "lucide-react";
import { getAllProductsLookup, getCategories } from "@/services/products";
import { createProductClient } from "@/services/products-client";
import type { Category, Product, ProductVariant, ProductType as AppProductType } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { ImageUploader } from "@/components/ui/image-uploader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import Image from 'next/image';
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ComboProductSelector, validateComboItems } from "@/components/combo-product-selector";
import { CategoryTreeSelect } from "@/components/products/category-tree-select";


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
    images: z.array(z.any()).optional(),

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

const generateSlug = (text: string) => text.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');

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

export default function NewProductPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [allProducts, setAllProducts] = React.useState<Product[]>([]);
    const [allCategories, setAllCategories] = React.useState<Category[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isSaving, setIsSaving] = React.useState(false);
    const [isComboSelectorOpen, setIsComboSelectorOpen] = React.useState(false);
    const [comboSearchTerm, setComboSearchTerm] = React.useState('');

    const [slugStatus, setSlugStatus] = React.useState<SlugStatus>('idle');
    const slugCheckTimeout = React.useRef<NodeJS.Timeout | undefined>(undefined);

    const variantImageFilesRef = React.useRef<Record<string, File>>({});

    const setVariantImageFile = (variationId: string, file: File | null) => {
        if (!variationId) return;
        if (!file) {
            delete variantImageFilesRef.current[variationId];
            return;
        }
        variantImageFilesRef.current[variationId] = file;
    };


    React.useEffect(() => {
        setIsLoading(true);
        Promise.all([
            getAllProductsLookup({ pageSize: 200 }),
            getCategories()
        ])
            .then(([productsData, categoriesData]) => {
                setAllProducts(productsData || []);
                setAllCategories(categoriesData || []);
            })
            .catch((err) => {
                console.error('[PRODUCT_NEW_LOAD_ERROR]', err);
                toast({ variant: 'destructive', title: 'Failed to load product data' });
            })
            .finally(() => setIsLoading(false));
    }, []);

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
            wholesaleEnabled: false,
            wholesaleVisible: false,
            wholesalePrice: undefined,
            wholesaleMinQuantity: undefined,
            wholesalePackQuantity: undefined,
            wholesaleUnitLabel: '',
            wholesaleNote: '',
        },
    });

    // Track combo items with variant selection
    const [comboItems, setComboItems] = React.useState<Array<{
        childId: string;
        variantId?: string | null;
    }>>([]);

    const { fields: attributeFields, append: appendAttribute, remove: removeAttribute } = useFieldArray({
        control: form.control,
        name: "attributes",
    });

    const { fields: variationFields, replace: replaceVariations } = useFieldArray({
        control: form.control,
        name: "variations",
    });

    const productType = form.watch("productType");
    const selectedCategoryId = form.watch("categoryId");
    const comboProductIds = form.watch("comboProductIds") || [];
    const nameValue = form.watch('name');
    const slugValue = form.watch('slug');
    const prevNameRef = React.useRef(nameValue);
    const skuValue = form.watch('sku');

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
        }, 500); // 500ms debounce
    }, [slugValue]);


    const comboProducts = React.useMemo(() =>
        allProducts.filter(p => comboProductIds.includes(p.id)),
        [comboProductIds, allProducts]
    );

    React.useEffect(() => {
        if (productType === 'combo') {
            const total = comboProducts.reduce((sum, p) => sum + p.price, 0);
            form.setValue('price', total);
        }
    }, [comboProducts, productType, form]);

    function generateVariations() {
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

    const filteredComboProducts = allProducts.filter(p => p.name.toLowerCase().includes(comboSearchTerm.toLowerCase()));

    const onSubmit = async (values: ProductFormValues) => {
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

        // Redundant client-side validation for image sizes
        const MAX_SIZE_MB = 5;
        const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
        let hasLargeFile = false;

        if (values.images && Array.isArray(values.images)) {
            values.images.forEach((img: any) => {
                if (img instanceof File && img.size > MAX_SIZE_BYTES) {
                    hasLargeFile = true;
                }
            });
        }

        if (hasLargeFile) {
            toast({
                variant: "destructive",
                title: "File too large",
                description: `Please remove images larger than ${MAX_SIZE_MB}MB to proceed.`,
            });
            return;
        }

        setIsSaving(true);
        const formData = new FormData();

        Object.entries(values).forEach(([key, value]) => {
            if (key === 'attributes' || key === 'variations') {
                if (Array.isArray(value)) {
                    value.forEach(item => {
                        formData.append(key, JSON.stringify(item));
                    });
                }
            } else if (key === 'comboProductIds') {
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

                        // আপলোড করা আসল ফাইল হলে সরাসরি FormData-তে File হিসেবে যাবে
                        if (img instanceof File) {
                            formData.append('images', img);
                        }
                        // আমাদের ImageUploader থেকে আসা { id, url } অবজেক্ট হলে শুধু url পাঠাবো
                        else if (typeof img === 'object' && 'url' in img) {
                            formData.append('images', (img as any).url);
                        }
                        // যদি কোথাও string URL হয় (fallback হিসেবে)
                        else if (typeof img === 'string') {
                            formData.append('images', img);
                        }
                    });
                }
            } else if (value !== null && value !== undefined) {
                formData.append(key, String(value));
            }
        });

        // Serialize categoryIds as JSON
        formData.set('categoryIds', JSON.stringify(values.categoryIds || []));

        // Add variant image files
        Object.entries(variantImageFilesRef.current).forEach(([variationId, file]) => {
            formData.append(`variantImage:${variationId}`, file);
        });

        // Use standard try-catch for ALL environments to ensure robust error handling
        try {
            const result = await createProductClient(formData);
            if (result.success) {
                toast({
                    title: "Product Created!",
                    description: `${values.name} has been successfully added to your store.`,
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
        } catch (error: any) {
            console.error("Create Product Error:", error);
            toast({
                variant: "destructive",
                title: "An Unexpected Error Occurred",
                description: error.message || "Failed to create product. Please try again.",
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <div className="p-6">Loading...</div>
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
                                Add New Product
                            </h1>
                        </div>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {isSaving ? 'Creating...' : 'Create Product'}
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
                                        URL-friendly version of the name.
                                        {slugStatus === 'checking' && <><Loader2 className="h-4 w-4 animate-spin" /><span>Checking...</span></>}
                                        {slugStatus === 'available' && <><CircleCheck className="h-4 w-4 text-green-500" /><span>Slug is available</span></>}
                                        {slugStatus === 'taken' && <><AlertTriangle className="h-4 w-4 text-destructive" /><span>Slug is already taken</span></>}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="description" render={({ field }) => (
                                <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={8} {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <Card>
                                <CardHeader><CardTitle>Product Images</CardTitle><CardDescription>Upload images for your product.</CardDescription></CardHeader>
                                <CardContent>
                                    <FormField
                                        control={form.control}
                                        name="images"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <ImageUploader
                                                        images={field.value || []}
                                                        onImagesChange={(files) => {
                                                            field.onChange(files)
                                                        }}
                                                        isMultiple={true}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
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
                                        <CardHeader><CardTitle>Product Attributes</CardTitle><CardDescription>Define attributes like size or color.</CardDescription></CardHeader>
                                        <CardContent className="space-y-4">
                                            {attributeFields.map((field, index) => (
                                                <div key={field.id} className="grid grid-cols-10 gap-2 items-start">
                                                    <FormField control={form.control} name={`attributes.${index}.name`} render={({ field }) => (<FormItem className="col-span-4"><FormLabel className={index !== 0 ? "sr-only" : ""}>Name</FormLabel><FormControl><Input placeholder="e.g. Color" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                                    <FormField control={form.control} name={`attributes.${index}.options`} render={({ field }) => (<FormItem className="col-span-5"><FormLabel className={index !== 0 ? "sr-only" : ""}>Values</FormLabel><FormControl><Input placeholder="e.g. Red, Blue, Green" {...field} /></FormControl><FormDescription className="sr-only">Comma-separated values.</FormDescription><FormMessage /></FormItem>)} />
                                                    <div className={cn("col-span-1 flex items-end h-10", index === 0 && "pt-8")}><Button type="button" variant="ghost" size="icon" onClick={() => removeAttribute(index)} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></Button></div>
                                                </div>
                                            ))}
                                            <Button type="button" variant="outline" size="sm" onClick={() => appendAttribute({ name: '', options: '' })}>Add Attribute</Button>
                                        </CardContent>
                                    </Card>
                                    <Card>
                                        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                            <div>
                                                <CardTitle>Variations</CardTitle>
                                                <CardDescription>Manage product variations.</CardDescription>
                                            </div>
                                            <div className="flex gap-2">
                                                {variationFields.length > 0 && (
                                                    <Button type="button" variant="destructive" size="sm" onClick={() => replaceVariations([])}>
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Clear Variations
                                                    </Button>
                                                )}
                                                <Button type="button" variant="outline" size="sm" onClick={generateVariations}>
                                                    <PlusCircle className="mr-2 h-4 w-4" />
                                                    Create variations
                                                </Button>
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

                                                                                                // cleared
                                                                                                if (!first) {
                                                                                                    setVariantImageFile(variationId, null);
                                                                                                    field.onChange('');
                                                                                                    return;
                                                                                                }

                                                                                                // file upload -> store file, set temp marker
                                                                                                if (first instanceof File) {
                                                                                                    setVariantImageFile(variationId, first);
                                                                                                    field.onChange(`__file__:${variationId}`);
                                                                                                    return;
                                                                                                }

                                                                                                // library url
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
                                                                    <FormField control={form.control} name={`variations.${index}.price`} render={({ field }) => (<FormItem><FormLabel>Regular price</FormLabel><FormControl><Input type="number" placeholder="25.00" {...field} value={field.value || ''} /></FormControl></FormItem>)} />
                                                                    <FormField control={form.control} name={`variations.${index}.salePrice`} render={({ field }) => (<FormItem><FormLabel>Sale price</FormLabel><FormControl><Input type="number" placeholder="19.99" {...field} value={field.value || ''} /></FormControl></FormItem>)} />
                                                                </div>
                                                                <FormField control={form.control} name={`variations.${index}.sku`} render={({ field }) => (<FormItem><FormLabel>SKU</FormLabel><FormControl><Input placeholder="TSHIRT-BLK-L" {...field} value={field.value || ''} /></FormControl></FormItem>)} />

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
                            <FormField control={form.control} name="shortDescription" render={({ field }) => (<FormItem><FormLabel>Product short description</FormLabel><FormControl><Textarea placeholder="A short and catchy description." rows={3} {...field} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        <div className="md:col-span-1 space-y-6">
                            <Card><CardHeader><CardTitle>Product Data</CardTitle></CardHeader>
                                <CardContent>
                                    <FormField
                                        control={form.control}
                                        name="productType"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Product Type</FormLabel>
                                                <Select
                                                    onValueChange={(value) => {
                                                        field.onChange(value);
                                                        if (value !== 'combo') {
                                                            form.setValue('comboProductIds', []);
                                                        }
                                                    }}
                                                    defaultValue={field.value}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select a product type" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="simple">Simple product</SelectItem>
                                                        <SelectItem value="variable">Variable product</SelectItem>
                                                        <SelectItem value="combo">Combo product</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </CardContent>
                            </Card>
                            <Tabs defaultValue="general" className="w-full">
                                <TabsList className="w-full">
                                    <TabsTrigger value="general" className="flex-1">General</TabsTrigger>
                                    <TabsTrigger value="inventory" className="flex-1 relative">
                                        Inventory
                                        {!skuValue && (
                                            <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700" title="SKU is required for inventory tracking.">
                                                !
                                            </span>
                                        )}
                                    </TabsTrigger>
                                    <TabsTrigger value="shipping" className="flex-1" disabled={productType === 'combo'}>Shipping</TabsTrigger>
                                    <TabsTrigger value="wholesale" className="flex-1">Wholesale</TabsTrigger>
                                </TabsList>
                                <TabsContent value="general" className="mt-6">
                                    <Card>
                                        <CardContent className="pt-6 space-y-4">
                                            <FormField control={form.control} name="price" render={({ field }) => (<FormItem><FormLabel>Regular price (৳)</FormLabel><FormControl><Input type="number" placeholder="25.00" {...field} value={field.value || ''} disabled={productType === 'combo'} /></FormControl><FormMessage /></FormItem>)} />
                                            <FormField control={form.control} name="salePrice" render={({ field }) => (<FormItem><FormLabel>Sale price (৳)</FormLabel><FormControl><Input type="number" placeholder="19.99" {...field} value={field.value || ''} /></FormControl><FormDescription>Leave blank to not have a sale.</FormDescription><FormMessage /></FormItem>)} />
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
                                            <FormField control={form.control} name="sku" render={({ field }) => (<FormItem><FormLabel>SKU</FormLabel><FormControl><Input placeholder="PARENT-SKU" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                                <TabsContent value="shipping" className="mt-6">
                                    <Card><CardContent className="pt-6 space-y-4">
                                        <FormField control={form.control} name="weight" render={({ field }) => (<FormItem><FormLabel>Weight (kg)</FormLabel><FormControl><Input type="number" placeholder="0.5" step="0.01" min="0" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />
                                        <div><Label>Dimensions (cm)</Label><div className="grid grid-cols-3 gap-2 mt-2">
                                            <FormField control={form.control} name="length" render={({ field }) => (<FormItem><FormControl><Input type="number" placeholder="L" step="0.01" min="0" {...field} value={field.value || ''} /></FormControl></FormItem>)} />
                                            <FormField control={form.control} name="width" render={({ field }) => (<FormItem><FormControl><Input type="number" placeholder="W" step="0.01" min="0" {...field} value={field.value || ''} /></FormControl></FormItem>)} />
                                            <FormField control={form.control} name="height" render={({ field }) => (<FormItem><FormControl><Input type="number" placeholder="H" step="0.01" min="0" {...field} value={field.value || ''} /></FormControl></FormItem>)} />
                                        </div></div>
                                    </CardContent></Card>
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
                                                    <FormField control={form.control} name="wholesalePrice" render={({ field }) => (<FormItem><FormLabel>Wholesale Price (৳)</FormLabel><FormControl><Input type="number" placeholder="15.00" {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>)} />
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
                            <Card><CardHeader><CardTitle>Organization</CardTitle></CardHeader>
                                <CardContent className="space-y-4">
                                    <FormField control={form.control} name="categoryIds" render={({ field }) => (
                                        <FormItem><FormLabel>Categories</FormLabel>
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
                                            <FormMessage /></FormItem>)} />
                                    <FormField control={form.control} name="tags" render={({ field }) => (<FormItem><FormLabel>Tags</FormLabel><FormControl><Input placeholder="Cotton, Eco-friendly" {...field} value={field.value || ''} /></FormControl><FormDescription>Comma-separated values.</FormDescription><FormMessage /></FormItem>)} />
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </form>
            </Form>
        </div>
    );
}



