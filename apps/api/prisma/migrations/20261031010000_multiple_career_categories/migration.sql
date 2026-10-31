-- Keep the first legacy category while enabling up to three career interests.
ALTER TABLE "StudentProfile"
  ADD COLUMN "talentCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "StudentProfile"
SET "talentCategories" = ARRAY["talentCategory"]
WHERE "talentCategory" IN ('software-it', 'design-creative', 'marketing-sales', 'accounting-finance', 'engineering', 'content-communication', 'exploring');

-- Empty arrays remain valid for new accounts until the first profile save.
ALTER TABLE "StudentProfile"
  ADD CONSTRAINT "StudentProfile_talentCategories_check" CHECK (
    cardinality("talentCategories") BETWEEN 0 AND 3
    AND COALESCE(array_ndims("talentCategories"), 1) = 1
    AND (cardinality("talentCategories") = 0 OR array_lower("talentCategories", 1) = 1)
    AND array_position("talentCategories", NULL) IS NULL
    AND "talentCategories" <@ ARRAY['software-it', 'design-creative', 'marketing-sales', 'accounting-finance', 'engineering', 'content-communication', 'exploring']::TEXT[]
    AND (cardinality("talentCategories") < 2 OR "talentCategories"[1] <> "talentCategories"[2])
    AND (cardinality("talentCategories") < 3 OR ("talentCategories"[1] <> "talentCategories"[3] AND "talentCategories"[2] <> "talentCategories"[3]))
  );

CREATE INDEX "StudentProfile_talentCategories_idx" ON "StudentProfile" USING GIN ("talentCategories");
