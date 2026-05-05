"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { placeWholesaleOrder } from "@/services/wholesale-portal";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { Trash2, ShoppingCart, Loader2, ShoppingBag } from "lucide-react";

type CartItem = {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  price: number;
  quantity: number;
  image: string | null;
  minQuantity: number;
};

const CART_KEY = "wholesale_cart";

function getCart(): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("wholesale-cart-updated"));
}

export default function WholesaleCartClient() {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<CartItem[]>([]);
  const [shippingAddress, setShippingAddress] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [placing, setPlacing] = useState(false);

  const loadCart = useCallback(() => {
    setItems(getCart());
  }, []);

  useEffect(() => {
    loadCart();
    window.addEventListener("wholesale-cart-updated", loadCart);
    return () => window.removeEventListener("wholesale-cart-updated", loadCart);
  }, [loadCart]);

  const updateQuantity = (idx: number, qty: number) => {
    const minQty = items[idx].minQuantity;
    if (qty < minQty) qty = minQty;
    const updated = [...items];
    updated[idx] = { ...updated[idx], quantity: qty };
    setItems(updated);
    saveCart(updated);
  };

  const removeItem = (idx: number) => {
    const updated = items.filter((_, i) => i !== idx);
    setItems(updated);
    saveCart(updated);
  };

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handlePlaceOrder = async () => {
    if (items.length === 0) return;
    setPlacing(true);
    try {
      const result = await placeWholesaleOrder({
        items: items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId || undefined,
          quantity: item.quantity,
          price: item.price,
        })),
        shippingAddress: shippingAddress || undefined,
        customerNote: customerNote || undefined,
      });

      saveCart([]);
      setItems([]);
      toast({
        title: "Order placed!",
        description: `Order #${result.orderNumber} — ৳${result.total.toLocaleString()}`,
      });
      router.push("/wholesale/orders");
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to place order", variant: "destructive" });
    } finally {
      setPlacing(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-20 space-y-4">
        <ShoppingCart className="h-16 w-16 mx-auto text-muted-foreground" />
        <h2 className="text-xl font-semibold">Cart is empty</h2>
        <p className="text-muted-foreground">Browse the catalog to add products</p>
        <Button onClick={() => router.push("/wholesale")}>Browse Catalog</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Shopping Cart</h1>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Cart items */}
        <div className="lg:col-span-2 space-y-3">
          {items.map((item, idx) => (
            <Card key={`${item.productId}-${item.variantId}`}>
              <CardContent className="p-4 flex items-center gap-4">
                {item.image && (
                  <div className="w-16 h-16 bg-muted rounded flex-shrink-0 overflow-hidden">
                    <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  {item.variantName && (
                    <p className="text-xs text-muted-foreground">{item.variantName}</p>
                  )}
                  <p className="text-sm font-semibold mt-1">৳{item.price.toLocaleString()} / pc</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={item.minQuantity}
                    value={item.quantity}
                    onChange={(e) => updateQuantity(idx, parseInt(e.target.value) || item.minQuantity)}
                    className="w-20 text-center"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    ৳{(item.price * item.quantity).toLocaleString()}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => removeItem(idx)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Order summary */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal ({items.length} items)</span>
                  <span>৳{subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Shipping</span>
                  <span>TBD</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span>৳{subtotal.toLocaleString()}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="shippingAddress">Shipping Address</Label>
                  <Textarea
                    id="shippingAddress"
                    placeholder="Enter delivery address..."
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="customerNote">Order Note</Label>
                  <Input
                    id="customerNote"
                    placeholder="Any special instructions..."
                    value={customerNote}
                    onChange={(e) => setCustomerNote(e.target.value)}
                  />
                </div>
              </div>

              <Button className="w-full" onClick={handlePlaceOrder} disabled={placing}>
                {placing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ShoppingBag className="h-4 w-4 mr-2" />
                )}
                Place Order
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
