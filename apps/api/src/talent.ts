import { Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Database } from './database';
import { TalentQueryDto } from './dto';
import { config } from './config';
import { normalizeSocialLinks } from './profile';
import { TALENT_AVAILABILITIES, TALENT_CATEGORIES, TALENT_CATEGORY_SLUGS } from './talent-categories';

export const TALENT_PAGE_SIZE = 9;
const FILTER_OPTION_LIMIT = 100;

/** Reuse this eligibility rule for every public view, facet and public avatar. */
export function publicTalentWhere(): Prisma.StudentProfileWhereInput {
  return {
    directoryPublished: true,
    talentCategory: { in: [...TALENT_CATEGORY_SLUGS] },
    university: { not: '' }, department: { not: '' }, objective: { not: '' }, skills: { some: {} },
    user: { is: { role: 'STUDENT', status: 'ACTIVE', emailVerifiedAt: { not: null } } },
  };
}

// PostgreSQL LIKE treats these characters as patterns. Search uses literal text.
const literalSearch = (value: string) => value.replace(/[\\%_]/g, '\\$&');

export function talentSearchWhere(query: TalentQueryDto): Prisma.StudentProfileWhereInput {
  const and: Prisma.StudentProfileWhereInput[] = [publicTalentWhere()];
  if (query.category) and.push({ talentCategory: query.category });
  if (query.subject) and.push({ department: { equals: query.subject, mode: 'insensitive' } });
  if (query.university) and.push({ university: { equals: query.university, mode: 'insensitive' } });
  if (query.city) and.push({ city: { equals: query.city, mode: 'insensitive' } });
  if (query.skill) and.push({ skills: { some: { name: { equals: query.skill, mode: 'insensitive' } } } });
  if (query.availability) and.push({ availability: query.availability });
  if (query.q) {
    const contains = { contains: literalSearch(query.q), mode: 'insensitive' as const };
    and.push({ OR: [
      { user: { is: { name: contains } } }, { headline: contains }, { objective: contains },
      { university: contains }, { department: contains }, { city: contains },
      { skills: { some: { name: contains } } },
    ] });
  }
  return { AND: and };
}

const cardSelect = {
  headline: true, talentCategory: true, university: true, department: true, city: true,
  availability: true, objective: true,
  skills: { select: { name: true }, orderBy: { name: 'asc' }, take: 20 },
  user: { select: { id: true, name: true, profilePictureId: true,
    profilePicture: { select: { id: true, userId: true, status: true } } } },
} satisfies Prisma.StudentProfileSelect;

const detailSelect = {
  ...cardSelect, degree: true, semester: true, passingYear: true, cgpa: true, cgpaScale: true, activities: true, socialLinks: true,
  educations: { select: { institution: true, degree: true, field: true, startYear: true, endYear: true, cgpa: true, cgpaScale: true }, orderBy: { id: 'asc' }, take: 10 },
} satisfies Prisma.StudentProfileSelect;

type PublicCardProfile = Prisma.StudentProfileGetPayload<{ select: typeof cardSelect }>;
type PublicDetailProfile = Prisma.StudentProfileGetPayload<{ select: typeof detailSelect }>;

export function safePublicLinks(value: Prisma.JsonValue) {
  const normalized = normalizeSocialLinks(value);
  const result: ReturnType<typeof normalizeSocialLinks> = {};
  for (const key of ['linkedin', 'github', 'portfolio'] as const) {
    if (normalized[key]) result[key] = normalized[key];
  }
  if (normalized.additional?.length) result.additional = normalized.additional.map(({ label, url }) => ({ label, url }));
  return result;
}

function publicGrade(value: Prisma.Decimal | null | undefined, scale: number | undefined) {
  const cgpaScale = scale === 5 ? 5 : 4;
  const grade = value == null ? null : Number(value);
  return { cgpa: grade !== null && Number.isFinite(grade) && grade >= 0 && grade <= cgpaScale ? grade : null, cgpaScale };
}

