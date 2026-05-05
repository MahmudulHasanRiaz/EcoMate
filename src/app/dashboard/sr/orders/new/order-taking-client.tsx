"use client";

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Minus, ShoppingCart, UserPlus, Check, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { placeSrOrder, createSrCustomer } from "@/services/sr-portal";
import { useRouter } from "next/navigation";
import { resolveImageSrc } from "@/lib/image";
import Link from "next/link";

type Variant = {
  id: string;
  name: string;
  sku: string;
  image: string | null;
  wholesalePrice: number | null;
  retailPrice: number;
};

type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  basePrice: number;
  wholesalePrice: number | null;
  variants: Variant[];
  brand: string | null;
  categories: string[];
  minQuantity: number;
  videoUrl: string | null;
};

type Customer = {
  id: string;
  name: string;
  phone: string;
  type: string;
  address: string | null;
};

type CartItem = {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  price: number;
  quantity: number;
  image: string | null;
  minQuantity: number;
};

export default function SrOrderTakingClient({
  catalog,
  initialCustomers,
}: {
  catalog: CatalogProduct[];
  initialCustomers: Customer[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [shippingAddress, setShippingAddress] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [extraDiscount, setExtraDiscount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // New customer dialog
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // Get all unique categories
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    catalog.forEach((p) => p.categories.forEach((c) => cats.add(c)));
    return Array.from(cats).sort();
  }, [catalog]);

  // Filter products
  const filteredProducts = useMemo(() => {
    return catalog.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.brand || "").toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        activeCategory === "all" || p.categories.includes(activeCategory);
      return matchesSearch && matchesCategory;
    });
  }, [catalog, search, activeCategory]);

  const addToCart = useCallback(
    (product: CatalogProduct, variant?: Variant) => {
      const price = variant?.wholesalePrice ?? product.wholesalePrice ?? product.basePrice;
      const minQty = product.minQuantity;

      setCart((prev) => {
        const existingIdx = prev.findIndex(
          (item) =>
            item.productId === product.id && item.variantId === (variant?.id || null)
        );

        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            quantity: updated[existingIdx].quantity + minQty,
          };
          return updated;
        }

        return [
          ...prev,
          {
            productId: product.id,
            variantId: variant?.id || null,
            productName: product.name,
            variantName: variant?.name || null,
            price,
            quantity: minQty,
            image: variant?.image || product.image,
            minQuantity: minQty,
          },
        ];
      });

      toast({ title: "Added", description: `${product.name} × ${minQty}` });
    },
    [toast]
  );

  const updateQuantity = (idx: number, delta: number) => {
    setCart((prev) => {
      const updated = [...prev];
      const item = updated[idx];
      const newQty = item.quantity + delta;
      if (newQty < item.minQuantity) {
        // Remove item
        return prev.filter((_, i) => i !== idx);
      }
      updated[idx] = { ...item, quantity: newQty };
      return updated;
    });
  };

  const removeFromCart = (idx: number) => {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const finalTotal = cartTotal - extraDiscount;

  const handleCreateCustomer = async () => {
    if (!newCustomerName || !newCustomerPhone) {
      toast({ title: "Error", description: "Name and phone are required", variant: "destructive" });
      return;
    }
    setCreatingCustomer(true);
    try {
      const customer = await createSrCustomer({
        name: newCustomerName,
        phone: newCustomerPhone,
        address: newCustomerAddress,
        type: "Wholesaler",
      });
      const newCust: Customer = {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        type: "Wholesaler",
        address: newCustomerAddress || null,
      };
      setCustomers((prev) => [...prev, newCust]);
      setSelectedCustomer(newCust);
      setNewCustomerOpen(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerAddress("");
      toast({ title: "Customer created", description: customer.name });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCreatingCustomer(false);
    }
  };

  const handleSubmitOrder = async () => {
    if (!selectedCustomer) {
      toast({ title: "Error", description: "Select a customer", variant: "destructive" });
      return;
    }
    if (cart.length === 0) {
      toast({ title: "Error", description: "Cart is empty", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await placeSrOrder({
        customerId: selectedCustomer.id,
        customerPhone: selectedCustomer.phone,
        items: cart.map((item) => ({
          productId: item.productId,
          variantId: item.variantId || undefined,
          quantity: item.quantity,
          price: item.price,
        })),
        shippingAddress: shippingAddress || undefined,
        customerNote: customerNote || undefined,
        extraDiscount: extraDiscount || undefined,
      });
      setCart([]);
      toast({
        title: "Order placed!",
        description: `Order #${result.orderNumber} — ৳${result.total.toLocaleString()}`,
      });
      router.push("/dashboard/sr/orders");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Create New Order</h1>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Product Catalog */}
        <div className="lg:col-span-2 space-y-4">
          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Category Tabs */}
          {allCategories.length > 0 && (
            <Tabs value={activeCategory} onValueChange={setActiveCategory}>
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="all">All</TabsTrigger>
                {allCategories.map((cat) => (
                  <TabsTrigger key={cat} value={cat}>
                    {cat}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {/* Product Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filteredProducts.map((product) => (
              <Card key={product.id} className="overflow-hidden">
                <div className="aspect-square bg-muted/50 relative group">
                  <img
                    src={resolveImageSrc(product.image)}
                    alt={product.name}
                    className="object-cover w-full h-full mix-blend-multiply dark:mix-blend-normal"
                  />
                  {product.brand && (
                    <Badge variant="secondary" className="absolute top-2 left-2">
                      {product.brand}
                    </Badge>
                  )}
                  {/* View Details Button Overlay */}
                  <Link href={`/dashboard/sr/product/${product.id}`}>
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">
                      <Button size="sm" variant="secondary" className="gap-2">
                        <Eye className="h-4 w-4" />
                        View Details
                      </Button>
                    </div>
                  </Link>
                </div>
                <CardContent className="p-3 space-y-2">
                  <h3 className="font-medium text-sm line-clamp-2">{product.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    ৳{((product.wholesalePrice ?? product.basePrice) ?? 0).toLocaleString()}
                    {product.minQuantity > 1 && ` · Min ${product.minQuantity}`}
                  </p>

                  {product.variants.length > 0 ? (
                    <div className="space-y-1">
                      {product.variants.map((variant) => (
                        <Button
                          key={variant.id}
                          size="sm"
                          variant="outline"
                          className="w-full justify-between h-8 text-xs"
                          onClick={() => addToCart(product, variant)}
                        >
                          <span className="truncate">{variant.name}</span>
                          <Plus className="h-3 w-3" />
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => addToCart(product)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4 border rounded-lg bg-muted/50">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-1">
                {catalog.length === 0 ? "No products found" : "No matches found"}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {catalog.length === 0
                  ? "No visible wholesale products. Check Product > Wholesale > Visible to Wholesalers."
                  : "We couldn't find any products matching your search."}
              </p>
            </div>
          )}
        </div>

        {/* Right: Cart and Order */}
        <div className="space-y-4">
          {/* Customer Selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Customer
                <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="ghost">
                      <UserPlus className="h-4 w-4 mr-1" />
                      New
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create New Customer</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label>Name *</Label>
                        <Input
                          value={newCustomerName}
                          onChange={(e) => setNewCustomerName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Phone *</Label>
                        <Input
                          value={newCustomerPhone}
                          onChange={(e) => setNewCustomerPhone(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Address</Label>
                        <Textarea
                          value={newCustomerAddress}
                          onChange={(e) => setNewCustomerAddress(e.target.value)}
                        />
                      </div>
                      <Button
                        className="w-full"
                        onClick={handleCreateCustomer}
                        disabled={creatingCustomer}
                      >
                        Create Customer
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {selectedCustomer ? (
                <div className="p-3 bg-primary/5 rounded-lg">
                  <p className="font-medium">{selectedCustomer.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                  {selectedCustomer.address && (
                    <p className="text-xs text-muted-foreground">{selectedCustomer.address}</p>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-7"
                    onClick={() => setSelectedCustomer(null)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-48">
                  <div className="space-y-1">
                    {customers.map((c) => (
                      <Button
                        key={c.id}
                        variant="ghost"
                        className="w-full justify-start h-auto py-2"
                        onClick={() => setSelectedCustomer(c)}
                      >
                        <div className="text-left">
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone}</p>
                        </div>
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Cart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Cart ({cart.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Cart is empty
                </p>
              ) : (
                <>
                  <ScrollArea className="h-48">
                    <div className="space-y-2">
                      {cart.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.productName}</p>
                            {item.variantName && (
                              <p className="text-xs text-muted-foreground">{item.variantName}</p>
                            )}
                            <p className="text-xs">৳{item.price.toLocaleString()} × {item.quantity}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => updateQuantity(idx, -item.minQuantity)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="text-sm w-6 text-center">{item.quantity}</span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => updateQuantity(idx, item.minQuantity)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Subtotal</span>
                      <span>৳{cartTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">Extra Discount</span>
                      <Input
                        type="number"
                        min={0}
                        value={extraDiscount}
                        onChange={(e) => setExtraDiscount(parseInt(e.target.value) || 0)}
                        className="w-24 h-8 text-right"
                      />
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Total</span>
                      <span>৳{finalTotal.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Textarea
                      placeholder="Shipping address (optional)"
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      className="text-sm"
                    />
                    <Input
                      placeholder="Order note (optional)"
                      value={customerNote}
                      onChange={(e) => setCustomerNote(e.target.value)}
                      className="text-sm"
                    />
                  </div>

                  <Button
                    className="w-full"
                    disabled={!selectedCustomer || cart.length === 0 || submitting}
                    onClick={handleSubmitOrder}
                  >
                    {submitting ? "Placing..." : "Place Order"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
