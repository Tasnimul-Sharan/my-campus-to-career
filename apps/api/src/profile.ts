import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Patch, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Database } from './database';
import { ProfileDto } from './dto';
import { SessionGuard, StudentGuard } from './security';
import { AuthenticatedRequest, publicUser } from './session-types';
import { config } from './config';
import { TALENT_CATEGORY_SLUGS } from './talent-categories';
import { mergeAddresses, normalizeAddresses } from './addresses';

const profileInclude = { educations: true, skills: true } as const;
type FullProfile = Prisma.StudentProfileGetPayload<{ include: typeof profileInclude }>;

export type FamilyBackground = {
  fatherName: string;
  fatherOccupation: string;
  motherName: string;
  motherOccupation: string;
  guardianName: string;
  guardianRelationship: string;
  religion: string;
  siblings: number | null;
  additionalInformation: string;
};

export function normalizeFamilyBackground(value: unknown): FamilyBackground {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (key: string) => { const candidate = source[key]; return typeof candidate === 'string' ? candidate : ''; };
  return {
    fatherName: text('fatherName'), fatherOccupation: text('fatherOccupation'),
    motherName: text('motherName'), motherOccupation: text('motherOccupation'),
    guardianName: text('guardianName'), guardianRelationship: text('guardianRelationship'),
    religion: text('religion'),
    siblings: typeof source.siblings === 'number' && Number.isInteger(source.siblings) && source.siblings >= 0 && source.siblings <= 50 ? source.siblings : null,
    additionalInformation: text('additionalInformation'),
  };
}

export type SocialLinks = {
  linkedin?: string;
  github?: string;
  portfolio?: string;
  additional?: { label: string; url: string }[];
};

export function safeSocialUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim();
  if (!candidate || candidate.length > 500 || /[\x00-\x20\x7f]/.test(candidate)) return undefined;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? candidate : undefined;
  } catch { return undefined; }
}

export function normalizeSocialLinks(value: unknown): SocialLinks {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result: SocialLinks = {};
  for (const key of ['linkedin', 'github', 'portfolio'] as const) {
    const url = safeSocialUrl(source[key]);
    if (url) result[key] = url;
  }
  const additional = Array.isArray(source.additional) ? source.additional.slice(0, 8).flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const url = safeSocialUrl(item.url);
    return label && label.length <= 40 && url ? [{ label, url }] : [];
  }) : [];
  if (additional.length) result.additional = additional;
  return result;
}

function assertCgpa(cgpa: unknown, scale: number, label: string) {
  const value = cgpa == null ? null : Number(cgpa);
  if (![4, 5].includes(scale) || value !== null && (!Number.isFinite(value) || value < 0 || value > scale)) {
    throw new BadRequestException(label + ' CGPA must be between 0 and the selected grading scale.');
  }
}

function isTalentCategory(value: unknown): value is typeof TALENT_CATEGORY_SLUGS[number] {
  return TALENT_CATEGORY_SLUGS.some(slug => slug === value);
}

export function normalizeTalentCategories(value: unknown, legacy?: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return isTalentCategory(legacy) ? [legacy] : [];
  return [...new Set(value.filter(isTalentCategory))].slice(0, 3);
}

function assertTalentCategories(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 || new Set(value).size !== value.length || !value.every(isTalentCategory)) {
    throw new BadRequestException('Choose between 1 and 3 different career categories.');
  }
}

