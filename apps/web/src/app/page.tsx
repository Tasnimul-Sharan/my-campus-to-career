import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Code2,
  GraduationCap,
  Layers3,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { Brand } from '@/components/ui';
import { SmoothScroll } from '@/components/smooth-scroll';
import './home.css';

const profileItems = [
  {
    id: 'your-education',
    icon: GraduationCap,
    title: 'Your education',
    description: 'Bring your university, department and academic journey together. Give every new chapter a place in your story.',
    tags: ['University', 'Department', 'Academic details'],
    cue: 'Start with where you are',
  },
  {
    id: 'your-skills',
    icon: Code2,
    title: 'Your skills',
    description: 'Show what you know, from technical skills to the way you work with others. Add new skills as you learn.',
    tags: ['Technical skills', 'People skills', 'New interests'],
    cue: 'Make your strengths visible',
  },
  {
    id: 'your-experience',
    icon: Sparkles,
    title: 'Your experiences',
    description: 'Your story goes beyond the classroom. Highlight the clubs, volunteering and campus activities that shaped you.',
    tags: ['Campus clubs', 'Volunteering', 'Activities'],
    cue: 'Every experience counts',
  },
];

const journeyItems = [
  { title: 'Education', href: '#your-education' },
  { title: 'Skills', href: '#your-skills' },
  { title: 'Experience', href: '#your-experience' },
  { title: 'Your future', href: '#whats-next' },
];

const steps = [
  {
    icon: UserPlus,
    title: 'Create your account',
    description: 'Register with your name and email, then verify your email address. Your journey starts with a free account.',
  },
  {
    icon: UserRound,
    title: 'Build your profile',
    description: 'Add your education, skills, career objective and activities. Bring the things that make you, you into one place.',
  },
  {
    icon: RefreshCw,
    title: 'Keep your story growing',
    description: 'Update your profile with each new skill and experience. Let it grow with you, from your first semester onward.',
  },
];

const roadmapItems = [
  {
    icon: UserRound,
    title: 'Student profile',
    description: 'Create your account and bring your education, skills, goals and campus experiences together.',
    available: true,
  },
  {
    icon: BookOpen,
    title: 'Courses & enrollment',
    description: 'Explore skill development courses and enroll in learning opportunities that support your next step.',
    available: false,
  },
  {
    icon: MapPin,
    title: 'In-person workshops',
    description: 'Discover physical workshops, view event details and register for hands-on learning experiences.',
    available: false,
  },
  {
    icon: Layers3,
    title: 'Projects & certificates',
    description: 'Upload your projects and certificates to keep a record of the work you have done and the skills you have earned.',
    available: false,
  },
  {
    icon: BriefcaseBusiness,
    title: 'Jobs & applications',
    description: 'Browse job listings and apply for opportunities as you take your next step from campus to career.',
    available: false,
  },
  {
    icon: ShieldCheck,
    title: 'Secure payments',
    description: 'A checkout flow for course and workshop fees, with payment status and confirmation in one place.',
    available: false,
  },
];

