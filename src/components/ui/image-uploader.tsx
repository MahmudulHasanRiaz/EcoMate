"use client";

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { UploadCloud, X, Library, CheckCircle } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from './skeleton';
import { ScrollArea } from './scroll-area';
import { placeholderImages } from '@/lib/placeholder-images-data';
import { useToast } from '@/hooks/use-toast';

interface LibraryItem {
  url: string;
  id?: string;
}

interface ImageObject {
  url: string;
  id: string;
}

interface ImageUploaderProps {
  images: (File | ImageObject)[];
  onImagesChange: (files: (File | ImageObject)[]) => void;
  className?: string;
  isMultiple?: boolean;
}

// --------- Placeholder + helper ---------

const rawPlaceholder = placeholderImages.find(p => p.id === "1")?.imageUrl;
const DEFAULT_PLACEHOLDER =
  typeof rawPlaceholder === "string"
    ? rawPlaceholder
    : "/placeholder.svg";

// সব জায়গায় URL safe করার helper
function normalizeImageUrl(input: unknown): string {
  if (typeof input !== "string") {
    return DEFAULT_PLACEHOLDER;
  }

  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_PLACEHOLDER;

  // absolute or special
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }

  // local path, but maybe missing leading slash
  if (!trimmed.startsWith("/")) {
    return "/" + trimmed.replace(/^\/+/, "");
  }

  return trimmed;
}

// --------- Media Library ---------

const MediaLibrary = ({
  onSelectImage,
  selectedImageUrls,
}: {
  onSelectImage: (normalizedUrl: string) => void;
  selectedImageUrls: Set<string>;
}) => {
  const [imageItems, setImageItems] = useState<LibraryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activeEndpoint, setActiveEndpoint] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    const hydrate = async () => {
      const endpoints = ['/api/media', '/api/products/images'];
      for (const endpoint of endpoints) {
        try {
          const url = new URL(endpoint, window.location.origin);
          url.searchParams.set('pageSize', '120');
          const res = await fetch(url.toString());
          if (!res.ok) continue;
          const data: any = await res.json();
          const rawItems = Array.isArray(data)
            ? data
            : (Array.isArray(data?.items) ? data.items : []);
          const items: LibraryItem[] = rawItems.map((item: any) =>
            typeof item === "string"
              ? { url: item }
              : { url: item.url, id: item.id },
          );
          const cursor = typeof data?.nextCursor === 'string' ? data.nextCursor : null;
          if (items.length === 0 && !cursor) {
            continue;
          }
          setImageItems(items);
          setNextCursor(cursor);
          setActiveEndpoint(endpoint);
          setIsLoading(false);
          return;
        } catch (err) {
          console.error(`Failed to fetch media library images from ${endpoint}:`, err);
        }
      }
      setIsLoading(false);
    };
    hydrate();
  }, []);

  const loadMore = async () => {
    if (!activeEndpoint || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const url = new URL(activeEndpoint, window.location.origin);
      url.searchParams.set('pageSize', '120');
      url.searchParams.set('cursor', nextCursor);
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const data: any = await res.json();
      const rawItems = Array.isArray(data)
        ? data
        : (Array.isArray(data?.items) ? data.items : []);
      const items: LibraryItem[] = rawItems.map((item: any) =>
        typeof item === "string"
          ? { url: item }
          : { url: item.url, id: item.id },
      );
      const cursor = typeof data?.nextCursor === 'string' ? data.nextCursor : null;
      setImageItems((prev) => {
        const merged = new Map<string, LibraryItem>();
        prev.forEach((item) => merged.set(normalizeImageUrl(item.url), item));
        items.forEach((item) => merged.set(normalizeImageUrl(item.url), item));
        return Array.from(merged.values());
      });
      setNextCursor(cursor);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleSelect = (item: LibraryItem) => {
    const normalized = normalizeImageUrl(item.url);
    onSelectImage(normalized);
  };

  return (
    <div className="space-y-4">
      <ScrollArea className="h-72 pr-4">
        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
          {isLoading &&
            [...Array(12)].map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-md" />
            ))}

          {!isLoading &&
            imageItems.map((item) => {
              const src = normalizeImageUrl(item.url);
              const key = item.id || src;
              const isSelected = selectedImageUrls.has(src);

              return (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "relative aspect-square w-full rounded-md overflow-hidden border focus:ring-2 focus:ring-ring focus:outline-none transition-all",
                    isSelected && "ring-2 ring-primary border-primary"
                  )}
                  onClick={() => handleSelect(item)}
                >
                  <Image
                    src={src}
                    alt="Media library image"
                    fill
                    sizes="20vw"
                    className="object-cover"
                  />
                  {isSelected && (
                    <div className="absolute inset-0 bg-primary/60 flex items-center justify-center">
                      <CheckCircle className="h-6 w-6 text-primary-foreground" />
                    </div>
                  )}
                </button>
              );
            })}

          {!isLoading && imageItems.length === 0 && (
            <div className="text-center text-muted-foreground col-span-full py-10">
              No images in media library.
            </div>
          )}
        </div>
      </ScrollArea>
      {!isLoading && nextCursor && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
};

