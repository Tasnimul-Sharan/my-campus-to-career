-- Optional academic results; existing profiles and qualifications receive no grade.
ALTER TABLE "StudentProfile"
  ADD COLUMN "cgpa" DECIMAL(4,2),
  ADD COLUMN "cgpaScale" INTEGER NOT NULL DEFAULT 4,
  ADD CONSTRAINT "StudentProfile_cgpaScale_check" CHECK ("cgpaScale" IN (4,5)),
  ADD CONSTRAINT "StudentProfile_cgpa_check" CHECK ("cgpa" IS NULL OR ("cgpa" >= 0 AND "cgpa" <= "cgpaScale"));

ALTER TABLE "Education"
  ADD COLUMN "cgpa" DECIMAL(4,2),
  ADD COLUMN "cgpaScale" INTEGER NOT NULL DEFAULT 4,
  ADD CONSTRAINT "Education_cgpaScale_check" CHECK ("cgpaScale" IN (4,5)),
  ADD CONSTRAINT "Education_cgpa_check" CHECK ("cgpa" IS NULL OR ("cgpa" >= 0 AND "cgpa" <= "cgpaScale"));
