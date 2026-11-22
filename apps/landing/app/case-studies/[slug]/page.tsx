import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MediaGallery } from '@/components/media-gallery';
import { SiteHeader } from '@/components/site-header';
import {
  fetchPublicCaseStudies,
  fetchPublicCaseStudy,
} from '@/lib/case-studies';
import {
  isDirectVideoFile,
  resolveMedia,
  resolveThumbnail,
  videoEmbedUrl,
} from '@/lib/content-media';

/**
 * Public case-study detail (/case-studies/[slug]). The fetch never
 * throws — an unknown or unpublished slug is a 404, and an
 * unreachable API is a 404 too (the page cannot render a study it
 * could not load; the list page still works).
 */

/** Only https URLs are rendered as outbound links or images. */
function isHttpsUrl(value: string | null): value is string {
  return typeof value === 'string' && value.startsWith('https://');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const study = await fetchPublicCaseStudy(slug);
  if (!study) {
    return { title: 'Case study not found — EcoMate' };
  }
  const title = study.seoTitle?.trim()
    ? study.seoTitle.trim()
    : `${study.title} — EcoMate case study`;
  const description = study.seoDescription?.trim()
    ? study.seoDescription.trim()
    : study.outcome;
  const thumbnail = resolveThumbnail(resolveMedia(study));
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(isHttpsUrl(thumbnail) ? { images: [{ url: thumbnail }] } : {}),
    },
  };
}

/** Pre-render the published studies at build time (fail-soft: []). */
export async function generateStaticParams() {
  const studies = await fetchPublicCaseStudies();
  return studies.map((study) => ({ slug: study.slug }));
}

export default async function CaseStudyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const study = await fetchPublicCaseStudy(slug);
  if (!study) notFound();
  const media = resolveMedia(study);
  const thumbnail = resolveThumbnail(media);
  // The thumbnail video plays first, then the gallery — deduped, so
  // a video that is both thumbnail and gallery entry plays once.
  const playList = [
    ...(media.thumbnailType === 'video' && media.thumbnailVideoUrl
      ? [{ url: media.thumbnailVideoUrl }]
      : []),
    ...media.videos,
  ].filter(
    (video, index, all) =>
      all.findIndex((other) => other.url === video.url) === index,
  );

  return (
    <>
      <SiteHeader />
      <main className="mk-legal mk-cs-detail">
        <p>
          <Link className="mk-cs-back" href="/case-studies">
            ← All case studies
          </Link>
        </p>
        <p className="eyebrow">
          {study.businessType} · {study.client}
        </p>
        <h1>{study.title}</h1>

        {isHttpsUrl(thumbnail) && (
          <img
            className="mk-cs-hero-img"
            src={thumbnail}
            alt={`${study.client} — featured image`}
          />
        )}

        {study.metrics.length > 0 && (
          <div className="mk-cs-metrics">
            {study.metrics.map((metric) => (
              <div className="mk-cs-metric" key={metric.label}>
                <b>{metric.stat}</b>
                <span>{metric.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mk-prose">
          <h2>The problem</h2>
          <p>{study.problem}</p>
          <h2>The solution</h2>
          <p>{study.solution}</p>
          <h2>The outcome</h2>
          <p>{study.outcome}</p>
        </div>

        {playList.map((video, index) => {
          const embedUrl = videoEmbedUrl(video.url);
          const videoTitle = video.title || `${study.title} — video`;
          if (embedUrl) {
            return (
              <div key={`${video.url}-${index}`} className="mk-cs-video">
                <iframe
                  src={embedUrl}
                  title={videoTitle}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            );
          }
          if (isDirectVideoFile(video.url)) {
            return (
              <div key={`${video.url}-${index}`} className="mk-cs-video">
                <video
                  src={video.url}
                  poster={thumbnail ?? undefined}
                  controls
                  preload="metadata"
                />
              </div>
            );
          }
          if (!isHttpsUrl(video.url)) return null;
          return (
            <p key={`${video.url}-${index}`} className="mk-cs-link">
              <a href={video.url} target="_blank" rel="noreferrer">
                Watch the video ↗
              </a>
            </p>
          );
        })}

        <MediaGallery
          images={media.galleryImages}
          heading="Gallery"
          closeLabel="Close"
        />

        {isHttpsUrl(study.websiteUrl) && (
          <p className="mk-cs-link">
            <a href={study.websiteUrl} target="_blank" rel="noreferrer">
              Visit {study.client} ↗
            </a>
          </p>
        )}

        <p className="mk-cs-cta">
          <Link className="mk-btn mk-btn-primary" href="/signup">
            Start a trial
          </Link>
        </p>
      </main>
    </>
  );
}
