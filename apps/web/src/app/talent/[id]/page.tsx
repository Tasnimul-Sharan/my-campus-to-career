import type { Metadata } from 'next';
import { TalentProfile } from '@/components/talent-profile';

export const metadata: Metadata = { title: 'Student talent profile', description: 'Explore the education, skills and career interests this student has chosen to share.' };

export default async function TalentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TalentProfile id={id} />;
}
