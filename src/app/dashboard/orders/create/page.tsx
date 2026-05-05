'use client';

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShoppingCart, Search, ChevronRight, Plus, Minus, Trash2, Home, Package, Check, X, MapPin, User, Phone, Tag, Truck, CreditCard, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import useSWR from "swr";
import { getCategories, getProductsPaged } from "@/services/products";
import { createOrder } from "@/services/orders";
import { getBusinesses } from "@/services/partners";
import { Category, Product, OrderStatus } from "@/types";
import { cn, formatPrice } from "@/lib/utils";
import Image from "next/image";
import { resolveImageSrc } from "@/lib/image";
import { useToast } from "@/hooks/use-toast";
import { hasBanglaDigits, isValidBdPhone } from "@/lib/phone";

type CartItem = {
    productId: string;
    variantId?: string;
    name: string;
    variantName?: string;
    price: number;
    quantity: number;
    image?: string;
    sku?: string;
    variantSku?: string;
};

export default function OrderCreatePage() {
    const router = useRouter();
    const { toast } = useToast();
    const previousPaymentMethod = React.useRef<string | null>(null);
    const [step, setStep] = React.useState<"selection" | "checkout">("selection");
    const [currentCategoryId, setCurrentCategoryId] = React.useState<string | null>(null);
    const [categoryPath, setCategoryPath] = React.useState<Category[]>([]);
    const [searchTerm, setSearchTerm] = React.useState("");
    const [cart, setCart] = React.useState<CartItem[]>([]);
    const [selectedProductForVariant, setSelectedProductForVariant] = React.useState<Product | null>(null);
    const [isCartOpen, setIsCartOpen] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

    // Persistence: Load from local storage
    React.useEffect(() => {
        const savedCart = localStorage.getItem('order_create_cart');
        if (savedCart) {
            try {
                setCart(JSON.parse(savedCart));
            } catch (e) {
                localStorage.removeItem('order_create_cart');
            }
        }
    }, []);

    // Persistence: Save to local storage
    React.useEffect(() => {
        if (cart.length > 0) {
            localStorage.setItem('order_create_cart', JSON.stringify(cart));
        } else {
            localStorage.removeItem('order_create_cart');
        }
    }, [cart]);

    const validatePhone = (value: string) => {
        if (hasBanglaDigits(value)) return 'ইংরেজি সংখ্যা ব্যবহার করুন';
        if (value.length >= 11 && !isValidBdPhone(value)) return 'সঠিক ফোন নম্বর দিন';
        return '';
    };
    
    const normalizePlatform = (value?: string) =>
        ['TikTok', 'Messenger', 'Facebook', 'Instagram', 'Website', 'Call'].includes(value || '') ? value : 'Website';

    // Form State
    const [formData, setFormData] = React.useState({
        customerName: "",
        customerPhone: "",
        customerAddress: "",
        businessId: "all",
        platform: "Messenger",
        paymentMethod: "Cash on Delivery",
        transactionId: "",
        senderPhone: "",
        paidAmount: "" as any,
        shippingCharge: "" as any,
        discount: "" as any,
        customerNote: "",
        paidFromAccountId: "",
        shippingPaid: false,
        shippingPaidAmount: "" as any,
        shippingPaidAccountId: ""
    });
    const [showAdvancePayment, setShowAdvancePayment] = React.useState(false);

    // Fetch data with robust fetcher
    const fetcher = async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch data');
        const json = await res.json();
        return json.success ? json.data : json;
    };

    const { data: allCategories, isLoading: categoriesLoading } = useSWR<Category[]>('/api/products/categories', fetcher);
    const { data: businesses } = useSWR('/api/partners/businesses', fetcher);
    const { data: accounts } = useSWR('/api/accounting/accounts', fetcher);
    const { data: cashDrawers } = useSWR('/api/settings/cash-drawers', fetcher);
    const { data: productsData, isLoading: productsLoading } = useSWR(
        ['/api/products', currentCategoryId, searchTerm],
        ([url, catId, search]) => {
            const params = new URLSearchParams();
            if (catId) params.set('categoryId', catId);
            if (search) params.set('search', search);
            params.set('pageSize', '50');
            return fetcher(`${url}?${params.toString()}`);
        },
        { keepPreviousData: true }
    );

    const products = productsData?.items || [];
    const visibleCategories = React.useMemo(() => {
        if (!allCategories) return [];
        return allCategories.filter(c => {
            // Check if it's a child of the current level
            const isChild = (c.parentId === currentCategoryId) || (!c.parentId && !currentCategoryId);
            // Check search term
            const matchesSearch = searchTerm === "" || c.name.toLowerCase().includes(searchTerm.toLowerCase());
            return isChild && matchesSearch;
        });
    }, [allCategories, currentCategoryId, searchTerm]);

    // Set default business if none selected
    React.useEffect(() => {
        if (businesses && businesses.length > 0 && formData.businessId === "all") {
            setFormData(prev => ({ ...prev, businessId: businesses[0].id }));
        }
    }, [businesses, formData.businessId]);

    // Cart Operations
    const addToCart = (product: Product, variantId?: string) => {
        const variant = product.variants?.find(v => v.id === variantId);
        const price = variant?.price ?? product.price;
        const name = product.name;
        const variantName = (variant?.attributes && Object.keys(variant.attributes).length > 0)
            ? Object.values(variant.attributes).join(', ')
            : (variant?.name || undefined);
        const image = variant?.image ?? product.image;

        setCart(prev => {
            const existingIndex = prev.findIndex(item => item.productId === product.id && item.variantId === variantId);
            if (existingIndex > -1) {
                const newCart = [...prev];
                newCart[existingIndex].quantity += 1;
                return newCart;
            }
            return [...prev, {
                productId: product.id,
                variantId,
                name,
                variantName,
                price,
                quantity: 1,
                image: image || undefined,
                sku: product.sku || undefined,
                variantSku: variant?.sku || undefined,
            }];
        });
    };

    const updateQuantity = (productId: string, variantId: string | undefined, delta: number) => {
        setCart(prev => prev.map(item => (item.productId === productId && item.variantId === variantId) ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item));
    };

    const removeFromCart = (productId: string, variantId?: string) => {
        setCart(prev => prev.filter(item => !(item.productId === productId && item.variantId === variantId)));
    };

    const subtotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0);
    const cartTotal = subtotal + (Number(formData.shippingCharge) || 0) - (Number(formData.discount) || 0);

    // Navigation
    const handleCategoryClick = (category: Category) => {
        setCurrentCategoryId(category.id);
        setCategoryPath(prev => [...prev, category]);
    };

    const handleGoBack = () => {
        if (step === "checkout") { setStep("selection"); return; }
        if (categoryPath.length === 0) { router.push('/dashboard/orders'); return; }
        const newPath = [...categoryPath];
        newPath.pop();
        setCategoryPath(newPath);
        setCurrentCategoryId(newPath.length > 0 ? newPath[newPath.length - 1].id : null);
    };

    const handleReset = () => {
        setCurrentCategoryId(null);
        setCategoryPath([]);
        setSearchTerm("");
        setStep("selection");
    };

    // Auto-sync paidAmount and account selection based on paymentMethod
    React.useEffect(() => {
        const total = subtotal + (Number(formData.shippingCharge) || 0) - (Number(formData.discount) || 0);
        const shipping = Number(formData.shippingCharge) || 0;
        const method = formData.paymentMethod;

        setFormData(prev => {
            let nextPaidAmount = prev.paidAmount;
            let nextShippingPaid = prev.shippingPaid;
            let nextShippingPaidAmount = prev.shippingPaidAmount;
            let nextPaidFromAccountId = prev.paidFromAccountId;
            let nextShippingPaidAccountId = prev.shippingPaidAccountId;

            const isLiquid = method !== 'Cash on Delivery' && method !== 'Paid Shipping COD' && method !== 'Partial (Paid & COD)';

            if (method === 'Cash on Delivery') {
                nextPaidAmount = 0;
                nextShippingPaid = false;
                nextShippingPaidAmount = 0;
                nextPaidFromAccountId = '';
                nextShippingPaidAccountId = '';
            } else if (method === 'Paid Shipping COD') {
                nextPaidAmount = 0;
                nextShippingPaid = true;
                nextShippingPaidAmount = shipping;
                nextPaidFromAccountId = '';
            } else if (isLiquid) {
                nextPaidAmount = total;
                nextShippingPaid = false;
                nextShippingPaidAmount = 0;
                nextShippingPaidAccountId = '';
                const methodChanged = previousPaymentMethod.current !== null && previousPaymentMethod.current !== method;
                
                // Auto-select account automatically if method just changed or account not set
                if (method === 'Cash' && cashDrawers && cashDrawers.length > 0) {
                    const activeDrawers = cashDrawers.filter((d: any) => d.isActive);
                    const defaultDrawer = activeDrawers.find((d: any) => d.isDefault) || activeDrawers[0];
                    if (defaultDrawer && (!nextPaidFromAccountId || cashDrawers.every((d: any) => d.accountId !== nextPaidFromAccountId))) {
                        nextPaidFromAccountId = defaultDrawer.accountId;
                    }
                } else if (accounts && accounts.length > 0) {
                    const liquidAccounts = accounts.filter((acc: any) => acc.group === 'LIQUID');
                    const drawerIds = new Set((cashDrawers || []).map((d: any) => d.accountId));
                    const nonDrawerLiquidAccounts = liquidAccounts.filter((acc: any) => !drawerIds.has(acc.id));
                    const hasCurrentValidLiquidAccount = nonDrawerLiquidAccounts.some((acc: any) => acc.id === nextPaidFromAccountId);

                    if (nonDrawerLiquidAccounts.length === 1) {
                        if (nextPaidFromAccountId !== nonDrawerLiquidAccounts[0].id) {
                            nextPaidFromAccountId = nonDrawerLiquidAccounts[0].id;
                        }
                    } else if (methodChanged || !hasCurrentValidLiquidAccount) {
                        nextPaidFromAccountId = '';
                    }
                }
            } else if (method === 'Partial (Paid & COD)') {
                nextShippingPaid = false;
                nextShippingPaidAmount = 0;
            }

            // Only update if changed to avoid loop
            if (
                nextPaidAmount !== prev.paidAmount || 
                nextShippingPaid !== prev.shippingPaid ||
                nextShippingPaidAmount !== prev.shippingPaidAmount ||
                nextPaidFromAccountId !== prev.paidFromAccountId ||
                nextShippingPaidAccountId !== prev.shippingPaidAccountId
            ) {
                return { 
                    ...prev, 
                    paidAmount: nextPaidAmount, 
                    shippingPaid: nextShippingPaid,
                    shippingPaidAmount: nextShippingPaidAmount,
                    paidFromAccountId: nextPaidFromAccountId,
                    shippingPaidAccountId: nextShippingPaidAccountId
                };
            }
            return prev;
        });

        if (method === 'Cash on Delivery' || method === 'Paid Shipping COD') {
            setShowAdvancePayment(false);
        } else {
            setShowAdvancePayment(true);
        }
        previousPaymentMethod.current = method;
    }, [formData.paymentMethod, subtotal, formData.shippingCharge, formData.discount, accounts, cashDrawers]);

    const handleSubmitOrder = async () => {
        if (!formData.customerPhone) {
            toast({ variant: "destructive", title: "ফোন নম্বর প্রয়োজন", description: "দয়া করে কাস্টমারের ফোন নম্বর দিন।" });
            return;
        }
        const phoneErr = validatePhone(formData.customerPhone);
        if (phoneErr) {
            setFieldErrors(prev => ({ ...prev, customerPhone: phoneErr }));
            toast({ variant: "destructive", title: "ফোন নম্বর সমস্যা", description: phoneErr });
            return;
        }
        if (formData.businessId === "all" || !formData.businessId) {
            toast({ variant: "destructive", title: "বিজনেস সিলেক্ট করুন", description: "একটি বিজনেস সিলেক্ট করা আবশ্যক।" });
            return;
        }

        // Validate account IDs for POS
        if (Number(formData.paidAmount) > 0 && !formData.paidFromAccountId) {
            toast({ variant: "destructive", title: "একাউন্ট সিলেক্ট করুন", description: "পেইড অ্যামাউন্টের জন্য একাউন্ট সিলেক্ট করা আবশ্যক।" });
            return;
        }
        if (formData.shippingPaid && Number(formData.shippingCharge) > 0 && !formData.shippingPaidAccountId) {
            toast({ variant: "destructive", title: "শিপিং একাউন্ট সিলেক্ট করুন", description: "শিপিং চার্জের জন্য একাউন্ট সিলেক্ট করা আবশ্যক।" });
            return;
        }

        if (['bKash', 'Nagad', 'Rocket'].includes(formData.paymentMethod)) {
            if (!formData.transactionId && !formData.senderPhone) {
                toast({ variant: "destructive", title: "পেমেন্ট তথ্য দিন", description: "বিকাশ/নগদ/রকেটের ক্ষেত্রে ট্রানজেকশন আইডি অথবা সেন্ডার নম্বর-এর যেকোনো একটি দেওয়া আবশ্যক।" });
                return;
            }
        }

        setIsSubmitting(true);
        try {
            const paymentMethodMap: Record<string, string> = {
                'Cash on Delivery': 'CashOnDelivery',
                'Paid Shipping COD': 'PaidShippingCOD',
                'Partial (Paid & COD)': 'PartialPaidCOD',
                'Cash': 'Cash',
                'Bank': 'Bank',
                'bKash': 'bKash',
                'Nagad': 'Nagad',
                'Rocket': 'Rocket'
            };

            const orderInput = {
                customerName: formData.customerName,
                customerPhone: formData.customerPhone,
                shippingAddress: {
                    address: formData.customerAddress || ""
                },
                items: cart.map((item: CartItem) => ({
                    productId: item.productId,
                    variantId: item.variantId,
                    sku: item.sku,
                    variantSku: item.variantSku,
                    quantity: item.quantity,
                    price: item.price
                })),
                status: "New" as OrderStatus,
                shipping: Number(formData.shippingCharge) || 0,
                discount: Number(formData.discount) || 0,
                customerNote: formData.customerNote,
                businessId: formData.businessId,
                platform: normalizePlatform(formData.platform),
                paymentMethod: paymentMethodMap[formData.paymentMethod] || 'CashOnDelivery',
                transactionId: formData.transactionId || undefined,
                senderPhone: formData.senderPhone || undefined,
                paidAmount: Number(formData.paidAmount) || 0,
                paidFromAccountId: formData.paidFromAccountId || undefined,
                shippingPaid: formData.shippingPaid,
                shippingPaidAmount: Number(formData.shippingPaidAmount) || 0,
                shippingPaidAccountId: formData.shippingPaidAccountId || formData.paidFromAccountId || undefined,
                source: "mobile-create" 
            };
            await createOrder(orderInput);
            localStorage.removeItem('order_create_cart');
            toast({ title: "অর্ডার সফল হয়েছে", description: "অর্ডারটি সফলভাবে তৈরি করা হয়েছে।" });
            router.push('/dashboard/orders');
        } catch (err: any) {
            const code = err?.code || err?.data?.code;
            if (code === 'SKU_NOT_FOUND') {
                toast({ variant: "destructive", title: "SKU পাওয়া যায়নি", description: err.message || "প্রোডাক্টের SKU ডাটাবেসে নেই।" });
            } else if (code === 'SKU_MISMATCH') {
                toast({ variant: "destructive", title: "SKU অমিল", description: err.message || "প্রোডাক্টের SKU মিলছে না।" });
            } else if (code === 'VARIANT_MISSING') {
                toast({ variant: "destructive", title: "ভ্যারিয়েন্ট পাওয়া যায়নি", description: err.message || "ভ্যারিয়েন্ট ডাটাবেসে নেই।" });
            } else if (err.fieldErrors && typeof err.fieldErrors === 'object') {
                const mapped: Record<string, string> = {};
                for (const [field, messages] of Object.entries(err.fieldErrors)) {
                    const msg = Array.isArray(messages) ? messages[0] : messages;
                    if (msg) mapped[field] = String(msg);
                }
                setFieldErrors(prev => ({ ...prev, ...mapped }));
                toast({ variant: "destructive", title: "অর্ডার ব্যর্থ হয়েছে", description: Object.values(mapped)[0] || "আবার চেষ্টা করুন।" });
            } else {
                toast({ variant: "destructive", title: "অর্ডার ব্যর্থ হয়েছে", description: err.message || "আবার চেষ্টা করুন।" });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen bg-[#f8f9fa] text-[#191c1d] font-inter">
            {/* Header */}
            <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md px-4 py-3 flex items-center gap-3 border-b border-black/5">
                <Button variant="ghost" size="icon" onClick={handleGoBack} className="rounded-full">
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex-1 min-w-0">
                    <h1 className="text-lg font-bold truncate">
                        {step === "checkout" ? "অর্ডার সম্পন্ন করুন" : (categoryPath.length > 0 ? categoryPath[categoryPath.length - 1].name : "নতুন অর্ডার")}
                    </h1>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setIsCartOpen(true)} className="rounded-full relative">
                        <ShoppingCart className="h-5 w-5" />
                        {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-[#004d99] text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full">{cart.length}</span>}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/orders')} className="rounded-full">
                        <Home className="h-5 w-5" />
                    </Button>
                </div>
            </header>

            <main className="flex-1 p-4 pb-44">
                {step === "selection" ? (
                    <>
                        <div className="relative mb-6">
                            <Input placeholder="খুঁজুন..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 h-12 rounded-2xl bg-white border-0 shadow-sm text-base focus-visible:ring-1 focus-visible:ring-primary/20" />
                            <Search className="absolute left-3.5 top-3.5 h-5 w-5 text-muted-foreground" />
                        </div>

                        {(categoriesLoading || (visibleCategories.length > 0)) && (
                            <section className="mb-8 animate-in fade-in slide-in-from-bottom-2">
                                <h2 className="text-xs font-bold mb-4 text-muted-foreground uppercase tracking-widest pl-1">ক্যাটাগরি</h2>
                                {categoriesLoading ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-3xl" />)}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-3">
                                        {visibleCategories.map(category => (
                                            <Card key={category.id} className="border-0 shadow-none bg-white rounded-3xl overflow-hidden active:scale-95 transition-transform cursor-pointer hover:shadow-md" onClick={() => handleCategoryClick(category)}>
                                                <CardContent className="p-0">
                                                    <div className="h-24 bg-[#004d99]/5 flex items-center justify-center p-4">
                                                        <span className="text-center font-bold text-sm leading-tight line-clamp-2">{category.name}</span>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        <section className="animate-in fade-in slide-in-from-bottom-4">
                            <h2 className="text-xs font-bold mb-4 text-muted-foreground uppercase tracking-widest pl-1">পণ্য</h2>
                            {productsLoading ? (
                                <div className="grid grid-cols-2 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-60 rounded-3xl" />)}</div>
                            ) : products.length > 0 ? (
                                <div className="grid grid-cols-2 gap-4">
                                    {products.map((product: Product) => {
                                        const inCart = cart.some(item => item.productId === product.id);
                                        return (
                                            <Card key={product.id} className="border-0 shadow-none bg-white rounded-3xl overflow-hidden flex flex-col relative group">
                                                <div className="aspect-square relative flex items-center justify-center p-2">
                                                    <Image src={resolveImageSrc(product.image)} alt={product.name} fill className="object-cover p-2 rounded-2xl transition-transform group-hover:scale-105" unoptimized />
                                                    <Button size="icon" className={cn("absolute bottom-2 right-2 h-9 w-9 rounded-full shadow-lg transition-all", inCart ? "bg-green-500 hover:bg-green-600" : "bg-[#004d99] hover:bg-[#004d99]/90")} onClick={() => product.productType === "variable" ? setSelectedProductForVariant(product) : addToCart(product)}>
                                                        {inCart ? <Check className="h-5 w-5" /> : <Plus className="h-6 w-6" />}
                                                    </Button>
                                                </div>
                                                <CardContent className="p-3 bg-white mt-auto">
                                                    <h3 className="text-[10px] font-medium text-muted-foreground truncate mb-0.5">SKU: {product.sku}</h3>
                                                    <p className="text-xs font-bold line-clamp-2 mb-2 h-8 leading-tight">{product.name}</p>
                                                    <div className="flex items-center justify-between">
                                                        <p className="text-[#004d99] font-black font-manrope text-sm">৳{formatPrice(product.price)}</p>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl text-muted-foreground shadow-sm"><Package className="h-12 w-12 mb-4 opacity-10" /><p>পণ্য পাওয়া যায়নি</p></div>
                            )}
                        </section>
                    </>
                ) : (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                        <section className="bg-white rounded-[2rem] p-6 shadow-sm space-y-5">
                            <div className="flex items-center gap-2 mb-2">
                                <User className="h-4 w-4 text-[#004d99]" />
                                <h2 className="text-sm font-bold uppercase tracking-widest text-[#004d99]">কাস্টমার তথ্য</h2>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">নাম</label>
                                    <div className="relative">
                                        <Input value={formData.customerName} onChange={e => setFormData(prev => ({ ...prev, customerName: e.target.value }))} placeholder="রহিম আহমেদ" className="rounded-2xl bg-[#f8f9fa] border-0 h-12 pl-4 text-sm" />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">মোবাইল নম্বর *</label>
                                    <div className="relative">
                                        <Input value={formData.customerPhone} onChange={e => {
                                        const v = e.target.value;
                                        setFormData(prev => ({ ...prev, customerPhone: v }));
                                        const err = validatePhone(v);
                                        setFieldErrors(prev => {
                                            const next = { ...prev };
                                            if (err) next.customerPhone = err;
                                            else delete next.customerPhone;
                                            return next;
                                        });
                                    }} placeholder="017xxxxxxxx" type="tel" className={cn("rounded-2xl bg-[#f8f9fa] border-0 h-12 pl-4 text-sm", fieldErrors.customerPhone && "ring-2 ring-red-400")} />
                                        <Phone className="absolute right-4 top-3.5 h-5 w-5 text-muted-foreground opacity-30" />
                                    </div>
                                    {fieldErrors.customerPhone && <p className="text-xs text-red-500 mt-1 ml-1">{fieldErrors.customerPhone}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">ঠিকানা</label>
                                    <Textarea value={formData.customerAddress} onChange={e => setFormData(prev => ({ ...prev, customerAddress: e.target.value }))} placeholder="পুরো ঠিকানা এখানে লিখুন..." className="rounded-2xl bg-[#f8f9fa] border-0 min-h-[80px] p-4 text-sm" />
                                </div>
                            </div>
                        </section>

                        <section className="bg-white rounded-[2rem] p-6 shadow-sm space-y-5">
                            <div className="flex items-center gap-2 mb-2">
                                <LayoutGrid className="h-4 w-4 text-[#004d99]" />
                                <h2 className="text-sm font-bold uppercase tracking-widest text-[#004d99]">অর্ডার সোর্স</h2>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">শীর্ষ ব্যবসা</label>
                                    <Select value={formData.businessId} onValueChange={v => setFormData(prev => ({ ...prev, businessId: v }))}>
                                        <SelectTrigger className="rounded-2xl bg-[#f8f9fa] border-0 h-12 text-sm">
                                            <SelectValue placeholder="ব্যবসা সিলেক্ট করুন" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-0 shadow-xl">
                                            {businesses?.map((b: any) => (
                                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">প্ল্যাটফর্ম</label>
                                    <Select value={formData.platform || ""} onValueChange={v => setFormData(prev => ({ ...prev, platform: v as any }))}>
                                        <SelectTrigger className="rounded-2xl bg-[#f8f9fa] border-0 h-12 text-sm">
                                            <SelectValue placeholder="প্ল্যাটফর্ম সিলেক্ট করুন" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-0 shadow-xl">
                                            <SelectItem value="Facebook">Facebook</SelectItem>
                                            <SelectItem value="Messenger">Messenger</SelectItem>
                                            <SelectItem value="TikTok">TikTok</SelectItem>
                                            <SelectItem value="Instagram">Instagram</SelectItem>
                                            <SelectItem value="Website">Website</SelectItem>
                                            <SelectItem value="Call">Call</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </section>

                        <section className="bg-white rounded-[2rem] p-6 shadow-sm space-y-5">
                            <div className="flex items-center gap-2 mb-2">
                                <CreditCard className="h-4 w-4 text-[#004d99]" />
                                <h2 className="text-sm font-bold uppercase tracking-widest text-[#004d99]">পেমেন্ট তথ্য</h2>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">পেমেন্ট মেথড</label>
                                    <Select value={formData.paymentMethod} onValueChange={v => setFormData(prev => ({ ...prev, paymentMethod: v }))}>
                                        <SelectTrigger className="rounded-2xl bg-[#f8f9fa] border-0 h-12 text-sm"><SelectValue placeholder="সিলেক্ট পেমেন্ট" /></SelectTrigger>
                                        <SelectContent className="rounded-2xl border-0 shadow-xl">
                                            <SelectItem value="Cash on Delivery">Cash On Delivery</SelectItem>
                                            <SelectItem value="Paid Shipping COD">Paid Shipping COD</SelectItem>
                                            <SelectItem value="Partial (Paid & COD)">Partial (Paid & COD)</SelectItem>
                                            <SelectItem value="Cash">Cash</SelectItem>
                                            <SelectItem value="bKash">bKash</SelectItem>
                                            <SelectItem value="Nagad">Nagad</SelectItem>
                                            <SelectItem value="Rocket">Rocket</SelectItem>
                                            <SelectItem value="Bank">Bank</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {showAdvancePayment && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                        {formData.paymentMethod === 'Partial (Paid & COD)' && (
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-1.5">
                                                        <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1 text-blue-600">পেইড অ্যামাউন্ট</label>
                                                        <div className="relative">
                                                            <Input type="number" value={formData.paidAmount} onChange={e => setFormData(prev => ({ ...prev, paidAmount: e.target.value as any }))} placeholder="0" className="rounded-2xl bg-[#f1f5fc] border-0 h-12 pl-4 text-sm font-bold font-manrope no-spinner" />
                                                            <CreditCard className="absolute right-4 top-3.5 h-4 w-4 text-blue-400" />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">কোন একাউন্টে? *</label>
                                                        <Select value={formData.paidFromAccountId} onValueChange={v => setFormData(prev => ({ ...prev, paidFromAccountId: v }))}>
                                                            <SelectTrigger className="rounded-2xl bg-[#f8f9fa] border-0 h-12 text-xs"><SelectValue placeholder="একাউন্ট" /></SelectTrigger>
                                                            <SelectContent className="rounded-2xl border-0 shadow-xl">
                                                                {cashDrawers?.filter((d: any) => d.isActive).map((drawer: any) => (
                                                                    <SelectItem key={drawer.accountId} value={drawer.accountId}>{drawer.name}</SelectItem>
                                                                ))}
                                                                {accounts?.filter((acc: any) => !new Set((cashDrawers || []).map((d: any) => d.accountId)).has(acc.id) && acc.group === 'LIQUID').map((acc: any) => (
                                                                    <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">ট্রানজেকশন রেফারেন্স (আইডি / ফোন) *</label>
                                                    <Input value={formData.transactionId} onChange={e => setFormData(prev => ({ ...prev, transactionId: e.target.value }))} placeholder="TrxID / সেন্ডার নম্বর" className="rounded-2xl bg-[#f8f9fa] border-0 h-12 pl-4 text-sm font-mono" />
                                                </div>
                                            </div>
                                        )}

                                        {formData.paymentMethod === 'Cash' && (
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">ক্যাশ ড্রয়ার *</label>
                                                <Select value={formData.paidFromAccountId} onValueChange={v => setFormData(prev => ({ ...prev, paidFromAccountId: v }))}>
                                                    <SelectTrigger className="rounded-2xl bg-[#f8f9fa] border-0 h-12 text-sm"><SelectValue placeholder="ড্রয়ার সিলেক্ট করুন" /></SelectTrigger>
                                                    <SelectContent className="rounded-2xl border-0 shadow-xl">
                                                        {cashDrawers?.filter((d: any) => d.isActive).map((drawer: any) => (
                                                            <SelectItem key={drawer.accountId} value={drawer.accountId}>{drawer.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}

                                        {['bKash', 'Nagad', 'Rocket'].includes(formData.paymentMethod) && (
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">ট্রানজেকশন আইডি</label>
                                                    <Input value={formData.transactionId} onChange={e => setFormData(prev => ({ ...prev, transactionId: e.target.value }))} placeholder="TrxID" className="rounded-2xl bg-[#f8f9fa] border-0 h-12 pl-4 text-sm font-mono" />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">সেন্ডার নম্বর</label>
                                                    <Input value={formData.senderPhone} onChange={e => setFormData(prev => ({ ...prev, senderPhone: e.target.value }))} placeholder="017xxxxxxxx" className="rounded-2xl bg-[#f8f9fa] border-0 h-12 pl-4 text-sm" />
                                                </div>
                                            </div>
                                        )}

                                        {formData.paymentMethod === 'Bank' && (
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">ব্যাংক একাউন্ট নম্বর *</label>
                                                <Input value={formData.transactionId} onChange={e => setFormData(prev => ({ ...prev, transactionId: e.target.value }))} placeholder="Bank Ac No." className="rounded-2xl bg-[#f8f9fa] border-0 h-12 pl-4 text-sm font-mono" />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="bg-white rounded-[2rem] p-6 shadow-sm space-y-5">
                            <div className="flex items-center gap-2 mb-2">
                                <Truck className="h-4 w-4 text-[#004d99]" />
                                <h2 className="text-sm font-bold uppercase tracking-widest text-[#004d99]">শিপিং ও ডিসকাউন্ট</h2>
                            </div>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1 text-orange-600">শিপিং চার্জ</label>
                                        <div className="relative">
                                            <Input type="number" value={formData.shippingCharge} onChange={e => setFormData(prev => ({ ...prev, shippingCharge: e.target.value as any }))} placeholder="0" className="rounded-2xl bg-[#fcf5f1] border-0 h-12 pl-4 text-sm font-bold font-manrope no-spinner" />
                                            <Truck className="absolute right-4 top-3.5 h-4 w-4 text-orange-400" />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1 text-green-600">ডিসকাউন্ট</label>
                                        <div className="relative">
                                            <Input type="number" value={formData.discount} onChange={e => setFormData(prev => ({ ...prev, discount: e.target.value as any }))} placeholder="0" className="rounded-2xl bg-[#f1fcf1] border-0 h-12 pl-4 text-sm font-bold font-manrope no-spinner" />
                                            <Badge className="absolute right-4 top-3.5 h-5 bg-green-500 text-[8px]">OFF</Badge>
                                        </div>
                                    </div>
                                </div>

                                {formData.shippingPaid && formData.paymentMethod === 'Paid Shipping COD' && (
                                    <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-1">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">শিপিং কোন একাউন্টে নেওয়া হয়েছে? *</label>
                                            <Select value={formData.shippingPaidAccountId} onValueChange={v => setFormData(prev => ({ ...prev, shippingPaidAccountId: v }))}>
                                                <SelectTrigger className="rounded-2xl bg-[#f8f9fa] border-0 h-12 text-sm"><SelectValue placeholder="সিলেক্ট একাউন্ট" /></SelectTrigger>
                                                <SelectContent className="rounded-2xl border-0 shadow-xl">
                                                    {cashDrawers?.filter((d: any) => d.isActive).map((drawer: any) => (
                                                        <SelectItem key={drawer.accountId} value={drawer.accountId}>{drawer.name}</SelectItem>
                                                    ))}
                                                    {accounts?.filter((acc: any) => {
                                                        const drawerIds = new Set((cashDrawers || []).map((d: any) => d.accountId));
                                                        return !drawerIds.has(acc.id) &&
                                                        acc.group === 'LIQUID'
                                                    }).map((acc: any) => (
                                                        <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="bg-white rounded-[2rem] p-6 shadow-sm border border-[#004d99]/5">
                            <div className="flex items-center justify-between mb-4 border-b pb-3 border-dashed">
                                <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-[#004d99]" /><h3 className="text-sm font-bold text-[#004d99]">পেমেন্ট সামারি</h3></div>
                                <span className="text-xs font-bold text-muted-foreground">{cart.length} টি পণ্য</span>
                            </div>
                            <div className="space-y-2.5">
                                <div className="flex justify-between text-sm"><span className="text-muted-foreground">সাব-টোটাল</span><span className="font-bold font-manrope">৳{formatPrice(subtotal)}</span></div>
                                <div className="flex justify-between text-sm"><span className="text-muted-foreground">শিপিং চার্জ</span><span className="font-bold text-orange-600 font-manrope">+ ৳{formatPrice(formData.shippingCharge)}</span></div>
                                <div className="flex justify-between text-sm"><span className="text-muted-foreground">ডিসকাউন্ট</span><span className="font-bold text-green-600 font-manrope">- ৳{formatPrice(formData.discount)}</span></div>
                                <div className="pt-3 mt-3 border-t border-dashed flex justify-between items-center"><span className="text-base font-black text-slate-800">সর্বমোট</span><span className="text-2xl font-black text-[#004d99] font-manrope">৳{formatPrice(cartTotal)}</span></div>
                                <div className="flex justify-between items-center pt-2"><span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">বাকি (Due)</span><span className="text-lg font-black text-red-600 font-manrope">৳{formatPrice(Math.max(0, cartTotal - (Number(formData.paidAmount) || 0) - (Number(formData.shippingPaidAmount) || 0)))}</span></div>
                            </div>
                        </section>
                    </div>
                )}
            </main>

            <div className="fixed bottom-0 left-0 right-0 md:left-[220px] lg:left-[280px] p-4 pb-8 bg-white/90 backdrop-blur-3xl border-t border-black/5 z-20 shadow-[0_-15px_40px_rgba(0,0,0,0.06)]">
                <div className="max-w-md mx-auto flex items-center justify-between gap-4 pt-2">
                    {step === "selection" ? (
                        <>
                            <div className="flex flex-col" onClick={() => setIsCartOpen(true)}>
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-black uppercase tracking-widest mb-0.5"><ShoppingCart className="h-3 w-3" /><span>{cart.length} ITEMS</span></div>
                                <span className="text-xl font-black font-manrope text-[#004d99]">৳{formatPrice(cartTotal)}</span>
                            </div>
                            <Button disabled={cart.length === 0} onClick={() => setStep("checkout")} className="rounded-[1.5rem] h-14 px-8 font-black text-lg flex-1 max-w-[220px] shadow-2xl shadow-[#004d99]/30 bg-[#004d99] hover:bg-[#004d99]/90 transition-all active:scale-95">পরবর্তী <ChevronRight className="ml-1 h-6 w-6" /></Button>
                        </>
                    ) : (
                        <Button disabled={isSubmitting || cart.length === 0} onClick={handleSubmitOrder} className="rounded-[1.5rem] h-14 w-full font-black text-lg shadow-2xl shadow-[#004d99]/30 bg-[#004d99] hover:bg-[#004d99]/90 transition-all active:scale-95 flex items-center justify-center gap-2">
                            {isSubmitting ? <><div className="h-5 w-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> সাবমিট হচ্ছে...</> : <>অর্ডার কনফার্ম করুন <Check className="h-6 w-6" /></>}
                        </Button>
                    )}
                </div>
            </div>

            <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
                <SheetContent side="bottom" className="h-[85vh] rounded-t-[3rem] p-0 overflow-hidden border-0 bg-[#f8f9fa] shadow-2xl [&>button]:hidden">
                    <div className="h-1.5 w-12 bg-black/10 rounded-full mx-auto mt-4 mb-2"/>
                    <SheetHeader className="px-6 py-5 bg-white border-b border-black/5">
                        <div className="flex items-center justify-between">
                            <SheetTitle className="text-2xl font-black text-[#004d99]">শপিং কার্ট</SheetTitle>
                            <Button variant="ghost" size="icon" onClick={() => setIsCartOpen(false)} className="rounded-full bg-[#f8f9fa]">
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                    </SheetHeader><div className="overflow-y-auto h-[calc(85vh-200px)] p-4 space-y-3">{cart.length > 0 ? cart.map(item => (<Card key={`${item.productId}-${item.variantId}`} className="border-0 shadow-none bg-white rounded-[2rem] overflow-hidden"><div className="flex p-4 gap-4"><div className="h-20 w-20 relative bg-[#f8f9fa] rounded-2xl overflow-hidden flex-shrink-0"><Image src={resolveImageSrc(item.image)} alt={item.name} fill className="object-cover" unoptimized /></div><div className="flex-1 min-w-0 flex flex-col justify-between"><div><h4 className="font-bold text-sm truncate leading-tight">{item.name}</h4>{item.variantName && <p className="text-[10px] text-muted-foreground mt-0.5">{item.variantName}</p>}<p className="text-sm font-black text-[#004d99] mt-1">৳{formatPrice(item.price)}</p></div><div className="flex items-center justify-between mt-2"><div className="flex items-center bg-[#f8f9fa] rounded-2xl p-0.5"><Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => updateQuantity(item.productId, item.variantId, -1)}><Minus className="h-3 w-3" /></Button><span className="w-10 text-center text-xs font-black">{item.quantity}</span><Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-[#004d99]" onClick={() => updateQuantity(item.productId, item.variantId, 1)}><Plus className="h-3 w-3" /></Button></div><Button variant="ghost" size="icon" className="h-9 w-9 text-red-500 rounded-full bg-red-50" onClick={() => removeFromCart(item.productId, item.variantId)}><Trash2 className="h-4 w-4" /></Button></div></div></div></Card>)) : (<div className="flex flex-col items-center justify-center py-20 text-muted-foreground"><ShoppingCart className="h-16 w-16 mb-4 opacity-10" /><p className="font-bold">কার্ট খালি</p></div>)}</div><div className="absolute bottom-0 left-0 right-0 p-6 bg-white border-t border-black/5 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]"><div className="flex items-center justify-between mb-4 px-2"><span className="text-base font-bold text-muted-foreground">সাব-টোটাল</span><span className="text-2xl font-black text-[#004d99] font-manrope">৳{formatPrice(subtotal)}</span></div><Button className="w-full h-14 rounded-2xl text-lg font-black bg-[#004d99] shadow-xl shadow-[#004d99]/20" onClick={() => { setIsCartOpen(false); setStep("checkout"); }} disabled={cart.length === 0}>চেকআউট</Button></div></SheetContent>
            </Sheet>

            <Dialog open={!!selectedProductForVariant} onOpenChange={(open) => !open && setSelectedProductForVariant(null)}>
                <DialogContent className="sm:max-w-md rounded-[3rem] border-0 p-0 overflow-hidden bg-[#f8f9fa] shadow-2xl [&>button]:hidden">
                    <DialogHeader className="p-7 bg-white border-b border-black/5">
                        <div className="flex items-center justify-between">
                            <DialogTitle className="text-xl font-black text-[#004d99]">{selectedProductForVariant?.name}</DialogTitle>
                            <Button variant="ghost" size="icon" onClick={() => setSelectedProductForVariant(null)} className="rounded-full bg-[#f8f9fa]">
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                        <DialogDescription className="text-xs uppercase font-bold tracking-widest text-muted-foreground">Select Variant</DialogDescription>
                    </DialogHeader><div className="p-4 space-y-3 max-h-[50vh] overflow-y-auto">{selectedProductForVariant?.variants?.map(variant => {
    const vName = (variant.attributes && Object.keys(variant.attributes).length > 0)
        ? Object.values(variant.attributes).join(', ')
        : variant.name;
    return (<Card key={variant.id} className="border-0 shadow-none bg-white rounded-3xl overflow-hidden active:scale-95 transition-transform cursor-pointer hover:shadow-md" onClick={() => { addToCart(selectedProductForVariant, variant.id); }}><div className="flex p-4 gap-4 items-center"><div className="h-16 w-16 relative bg-[#f8f9fa] rounded-2xl overflow-hidden flex-shrink-0"><Image src={resolveImageSrc(variant.image || selectedProductForVariant.image)} alt={vName} fill className="object-cover" unoptimized /></div><div className="flex-1 min-w-0"><h4 className="font-bold text-sm truncate">{vName}</h4><p className="text-[10px] text-muted-foreground">SKU: {variant.sku}</p></div><p className="text-base font-black text-[#004d99] font-manrope">৳{formatPrice(variant.price || selectedProductForVariant.price)}</p><div className="h-9 w-9 rounded-full bg-[#004d99]/10 flex items-center justify-center"><Plus className="h-5 w-5 text-[#004d99]" /></div></div></Card>);
})}</div><div className="p-6 bg-white border-t border-black/5 flex justify-end px-8"><Button variant="ghost" onClick={() => setSelectedProductForVariant(null)} className="rounded-xl px-10 h-10 font-bold text-muted-foreground">Close</Button></div></DialogContent>
            </Dialog>
        </div>
    );
}
