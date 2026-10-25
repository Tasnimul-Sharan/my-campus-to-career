-- Publishing is an explicit opt-in. Existing profiles remain private.
CREATE TYPE "TalentAvailability" AS ENUM ('INTERNSHIP', 'FULL_TIME', 'PART_TIME', 'OPEN_TO_OPPORTUNITIES');

ALTER TABLE "StudentProfile"
  ADD COLUMN "headline" VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN "talentCategory" VARCHAR(60) NOT NULL DEFAULT '',
  ADD COLUMN "availability" "TalentAvailability" NOT NULL DEFAULT 'OPEN_TO_OPPORTUNITIES',
  ADD COLUMN "directoryPublished" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_talentCategory_check"
  CHECK ("talentCategory" IN ('', 'software-it', 'design-creative', 'marketing-sales', 'accounting-finance', 'engineering', 'content-communication', 'exploring'));

CREATE INDEX "StudentProfile_directoryPublished_talentCategory_idx" ON "StudentProfile"("directoryPublished", "talentCategory");
CREATE INDEX "StudentProfile_directoryPublished_updatedAt_idx" ON "StudentProfile"("directoryPublished", "updatedAt");
