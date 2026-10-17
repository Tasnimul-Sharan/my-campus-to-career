'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Mail, ShieldCheck } from 'lucide-react';
import { api, errorMessage, type User } from '@/lib/api';
import { registrationDelivery, rememberVerificationDelivery, type VerificationDelivery } from '@/lib/verification-delivery';
import { AuthFrame, Field, Notice, PasswordInput, SubmitButton } from './ui';

export function RegisterForm() {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [registered, setRegistered] = useState(false);
  const [delivery, setDelivery] = useState<VerificationDelivery>('unknown');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget); setError('');
    if (values.get('password') !== values.get('confirmPassword')) { setError('Passwords must match.'); return; }
    setBusy(true);
    try {
      const response = await api<{ user: User; message?: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ name: String(values.get('name')).trim(), email: String(values.get('email')).trim().toLowerCase(), password: values.get('password') }) });
      const status = registrationDelivery(response.message);
      setDelivery(status);
      const remembered = rememberVerificationDelivery(response.user.id, status);
      if (status === 'failed' && !remembered) { setRegistered(true); return; }
      try { await api('/auth/me'); router.replace('/dashboard'); } catch { setRegistered(true); }
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <AuthFrame eyebrow="YOUR FIRST STEP" title="Start your journey" description="Create an account to bring your education, skills, and experience together.">
    {registered ? <div className="auth-success"><CheckCircle2 size={42} /><h2>Your account has been created</h2>{delivery === 'failed' ? <Notice>We could not send your verification email. Sign in and use Resend link on your dashboard to try again.</Notice> : <p>{delivery === 'sent' ? 'A verification email was sent. Check your inbox and spam folder, or sign in to request a new link.' : 'Sign in to your dashboard to request a verification email.'}</p>}<Link className="button button-primary" href="/login">Sign in <ArrowRight size={18} /></Link></div> : <form onSubmit={submit} className="auth-form">
      {error && <Notice>{error}</Notice>}
      <Field id="name" label="Full name"><input id="name" name="name" autoComplete="name" placeholder="Your full name" required minLength={2} maxLength={100} /></Field>
      <Field id="email" label="Email address"><input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></Field>
      <Field id="password" label="Password" help="Use a strong password with 10–128 characters."><PasswordInput id="password" name="password" autoComplete="new-password" placeholder="Create a strong password" required minLength={10} maxLength={128} /></Field>
      <Field id="confirmPassword" label="Confirm password"><PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" placeholder="Re-enter your password" required minLength={10} maxLength={128} /></Field>
      <SubmitButton busy={busy}>{busy ? 'Creating account…' : 'Create account'}{!busy && <ArrowRight size={18} />}</SubmitButton>
      <p className="form-footnote">You can manage your profile information from your account.</p>
      <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
    </form>}
  </AuthFrame>;
}

