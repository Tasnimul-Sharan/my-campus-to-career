'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowUpRight, BookOpen, BriefcaseBusiness, Check, Compass, ExternalLink, Github, Globe, GraduationCap, Linkedin, LoaderCircle, MapPin, RefreshCw, Sparkles, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { talentAvailabilityLabel, type TalentDetail } from '@/lib/talent';
import { Brand } from '@/components/ui';
import { TalentAvatar } from '@/components/talent-directory';
import styles from './talent-profile.module.css';

function publicLink(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function TalentProfile({ id }: { id: string }) {
  const [data, setData] = useState<TalentDetail | null>(null);
  const [failure, setFailure] = useState<'missing' | 'unavailable' | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailure(null);
    setData(null);
    api<TalentDetail>(`/talent/${encodeURIComponent(id)}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(error => { if (!controller.signal.aborted) setFailure(error instanceof ApiError && error.status === 404 ? 'missing' : 'unavailable'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, attempt]);

  const student = data?.student;
  const contactLinks = student ? [
    { label: 'LinkedIn', href: publicLink(student.socialLinks.linkedin), icon: Linkedin },
    { label: 'Portfolio', href: publicLink(student.socialLinks.portfolio), icon: Globe },
    { label: 'GitHub', href: publicLink(student.socialLinks.github), icon: Github },
  ].filter(link => link.href !== null) : [];

  return <div className={styles.page}><header className={styles.header}><Brand /><div><Link href="/#student-talent" className={styles.headerBrowse}>Browse talent</Link><Link href="/register" className="button button-primary button-small">Create a profile <ArrowUpRight size={16} aria-hidden="true" /></Link></div></header>
    <main id="main-content" className={styles.main}><Link href="/#student-talent" className={styles.back}><ArrowLeft size={16} aria-hidden="true" /> Back to student talent</Link>
      {loading ? <div className={styles.state} role="status"><LoaderCircle size={28} className="spin" aria-hidden="true" /><h1>A fresh perspective is on its way.</h1><p>Loading this student&apos;s public profile...</p></div> : failure || !student ? <div className={styles.state} role={failure === 'unavailable' ? 'alert' : undefined}><span className={styles.stateIcon}>{failure === 'missing' ? <UserRound size={30} aria-hidden="true" /> : <AlertCircle size={30} aria-hidden="true" />}</span><h1>{failure === 'missing' ? 'This profile is not available.' : 'We could not load this profile.'}</h1><p>{failure === 'missing' ? 'The student may have made their profile private, or this link may no longer be active.' : 'Please check your connection and try again in a moment.'}</p>{failure === 'unavailable' && <button type="button" className="button button-primary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={17} aria-hidden="true" /> Try again</button>}<Link href="/#student-talent" className="text-link">Explore more student talent <ArrowUpRight size={17} aria-hidden="true" /></Link></div> : <>
        <section className={styles.identity} aria-labelledby="student-name"><div className={styles.identityBand}><span><Sparkles size={14} aria-hidden="true" /> A FRESH PERSPECTIVE</span><span>{student.category.name}</span></div><div className={styles.identityContent}><TalentAvatar student={student} large /><div className={styles.identityCopy}><span className={styles.category}>{student.category.name}</span><h1 id="student-name">{student.name}</h1><p className={styles.headline}>{student.headline || 'Student exploring their next opportunity'}</p><div className={styles.quickDetails}><span><GraduationCap size={16} aria-hidden="true" />{student.university}</span>{student.city && <span><MapPin size={15} aria-hidden="true" />{student.city}</span>}</div></div><div className={styles.identityAvailability}><span className={styles.availability}><span aria-hidden="true" />{talentAvailabilityLabel(student.availability)}</span><small>Career interests shared by the student</small></div></div></section>

        <div className={styles.layout}><div className={styles.sections}>
          <section className={styles.panel} aria-labelledby="about-title"><div className={styles.sectionLabel}><UserRound size={19} strokeWidth={1.5} aria-hidden="true" /><h2 id="about-title">A little about {student.name.trim().split(/\s+/)[0] || 'this student'}</h2></div>{student.objective ? <p className={styles.prose}>{student.objective}</p> : <p className={styles.emptyCopy}>This student has not added an introduction yet.</p>}</section>
          <section className={styles.panel} aria-labelledby="skills-title"><div className={styles.sectionLabel}><Sparkles size={19} strokeWidth={1.5} aria-hidden="true" /><h2 id="skills-title">Skills & strengths</h2></div>{student.skills.length ? <ul className={styles.skills}>{student.skills.map(skill => <li key={skill}>{skill}</li>)}</ul> : <p className={styles.emptyCopy}>Skills have not been shared yet.</p>}</section>
          <section className={styles.panel} aria-labelledby="education-title"><div className={styles.sectionLabel}><GraduationCap size={21} strokeWidth={1.5} aria-hidden="true" /><h2 id="education-title">Education</h2></div><div className={styles.education}><span className={styles.educationIcon}><GraduationCap size={21} strokeWidth={1.5} aria-hidden="true" /></span><div><h3>{student.university}</h3>{(student.degree || student.department) && <p>{[student.degree, student.department].filter(Boolean).join(' · ')}</p>}{(student.semester || student.passingYear) && <small>{[student.semester ? `Semester ${student.semester}` : '', student.passingYear ? `Graduation year ${student.passingYear}` : ''].filter(Boolean).join(' · ')}</small>}</div></div>{student.educations.map((education, index) => <div className={styles.education} key={`${education.institution}-${index}`}><span className={styles.educationIcon}><BookOpen size={19} strokeWidth={1.5} aria-hidden="true" /></span><div><h3>{education.institution}</h3>{(education.degree || education.field) && <p>{[education.degree, education.field].filter(Boolean).join(' · ')}</p>}{(education.startYear || education.endYear) && <small>{education.startYear || 'Until'}{education.endYear ? `${education.startYear ? ' – ' : ' '}${education.endYear}` : ' – Present'}</small>}</div></div>)}</section>
          {student.activities && <section className={styles.panel} aria-labelledby="activities-title"><div className={styles.sectionLabel}><Compass size={20} strokeWidth={1.5} aria-hidden="true" /><h2 id="activities-title">Beyond the classroom</h2></div><p className={styles.prose}>{student.activities}</p></section>}
        </div><aside className={styles.sidebar}>
          <section className={styles.contact} aria-labelledby="contact-title"><span className={styles.contactIcon}><ArrowUpRight size={26} strokeWidth={1.4} aria-hidden="true" /></span><span className="eyebrow">GOOD CONNECTIONS START HERE</span><h2 id="contact-title">Start a conversation.</h2><p>Explore the links {student.name.trim().split(/\s+/)[0] || 'this student'} has chosen to share.</p>{contactLinks.length > 0 ? <div className={styles.contactLinks}>{contactLinks.map(({ label, href, icon: Icon }, index) => <a key={label} href={href!} target="_blank" rel="noopener noreferrer" className={index === 0 ? styles.primaryContact : styles.secondaryContact}><Icon size={17} aria-hidden="true" />{index === 0 && label === 'LinkedIn' ? 'Connect on LinkedIn' : `Visit ${label}`}<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>)}</div> : <div className={styles.noContact}>Contact links have not been shared.</div>}<span className={styles.contactNote}><Check size={14} aria-hidden="true" /> Links are provided by the student.</span></section>
          <section className={styles.interest} aria-labelledby="interest-title"><BriefcaseBusiness size={20} strokeWidth={1.5} aria-hidden="true" /><h2 id="interest-title">Looking ahead</h2><dl><div><dt>Professional interest</dt><dd>{student.category.name}</dd></div><div><dt>Open to</dt><dd>{talentAvailabilityLabel(student.availability)}</dd></div>{student.department && <div><dt>Academic subject</dt><dd>{student.department}</dd></div>}</dl></section>
          <div className={styles.studentCallout}><span className="eyebrow">YOUR STORY BELONGS HERE TOO</span><p>A student with something to share?</p><Link href="/register">Create your free profile <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
        </aside></div><p className={styles.publicNote}><UserRound size={15} aria-hidden="true" /> This public profile contains information the student has chosen to share.</p>
      </>}
    </main><footer className={styles.footer}><span>© 2026 MyCampusToCareer</span><Link href="/#student-talent">Discover more student talent <ArrowUpRight size={15} aria-hidden="true" /></Link></footer>
  </div>;
}
