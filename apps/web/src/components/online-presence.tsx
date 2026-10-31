'use client';

import { Link2, Plus, Trash2 } from 'lucide-react';
import type { AdditionalSocialLink, SocialLinks } from '@/lib/api';
import { Field } from './ui';
import styles from './profile-enhancements.module.css';

export const MAX_ADDITIONAL_LINKS = 8;

function checkUrl(input: HTMLInputElement) {
  input.setCustomValidity('');
  const value = input.value.trim();
  if (!value) return;
  try {
    if (/[\x00-\x20\x7f]/.test(value)) throw new Error('Invalid URL');
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Invalid URL');
  } catch {
    input.setCustomValidity('Enter a full http:// or https:// link without a username or password.');
  }
}

export function OnlinePresenceSection({ value, onChange }: { value: SocialLinks; onChange: (value: SocialLinks) => void }) {
  const additional = value.additional || [];
  function updateAdditional(index: number, key: keyof AdditionalSocialLink, next: string) {
    onChange({ ...value, additional: additional.map((link, i) => i === index ? { ...link, [key]: next } : link) });
  }
  return <section className="panel form-section" id="links" aria-labelledby="online-presence-heading">
    <div className="form-section-heading"><span className="section-icon"><Link2 size={22} /></span><div><h2 id="online-presence-heading">Online presence</h2><p>Add relevant social and portfolio links.</p></div><span className="section-index">05</span></div>
    <p className={styles.sharing}>Your saved links appear on your public profile when you publish it. Add only links you want visitors to see.</p>
    <div className="form-grid">
      {(['linkedin', 'github', 'portfolio'] as const).map(key => <Field key={key} id={key} label={key === 'linkedin' ? 'LinkedIn' : key === 'github' ? 'GitHub' : 'Portfolio / Website'} className={key === 'portfolio' ? 'full-width' : ''}>
        <input id={key} type="url" ref={input => { if (input) checkUrl(input); }} value={value[key] || ''} onChange={event => { checkUrl(event.target); onChange({ ...value, [key]: event.target.value }); }}
          placeholder={key === 'linkedin' ? 'https://linkedin.com/in/yourname' : key === 'github' ? 'https://github.com/yourname' : 'https://yourwebsite.com'} maxLength={500} />
      </Field>)}
    </div>
    <div className={styles.additional}>
      <div className={styles.additionalHeading}><div><h3>More social links</h3><p>Add Facebook, Instagram, Behance, YouTube or another public link.</p></div><button type="button" className="text-link" disabled={additional.length >= MAX_ADDITIONAL_LINKS} onClick={() => onChange({ ...value, additional: [...additional, { label: '', url: '' }] })}><Plus size={17} /> Add link</button></div>
      <p className={styles.counter} aria-live="polite">{additional.length.toLocaleString('en-GB')} of {MAX_ADDITIONAL_LINKS.toLocaleString('en-GB')} additional links</p>
      {additional.length === 0 && <p className="field-help">Choose Add link to include another social account or portfolio.</p>}
      <div className={styles.rows}>{additional.map((link, index) => <div className={styles.row} key={index}>
        <div className={styles.rowHeading}><strong>Link {(index + 1).toLocaleString('en-GB')}</strong><button type="button" className="icon-button danger" aria-label={`Remove social link ${(index + 1).toLocaleString('en-GB')}`} onClick={() => onChange({ ...value, additional: additional.filter((_, i) => i !== index) })}><Trash2 size={17} /></button></div>
        <div className="form-grid">
          <Field id={`additional-link-${index}-label`} label="Link name"><input id={`additional-link-${index}-label`} type="text" value={link.label} required maxLength={40} pattern=".*\S.*" onChange={event => updateAdditional(index, 'label', event.target.value)} placeholder="e.g. Behance" autoComplete="off" /></Field>
          <Field id={`additional-link-${index}-url`} label="Link URL"><input id={`additional-link-${index}-url`} type="url" ref={input => { if (input) checkUrl(input); }} value={link.url} required maxLength={500} onChange={event => { checkUrl(event.target); updateAdditional(index, 'url', event.target.value); }} placeholder="https://example.com/yourprofile" autoComplete="url" /></Field>
        </div>
      </div>)}</div>
      {additional.length >= MAX_ADDITIONAL_LINKS && <p className="field-help">You have added all 8 extra links. Remove a link to add another.</p>}
    </div>
  </section>;
}
