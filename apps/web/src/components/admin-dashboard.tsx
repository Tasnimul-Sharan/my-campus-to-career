'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, CircleCheck, Search, ShieldCheck, UserCheck, UserRound, UsersRound } from 'lucide-react';
import { api, errorMessage, type User } from '@/lib/api';
import { AppShell, SessionState, useUser } from './app-shell';
import { Loading, Notice } from './ui';

type Summary = { totalStudents: number; verifiedStudents: number; activeStudents: number; suspendedStudents: number };
type StudentList = { students: User[]; total: number; page: number; pageSize: number };
export function AdminDashboard() {
  const session = useUser(true);
  const [summary, setSummary] = useState<Summary | null>(null); const [data, setData] = useState<StudentList | null>(null); const [input, setInput] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [changing, setChanging] = useState(''); const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!session.user || session.user.role !== 'ADMIN') return;
    let cancelled = false; setLoading(true); setError('');
    Promise.all([api<Summary>('/admin/summary'), api<StudentList>(`/admin/students?page=${page}&search=${encodeURIComponent(search)}`)]).then(([stats, list]) => { if (!cancelled) { setSummary(stats); setData(list); } }).catch((err: unknown) => { if (!cancelled) setError(errorMessage(err)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session.user, page, search, reload]);
  async function updateStatus(student: User) {
    setChanging(student.id); setError(''); setSuccess('');
    const status = student.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try { await api(`/admin/students/${student.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setSuccess(`${student.name}'s account has been ${status === 'ACTIVE' ? 'activated' : 'suspended'}.`); setReload((v) => v + 1); }
    catch (err) { setError(errorMessage(err)); } finally { setChanging(''); }
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSearch(input.trim()); setPage(1); setSuccess(''); }
  if (!session.user || session.user.role !== 'ADMIN') return <SessionState {...session} />;
  const stats = summary ? [{ label: 'Total students', value: summary.totalStudents, icon: UsersRound }, { label: 'Verified students', value: summary.verifiedStudents, icon: CircleCheck }, { label: 'Active accounts', value: summary.activeStudents, icon: UserCheck }, { label: 'Suspended accounts', value: summary.suspendedStudents, icon: ShieldCheck }] : [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <AppShell user={session.user} admin><div className="page-heading"><div><span className="eyebrow">CAMPUS COMMUNITY</span><h1>Admin dashboard</h1><p>View student accounts and manage their account status.</p></div><span className="admin-role-badge"><ShieldCheck size={17} /> Administrator</span></div>
    {error && <Notice>{error}</Notice>}{success && <Notice success>{success}</Notice>}
    {summary && <div className="admin-stats">{stats.map(({ label, value, icon: Icon }, index) => <article className="admin-stat" key={label}><span className={`summary-icon ${index === 3 ? 'terracotta' : ''}`}><Icon size={23} /></span><span>{label}</span><strong>{value.toLocaleString('en-GB')}</strong></article>)}</div>}
    <section className="panel students-panel"><div className="students-header"><div><span className="eyebrow">STUDENT DIRECTORY</span><h2>Student directory</h2></div><form onSubmit={submitSearch} className="search-form"><label className="sr-only" htmlFor="student-search">Search by name or email</label><div className="search-input"><Search size={18} /><input id="student-search" value={input} maxLength={100} onChange={(event) => setInput(event.target.value)} placeholder="Search by name or email" /></div><button type="submit" className="button button-outline button-small">Search</button></form></div>
      {loading ? <Loading text="Loading student accounts…" /> : data ? <><div className="table-wrapper"><table><thead><tr><th scope="col">Student</th><th scope="col">Email verification</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col">Action</th></tr></thead><tbody>{data.students.map((student) => <tr key={student.id}><td><div className="table-student"><span className="avatar small">{student.name.slice(0, 1).toUpperCase()}</span><div><strong>{student.name}</strong><span>{student.email}</span></div></div></td><td><span className={`badge ${student.emailVerified ? 'badge-green' : 'badge-soft'}`}>{student.emailVerified ? 'Verified' : 'Pending'}</span></td><td><span className={`status-text ${student.status === 'SUSPENDED' ? 'status-suspended' : ''}`}><span />{student.status === 'ACTIVE' ? 'Active' : 'Suspended'}</span></td><td className="date-cell">{student.createdAt ? new Date(student.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'}</td><td><button className={`status-action ${student.status === 'ACTIVE' ? 'danger' : ''}`} onClick={() => updateStatus(student)} disabled={!!changing}>{changing === student.id ? 'Updating…' : student.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</button></td></tr>)}</tbody></table>{data.students.length === 0 && <div className="empty-state"><UserRound size={35} /><h3>{search ? 'No students found' : 'No students yet'}</h3><p>{search ? 'Try searching with another name or email.' : 'Students will appear here after they register.'}</p>{search && <button className="text-link" onClick={() => { setInput(''); setSearch(''); setPage(1); }}>View all students</button>}</div>}</div><div className="table-footer"><span>{data.total.toLocaleString('en-GB')} students · Page {page.toLocaleString('en-GB')} of {pages.toLocaleString('en-GB')}</span><div><button className="icon-button" disabled={page <= 1 || loading} onClick={() => setPage((v) => v - 1)} aria-label="Previous page"><ChevronLeft size={20} /></button><button className="icon-button" disabled={page >= pages || loading} onClick={() => setPage((v) => v + 1)} aria-label="Next page"><ChevronRight size={20} /></button></div></div></> : <div className="empty-state"><p>The student directory could not be loaded.</p><button onClick={() => setReload((v) => v + 1)} className="button button-outline">Try again</button></div>}
    </section><p className="admin-footnote"><ShieldCheck size={16} /> Account status changes are recorded in the admin audit log.</p>
  </AppShell>;
}
