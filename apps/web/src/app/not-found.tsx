import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';
import { Brand } from '@/components/ui';
export default function NotFound() { return <main className="not-found" id="main-content"><Brand /><Compass size={60} strokeWidth={1.2} /><span className="eyebrow">404 · PAGE NOT FOUND</span><h1>We couldn&apos;t find this page</h1><p>The link may have changed. Head back home to find your way.</p><Link href="/" className="button button-primary"><ArrowLeft size={18} /> Back to home</Link></main>; }
