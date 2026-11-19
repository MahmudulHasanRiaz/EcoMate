-- Blog (Landing CMS Batch 2, item 20): BlogPost + BlogCategory +
-- BlogTag + BlogPostTag. DDL only — four new tables, no data migration.
--
-- SLUG UNIQUENESS (partial unique index): post slugs are unique among
-- LIVE posts only — a soft-deleted post FREES its slug. Prisma has no
-- partial-unique-index support, so the schema has no @@unique([slug]);
-- the index below is the enforcement at the DB layer, and BlogService
-- checks live-slug clashes in code first (409) with this index as the
-- race backstop (P2002 → 409). Same pattern as the EmailBalanceLedger
-- partial index (20261118175200_smtp_email_balance).
--
-- STATUS is a plain TEXT column validated at the API layer
-- (draft | scheduled | published | archived) — intentionally NOT a
-- Prisma enum, like the landing sections: a new status needs no
-- migration. CONTENT is Tiptap HTML (console editor); the landing
-- sanitizes it with isomorphic-dompurify before rendering.
-- CreateTable
CREATE TABLE "BlogCategory" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL,
    "descEn" TEXT,
    "descBn" TEXT,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogTag" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleBn" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerptEn" TEXT,
    "excerptBn" TEXT,
    "contentEn" TEXT NOT NULL,
    "contentBn" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL DEFAULT '',
    "categoryId" TEXT,
    "featuredImageUrl" TEXT,
    "videoUrl" TEXT,
    "galleryUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "readTime" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "seoTitleEn" TEXT,
    "seoTitleBn" TEXT,
    "seoDescEn" TEXT,
    "seoDescBn" TEXT,
    "canonicalUrl" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPostTag" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogPostTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlogCategory_slug_key" ON "BlogCategory"("slug");

-- CreateIndex
CREATE INDEX "BlogCategory_parentId_idx" ON "BlogCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "BlogTag_slug_key" ON "BlogTag"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "BlogPost_categoryId_idx" ON "BlogPost"("categoryId");

-- CreateIndex
CREATE INDEX "BlogPost_slug_idx" ON "BlogPost"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_deletedAt_status_publishedAt_idx" ON "BlogPost"("deletedAt", "status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPostTag_postId_tagId_key" ON "BlogPostTag"("postId", "tagId");

-- CreateIndex
CREATE INDEX "BlogPostTag_tagId_idx" ON "BlogPostTag"("tagId");

-- Partial unique index: slugs unique among LIVE posts only. A
-- soft-deleted post frees its slug (see the header comment).
CREATE UNIQUE INDEX "BlogPost_slug_live_key" ON "BlogPost"("slug") WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "BlogCategory" ADD CONSTRAINT "BlogCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BlogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BlogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPostTag" ADD CONSTRAINT "BlogPostTag_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPostTag" ADD CONSTRAINT "BlogPostTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "BlogTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
