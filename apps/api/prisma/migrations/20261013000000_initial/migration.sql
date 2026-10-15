CREATE TYPE "Role" AS ENUM ('STUDENT', 'ADMIN');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "AuthTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

CREATE TABLE "User" (
  "id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL,
  "email" VARCHAR(254) NOT NULL, "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'STUDENT',
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE', "emailVerifiedAt" TIMESTAMP(3),
  "authVersion" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_createdAt_idx" ON "User"("role", "createdAt");

CREATE TABLE "StudentProfile" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "phone" VARCHAR(30) NOT NULL DEFAULT '',
  "city" VARCHAR(100) NOT NULL DEFAULT '', "objective" VARCHAR(1000) NOT NULL DEFAULT '',
  "university" VARCHAR(150) NOT NULL DEFAULT '', "department" VARCHAR(100) NOT NULL DEFAULT '',
  "semester" VARCHAR(30) NOT NULL DEFAULT '', "degree" VARCHAR(100) NOT NULL DEFAULT '',
  "passingYear" INTEGER, "socialLinks" JSONB NOT NULL DEFAULT '{}',
  "activities" VARCHAR(2000) NOT NULL DEFAULT '', "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "StudentProfile"("userId");

CREATE TABLE "Education" (
  "id" UUID NOT NULL, "profileId" UUID NOT NULL, "institution" VARCHAR(150) NOT NULL,
  "degree" VARCHAR(100) NOT NULL, "field" VARCHAR(100) NOT NULL DEFAULT '', "startYear" INTEGER, "endYear" INTEGER,
  CONSTRAINT "Education_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Education_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Education_profileId_idx" ON "Education"("profileId");

CREATE TABLE "Skill" (
  "id" UUID NOT NULL, "profileId" UUID NOT NULL, "name" VARCHAR(60) NOT NULL,
  CONSTRAINT "Skill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Skill_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Skill_profileId_name_key" ON "Skill"("profileId", "name");

CREATE TABLE "AuthToken" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "tokenHash" VARCHAR(64) NOT NULL,
  "type" "AuthTokenType" NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_type_idx" ON "AuthToken"("userId", "type");

CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL, "actorId" UUID NOT NULL, "action" VARCHAR(100) NOT NULL,
  "targetId" UUID NOT NULL, "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE TABLE "sessions" (
  "sid" VARCHAR NOT NULL COLLATE "default", "sess" JSON NOT NULL, "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX "sessions_expire_idx" ON "sessions"("expire");
