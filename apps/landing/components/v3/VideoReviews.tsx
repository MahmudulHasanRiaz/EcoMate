'use client';

/**
 * v3 video reviews (the video half of the retired proof section):
 * ONE modern slider of published video reviews.
 *
 * One featured video card at a time: poster image (`thumbnailUrl` —
 * no poster, no card image, never a broken img), click-to-play
 * (YouTube/Vimeo → iframe; upload → <video controls>), quote +
 * name/role/company + stars below. `video_short` cards render
 * narrower/taller (vertical-friendly); `video_standard` render 16:9.
 * `thumbnailAutoplay=true` turns the poster into a muted looping
 * <video> preview while the slide is active — direct files only,
 * YouTube/Vimeo embeds never autoplay (browsers forbid unmuted
 * autoplay; muted embeds would still start sound on unmute).
 *
 * Slider chrome: previous/next + slide indicators, auto-advance
 * every 6s, paused on hover/focus/interaction; keyboard accessible
 * (arrow keys, focus-visible states). Hidden entirely when there are
 * no video reviews (no fake video, no empty slider). Section id
 * `proof` keeps the old anchor working.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useLanding } from '@/components/shell/useLanding';
import type { PublicClientReview } from '@/lib/client-reviews';
import { reviewQuote } from '@/lib/client-reviews';
import {
  isDirectVideoFile,
  videoEmbedUrl,
} from '@/lib/content-media';
import { SectionHead, SectionShell } from './SectionHead';

const AUTO_ADVANCE_MS = 6_000;

function ratingStars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/** The video URL a review plays: the thumbnail video, else the first gallery video. */
function reviewVideoUrl(review: PublicClientReview): string | null {
  if (review.thumbnailType === 'video' && review.thumbnailVideoUrl) {
    return review.thumbnailVideoUrl;
  }
  return review.videos[0]?.url ?? null;
}

export function MkVideoReviews({ reviews }: { reviews: PublicClientReview[] }) {
  const { locale, content } = useLanding();
  const proof = content.proof;

  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);

  // The active index must survive a shorter list (a review unpublished
  // between the server fetch and a re-render).
  const safeActive = reviews.length === 0 ? 0 : active % reviews.length;
  const current = reviews[safeActive];

  // Auto-advance: paused while hovered, focused, or playing.
  useEffect(() => {
    if (paused || playing || reviews.length < 2) return;
    const timer = window.setTimeout(() => {
      setActive((prev) => (prev + 1) % reviews.length);
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [paused, playing, reviews.length, safeActive]);

  // Hidden entirely when there are no video reviews — not even the heading.
  if (reviews.length === 0 || !current) return null;

  const goTo = (index: number) => {
    setPlaying(false);
    setActive((index + reviews.length) % reviews.length);
  };

  const videoUrl = reviewVideoUrl(current);
  const embedUrl = videoUrl ? videoEmbedUrl(videoUrl) : null;
  const isFile = videoUrl ? isDirectVideoFile(videoUrl) : false;
  const isShort = current.effectiveFormat === 'video_short';
  // Muted looping preview while active — direct files only, and only
  // when the operator asked for it (YouTube/Vimeo never autoplay).
  const showAutoplayPreview =
    !playing && isFile && current.thumbnailAutoplay && videoUrl !== null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(safeActive - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(safeActive + 1);
    }
  };

  return (
    <SectionShell id="proof">
      <SectionHead
        index="11"
        eyebrow={proof.eyebrow}
        title={proof.heading}
        sub={proof.subheading}
      />
      <div
        ref={regionRef}
        className="mk-vr"
        role="region"
        aria-roledescription="carousel"
        aria-label={proof.heading}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onKeyDown={onKeyDown}
      >
        <div
          className={`mk-vr-stage ${isShort ? 'mk-vr-stage--short' : ''}`}
          aria-live="polite"
        >
          {playing && embedUrl ? (
            <iframe
              className="mk-vr-frame"
              src={`${embedUrl}?autoplay=1&rel=0`}
              title={`${current.reviewerName} — ${current.companyName}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : playing && isFile && videoUrl ? (
            <video
              className="mk-vr-frame"
              src={videoUrl}
              poster={current.thumbnailUrl ?? undefined}
              controls
              autoPlay
            />
          ) : showAutoplayPreview && videoUrl ? (
            <div className="mk-vr-poster">
              <video
                className="mk-vr-frame"
                src={videoUrl}
                poster={current.thumbnailUrl ?? undefined}
                muted
                loop
                playsInline
                autoPlay
                aria-hidden="true"
              />
              <button
                type="button"
                className="mk-vr-play"
                onClick={() => setPlaying(true)}
                aria-label={`${proof.chrome.watchInterview}: ${current.reviewerName}, ${current.companyName}`}
              >
                <Play size={22} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="mk-vr-poster">
              {current.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="mk-vr-frame"
                  src={current.thumbnailUrl}
                  alt=""
                />
              ) : (
                <div className="mk-vr-frame mk-vr-frame--empty" aria-hidden="true" />
              )}
              {videoUrl ? (
                <button
                  type="button"
                  className="mk-vr-play"
                  onClick={() => setPlaying(true)}
                  aria-label={`${proof.chrome.watchInterview}: ${current.reviewerName}, ${current.companyName}`}
                >
                  <Play size={22} aria-hidden="true" />
                </button>
              ) : null}
              {current.videoDuration.trim().length > 0 ? (
                <span className="mk-vr-duration">{current.videoDuration}</span>
              ) : null}
            </div>
          )}
        </div>

        <div className="mk-vr-caption">
          <p className="mk-vr-quote">“{reviewQuote(current, locale)}”</p>
          <p className="mk-strip">
            {current.reviewerName}
            {current.role.trim().length > 0 ? ` · ${current.role}` : ''}
            {` · ${current.companyName}`}
          </p>
          {current.rating ? (
            <p
              className="mk-strip"
              aria-label={`Rated ${current.rating} out of 5`}
            >
              {ratingStars(current.rating)}
            </p>
          ) : null}
        </div>

        {reviews.length > 1 ? (
          <div className="mk-vr-controls">
            <button
              type="button"
              className="mk-vr-arrow"
              onClick={() => goTo(safeActive - 1)}
              aria-label="Previous video review"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <div className="mk-vr-dots" role="tablist" aria-label="Video reviews">
              {reviews.map((review, index) => (
                <button
                  key={review.id}
                  type="button"
                  role="tab"
                  aria-selected={index === safeActive}
                  aria-label={`Video review ${index + 1}: ${review.reviewerName}, ${review.companyName}`}
                  className="mk-vr-dot"
                  data-on={index === safeActive}
                  onClick={() => goTo(index)}
                />
              ))}
            </div>
            <button
              type="button"
              className="mk-vr-arrow"
              onClick={() => goTo(safeActive + 1)}
              aria-label="Next video review"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
