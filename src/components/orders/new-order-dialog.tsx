'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import useSWR from 'swr';
import { Search, X, ShoppingBag, Box, Trash2, Barcode } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { createOrder, updateOrder } from '@/services/orders';
import { getProducts } from '@/services/products';
import { getBusinesses } from '@/services/partners';
import { getChartOfAccounts } from '@/services/accounting';
import { getCashDrawers } from '@/services/cash-drawers';
import { cn } from '@/lib/utils';
import { DEFAULT_IMAGE_PLACEHOLDER, resolveImageSrc } from '@/lib/image';
import { orderPlatforms } from '@/lib/placeholder-data';
import { hasBanglaDigits, isValidBdPhone } from '@/lib/phone';
import { getDeliveryReport, type DeliveryReport } from '@/services/delivery-score';
import { Textarea } from '@/components/ui/textarea';
import type { Product, Business, PaymentMethod, OrderPlatform, Account } from '@/types';
import { Switch } from '@/components/ui/switch';
import { LocationCombobox } from '@/components/orders/location-combobox';

const PAYMENT_METHODS = {
    cod: 'Cash on Delivery',
    paidShipping: 'Paid Shipping COD',
    partialPaid: 'Partial (Paid & COD)',
} as const;



const formSchema = z.object({
    customerName: z.string().min(1, 'Customer name required'),
    customerPhone: z.string().min(11, 'Valid phone required'),
    customerAddress: z.string().min(1, 'Address required'),
    customerCityId: z.string().min(1, 'City required'),
    customerZoneId: z.string().min(1, 'Zone required'),
    customerNote: z.string().optional(),
    officeNote: z.string().optional(),
    paymentMethod: z.string(),
    platform: z.string(),
    businessId: z.string().min(1, 'Business selection required'),
    paidAmount: z.number().min(0).default(0),
    paidFromAccountId: z.string().optional().nullable(),
    shippingCharge: z.number().min(0).default(0),
    discount: z.number().min(0).default(0),
    shippingPaid: z.boolean().default(false),
    shippingPaidAmount: z.number().min(0).default(0),
    shippingPaidAccountId: z.string().optional().nullable(),
    transactionId: z.string().optional().nullable(),
}).superRefine((data, ctx) => {
    const paidAccount = (data.paidFromAccountId || '').toString().trim();
    const shippingAccount = (data.shippingPaidAccountId || '').toString().trim();
    const isLiquid = ['Bank', 'bKash', 'Nagad', 'Rocket', 'PartialPaidCOD', 'PaidShippingCOD'].includes(data.paymentMethod);
    if (data.paidAmount > 0 && !paidAccount) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['paidFromAccountId'],
            message: 'Select an account for the paid amount.',
        });
    }

    if (isLiquid && (data.paidAmount > 0 || data.shippingPaidAmount > 0) && !data.transactionId?.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['transactionId'],
            message: 'Transaction reference (Phone/Tnx ID) is required for liquid payments.',
        });
    }

    if (data.shippingPaid && data.shippingPaidAmount > 0 && !shippingAccount) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['shippingPaidAccountId'],
            message: 'Select an account for the shipping payment.',
        });
    }
});

interface OrderItem {
    productId: string;
    variantId: string | null;
    name: string;
    sku: string;
    price: number;
    quantity: number;
    // Keep Woo line-discount stable across edit quantity changes.
    siteDiscountPerUnit?: number;
    image: string;
    maxStock?: number;
}

type LeadPrefill = {
    leadId: string;
    businessId?: string;
    customerName?: string;
    customerPhone?: string;
    customerAddress?: string;
    customerNote?: string;
    officeNote?: string;
    items?: Array<{
        productId: string;
        variantId: string | null;
        name: string;
        sku: string;
        price: number;
        quantity: number;
        image?: string;
    }>;
};

