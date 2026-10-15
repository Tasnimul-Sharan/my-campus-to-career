import { BadRequestException, Body, Controller, Get, Injectable, Patch, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Database } from './database';
import { ProfileDto } from './dto';
import { SessionGuard, StudentGuard } from './security';
import { AuthenticatedRequest, publicUser } from './session-types';

const profileInclude = { educations: true, skills: true } as const;
type FullProfile = Prisma.StudentProfileGetPayload<{ include: typeof profileInclude }>;

function serialize(profile: FullProfile) {
  return { phone: profile.phone, city: profile.city, objective: profile.objective, university: profile.university,
    department: profile.department, semester: profile.semester, degree: profile.degree, passingYear: profile.passingYear,
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
    const profile = await this.db.studentProfile.update({ where: { userId }, data: {
      ...fields,
      ...(socialLinks !== undefined ? { socialLinks: JSON.parse(JSON.stringify(socialLinks)) as Prisma.InputJsonValue } : {}),
      ...(skills !== undefined ? { skills: { deleteMany: {}, create: skills.map(name => ({ name })) } } : {}),
      ...(educations !== undefined ? { educations: { deleteMany: {}, create: educations } } : {}),
    }, include: profileInclude });
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
  @Get() async get(@Req() req: AuthenticatedRequest) { return { profile: await this.profiles.get(req.currentUser.id) }; }
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
