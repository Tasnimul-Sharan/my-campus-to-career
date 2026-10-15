'use client';
import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUpRight, CheckCircle2, Circle, GraduationCap, MailCheck, PencilLine, Sparkles, UserRound } from 'lucide-react';
import { api, errorMessage, type Profile } from '@/lib/api';
import { AppShell, SessionState, useUser } from './app-shell';
import { Loading, Notice } from './ui';

export function Dashboard() {
  const session = useUser();
  const [profile, setProfile] = useState<Profile | null>(null); const [completion, setCompletion] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!session.user) return;
    let cancelled = false; setLoading(true); setError('');
    Promise.all([api<{ stats: { profileCompletion: number } }>('/dashboard'), api<{ profile: Profile }>('/profile')]).then(([dashboard, data]) => {
      if (!cancelled) { setCompletion(Math.max(0, Math.min(100, dashboard.stats.profileCompletion))); setProfile(data.profile); }
    }).catch((err: unknown) => { if (!cancelled) setError(errorMessage(err)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session.user, reload]);
  if (!session.user) return <SessionState {...session} />;
  const user = session.user;
  const checks = [
    { label: 'Account and email verification', done: user.emailVerified, description: user.emailVerified ? 'Your email has been verified.' : 'Verify your account using the link sent to your email.' },
    { label: 'Education details', done: !!(profile?.university && profile?.department), description: 'Add your university and department.' },
    { label: 'Career objective', done: !!profile?.objective, description: 'Briefly describe your goals and interests.' },
    { label: 'Your skills', done: !!profile?.skills?.length, description: 'Add the skills you are learning.' },
  ];
  return <AppShell user={user}><div className="page-heading"><div><span className="eyebrow">MY NEXT CHAPTER</span><h1>Welcome, {user.name.split(' ')[0]} <span className="greeting-dot">✦</span></h1><p>Take your first step towards a brighter future.</p></div><Link href="/profile" className="button button-primary"><PencilLine size={18} /> Edit profile</Link></div>
    {loading ? <Loading text="Loading your dashboard…" /> : error ? <div><Notice>{error}</Notice><button className="button button-outline" onClick={() => setReload((v) => v + 1)}>Try again</button></div> : <>
      <section className="dashboard-hero"><div><span className="eyebrow light">BUILD YOUR OWN STORY</span><h2>Build your profile.<br /><em>Open new possibilities.</em></h2><p>Complete your profile with your education, skills and experience.</p><Link href="/profile" className="button button-cream button-small">{completion === 100 ? 'View and update profile' : 'Complete your profile'} <ArrowUpRight size={18} /></Link></div><div className="completion-wrap"><div className="completion-ring" style={{ '--completion': `${completion}%` } as CSSProperties}><div><strong>{completion.toLocaleString('en-GB')}<span>%</span></strong><span>PROFILE COMPLETE</span></div></div><p>{completion === 100 ? 'Your profile is complete!' : 'Every detail is a step forward'}</p></div></section>
      <div className="dashboard-summary-grid"><article className="summary-card"><span className="summary-icon"><GraduationCap size={24} /></span><div><span>Your campus</span><strong>{profile?.university || 'Add your university'}</strong><small>{profile?.department || 'Your education details have not been added yet'}</small></div></article><article className="summary-card"><span className="summary-icon terracotta"><Sparkles size={24} /></span><div><span>Your skills</span><strong>{(profile?.skills?.length || 0).toLocaleString('en-GB')} {profile?.skills?.length === 1 ? 'skill' : 'skills'}</strong><small>{profile?.skills?.length ? profile.skills.slice(0, 3).join(' · ') : 'Get started by adding a skill'}</small></div></article><article className="summary-card"><span className="summary-icon gold"><MailCheck size={24} /></span><div><span>Account status</span><strong>{user.emailVerified ? 'Email verified' : 'Verification pending'}</strong><small>{user.email}</small></div></article></div>
      <div className="dashboard-lower"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">YOUR CHECKLIST</span><h2>Get started</h2></div><span className="badge badge-soft">{checks.filter((c) => c.done).length.toLocaleString('en-GB')} / {checks.length.toLocaleString('en-GB')} completed</span></div><div className="checklist">{checks.map((item) => <div key={item.label} className={`checklist-item ${item.done ? 'done' : ''}`}>{item.done ? <CheckCircle2 size={22} /> : <Circle size={22} />}<div><strong>{item.label}</strong><p>{item.description}</p></div>{!item.done && item.label !== 'Account and email verification' && <Link href="/profile" aria-label={`Add ${item.label.toLowerCase()}`}><ArrowUpRight size={20} /></Link>}</div>)}</div></section><section className="panel profile-preview"><span className="eyebrow">YOUR PROFILE AT A GLANCE</span><div className="large-avatar"><UserRound size={32} /></div><h2>{user.name}</h2><p>{profile?.degree || 'Student'}{profile?.department ? ` · ${profile.department}` : ''}</p>{profile?.objective ? <blockquote>{profile.objective}</blockquote> : <div className="empty-inline">Tell your story by adding a career objective to your profile.</div>}<div className="skills-preview">{profile?.skills?.slice(0, 5).map((skill) => <span className="skill-chip" key={skill}>{skill}</span>)}</div><Link href="/profile" className="text-link">View full profile <ArrowUpRight size={17} /></Link></section></div>
    </>}
  </AppShell>;
}
