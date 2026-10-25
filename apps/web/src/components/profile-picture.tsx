'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, LockKeyhole, Trash2, UploadCloud, X } from 'lucide-react';
import { api, errorMessage, type User } from '@/lib/api';
import { Notice } from './ui';
import { UserAvatar } from './user-avatar';
import styles from './profile-picture.module.css';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
type Confirmation = 'replace' | 'remove';

function PictureConfirmation({ action, onClose, onConfirm }: { action: Confirmation; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal(); cancel.current?.focus();
    return () => element?.close();
  }, []);
  const removing = action === 'remove';
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="picture-confirm-title" aria-describedby="picture-confirm-description" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    {removing ? <Trash2 size={28} /> : <Camera size={28} />}
    <h2 id="picture-confirm-title">{removing ? 'Remove your profile picture?' : 'Replace your profile picture?'}</h2>
    <p id="picture-confirm-description">{removing ? 'Your initials will appear instead. You can add another photo whenever you like.' : 'Your selected photo will replace your current picture. Your other profile details will stay as they are.'}</p>
    <div className={styles.dialogActions}>
      <button ref={cancel} type="button" className="button button-outline button-small" onClick={onClose}>Cancel</button>
      <button type="button" className={removing ? styles.removeConfirm : 'button button-primary button-small'} onClick={onConfirm}>{removing ? 'Remove picture' : 'Replace picture'}</button>
    </div>
  </dialog>;
}

export function ProfilePictureEditor({ user, available, onUserChange }: { user: User; available: boolean; onUserChange: (user: User) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState<'' | 'upload' | 'remove'>('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function clearSelection() {
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }
  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    if (!next) return;
    setError(''); setSuccess('');
    if (!IMAGE_TYPES.has(next.type) || !/\.(jpe?g|png|webp)$/i.test(next.name)) {
      clearSelection(); setError('Choose a JPG, PNG or WebP image.'); return;
    }
    if (!next.size || next.size > MAX_IMAGE_BYTES) {
      clearSelection(); setError(next.size ? 'Your photo must be 2 MB or smaller.' : 'This image is empty. Please choose another photo.'); return;
    }
    setFile(next);
  }
  async function changePicture(action: 'upload' | 'remove') {
    if (busy || !available || (action === 'upload' && (!file || !user.emailVerified))) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 90_000);
    setBusy(action); setError(''); setSuccess('');
    try {
      const body = action === 'upload' ? new FormData() : undefined;
      if (body && file) body.append('file', file);
      const response = await api<{ user: User; message: string }>('/profile/picture', { method: action === 'upload' ? 'POST' : 'DELETE', body, signal: controller.signal });
      if (!mounted.current) return;
      onUserChange(response.user);
      clearSelection();
      setSuccess(action === 'upload' ? 'Your profile picture has been saved.' : 'Your profile picture has been removed.');
    } catch (err) {
      if (mounted.current) setError(controller.signal.aborted ? 'The request took too long. Refresh the page to check your picture before trying again.' : errorMessage(err));
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      if (mounted.current) setBusy('');
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !file || !available || !user.emailVerified) return;
    if (user.profilePictureUrl) setConfirmation('replace');
    else void changePicture('upload');
  }
  const canUpload = available && user.emailVerified && !busy;
  return <section className={`panel ${styles.panel}`} aria-labelledby="profile-picture-heading" aria-busy={!!busy}>
    <div className={styles.heading}><div><span className="eyebrow">MAKE IT YOURS</span><h2 id="profile-picture-heading">Profile picture</h2><p>Add a photo to your student profile.</p></div><span className={styles.optional}>Optional</span></div>
    <div className={styles.content}>
      <div className={styles.previewWrap}>
        {preview ? <span className={styles.preview}><img src={preview} alt="Preview of your selected profile picture" width={112} height={112} onError={() => { clearSelection(); setError('We could not preview this image. Please choose another JPG, PNG or WebP photo.'); }} /></span> : <UserAvatar user={user} size="large" />}
        <span className={styles.cameraBadge} aria-hidden="true">{preview ? <Check size={16} /> : <Camera size={16} />}</span>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.selection}>
          <label className={styles.fileLabel}><ImagePlus size={17} />{file ? 'Choose another photo' : 'Choose photo'}<input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} disabled={!canUpload} aria-describedby="profile-picture-help" /></label>
          {user.profilePictureUrl && <button type="button" className={styles.removeButton} disabled={!!busy || !available} onClick={() => { setError(''); setSuccess(''); setConfirmation('remove'); }}><Trash2 size={15} />Remove picture</button>}
        </div>
        <p className={styles.help} id="profile-picture-help">JPG, PNG or WebP · Up to 2 MB. Your photo is cropped to a square.</p>
        {file && <div className={styles.chosen}><div><strong>{file.name}</strong><span>{(file.size / 1024).toLocaleString('en-GB', { maximumFractionDigits: 0 })} KB · Ready to upload</span></div><button type="button" className="icon-button" disabled={!!busy} aria-label="Clear selected photo" onClick={() => { clearSelection(); setError(''); }}><X size={16} /></button></div>}
        <div className={styles.submitRow}><button type="submit" className="button button-primary button-small" disabled={!file || !canUpload}>{busy === 'upload' ? <LoaderCircle size={16} className="spin" /> : <UploadCloud size={16} />}{busy === 'upload' ? 'Uploading photo…' : user.profilePictureUrl ? 'Save new picture' : 'Upload picture'}</button>{busy === 'remove' && <span className={styles.removing} role="status"><LoaderCircle size={15} className="spin" />Removing picture…</span>}</div>
      </form>
      <p className={styles.privacy}><LockKeyhole size={16} /><span>Private unless you publish your talent profile.</span></p>
    </div>
    {!available && <p className={styles.availability} role="status">Photo uploads are temporarily unavailable. Please try again later.</p>}
    {available && !user.emailVerified && <p className={styles.availability}>Verify your email address to upload a profile picture. Use the verification link above.</p>}
    {error && <div className={styles.notice}><Notice>{error}</Notice></div>}
    {success && <div className={styles.notice}><Notice success>{success}</Notice></div>}
    {confirmation && <PictureConfirmation action={confirmation} onClose={() => setConfirmation(null)} onConfirm={() => { const action = confirmation; setConfirmation(null); void changePicture(action === 'remove' ? 'remove' : 'upload'); }} />}
  </section>;
}
