import { api, ApiError } from './api';

export type DocumentCategory = 'CERTIFICATE' | 'PROJECT';
export type StudentDocument = {
  id: string;
  title: string;
  category: DocumentCategory | 'CV';
  originalFilename: string;
  sizeBytes: number;
  createdAt: string;
  status?: string;
  user?: { id: string; name: string; email: string };
};
export type DocumentList = {
  documents: StudentDocument[];
  limits: { maxBytes: number; maxDocuments: number };
  available: boolean;
};
export type AdminDocumentList = { documents: StudentDocument[]; page: number; pageSize: number; total: number; available: boolean };
export const documentCategories: { value: DocumentCategory; label: string }[] = [
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'PROJECT', label: 'Project report' },
];
export const categoryLabel = (category: StudentDocument['category']) => documentCategories.find((item) => item.value === category)?.label || 'Document';
export const documentDate = (date: string) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' });
export const fileSize = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.ceil(bytes / 1024)).toLocaleString('en-GB')} KB`
  : `${(bytes / (1024 * 1024)).toLocaleString('en-GB', { maximumFractionDigits: 1 })} MB`;
export const isDocumentReady = (document: StudentDocument) => !document.status || document.status === 'READY';

export function validatePdf(file: File, maxBytes: number): string {
  if (!/\.pdf$/i.test(file.name) || (file.type && !['application/pdf', 'application/octet-stream'].includes(file.type))) return 'Choose a PDF file with a .pdf extension.';
  if (file.size === 0) return 'This PDF is empty. Choose another file.';
  if (file.size > maxBytes) return `Your PDF is too large. Choose a file no larger than ${fileSize(maxBytes)}.`;
  return '';
}

export async function uploadDocument(
  input: { title: string; category: DocumentCategory; file: File },
  onProgress: (percentage: number) => void,
  signal: AbortSignal,
): Promise<{ document: StudentDocument }> {
  const { csrfToken } = await api<{ csrfToken: string }>('/auth/csrf', { signal });
  if (!csrfToken) throw new ApiError(0, 'Unable to complete the security check. Please refresh this page.');
  if (signal.aborted) throw new ApiError(0, 'Upload cancelled. Refresh your documents before trying again.');
  const body = new FormData();
  body.set('title', input.title);
  body.set('category', input.category);
  body.set('file', input.file);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const cleanup = () => signal.removeEventListener('abort', abort);
    request.open('POST', '/api/v1/documents');
    request.withCredentials = true;
    request.timeout = 120_000;
    request.setRequestHeader('X-CSRF-Token', csrfToken);
    request.setRequestHeader('Accept', 'application/json');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
    };
    request.onload = () => {
      cleanup();
      let data: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(request.responseText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
      } catch { /* A proxy may return an HTML error page. */ }
      if (request.status >= 200 && request.status < 300 && data.document) {
        resolve(data as { document: StudentDocument });
        return;
      }
      const message = Array.isArray(data.message) ? data.message.join(' ') : typeof data.message === 'string' ? data.message : 'We could not upload this document. Refresh your documents before trying again.';
      reject(new ApiError(request.status, request.status === 413 ? 'This PDF is too large. Choose a smaller file.' : request.status === 429 ? 'Too many upload attempts. Please wait a moment and try again.' : message));
    };
    request.onerror = () => { cleanup(); reject(new ApiError(0, 'The upload connection was interrupted. Refresh your documents before trying again.')); };
    request.ontimeout = () => { cleanup(); reject(new ApiError(0, 'The upload is taking longer than expected. Refresh your documents before trying again.')); };
    request.onabort = () => { cleanup(); reject(new ApiError(0, 'Upload cancelled. Refresh your documents before trying again.')); };
    signal.addEventListener('abort', abort, { once: true });
    request.send(body);
  });
}
