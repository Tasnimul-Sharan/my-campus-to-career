CREATE TYPE "DocumentCategory" AS ENUM ('CV', 'CERTIFICATE', 'PROJECT');
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADING', 'READY', 'DELETING');

CREATE TABLE "StudentDocument" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "originalFilename" VARCHAR(255) NOT NULL,
    "cloudinaryPublicId" VARCHAR(255) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudentDocument_sizeBytes_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 4194304)
);

CREATE UNIQUE INDEX "StudentDocument_cloudinaryPublicId_key" ON "StudentDocument"("cloudinaryPublicId");
CREATE INDEX "StudentDocument_userId_createdAt_idx" ON "StudentDocument"("userId", "createdAt");
CREATE INDEX "StudentDocument_createdAt_idx" ON "StudentDocument"("createdAt");
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
