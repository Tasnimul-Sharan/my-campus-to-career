import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Code2, GraduationCap, Lightbulb, Palette, Sparkles, UserPlus, UserRound, Eye } from 'lucide-react';
import { Brand } from '@/components/ui';
import { SmoothScroll } from '@/components/smooth-scroll';
import { TalentDirectory } from '@/components/talent-directory';
import './home.css';

export const metadata: Metadata = {
  title: 'Discover student talent — MyCampusToCareer',
  description: 'Discover student talent by career interests, skills and education. Explore public profiles and connect through the links students choose to share.',
};

const steps = [
  { icon: UserPlus, title: 'Start with you', description: 'Create your free student account and verify your email. Your next chapter starts with a simple introduction.' },
  { icon: UserRound, title: 'Make your potential visible', description: 'Add your skills, education and career interests. Choose the professional category that feels right for you.' },
  { icon: Eye, title: 'Publish when you are ready', description: 'Choose to appear in the talent directory and select the contact links you want to share. You stay in control.' },
];

export default function Home() {
  return (
    <div className="landing talent-home">
      <SmoothScroll />
      <header className="site-header container">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#student-talent">Find talent</a>
          <a href="#how-it-works">For students</a>
          <a href="#our-approach">Our approach</a>
        </nav>
        <div className="header-actions">
          <Link className="header-login" href="/login">Log in</Link>
          <Link href="/register" className="button button-primary button-small">Create a profile <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
      </header>

      <main id="main-content">
        <section className="hiring-hero container" aria-labelledby="hero-title">
          <div className="hiring-hero-copy">
            <span className="hero-eyebrow"><span className="tiny-dot" aria-hidden="true" /> FRESH PERSPECTIVES. NEW POSSIBILITIES.</span>
            <h1 id="hero-title">Meet your next<br /><span>great hire.</span></h1>
            <p>Discover ambitious students, explore their skills, and connect with the people ready for their first opportunity.</p>
            <div className="hero-actions">
              <a href="#student-talent" className="button button-primary button-large">Browse student talent <ArrowDown size={19} aria-hidden="true" /></a>
              <Link href="/register" className="hero-secondary">I&apos;m a student <ArrowUpRight size={18} aria-hidden="true" /></Link>
            </div>
            <div className="hiring-hero-note"><span className="hero-note-line" aria-hidden="true" /><p>Big ideas can come<br /><strong>from a first opportunity.</strong></p></div>
          </div>
          <div className="potential-visual" aria-label="Students bring skills, education and fresh perspectives to their next opportunity">
            <div className="visual-heading"><span>THE NEXT GENERATION</span><Sparkles size={19} aria-hidden="true" /></div>
            <div className="potential-orbit" aria-hidden="true" />
            <div className="potential-icon icon-code" aria-hidden="true"><Code2 size={25} strokeWidth={1.5} /></div>
            <div className="potential-icon icon-design" aria-hidden="true"><Palette size={25} strokeWidth={1.5} /></div>
            <div className="potential-icon icon-ideas" aria-hidden="true"><Lightbulb size={27} strokeWidth={1.5} /></div>
            <div className="potential-center"><span className="potential-star" aria-hidden="true">✳</span><p>Fresh minds.<br /><em>Real potential.</em></p><span className="potential-caption">THEIR NEXT CHAPTER COULD BE WITH YOU.</span></div>
            <div className="potential-ticket"><GraduationCap size={24} strokeWidth={1.5} aria-hidden="true" /><div><span>FROM CAMPUS</span><strong>To what comes next.</strong></div><ArrowUpRight size={23} aria-hidden="true" /></div>
            <span className="potential-side-note" aria-hidden="true">A LITTLE CURIOSITY GOES A LONG WAY</span>
          </div>
        </section>

        <div className="discovery-strip">
          <div className="container discovery-strip-inner"><span className="eyebrow">GOOD PEOPLE. GREAT POSSIBILITIES.</span><p>Explore skills. Discover potential. <strong>Start a conversation.</strong></p><ArrowDown size={21} aria-hidden="true" /></div>
        </div>

        <TalentDirectory />

        <section className="approach-section" id="our-approach" aria-labelledby="approach-title">
          <div className="container approach-inner">
            <div><span className="eyebrow">A DIFFERENT STARTING POINT</span><h2 id="approach-title">See the person.<br /><span>Discover the potential.</span></h2></div>
            <div className="approach-copy"><p>A degree is one part of a student&apos;s story. Their interests, skills and campus experiences help you see where they want to go.</p><ul><li><Check size={18} aria-hidden="true" /> Browse by professional interest</li><li><Check size={18} aria-hidden="true" /> Explore education and practical skills</li><li><Check size={18} aria-hidden="true" /> Connect through student-shared links</li></ul><a className="text-link" href="#student-talent">Meet the talent <ArrowRight size={18} aria-hidden="true" /></a></div>
          </div>
        </section>

        <section className="how-section" id="how-it-works" aria-labelledby="how-title">
          <div className="container how-inner">
            <div className="how-copy"><span className="eyebrow light">FOR STUDENTS, WITH AMBITION</span><h2 id="how-title">You have potential.<br /><em>Give it a place to shine.</em></h2><p>Bring your education, skills and ambitions together. Build a public profile that helps people discover what you could bring to their team.</p><Link href="/register" className="button button-cream">Create my free profile <ArrowUpRight size={18} aria-hidden="true" /></Link><span className="publish-note"><Check size={16} aria-hidden="true" /> Public visibility is always your choice.</span></div>
            <div className="publish-steps">{steps.map(({ icon: Icon, title, description }, index) => <article key={title}><span className="publish-step-number">0{index + 1}</span><div><Icon size={23} strokeWidth={1.5} aria-hidden="true" /><h3>{title}</h3><p>{description}</p></div></article>)}</div>
          </div>
        </section>

        <section className="hiring-closing container" aria-labelledby="closing-title"><span className="eyebrow">THE NEXT CHAPTER STARTS HERE</span><h2 id="closing-title">A fresh perspective.<br /><span>Your next connection.</span></h2><p>Find a student with the skills you are looking for, or create a profile and let your own potential be discovered.</p><div><a href="#student-talent" className="button button-primary button-large">Find student talent <ArrowUpRight size={19} aria-hidden="true" /></a><Link href="/register" className="button button-outline button-large">Create a profile <ArrowUpRight size={19} aria-hidden="true" /></Link></div></section>
      </main>

      <footer className="site-footer container"><div className="footer-brand"><Brand /><p>Where student potential<br />meets a world of possibility.</p></div><nav className="footer-links" aria-label="Footer navigation"><a href="#student-talent">Find talent</a><a href="#how-it-works">For students</a><Link href="/register">Create a profile</Link><Link href="/login">Log in</Link></nav><div className="footer-bottom"><span>© 2026 MyCampusToCareer</span><span>From campus. Toward possibility.</span><Link className="text-link" href="/admin/login">Admin access <ArrowUpRight size={14} aria-hidden="true" /></Link></div></footer>
    </div>
  );
}
