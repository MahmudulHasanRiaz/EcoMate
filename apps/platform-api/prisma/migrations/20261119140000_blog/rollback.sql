-- Rollback for 20261119140000_blog.
-- Drops the blog tables (all posts, categories, tags, and post-tag
-- links are lost — including soft-deleted posts) and the partial
-- unique index on live post slugs. The public /blog routes then serve
-- the empty state (the landing fails soft on a missing blog API).
DROP TABLE IF EXISTS "BlogPostTag";
DROP TABLE IF EXISTS "BlogPost";
DROP TABLE IF EXISTS "BlogTag";
DROP TABLE IF EXISTS "BlogCategory";
