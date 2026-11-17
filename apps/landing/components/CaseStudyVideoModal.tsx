import React from 'react';
import { CaseStudy } from '@/lib/landingTypes';
import { X, Play, Globe, Building2 } from 'lucide-react';

interface CaseStudyVideoModalProps {
  caseStudy: CaseStudy | null;
  onClose: () => void;
}

/**
 * Case-study video modal, restyled from the reference's Tailwind utilities
 * onto the mk-* classes (the SaaS landing has no Tailwind). The video is a
 * stub — clicking play is presentational, as in the reference.
 */
export const CaseStudyVideoModal: React.FC<CaseStudyVideoModalProps> = ({
  caseStudy,
  onClose,
}) => {
  if (!caseStudy) return null;

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

        {/* Video Simulation Box */}
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

        {/* Case Study Summary */}
        <div className="mk-modal-head">
          <div>
            <h3 className="mk-modal-biz">
              <Building2 size={16} aria-hidden="true" />
              <span>{caseStudy.businessName}</span>
            </h3>
            <p className="mk-modal-who">
              {caseStudy.founderName} · {caseStudy.role} · {caseStudy.location}
            </p>
          </div>
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

        <p className="mk-modal-quote">
          &ldquo;{caseStudy.quote}&rdquo;
        </p>

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
