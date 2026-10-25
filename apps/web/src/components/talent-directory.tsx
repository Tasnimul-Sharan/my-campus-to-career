'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, ArrowUpRight, Calculator, ChevronLeft, ChevronRight, Code2, Compass, GraduationCap, LayoutGrid, MapPin, Paintbrush, PenLine, RefreshCw, Search, SlidersHorizontal, TrendingUp, UsersRound, Wrench, X } from 'lucide-react';
import { api } from '@/lib/api';
import { TALENT_CATEGORIES, TALENT_AVAILABILITIES, talentAvailabilityLabel, type TalentCard, type TalentMeta, type TalentListing } from '@/lib/talent';
import styles from './talent-directory.module.css';

const categoryIcons = { 'software-it': Code2, 'design-creative': Paintbrush, 'marketing-sales': TrendingUp, 'accounting-finance': Calculator, engineering: Wrench, 'content-communication': PenLine, exploring: Compass };
const initialFilters = { q: '', category: '', subject: '', university: '', city: '', skill: '', availability: '', page: 1 };
const number = (value: number) => value.toLocaleString('en-US');

export function TalentAvatar({ student, large = false }: { student: Pick<TalentCard, 'id' | 'name' | 'profilePictureUrl'>; large?: boolean }) {
  const [failedSource, setFailedSource] = useState('');
  const source = student.profilePictureUrl || '';
  const showImage = source.startsWith(`/api/v1/talent/${encodeURIComponent(student.id)}/picture`) && source !== failedSource;
  const initials = student.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word.charAt(0)).join('').toUpperCase() || '?';
  return <span className={`${styles.avatar} ${large ? styles.avatarLarge : ''}`}>{showImage ? <img src={source} alt={`${student.name}'s profile picture`} width={large ? 112 : 64} height={large ? 112 : 64} loading={large ? 'eager' : 'lazy'} decoding="async" onError={() => setFailedSource(source)} /> : <span role="img" aria-label={`${student.name}'s initials`}>{initials}</span>}</span>;
}

function StudentCard({ student }: { student: TalentCard }) {
  return <article className={styles.card}><Link href={`/talent/${encodeURIComponent(student.id)}`} className={styles.cardLink}>
    <div className={styles.cardTop}><TalentAvatar student={student} /><span className={styles.categoryTag}>{student.category.name}</span></div>
    <h3>{student.name}</h3><p className={styles.headline}>{student.headline || 'Student exploring their next opportunity'}</p>
    <div className={styles.academics}><GraduationCap size={16} aria-hidden="true" /><div><span>{student.university}</span>{student.department && <small>{student.department}</small>}</div></div>
    {student.city && <p className={styles.city}><MapPin size={14} aria-hidden="true" />{student.city}</p>}
    <ul className={styles.skills} aria-label={`${student.name}'s skills`}>{student.skills.slice(0, 3).map(skill => <li key={skill}>{skill}</li>)}{student.skills.length > 3 && <li className={styles.moreSkills}>+{student.skills.length - 3}</li>}</ul>
    <div className={styles.cardBottom}><span className={styles.availability}><span aria-hidden="true" />{talentAvailabilityLabel(student.availability)}</span><span className={styles.viewProfile}>View profile <ArrowUpRight size={17} aria-hidden="true" /></span></div>
  </Link></article>;
}

