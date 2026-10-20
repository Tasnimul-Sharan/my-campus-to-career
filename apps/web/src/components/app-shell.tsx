'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, LayoutDashboard, UserRound, ShieldCheck, LogOut, Menu, X, Mail, FolderOpen } from 'lucide-react';
import { api, ApiError, errorMessage, type User } from '@/lib/api';
import { clearVerificationDelivery, readVerificationDelivery, rememberVerificationDelivery, type VerificationDelivery } from '@/lib/verification-delivery';
import { Brand, Loading, Notice } from './ui';
import { UserAvatar } from './user-avatar';

export function useUser(admin = false) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    api<{ user: User }>('/auth/me').then(({ user: current }) => {
      if (cancelled) return;
      if (admin && current.role !== 'ADMIN') { router.replace('/dashboard'); return; }
      if (!admin && current.role === 'ADMIN') { router.replace('/admin'); return; }
      setUser(current);
    }).catch((err: unknown) => {
      if (cancelled) return;
      if (err instanceof ApiError && err.status === 401) router.replace(admin ? '/admin/login' : '/login'); else setError(errorMessage(err));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [admin, router, reload]);
  const updateUser = useCallback((next: User) => setUser((current) => current?.id === next.id ? next : current), []);
  return { user, loading, error, retry: () => setReload((value) => value + 1), updateUser };
}
export function VerificationBanner({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false); const [result, setResult] = useState(''); const [failed, setFailed] = useState(false);
  const [delivery, setDelivery] = useState<VerificationDelivery>('unknown');
  useEffect(() => { setDelivery(readVerificationDelivery(userId)); }, [userId]);
  async function resend() {
    setBusy(true); setResult(''); setFailed(false);
    try {
      const response = await api<{ message: string }>('/auth/resend-verification', { method: 'POST', body: '{}' });
      clearVerificationDelivery();
      if (response.message === 'Your email is already verified.') {
        setDelivery('unknown'); setResult('Your email is already verified. Refresh this page to update your account.');
      } else {
        setDelivery('sent'); setResult('Verification email sent. Please check your inbox and spam folder.');
      }
    } catch (error) {
      rememberVerificationDelivery(userId, 'failed');
      setDelivery('failed'); setFailed(true); setResult(errorMessage(error));
    } finally { setBusy(false); }
  }
  return <div className="verification-banner"><Mail size={21} /><div><strong>{delivery === 'failed' ? 'Verification email was not sent' : 'Verify your email'}</strong><p role={delivery === 'failed' ? 'alert' : undefined}>{delivery === 'failed' ? 'Your account is ready, but we could not send the verification email. Use Resend link to try again.' : delivery === 'sent' ? 'A verification email was sent. Check your inbox and spam folder for the link.' : 'Confirm your email address to finish setting up your account. Use Resend link if you need a verification email.'}</p>{result && <p role={failed ? 'alert' : 'status'}>{result}</p>}</div><button onClick={resend} className="button button-small button-outline" disabled={busy}>{busy ? 'Sending…' : 'Resend link'}</button></div>;
}
export function AppShell({ user, children, admin = false }: { user: User; children: ReactNode; admin?: boolean }) {
  const pathname = usePathname(); const router = useRouter(); const [menuOpen, setMenuOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function logout() { setBusy(true); setError(''); try { await api('/auth/logout', { method: 'POST', body: '{}' }); clearVerificationDelivery(); router.replace('/login'); router.refresh(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }
  const links = admin ? [{ href: '/admin', label: 'Admin dashboard', icon: ShieldCheck }, { href: '/admin/documents', label: 'Student documents', icon: FolderOpen }] : [{ href: '/dashboard', label: 'My dashboard', icon: LayoutDashboard }, { href: '/profile', label: 'My profile', icon: UserRound }, { href: '/documents', label: 'My documents', icon: FolderOpen }];
  return <div className="app-page"><header className="mobile-app-header"><Brand /><button className="icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>{menuOpen ? <X /> : <Menu />}</button></header><aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}><Brand /><div className="workspace-label">{admin ? 'ADMIN WORKSPACE' : 'STUDENT WORKSPACE'}</div><nav aria-label="Dashboard navigation">{links.map(({ href, label, icon: Icon }) => <Link key={href} onClick={() => setMenuOpen(false)} href={href} className={`sidebar-link ${pathname === href ? 'active' : ''}`} aria-current={pathname === href ? 'page' : undefined}><Icon size={20} /><span>{label}</span>{pathname === href && <span className="active-dot" />}</Link>)}</nav><div className="sidebar-note"><span className="eyebrow">ONE STEP AT A TIME</span><p>The first step<br /><strong>is yours.</strong></p><ArrowUpRight size={28} /></div><div className="sidebar-user"><UserAvatar user={user} /><div><strong>{user.name}</strong><span>{admin ? 'Administrator' : 'Student account'}</span></div></div><button className="logout-button" onClick={logout} disabled={busy}><LogOut size={18} />{busy ? 'Signing out…' : 'Sign out'}</button>{error && <p role="alert" className="sidebar-error">{error}</p>}</aside>{menuOpen && <button className="menu-overlay" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}<main className="workspace" id="main-content"><div className="workspace-top"><span>{admin ? 'Manage your campus community' : 'Your campus. Your next chapter.'}</span><Link href="/" className="text-link">Website <ArrowUpRight size={16} /></Link></div>{!user.emailVerified && <VerificationBanner userId={user.id} />}{children}</main></div>;
}
export function SessionState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) { if (loading) return <Loading text="Loading your account…" />; return <div className="session-error"><Notice>{error || 'Checking your account…'}</Notice>{error && <button className="button button-primary" onClick={retry}>Try again</button>}</div>; }
