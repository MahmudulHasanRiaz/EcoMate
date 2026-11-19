import React from 'react';
import { CaseStudy } from '@/lib/landingTypes';
import { youtubeEmbedUrl } from '@/lib/contact';
import { X, Play, Globe, Building2 } from 'lucide-react';

interface CaseStudyVideoModalProps {
  caseStudy: CaseStudy | null;
  onClose: () => void;
}

/**
 * Case-study video modal, restyled from the reference's Tailwind utilities
 * onto the mk-* classes (the SaaS landing has no Tailwind). With a
 * managed YouTube video URL (CMS Batch 2, item 14) the modal embeds the
 * real video; otherwise the video is a stub — clicking play is
 * presentational, as in the reference. Category, rating, challenge,
 * solution, photo and logo render only when the managed story carries
 * them — built-in stories show the original layout.
 */
export const CaseStudyVideoModal: React.FC<CaseStudyVideoModalProps> = ({
  caseStudy,
  onClose,
}) => {
  if (!caseStudy) return null;

  const embedUrl = youtubeEmbedUrl(caseStudy.videoUrl ?? '');
  const category = caseStudy.category.trim();
  const challenge = caseStudy.challenge.trim();
  const solution = caseStudy.solution.trim();

  return (
    <div
      className="mk-modal-scrim"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="mk-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="mk-icon-btn mk-modal-close"
          aria-label="Close modal"
        >
          <X size={17} aria-hidden="true" />
        </button>

        {/* Video: a real embed when the story has a YouTube URL, the
            simulation box otherwise. */}
        {embedUrl ? (
          <div className="mk-vid-frame">
            <iframe
              src={embedUrl}
              title={`${caseStudy.videoTitle || 'Customer story'}: ${caseStudy.businessName}`}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="mk-modal-video">
            <div className="mk-modal-play">
              <Play size={28} aria-hidden="true" />
            </div>
            <span className="mk-modal-video-title">
              {caseStudy.videoTitle || 'Operational Case Study Video Walkthrough'}
            </span>
            <span className="mk-modal-video-meta">
              Duration: {caseStudy.videoDuration || '3:30 min'} · High Definition
            </span>
            <p className="mk-modal-video-note">
              Clicking play simulates the video interview detailing warehouse packing redesign and courier reconciliation.
            </p>
          </div>
        )}

        {/* Case Study Summary */}
        <div className="mk-modal-head">
          <div className="mk-modal-head-main">
            {caseStudy.imageUrl ? (
              <img
                src={caseStudy.imageUrl}
                alt={caseStudy.founderName}
                className="mk-modal-photo"
                loading="lazy"
              />
            ) : null}
            <div>
              <h3 className="mk-modal-biz">
                <Building2 size={16} aria-hidden="true" />
                <span>{caseStudy.businessName}</span>
              </h3>
              <p className="mk-modal-who">
                {caseStudy.founderName} · {caseStudy.role} · {caseStudy.location}
              </p>
              {(category.length > 0 || caseStudy.rating) && (
                <p className="mk-modal-meta">
                  {category}
                  {category.length > 0 && caseStudy.rating ? ' · ' : ''}
                  {caseStudy.rating ? (
                    <span aria-label={`Rated ${caseStudy.rating} out of 5`}>
                      {'★'.repeat(caseStudy.rating)}
                      {'☆'.repeat(5 - caseStudy.rating)}
                    </span>
                  ) : null}
                </p>
              )}
            </div>
          </div>
          <div className="mk-modal-head-side">
            {caseStudy.logoUrl ? (
              <img
                src={caseStudy.logoUrl}
                alt={`${caseStudy.businessName} logo`}
                className="mk-modal-logo"
                loading="lazy"
              />
            ) : null}
            {caseStudy.website.trim().length > 0 && (
              <a
                href={`https://${caseStudy.website}`}
                target="_blank"
                rel="noreferrer"
                className="mk-modal-site"
              >
                <Globe size={14} aria-hidden="true" />
                <span>{caseStudy.website}</span>
              </a>
            )}
          </div>
        </div>

        <p className="mk-modal-quote">
          &ldquo;{caseStudy.quote}&rdquo;
        </p>

        {challenge.length > 0 && (
          <div className="mk-modal-story">
            <h4>The challenge</h4>
            <p>{challenge}</p>
          </div>
        )}
        {solution.length > 0 && (
          <div className="mk-modal-story">
            <h4>The solution</h4>
            <p>{solution}</p>
          </div>
        )}

        {caseStudy.metrics.length > 0 && (
          <div className="mk-modal-metrics">
            {caseStudy.metrics.map((m, idx) => (
              <div key={idx} className="mk-modal-metric">
                <b>{m.stat}</b>
                <span>{m.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
