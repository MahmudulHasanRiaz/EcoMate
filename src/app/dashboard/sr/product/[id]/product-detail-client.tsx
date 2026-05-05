"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Plus, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { resolveImageSrc } from "@/lib/image";

// Utility to extract YouTube video ID
function getYouTubeVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
    /youtube\.com\/shorts\/([^?]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Utility to extract Facebook video ID
function getFacebookVideoId(url: string): string | null {
  const patterns = [
    /facebook\.com\/.*\/videos\/(\d+)/,
    /fb\.watch\/([^\/]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

type Variant = {
  id: string;
  name: string;
  sku: string;
  image: string | null;
  wholesalePrice: number | null;
  retailPrice: number;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  images?: { url: string; id: string }[];
  basePrice: number;
  wholesalePrice: number | null;
  variants: Variant[];
  brand: string | null;
  categories: string[];
  minQuantity: number;
  videoUrl: string | null;
};

export default function ProductDetailClient({ product }: { product: Product }) {
  const { toast } = useToast();
  const [activeImage, setActiveImage] = useState(
    resolveImageSrc(product.image)
  );
  const [showVideo, setShowVideo] = useState(false);

  // Parse images if image field contains JSON
  const productImages = (() => {
    if (!product.image) return [];
    try {
      const parsed = JSON.parse(product.image);
      if (Array.isArray(parsed)) {
        return parsed.map((img: any) => ({
          url: img.url || img.imageUrl || "",
          id: img.id || img.url || "",
        }));
      }
    } catch {
      // Not JSON, treat as single image
    }
    return product.image ? [{ url: product.image, id: "main" }] : [];
  })();

  const allImages =
    productImages.length > 0
      ? productImages
      : product.image
        ? [{ url: product.image, id: "main" }]
        : [];

  const youtubeVideoId = product.videoUrl
    ? getYouTubeVideoId(product.videoUrl)
    : null;
  const facebookVideoId = product.videoUrl
    ? getFacebookVideoId(product.videoUrl)
    : null;
  const hasVideo = !!(youtubeVideoId || facebookVideoId);

  const handleAddToOrder = (variant?: Variant) => {
    // Navigate back to order page with pre-selected product
    const price =
      variant?.wholesalePrice ?? product.wholesalePrice ?? product.basePrice;
    const minQty = product.minQuantity;

    toast({
      title: "Quick Add",
      description: `${product.name}${variant ? ` (${variant.name})` : ""} - ৳${price.toLocaleString()} x ${minQty}`,
    });

    // Navigate back to orders/new page
    window.location.href = "/dashboard/sr/orders/new";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" className="h-8 w-8" asChild>
          <Link href="/dashboard/sr/orders/new">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{product.name}</h1>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Left: Images & Video */}
        <div className="space-y-4">
          {/* Main Display */}
          <div className="aspect-square bg-muted/50 rounded-lg overflow-hidden relative">
            {showVideo && hasVideo ? (
              <div className="w-full h-full">
                {youtubeVideoId ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${youtubeVideoId}`}
                    title="Product Video"
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : facebookVideoId ? (
                  <iframe
                    src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(product.videoUrl!)}&show_text=0`}
                    title="Product Video"
                    className="w-full h-full"
                    scrolling="no"
                    frameBorder="0"
                    allowFullScreen
                  />
                ) : null}
              </div>
            ) : (
              <img
                src={activeImage}
                alt={product.name}
                className="object-cover w-full h-full"
              />
            )}
          </div>

          {/* Thumbnails */}
          <div className="flex gap-2 flex-wrap">
            {allImages.map((img, index) => (
              <button
                key={img.id || index}
                onClick={() => {
                  setActiveImage(resolveImageSrc(img.url));
                  setShowVideo(false);
                }}
                className={`w-20 h-20 rounded-md overflow-hidden border-2 transition-all ${
                  activeImage === resolveImageSrc(img.url) && !showVideo
                    ? "border-primary"
                    : "border-transparent hover:border-gray-300"
                }`}
              >
                <img
                  src={resolveImageSrc(img.url)}
                  alt={`${product.name} - ${index + 1}`}
                  className="object-cover w-full h-full"
                />
              </button>
            ))}

            {/* Video Thumbnail */}
            {hasVideo && (
              <button
                onClick={() => setShowVideo(true)}
                className={`w-20 h-20 rounded-md overflow-hidden border-2 transition-all relative ${
                  showVideo
                    ? "border-primary"
                    : "border-transparent hover:border-gray-300"
                }`}
              >
                <div className="w-full h-full bg-gray-900 flex items-center justify-center">
                  <Play className="h-8 w-8 text-white" />
                </div>
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-white bg-black/60 px-1.5 rounded">
                  Video
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Product Info */}
        <div className="space-y-6">
          <div>
            {product.brand && (
              <Badge variant="secondary" className="mb-2">
                {product.brand}
              </Badge>
            )}
            <h1 className="text-2xl font-bold mb-2">{product.name}</h1>
            {product.categories.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {product.categories.join(" · ")}
              </p>
            )}
          </div>

          <Separator />

          {/* Price */}
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold">
              ৳
              {(product.wholesalePrice ?? product.basePrice)?.toLocaleString()}
            </span>
            {product.wholesalePrice &&
              product.wholesalePrice < product.basePrice && (
                <span className="text-xl text-muted-foreground line-through">
                  ৳{product.basePrice.toLocaleString()}
                </span>
              )}
          </div>

          {/* Min Quantity */}
          {product.minQuantity > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline">Min. Order: {product.minQuantity}</Badge>
            </div>
          )}

          {/* Description */}
          {product.description && (
            <div>
              <h3 className="font-semibold mb-2">Description</h3>
              <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                {product.description}
              </p>
            </div>
          )}

          <Separator />

          {/* Variants */}
          {product.variants.length > 0 ? (
            <div>
              <h3 className="font-semibold mb-3">Variants</h3>
              <div className="space-y-2">
                {product.variants.map((variant) => (
                  <Card key={variant.id}>
                    <CardContent className="p-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {variant.image && (
                          <img
                            src={resolveImageSrc(variant.image)}
                            alt={variant.name}
                            className="w-12 h-12 rounded object-cover"
                          />
                        )}
                        <div>
                          <p className="font-medium text-sm">{variant.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {variant.sku}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold">
                          ৳
                          {(
                            variant.wholesalePrice ??
                            variant.retailPrice ??
                            0
                          ).toLocaleString()}
                        </span>
                        <Button
                          size="sm"
                          onClick={() => handleAddToOrder(variant)}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <Button className="w-full" onClick={() => handleAddToOrder()}>
              <Plus className="h-4 w-4 mr-2" />
              Add to Order
            </Button>
          )}

          {/* Back to Order Button */}
          <Button variant="outline" className="w-full" asChild>
            <Link href="/dashboard/sr/orders/new">
              Back to Order Taking
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
