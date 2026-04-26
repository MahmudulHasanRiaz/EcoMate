'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { 
  BarChart3, CheckCircle2, Minus, Plus, Printer, ReceiptText, RotateCcw, 
  Search, Trash2, LayoutDashboard, ShoppingBag, ArrowLeft 
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

// --- TYPES ---
type Showroom = { id: string; name: string; locationId: string; cashDrawerId: string; defaultInvoiceNote?: string | null; isActive?: boolean; };
type Business = { id: string; name: string; };
type ProductApiVariant = { id: string; name: string; sku: string; inventory?: number; price?: number | null; salePrice?: number | null; image?: string | null; attributes?: Record<string, string>; };
type ProductApiItem = { id: string; name: string; sku: string; productType: 'simple' | 'variable' | 'combo'; price: number; salePrice?: number | null; image?: string | null; inventory?: number; variants?: ProductApiVariant[]; };
type CartLine = { productId: string; variantId: string | null; sku: string; variantSku?: string; name: string; variantName?: string; image?: string; quantity: number; price: number; available: number; };
type ApiResponse<T> = { success: boolean; message: string; data?: T; errors?: any; };
type ReturnOrder = { id: string; orderNumber?: string; customerName: string; customerPhone: string; total: number; paidAmount: number; status: string; paymentMethod: string; date: string; products: { id: string; quantity: number; price: number; sku: string; product?: { name: string } }[]; };
type Category = { id: string; name: string; };

