-- Private, optional permanent and current address details for student profiles.
ALTER TABLE "StudentProfile" ADD COLUMN "addresses" JSONB NOT NULL DEFAULT '{}';
