-- Optional family details belong only to the student's private profile.
-- Existing accounts receive an empty object and require no new information.
ALTER TABLE "StudentProfile"
  ADD COLUMN "familyBackground" JSONB NOT NULL DEFAULT '{}';
