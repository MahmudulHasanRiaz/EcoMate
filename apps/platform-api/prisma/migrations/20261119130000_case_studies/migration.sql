-- Case-study pages (Landing CMS item 19): a dedicated CaseStudy model
-- for the public /case-studies + /case-studies/[slug] routes. Slugs must
-- be unique and routable, so this is a real table, not a LandingContent
-- section. DDL only — one new table, no data migration. The public
-- list/detail reads filter on isPublished, ordered by createdAt — the
-- composite index serves exactly that query.
-- CreateTable
CREATE TABLE "CaseStudy" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '[]',
    "featuredImageUrl" TEXT,
    "videoUrl" TEXT,
    "websiteUrl" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseStudy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseStudy_slug_key" ON "CaseStudy"("slug");

-- CreateIndex
CREATE INDEX "CaseStudy_isPublished_createdAt_idx" ON "CaseStudy"("isPublished", "createdAt");
