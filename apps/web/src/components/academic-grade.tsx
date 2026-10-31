'use client';

import { useRef } from 'react';
import { Field } from './ui';
import styles from './profile-enhancements.module.css';

export function AcademicGradeFields({ id, cgpa, scale, onChange }: {
  id: string;
  cgpa: number | null;
  scale: 4 | 5;
  onChange: (cgpa: number | null, scale: 4 | 5) => void;
}) {
  const gradeInput = useRef<HTMLInputElement>(null);
  return <>
    <Field id={`${id}-cgpa`} label="CGPA" help="Optional. Shown on your public profile when published.">
      <input id={`${id}-cgpa`} ref={input => { gradeInput.current = input; input?.setCustomValidity(''); }} type="number" min={0} max={scale} step="0.01" inputMode="decimal" value={cgpa ?? ''}
        placeholder="e.g. 3.75" onChange={event => { event.target.setCustomValidity(''); onChange(event.target.value === '' ? null : Number(event.target.value), scale); }}
        onInvalid={event => event.currentTarget.setCustomValidity(`Enter a CGPA from 0 to ${scale.toFixed(2)}, using up to two decimal places, or leave it blank.`)} />
    </Field>
    <Field id={`${id}-cgpa-scale`} label="CGPA scale" help="Choose the scale used by your institution.">
      <select id={`${id}-cgpa-scale`} className={styles.select} value={scale} onChange={event => { gradeInput.current?.setCustomValidity(''); onChange(cgpa, Number(event.target.value) === 5 ? 5 : 4); }}>
        <option value={4}>Out of 4.00</option><option value={5}>Out of 5.00</option>
      </select>
    </Field>
  </>;
}
