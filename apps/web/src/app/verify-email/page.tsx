import { Suspense } from 'react';
import { VerifyEmailForm } from '@/components/auth-forms';
import { Loading } from '@/components/ui';
export const metadata = { title: 'Verify your email', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default function Page() { return <Suspense fallback={<Loading />}><VerifyEmailForm /></Suspense>; }