export default function Home() {
  return (
    <div className="landing">
      <SmoothScroll />
      <header className="site-header container">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#your-profile">Your profile</a>
          <a href="#how-it-works">How it works</a>
          <a href="#whats-next">What&apos;s next</a>
        </nav>
        <div className="header-actions">
          <Link className="header-login" href="/login">Log in</Link>
          <Link href="/register" className="button button-primary button-small">
            Get started <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main id="main-content">
        <section className="hero container" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="hero-eyebrow">
              <span className="tiny-dot" aria-hidden="true" /> Your first step from campus to career
            </span>
            <h1 id="hero-title">Your campus today.<br /><span>Your career tomorrow.</span></h1>
            <p>Give your education, skills and experiences a place to shine. Build your profile and start your next chapter.</p>
            <div className="hero-actions">
              <Link href="/register" className="button button-primary button-large">
                Build my profile <ArrowUpRight size={20} aria-hidden="true" />
              </Link>
              <a href="#how-it-works" className="hero-secondary">
                How it works <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
            <div className="hero-assurances">
              <span><CheckCircle2 size={17} aria-hidden="true" /> Free account</span>
              <span><CheckCircle2 size={17} aria-hidden="true" /> Your profile, your control</span>
            </div>
          </div>
          <div className="hero-visual" role="img" aria-label="A student profile bringing together education, skills and goals on the journey from campus to career">
            <div className="hero-visual-word">YOUR NEXT<br /><span>CHAPTER.</span></div>
            <div className="visual-route" aria-hidden="true">
              <span className="route-dot route-dot-one" />
              <span className="route-dot route-dot-two" />
              <ArrowUpRight className="route-arrow" size={78} strokeWidth={1.2} />
            </div>
            <div className="floating-label campus-label"><GraduationCap size={20} /> Campus</div>
            <div className="floating-label career-label"><BriefcaseBusiness size={19} /> Career</div>
            <div className="illustration-profile">
              <div className="illustration-top">
                <div className="illustration-avatar"><UserRound size={28} /></div>
                <span className="preview-label">PROFILE PREVIEW</span>
                <span className="mini-star"><Sparkles size={21} /></span>
              </div>
              <h3>A profile that<br />tells your story.</h3>
              <p>Education · Skills · Activities</p>
              <div className="illustration-checks">
                <span><Check size={14} /> Education</span>
                <span><Check size={14} /> Skills</span>
                <span><Check size={14} /> Goals</span>
              </div>
              <div className="illustration-progress"><span /><span /><span /></div>
              <div className="illustration-bottom">
                <span>YOUR STORY STARTS HERE</span><ArrowUpRight size={22} />
              </div>
            </div>
            <div className="visual-badge">
              <span>01</span><p>Your first step<br /><strong>Your profile</strong></p>
            </div>
          </div>
        </section>

        <section className="journey-strip" aria-label="Explore your journey">
          <div className="container journey-strip-inner">
            <div className="journey-intro">
              <span className="eyebrow">YOUR JOURNEY, IN ONE PLACE</span>
              <p>From what you learn<br />to who you become.</p>
            </div>
            <nav className="journey-links" aria-label="Explore profile and future features">
              {journeyItems.map(({ title, href }, index) => (
                <a className="journey-link" href={href} key={title}>
                  <span className="journey-number">0{index + 1}</span>
                  <span>{title}</span>
                  <ArrowUpRight size={21} strokeWidth={1.5} aria-hidden="true" />
                </a>
              ))}
            </nav>
          </div>
        </section>

        <section className="profile-section container" id="your-profile" aria-labelledby="profile-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MORE THAN A STUDENT ID</span>
              <h2 id="profile-title">One profile.<br />So much potential.</h2>
            </div>
            <p>You have a story to tell, even before your first job. Start with what you have learned and achieved. We&apos;ll give it a place to grow.</p>
          </div>
          <div className="feature-grid">
            {profileItems.map(({ id, icon: Icon, title, description, tags, cue }, index) => (
              <article className="feature-card" id={id} key={title}>
                <div className="feature-top">
                  <span className="feature-icon"><Icon size={28} strokeWidth={1.6} aria-hidden="true" /></span>
                  <span className="feature-number" aria-hidden="true">0{index + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
                <ul className="feature-tags" aria-label={title + ' includes'}>
                  {tags.map((tag) => <li key={tag}>{tag}</li>)}
                </ul>
                <div className="feature-bottom"><span>{cue}</span><ArrowUpRight size={20} aria-hidden="true" /></div>
              </article>
            ))}
          </div>
        </section>

        <section className="how-section" id="how-it-works" aria-labelledby="how-title">
          <div className="container how-inner">
            <div className="how-copy">
              <span className="eyebrow light">SMALL STEPS. BIG POSSIBILITIES.</span>
              <h2 id="how-title">A simple start.<br /><em>A future you shape.</em></h2>
              <p>Build your profile in a few simple steps. You don&apos;t need years of experience to start telling your story.</p>
              <Link href="/register" className="button button-cream">
                Let&apos;s get started <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            </div>
            <div className="steps-list">
              {steps.map(({ icon: Icon, title, description }, index) => (
                <article key={title}>
                  <span className="step-number">0{index + 1}</span>
                  <div className="step-content">
                    <span className="step-icon"><Icon size={24} strokeWidth={1.6} aria-hidden="true" /></span>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                </article>
              ))}
              <p className="steps-note"><RefreshCw size={16} aria-hidden="true" /> Your profile can be updated whenever your story changes.</p>
            </div>
          </div>
        </section>

        <section className="roadmap-section container" id="whats-next" aria-labelledby="roadmap-title">
          <div className="roadmap-heading">
            <span className="eyebrow">WHAT WE ARE BUILDING</span>
            <h2 id="roadmap-title">Your journey,<br />all together.</h2>
            <p>Your student profile is ready to start today. We&apos;re building the next steps in learning and career opportunities, one phase at a time.</p>
          </div>
          <div className="roadmap-grid">
            {roadmapItems.map(({ icon: Icon, title, description, available }) => (
              <article className={'roadmap-card' + (available ? ' available' : '')} key={title}>
                <div className="roadmap-top">
                  <span className="roadmap-icon"><Icon size={27} strokeWidth={1.6} aria-hidden="true" /></span>
                  <span className="roadmap-status">{available ? 'Available now' : 'Planned'}</span>
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="closing-section container" aria-labelledby="closing-title">
          <div className="closing-copy">
            <span className="eyebrow">THE NEXT CHAPTER IS YOURS</span>
            <h2 id="closing-title">Your future.<br /><span>Start it today.</span></h2>
            <p>Start with who you are today. Give your education, interests and ambitions a home, then build on them as you go.</p>
            <div className="closing-actions">
              <Link href="/register" className="button button-primary button-large">
                Create a free account <ArrowUpRight size={20} aria-hidden="true" />
              </Link>
              <Link href="/login" className="text-link">Already a member? Log in <ArrowRight size={17} aria-hidden="true" /></Link>
            </div>
            <span className="closing-note"><CheckCircle2 size={17} aria-hidden="true" /> Free to create. Yours to keep growing.</span>
          </div>
          <div className="closing-visual" role="img" aria-label="A profile preview with space for your education, skills and goals">
            <div className="closing-orbit" />
            <Sparkles className="closing-spark" size={42} strokeWidth={1.3} />
            <div className="closing-profile">
              <div className="closing-profile-top">
                <span className="closing-avatar"><UserRound size={33} strokeWidth={1.5} /></span>
                <div><span className="closing-profile-label">YOUR STUDENT PROFILE</span><h3 className="closing-profile-title">A little about you.</h3></div>
                <CheckCircle2 size={21} />
              </div>
              <p className="closing-profile-summary">Your journey is full of possibility.</p>
              <div className="closing-profile-tags"><span>Curious</span><span>Learning</span><span>Growing</span></div>
              <div className="closing-profile-row"><GraduationCap size={21} /><span>Your education</span><Check size={17} /></div>
              <div className="closing-profile-row"><Code2 size={21} /><span>Your skills & interests</span><Check size={17} /></div>
              <div className="closing-profile-row"><Sparkles size={21} /><span>Your goals & ambitions</span><Check size={17} /></div>
              <div className="closing-profile-footer"><span>A STORY ONLY YOU CAN TELL</span><ArrowUpRight size={24} /></div>
            </div>
            <span className="closing-visual-note"><span className="tiny-dot" /> Built one step at a time</span>
          </div>
        </section>
      </main>

      <footer className="site-footer container">
        <div className="footer-brand">
          <Brand />
          <p>A place for your student story,<br />and the next chapter ahead.</p>
        </div>
        <nav className="footer-links" aria-label="Footer navigation">
          <a href="#your-profile">Your profile</a>
          <a href="#how-it-works">How it works</a>
          <a href="#whats-next">What&apos;s next</a>
          <Link href="/register">Create an account</Link>
        </nav>
        <div className="footer-bottom">
          <span>© 2026 MyCampusToCareer</span>
          <span>From campus. Toward possibility.</span>
          <Link className="text-link" href="/admin/login">Admin access <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </footer>
    </div>
  );
}

