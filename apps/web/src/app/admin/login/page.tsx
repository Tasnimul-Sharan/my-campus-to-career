import { LoginForm } from '@/components/auth-forms';
export const metadata = { title: 'Admin login', robots: { index: false, follow: false } };
export default function Page() { return <LoginForm admin />; }
