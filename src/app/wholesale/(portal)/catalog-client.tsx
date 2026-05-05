"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ShoppingCart, Search, Minus, Plus, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
  if (typeof window === "undefined") return [];
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

export default function WholesaleCatalogClient({
  catalog,
}: {
  catalog: CatalogProduct[];
}) {
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const filtered = catalog.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.brand || "").toLowerCase().includes(search.toLowerCase()) ||
      p.categories.some((c) => c.toLowerCase().includes(search.toLowerCase()))
  );

  const addToCart = (product: CatalogProduct, variant?: Variant) => {
    const price = variant?.wholesalePrice ?? product.wholesalePrice ?? product.basePrice;
    const minQty = product.minQuantity;
    const item: CartItem = {
      productId: product.id,
      variantId: variant?.id || null,
      name: product.name,
      variantName: variant?.name || null,
      price,
      quantity: minQty,
      image: product.image,
      minQuantity: minQty,
    };

    const cart = getCart();
    const existingIdx = cart.findIndex(
      (c) => c.productId === item.productId && c.variantId === item.variantId
    );

    if (existingIdx >= 0) {
      cart[existingIdx].quantity += minQty;
    } else {
      cart.push(item);
    }

    saveCart(cart);
    toast({ title: "Added to cart", description: `${product.name} x${minQty}` });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Wholesale Catalog</h1>
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center px-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">
            {catalog.length === 0 ? "No products found" : "No matches found"}
          </h3>
          <p className="text-muted-foreground max-w-md">
            {catalog.length === 0
              ? "No visible wholesale products yet. Please contact support or ask admin to enable Visible to Wholesalers."
              : "We couldn't find any products matching your search. Try adjusting your filters or search term."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((product) => (
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
                <Link href={`/wholesale/product/${product.id}`}>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">
                    <Button size="sm" variant="secondary" className="gap-2">
                      <Eye className="h-4 w-4" />
                      View Details
                    </Button>
                  </div>
                </Link>
              </div>
              <CardContent className="p-4 space-y-3">
                <div>
                  <h3 className="font-semibold text-sm line-clamp-2">{product.name}</h3>
                  {product.categories.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {product.categories.slice(0, 2).join(" · ")}
                    </p>
                  )}
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold">
                    ৳{((product.wholesalePrice ?? product.basePrice) ?? 0).toLocaleString()}
                  </span>
                  {product.wholesalePrice && product.wholesalePrice < product.basePrice && (
                    <span className="text-sm text-muted-foreground line-through">
                      ৳{product.basePrice.toLocaleString()}
                    </span>
                  )}
                </div>

                {product.minQuantity > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Min. order: {product.minQuantity} pcs
                  </p>
                )}

                {product.variants.length > 0 ? (
                  <div className="space-y-2">
                    {product.variants.map((variant) => (
                      <div
                        key={variant.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="text-muted-foreground truncate">
                          {variant.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            ৳{(variant.wholesalePrice ?? variant.retailPrice ?? 0).toLocaleString()}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2"
                            onClick={() => addToCart(product, variant)}
                          >
                            <ShoppingCart className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => addToCart(product)}
                  >
                    <ShoppingCart className="h-4 w-4 mr-1" />
                    Add to Cart
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
