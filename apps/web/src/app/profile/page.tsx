import { ProfileEditor } from '@/components/profile-editor';
export const metadata = { title: 'My profile', robots: { index: false, follow: false } };
export default function Page() { return <ProfileEditor />; }