function serialize(profile: FullProfile) {
  const talentCategories = normalizeTalentCategories(profile.talentCategories, profile.talentCategory);
  return { phone: profile.phone, city: profile.city, objective: profile.objective, university: profile.university,
    department: profile.department, semester: profile.semester, degree: profile.degree, passingYear: profile.passingYear,
    cgpa: profile.cgpa == null ? null : Number(profile.cgpa), cgpaScale: profile.cgpaScale ?? 4,
    headline: profile.headline, talentCategory: talentCategories[0] ?? '', talentCategories, availability: profile.availability, directoryPublished: profile.directoryPublished,
    socialLinks: normalizeSocialLinks(profile.socialLinks), familyBackground: normalizeFamilyBackground(profile.familyBackground), addresses: normalizeAddresses(profile.addresses),
    activities: profile.activities, skills: profile.skills.map(skill => skill.name),
    educations: profile.educations.map(({ institution, degree, field, startYear, endYear, cgpa, cgpaScale }) => ({ institution, degree, field, startYear, endYear, cgpa: cgpa == null ? null : Number(cgpa), cgpaScale: cgpaScale ?? 4 })) };
}
@Injectable()
export class ProfileService {
  constructor(private readonly db: Database) {}
  async get(userId: string) {
    const profile = await this.db.studentProfile.upsert({ where: { userId }, update: {}, create: { userId }, include: profileInclude });
    return serialize(profile);
  }
  async update(userId: string, dto: ProfileDto) {
    if (dto.educations?.some(e => e.startYear && e.endYear && e.endYear < e.startYear)) throw new BadRequestException('Education end year must not be earlier than its start year.');
    const { skills, educations, socialLinks, familyBackground, addresses, talentCategory, talentCategories, ...fields } = dto;
    if (talentCategories !== undefined) assertTalentCategories(talentCategories);
    if (talentCategory !== undefined && !isTalentCategory(talentCategory)) throw new BadRequestException('Choose a valid career category.');
    for (const entry of educations ?? []) assertCgpa(entry.cgpa, entry.cgpaScale ?? 4, 'Qualification');
    // Transformed DTOs contain declared optional properties with undefined values.
    // They must not erase current values while checking a partial update.
    const changedFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as typeof fields;
    const profile = await this.db.$transaction(async tx => {
      // Serialize edits of the same profile so a concurrent edit cannot remove a
      // required field after another request has validated and published it.
      await tx.$queryRaw`SELECT "id" FROM "StudentProfile" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
      const current = await tx.studentProfile.findUnique({ where: { userId }, include: { ...profileInclude, user: { select: { role: true, status: true, emailVerifiedAt: true } } } });
      if (!current) throw new NotFoundException('Student profile not found.');
      const currentCategories = normalizeTalentCategories(current.talentCategories, current.talentCategory);
      const nextCategories = talentCategories !== undefined ? [...talentCategories] : talentCategory !== undefined ? [talentCategory] : currentCategories;
      const categoriesChanged = talentCategories !== undefined || talentCategory !== undefined;
      assertCgpa(changedFields.cgpa !== undefined ? changedFields.cgpa : current.cgpa, changedFields.cgpaScale ?? current.cgpaScale ?? 4, 'Profile');
      const providedSocial = socialLinks === undefined ? undefined : Object.fromEntries(
        Object.entries(socialLinks).filter(([key, value]) => ['linkedin', 'github', 'portfolio', 'additional'].includes(key) && value !== undefined),
      );
      const nextSocial = providedSocial === undefined ? undefined : normalizeSocialLinks({ ...normalizeSocialLinks(current.socialLinks), ...providedSocial });
      const currentFamily = normalizeFamilyBackground(current.familyBackground);
      const providedFamily = familyBackground === undefined ? undefined : Object.fromEntries(
        Object.entries(familyBackground).filter(([key, value]) => Object.hasOwn(currentFamily, key) && value !== undefined),
      );
      const nextFamily = providedFamily === undefined ? undefined : normalizeFamilyBackground({ ...currentFamily, ...providedFamily });
      const nextAddresses = addresses === undefined ? undefined : mergeAddresses(current.addresses, addresses);
      const next = { ...current, ...changedFields, talentCategories: nextCategories, talentCategory: nextCategories[0] ?? '', skills: skills ?? current.skills.map(skill => skill.name) };
      if (next.directoryPublished) {
        if (current.user.role !== 'STUDENT' || current.user.status !== 'ACTIVE' || !current.user.emailVerifiedAt) {
          throw new ForbiddenException('Verify your email before publishing an active student profile.');
        }
        const missing = [
          !next.university.trim() && 'university', !next.department.trim() && 'subject or department',
          !next.objective.trim() && 'career objective', !next.skills.length && 'at least one skill',
          !next.talentCategories.length && 'at least one career category',
        ].filter(Boolean);
        if (missing.length) throw new BadRequestException(`Complete your ${missing.join(', ')} before publishing. Unpublish your profile to save an incomplete draft.`);
      }
      return tx.studentProfile.update({ where: { userId }, data: {
        ...changedFields,
        ...(categoriesChanged ? { talentCategories: nextCategories, talentCategory: nextCategories[0] } : {}),
        ...(nextFamily !== undefined ? { familyBackground: JSON.parse(JSON.stringify(nextFamily)) as Prisma.InputJsonValue } : {}),
        ...(nextAddresses !== undefined ? { addresses: JSON.parse(JSON.stringify(nextAddresses)) as Prisma.InputJsonValue } : {}),
        ...(nextSocial !== undefined ? { socialLinks: JSON.parse(JSON.stringify(nextSocial)) as Prisma.InputJsonValue } : {}),
        ...(skills !== undefined ? { skills: { deleteMany: {}, create: skills.map(name => ({ name })) } } : {}),
        ...(educations !== undefined ? { educations: { deleteMany: {}, create: educations.map(entry => ({ ...entry, cgpa: entry.cgpa ?? null, cgpaScale: entry.cgpaScale ?? 4 })) } } : {}),
      }, include: profileInclude });
    });
    return serialize(profile);
  }
  completion(profile: Awaited<ReturnType<ProfileService['get']>>) {
    const checks = [profile.phone, profile.city, profile.objective, profile.university, profile.department, profile.semester,
      profile.degree, profile.passingYear, profile.skills.length, Object.keys(profile.socialLinks as object).length,
      profile.activities, profile.educations.length];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }
}
@Controller('profile')
@UseGuards(SessionGuard, StudentGuard)
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}
  @Get() async get(@Req() req: AuthenticatedRequest) { return { profile: await this.profiles.get(req.currentUser.id), profilePictureAvailable: !!config.documents }; }
  @Patch() async update(@Req() req: AuthenticatedRequest, @Body() dto: ProfileDto) { return { profile: await this.profiles.update(req.currentUser.id, dto) }; }
}
@Controller('dashboard')
@UseGuards(SessionGuard, StudentGuard)
export class DashboardController {
  constructor(private readonly profiles: ProfileService) {}
  @Get() async get(@Req() req: AuthenticatedRequest) {
    const profile = await this.profiles.get(req.currentUser.id);
    return { user: publicUser(req.currentUser), stats: { profileCompletion: this.profiles.completion(profile) } };
  }
}