// --------- Main Uploader ---------

export function ImageUploader({
  images: propImages = [],
  onImagesChange,
  className,
  isMultiple = false,
}: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [internalImages, setInternalImages] = useState<(File | ImageObject)[]>(propImages);
  const [blobUrlMap, setBlobUrlMap] = useState<Record<string, string>>({});
  const blobUrlMapRef = useRef<Record<string, string>>({});

  // Sync ref with state
  useEffect(() => {
    blobUrlMapRef.current = blobUrlMap;
  }, [blobUrlMap]);

  // prop পরিবর্তন হলে internal state sync
  useEffect(() => {
    setInternalImages(propImages);
  }, [propImages]);

  // Object URL lifecycle management
  useEffect(() => {
    const files = internalImages.filter((img): img is File => img instanceof File);

    setBlobUrlMap(prev => {
      const newMap: Record<string, string> = { ...prev };
      let changed = false;

      // cleanup old
      const currentFileKeys = new Set(files.map(f => `${f.name}-${f.size}-${f.lastModified}`));
      Object.keys(newMap).forEach(key => {
        if (!currentFileKeys.has(key)) {
          URL.revokeObjectURL(newMap[key]);
          delete newMap[key];
          changed = true;
        }
      });

      // create new
      files.forEach(file => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!newMap[key]) {
          newMap[key] = URL.createObjectURL(file);
          changed = true;
        }
      });

      return changed ? newMap : prev;
    });
  }, [internalImages]);

  // unmount cleanup
  useEffect(() => {
    return () => {
      Object.values(blobUrlMapRef.current).forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // নির্বাচিত ইমেজকে main/thumbnail বানাতে – তাকে array এর প্রথমে নিয়ে আসি
  const setAsPrimary = useCallback((id: string) => {
    setInternalImages((prev) => {
      const index = prev.findIndex((img) => {
        if (img instanceof File) {
          return img.name === id;
        }
        return (img as ImageObject).id === id;
      });

      if (index <= 0) {
        // ইতিমধ্যেই প্রথম হলে কিছু করার দরকার নেই
        return prev;
      }

      const copy = [...prev];
      const [selected] = copy.splice(index, 1);
      const reordered = [selected, ...copy];

      // parent form-এর value-ও আপডেট করে দিই
      queueMicrotask(() => {
        onImagesChange(reordered);
      });
      return reordered;
    });
  }, [onImagesChange]);

  const { toast } = useToast();
  const MAX_SIZE_MB = 5;
  const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

  const handleFiles = useCallback(
    (newFiles: FileList | null) => {
      if (!newFiles) return;

      const validFiles: File[] = [];
      let hasError = false;

      Array.from(newFiles).forEach(file => {
        if (!file.type.startsWith('image/')) return;

        if (file.size > MAX_SIZE_BYTES) {
          hasError = true;
          return;
        }

        validFiles.push(file);
      });

      if (hasError) {
        toast({
          variant: "destructive",
          title: "File too large",
          description: `Images larger than ${MAX_SIZE_MB}MB were skipped.`,
        });
      }

      if (validFiles.length === 0) return;

      const updatedImages = isMultiple
        ? [...internalImages, ...validFiles]
        : [validFiles[0]];

      setInternalImages(updatedImages);
      onImagesChange(updatedImages);

      // reset input to allow re-selecting same file reliably
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [isMultiple, internalImages, onImagesChange, toast],
  );

  const handleSelectFromLibrary = useCallback(
    (normalizedUrl: string) => {
      const newImageObject: ImageObject = {
        id: normalizedUrl,
        url: normalizedUrl,
      };

      let updatedImages: (File | ImageObject)[];

      const isAlreadySelected = internalImages.some(
        img =>
          !(img instanceof File) &&
          normalizeImageUrl(img.url) === normalizedUrl,
      );

      if (isAlreadySelected) {
        // আবার ক্লিক করলে unselect
        updatedImages = internalImages.filter(img =>
          img instanceof File
            ? true
            : normalizeImageUrl(img.url) !== normalizedUrl,
        );
      } else {
        if (isMultiple) {
          updatedImages = [...internalImages, newImageObject];
        } else {
          updatedImages = [newImageObject];
        }
      }

      setInternalImages(updatedImages);
      onImagesChange(updatedImages);
    },
    [isMultiple, internalImages, onImagesChange],
  );

  const handleRemoveImage = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, idToRemove: string) => {
      e.stopPropagation();
      e.preventDefault();

      const updatedImages = internalImages.filter(img => {
        if (img instanceof File) {
          return img.name !== idToRemove;
        }
        return img.id !== idToRemove;
      });

      setInternalImages(updatedImages);
      onImagesChange(updatedImages);
    },
    [internalImages, onImagesChange],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  // preview list: File → Managed Blob URL, Object → normalized url
  const displayImages = React.useMemo(() => {
    return internalImages.map(img => {
      if (img instanceof File) {
        const key = `${img.name}-${img.size}-${img.lastModified}`;
        const managedUrl = blobUrlMap[key];
        return { url: managedUrl || '', id: img.name };
      }
      return {
        id: (img as ImageObject).id,
        url: normalizeImageUrl((img as ImageObject).url),
      };
    });
  }, [internalImages, blobUrlMap]);

  // library-তে কোনগুলো selected, normalized url দিয়ে track করি
  const selectedImageUrls = React.useMemo(() => {
    return new Set(
      internalImages
        .filter(img => !(img instanceof File))
        .map(img => normalizeImageUrl((img as ImageObject).url)),
    );
  }, [internalImages]);

  return (
    <div className={cn('space-y-4', className)}>
      <Tabs defaultValue="upload">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="upload">
            <UploadCloud className="mr-2 h-4 w-4" />
            Upload File
          </TabsTrigger>
          <TabsTrigger value="library">
            <Library className="mr-2 h-4 w-4" />
            Media Library
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <div
            className={cn(
              "border-2 border-dashed border-muted-foreground/50 rounded-lg flex flex-col items-center justify-center text-center p-8 transition-colors cursor-pointer",
              isDragging && "bg-accent/50 border-primary",
            )}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => {
              if (fileInputRef.current) fileInputRef.current.value = '';
              fileInputRef.current?.click();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple={isMultiple}
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              name="image-uploader-input"
            />
            <UploadCloud className="w-10 h-10 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              Drag & drop images here, or click to browse
            </p>
          </div>
        </TabsContent>

        <TabsContent value="library">
          <MediaLibrary
            onSelectImage={handleSelectFromLibrary}
            selectedImageUrls={selectedImageUrls}
          />
        </TabsContent>
      </Tabs>

      {displayImages.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 pt-4 border-t">
          <h3 className="col-span-full text-sm font-medium">Selected Images:</h3>
          {displayImages.map((image, index) => (
            <div key={image.id} className="relative group aspect-square">
              <Image
                src={image.url || DEFAULT_PLACEHOLDER}
                alt="Product preview"
                fill
                sizes="(max-width: 768px) 33vw, 16vw"
                className={cn(
                  "object-cover rounded-md border",
                  index === 0 && "ring-2 ring-primary" // main image highlight
                )}
              />

              {/* Main badge */}
              {index === 0 && (
                <span className="absolute bottom-1 left-1 rounded bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5">
                  Main
                </span>
              )}

              {/* Set as main button */}
              {index !== 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="absolute bottom-1 left-1 h-6 px-2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity bg-background/80"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAsPrimary(image.id);
                  }}
                >
                  Set main
                </Button>
              )}

              {/* Remove button */}
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => handleRemoveImage(e, image.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