function publicCard(profile: PublicCardProfile) {
  const category = TALENT_CATEGORIES.find(item => item.slug === profile.talentCategory)!;
  const picture = profile.user.profilePicture;
  const hasPicture = !!config.documents && picture?.status === 'READY' && picture.id === profile.user.profilePictureId && picture.userId === profile.user.id;
  return {
    id: profile.user.id, name: profile.user.name, headline: profile.headline,
    category: { slug: category.slug, name: category.name }, university: profile.university,
    department: profile.department, city: profile.city, skills: profile.skills.map(skill => skill.name),
    availability: profile.availability,
    objective: profile.objective.length > 180 ? `${profile.objective.slice(0, 177)}...` : profile.objective,
    profilePictureUrl: hasPicture ? `/api/v1/talent/${profile.user.id}/picture?v=${picture!.id}` : null,
  };
}

function publicDetail(profile: PublicDetailProfile) {
  return { ...publicCard(profile), degree: profile.degree, semester: profile.semester, passingYear: profile.passingYear,
    ...publicGrade(profile.cgpa, profile.cgpaScale),
    objective: profile.objective, activities: profile.activities,
    educations: profile.educations.map(education => ({ ...education, ...publicGrade(education.cgpa, education.cgpaScale) })),
    socialLinks: safePublicLinks(profile.socialLinks) };
}

function stableOptions(values: string[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const normalized = value.trim().toLocaleLowerCase('en');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b, 'en')).slice(0, FILTER_OPTION_LIMIT);
}

@Injectable()
export class TalentService {
  constructor(private readonly db: Database) {}
  async meta() {
    const where = publicTalentWhere();
    const [groups, subjects, universities, cities, skills] = await Promise.all([
      this.db.studentProfile.groupBy({ by: ['talentCategory'], where, _count: { _all: true } }),
      this.db.studentProfile.findMany({ where, select: { department: true }, distinct: ['department'], orderBy: { department: 'asc' }, take: FILTER_OPTION_LIMIT }),
      this.db.studentProfile.findMany({ where, select: { university: true }, distinct: ['university'], orderBy: { university: 'asc' }, take: FILTER_OPTION_LIMIT }),
      this.db.studentProfile.findMany({ where: { AND: [where, { city: { not: '' } }] }, select: { city: true }, distinct: ['city'], orderBy: { city: 'asc' }, take: FILTER_OPTION_LIMIT }),
      this.db.skill.findMany({ where: { profile: { is: where } }, select: { name: true }, distinct: ['name'], orderBy: { name: 'asc' }, take: FILTER_OPTION_LIMIT }),
    ]);
    const counts = new Map(groups.map(group => [group.talentCategory, group._count._all]));
    return {
      categories: TALENT_CATEGORIES.map(category => ({ ...category, count: counts.get(category.slug) || 0 })),
      subjects: stableOptions(subjects.map(row => row.department)),
      universities: stableOptions(universities.map(row => row.university)),
      cities: stableOptions(cities.map(row => row.city)), skills: stableOptions(skills.map(row => row.name)),
      availabilities: TALENT_AVAILABILITIES, totalStudents: groups.reduce((sum, group) => sum + group._count._all, 0),
    };
  }
  async list(query: TalentQueryDto) {
    const page = query.page || 1, where = talentSearchWhere(query);
    const [profiles, total] = await this.db.$transaction([
      this.db.studentProfile.findMany({ where, select: cardSelect, orderBy: [{ updatedAt: 'desc' }, { userId: 'asc' }], skip: (page - 1) * TALENT_PAGE_SIZE, take: TALENT_PAGE_SIZE }),
      this.db.studentProfile.count({ where }),
    ]);
    return { students: profiles.map(publicCard), total, page, pageSize: TALENT_PAGE_SIZE, totalPages: Math.ceil(total / TALENT_PAGE_SIZE) };
  }
  async detail(userId: string) {
    const profile = await this.db.studentProfile.findFirst({ where: { AND: [publicTalentWhere(), { userId }] }, select: detailSelect });
    if (!profile) throw new NotFoundException('This student profile is not available.');
    return { student: publicDetail(profile) };
  }
}

@Controller('talent')
export class TalentController {
  constructor(private readonly talent: TalentService) {}
  @Get('meta') meta() { return this.talent.meta(); }
  @Get() list(@Query() query: TalentQueryDto) { return this.talent.list(query); }
  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string) { return this.talent.detail(id); }
}
