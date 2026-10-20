-- Add private profile picture assets without changing existing profiles or documents.
CREATE TYPE "ProfilePictureStatus" AS ENUM ('UPLOADING', 'READY', 'DELETING');

CREATE TABLE "ProfilePictureAsset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cloudinaryPublicId" VARCHAR(255) NOT NULL,
    "status" "ProfilePictureStatus" NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProfilePictureAsset_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "profilePictureId" UUID;

CREATE UNIQUE INDEX "ProfilePictureAsset_cloudinaryPublicId_key" ON "ProfilePictureAsset"("cloudinaryPublicId");
CREATE INDEX "ProfilePictureAsset_userId_createdAt_idx" ON "ProfilePictureAsset"("userId", "createdAt");
CREATE INDEX "ProfilePictureAsset_status_updatedAt_idx" ON "ProfilePictureAsset"("status", "updatedAt");
CREATE UNIQUE INDEX "User_profilePictureId_key" ON "User"("profilePictureId");

ALTER TABLE "ProfilePictureAsset" ADD CONSTRAINT "ProfilePictureAsset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_profilePictureId_fkey"
    FOREIGN KEY ("profilePictureId") REFERENCES "ProfilePictureAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
