import type { Education, SocialLinks } from './api';

export const TALENT_CATEGORIES = [
  { slug: 'software-it', label: 'Software & IT' },
  { slug: 'design-creative', label: 'Design & Creative' },
  { slug: 'marketing-sales', label: 'Marketing & Sales' },
  { slug: 'accounting-finance', label: 'Accounting & Finance' },
  { slug: 'engineering', label: 'Engineering' },
  { slug: 'content-communication', label: 'Content & Communication' },
  { slug: 'exploring', label: 'Exploring career paths' },
] as const;

export const TALENT_AVAILABILITIES = [
  { value: 'INTERNSHIP', label: 'Internship' },
  { value: 'FULL_TIME', label: 'Full-time' },
  { value: 'PART_TIME', label: 'Part-time' },
  { value: 'OPEN_TO_OPPORTUNITIES', label: 'Open to opportunities' },
] as const;

export type TalentCategory = typeof TALENT_CATEGORIES[number]['slug'];
export type TalentAvailability = typeof TALENT_AVAILABILITIES[number]['value'];

export function talentCategoryLabel(category: string | null | undefined) {
  return TALENT_CATEGORIES.find(option => option.slug === category)?.label || 'Career interest';
}

export function talentAvailabilityLabel(availability: string | null | undefined) {
  return TALENT_AVAILABILITIES.find(option => option.value === availability)?.label || 'Open to opportunities';
}

export type TalentCard = {
  id: string;
  name: string;
  headline: string;
  category: { slug: TalentCategory; name: string };
  university: string;
  department: string;
  city: string;
  skills: string[];
  availability: TalentAvailability;
  objective: string;
  profilePictureUrl: string | null;
};

export type TalentMeta = {
  categories: { slug: TalentCategory; name: string; description: string; count: number }[];
  subjects: string[];
  universities: string[];
  cities: string[];
  skills: string[];
  availabilities: { value: TalentAvailability; label: string }[];
  totalStudents: number;
};

export type TalentListing = {
  students: TalentCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type TalentDetail = {
  student: TalentCard & {
    degree: string;
    semester: string;
    passingYear: number | null;
    cgpa: number | null;
    cgpaScale: 4 | 5;
    activities: string;
    educations: Education[];
    socialLinks: SocialLinks;
  };
};