const money = (n: number) => {
  const value = Number.isFinite(n) ? n : 0;
  return `৳${value.toFixed(0)}`;
};

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export default function POSClient({ showrooms, businesses }: { showrooms: Showroom[]; businesses: Business[] }) {
  const { toast } = useToast();

  // Step 1: Initialization State
  const [selectedShowroom, setSelectedShowroom] = useState<Showroom | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  
  const [shiftSession, setShiftSession] = useState<any>(null);
  const [computedBalance, setComputedBalance] = useState<number>(0);
  const [countedCash, setCountedCash] = useState<string>('');
  const [shiftNote, setShiftNote] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);

  // Step 2: Main POS State
  const [activeTab, setActiveTab] = useState<'sale' | 'returns'>('sale');
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [gridProducts, setGridProducts] = useState<ProductApiItem[]>([]);
  const [gridLoading, setGridLoading] = useState(false);

  // Cart & Checkout
  const [cart, setCart] = useState<CartLine[]>([]);
  const [heldCarts, setHeldCarts] = useState<{id: string, time: number, cart: CartLine[], phone: string, name: string, discount: string, note: string}[]>([]);
  const [isHeldCartsModalOpen, setHeldCartsModalOpen] = useState(false);
  const [skuSearch, setSkuSearch] = useState('');
  const debouncedSkuSearch = useDebounce(skuSearch, 300);
  
  const [fulfillment, setFulfillment] = useState<'STORE_PICKUP' | 'COD'>('STORE_PICKUP');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [discount, setDiscount] = useState('');
  const [payments, setPayments] = useState<{ method: string, amount: string }[]>([{ method: 'Cash', amount: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
  const [cartStep, setCartStep] = useState<'cart' | 'checkout'>('cart');

  // Modals
  const [successModal, setSuccessModal] = useState<{ orderId: string; orderNumber: string } | null>(null);
  const [variantPickerProduct, setVariantPickerProduct] = useState<ProductApiItem | null>(null);
  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  const [isShiftModalOpen, setShiftModalOpen] = useState(false);
  const [drawerAction, setDrawerAction] = useState<'open' | 'close'>('open');

  const [isExpenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseReason, setExpenseReason] = useState('');
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);

  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch, 300);
  const [customerSearchResults, setCustomerSearchResults] = useState<{id: string, name: string, phone: string}[]>([]);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);

  // Returns
  const [returnSearch, setReturnSearch] = useState('');
  const [returnOrders, setReturnOrders] = useState<ReturnOrder[]>([]);
  const [returnLoading, setReturnLoading] = useState(false);
  const [selectedReturnOrder, setSelectedReturnOrder] = useState<ReturnOrder | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  const scannerRef = useRef<HTMLInputElement | null>(null);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (!selectedShowroom && showrooms.length === 1) setSelectedShowroom(showrooms[0]);
    if (!selectedBusinessId && businesses.length === 1) setSelectedBusinessId(businesses[0].id);
  }, [showrooms, selectedShowroom, businesses, selectedBusinessId]);

  useEffect(() => {
    if (!selectedShowroom) return;
    void checkShift(selectedShowroom.id);
  }, [selectedShowroom]);

  const checkShift = async (showroomId: string) => {
    try {
      const res = await fetch(`/api/pos/drawer-session?showroomId=${encodeURIComponent(showroomId)}`);
      const json = (await res.json().catch(() => null)) as ApiResponse<any> | null;
      if (!res.ok || !json?.success) {
        setShiftSession(null);
        setComputedBalance(0);
        return;
      }
      setShiftSession(json.data?.session || null);
      setComputedBalance(Number(json.data?.computedBalance || 0));
    } catch (err) {
      console.error('[POS_SHIFT_FETCH_ERROR]', err);
      setShiftSession(null);
      setComputedBalance(0);
    }
  };

  const handleShiftAction = async (actionOverride?: 'open' | 'close') => {
    const action = actionOverride || drawerAction;
    try {
      const url = action === 'open' ? '/api/pos/drawer-session/open' : '/api/pos/drawer-session/close';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showroomId: selectedShowroom?.id,
          countedCash: Number(countedCash),
          note: shiftNote,
        }),
      });

      const json = (await res.json().catch(() => null)) as ApiResponse<any> | null;
      if (!res.ok || !json?.success) {
        const code = json?.errors?.code;
        if (code === 'DRAWER_BALANCE_MISMATCH') {
          toast({
            title: 'Drawer mismatch',
            description: `Expected ${money(Number(json?.errors?.expected || 0))}, counted ${money(Number(json?.errors?.counted || 0))}. Ask Admin for Drawer Adjustment.`,
            variant: 'destructive',
          });
          return;
        }
        toast({ title: 'Error', description: json?.message || 'Failed', variant: 'destructive' });
        return;
      }

      toast({ title: 'Success', description: action === 'open' ? 'Shift opened' : 'Shift closed' });
      setShiftModalOpen(false);
      setCountedCash('');
      setShiftNote('');
      if (selectedShowroom) await checkShift(selectedShowroom.id);
      setIsInitializing(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed', variant: 'destructive' });
    }
  };

  const proceedToPOS = () => {
    if (!selectedShowroom || !selectedBusinessId) {
      toast({ title: 'Error', description: 'Business and Showroom required.', variant: 'destructive' });
      return;
    }
    if (!shiftSession) {
      toast({ title: 'Shift Required', description: 'Please open shift first.', variant: 'destructive' });
      return;
    }
    setIsInitializing(false);
  };

  // --- GRID FETCHING ---
  // 1. Fetch Categories
  useEffect(() => {
    if (isInitializing) return;
    fetch('/api/products/categories')
      .then(r => r.json())
      .then(data => setCategories(data || []))
      .catch(console.error);
  }, [isInitializing]);

  // 2. Fetch Products for Grid (debounced)
  useEffect(() => {
    if (isInitializing || !selectedShowroom || !shiftSession) return;
    setGridLoading(true);
    let url = `/api/products?pageSize=50&locationId=${encodeURIComponent(selectedShowroom.locationId)}`;
    if (activeCategory !== 'all') url += `&categoryId=${encodeURIComponent(activeCategory)}`;
    if (debouncedSkuSearch.length >= 2) url += `&search=${encodeURIComponent(debouncedSkuSearch)}`;

    fetch(url)
      .then(r => r.json())
      .then((json: ApiResponse<{ items: ProductApiItem[] }>) => {
        if (json?.success && json?.data?.items) {
          setGridProducts(json.data.items);
          if (activeCategory === 'all' && !debouncedSkuSearch) {
             try { localStorage.setItem(`pos_products_${selectedShowroom.locationId}`, JSON.stringify(json.data.items)); } catch {}
          }
        }
      })
      .catch((err) => {
         console.error('Fetch products failed, attempting cache', err);
         if (activeCategory === 'all' && !debouncedSkuSearch) {
             try { const cached = localStorage.getItem(`pos_products_${selectedShowroom.locationId}`); if (cached) setGridProducts(JSON.parse(cached)); } catch {}
         }
      })
      .finally(() => setGridLoading(false));
  }, [isInitializing, selectedShowroom, shiftSession, activeCategory, debouncedSkuSearch]);

  // Refocus search bar dynamically
  useEffect(() => {
    if (!isInitializing && activeTab === 'sale' && !variantPickerOpen && !successModal && !isShiftModalOpen && !isCartSheetOpen) {
      const t = setTimeout(() => scannerRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isInitializing, activeTab, variantPickerOpen, successModal, isShiftModalOpen, isCartSheetOpen]);

  // --- CUSTOMER AUTOCOMPLETE ---
  useEffect(() => {
    if (debouncedCustomerSearch.length >= 3 && customerSearch === customerPhone) {
      fetch(`/api/pos/customers?search=${encodeURIComponent(debouncedCustomerSearch)}`)
        .then(res => res.json())
        .then(json => {
          if (json.success && json.data) {
            setCustomerSearchResults(json.data);
            setCustomerSearchOpen(true);
          }
        }).catch(() => {});
    } else {
      setCustomerSearchResults([]);
      setCustomerSearchOpen(false);
    }
  }, [debouncedCustomerSearch]);

  // --- CART / POS LOGIC ---
  useEffect(() => {
    try { const saved = localStorage.getItem('pos_held_carts'); if (saved) setHeldCarts(JSON.parse(saved)); } catch {}
  }, []);

  useEffect(() => {
    if (heldCarts.length > 0) localStorage.setItem('pos_held_carts', JSON.stringify(heldCarts));
    else localStorage.removeItem('pos_held_carts');
  }, [heldCarts]);

  useEffect(() => {
    if (isInitializing) return;
    let scanBuf = '';
    let scanTimeout: any;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); setIsCartSheetOpen((prev) => !prev); return; }
      if (e.key === 'F4') { e.preventDefault(); if (!isCartSheetOpen) setIsCartSheetOpen(true); return; }

      if (e.key.length === 1) scanBuf += e.key;

      if (e.key === 'Enter') {
        if (scanBuf.length >= 3) {
           e.preventDefault(); e.stopPropagation();
           addBySku(scanBuf);
        }
        scanBuf = '';
      }
      
      clearTimeout(scanTimeout);
      scanTimeout = setTimeout(() => { scanBuf = ''; }, 60); 
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => { window.removeEventListener('keydown', handleKeyDown, true); clearTimeout(scanTimeout); };
  }, [isInitializing, isCartSheetOpen, selectedShowroom, shiftSession, skuSearch]);

  const parkCart = () => {
    if (!cart.length) return;
    setHeldCarts(prev => [...prev, { id: Math.random().toString(36).substring(7), time: Date.now(), cart, phone: customerPhone, name: customerName, discount, note: customerNote }]);
    setCart([]); setCustomerPhone(''); setCustomerName(''); setCustomerNote(''); setDiscount(''); setPayments([{ method: 'Cash', amount: '' }]);
    setIsCartSheetOpen(false);
    setCartStep('cart');
    toast({ title: '⏸️ Cart Held', description: 'Sale put on hold.', duration: 2500 });
  };

  const recallCart = (id: string, replace: boolean = false) => {
    const hc = heldCarts.find(h => h.id === id);
    if (!hc) return;
    if (replace && cart.length > 0) {
      setHeldCarts(prev => [...prev.filter(h => h.id !== id), { id: Math.random().toString(36).substring(7), time: Date.now(), cart, phone: customerPhone, name: customerName, discount, note: customerNote }]);
    } else {
      setHeldCarts(prev => prev.filter(h => h.id !== id));
    }
    setCart(hc.cart); setCustomerPhone(hc.phone); setCustomerName(hc.name); setCustomerNote(hc.note || ''); setDiscount(hc.discount || ''); setPayments([{ method: 'Cash', amount: '' }]);
    setIsCartSheetOpen(true);
    setCartStep('cart');
    setHeldCartsModalOpen(false);
  };

  const findOrAddCartLine = (line: Omit<CartLine, 'quantity'>) => {
    setCart((prev) => {
      const idx = prev.findIndex((p) => p.productId === line.productId && (p.variantId || null) === (line.variantId || null));
      if (idx === -1) {
        toast({ title: '🛒 Added', description: line.name, duration: 1500 });
        return [...prev, { ...line, quantity: 1 }];
      }

      const next = [...prev];
      const current = next[idx];
      const nextQty = current.quantity + 1;
      if (nextQty > current.available) {
        toast({ title: 'Out of stock', description: `${current.variantSku || current.sku} has only ${current.available} available`, variant: 'destructive' });
        return prev;
      }
      next[idx] = { ...current, quantity: nextQty };
      return next;
    });
  };

  const lookupSku = async (rawSku: string): Promise<{ product: ProductApiItem | null; variant: ProductApiVariant | null }> => {
    const sku = rawSku.trim();
    if (!sku || !selectedShowroom) return { product: null, variant: null };

    const url = `/api/products?search=${encodeURIComponent(sku)}&pageSize=10&locationId=${encodeURIComponent(selectedShowroom.locationId)}`;
    const res = await fetch(url);
    const json = (await res.json().catch(() => null)) as ApiResponse<{ items: ProductApiItem[] }> | null;
    if (!res.ok || !json?.success) throw new Error(json?.message || 'SKU lookup failed');

    const items = json.data?.items || [];
    for (const p of items) {
      for (const v of p.variants || []) {
        if (v.sku === sku) return { product: p, variant: v };
      }
    }
    const p = items.find((x) => x.sku === sku) || null;
    return { product: p, variant: null };
  };

  const addBySku = async (explicitSku?: string) => {
    const sku = (explicitSku || skuSearch).trim();
    if (!sku) return;
    if (!selectedShowroom || !shiftSession) return;

    try {
      const { product, variant } = await lookupSku(sku);
      if (!product) {
        toast({ title: 'Not found', description: `SKU not found: ${sku}`, variant: 'destructive' });
        return;
      }

      if (variant) {
        const available = Number(variant.inventory || 0);
        if (available <= 0) { toast({ title: 'Out of stock', description: `${variant.sku} available: ${available}`, variant: 'destructive' }); return; }
        const price = Number(variant.salePrice ?? variant.price ?? product.salePrice ?? product.price ?? 0);
        findOrAddCartLine({
          productId: product.id, variantId: variant.id, sku: product.sku, variantSku: variant.sku,
          name: product.name, variantName: variant.name, image: variant.image || product.image || undefined, price, available,
        });
        setSkuSearch('');
        return;
      }

      if (product.productType === 'variable') {
        const variants = product.variants || [];
        if (!variants.length) { toast({ title: 'No variants', description: `Product ${product.sku} has no variants.`, variant: 'destructive' }); return; }
        setVariantPickerProduct(product);
        setVariantPickerOpen(true);
        return;
      }

      const available = Number(product.inventory || 0);
      if (available <= 0) { toast({ title: 'Out of stock', description: `${product.sku} available: ${available}`, variant: 'destructive' }); return; }
      const price = Number(product.salePrice ?? product.price ?? 0);
      findOrAddCartLine({
        productId: product.id, variantId: null, sku: product.sku, name: product.name, image: product.image || undefined, price, available,
      });
      setSkuSearch('');
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'SKU lookup failed', variant: 'destructive' });
    }
  };

  const onSkuKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await addBySku();
    }
  };

  const addProductFromGrid = (p: ProductApiItem) => {
    if (p.productType === 'variable') {
      const variants = p.variants || [];
      if (!variants.length) { toast({ title: 'No variants', description: `Product ${p.sku} has no variants.`, variant: 'destructive' }); return; }
      setVariantPickerProduct(p);
      setVariantPickerOpen(true);
      return;
    }
    const available = Number(p.inventory || 0);
    if (available <= 0) { toast({ title: 'Out of stock', description: `${p.sku} available: ${available}`, variant: 'destructive' }); return; }
    const price = Number(p.salePrice ?? p.price ?? 0);
    findOrAddCartLine({
      productId: p.id, variantId: null, sku: p.sku, name: p.name, image: p.image || undefined, price, available,
    });
  };

  const updateCartQty = (idx: number, qty: number) => {
    setCart((prev) => {
      const next = [...prev];
      const line = next[idx];
      if (!line) return prev;
      const safeQty = Math.max(1, Math.floor(qty));
      if (safeQty > line.available) {
        toast({ title: 'Out of stock', description: `${line.variantSku || line.sku} limit: ${line.available}`, variant: 'destructive' });
        return prev;
      }
      next[idx] = { ...line, quantity: safeQty };
      return next;
    });
  };

  const updateCartPrice = (idx: number, price: number) => {
    setCart((prev) => {
      const next = [...prev];
      if (next[idx]) next[idx] = { ...next[idx], price: Math.max(0, price) };
      return next;
    });
  };

  const removeCartItem = (idx: number) => {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  };

  const subtotalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalAmount = Math.max(0, subtotalAmount - Number(discount || 0));

  const submitOrder = async () => {
    if (!selectedShowroom) return toast({ title: 'Error', description: 'Select a showroom', variant: 'destructive' });
    if (!selectedBusinessId) return toast({ title: 'Error', description: 'Select a business', variant: 'destructive' });
    if (!shiftSession) return toast({ title: 'Error', description: 'Shift is not open', variant: 'destructive' });
    if (!cart.length) return toast({ title: 'Error', description: 'Cart is empty', variant: 'destructive' });
    if (!customerPhone) return toast({ title: 'Error', description: 'Customer phone is required', variant: 'destructive' });

    setSubmitting(true);
    try {
      const validPayments = payments.filter(p => Number(p.amount) > 0);
      const totalPaidAmount = validPayments.reduce((acc, curr) => acc + Number(curr.amount), 0);
      const primaryPaymentMethod = validPayments.length > 0 ? validPayments[0].method : (fulfillment === 'COD' ? 'CashOnDelivery' : 'Cash');
      const splitNote = validPayments.length > 1 ? `[Split Payments: ${validPayments.map(p => `${p.method} ${p.amount}`).join(' + ')}]` : undefined;
      const combinedOfficeNote = splitNote ? (customerNote ? `${splitNote} Note: ${customerNote}` : splitNote) : undefined;

      const res = await fetch('/api/pos/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showroomId: selectedShowroom.id, businessId: selectedBusinessId, fulfillment,
          customer: { phone: customerPhone, name: customerName || undefined },
          items: cart.map((c) => ({ productId: c.productId, variantId: c.variantId, sku: c.sku, variantSku: c.variantSku, quantity: c.quantity, price: c.price })),
          paymentMethod: primaryPaymentMethod,
          paidAmount: totalPaidAmount, 
          discount: Number(discount || 0), 
          shipping: 0,
          notes: { customerNote: customerNote || undefined, officeNote: combinedOfficeNote },
        }),
      });

      const json = (await res.json().catch(() => null)) as ApiResponse<any> | null;
      if (!res.ok || !json?.success) {
        const code = json?.errors?.code;
        if (code === 'SHIFT_NOT_OPEN') toast({ title: 'Shift not open', description: 'Open shift then try again.', variant: 'destructive' });
        else if (code === 'INSUFFICIENT_STOCK' || code === 'INSUFFICIENT_RESERVED') toast({ title: 'Stock Error', description: json?.message || 'Insufficient stock', variant: 'destructive' });
        else if (code === 'DRAWER_BALANCE_MISMATCH') toast({ title: 'Drawer mismatch', description: `Mismatch. Ask Admin.`, variant: 'destructive' });
        else toast({ title: 'Error', description: json?.message || 'Failed to create POS order', variant: 'destructive' });
        return;
      }

      setSuccessModal({ orderId: json.data?.orderId, orderNumber: json.data?.orderNumber || '' });
      setCart([]); setCustomerName(''); setCustomerPhone(''); setCustomerNote(''); setDiscount(''); setPayments([{ method: 'Cash', amount: '' }]);
      setIsCartSheetOpen(false);
      setCartStep('cart');
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  // --- RETURNS ---
  const searchReturnOrders = async () => {
    if (!returnSearch.trim() || !selectedShowroom) return;
    setReturnLoading(true);
    try {
      const res = await fetch(`/api/pos/orders/search?showroomId=${selectedShowroom.id}&q=${encodeURIComponent(returnSearch.trim())}`);
      const json = (await res.json().catch(() => null)) as ApiResponse<{ orders: ReturnOrder[] }> | null;
      if (!res.ok || !json?.success) { toast({ title: 'Error', description: json?.message || 'Search failed', variant: 'destructive' }); return; }
      setReturnOrders(json.data?.orders || []);
    } catch (err: any) { toast({ title: 'Error', description: err?.message || 'Search failed', variant: 'destructive' }); } 
    finally { setReturnLoading(false); }
  };

  const submitRefund = async () => {
    if (!selectedReturnOrder || !selectedShowroom) return;
    const amt = Number(refundAmount || 0);
    if (amt <= 0) return toast({ title: 'Error', description: 'Refund amount must be > 0', variant: 'destructive' });
    setReturnSubmitting(true);
    try {
      const res = await fetch('/api/pos/returns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: selectedReturnOrder.id, showroomId: selectedShowroom.id, refundAmount: amt }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<any> | null;
      if (!res.ok || !json?.success) return toast({ title: 'Refund failed', description: json?.message || 'Failed', variant: 'destructive' });
      toast({ title: 'Refund processed', description: `৳${amt} refunded for ${selectedReturnOrder.orderNumber || selectedReturnOrder.id}` });
      setSelectedReturnOrder(null); setRefundAmount(''); setReturnOrders([]); setReturnSearch('');
    } catch (err: any) { toast({ title: 'Error', description: err?.message || 'Failed', variant: 'destructive' }); }
    finally { setReturnSubmitting(false); }
  };


  // ============================================
  // RENDER: INITIALIZATION SCREEN (No access case)
  // ============================================
  if (!showrooms.length) {
    return (
      <div className="flex bg-background h-screen w-full items-center justify-center">
        <div className="text-center space-y-4">
          <StoreIcon className="w-16 h-16 mx-auto text-muted-foreground" />
          <h2 className="text-2xl font-bold">No Showroom Access</h2>
          <p className="text-muted-foreground">You do not have access to any POS showrooms.</p>
          <Button asChild><Link href="/dashboard"><ArrowLeft className="w-4 h-4 mr-2"/> Return to Dashboard</Link></Button>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: INITIALIZATION (Step 1)
  // ============================================
  if (isInitializing) {
    return (
      <div className="flex bg-background h-screen w-full items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="pt-6 space-y-6">
            <div className="text-center space-y-2">
              <ShoppingBag className="w-12 h-12 mx-auto text-primary" />
              <h2 className="text-2xl font-bold tracking-tight">Point of Sale</h2>
              <p className="text-muted-foreground">Select your business and showroom to begin.</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Business Profile</Label>
                <Select value={selectedBusinessId} onValueChange={setSelectedBusinessId}>
                  <SelectTrigger><SelectValue placeholder="Select business" /></SelectTrigger>
                  <SelectContent>{businesses.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Showroom location</Label>
                <Select value={selectedShowroom?.id || ''} onValueChange={(v) => setSelectedShowroom(showrooms.find(s => s.id === v) || null)}>
                  <SelectTrigger><SelectValue placeholder="Select showroom" /></SelectTrigger>
                  <SelectContent>{showrooms.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {selectedShowroom && (
                <div className="p-4 rounded-lg bg-muted/30 border space-y-4 mt-6">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-sm">Shift Status</span>
                    {shiftSession ? (
                      <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-semibold flex items-center">
                        <span className="w-2 h-2 rounded-full bg-green-500 mr-1"/> Open
                      </span>
                    ) : (
                       <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-semibold flex items-center">
                        <span className="w-2 h-2 rounded-full bg-red-500 mr-1"/> Closed
                      </span>
                    )}
                  </div>
                  
                  {shiftSession ? (
                    <div className="space-y-3">
                      <div className="text-sm">Current Balance: <span className="font-bold">{money(computedBalance)}</span></div>
                      <Button className="w-full" size="lg" onClick={proceedToPOS} disabled={!selectedBusinessId}>Proceed to Sale</Button>
                    </div>
                  ) : (
                    <div className="space-y-3 border-t pt-3">
                      <p className="text-xs text-muted-foreground">
                        Expected Drawer Balance: <strong>{money(computedBalance)}</strong>. Before starting sales, please open the shift with current cash.
                      </p>
                      <div className="space-y-1">
                        <Label className="text-xs">Physical Cash Count</Label>
                        <Input type="number" placeholder="Enter amount..." value={countedCash} onChange={(e) => setCountedCash(e.target.value)} />
                      </div>
                      <Button className="w-full" onClick={() => handleShiftAction('open')}>Verify & Open Shift</Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-center pt-4">
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground text-xs"><Link href="/dashboard"><LayoutDashboard className="w-3 h-3 mr-1"/> Back to Dashboard</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============================================
  // RENDER: MAIN POS (Step 2)
  // ============================================
  return (
    <div className="flex h-screen bg-muted/20 overflow-hidden text-sm">
      
      {/* ⬅️ MAIN AREA: Products & Grid */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        
        {/* TOP STATUS BAR */}
        <header className="h-14 bg-background border-b px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
             <Button variant="ghost" size="icon" onClick={() => setIsInitializing(true)} className="h-8 w-8" title="Switch Showroom">
               <ArrowLeft className="w-4 h-4" />
             </Button>
             <div className="flex flex-col">
               <span className="font-semibold">{selectedShowroom?.name}</span>
               <span className="text-[10px] text-muted-foreground leading-none">
                 Shift: <span className="text-green-600 font-medium tracking-tight px-[2px]">{money(computedBalance)}</span>
                 <span className="ml-2 underline cursor-pointer" onClick={() => { setExpenseAmount(''); setExpenseReason(''); setExpenseModalOpen(true); }}>Cash Out</span>
                 <span className="ml-2 underline cursor-pointer" onClick={() => { setDrawerAction('close'); setCountedCash(''); setShiftModalOpen(true); }}>Close Shift</span>
               </span>
             </div>
          </div>
          
          {/* SEARCH BAR */}
          <div className="flex-1 max-w-md mx-4 relative hidden md:block">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input 
              ref={scannerRef}
              value={skuSearch}
              onChange={(e) => setSkuSearch(e.target.value)}
              onKeyDown={onSkuKeyDown}
              placeholder="Search or scan SKU (Enter)..." 
              className="pl-9 h-9 bg-muted/50 border-muted focus-visible:ring-1 focus-visible:ring-primary/50 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            {heldCarts.length > 0 && (
              <Button variant="outline" size="sm" className="h-9 border-amber-500/50 text-amber-600 bg-amber-50" onClick={() => setHeldCartsModalOpen(true)}>
                <span>Held Carts ({heldCarts.length})</span>
              </Button>
            )}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-[180px]">
              <TabsList className="grid w-full grid-cols-2 h-9 p-1 bg-muted">
                <TabsTrigger value="sale" className="text-xs">Sale</TabsTrigger>
                <TabsTrigger value="returns" className="text-xs">Returns</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" asChild className="h-9 hidden xl:flex">
              <Link href="/pos/reports"><BarChart3 className="w-4 h-4 mr-2"/> Reports</Link>
            </Button>
          </div>
        </header>

        {/* CATEGORIES HORIZONTAL BAR */}
        {activeTab === 'sale' && (
          <div className="bg-background border-b shrink-0 px-4 py-2">
            <div className="flex space-x-2 pb-1 overflow-x-auto scrollbar-hide snap-x touch-pan-x w-full [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <Button 
                key="all" 
                variant={activeCategory === 'all' ? 'default' : 'secondary'} 
                size="sm" 
                className="rounded-full px-4 h-8 text-xs shrink-0 snap-start"
                onClick={() => setActiveCategory('all')}
              >
                All Products
              </Button>
              {categories.map(c => (
                <Button 
                  key={c.id} 
                  variant={activeCategory === c.id ? 'default' : 'secondary'} 
                  size="sm" 
                  className="rounded-full px-4 h-8 text-xs shrink-0 snap-start"
                  onClick={() => setActiveCategory(c.id)}
                >
                  {c.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* PRODUCT GRID MAP AREA */}
        <ScrollArea className="flex-1 p-4 w-full">
          {activeTab === 'sale' ? (
             gridLoading ? (
               <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">Loading products...</div>
             ) : gridProducts.length === 0 ? (
               <div className="flex h-40 items-center justify-center text-muted-foreground text-sm flex-col">
                 <ShoppingBag className="w-8 h-8 mb-2 opacity-20"/>
                 No products found in this category.
               </div>
             ) : (
               <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 pb-24">
                 {gridProducts.map(p => {
                    const isOutOfStock = p.inventory !== undefined && p.inventory <= 0 && p.productType !== 'variable';
                    return (
                      <Card key={p.id} className={`overflow-hidden cursor-pointer hover:shadow-md transition-all ${isOutOfStock ? 'opacity-50' : ''}`} onClick={() => !isOutOfStock && addProductFromGrid(p)}>
                        <div className="aspect-square bg-muted/40 relative">
                           {p.image ? (
                             <img src={p.image} alt={p.name} className="w-full h-full object-cover"/>
                           ) : (
                             <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ShoppingBag className="w-6 h-6 opacity-20"/></div>
                           )}
                           {isOutOfStock && (
                             <div className="absolute inset-0 bg-background/60 flex items-center justify-center"><span className="bg-destructive text-destructive-foreground px-2 py-1 text-[10px] font-bold rounded">OUT OF STOCK</span></div>
                           )}
                           {p.productType === 'variable' && !isOutOfStock && (
                              <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded font-medium">Variable</div>
                           )}
                        </div>
                        <CardContent className="p-2.5">
                          <p className="font-semibold text-xs line-clamp-1 leading-tight" title={p.name}>{p.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{p.sku}</p>
                          <div className="mt-1.5 flex justify-between items-center">
                            <span className="font-bold text-sm tracking-tight">{money(p.salePrice ?? p.price ?? 0)}</span>
                            {p.productType !== 'variable' && p.inventory !== undefined && (
                               <span className="text-[10px] text-muted-foreground">Qty: {p.inventory}</span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                 })}
               </div>
             )
          ) : (
             <div className="max-w-4xl mx-auto py-6">
                {/* Returns Screen Inside Main UI */}
                <Card className="shadow-sm">
                  <CardContent className="p-6">
                    <h3 className="font-bold text-lg mb-4">Search POS Order for Returns</h3>
                    <div className="flex gap-2 max-w-xl mb-6">
                      <Input value={returnSearch} onChange={(e) => setReturnSearch(e.target.value)} placeholder="Enter Order # or phone number..." onKeyDown={(e) => e.key === 'Enter' && searchReturnOrders()} autoFocus />
                      <Button onClick={searchReturnOrders} disabled={returnLoading || !returnSearch.trim()}>
                        <Search className="w-4 h-4 mr-2" /> Search
                      </Button>
                    </div>

                    {returnOrders.length > 0 && (
                      <div className="grid gap-3">
                        {returnOrders.map((order) => (
                          <div key={order.id} className={`border rounded p-4 cursor-pointer transition-colors ${selectedReturnOrder?.id === order.id ? 'border-primary ring-1 ring-primary/50 bg-primary/5' : 'hover:bg-muted/30'}`} onClick={() => { setSelectedReturnOrder(order); setRefundAmount(String(order.paidAmount || 0)); }}>
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-semibold text-base">{order.orderNumber || order.id}</p>
                                <p className="text-muted-foreground">{order.customerName} • {order.customerPhone}</p>
                                <div className="mt-2 text-xs flex gap-2">
                                  <span className="bg-muted px-2 py-0.5 rounded">{order.status}</span>
                                  <span className="bg-muted px-2 py-0.5 rounded">{order.paymentMethod}</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-lg tracking-tight">{money(order.total)}</p>
                                <p className="text-green-600 font-medium">Paid: {money(order.paidAmount)}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {selectedReturnOrder && (
                  <Card className="mt-6 border-destructive/20 shadow-sm">
                    <CardContent className="p-6">
                      <h4 className="font-bold mb-4 text-base">Process Refund for {selectedReturnOrder.orderNumber || selectedReturnOrder.id}</h4>
                      <div className="grid gap-4 max-w-xs">
                        <div className="space-y-2">
                          <Label>Amount to Refund (৳)</Label>
                          <Input type="number" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} max={selectedReturnOrder.paidAmount} className="text-lg" />
                          <p className="text-xs text-muted-foreground">Maximum refundable: {money(selectedReturnOrder.paidAmount)}</p>
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button onClick={submitRefund} disabled={returnSubmitting} className="flex-1">
                            {returnSubmitting ? 'Processing...' : 'Confirm Refund'}
                          </Button>
                          <Button variant="outline" onClick={() => { setSelectedReturnOrder(null); setRefundAmount(''); }}>Cancel</Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
             </div>
          )}
        </ScrollArea>
      </div>

      {/* ➡️ FLOATING CART BUTTON & TWO-STEP MODAL */}
      {activeTab === 'sale' && (
        <div className="fixed bottom-6 right-6 lg:bottom-10 lg:right-10 z-50">
          <Button 
            size="lg" 
            onClick={() => { setIsCartSheetOpen(true); setCartStep('cart'); }}
            className="rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] h-16 sm:h-20 px-8 text-lg flex items-center gap-4 bg-primary text-primary-foreground hover:bg-primary/95 animate-in slide-in-from-bottom border-2 border-primary/20 hover:scale-105 transition-all"
          >
            <ShoppingBag className="w-6 h-6 sm:w-8 sm:h-8" />
            <div className="flex flex-col text-left">
              <span className="text-[10px] sm:text-xs opacity-80 uppercase tracking-widest font-semibold">{cart.length} Items</span>
              <span className="font-black text-xl sm:text-2xl tracking-tighter leading-none">{money(totalAmount)}</span>
            </div>
          </Button>

          <Dialog open={isCartSheetOpen} onOpenChange={(open) => { setIsCartSheetOpen(open); if(!open) setCartStep('cart'); }}>
            <DialogContent className="w-full sm:max-w-2xl flex flex-col p-0 border shadow-2xl overflow-hidden max-h-[90vh] gap-0">
              
              <div className="p-5 border-b shrink-0 flex justify-between items-center bg-muted/10 relative">
                {cartStep === 'checkout' && (
                  <Button variant="ghost" size="icon" className="absolute left-2 top-1/2 -translate-y-1/2" onClick={() => setCartStep('cart')}>
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                )}
                <h2 className={`font-bold text-xl flex items-center ${cartStep === 'checkout' ? 'ml-8' : ''}`}>
                  {cartStep === 'cart' ? <><ShoppingBag className="w-5 h-5 mr-3 text-primary" /> Current Order Overview</> : 'Checkout Details'}
                </h2>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={parkCart} disabled={!cart.length} className="h-8 px-3 text-xs hidden sm:flex">Pause</Button>
                  <Button variant="outline" size="sm" onClick={() => { setCart([]); setIsCartSheetOpen(false); setCartStep('cart'); }} disabled={!cart.length} className="text-destructive hover:bg-destructive hover:text-destructive-foreground h-8 px-3 text-xs hidden sm:flex">Clear</Button>
                </div>
              </div>

              {cartStep === 'cart' ? (
                <>
                  {/* STEP 1: CART ITEMS */}
                  <ScrollArea className="flex-1 p-0">
                    {cart.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground space-y-3 mt-20">
                        <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4 text-muted-foreground/50">
                          <ReceiptText className="w-10 h-10" />
                        </div>
                        <p className="font-medium text-lg">Your cart is empty</p>
                        <p className="text-sm">Scan an SKU or click a<br/>product from the grid.</p>
                      </div>
                    ) : (
                      <div className="divide-y p-2">
                        {cart.map((item, idx) => (
                          <div key={`${item.productId}:${item.variantId ?? ''}`} className="p-3 hover:bg-muted/10 transition-colors flex gap-4 items-center rounded-lg">
                            <div className="w-16 h-16 bg-muted rounded-md overflow-hidden shrink-0">
                              {item.image ? (
                                <img src={item.image} alt={item.name} className="w-full h-full object-cover"/>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ShoppingBag className="w-6 h-6 opacity-20"/></div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 pr-2">
                              <p className="font-semibold text-sm leading-tight text-foreground line-clamp-2">{item.name}</p>
                              {item.variantName && <p className="text-xs text-muted-foreground mt-0.5">{item.variantName}</p>}
                              <p className="text-[10px] text-muted-foreground tracking-wider mt-1 font-mono bg-muted/50 inline-block px-1 rounded">{item.variantSku || item.sku}</p>
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                               <div className="flex items-center gap-1 justify-end">
                                 <Input 
                                    type="number" 
                                    min={0}
                                    className="w-[4.5rem] text-right h-8 font-bold text-base tracking-tight p-1 focus-visible:ring-1" 
                                    value={item.price} 
                                    onChange={(e) => updateCartPrice(idx, Number(e.target.value))} 
                                 />
                                 <span className="text-muted-foreground pt-1">৳</span>
                               </div>
                               <div className="flex items-center gap-2">
                                 <div className="flex items-center border rounded-md overflow-hidden bg-background">
                                   <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={() => updateCartQty(idx, item.quantity - 1)} disabled={item.quantity <= 1}><Minus className="w-3.5 h-3.5" /></Button>
                                   <Input 
                                      type="number" 
                                      min={1} 
                                      max={item.available} 
                                      className="w-10 h-7 text-center text-sm font-semibold rounded-none focus-visible:ring-1 p-1 border-0 border-x appearance-none" 
                                      value={item.quantity === 0 ? '' : item.quantity} 
                                      onChange={(e) => updateCartQty(idx, Number(e.target.value))} 
                                      onFocus={(e) => e.target.select()}
                                   />
                                   <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={() => updateCartQty(idx, item.quantity + 1)} disabled={item.quantity >= item.available}><Plus className="w-3.5 h-3.5" /></Button>
                                 </div>
                                 <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive rounded-full hover:bg-destructive/10 hover:text-destructive" onClick={() => removeCartItem(idx)}><Trash2 className="w-4 h-4" /></Button>
                               </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <div className="flex flex-col bg-muted/10 border-t p-5 shrink-0 space-y-4">
                     <div className="flex justify-between items-center text-sm">
                       <span className="text-muted-foreground">Subtotal ({cart.length} items)</span>
                       <span className="font-semibold tracking-tight">{money(subtotalAmount)}</span>
                     </div>
                     <Button size="lg" className="w-full text-lg h-14 font-bold" disabled={cart.length === 0} onClick={() => setCartStep('checkout')}>
                        Proceed to Checkout <span className="ml-2">({money(subtotalAmount)})</span>
                     </Button>
                  </div>
                </>
              ) : (
                <>
                  {/* STEP 2: CHECKOUT */}
                  <ScrollArea className="flex-1 p-5">
                    <div className="space-y-6">
                      
                      <div className="p-4 bg-muted/20 border rounded-xl space-y-3">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span className="font-semibold">{money(subtotalAmount)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-destructive font-medium">Discount (৳)</span>
                          <Input 
                            type="number" 
                            value={discount} 
                            onChange={(e) => setDiscount(e.target.value)} 
                            placeholder="0" 
                            className="h-8 w-24 text-right text-sm font-semibold text-destructive focus-visible:ring-destructive/30" 
                          />
                        </div>
                        <div className="flex justify-between items-end border-t border-border/50 pt-3">
                          <span className="font-bold text-lg">Total Due</span>
                          <span className="text-3xl font-black tracking-tighter text-primary">{money(totalAmount)}</span>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-1.5">
                           <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Fulfillment Method</Label>
                           <div className="flex rounded-md shadow-sm border p-0.5 bg-background">
                             <Button type="button" size="sm" variant={fulfillment === 'STORE_PICKUP' ? 'default' : 'ghost'} className="flex-1 rounded h-9 text-xs font-semibold" onClick={() => setFulfillment('STORE_PICKUP')}>Store Pickup</Button>
                             <Button type="button" size="sm" variant={fulfillment === 'COD' ? 'default' : 'ghost'} className="flex-1 rounded h-9 text-xs font-semibold" onClick={() => setFulfillment('COD')}>Cash on Delivery</Button>
                           </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Phone Number (*)</Label>
                            <Input 
                              value={customerPhone} 
                              onChange={(e) => {
                                setCustomerPhone(e.target.value);
                                setCustomerSearch(e.target.value);
                              }} 
                              onFocus={() => customerSearchResults.length > 0 && setCustomerSearchOpen(true)}
                              onBlur={() => setTimeout(() => setCustomerSearchOpen(false), 200)}
                              placeholder="01XXXXXXXXX" 
                              className="h-10 focus-visible:ring-1 focus-visible:ring-primary/50" 
                              autoComplete='off'
                            />
                            {customerSearchOpen && customerSearchResults.length > 0 && (
                               <div className="absolute top-[70px] left-0 w-full bg-background border rounded-md shadow-xl z-[100] py-1 max-h-48 overflow-y-auto">
                                  {customerSearchResults.map(c => (
                                    <div key={c.id} className="px-3 py-2 text-sm hover:bg-muted cursor-pointer" onClick={() => {
                                      setCustomerPhone(c.phone);
                                      setCustomerSearch(c.phone);
                                      if (c.name) setCustomerName(c.name);
                                      setCustomerSearchOpen(false);
                                    }}>
                                      <span className="font-semibold">{c.phone}</span>
                                      <span className="text-muted-foreground ml-2">({c.name || 'No Name'})</span>
                                    </div>
                                  ))}
                               </div>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Customer Name</Label>
                            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in" className="h-10 focus-visible:ring-1 focus-visible:ring-primary/50" />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Order Note</Label>
                          <Input value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} placeholder="Optional note for this order..." className="h-10 focus-visible:ring-1" />
                        </div>

                        <div className="space-y-3 pt-2">
                            <div className="flex justify-between items-center bg-muted/40 p-2 rounded-md">
                              <Label className="text-xs uppercase tracking-wider font-bold">Payments ({fulfillment === 'STORE_PICKUP' ? 'Cash Deduct' : 'Advance'})</Label>
                              {payments.length < 3 && <Button variant="outline" size="sm" className="h-7 text-xs px-3" onClick={() => setPayments([...payments, { method: 'bKash', amount: '' }])}>+ Split Payment</Button>}
                            </div>
                            <div className="space-y-2">
                              {payments.map((p, idx) => (
                                <div key={idx} className="flex gap-2">
                                  <Select value={p.method} onValueChange={(val) => {
                                    const arr = [...payments]; arr[idx].method = val; setPayments(arr);
                                  }}>
                                    <SelectTrigger className="w-[120px] h-10 text-sm"><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="Cash">Cash</SelectItem>
                                      <SelectItem value="bKash">bKash</SelectItem>
                                      <SelectItem value="Nagad">Nagad</SelectItem>
                                      <SelectItem value="Bank">Bank</SelectItem>
                                      <SelectItem value="CashOnDelivery">COD</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <Input 
                                    type="number" 
                                    value={p.amount} 
                                    onChange={(e) => {
                                      const arr = [...payments]; arr[idx].amount = e.target.value; setPayments(arr);
                                    }} 
                                    placeholder={idx === 0 ? String(totalAmount) : '0'} className="h-10 focus-visible:ring-1 text-base font-semibold" 
                                  />
                                  {idx > 0 && <Button variant="ghost" size="icon" className="h-10 w-10 text-destructive shrink-0" onClick={() => setPayments(payments.filter((_, i) => i !== idx))}><Trash2 className="w-5 h-5"/></Button>}
                                </div>
                              ))}
                            </div>

                            {(() => {
                              const validP = payments.filter(p => Number(p.amount) > 0);
                              const totalP = validP.reduce((acc, curr) => acc + Number(curr.amount), 0);
                              const change = totalP - totalAmount;
          
                              return (
                                <div className="flex items-center gap-3 pt-3">
                                  <div className="flex-1 bg-muted/30 rounded-lg p-3 border">
                                     <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold block mb-1">Total Paid</Label>
                                     <span className={`text-xl font-bold ${totalP > 0 ? 'text-primary' : 'text-muted-foreground'}`}>{money(totalP)}</span>
                                  </div>
                                  <div className={`flex-1 rounded-lg p-3 border ${change > 0 ? 'bg-amber-100/50 border-amber-200' : 'bg-muted/30 border-transparent'}`}>
                                     <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold block mb-1">Change / Return</Label>
                                     <span className={`text-xl font-bold ${change > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{change > 0 ? money(change) : '0.00'}</span>
                                  </div>
                                </div>
                              );
                            })()}
                        </div>
                      </div>
                    </div>
                  </ScrollArea>
                  <div className="flex flex-col bg-background border-t p-5 shrink-0">
                    {(() => {
                        const validP = payments.filter(p => Number(p.amount) > 0);
                        const totalP = validP.reduce((acc, curr) => acc + Number(curr.amount), 0);
                        return (
                            <Button size="lg" className="w-full text-lg h-14 font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all" disabled={submitting || cart.length === 0 || !customerPhone || totalP <= 0} onClick={submitOrder}>
                               {submitting ? 'Processing...' : (fulfillment === 'STORE_PICKUP' ? 'Finish & Pay' : 'Book Order')}
                            </Button>
                        );
                    })()}
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* --- MODALS FOR MAIN POS --- */}

      {/* Shift Close Modal (triggered from top bar) */}
      <Dialog open={isShiftModalOpen} onOpenChange={setShiftModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close Cash Drawer Shift</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4 text-sm">
            <p className="text-muted-foreground">
              The system expects exactly <strong>{money(computedBalance)}</strong>. Please physically count the cash and input the amount.
            </p>
            <div className="space-y-2">
              <Label>Counted Cash Amount</Label>
              <Input type="number" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder="0.00" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Input value={shiftNote} onChange={(e) => setShiftNote(e.target.value)} placeholder="..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftModalOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleShiftAction('close')}>Verify & Close Shift</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expense/Adjustment Modal */}
      <Dialog open={isExpenseModalOpen} onOpenChange={setExpenseModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cash Drawer Adjustment</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4 text-sm">
            <div className="space-y-2">
              <Label>Amount (Use negative for Cash Out, positive for Cash In)</Label>
              <Input type="number" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} placeholder="-100" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input value={expenseReason} onChange={(e) => setExpenseReason(e.target.value)} placeholder="e.g. Snacks, Change taken" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseModalOpen(false)}>Cancel</Button>
            <Button disabled={expenseSubmitting || !expenseAmount || !expenseReason} onClick={async () => {
              setExpenseSubmitting(true);
              try {
                 const r = await fetch('/api/pos/drawer-adjustment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showroomId: selectedShowroom?.id, amount: expenseAmount, reason: expenseReason }) });
                 const j = await r.json();
                 if (!j.success) throw new Error(j.message);
                 toast({ title: 'Success', description: 'Adjustment saved.' });
                 setExpenseModalOpen(false);
                 if (selectedShowroom) checkShift(selectedShowroom.id);
              } catch(e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
              finally { setExpenseSubmitting(false); }
            }}>Submit Adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Variant Picker Modal */}
      <Dialog open={variantPickerOpen} onOpenChange={setVariantPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Select Variant</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground mb-3">Choice for: <span className="font-bold text-foreground">{variantPickerProduct?.name}</span> ({variantPickerProduct?.sku})</div>
            <ScrollArea className="h-80 w-full pr-4">
              <div className="space-y-2">
                {(variantPickerProduct?.variants || []).map((v) => {
                  const available = Number(v.inventory || 0);
                  const disabled = available <= 0;
                  return (
                    <div key={v.id} className="flex items-center justify-between border rounded-lg p-3 hover:bg-muted/30 transition-colors">
                      <div className="flex-1 pr-3">
                        <div className="font-semibold text-sm leading-tight mb-1">{v.name}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium bg-muted px-1.5 py-0.5 rounded">{v.sku}</span>
                          <span className={disabled ? 'text-destructive font-semibold' : ''}>Stock: {available}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 mr-3">
                        <span className="font-bold">{money(v.salePrice ?? v.price ?? variantPickerProduct!.salePrice ?? variantPickerProduct!.price ?? 0)}</span>
                      </div>
                      <Button size="sm" disabled={disabled} onClick={() => {
                          const price = Number(v.salePrice ?? v.price ?? variantPickerProduct!.salePrice ?? variantPickerProduct!.price ?? 0);
                          findOrAddCartLine({ productId: variantPickerProduct!.id, variantId: v.id, sku: variantPickerProduct!.sku, variantSku: v.sku, name: variantPickerProduct!.name, variantName: v.name, image: v.image || variantPickerProduct!.image || undefined, price, available });
                          setVariantPickerOpen(false); setVariantPickerProduct(null); setSkuSearch('');
                      }}>Add</Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Checkout Success Modal */}
      <Dialog open={!!successModal} onOpenChange={() => setSuccessModal(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="flex flex-col items-center gap-2 pt-4">
             <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-2"><CheckCircle2 className="w-8 h-8 text-green-600" /></div>
             Success
          </DialogTitle></DialogHeader>
          <div className="space-y-4 py-2 text-center">
            <p className="text-muted-foreground text-sm">Order <span className="font-bold text-foreground">{successModal?.orderNumber}</span> has been processed successfully.</p>
            <div className="flex flex-col gap-2 w-full pt-4">
              <Button asChild className="w-full bg-primary/90 text-primary-foreground">
                <a href={`/print/invoice/${successModal?.orderId}`} target="_blank" rel="noopener noreferrer"><Printer className="w-4 h-4 mr-2" /> Print Standard Invoice</a>
              </Button>
              <Button variant="secondary" asChild className="w-full">
                <a href={`/print/sticker/${successModal?.orderId}`} target="_blank" rel="noopener noreferrer"><ReceiptText className="w-4 h-4 mr-2" /> Print Receipt</a>
              </Button>
            </div>
          </div>
          <DialogFooter className="sm:justify-center mt-2 border-t pt-4">
            <Button variant="outline" className="w-full" onClick={() => setSuccessModal(null)}>Continue Sales</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Held Carts Modal */}
      <Dialog open={isHeldCartsModalOpen} onOpenChange={setHeldCartsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Held Sales</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {heldCarts.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No held sales.</p>
            ) : (
              <div className="space-y-3 pb-4">
                {heldCarts.map(hc => (
                  <Card key={hc.id} className="overflow-hidden">
                    <div className="p-3 bg-muted/30 border-b flex justify-between items-center text-xs text-muted-foreground">
                      <span>{new Date(hc.time).toLocaleTimeString()}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={(e) => { e.stopPropagation(); setHeldCarts(prev => prev.filter(h => h.id !== hc.id)); }}><Trash2 className="w-3 h-3"/></Button>
                    </div>
                    <CardContent className="p-3">
                      <div className="flex justify-between items-end mb-3">
                        <div>
                          <p className="font-semibold text-sm">{hc.cart.length} Items</p>
                          <p className="text-xs text-muted-foreground">{hc.name || hc.phone || 'Unknown Customer'}</p>
                        </div>
                        <span className="font-bold">{money(hc.cart.reduce((sum, item) => sum + item.price * item.quantity, 0))}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" onClick={() => recallCart(hc.id, false)}>Recall</Button>
                        {cart.length > 0 && <Button size="sm" variant="outline" onClick={() => recallCart(hc.id, true)}>Swap Current</Button>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

    </div>
  );
}
// Add missing Storeicon
function StoreIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/>
      <path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/>
      <path d="M12 3v6"/>
    </svg>
  );
}
