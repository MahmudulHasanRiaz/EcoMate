'use client';

/**
 * v3 trust section (mockup §11): selectable story cards + featured panel with
 * a video stub that opens the case-study modal.
 *
 * SaaS: stories come from `proof.caseStudies` (built-in sample stories, or
 * managed testimonials merged over them by the provider) — there is no
 * separate DB testimonial feed in this app.
 */
import React, { useState } from 'react';
import { Play } from 'lucide-react';
import { useLanding } from '@/components/shell/useLanding';
import type { CaseStudy } from '@/lib/landingTypes';
import { CaseStudyVideoModal } from '../CaseStudyVideoModal';
import { youtubeEmbedUrl } from '@/lib/contact';
import { SectionHead, SectionShell } from './SectionHead';

interface Story {
  id: string;
  businessName: string;
  roleLine: string;
  quote: string;
  website: string;
  videoDuration: string;
  videoTitle: string;
  caseStudySlug?: string;
  /** CMS Batch 2, item 14: category + rating shown on the panel. */
  category: string;
  rating?: number;
  modal: CaseStudy;
}

function storyFromCaseStudy(study: CaseStudy): Story {
  return {
    id: study.id,
    businessName: study.businessName,
    roleLine: study.role,
    quote: study.quote,
    website: study.website,
    videoDuration: study.videoDuration ?? '',
    videoTitle: study.videoTitle ?? 'Customer story',
    caseStudySlug: study.caseStudySlug,
    category: study.category ?? '',
    rating: study.rating,
    modal: study,
  };
}

function ratingStars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

export function MkTrust() {
  const { content } = useLanding();
  const proof = content.proof;

  const stories = proof.caseStudies.map(storyFromCaseStudy);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const selected = stories.find((story) => story.id === (selectedId ?? stories[0]?.id)) ?? stories[0];
  // The selected story's own video wins; the section video is the
  // fallback; the illustrated stub (opening the modal) is the last
  // resort. Hiding `videoSection` in the CMS hides the whole block.
  const videoVisible = content.visibility?.videoSection !== false;
  const embedUrl =
    youtubeEmbedUrl(selected?.modal.videoUrl ?? '') ??
    youtubeEmbedUrl(content.videoSection.youtubeUrl);

  return (
    <SectionShell id="proof">
      <SectionHead
        index="11"
        eyebrow={proof.eyebrow}
        title={proof.heading}
        sub={proof.subheading}
      />
      {selected && (
        <div className="mk-proof-grid">
          <div role="listbox" aria-label={proof.heading}>
            {stories.map((story) => (
              <button
                key={story.id}
                type="button"
                role="option"
                aria-selected={story.id === selected.id}
                data-on={story.id === selected.id}
                className="mk-tcard"
                onClick={() => setSelectedId(story.id)}
              >
                <b>{story.businessName}</b>
                <span>{story.roleLine}</span>
              </button>
            ))}
          </div>
          <div className="mk-pn" aria-live="polite">
            {videoVisible && embedUrl ? (
              <div className="mk-vid-frame">
                <iframe
                  src={embedUrl}
                  title={`${selected.videoTitle}: ${selected.businessName}`}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : videoVisible ? (
              <div className="mk-vid">
                <span className="mk-vid-tag">
                  {proof.chrome.featuredBadge} · {selected.videoDuration}
                </span>
                <button
                  type="button"
                  className="mk-vid-play"
                  onClick={() => setVideoOpen(true)}
                  aria-label={`${proof.chrome.watchInterview}: ${selected.businessName}`}
                >
                  <Play size={22} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            <p className="mk-quote">“{selected.quote}”</p>
            {(selected.category.trim().length > 0 || selected.rating) && (
              <p className="mk-strip mk-story-meta">
                {selected.category.trim()}
                {selected.category.trim().length > 0 && selected.rating
                  ? ' · '
                  : ''}
                {selected.rating ? (
                  <span aria-label={`Rated ${selected.rating} out of 5`}>
                    {ratingStars(selected.rating)}
                  </span>
                ) : null}
              </p>
            )}
            <p className="mk-strip">
              {selected.businessName}
              {selected.website.trim().length > 0 && ` · ${selected.website}`}
            </p>
            {/* A managed testimonial with a caseStudySlug links to its
                full case-study page; otherwise the link keeps its
                built-in destination. */}
            <a
              href={
                selected.caseStudySlug
                  ? `/case-studies/${selected.caseStudySlug}`
                  : '#demo'
              }
              className="mk-demo-link"
            >
              {proof.chrome.watchCaseStudy}
            </a>
          </div>
        </div>
      )}
      <CaseStudyVideoModal caseStudy={videoOpen && selected ? selected.modal : null} onClose={() => setVideoOpen(false)} />
    </SectionShell>
  );
}
