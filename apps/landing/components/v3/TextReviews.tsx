'use client';

/**
 * v3 text reviews (the text half of the retired proof section): a
 * static responsive grid of quote cards — NOT a slider (the layout
 * difference from the video section is the point). Each card has the
 * reviewer photo (or initials when no photo), quote, name/role/
 * company, stars, company logo when present, and a link to the full
 * case study when the review's caseStudyId resolves to a slug.
 *
 * No published text reviews → the built-in fallback stories
 * (content.proof.caseStudies, the same stories Trust showed,
 * including any managed LandingContent testimonials merged over
 * them). Never mixed with real reviews: once the first real text
 * review is published, the fallback disappears entirely.
 *
 * The section heading renders only when the video section is NOT
 * showing above it (standalone): when both sections render, the
 * video section already carries the proof heading (index 11) and a
 * second identical h2 would duplicate it. When standalone, this
 * section carries the heading itself.
 */
import React from 'react';
import { useLanding } from '@/components/shell/useLanding';
import type { PublicClientReview } from '@/lib/client-reviews';
import { reviewQuote } from '@/lib/client-reviews';
import type { CaseStudy } from '@/lib/landingTypes';
import { SectionHead, SectionShell } from './SectionHead';

function ratingStars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function MkTextReviews({
  reviews,
  caseStudySlugs,
  standalone,
}: {
  reviews: PublicClientReview[];
  /** caseStudyId → slug, for the "read the case study" link. */
  caseStudySlugs: Record<string, string>;
  /** True when the video section is not showing above this one. */
  standalone: boolean;
}) {
  const { locale, content } = useLanding();
  const proof = content.proof;
  const fallback = reviews.length === 0;

  return (
    <SectionShell id="reviews">
      {standalone ? (
        <SectionHead
          index="11"
          eyebrow={proof.eyebrow}
          title={proof.heading}
          sub={proof.subheading}
        />
      ) : null}
      {fallback ? (
        <div className="mk-tr-grid">
          {proof.caseStudies.map((story) => (
            <FallbackCard
              key={story.id}
              story={story}
              watchCaseStudy={proof.chrome.watchCaseStudy}
            />
          ))}
        </div>
      ) : (
        <div className="mk-tr-grid">
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              locale={locale}
              caseStudySlug={
                review.caseStudyId
                  ? caseStudySlugs[review.caseStudyId]
                  : undefined
              }
              watchCaseStudy={proof.chrome.watchCaseStudy}
            />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

function ReviewCard({
  review,
  locale,
  caseStudySlug,
  watchCaseStudy,
}: {
  review: PublicClientReview;
  locale: 'en' | 'bn';
  caseStudySlug?: string;
  watchCaseStudy: string;
}) {
  return (
    <article className="mk-tr-card">
      <div className="mk-tr-head">
        {review.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="mk-tr-photo"
            src={review.thumbnailUrl}
            alt=""
            loading="lazy"
          />
        ) : (
          <span className="mk-tr-photo mk-tr-initials" aria-hidden="true">
            {initials(review.reviewerName)}
          </span>
        )}
        <div>
          <p className="mk-tr-name">{review.reviewerName}</p>
          <p className="mk-tr-role">
            {[review.role, review.companyName].filter(Boolean).join(' · ')}
          </p>
        </div>
        {review.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="mk-tr-logo"
            src={review.logoUrl}
            alt={`${review.companyName} logo`}
            loading="lazy"
          />
        ) : null}
      </div>
      <p className="mk-tr-quote">“{reviewQuote(review, locale)}”</p>
      {review.rating ? (
        <p
          className="mk-tr-stars"
          aria-label={`Rated ${review.rating} out of 5`}
        >
          {ratingStars(review.rating)}
        </p>
      ) : null}
      {review.metrics.length > 0 ? (
        <p className="mk-tr-metrics">
          {review.metrics.map((metric) => (
            <span key={`${metric.stat}-${metric.label}`}>
              <b>{metric.stat}</b> {metric.label}
            </span>
          ))}
        </p>
      ) : null}
      {caseStudySlug ? (
        <a href={`/case-studies/${caseStudySlug}`} className="mk-demo-link">
          {watchCaseStudy}
        </a>
      ) : null}
    </article>
  );
}

/** A built-in (or managed-testimonial) fallback story, same card shape. */
function FallbackCard({
  story,
  watchCaseStudy,
}: {
  story: CaseStudy;
  watchCaseStudy: string;
}) {
  return (
    <article className="mk-tr-card">
      <div className="mk-tr-head">
        {story.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="mk-tr-photo"
            src={story.imageUrl}
            alt=""
            loading="lazy"
          />
        ) : (
          <span className="mk-tr-photo mk-tr-initials" aria-hidden="true">
            {initials(story.businessName)}
          </span>
        )}
        <div>
          <p className="mk-tr-name">{story.businessName}</p>
          <p className="mk-tr-role">{story.role}</p>
        </div>
        {story.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="mk-tr-logo"
            src={story.logoUrl}
            alt={`${story.businessName} logo`}
            loading="lazy"
          />
        ) : null}
      </div>
      <p className="mk-tr-quote">“{story.quote}”</p>
      {story.rating ? (
        <p
          className="mk-tr-stars"
          aria-label={`Rated ${story.rating} out of 5`}
        >
          {ratingStars(story.rating)}
        </p>
      ) : null}
      {story.caseStudySlug ? (
        <a href={`/case-studies/${story.caseStudySlug}`} className="mk-demo-link">
          {watchCaseStudy}
        </a>
      ) : null}
    </article>
  );
}
