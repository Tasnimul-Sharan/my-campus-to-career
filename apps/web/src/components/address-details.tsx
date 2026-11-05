'use client';

import { useState } from 'react';
import { House, LockKeyhole, MapPin } from 'lucide-react';
import type { ProfileAddresses, StudentAddress } from '@/lib/api';
import { addressesMatch, BANGLADESH_DISTRICTS, hasAddress } from '@/lib/addresses';
import { Field } from './ui';
import styles from './address-details.module.css';

export function AddressDetailsSection({ value, onChange }: {
  value: ProfileAddresses;
  onChange: (value: ProfileAddresses) => void;
}) {
  const [sameAsPermanent, setSameAsPermanent] = useState(() => hasAddress(value.permanent) && addressesMatch(value));

  function update(kind: keyof ProfileAddresses, key: keyof StudentAddress, next: string) {
    const address = { ...value[kind], [key]: next };
    onChange({ ...value, [kind]: address, ...(kind === 'permanent' && sameAsPermanent ? { current: { ...address } } : {}) });
  }

  return <section className="panel form-section" id="addresses" aria-labelledby="address-details-heading">
    <div className="form-section-heading">
      <span className="section-icon"><MapPin size={22} /></span>
      <div><h2 id="address-details-heading">Address details <span className={styles.optional}>Optional</span></h2><p>Add your permanent and current addresses in Bangladesh.</p></div>
      <span className="section-index">02</span>
    </div>
    <p className={styles.privacy} id="address-details-privacy"><LockKeyhole size={17} /><span>Your full addresses stay private and are never shown on your public talent profile. Every field is optional.</span></p>
    <div className={styles.cards}>
      {(['permanent', 'current'] as const).map(kind => {
        const isCurrent = kind === 'current';
        const title = isCurrent ? 'Current address' : 'Permanent address';
        const copied = isCurrent && sameAsPermanent;
        const section = `section-${kind}`;
        return <div className={styles.card} key={kind}>
          <div className={styles.cardHeading}><span className={styles.cardIcon}>{isCurrent ? <MapPin size={19} /> : <House size={19} />}</span><div><h3 id={`${kind}-address-heading`}>{title}</h3><p>{isCurrent ? 'Where you currently live.' : 'Your permanent home address.'}</p></div></div>
          {isCurrent && <label className={styles.copyOption} htmlFor="same-as-permanent-address">
            <input id="same-as-permanent-address" type="checkbox" checked={sameAsPermanent} onChange={event => {
              const checked = event.target.checked;
              setSameAsPermanent(checked);
              if (checked) onChange({ ...value, current: { ...value.permanent } });
            }} aria-describedby="current-address-copy-help" />
            <span>Same as permanent address</span>
          </label>}
          <fieldset className={styles.fields} disabled={copied} aria-labelledby={`${kind}-address-heading`} aria-describedby="address-details-privacy">
            <Field id={`${kind}-street-address`} label="Street / House / Village" help="Include a care-of (C/O) name if needed.">
              <textarea id={`${kind}-street-address`} value={value[kind].streetAddress} onChange={event => update(kind, 'streetAddress', event.target.value)} maxLength={300} rows={3} placeholder="House / Road / Village, C/O (if applicable)" autoComplete={`${section} street-address`} />
            </Field>
            <Field id={`${kind}-post-office`} label="Post office"><input id={`${kind}-post-office`} type="text" value={value[kind].postOffice} onChange={event => update(kind, 'postOffice', event.target.value)} maxLength={100} placeholder="Enter your post office" autoComplete="off" /></Field>
            <Field id={`${kind}-police-station`} label="Police station"><input id={`${kind}-police-station`} type="text" value={value[kind].policeStation} onChange={event => update(kind, 'policeStation', event.target.value)} maxLength={100} placeholder="Enter your police station" autoComplete="off" /></Field>
            <Field id={`${kind}-district`} label="District"><select id={`${kind}-district`} className={styles.select} value={value[kind].district} onChange={event => update(kind, 'district', event.target.value)} autoComplete={`${section} address-level2`}>
              <option value="">Select a district (optional)</option>
              {BANGLADESH_DISTRICTS.map(district => <option key={district} value={district}>{district}</option>)}
            </select></Field>
          </fieldset>
          {isCurrent && <p id="current-address-copy-help" className={styles.copyHelp}>{sameAsPermanent ? 'Your current address follows any changes you make to your permanent address. Uncheck to edit it separately.' : 'Select the checkbox to use your permanent address here, or enter a different address.'}</p>}
        </div>;
      })}
    </div>
  </section>;
}
