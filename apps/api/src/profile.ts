import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Patch, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Database } from './database';
import { ProfileDto } from './dto';
import { SessionGuard, StudentGuard } from './security';
import { AuthenticatedRequest, publicUser } from './session-types';
import { config } from './config';
import { TALENT_CATEGORY_SLUGS } from './talent-categories';

const profileInclude = { educations: true, skills: true } as const;
type FullProfile = Prisma.StudentProfileGetPayload<{ include: typeof profileInclude }>;

function serialize(profile: FullProfile) {
  return { phone: profile.phone, city: profile.city, objective: profile.objective, university: profile.university,
    department: profile.department, semester: profile.semester, degree: profile.degree, passingYear: profile.passingYear,
    headline: profile.headline, talentCategory: profile.talentCategory, availability: profile.availability, directoryPublished: profile.directoryPublished,
    socialLinks: profile.socialLinks, activities: profile.activities, skills: profile.skills.map(skill => skill.name),
    educations: profile.educations.map(({ institution, degree, field, startYear, endYear }) => ({ institution, degree, field, startYear, endYear })) };
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
    const { skills, educations, socialLinks, ...fields } = dto;
    // Transformed DTOs contain declared optional properties with undefined values.
    // They must not erase current values while checking a partial update.
    const changedFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as typeof fields;
    const profile = await this.db.$transaction(async tx => {
      // Serialize edits of the same profile so a concurrent edit cannot remove a
      // required field after another request has validated and published it.
      await tx.$queryRaw`SELECT "id" FROM "StudentProfile" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
      const current = await tx.studentProfile.findUnique({ where: { userId }, include: { ...profileInclude, user: { select: { role: true, status: true, emailVerifiedAt: true } } } });
      if (!current) throw new NotFoundException('Student profile not found.');
      const next = { ...current, ...changedFields, skills: skills ?? current.skills.map(skill => skill.name) };
      if (next.directoryPublished) {
        if (current.user.role !== 'STUDENT' || current.user.status !== 'ACTIVE' || !current.user.emailVerifiedAt) {
          throw new ForbiddenException('Verify your email before publishing an active student profile.');
        }
        const missing = [
          !next.university.trim() && 'university', !next.department.trim() && 'subject or department',
          !next.objective.trim() && 'career objective', !next.skills.length && 'at least one skill',
          !TALENT_CATEGORY_SLUGS.some(slug => slug === next.talentCategory) && 'career category',
        ].filter(Boolean);
        if (missing.length) throw new BadRequestException(`Complete your ${missing.join(', ')} before publishing. Unpublish your profile to save an incomplete draft.`);
      }
      return tx.studentProfile.update({ where: { userId }, data: {
        ...changedFields,
        ...(socialLinks !== undefined ? { socialLinks: JSON.parse(JSON.stringify(socialLinks)) as Prisma.InputJsonValue } : {}),
        ...(skills !== undefined ? { skills: { deleteMany: {}, create: skills.map(name => ({ name })) } } : {}),
        ...(educations !== undefined ? { educations: { deleteMany: {}, create: educations } } : {}),
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
