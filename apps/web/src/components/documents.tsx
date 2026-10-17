'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, FileCheck2, FileText, FolderOpen, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, Trash2, UploadCloud, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { categoryLabel, documentCategories, documentDate, fileSize, isDocumentReady, uploadDocument, validatePdf, type AdminDocumentList, type DocumentCategory, type DocumentList, type StudentDocument } from '@/lib/documents';
import { AppShell, SessionState, useUser } from './app-shell';
import { Field, Loading, Notice } from './ui';
import styles from './documents.module.css';

function DownloadButton({ document }: { document: StudentDocument }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [readyUrl, setReadyUrl] = useState('');
  useEffect(() => {
    if (!readyUrl) return;
    const timer = setTimeout(() => setReadyUrl(''), 45_000);
    return () => clearTimeout(timer);
  }, [readyUrl]);
  async function download() {
    setBusy(true); setError(''); setReadyUrl('');
    const popup = window.open('about:blank', '_blank');
    if (popup) { popup.opener = null; popup.document.title = 'Preparing your document'; popup.document.body.textContent = 'Preparing your PDF download…'; }
    try {
      const response = await api<{ url: string; expiresAt: string }>(`/documents/${encodeURIComponent(document.id)}/download`);
      const url = new URL(response.url);
      if (url.protocol !== 'https:') throw new Error('The download link is unavailable. Please try again.');
      if (popup && !popup.closed) popup.location.replace(url.href);
      else setReadyUrl(url.href);
    } catch (err) { popup?.close(); setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <div className={styles.downloadWrap}>
    <button type="button" className={`button button-outline ${styles.downloadButton}`} disabled={busy} onClick={download} aria-label={`Download ${document.title}`}>
      {busy ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}{busy ? 'Preparing…' : 'Download'}
    </button>
    {readyUrl && <div><a className={styles.downloadReady} href={readyUrl} target="_blank" rel="noopener noreferrer">Download PDF <Download size={13} /></a></div>}
    {error && <p role="alert" className={styles.downloadError}>{error}</p>}
  </div>;
}

function DeleteDocumentDialog({ document, busy, error, onClose, onConfirm }: { document: StudentDocument; busy: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal(); cancel.current?.focus();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className={styles.modal} aria-labelledby="delete-document-title" aria-describedby="delete-document-description" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <Trash2 size={29} />
    <h2 id="delete-document-title">{isDocumentReady(document) ? 'Delete this document?' : 'Remove incomplete upload?'}</h2>
    <p id="delete-document-description">{isDocumentReady(document) ? <>“{document.title}” will be removed from your documents. You can upload it again if you have a copy.</> : <>Remove “{document.title}” before uploading it again. An upload that is still being processed may need a moment to finish.</>}</p>
    {error && <div className={styles.modalError}><Notice>{error}</Notice></div>}
    <div className={styles.modalActions}>
      <button ref={cancel} type="button" className="button button-outline button-small" disabled={busy} onClick={onClose}>Keep document</button>
      <button type="button" className={styles.deleteButton} disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}{busy ? 'Removing…' : 'Delete document'}</button>
    </div>
  </dialog>;
}

function StorageUnavailable() {
  return <div className={styles.unavailable} role="status"><strong>Document storage is temporarily unavailable</strong>Your documents are listed below. Please contact the administrator if you need to upload or download a PDF.</div>;
}

function DocumentStatus({ document }: { document: StudentDocument }) {
  if (isDocumentReady(document)) return null;
  return <p className={styles.processing}>{document.status === 'DELETING' ? 'Removal is incomplete. Use Delete to try again.' : 'Upload is incomplete or still processing. Refresh the list to check its status.'}</p>;
}

export function StudentDocuments() {
  const session = useUser();
  const [data, setData] = useState<DocumentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('CV');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleting, setDeleting] = useState<StudentDocument | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);
  useEffect(() => {
    if (!session.user) return;
    let cancelled = false;
    setLoading(true); setLoadError('');
    api<DocumentList>('/documents').then((response) => { if (!cancelled) setData(response); })
      .catch((err: unknown) => { if (!cancelled) setLoadError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session.user, reload]);
  const maxBytes = data?.limits.maxBytes ?? 4 * 1024 * 1024;
  const maxDocuments = data?.limits.maxDocuments ?? 10;
  const count = data?.documents.length ?? 0;
  const limitReached = count >= maxDocuments;
  const uploadDisabled = uploading || loading || !data || !data.available || !!loadError || !session.user?.emailVerified || limitReached;
  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setUploadError(''); setSuccess(''); setProgress(0);
    const selected = event.target.files?.[0];
    if (!selected) { setFile(null); return; }
    const message = validatePdf(selected, maxBytes);
    if (message) { setUploadError(message); setFile(null); event.target.value = ''; return; }
    setFile(selected);
    if (!title.trim()) setTitle(selected.name.replace(/\.pdf$/i, '').slice(0, 150));
  }
  function clearFile() { setFile(null); setUploadError(''); if (fileInput.current) fileInput.current.value = ''; }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploadDisabled) return;
    setUploadError(''); setSuccess('');
    if (!title.trim()) { setUploadError('Enter a title for your document.'); return; }
    if (!file) { setUploadError('Choose a PDF to upload.'); return; }
    const message = validatePdf(file, maxBytes);
    if (message) { setUploadError(message); return; }
    setUploading(true); setProgress(0);
    const controller = new AbortController(); uploadController.current = controller;
    try {
      if (await file.slice(0, 5).text() !== '%PDF-') throw new Error('This file does not appear to be a PDF. Export it as a PDF and try again.');
      const response = await uploadDocument({ title: title.trim(), category, file }, setProgress, controller.signal);
      setData((current) => current ? { ...current, documents: [response.document, ...current.documents.filter((item) => item.id !== response.document.id)] } : current);
      setTitle(''); clearFile(); setSuccess('Your PDF has been uploaded successfully.');
    } catch (err) { setUploadError(errorMessage(err)); setReload((value) => value + 1); }
    finally { setUploading(false); uploadController.current = null; }
  }
  async function remove() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true); setDeleteError(''); setSuccess('');
    try {
      await api(`/documents/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
      setData((current) => current ? { ...current, documents: current.documents.filter((item) => item.id !== deleting.id) } : current);
      setSuccess('The document has been deleted.'); setDeleting(null);
    } catch (err) { setDeleteError(errorMessage(err)); }
    finally { setDeleteBusy(false); }
  }
  if (!session.user) return <SessionState {...session} />;
  return <AppShell user={session.user}>
    <div className="page-heading"><div><span className="eyebrow">YOUR WORK. YOUR PROGRESS.</span><h1>My documents</h1><p>Keep your CV, certificates and project reports together.</p></div><span className="admin-role-badge"><LockKeyhole size={16} /> Private documents</span></div>
    {success && <Notice success>{success}</Notice>}
    {loadError && <Notice>{loadError}</Notice>}
    {data && !data.available && <StorageUnavailable />}
    <section className={styles.summary} aria-label="Document allowance"><FolderOpen size={30} /><div><strong>A little proof of your progress</strong><p>PDF files up to {fileSize(maxBytes)} each. Only you and administrators can access them.</p></div><div className={styles.summaryCount}>{count.toLocaleString('en-GB')} <span>/ {maxDocuments.toLocaleString('en-GB')}</span></div></section>
    <div className={styles.layout}>
      <section className={`panel ${styles.uploadPanel}`} aria-labelledby="upload-document-title">
        <span className="eyebrow">ADD TO YOUR STORY</span><h2 id="upload-document-title">Upload a document</h2><p className={styles.intro}>Give your PDF a clear title so it is easy to find later.</p>
        {!session.user.emailVerified && <div className={styles.verificationNote}><p>Verify your email using the banner above to upload documents.</p><button type="button" className="text-link" onClick={session.retry}>I have verified my email <RefreshCw size={13} /></button></div>}
        {limitReached && <p className={styles.verificationNote}>You have reached your {maxDocuments.toLocaleString('en-GB')}-document limit. Delete a document to make room for another.</p>}
        <form className={styles.form} onSubmit={submit}>
          <Field id="document-title" label="Document title"><input id="document-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} placeholder="e.g. My latest CV" required disabled={uploadDisabled} /></Field>
          <Field id="document-category" label="Category"><select id="document-category" className={styles.select} value={category} onChange={(event) => setCategory(event.target.value as DocumentCategory)} disabled={uploadDisabled}>{documentCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <div><label className={styles.fileLabel} htmlFor="document-file"><UploadCloud size={28} /><strong>{file ? 'Choose a different PDF' : 'Choose your PDF'}</strong><span>PDF only · Up to {fileSize(maxBytes)}</span><input ref={fileInput} id="document-file" className="sr-only" type="file" accept=".pdf,application/pdf" onChange={selectFile} disabled={uploadDisabled} /></label>{file && <div className={styles.chosen}><FileText size={20} /><div><strong>{file.name}</strong><span>{fileSize(file.size)}</span></div><button type="button" className="icon-button" onClick={clearFile} disabled={uploading} aria-label="Remove selected file"><X size={15} /></button></div>}</div>
          {uploadError && <Notice>{uploadError}</Notice>}
          {uploading && <div className={styles.progress} role="status"><div><span>{progress === 100 ? 'Checking and saving your PDF…' : 'Uploading your PDF…'}</span><span>{progress.toLocaleString('en-GB')}%</span></div><progress max={100} value={progress} aria-label="PDF upload progress" /></div>}
          <button className="button button-primary" type="submit" disabled={uploadDisabled || !file || !title.trim()}>{uploading ? <LoaderCircle size={17} className="spin" /> : <UploadCloud size={17} />}{uploading ? 'Uploading…' : 'Upload PDF'}</button>
          <p className={styles.formNote}><ShieldCheck size={15} />Your documents are private and are never listed publicly.</p>
        </form>
      </section>
      <section className={`panel ${styles.library}`} aria-labelledby="document-library-title" aria-busy={loading}>
        <div className={styles.libraryHeader}><div><span className="eyebrow">YOUR DOCUMENT LIBRARY</span><h2 id="document-library-title">Saved documents</h2></div><button type="button" className="icon-button" disabled={loading || uploading} onClick={() => setReload((value) => value + 1)} aria-label="Refresh documents"><RefreshCw size={17} className={loading ? 'spin' : ''} /></button></div>
        {loading ? <Loading text="Loading your documents…" /> : !data || loadError ? <div className={styles.empty}><FolderOpen size={35} /><h3>Unable to load documents</h3><p>Please check your connection and try again.</p><button className="button button-outline button-small" type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div> : data.documents.length === 0 ? <div className={styles.empty}><FileCheck2 size={39} /><h3>Your next chapter starts here</h3><p>Upload your first CV, certificate or project report. Your saved PDFs will appear here.</p></div> : <ul className={styles.cards}>{data.documents.map((document) => <li key={document.id} className={styles.card}><div className={styles.cardTop}><span className={styles.pdfIcon}><FileText size={24} /></span><div className={styles.cardBody}><h3>{document.title}</h3><p className={styles.filename}>{document.originalFilename}</p><div className={styles.metadata}><span className="badge badge-soft">{categoryLabel(document.category)}</span><span>{fileSize(document.sizeBytes)}</span><span>{documentDate(document.createdAt)}</span></div></div></div><DocumentStatus document={document} /><div className={styles.actions}>{isDocumentReady(document) && data.available && <DownloadButton document={document} />}<button type="button" className={styles.deleteButton} disabled={uploading || !data.available} aria-label={`Delete ${document.title}`} onClick={() => { setDeleting(document); setDeleteError(''); }}><Trash2 size={14} />Delete</button></div></li>)}</ul>}
      </section>
    </div>
    <p className={styles.footerNote}><LockKeyhole size={15} />Downloads use a temporary link. Upload only documents that belong to you.</p>
    {deleting && <DeleteDocumentDialog document={deleting} busy={deleteBusy} error={deleteError} onClose={() => setDeleting(null)} onConfirm={remove} />}
  </AppShell>;
}

export function AdminDocuments() {
  const session = useUser(true);
  const [data, setData] = useState<AdminDocumentList | null>(null);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!session.user || session.user.role !== 'ADMIN') return;
    let cancelled = false; setLoading(true); setError('');
    api<AdminDocumentList>(`/admin/documents?page=${page}&search=${encodeURIComponent(search)}`)
      .then((response) => { if (!cancelled) setData(response); })
      .catch((err: unknown) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session.user, search, page, reload]);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSearch(input.trim()); setPage(1); }
  if (!session.user || session.user.role !== 'ADMIN') return <SessionState {...session} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <AppShell user={session.user} admin>
    <div className="page-heading"><div><span className="eyebrow">STUDENT ACHIEVEMENTS</span><h1>Student documents</h1><p>Review the CVs, certificates and project reports students have shared.</p></div><span className="admin-role-badge"><ShieldCheck size={17} /> Administrator</span></div>
    {error && <Notice>{error}</Notice>}{data && !data.available && <StorageUnavailable />}
    <section className="panel students-panel" aria-busy={loading}>
      <div className="students-header"><div><span className="eyebrow">DOCUMENT DIRECTORY</span><h2>Student documents</h2></div><form className="search-form" onSubmit={submit}><label className="sr-only" htmlFor="document-search">Search by student name, email or document title</label><div className="search-input"><Search size={18} /><input id="document-search" maxLength={100} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Search student or document" /></div><button className="button button-outline button-small" type="submit">Search</button></form></div>
      {loading ? <Loading text="Loading student documents…" /> : !data || error ? <div className={styles.empty}><FolderOpen size={35} /><h3>Unable to load documents</h3><p>Please try loading the directory again.</p><button className="button button-outline button-small" onClick={() => setReload((value) => value + 1)}>Try again</button></div> : <><div className="table-wrapper"><table><thead><tr><th scope="col">Student</th><th scope="col">Document</th><th scope="col">Category</th><th scope="col">Uploaded</th><th scope="col">Download</th></tr></thead><tbody>{data.documents.map((document) => <tr key={document.id}><td><div className="table-student"><span className="avatar small">{document.user?.name.slice(0, 1).toUpperCase() || 'S'}</span><div><strong>{document.user?.name || 'Student'}</strong><span>{document.user?.email || '—'}</span></div></div></td><td><div className={styles.tableTitle}><strong>{document.title}</strong><span>{document.originalFilename}</span><span>{fileSize(document.sizeBytes)}</span></div></td><td><span className="badge badge-soft">{categoryLabel(document.category)}</span></td><td className="date-cell">{documentDate(document.createdAt)}</td><td className={styles.tableActions}>{isDocumentReady(document) ? data.available ? <DownloadButton document={document} /> : <span className="muted">Unavailable</span> : <span className="badge badge-soft">{document.status === 'DELETING' ? 'Removal pending' : 'Upload pending'}</span>}</td></tr>)}</tbody></table>{data.documents.length === 0 && <div className={styles.empty}><FolderOpen size={36} /><h3>{search ? 'No matching documents' : 'No documents yet'}</h3><p>{search ? 'Try another student name, email or document title.' : 'Student PDFs will appear here after they are uploaded.'}</p>{search && <button type="button" className="text-link" onClick={() => { setInput(''); setSearch(''); setPage(1); }}>View all documents</button>}</div>}</div><div className="table-footer"><span>{data.total.toLocaleString('en-GB')} documents · Page {page.toLocaleString('en-GB')} of {pages.toLocaleString('en-GB')}</span><div><button className="icon-button" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ChevronLeft size={20} /></button><button className="icon-button" type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight size={20} /></button></div></div></>}
    </section><p className={styles.footerNote}><LockKeyhole size={15} />Student documents are private. Download links expire shortly after they are created.</p>
  </AppShell>;
}
