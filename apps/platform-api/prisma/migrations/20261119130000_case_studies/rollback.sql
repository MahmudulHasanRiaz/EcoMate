-- Rollback for 20261119130000_case_studies.
-- Drops the CaseStudy table (all case-study content is lost: published
-- studies disappear from /case-studies and the sitemap, drafts with
-- them). Testimonial rows in LandingContent are untouched — the Trust
-- section falls back to its built-in stories where no testimonials are
-- managed, and any testimonial carrying a caseStudySlug simply stops
-- linking out (the link renders only when the slug is present).
DROP TABLE IF EXISTS "CaseStudy";
