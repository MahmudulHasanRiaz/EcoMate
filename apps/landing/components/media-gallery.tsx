'use client';

/**
 * Shared image gallery (blog detail + case-study detail): a grid of
 * thumbnails, click to enlarge in a lightbox (Escape / click-outside
 * to close). Reuses the blog's `mk-blog-gallery` / `mk-blog-lightbox`
 * CSS classes — the class names predate the shared component; the
 * styles are layout-only, not blog-specific. Captions show under the
 * enlarged image; alt text lands on the thumbnails.
 */
import { useEffect, useState } from 'react';
import type { MediaImage } from '@/lib/content-media';

export function MediaGallery({
  images,
  heading,
  closeLabel,
}: {
  images: MediaImage[];
  heading: string;
  closeLabel: string;
}) {
  const [selected, setSelected] = useState<MediaImage | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  if (images.length === 0) return null;

  return (
    <>
      <section aria-label={heading}>
        <h2 className="mk-blog-gallery-heading">{heading}</h2>
        <div className="mk-blog-gallery">
          {images.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              type="button"
              className="mk-blog-gallery-item"
              onClick={() => setSelected(image)}
              aria-label={`Open image ${index + 1} full size`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.alt ?? ''}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <div
          className="mk-blog-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={heading}
          onClick={() => setSelected(null)}
        >
          <button
            type="button"
            className="mk-blog-lightbox-close"
            onClick={() => setSelected(null)}
          >
            {closeLabel} ×
          </button>
          <figure onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selected.url} alt={selected.alt ?? ''} />
            {selected.caption ? (
              <figcaption>{selected.caption}</figcaption>
            ) : null}
          </figure>
        </div>
      )}
    </>
  );
}
