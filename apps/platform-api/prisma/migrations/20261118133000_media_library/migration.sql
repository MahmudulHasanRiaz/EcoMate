-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "driver" TEXT NOT NULL DEFAULT 'local',
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "folder" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_objectKey_key" ON "MediaAsset"("objectKey");

-- CreateIndex
CREATE INDEX "MediaAsset_folder_createdAt_idx" ON "MediaAsset"("folder", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MediaAsset_mimeType_createdAt_idx" ON "MediaAsset"("mimeType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "MediaAsset_uploadedByUserId_idx" ON "MediaAsset"("uploadedByUserId");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