export function LoginForm({ admin = false }: { admin?: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      const { user } = await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email: String(values.get('email')).trim().toLowerCase(), password: values.get('password') }) });
      if (admin && user?.role !== 'ADMIN') { setError('This account does not have admin access. Please use the student dashboard.'); return; }
      router.replace(admin || user?.role === 'ADMIN' ? '/admin' : '/dashboard'); router.refresh();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <AuthFrame eyebrow={admin ? 'ADMIN WORKSPACE' : 'WELCOME BACK'} title={admin ? 'Admin sign in' : 'Welcome back'} description={admin ? 'Sign in with your authorized admin account to manage your campus community.' : 'Sign in to take the next step in your career journey.'}>
    {admin && <div className="admin-access-note"><ShieldCheck size={19} />For authorized administrators only</div>}
    <form onSubmit={submit} className="auth-form">{error && <Notice>{error}</Notice>}
      <Field id="email" label="Email address"><input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></Field>
      <Field id="password" label="Password"><PasswordInput id="password" name="password" autoComplete="current-password" placeholder="Your password" required maxLength={128} /></Field>
      <Link className="forgot-link" href="/forgot-password">Forgot password?</Link>
      <SubmitButton busy={busy}>{busy ? 'Signing in…' : 'Sign in'}{!busy && <ArrowRight size={18} />}</SubmitButton>
      <p className="auth-switch">{admin ? <>Signing in as a student? <Link href="/login">Student sign in</Link></> : <>New here? <Link href="/register">Create account</Link></>}</p>
      {admin && error && <Link className="text-link" href="/dashboard">Student dashboard <ArrowRight size={16} /></Link>}
    </form>
  </AuthFrame>;
}

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(true); setError(''); try { await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: String(values.get('email')).trim().toLowerCase() }) }); setSent(true); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }
  return <AuthFrame eyebrow="ACCOUNT RECOVERY" title="Reset your password" description="Enter your account email address to request a password reset link.">
    {sent ? <div className="auth-success"><Mail size={42} /><h2>Check your inbox</h2><p>If an account exists with this email address, we have sent a reset link. Please check your spam folder too.</p><Link href="/login" className="button button-primary">Back to sign in</Link></div> : <form className="auth-form" onSubmit={submit}>{error && <Notice>{error}</Notice>}<Field id="email" label="Email address"><input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></Field><SubmitButton busy={busy}>{busy ? 'Sending…' : 'Send reset link'}<ArrowRight size={18} /></SubmitButton><p className="auth-switch"><Link href="/login">Back to sign in</Link></p></form>}
  </AuthFrame>;
}

export function ResetPasswordForm() {
  const params = useSearchParams(); const token = params.get('token'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const values = new FormData(event.currentTarget); setError(''); if (values.get('password') !== values.get('confirmPassword')) { setError('Passwords must match.'); return; } setBusy(true); try { await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password: values.get('password') }) }); setDone(true); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }
  return <AuthFrame eyebrow="A FRESH START" title="Choose a new password" description="Create a new, strong password for your account.">
    {!token ? <><Notice>This reset link is incomplete. Request a new link and try again.</Notice><Link href="/forgot-password" className="button button-primary">Request a new link</Link></> : done ? <div className="auth-success"><CheckCircle2 size={42} /><h2>Password updated</h2><p>Sign in with your new password.</p><Link href="/login" className="button button-primary">Sign in</Link></div> : <form onSubmit={submit} className="auth-form">{error && <Notice>{error}</Notice>}<Field id="password" label="New password" help="Use a strong password with 10–128 characters."><PasswordInput id="password" name="password" autoComplete="new-password" required minLength={10} maxLength={128} /></Field><Field id="confirmPassword" label="Confirm password"><PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required minLength={10} maxLength={128} /></Field><SubmitButton busy={busy}>{busy ? 'Saving…' : 'Save new password'}</SubmitButton><p className="auth-switch"><Link href="/forgot-password">Link expired? Request a new one</Link></p></form>}
  </AuthFrame>;
}

export function VerifyEmailForm() {
  const params = useSearchParams(); const token = params.get('token'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState(false);
  async function verify() { setBusy(true); setError(''); try { await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }); setDone(true); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }
  return <AuthFrame eyebrow="VERIFY YOUR EMAIL" title="Verify your email" description="Confirm your email address to complete your account setup.">
    {!token ? <><Notice>This verification link is incomplete. Sign in to request a new link from your dashboard.</Notice><Link href="/login" className="button button-primary">Sign in</Link></> : done ? <div className="auth-success"><CheckCircle2 size={42} /><h2>Email verified</h2><p>Your email address has been verified successfully.</p><Link href="/dashboard" className="button button-primary">Go to dashboard <ArrowRight size={18} /></Link></div> : <div className="auth-form">{error && <Notice>{error}</Notice>}<div className="verify-illustration"><Mail size={40} /></div><button className="button button-primary" disabled={busy} onClick={verify}>{busy ? 'Verifying…' : 'Confirm email address'}<ArrowRight size={18} /></button><p className="auth-switch"><Link href="/login">Link expired? Sign in to request a new one</Link></p></div>}
  </AuthFrame>;
}

