'use client';

import { LockKeyhole, UsersRound } from 'lucide-react';
import type { FamilyBackground } from '@/lib/api';
import { Field } from './ui';
import styles from './family-background.module.css';

export function FamilyBackgroundSection({ value, onChange }: {
  value: FamilyBackground;
  onChange: (value: FamilyBackground) => void;
}) {
  function update<K extends keyof FamilyBackground>(key: K, next: FamilyBackground[K]) {
    onChange({ ...value, [key]: next });
  }

  return <section className="panel form-section" id="family" aria-labelledby="family-background-heading">
    <div className="form-section-heading"><span className="section-icon"><UsersRound size={22} /></span><div><h2 id="family-background-heading">Family background <span className={styles.optional}>Optional</span></h2><p>Share only the family details you would like to include.</p></div><span className="section-index">02</span></div>
    <p className={styles.privacy} id="family-background-privacy"><LockKeyhole size={17} /><span>Family information, including religion, stays private and is never shown on your public talent profile. Every field in this section is optional.</span></p>
    <div className="form-grid" role="group" aria-label="Optional family details" aria-describedby="family-background-privacy">
      <Field id="fatherName" label="Father's name"><input id="fatherName" type="text" value={value.fatherName} onChange={event => update('fatherName', event.target.value)} maxLength={100} autoComplete="off" placeholder="Father's full name" /></Field>
      <Field id="fatherOccupation" label="Father's occupation"><input id="fatherOccupation" type="text" value={value.fatherOccupation} onChange={event => update('fatherOccupation', event.target.value)} maxLength={100} autoComplete="off" placeholder="e.g. Teacher" /></Field>
      <Field id="motherName" label="Mother's name"><input id="motherName" type="text" value={value.motherName} onChange={event => update('motherName', event.target.value)} maxLength={100} autoComplete="off" placeholder="Mother's full name" /></Field>
      <Field id="motherOccupation" label="Mother's occupation"><input id="motherOccupation" type="text" value={value.motherOccupation} onChange={event => update('motherOccupation', event.target.value)} maxLength={100} autoComplete="off" placeholder="e.g. Business owner" /></Field>
      <Field id="religion" label="Religion" help="Optional. Leave this blank if you prefer not to share."><input id="religion" type="text" value={value.religion} onChange={event => update('religion', event.target.value)} maxLength={100} autoComplete="off" placeholder="Enter your religion (optional)" /></Field>
      <Field id="siblings" label="Number of siblings" help="Enter a whole number from 0 to 50, or leave this blank."><input id="siblings" type="number" value={value.siblings ?? ''} min={0} max={50} step={1} inputMode="numeric" onChange={event => { event.target.setCustomValidity(''); update('siblings', event.target.value === '' ? null : Number(event.target.value)); }} onInvalid={event => event.currentTarget.setCustomValidity('Enter a whole number from 0 to 50, or leave this field blank.')} placeholder="e.g. 2" /></Field>
      <Field id="additionalInformation" label="Additional family information" className="full-width" help="Optional. Add any other family context you would like to share, up to 1,000 characters."><textarea id="additionalInformation" value={value.additionalInformation} onChange={event => update('additionalInformation', event.target.value)} maxLength={1000} rows={3} placeholder="Any other family information you would like to include…" /></Field>
    </div>
  </section>;
}
