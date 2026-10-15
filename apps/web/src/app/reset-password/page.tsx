import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/auth-forms';
import { Loading } from '@/components/ui';
export const metadata = { title: 'Reset your password', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default function Page() { return <Suspense fallback={<Loading />}><ResetPasswordForm /></Suspense>; }