export function TalentDirectory() {
  const [meta, setMeta] = useState<TalentMeta | null>(null);
  const [metaFailed, setMetaFailed] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState('');
  const [listing, setListing] = useState<TalentListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setMetaFailed(false);
    api<TalentMeta>('/talent/meta', { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setMeta(data); }).catch(() => { if (!controller.signal.aborted) setMetaFailed(true); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters(current => current.q === search.trim() ? current : { ...current, q: search.trim(), page: 1 }), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== '') query.set(key, String(value));
    setLoading(true);
    setFailed(false);
    setListing(null);
    api<TalentListing>(`/talent?${query}`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      if (data.totalPages > 0 && data.page > data.totalPages) {
        setFilters(current => ({ ...current, page: data.totalPages }));
        return;
      }
      setListing(data);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, refresh]);

  const updateFilter = (key: Exclude<keyof typeof initialFilters, 'q' | 'page'>, value: string) => setFilters(current => ({ ...current, [key]: value, page: 1 }));
  const clearFilters = () => { setSearch(''); setFilters(initialFilters); };
  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setFilters(current => ({ ...current, q: search.trim(), page: 1 })); };
  const hasFilters = Object.entries(filters).some(([key, value]) => key !== 'page' && value !== '') || search !== '';
  const categoryCounts = new Map<string, number>(meta?.categories.map(category => [category.slug, category.count]));
  const selectedCategory = meta?.categories.find(category => category.slug === filters.category)?.name || TALENT_CATEGORIES.find(category => category.slug === filters.category)?.label;
  const categories = [{ slug: '', label: 'All talent' }, ...TALENT_CATEGORIES];
  const paginationPages = listing ? Array.from(new Set([1, listing.page - 1, listing.page, listing.page + 1, listing.totalPages].filter(page => page >= 1 && page <= listing.totalPages))).sort((a, b) => a - b) : [];
  const changePage = (page: number) => {
    setFilters(current => ({ ...current, page }));
    resultsRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  return <section className={styles.directory} id="student-talent" aria-labelledby="directory-title"><div className={styles.inner}>
    <div className={styles.heading}><div><span className="eyebrow">A WORLD OF POTENTIAL</span><h2 id="directory-title">Find your next<br /><span>fresh perspective.</span></h2></div><div className={styles.headingAside}><p>Start with a professional interest.<br />Discover the person behind the profile.</p><span><UsersRound size={16} aria-hidden="true" />{meta ? `${number(meta.totalStudents)} public student ${meta.totalStudents === 1 ? 'profile' : 'profiles'}` : 'Student talent, in one place'}</span></div></div>

    <div className={styles.categories} role="group" aria-label="Filter by professional category">{categories.map(category => {
      const Icon = category.slug ? categoryIcons[category.slug as keyof typeof categoryIcons] : LayoutGrid;
      const count = category.slug ? categoryCounts.get(category.slug) : meta?.totalStudents;
      return <button className={`${styles.category} ${filters.category === category.slug ? styles.categorySelected : ''}`} type="button" key={category.slug || 'all'} onClick={() => updateFilter('category', category.slug)} aria-pressed={filters.category === category.slug}><span className={styles.categoryIcon}><Icon size={22} strokeWidth={1.6} aria-hidden="true" /></span><span className={styles.categoryName}>{category.label}</span><span className={styles.categoryCount} aria-label={count === undefined ? 'Count loading' : `${number(count)} public profiles`}>{count === undefined ? '—' : number(count)}</span></button>;
    })}</div>

    <div className={styles.filterPanel}><form className={styles.search} onSubmit={submitSearch}><label htmlFor="talent-search" className="sr-only">Search students by name, skill or career interest</label><Search size={21} aria-hidden="true" /><input id="talent-search" name="q" type="search" value={search} maxLength={100} placeholder="Search by name, skill or career interest..." onChange={event => setSearch(event.target.value)} /><button type="submit">Find talent <ArrowRight size={17} aria-hidden="true" /></button></form>
      <div className={styles.filterLabel}><span><SlidersHorizontal size={15} aria-hidden="true" /> Refine your search</span><small>Academic subject is an optional filter.</small></div>
      <div className={styles.filters}>
        <label htmlFor="talent-skill">Skill<select id="talent-skill" value={filters.skill} onChange={event => updateFilter('skill', event.target.value)}><option value="">Any skill</option>{meta?.skills.map(skill => <option key={skill} value={skill}>{skill}</option>)}</select></label>
        <label htmlFor="talent-subject">Academic subject<select id="talent-subject" value={filters.subject} onChange={event => updateFilter('subject', event.target.value)}><option value="">Any subject</option>{meta?.subjects.map(subject => <option key={subject} value={subject}>{subject}</option>)}</select></label>
        <label htmlFor="talent-university">University<select id="talent-university" value={filters.university} onChange={event => updateFilter('university', event.target.value)}><option value="">Any university</option>{meta?.universities.map(university => <option key={university} value={university}>{university}</option>)}</select></label>
        <label htmlFor="talent-city">Location<select id="talent-city" value={filters.city} onChange={event => updateFilter('city', event.target.value)}><option value="">Any location</option>{meta?.cities.map(city => <option key={city} value={city}>{city}</option>)}</select></label>
        <label htmlFor="talent-availability">Looking for<select id="talent-availability" value={filters.availability} onChange={event => updateFilter('availability', event.target.value)}><option value="">Any opportunity</option>{(meta?.availabilities || TALENT_AVAILABILITIES).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      {metaFailed && <p className={styles.metaError}><AlertCircle size={15} aria-hidden="true" /> Filter options could not be loaded.<button type="button" onClick={() => setRefresh(value => value + 1)}>Try again</button></p>}
    </div>

    <div className={styles.results} ref={resultsRef} aria-busy={loading}>
      <div className={styles.resultsHeading}><div aria-live="polite" aria-atomic="true"><h3>{selectedCategory || 'Discover student talent'}</h3><p>{loading ? 'Finding fresh perspectives...' : failed ? 'We could not load profiles.' : listing?.total ? `Showing ${number((listing.page - 1) * listing.pageSize + 1)}–${number(Math.min(listing.page * listing.pageSize, listing.total))} of ${number(listing.total)} ${listing.total === 1 ? 'profile' : 'profiles'}` : 'No matching profiles yet.'}</p></div>{hasFilters && <button className={styles.clear} type="button" onClick={clearFilters}><X size={15} aria-hidden="true" /> Clear filters</button>}</div>
      {loading ? <><span className="sr-only" role="status">Loading student profiles</span><div className={styles.grid} aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className={styles.skeleton} key={index}><span /><i /><i /><i /><div><b /><b /><b /></div></div>)}</div></> : failed ? <div className={styles.empty} role="alert"><span className={styles.stateIcon}><AlertCircle size={28} strokeWidth={1.4} aria-hidden="true" /></span><h3>A small pause in discovery.</h3><p>We couldn&apos;t load student profiles. Please check your connection and try again.</p><button type="button" className="button button-primary" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={17} aria-hidden="true" /> Try again</button></div> : listing && listing.students.length > 0 ? <><div className={styles.grid}>{listing.students.map(student => <StudentCard key={student.id} student={student} />)}</div>{listing.totalPages > 1 && <nav className={styles.pagination} aria-label="Student profile pages"><button type="button" aria-label="Previous page" onClick={() => changePage(listing.page - 1)} disabled={listing.page <= 1}><ChevronLeft size={17} aria-hidden="true" /><span>Previous</span></button><div>{paginationPages.map((page, index) => <span key={page}>{index > 0 && page - paginationPages[index - 1] > 1 && <span className={styles.ellipsis} aria-hidden="true">…</span>}<button type="button" aria-label={`Page ${page}`} aria-current={page === listing.page ? 'page' : undefined} onClick={() => changePage(page)}>{number(page)}</button></span>)}</div><button type="button" aria-label="Next page" onClick={() => changePage(listing.page + 1)} disabled={listing.page >= listing.totalPages}><span>Next</span><ChevronRight size={17} aria-hidden="true" /></button></nav>}</> : <div className={styles.empty}><span className={styles.stateIcon}><Search size={28} strokeWidth={1.4} aria-hidden="true" /></span><h3>{hasFilters ? 'The right person could be one filter away.' : 'The next generation is on its way.'}</h3><p>{hasFilters ? 'Try another skill, broaden your search or clear your filters to explore more student profiles.' : 'Students who choose to publish their profiles will appear here. Be one of the first to introduce your potential.'}</p>{hasFilters ? <button type="button" className="button button-primary" onClick={clearFilters}>Clear filters <ArrowRight size={17} aria-hidden="true" /></button> : <Link href="/register" className="button button-primary">Create a student profile <ArrowUpRight size={17} aria-hidden="true" /></Link>}</div>}
    </div>
    <p className={styles.directoryNote}><Compass size={16} aria-hidden="true" /> Every profile is shared by the student. Every connection starts with possibility.</p>
  </div></section>;
}
