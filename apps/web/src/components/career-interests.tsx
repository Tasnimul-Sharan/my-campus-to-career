'use client';

import Link from 'next/link';
import { ArrowUpRight, BriefcaseBusiness, Check, Globe2, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { Profile } from '@/lib/api';
import { TALENT_AVAILABILITIES, TALENT_CATEGORIES, type TalentAvailability } from '@/lib/talent';
import { Field } from './ui';
import styles from './career-interests.module.css';

type Requirement = { label: string; href?: string };

export function publicationRequirements(profile: Profile, emailVerified: boolean): Requirement[] {
  return [
    ...(!emailVerified ? [{ label: 'Verify your email using the banner above, then refresh this page.' }] : []),
    ...(!profile.university.trim() ? [{ label: 'Add your university.', href: '#university' }] : []),
    ...(!profile.department.trim() ? [{ label: 'Add your department or subject.', href: '#department' }] : []),
    ...(!profile.objective.trim() ? [{ label: 'Write a career objective.', href: '#objective' }] : []),
    ...(!profile.skills.some(value => value.trim()) ? [{ label: 'Add at least one skill.', href: '#skill' }] : []),
    ...(!profile.talentCategories.length || profile.talentCategories.length > 3 ? [{ label: 'Choose one to three primary career categories.', href: '#talentCategories' }] : []),
  ];
}

export function CareerInterests({ profile, userId, emailVerified, savedDirectoryPublished, onChange }: {
  profile: Profile;
  userId: string;
  emailVerified: boolean;
  savedDirectoryPublished: boolean;
  onChange: <K extends keyof Profile>(key: K, value: Profile[K]) => void;
}) {
  const requirements = publicationRequirements(profile, emailVerified);
  const visibilityChanged = profile.directoryPublished !== savedDirectoryPublished;
  const selectedCategories = profile.talentCategories;

  return <section className="panel form-section" id="career-interests" aria-labelledby="career-interests-heading">
    <div className="form-section-heading"><span className="section-icon"><BriefcaseBusiness size={22} /></span><div><h2 id="career-interests-heading">Career interests</h2><p>Choose your direction and how you would like to be discovered.</p></div><span className="section-index">06</span></div>
    <div className="form-grid">
      <fieldset className={styles.categoryFieldset} id="talentCategories" aria-describedby="career-category-help career-category-count">
        <legend>Primary career categories</legend>
        <p id="career-category-help" className={styles.categoryHelp}>Select at least 1 and up to 3 career categories. Your academic subject does not limit your choices.</p>
        <div className={styles.categoryChoices}>
          {TALENT_CATEGORIES.map(category => {
            const selected = selectedCategories.includes(category.slug);
            return <label className={`${styles.categoryOption} ${selected ? styles.categorySelected : ''}`} htmlFor={`career-category-${category.slug}`} key={category.slug}>
              <input id={`career-category-${category.slug}`} type="checkbox" checked={selected} disabled={!selected && selectedCategories.length >= 3}
                onChange={event => onChange('talentCategories', event.target.checked ? [...selectedCategories, category.slug] : selectedCategories.filter(value => value !== category.slug))} />
              <span>{category.label}</span>
            </label>;
          })}
        </div>
        <p id="career-category-count" className={styles.categoryCount} role="status" aria-live="polite" aria-atomic="true">{selectedCategories.length.toLocaleString('en-GB')} of 3 selected{selectedCategories.length >= 3 ? ' · Remove a selection to choose another.' : ''}</p>
      </fieldset>
      <Field id="availability" label="Open to" help="Let visitors know what kind of opportunity you are interested in.">
        <select className={styles.select} id="availability" value={profile.availability} onChange={event => onChange('availability', event.target.value as TalentAvailability)}>
          {TALENT_AVAILABILITIES.map(availability => <option key={availability.value} value={availability.value}>{availability.label}</option>)}
        </select>
      </Field>
      <Field id="headline" label="Preferred role / headline" className="full-width" help="Optional. A short introduction to the role or interests you want to pursue, up to 120 characters.">
        <input id="headline" value={profile.headline} onChange={event => onChange('headline', event.target.value)} maxLength={120} placeholder="e.g. Aspiring frontend developer · React and accessible design" autoComplete="off" />
      </Field>
    </div>

    <div className={styles.directory}>
      <div className={styles.directoryHeading}><div><span className={styles.directoryIcon}><Globe2 size={19} /></span><h3>Student talent directory</h3></div><span className={`${styles.visibility} ${savedDirectoryPublished ? styles.published : ''}`}>{savedDirectoryPublished ? <Globe2 size={12} /> : <LockKeyhole size={12} />}{savedDirectoryPublished ? 'Published' : 'Private'}</span></div>
      <p className={styles.intro}>Build a public introduction to your skills and career goals. Publishing is optional; your profile stays private until you choose to publish and save.</p>
      <label className={styles.checkbox} htmlFor="directoryPublished">
        <input id="directoryPublished" type="checkbox" checked={profile.directoryPublished} disabled={!emailVerified && !profile.directoryPublished} onChange={event => onChange('directoryPublished', event.target.checked)} aria-describedby="directory-public-information directory-privacy directory-visibility-help" />
        <span><strong>Publish my profile in the student talent directory</strong><span>Make my profile discoverable in the searchable homepage directory.</span></span>
      </label>
      <p id="directory-public-information" className={styles.sharedInformation}>Visitors can see your name, photo, university, department, city, skills, career interests and headline. Your public profile also shares your career objective, academic qualifications and any CGPA you add, campus activities and the social or portfolio links you choose to include.</p>
      <p id="directory-privacy" className={styles.privacy}><ShieldCheck size={17} /><span>Your email address, phone number, family background and private PDFs are never included in the public directory.</span></p>
      <p id="directory-visibility-help" className={styles.saveHelp}>{visibilityChanged
        ? profile.directoryPublished ? 'Save your profile to publish these details.' : 'Your profile is still public. Save your profile to remove it from the directory.'
        : 'You can unpublish at any time by turning this off and saving your profile.'}</p>

      {requirements.length > 0 ? <div className={styles.readiness}><strong>Before you publish</strong><ul>{requirements.map(requirement => <li key={requirement.label}>{requirement.href ? <a href={requirement.href}>{requirement.label}<ArrowUpRight size={12} /></a> : requirement.label}</li>)}</ul><p>Choose at least one career category to save a private draft. Other details can be completed later.</p></div>
        : <p className={styles.ready}><Check size={16} />Your profile meets the requirements for publishing.</p>}
      {savedDirectoryPublished && <Link className={styles.preview} href={`/talent/${encodeURIComponent(userId)}`} target="_blank" rel="noopener noreferrer" prefetch={false}>View my saved public profile<ArrowUpRight size={15} /><span className="sr-only"> (opens in a new tab)</span></Link>}
    </div>
  </section>;
}