export function NewOrderDialog({ open, onOpenChange, onOrderCreated, onSubmitOverride, orderToEdit, baseOrderForExchange, leadPrefill }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOrderCreated?: (order?: any) => void;
    onSubmitOverride?: (payload: any) => Promise<void>;
    orderToEdit?: any; // Using any for flexibility, ideally Order type
    baseOrderForExchange?: any;
    leadPrefill?: LeadPrefill | null;
}) {
    const { toast } = useToast();
    const [submitting, setSubmitting] = React.useState(false);
    const normalizePlatform = (value?: string) =>
        orderPlatforms.includes(value as OrderPlatform) ? value : 'Website';

    const normalizeProductsResponse = (json: any) => json.data?.items || json.data || json.items || [];

    const fetchProductsList = async (params?: { search?: string; pageSize?: number }) => {
        const query = new URLSearchParams();
        query.set('pageSize', String(params?.pageSize ?? 100));
        if (params?.search) query.set('search', params.search);
        const res = await fetch(`/api/products?${query.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch products');
        const json = await res.json();
        return normalizeProductsResponse(json);
    };

    const productsFetcher = async () => fetchProductsList({ pageSize: 100 });

    const { data: productsData } = useSWR('products', productsFetcher, { revalidateOnMount: true });
    const { data: businessesData } = useSWR('businesses', getBusinesses);
    const { data: accountsData } = useSWR('accounts', getChartOfAccounts);
    const { data: drawersData } = useSWR('cash-drawers', getCashDrawers);

    const [orderItems, setOrderItems] = React.useState<OrderItem[]>([]);
    const [searchQuery, setSearchQuery] = React.useState('');
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const [selectedVariableProduct, setSelectedVariableProduct] = React.useState<any | null>(null);
    const [isProductPickerOpen, setIsProductPickerOpen] = React.useState(false);
    const [prefillCityName, setPrefillCityName] = React.useState('');
    const [prefillZoneName, setPrefillZoneName] = React.useState('');
    const [hasBusinessSelection, setHasBusinessSelection] = React.useState(false);
    const [citySearch, setCitySearch] = React.useState('');
    const [zoneSearch, setZoneSearch] = React.useState('');
    const deferredProductSearch = React.useDeferredValue(searchQuery.trim());
    const shouldUseServerProductSearch = deferredProductSearch.length >= 2;

    const { data: searchedProductsData, isLoading: isSearchProductsLoading } = useSWR(
        shouldUseServerProductSearch ? ['products-search', deferredProductSearch] : null,
        async ([, query]: [string, string]) => fetchProductsList({ search: query, pageSize: 200 }),
        {
            revalidateOnFocus: false,
            keepPreviousData: true,
            dedupingInterval: 15000,
        }
    );

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        mode: 'onChange',
        reValidateMode: 'onChange',
        defaultValues: {
            customerName: '',
            customerPhone: '',
            customerAddress: '',
            customerCityId: '',
            customerZoneId: '',
            customerNote: '',
            officeNote: '',
            paymentMethod: PAYMENT_METHODS.cod,
            platform: 'Website',
            businessId: '',
            paidAmount: 0,
            paidFromAccountId: '',
            shippingCharge: 0,
            discount: 0,
            shippingPaid: false,
            shippingPaidAmount: 0,
            shippingPaidAccountId: '',
            transactionId: '',
        }
    });

    const [deliveryReport, setDeliveryReport] = React.useState<DeliveryReport | null>(null);
    const [isReportLoading, setIsReportLoading] = React.useState(false);
    const availableAccounts = React.useMemo<Account[]>(() => accountsData || [], [accountsData]);
    const drawers = React.useMemo(() => drawersData || [], [drawersData]);
    const drawerAccountIds = React.useMemo(() => new Set(drawers.map((d: any) => d.accountId)), [drawers]);
    const liquidAccounts = React.useMemo(
        () => availableAccounts.filter((account) => 
            account.group === 'LIQUID' || drawerAccountIds.has(account.id)
        ),
        [availableAccounts, drawerAccountIds]
    );


    // Populate form when opening in Edit mode
    React.useEffect(() => {
        if (open && orderToEdit) {
            // Normalize Payment Method
            let method = orderToEdit.paymentMethod || PAYMENT_METHODS.cod;
            if (method === 'CashOnDelivery') method = PAYMENT_METHODS.cod;
            if (method === 'PaidShippingCOD') method = PAYMENT_METHODS.paidShipping;
            if (method === 'PartialPaidCOD') method = PAYMENT_METHODS.partialPaid;

            form.reset({
                customerName: orderToEdit.customerName,
                customerPhone: orderToEdit.customerPhone,
                customerAddress: (() => {
                    const sAddr = orderToEdit.shippingAddress;
                    // Case 1: shippingAddress is nested object { address: { address: "..." } }
                    if (typeof sAddr === 'object' && sAddr?.address && typeof sAddr.address === 'object') {
                        return sAddr.address.address || '';
                    }
                    // Case 2: shippingAddress is standard object { address: "..." }
                    if (typeof sAddr === 'object' && sAddr?.address && typeof sAddr.address === 'string') {
                        return sAddr.address;
                    }
                    // Case 3: shippingAddress is string (unlikely for JSON field but possible legacy)
                    if (typeof sAddr === 'string') return sAddr;

                    // Fallback
                    return orderToEdit.customerAddress || '';
                })(),
                customerCityId: orderToEdit.shippingAddress?.carrybeeCityId
                    ? String(orderToEdit.shippingAddress.carrybeeCityId)
                    : (orderToEdit.shippingAddress?.pathaoCityId ? String(orderToEdit.shippingAddress.pathaoCityId) : ''),
                customerZoneId: orderToEdit.shippingAddress?.carrybeeZoneId
                    ? String(orderToEdit.shippingAddress.carrybeeZoneId)
                    : (orderToEdit.shippingAddress?.pathaoZoneId ? String(orderToEdit.shippingAddress.pathaoZoneId) : ''),
                customerNote: orderToEdit.customerNote || '',
                officeNote: orderToEdit.officeNote || '',
                paymentMethod: method,
                platform: normalizePlatform(orderToEdit.platform),
                businessId: orderToEdit.businessId || '',
                paidAmount: orderToEdit.paidAmount || 0,
                paidFromAccountId: orderToEdit.paidFromAccountId || '',
                shippingCharge: orderToEdit.shipping || orderToEdit.shippingCharge || 0, // Handle 'shipping' vs 'shippingCharge' key difference
                discount: orderToEdit.discount || 0,
                shippingPaid: Boolean(orderToEdit.shippingPaid),
                shippingPaidAmount: orderToEdit.shippingPaidAmount || 0,
                shippingPaidAccountId: orderToEdit.shippingPaidAccountId || '',
                transactionId: orderToEdit.transactionId || '',
            });
            setPrefillCityName(orderToEdit.shippingAddress?.cityName || orderToEdit.shippingAddress?.district || '');
            setPrefillZoneName(orderToEdit.shippingAddress?.zoneName || orderToEdit.shippingAddress?.zone || '');

            // Populate Items
            const items = (orderToEdit.products || []).map((p: {
                productId: string;
                variantId?: string | null;
                name?: string;
                product?: { name: string; sku?: string | null; image?: string | null };
                sku?: string | null;
                price: number;
                quantity: number;
                siteDiscount?: number;
                image?: string | null;
            }) => ({
                productId: p.productId,
                variantId: p.variantId,
                name: p.name || p.product?.name,
                sku: p.sku || p.product?.sku,
                price: p.price,
                quantity: p.quantity,
                siteDiscountPerUnit: Number(p.quantity || 0) > 0 ? Number(p.siteDiscount || 0) / Number(p.quantity || 1) : 0,
                image: resolveImageSrc(p.image || p.product?.image),
                maxStock: 999
            }));
            setOrderItems(items);
            setHasBusinessSelection(false);
        } else if (open && baseOrderForExchange) {
            // Prefill from Base Order for Exchange
            const base = baseOrderForExchange;
            let method = base.paymentMethod || PAYMENT_METHODS.cod;
            if (method === 'CashOnDelivery') method = PAYMENT_METHODS.cod;
            if (method === 'PaidShippingCOD') method = PAYMENT_METHODS.paidShipping;
            if (method === 'PartialPaidCOD') method = PAYMENT_METHODS.partialPaid;

            form.reset({
                customerName: base.customerName,
                customerPhone: base.customerPhone,
                customerAddress: (() => {
                    const sAddr = base.shippingAddress;
                    if (typeof sAddr === 'object' && sAddr?.address && typeof sAddr.address === 'object') return sAddr.address.address || '';
                    if (typeof sAddr === 'object' && sAddr?.address && typeof sAddr.address === 'string') return sAddr.address;
                    if (typeof sAddr === 'string') return sAddr;
                    return base.customerAddress || '';
                })(),
                customerCityId: base.shippingAddress?.carrybeeCityId ? String(base.shippingAddress.carrybeeCityId) : '',
                customerZoneId: base.shippingAddress?.carrybeeZoneId ? String(base.shippingAddress.carrybeeZoneId) : '',
                customerNote: base.customerNote || '',
                officeNote: '',
                paymentMethod: PAYMENT_METHODS.cod,
                platform: normalizePlatform(base.platform),
                businessId: base.businessId || '',
                paidAmount: 0,
                paidFromAccountId: '',
                shippingCharge: 0,
                discount: 0,
                shippingPaid: false,
                shippingPaidAmount: 0,
                shippingPaidAccountId: '',
                transactionId: '',
            });
            setPrefillCityName(base.shippingAddress?.cityName || base.shippingAddress?.district || '');
            setPrefillZoneName(base.shippingAddress?.zoneName || base.shippingAddress?.zone || '');
            setOrderItems([]);
            setHasBusinessSelection(false);
        } else if (open && leadPrefill && !orderToEdit && !baseOrderForExchange) {
            form.reset({
                customerName: leadPrefill.customerName || '',
                customerPhone: leadPrefill.customerPhone || '',
                customerAddress: leadPrefill.customerAddress || '',
                customerCityId: '',
                customerZoneId: '',
                customerNote: leadPrefill.customerNote || '',
                officeNote: leadPrefill.officeNote || '',
                paymentMethod: PAYMENT_METHODS.cod,
                platform: 'Website',
                businessId: leadPrefill.businessId || '',
                paidAmount: 0,
                paidFromAccountId: '',
                shippingCharge: 0,
                discount: 0,
                shippingPaid: false,
                shippingPaidAmount: 0,
                shippingPaidAccountId: '',
                transactionId: '',
            });

            const mappedItems: OrderItem[] = (leadPrefill.items || []).map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                name: item.name,
                sku: item.sku,
                price: Number(item.price || 0),
                quantity: Number(item.quantity || 1),
                siteDiscountPerUnit: 0,
                image: resolveImageSrc(item.image || ''),
                maxStock: 999,
            }));

            setOrderItems(mappedItems);
            setPrefillCityName('');
            setPrefillZoneName('');
            setHasBusinessSelection(Boolean(leadPrefill.businessId));
        } else if (open && !orderToEdit) {
            form.reset({
                customerName: '',
                customerPhone: '',
                customerAddress: '',
                customerCityId: '',
                customerZoneId: '',
                customerNote: '',
                officeNote: '',
                paymentMethod: PAYMENT_METHODS.cod,
                platform: 'Website',
                businessId: '',
                paidAmount: 0,
                paidFromAccountId: '',
                shippingCharge: 0,
                discount: 0,
                shippingPaid: false,
                shippingPaidAmount: 0,
                shippingPaidAccountId: '',
                transactionId: '',
            });
            setOrderItems([]);
            setPrefillCityName('');
            setPrefillZoneName('');
            setHasBusinessSelection(false);
        }
    }, [open, orderToEdit, baseOrderForExchange, leadPrefill, form]);

    // Load draft from session storage on mount
    React.useEffect(() => {
        const draft = sessionStorage.getItem('new_order_draft');
        if (draft) {
            try {
                const parsed = JSON.parse(draft);
                if (parsed.formValues) form.reset(parsed.formValues);
                if (parsed.items) setOrderItems(parsed.items);
            } catch (e) {
                console.error("Failed to parse draft", e);
            }
        }
    }, []);

    // Save draft to session storage on change
    React.useEffect(() => {
        const subscription = form.watch((value) => {
            const draft = {
                formValues: value,
                items: orderItems
            };
            sessionStorage.setItem('new_order_draft', JSON.stringify(draft));
        });
        return () => subscription.unsubscribe();
    }, [form.watch, orderItems]);

    // Fetch default settings if no draft note (or even if draft loaded but had no note)
    React.useEffect(() => {
        // Incomplete->Convert flow: do not auto-inject default office note.
        if (leadPrefill && !orderToEdit && !baseOrderForExchange) return;

        // Only fetch if officeNote is empty
        if (!form.getValues('officeNote')) {
            fetch('/api/settings/courier-general')
                .then(res => res.json())
                .then(data => {
                    if (data.defaultNote) {
                        const currentNote = form.getValues('officeNote');
                        if (!currentNote) {
                            form.setValue('officeNote', data.defaultNote);
                        }
                    }
                })
                .catch(e => console.error("Failed to fetch settings", e));
        }
    }, [open, leadPrefill, orderToEdit, baseOrderForExchange]); // Re-check when dialog opens

    const phoneWatcher = form.watch('customerPhone');
    React.useEffect(() => {
        const handler = setTimeout(() => {
            if (phoneWatcher && phoneWatcher.length >= 11) {
                setIsReportLoading(true);
                getDeliveryReport(phoneWatcher)
                    .then(report => setDeliveryReport(report))
                    .finally(() => setIsReportLoading(false));
            } else {
                setDeliveryReport(null);
            }
        }, 500);
        return () => clearTimeout(handler);
    }, [phoneWatcher]);

    const products = Array.isArray(productsData) ? productsData : (productsData as any)?.items || [];
    const searchedProducts = Array.isArray(searchedProductsData) ? searchedProductsData : (searchedProductsData as any)?.items || [];
    const searchCatalog = shouldUseServerProductSearch ? searchedProducts : products;
    const businesses = Array.isArray(businessesData) ? businessesData : [];

    type CourierLocation = { id: string | number; name: string };
    const locationFetcher = async (url: string): Promise<CourierLocation[]> => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch locations');
        const json = await res.json();
        const list = json?.data?.items || json?.data || json?.items || [];
        return Array.isArray(list) ? list : [];
    };
    const locationSWRConfig = { revalidateOnFocus: false, dedupingInterval: 300000 };

    const selectedBusinessId = form.watch('businessId');
    const selectedCityId = form.watch('customerCityId');
    const selectedZoneId = form.watch('customerZoneId');
    const citySearchQuery = React.useDeferredValue(citySearch).trim();
    const zoneSearchQuery = React.useDeferredValue(zoneSearch).trim();

    const carrybeeCitiesParams = new URLSearchParams();
    if (selectedBusinessId) carrybeeCitiesParams.set('businessId', selectedBusinessId);
    if (citySearchQuery) carrybeeCitiesParams.set('q', citySearchQuery);
    carrybeeCitiesParams.set('limit', '120');
    if (selectedCityId) carrybeeCitiesParams.set('selectedId', selectedCityId);
    const carrybeeCitiesUrl = `/api/couriers/carrybee/cities?${carrybeeCitiesParams.toString()}`;

    const carrybeeZonesUrl = selectedCityId
        ? (
            (() => {
                const params = new URLSearchParams();
                if (selectedBusinessId) params.set('businessId', selectedBusinessId);
                params.set('cityId', selectedCityId);
                if (zoneSearchQuery) params.set('q', zoneSearchQuery);
                params.set('limit', '120');
                if (selectedZoneId) params.set('selectedId', selectedZoneId);
                return `/api/couriers/carrybee/zones?${params.toString()}`;
            })()
        )
        : null;
    const pathaoCitiesParams = new URLSearchParams();
    if (selectedBusinessId) pathaoCitiesParams.set('businessId', selectedBusinessId);
    if (citySearchQuery) pathaoCitiesParams.set('q', citySearchQuery);
    pathaoCitiesParams.set('limit', '120');
    if (selectedCityId) pathaoCitiesParams.set('selectedId', selectedCityId);
    const pathaoCitiesUrl = `/api/couriers/pathao/cities?${pathaoCitiesParams.toString()}`;

    const { data: carrybeeCitiesData, isLoading: isCitiesLoading } = useSWR(
        carrybeeCitiesUrl,
        locationFetcher,
        locationSWRConfig
    );
    const { data: carrybeeZonesData, isLoading: isZonesLoading } = useSWR(
        carrybeeZonesUrl,
        locationFetcher,
        locationSWRConfig
    );

    const { data: pathaoCitiesData } = useSWR(
        pathaoCitiesUrl,
        locationFetcher,
        locationSWRConfig
    );

    const normalizeLocationName = (value?: string) =>
        (value || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

    const carrybeeCities = Array.isArray(carrybeeCitiesData) ? carrybeeCitiesData : [];
    const carrybeeZones = Array.isArray(carrybeeZonesData) ? carrybeeZonesData : [];
    const pathaoCities = Array.isArray(pathaoCitiesData) ? pathaoCitiesData : [];

    const isPathaoPrimary = carrybeeCities.length === 0 && pathaoCities.length > 0;
    const availableCities = isPathaoPrimary ? pathaoCities : carrybeeCities;
    const cityOptions = React.useMemo(
        () =>
            availableCities.map((city) => ({
                id: String(city.id),
                name: String(city.name ?? city.id),
            })),
        [availableCities]
    );
    // availableZones and selectedZone moved to after pathaoZones definition to avoid TDZ

    const selectedCity = React.useMemo(
        () => availableCities.find((city) => String(city.id) === String(selectedCityId)),
        [availableCities, selectedCityId]
    );

    const storedCarrybeeCityId = orderToEdit?.shippingAddress?.carrybeeCityId ? String(orderToEdit.shippingAddress.carrybeeCityId) : '';
    const storedCarrybeeZoneId = orderToEdit?.shippingAddress?.carrybeeZoneId ? String(orderToEdit.shippingAddress.carrybeeZoneId) : '';
    const storedPathaoCityId = orderToEdit?.shippingAddress?.pathaoCityId ? String(orderToEdit.shippingAddress.pathaoCityId) : '';
    const storedPathaoZoneId = orderToEdit?.shippingAddress?.pathaoZoneId ? String(orderToEdit.shippingAddress.pathaoZoneId) : '';

    const mappedPathaoCity = React.useMemo(() => {
        if (!selectedCity) return null;
        if (isPathaoPrimary) return selectedCity; // If directly selected from Pathao list
        const needle = normalizeLocationName(selectedCity.name);
        return pathaoCities.find((city) => normalizeLocationName(city.name) === needle) || null;
    }, [selectedCity, pathaoCities, isPathaoPrimary]);

    const canUseStoredPathaoCity = Boolean(
        storedPathaoCityId && (
            (storedCarrybeeCityId && selectedCityId && storedCarrybeeCityId === selectedCityId) ||
            (!storedCarrybeeCityId && prefillCityName && selectedCityId) ||
            (isPathaoPrimary && selectedCityId === storedPathaoCityId)
        )
    );

    // If Pathao is primary, the selectedCityId IS the Pathao City ID
    const effectivePathaoCityId = isPathaoPrimary
        ? (selectedCityId || (canUseStoredPathaoCity ? storedPathaoCityId : ''))
        : (mappedPathaoCity?.id ? String(mappedPathaoCity.id) : (canUseStoredPathaoCity ? storedPathaoCityId : ''));

    const selectedPathaoZoneIdHint = isPathaoPrimary
        ? (selectedZoneId || storedPathaoZoneId || '')
        : (storedPathaoZoneId || '');
    const pathaoZonesUrl = effectivePathaoCityId
        ? (
            (() => {
                const params = new URLSearchParams();
                if (selectedBusinessId) params.set('businessId', selectedBusinessId);
                params.set('cityId', effectivePathaoCityId);
                if (zoneSearchQuery) params.set('q', zoneSearchQuery);
                params.set('limit', '120');
                if (selectedPathaoZoneIdHint) params.set('selectedId', selectedPathaoZoneIdHint);
                return `/api/couriers/pathao/zones?${params.toString()}`;
            })()
        )
        : null;
    const { data: pathaoZonesData } = useSWR(
        pathaoZonesUrl,
        locationFetcher,
        locationSWRConfig
    );
    const pathaoZones = Array.isArray(pathaoZonesData) ? pathaoZonesData : [];

    const availableZones = isPathaoPrimary ? pathaoZones : carrybeeZones;
    const zoneOptions = React.useMemo(
        () =>
            availableZones.map((zone) => ({
                id: String(zone.id),
                name: String(zone.name ?? zone.id),
            })),
        [availableZones]
    );
    const selectedZone = React.useMemo(
        () => availableZones.find((zone) => String(zone.id) === String(selectedZoneId)),
        [availableZones, selectedZoneId]
    );

    const mappedPathaoZone = React.useMemo(() => {
        if (!selectedZone) return null;
        if (isPathaoPrimary) return selectedZone;
        const needle = normalizeLocationName(selectedZone.name);
        return pathaoZones.find((zone) => normalizeLocationName(zone.name) === needle) || null;
    }, [selectedZone, pathaoZones, isPathaoPrimary]);

    const canUseStoredPathaoZone = Boolean(
        storedPathaoZoneId && (
            (storedCarrybeeZoneId && selectedZoneId && storedCarrybeeZoneId === selectedZoneId) ||
            (!storedCarrybeeZoneId && prefillZoneName && selectedZoneId) ||
            (isPathaoPrimary && selectedZoneId === storedPathaoZoneId)
        )
    );
    const effectivePathaoZoneId = isPathaoPrimary
        ? (selectedZoneId || (canUseStoredPathaoZone ? storedPathaoZoneId : ''))
        : (mappedPathaoZone?.id ? String(mappedPathaoZone.id) : (canUseStoredPathaoZone ? storedPathaoZoneId : ''));

    const previousCityRef = React.useRef<string | null>(null);
    const previousBusinessRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        if (!selectedBusinessId) {
            previousBusinessRef.current = null;
            return;
        }
        if (previousBusinessRef.current && previousBusinessRef.current !== selectedBusinessId && hasBusinessSelection) {
            form.setValue('customerCityId', '');
            form.setValue('customerZoneId', '');
            setCitySearch('');
            setZoneSearch('');
        }
        previousBusinessRef.current = selectedBusinessId;
    }, [selectedBusinessId, hasBusinessSelection, form]);

    React.useEffect(() => {
        if (!selectedCityId) {
            previousCityRef.current = null;
            return;
        }
        if (previousCityRef.current && previousCityRef.current !== selectedCityId) {
            form.setValue('customerZoneId', '');
            setZoneSearch('');
        }
        previousCityRef.current = selectedCityId;
    }, [selectedCityId, form]);

    React.useEffect(() => {
        if (selectedCityId || !prefillCityName || availableCities.length === 0) return;
        const needle = normalizeLocationName(prefillCityName);
        const match = availableCities.find((city) => normalizeLocationName(city.name) === needle);
        if (match) {
            form.setValue('customerCityId', String(match.id));
        }
    }, [availableCities, prefillCityName, selectedCityId, form]);

    React.useEffect(() => {
        if (!selectedCityId || selectedZoneId || !prefillZoneName || availableZones.length === 0) return;
        const needle = normalizeLocationName(prefillZoneName);
        const match = availableZones.find((zone) => normalizeLocationName(zone.name) === needle);
        if (match) {
            form.setValue('customerZoneId', String(match.id));
        }
    }, [availableZones, prefillZoneName, selectedCityId, selectedZoneId, form]);

    const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const siteDiscountTotal = orderItems.reduce(
        (sum, item) => sum + (Number(item.siteDiscountPerUnit || 0) * Number(item.quantity || 0)),
        0
    );
    const shippingCharge = form.watch('shippingCharge');
    const discount = form.watch('discount');
    const total = subtotal + shippingCharge - discount - siteDiscountTotal;
    const paymentMethod = form.watch('paymentMethod');
    const paidAmount = form.watch('paidAmount');
    const shippingPaid = form.watch('shippingPaid');
    const shippingPaidAmount = shippingPaid ? form.watch('shippingPaidAmount') : 0;
    const isCashOnDelivery = paymentMethod === PAYMENT_METHODS.cod;
    const isPaidShipping = paymentMethod === PAYMENT_METHODS.paidShipping;
    const isPartialPaid = paymentMethod === PAYMENT_METHODS.partialPaid;
    const isLiquidPaid =
        !isCashOnDelivery &&
        !isPaidShipping &&
        !isPartialPaid;
    const due = Math.max(total - paidAmount - shippingPaidAmount, 0);
    const previousPaymentMethod = React.useRef<string | null>(null);

    React.useEffect(() => {
        const previousMethod = previousPaymentMethod.current;
        previousPaymentMethod.current = paymentMethod || null;

        if (!paymentMethod) return;

        if (isCashOnDelivery) {
            if (paidAmount !== 0) form.setValue('paidAmount', 0, { shouldDirty: true });
            if (form.getValues('paidFromAccountId')) form.setValue('paidFromAccountId', '', { shouldDirty: true });
            if (shippingPaid) form.setValue('shippingPaid', false, { shouldDirty: true });
            if (shippingPaidAmount !== 0) form.setValue('shippingPaidAmount', 0, { shouldDirty: true });
            if (form.getValues('shippingPaidAccountId')) form.setValue('shippingPaidAccountId', '', { shouldDirty: true });
            return;
        }

        if (isPaidShipping) {
            if (!shippingPaid) form.setValue('shippingPaid', true, { shouldDirty: true });
            if (paidAmount !== 0) form.setValue('paidAmount', 0, { shouldDirty: true });
            if (form.getValues('paidFromAccountId')) form.setValue('paidFromAccountId', '', { shouldDirty: true });
            if (shippingPaidAmount !== shippingCharge) {
                form.setValue('shippingPaidAmount', shippingCharge || 0, { shouldDirty: true });
            }
            return;
        }

        if (isPartialPaid) {
            if (previousMethod && previousMethod !== PAYMENT_METHODS.partialPaid) {
                if (paidAmount !== 0) form.setValue('paidAmount', 0, { shouldDirty: true });
                if (form.getValues('paidFromAccountId')) form.setValue('paidFromAccountId', '', { shouldDirty: true });
            }
            if (shippingPaid) form.setValue('shippingPaid', false, { shouldDirty: true });
            if (shippingPaidAmount !== 0) form.setValue('shippingPaidAmount', 0, { shouldDirty: true });
            if (form.getValues('shippingPaidAccountId')) form.setValue('shippingPaidAccountId', '', { shouldDirty: true });
            return;
        }

        if (isLiquidPaid) {
            let accountId = '';
            const currentPaidFromAccountId = form.getValues('paidFromAccountId');
            const methodChanged = previousMethod !== null && previousMethod !== paymentMethod;
            if (paymentMethod === 'Cash') {
                const activeDrawers = drawers.filter((d: any) => d.isActive);
                const defaultDrawer = activeDrawers.find((d: any) => d.isDefault) || activeDrawers[0];
                if (defaultDrawer) accountId = defaultDrawer.accountId;
            } else {
                const nonDrawerLiquidAccounts = liquidAccounts.filter((account) => !drawerAccountIds.has(account.id));
                if (nonDrawerLiquidAccounts.length === 1) {
                    accountId = nonDrawerLiquidAccounts[0].id;
                } else if (!methodChanged && currentPaidFromAccountId && nonDrawerLiquidAccounts.some((account) => account.id === currentPaidFromAccountId)) {
                    accountId = currentPaidFromAccountId;
                }
            }

            if (paidAmount !== total) form.setValue('paidAmount', total, { shouldDirty: true });
            
            // Auto-select account automatically if method just changed or account not set
            if (methodChanged || !currentPaidFromAccountId) {
                if (accountId && currentPaidFromAccountId !== accountId) {
                    form.setValue('paidFromAccountId', accountId, { shouldDirty: true });
                } else if (!accountId && currentPaidFromAccountId) {
                    form.setValue('paidFromAccountId', '', { shouldDirty: true });
                }
            }
            if (shippingPaid) form.setValue('shippingPaid', false, { shouldDirty: true });
            if (shippingPaidAmount !== 0) form.setValue('shippingPaidAmount', 0, { shouldDirty: true });
            if (form.getValues('shippingPaidAccountId')) form.setValue('shippingPaidAccountId', '', { shouldDirty: true });
        }
    }, [
        paymentMethod,
        isCashOnDelivery,
        isPaidShipping,
        isPartialPaid,
        isLiquidPaid,
        shippingCharge,
        total,
        paidAmount,
        shippingPaid,
        shippingPaidAmount,
        drawers,
        liquidAccounts,
        drawerAccountIds,
        form,
    ]);

    const filteredProducts = React.useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return [];
        return searchCatalog.filter((p: any) =>
            p.name.toLowerCase().includes(query) ||
            p.sku?.toLowerCase().includes(query)
        );
    }, [searchCatalog, searchQuery]);

    const addItemToOrder = (product: any, variant: any = null) => {
        setOrderItems(prev => {
            const existingIndex = prev.findIndex(item =>
                item.productId === product.id &&
                ((!variant && !item.variantId) || (variant && item.variantId === variant.id))
            );

            if (existingIndex >= 0) {
                const updated = [...prev];
                updated[existingIndex].quantity += 1;
                return updated;
            } else {
                return [...prev, {
                    productId: product.id,
                    variantId: variant?.id || null,
                    name: variant ? `${product.name} - ${variant.name}` : product.name,
                    sku: variant?.sku || product.sku,
                    price: variant?.salePrice || variant?.price || product.salePrice || product.price,
                    quantity: 1,
                    siteDiscountPerUnit: 0,
                    image: resolveImageSrc(product.images?.[0]),
                    maxStock: variant ? variant.inventory : product.inventory
                }];
            }
        });

        setSelectedVariableProduct(null);
        setIsProductPickerOpen(false);
        setSearchQuery('');
        setTimeout(() => searchInputRef.current?.focus(), 0);
    };

    const findExactProductOrVariant = React.useCallback((catalog: any[], query: string) => {
        const exactProduct = catalog.find((p: any) => p.sku?.toLowerCase() === query);
        if (exactProduct) return { product: exactProduct, variant: null };

        for (const p of catalog) {
            if (!Array.isArray(p.variants)) continue;
            const exactVariant = p.variants.find((v: any) => v.sku?.toLowerCase() === query);
            if (exactVariant) return { product: p, variant: exactVariant };
        }

        return null;
    }, []);

    // Goal D Auto-select logic
    React.useEffect(() => {
        if (!deferredProductSearch || deferredProductSearch.length === 0) return;
        if (shouldUseServerProductSearch && isSearchProductsLoading) return;
        if (!searchCatalog || searchCatalog.length === 0) return;

        const query = deferredProductSearch.toLowerCase();
        let exactMatch = findExactProductOrVariant(searchCatalog, query);

        // Fallback removed per Goal D robustness: no accidental auto-add from fuzzy non-exact single-result cases

        if (exactMatch) {
            const { product, variant } = exactMatch;

            if (!variant) {
                if (product.productType === 'variable') {
                    // Pre-select the variable product to force variant choice
                    if (selectedVariableProduct?.id !== product.id) {
                        setSelectedVariableProduct(product);
                        setIsProductPickerOpen(true);
                        setSearchQuery('');
                        toast({ title: "Variable Product Found", description: "Please select a variant." });
                    }
                    return;
                }

                if (product.inventory > 0) {
                    addItemToOrder(product);
                    toast({ title: "Item Added", description: `${product.name} added to order.` });
                } else {
                    // If out of stock, we still want to clear and focus back so they don't get stuck
                    setSearchQuery('');
                    setTimeout(() => searchInputRef.current?.focus(), 0);
                    toast({ variant: "destructive", title: "Out of Stock", description: `${product.name} is out of stock.` });
                }
            } else {
                if (variant.inventory > 0) {
                    addItemToOrder(product, variant);
                    toast({ title: "Item Added", description: `${product.name} (${variant.name}) added to order.` });
                } else {
                    setSearchQuery('');
                    setTimeout(() => searchInputRef.current?.focus(), 0);
                    toast({ variant: "destructive", title: "Out of Stock", description: `${product.name} (${variant.name}) is out of stock.` });
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deferredProductSearch, searchCatalog, isSearchProductsLoading, shouldUseServerProductSearch, findExactProductOrVariant]);

    const handleBarcodeScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if ((e.key === 'Enter' || e.key === 'NumpadEnter' || e.key === 'Tab') && searchQuery.trim().length > 0) {
            e.preventDefault();
            const query = searchQuery.trim().toLowerCase();
            let exactMatch = findExactProductOrVariant(searchCatalog, query);

            // Fallback: query server directly so products beyond initial page are discoverable
            if (!exactMatch) {
                try {
                    const remoteCatalog = await fetchProductsList({ search: query, pageSize: 200 });
                    exactMatch = findExactProductOrVariant(remoteCatalog, query);
                } catch {
                    // no-op, user-facing message below
                }
            }

            if (!exactMatch) {
                toast({ variant: "destructive", title: "Not Found", description: `No product found with SKU "${searchQuery}"` });
                return;
            }

            const { product, variant } = exactMatch;
            if (!variant) {
                if (product.productType === 'variable') {
                    setSelectedVariableProduct(product);
                    setIsProductPickerOpen(true);
                    toast({ title: "Variable Product Found", description: "Please select a variant." });
                    return;
                }
                if (product.inventory > 0) {
                    addItemToOrder(product);
                    toast({ title: "Item Added", description: `${product.name} added to order.` });
                    return;
                }
                toast({ variant: "destructive", title: "Out of Stock", description: `${product.name} is currently out of stock.` });
                return;
            }

            if (variant.inventory > 0) {
                addItemToOrder(product, variant);
                toast({ title: "Item Added", description: `${product.name} (${variant.name}) added to order.` });
                return;
            }
            toast({ variant: "destructive", title: "Out of Stock", description: `${product.name} (${variant.name}) is out of stock.` });
        }
    };

    const removeItem = (index: number) => {
        setOrderItems(prev => prev.filter((_, i) => i !== index));
    };

    const updateQuantity = (index: number, newQty: number) => {
        if (newQty < 1) return;
        setOrderItems(prev => {
            const updated = [...prev];
            updated[index].quantity = newQty;
            return updated;
        });
    };

    const handleInputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        // Delay scroll to allow keyboard to appear
        setTimeout(() => {
            e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
    };

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        if (orderItems.length === 0) {
            toast({ variant: 'destructive', title: 'Error', description: 'Add at least one product.' });
            return;
        }

        setSubmitting(true);
        try {
            const isLiquidPaidMethod =
                ![PAYMENT_METHODS.cod, PAYMENT_METHODS.paidShipping, PAYMENT_METHODS.partialPaid].includes(values.paymentMethod as any);
            const liquidMethodCanonical = isLiquidPaidMethod
                ? values.paymentMethod
                : null;
            const normalizedValues = { ...values };

            if (values.paymentMethod === PAYMENT_METHODS.cod) {
                normalizedValues.paidAmount = 0;
                normalizedValues.paidFromAccountId = null;
                normalizedValues.shippingPaid = false;
                normalizedValues.shippingPaidAmount = 0;
                normalizedValues.shippingPaidAccountId = null;
            } else if (values.paymentMethod === PAYMENT_METHODS.paidShipping) {
                normalizedValues.paidAmount = 0;
                normalizedValues.paidFromAccountId = null;
                normalizedValues.shippingPaid = true;
                normalizedValues.shippingPaidAmount = values.shippingCharge || 0;
            } else if (values.paymentMethod === PAYMENT_METHODS.partialPaid) {
                normalizedValues.shippingPaid = false;
                normalizedValues.shippingPaidAmount = 0;
                normalizedValues.shippingPaidAccountId = null;
            } else if (isLiquidPaidMethod) {
                normalizedValues.paidAmount = total;

                normalizedValues.shippingPaid = false;
                normalizedValues.shippingPaidAmount = 0;
                normalizedValues.shippingPaidAccountId = null;
                if (liquidMethodCanonical) {
                    normalizedValues.paymentMethod = liquidMethodCanonical;
                }
            }

            const paymentMethodMap: Record<string, any> = {
                [PAYMENT_METHODS.cod]: 'CashOnDelivery',
                [PAYMENT_METHODS.paidShipping]: 'PaidShippingCOD',
                [PAYMENT_METHODS.partialPaid]: 'PartialPaidCOD',
            };
            const cityName = selectedCity?.name || prefillCityName || '';
            const zoneName = selectedZone?.name || prefillZoneName || '';

            // If Pathao is primary, we save the selected IDs as Pathao IDs
            // If Carrybee is primary, we save them as Carrybee IDs (and the derived effective Pathao IDs)

            const carrybeeCityId = isPathaoPrimary ? undefined : (values.customerCityId || undefined);
            const carrybeeZoneId = isPathaoPrimary ? undefined : (values.customerZoneId || undefined);

            const pathaoCityId = effectivePathaoCityId ? String(effectivePathaoCityId) : undefined;
            const pathaoZoneId = effectivePathaoZoneId ? String(effectivePathaoZoneId) : undefined;

            const payload = {
                customerName: normalizedValues.customerName,
                customerPhone: normalizedValues.customerPhone,
                status: orderToEdit ? orderToEdit.status : 'New',
                platform: normalizePlatform(normalizedValues.platform),
                items: orderItems.map((item) => {
                    const products = (productsData || []) as Product[];
                    const p = products.find(prod => prod.id === item.productId);
                    const v = p?.variants.find(varnt => varnt.id === item.variantId);
                    return {
                        productId: item.productId,
                        name: v?.name || p?.name || 'Product',
                        sku: v?.sku || p?.sku || '',
                        variantId: item.variantId || undefined,
                        image: {
                            imageUrl: v?.image || p?.image || '',
                            imageHint: v?.name || p?.name || ''
                        },
                        quantity: item.quantity,
                        price: item.price,
                        siteDiscount: Number(item.siteDiscountPerUnit || 0) * Number(item.quantity || 0),
                    };
                }),
                source: orderToEdit ? undefined : (leadPrefill?.leadId ? 'woo-incomplete' : 'manual'),
                leadId: leadPrefill?.leadId,
                shipping: normalizedValues.shippingCharge,
                discount: normalizedValues.discount,
                customerNote: normalizedValues.customerNote,
                officeNote: normalizedValues.officeNote,
                businessId: normalizedValues.businessId,
                paymentMethod:
                    paymentMethodMap[normalizedValues.paymentMethod] ||
                    normalizedValues.paymentMethod ||
                    'CashOnDelivery',
                paidAmount: normalizedValues.paidAmount,
                paidFromAccountId: normalizedValues.paidFromAccountId || undefined,
                transactionId: normalizedValues.transactionId || undefined,
                shippingPaid: normalizedValues.shippingPaid,
                shippingPaidAmount: normalizedValues.shippingPaid ? normalizedValues.shippingPaidAmount : 0,
                shippingPaidAccountId: normalizedValues.shippingPaid ? (normalizedValues.shippingPaidAccountId || undefined) : undefined,
                ...(normalizedValues.customerAddress.trim() ? {
                    shippingAddress: {
                        address: normalizedValues.customerAddress,
                        city: cityName || undefined,
                        district: cityName || '',
                        cityName: cityName || undefined,
                        zoneName: zoneName || undefined,
                        carrybeeCityId,
                        carrybeeZoneId,
                        pathaoCityId,
                        pathaoZoneId,
                        zone: zoneName || undefined,
                        country: 'Bangladesh',
                    }
                } : {})
            };

            if (onSubmitOverride) {
                await onSubmitOverride(payload);
                toast({ title: "Updated", description: `Order processed successfully.` });
                sessionStorage.removeItem('new_order_draft');
                onOpenChange(false);
                return;
            }

            if (orderToEdit) {
                await updateOrder(orderToEdit.id, payload);
                toast({ title: "Updated", description: `Order ${orderToEdit.orderNumber || orderToEdit.id} updated successfully.` });
            } else if (baseOrderForExchange) {
                const res = await fetch('/api/orders/exchange', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sourceOrderId: baseOrderForExchange.id,
                        items: orderItems.map(item => ({
                            productId: item.productId,
                            variantId: item.variantId,
                            quantity: item.quantity,
                            price: item.price,
                            siteDiscount: 0, // Default to 0 for manual exchange items
                        })),
                        shippingCost: values.shippingCharge,
                        discount: values.discount,
                        user: 'System'
                    }),
                });
                if (!res.ok) throw new Error((await res.json()).message || 'Failed to create exchange');

                sessionStorage.removeItem('new_order_draft');
                toast({ title: "Exchange Created", description: "Exchange order created successfully." });
            } else {
                const created = await createOrder(payload);
                sessionStorage.removeItem('new_order_draft');
                toast({ title: "Created", description: "New order created successfully." });
                if (onOrderCreated) onOrderCreated(created);
            }

            if (onOrderCreated && (orderToEdit || baseOrderForExchange)) onOrderCreated();
            onOpenChange(false);
            if (!orderToEdit) {
                form.reset();
                setOrderItems([]);
            }
        } catch (error: any) {
            if (error.fieldErrors && typeof error.fieldErrors === 'object') {
                for (const [field, messages] of Object.entries(error.fieldErrors)) {
                    const msg = Array.isArray(messages) ? messages[0] : messages;
                    if (msg) form.setError(field as any, { message: String(msg) });
                }
            } else {
                toast({ variant: "destructive", title: "Error", description: error.message || "Operation failed." });
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] lg:max-w-7xl h-[95vh] lg:h-[90vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl shadow-2xl [&>button]:hidden">
                <DialogHeader className="px-6 py-4 border-b bg-muted/40 shrink-0">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-xl flex items-center gap-2">
                            <ShoppingBag className="w-5 h-5" />
                            {orderToEdit ? 'Edit Order' : (baseOrderForExchange ? 'Create Exchange Order' : 'New Order')}
                        </DialogTitle>
                        <DialogClose asChild>
                            <Button variant="ghost" size="icon">
                                <X className="h-5 w-5" />
                                <span className="sr-only">Close</span>
                            </Button>
                        </DialogClose>
                    </div>
                    <DialogDescription>
                        {orderToEdit ? 'Update details for this order.' : 'Create a new order instantly. Search to add items.'}
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-slate-50">
                        {/* Left Side: Products (Desktop: Left, Mobile: Top, Auto Height) */}
                        <div className="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r bg-background shrink-0 lg:h-full lg:flex-1 h-auto lg:max-h-none">
                            {/* Search Bar */}
                            <div className="p-4 border-b space-y-4 relative shrink-0 z-20 bg-background">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-50" />
                                    <Input
                                        placeholder="Search Products (Name, SKU)..."
                                        value={searchQuery}
                                        ref={searchInputRef}
                                        onChange={(e) => {
                                            setSearchQuery(e.target.value);
                                            if (!isProductPickerOpen) setIsProductPickerOpen(true);
                                        }}
                                        onFocus={() => setIsProductPickerOpen(true)}
                                        onKeyDown={handleBarcodeScan}
                                        className="pl-10 pr-24 h-12 text-base shadow-sm border-2 border-primary/20 focus-visible:border-primary/50"
                                        autoFocus
                                    />
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none select-none">
                                        <div className="flex items-center gap-1.5 px-2 py-1 bg-green-500/10 border border-green-500/20 rounded-md">
                                            <div className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                            </div>
                                            <span className="text-[10px] font-bold text-green-600 uppercase tracking-wider hidden sm:inline">Scan Ready</span>
                                        </div>
                                        <Barcode className="h-5 w-5 text-muted-foreground opacity-40" />
                                    </div>
                                </div>

                                {isProductPickerOpen && (searchQuery.length > 0 || selectedVariableProduct) && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => { setIsProductPickerOpen(false); setSelectedVariableProduct(null); }} />
                                        <Card className="absolute left-4 right-4 top-[calc(100%-8px)] z-50 shadow-2xl border-primary/10 overflow-hidden min-h-[100px] max-h-[250px] flex flex-col">
                                            <div className="flex-1 overflow-y-auto">
                                                {selectedVariableProduct ? (
                                                    <div className="p-2">
                                                        <div className="flex justify-between items-center mb-2 px-2 py-1 bg-primary/5 rounded">
                                                            <span className="font-bold text-sm">Select Variant for {selectedVariableProduct.name}</span>
                                                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setSelectedVariableProduct(null)}>
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-2 max-h-[380px] overflow-y-auto">
                                                            {selectedVariableProduct.variants?.map((v: any) => {
                                                                const attrText = v.attributes ? Object.values(v.attributes).filter(Boolean).join(' / ') : v.name;
                                                                return (
                                                                    <Button
                                                                        key={v.id}
                                                                        variant="outline"
                                                                        onClick={() => addItemToOrder(selectedVariableProduct, v)}
                                                                        disabled={v.inventory <= 0}
                                                                        className="h-auto p-3 flex items-center justify-between hover:bg-primary/5 border-2"
                                                                    >
                                                                        <div className="flex flex-col items-start px-1">
                                                                            <span className="font-medium">{attrText}</span>
                                                                            <span className="text-xs text-muted-foreground uppercase">{v.sku}</span>
                                                                        </div>
                                                                        <div className="flex flex-col items-end gap-1">
                                                                            <span className="font-bold text-lg">৳{v.salePrice || v.price || selectedVariableProduct.salePrice || selectedVariableProduct.price}</span>
                                                                            <Badge variant={v.inventory > 0 ? "outline" : "destructive"} className="text-[10px] h-5">
                                                                                {v.inventory > 0 ? `${v.inventory} in stock` : 'Out of Stock'}
                                                                            </Badge>
                                                                        </div>
                                                                    </Button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="p-1">
                                                        {isSearchProductsLoading && shouldUseServerProductSearch ? (
                                                            <div className="p-8 text-center text-muted-foreground text-sm">Searching products...</div>
                                                        ) : filteredProducts.length === 0 ? (
                                                            <div className="p-8 text-center text-muted-foreground text-sm">No products found for "{searchQuery}"</div>
                                                        ) : (
                                                            filteredProducts.slice(0, 50).map((product: any) => (
                                                                <div
                                                                    key={product.id}
                                                                    onClick={() => product.variants?.length ? setSelectedVariableProduct(product) : addItemToOrder(product)}
                                                                    className="flex items-center gap-3 p-3 hover:bg-primary/5 cursor-pointer rounded-md transition-colors border-b last:border-0 border-slate-50"
                                                                >
                                                                    <div className="h-10 w-10 rounded-md border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                                                                        <img src={resolveImageSrc(product.images?.[0])} alt="" className="h-full w-full object-cover" />
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="font-medium text-base leading-tight truncate">{product.name}</div>
                                                                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                                                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded uppercase">{product.sku || 'N/A'}</span>
                                                                            {!product.variants?.length && (
                                                                                <span className={cn("font-medium", product.inventory > 0 ? "text-green-600" : "text-red-600")}>
                                                                                    {product.inventory} in stock
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <div className="font-bold text-lg text-primary">৳{product.salePrice || product.price}</div>
                                                                    </div>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </Card>
                                    </>
                                )}
                            </div>

                            {/* Cart List */}
                            <div className="flex-1 min-h-0 lg:overflow-y-auto bg-slate-50/50">
                                {orderItems.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4 opacity-60 p-8">
                                        <Box className="h-16 w-16 stroke-1" />
                                        <div className="text-center">
                                            <p className="text-lg font-medium">No items yet</p>
                                            <p className="text-sm">Search to add products</p>
                                        </div>
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader className="bg-white sticky top-0 z-10 shadow-sm">
                                            <TableRow>
                                                <TableHead className="w-[50%]">Product</TableHead>
                                                <TableHead className="w-[15%] text-center">Qty</TableHead>
                                                <TableHead className="w-[15%] text-right">Price</TableHead>
                                                <TableHead className="w-[15%] text-right">Total</TableHead>
                                                <TableHead className="w-[5%]"></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {orderItems.map((item, index) => (
                                                <TableRow key={`${item.productId}-${item.variantId || 'simple'}-${index}`} className="bg-white border-b-0 hover:bg-white/80">
                                                    <TableCell>
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-12 w-12 rounded border bg-muted overflow-hidden shrink-0">
                                                                <img src={item.image || DEFAULT_IMAGE_PLACEHOLDER} alt="" className="h-full w-full object-cover" />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="font-medium line-clamp-1 text-sm" title={item.name}>{item.name}</div>
                                                                <div className="text-[10px] text-muted-foreground uppercase">SKU: {item.sku || 'N/A'}</div>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center justify-center gap-2">
                                                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(index, item.quantity - 1)}>-</Button>
                                                            <span className="w-6 text-center tabular-nums text-sm">{item.quantity}</span>
                                                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(index, item.quantity + 1)} disabled={item.maxStock !== undefined && item.quantity >= item.maxStock}>+</Button>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums text-sm">৳{item.price}</TableCell>
                                                    <TableCell className="text-right font-medium tabular-nums text-sm">৳{item.price * item.quantity}</TableCell>
                                                    <TableCell>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-50 hover:opacity-100" onClick={() => removeItem(index)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </div>
                        </div>

                        {/* Right Sidebar: Customer & Payment */}
                        <div className="w-full lg:w-[400px] shrink-0 flex flex-col h-auto lg:h-full lg:overflow-hidden bg-background">
                            <div className="flex-1 lg:overflow-y-auto p-4 lg:p-6 space-y-4 lg:space-y-6">
                                <FormField control={form.control} name="customerName" render={({ field }) => (
                                    <FormItem><FormLabel>Customer Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                                )} />

                                <FormField control={form.control} name="customerPhone" render={({ field }) => (
                                    <FormItem><FormLabel>Phone *</FormLabel><FormControl><Input {...field} placeholder="01XXXXXXXXX" onFocus={handleInputFocus} onChange={(e) => {
                                        field.onChange(e);
                                        const v = e.target.value;
                                        if (hasBanglaDigits(v)) {
                                            form.setError('customerPhone', { message: 'ইংরেজি সংখ্যা ব্যবহার করুন' });
                                        } else if (v.length >= 11 && !isValidBdPhone(v)) {
                                            form.setError('customerPhone', { message: 'সঠিক ফোন নম্বর দিন' });
                                        } else {
                                            form.clearErrors('customerPhone');
                                        }
                                    }} /></FormControl><FormMessage /></FormItem>
                                )} />

                                <FormField control={form.control} name="customerAddress" render={({ field }) => (
                                    <FormItem><FormLabel>Address *</FormLabel><FormControl><Input {...field} onFocus={handleInputFocus} /></FormControl><FormMessage /></FormItem>
                                )} />

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="customerCityId" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>City *</FormLabel>
                                            <FormControl>
                                                <LocationCombobox
                                                    value={field.value || ''}
                                                    onChange={field.onChange}
                                                    onSearchChange={setCitySearch}
                                                    options={cityOptions}
                                                    loading={isCitiesLoading && cityOptions.length === 0}
                                                    disabled={false}
                                                    placeholder={isCitiesLoading ? 'Loading cities...' : 'Select city'}
                                                    searchPlaceholder="Search city..."
                                                    emptyText="No cities found"
                                                    maxVisible={120}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="customerZoneId" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Zone *</FormLabel>
                                            <FormControl>
                                                <LocationCombobox
                                                    value={field.value || ''}
                                                    onChange={field.onChange}
                                                    onSearchChange={setZoneSearch}
                                                    options={zoneOptions}
                                                    loading={Boolean(selectedCityId) && isZonesLoading && zoneOptions.length === 0}
                                                    disabled={!selectedCityId}
                                                    placeholder={!selectedCityId ? 'Select city first' : (isZonesLoading ? 'Loading zones...' : 'Select zone')}
                                                    searchPlaceholder="Search zone..."
                                                    emptyText="No zones found"
                                                    maxVisible={120}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                </div>

                                <FormField control={form.control} name="platform" render={({ field }) => (
                                    <FormItem><FormLabel>Platform</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{orderPlatforms.map(p => (<SelectItem key={p} value={p}>{p}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>
                                )} />

                                <FormField control={form.control} name="businessId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Business *</FormLabel>
                                        <Select
                                            onValueChange={(value) => {
                                                field.onChange(value);
                                                setHasBusinessSelection(true);
                                            }}
                                            value={field.value || ''}
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select business" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {businesses.map((b: Business) => (
                                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )} />

                                <FormField
                                    control={form.control}
                                    name="paymentMethod"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Payment Method</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select payment method" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        <SelectLabel>COD Options</SelectLabel>
                                                        <SelectItem value={PAYMENT_METHODS.cod}>{PAYMENT_METHODS.cod}</SelectItem>
                                                        <SelectItem value={PAYMENT_METHODS.paidShipping}>{PAYMENT_METHODS.paidShipping}</SelectItem>
                                                        <SelectItem value={PAYMENT_METHODS.partialPaid}>{PAYMENT_METHODS.partialPaid}</SelectItem>
                                                    </SelectGroup>
                                                    <SelectGroup>
                                                        <SelectLabel>Paid Methods</SelectLabel>
                                                        <SelectItem value="Cash">Cash</SelectItem>
                                                        <SelectItem value="Bank">Bank</SelectItem>
                                                        <SelectItem value="bKash">bKash</SelectItem>
                                                        <SelectItem value="Nagad">Nagad</SelectItem>
                                                        <SelectItem value="Rocket">Rocket</SelectItem>
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="space-y-4 pt-2">
                                    <h4 className="font-semibold text-sm">Notes</h4>
                                    <FormField control={form.control} name="customerNote" render={({ field }) => (
                                        <FormItem><FormLabel className="text-xs text-muted-foreground">Customer Note</FormLabel><FormControl><Textarea {...field} className="min-h-[60px] text-sm" placeholder="Visible to customer" onFocus={handleInputFocus} /></FormControl></FormItem>
                                    )} />
                                    <FormField control={form.control} name="officeNote" render={({ field }) => (
                                        <FormItem><FormLabel className="text-xs text-muted-foreground">Office Note</FormLabel><FormControl><Textarea {...field} className="min-h-[60px] text-sm" placeholder="Internal only" onFocus={handleInputFocus} /></FormControl></FormItem>
                                    )} />
                                </div>

                                {deliveryReport && (
                                    <Card className="p-3 bg-blue-50/50 border-blue-100 mt-4">
                                        <div className="text-[10px] uppercase font-bold text-blue-600/80 mb-2.5 flex justify-between items-center">
                                            <span>Courier History</span>
                                            {(() => {
                                                const summaries = deliveryReport.Summaries || {};
                                                const total = Object.values(summaries).reduce((acc: number, curr: any) => acc + (curr["Total Parcels"] || curr["Total Delivery"] || 0), 0);
                                                return <span className="text-muted-foreground font-medium lowercase">Total: {total} parcels</span>;
                                            })()}
                                        </div>
                                        <div className="space-y-3">
                                            {(() => {
                                                const summaries = deliveryReport.Summaries || {};
                                                const stats = Object.entries(summaries).map(([_, data]: [string, any]) => ({
                                                    total: data["Total Parcels"] || data["Total Delivery"] || 0,
                                                    delivered: data["Delivered Parcels"] || data["Successful Delivery"] || 0,
                                                    canceled: data["Canceled Parcels"] || data["Canceled Delivery"] || 0,
                                                }));

                                                const totals = stats.reduce((acc, curr) => {
                                                    acc.total += curr.total;
                                                    acc.delivered += curr.delivered;
                                                    acc.canceled += curr.canceled;
                                                    return acc;
                                                }, { total: 0, delivered: 0, canceled: 0 });

                                                const successRatio = totals.total > 0 ? Math.round((totals.delivered / totals.total) * 100) : 0;
                                                const cancelRatio = totals.total > 0 ? Math.round((totals.canceled / totals.total) * 100) : 0;

                                                return (
                                                    <>
                                                        <div className="w-full bg-slate-200/70 rounded-full h-2 flex overflow-hidden shadow-sm">
                                                            <div className="bg-green-500 h-full transition-all duration-500" style={{ width: `${successRatio}%` }} />
                                                            <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${cancelRatio}%` }} />
                                                        </div>
                                                        <div className="flex justify-between items-center text-[11px]">
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="h-2 w-2 rounded-full bg-green-500" />
                                                                <span className="text-muted-foreground font-medium">Successful:</span>
                                                                <b className="text-green-700">{successRatio}% ({totals.delivered})</b>
                                                            </div>
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="h-2 w-2 rounded-full bg-red-500" />
                                                                <span className="text-muted-foreground font-medium">Failed:</span>
                                                                <b className="text-red-700">{cancelRatio}% ({totals.canceled})</b>
                                                            </div>
                                                        </div>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </Card>
                                )}

                                <Separator />

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="shippingCharge" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Shipping</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    placeholder="0"
                                                    {...field}
                                                    value={field.value === 0 ? '' : field.value}
                                                    onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="discount" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Discount</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    placeholder="0"
                                                    {...field}
                                                    value={field.value === 0 ? '' : field.value}
                                                    onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                </div>

                                {isLiquidPaid && paymentMethod === 'Cash' && (
                                    <FormField control={form.control} name="paidFromAccountId" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Cash Received In *</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value || ''}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select drawer" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {drawers.filter((d: any) => d.isActive).map((drawer: any) => (
                                                        <SelectItem key={`drawer-${drawer.accountId}`} value={drawer.accountId}>
                                                            {drawer.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                )}

                                {isPartialPaid && (
                                    <>
                                        <FormField control={form.control} name="paidAmount" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Paid Amount</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        placeholder="0"
                                                        {...field}
                                                        value={field.value === 0 ? '' : field.value}
                                                        onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />

                                        <FormField control={form.control} name="paidFromAccountId" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Paid Amount Account</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value || ''}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select account" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {drawers.filter((d: any) => d.isActive).map((drawer: any) => (
                                                            <SelectItem key={`drawer-${drawer.accountId}`} value={drawer.accountId}>
                                                                {drawer.name}
                                                            </SelectItem>
                                                        ))}
                                                        {liquidAccounts
                                                          .filter(acc => !drawerAccountIds.has(acc.id))
                                                          .map((account) => (
                                                            <SelectItem key={account.id} value={account.id}>
                                                                {account.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </>
                                )}

                                {isPaidShipping && (
                                    <div className="space-y-3 rounded-lg border p-3">
                                        <div>
                                            <p className="text-sm font-medium">Shipping Paid</p>
                                            <p className="text-xs text-muted-foreground">
                                                Shipping amount (৳{shippingCharge.toFixed(2)}) will be recorded as paid.
                                            </p>
                                        </div>
                                        <FormField control={form.control} name="shippingPaidAccountId" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Shipping Paid Account</FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value || ''}
                                                    disabled={shippingCharge <= 0}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select account" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {drawers.filter((d: any) => d.isActive).map((drawer: any) => (
                                                            <SelectItem key={`drawer-${drawer.accountId}`} value={drawer.accountId}>
                                                                {drawer.name}
                                                            </SelectItem>
                                                        ))}
                                                        {liquidAccounts
                                                          .filter(acc => !drawerAccountIds.has(acc.id))
                                                          .map((account) => (
                                                            <SelectItem key={account.id} value={account.id}>
                                                                {account.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>
                                )}

                                {(['Bank', 'bKash', 'Nagad', 'Rocket'].includes(paymentMethod) || isPaidShipping || isPartialPaid) && (
                                    <FormField control={form.control} name="transactionId" render={({ field }) => (
                                        <FormItem className="mt-4 p-3 bg-muted/30 rounded-md border text-sm text-center">
                                            <FormLabel className="text-primary font-bold">
                                                {paymentMethod === 'Bank' ? 'Bank Account Number *' : 'Transaction ID / Sender Phone *'}
                                            </FormLabel>
                                            <FormControl>
                                                <Input 
                                                    className="border-primary/30 mt-2 font-mono text-center h-10"
                                                    placeholder={paymentMethod === 'Bank' ? "Enter Bank Ac No." : "Enter Phone No or Tnx ID"} 
                                                    {...field} 
                                                    value={field.value || ''} 
                                                />
                                            </FormControl>
                                            <p className="text-[10px] text-muted-foreground mt-1">
                                                Required for finance verification.
                                            </p>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                )}
                            </div>

                            {/* Footer: Fixed at bottom of Right Sidebar, Sticky on Mobile */}
                            <div className="p-4 lg:p-6 space-y-4 bg-white border-t shrink-0 z-30 sticky bottom-0 lg:static">
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between"><span>Subtotal</span><span>৳{subtotal.toFixed(2)}</span></div>
                                    <div className="flex justify-between"><span>Shipping</span><span>৳{form.watch('shippingCharge').toFixed(2)}</span></div>
                                    {siteDiscountTotal > 0 && (
                                        <div className="flex justify-between"><span>Site Discount</span><span className="text-red-600">-৳{siteDiscountTotal.toFixed(2)}</span></div>
                                    )}
                                    <div className="flex justify-between"><span>Discount</span><span className="text-red-600">-৳{form.watch('discount').toFixed(2)}</span></div>
                                    <Separator />
                                    <div className="flex justify-between font-bold text-lg"><span>Total</span><span>৳{total.toFixed(2)}</span></div>
                                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Due</span><span className={cn("font-semibold", due > 0 ? "text-orange-600" : "text-green-600")}>৳{due.toFixed(2)}</span></div>
                                </div>
                                <Button onClick={form.handleSubmit(onSubmit)} disabled={submitting || orderItems.length === 0} className="w-full h-12 text-base font-semibold">
                                    {submitting
                                        ? (orderToEdit ? 'Updating...' : 'Creating...')
                                        : (orderToEdit ? 'Update Order' : 'Create Order')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
