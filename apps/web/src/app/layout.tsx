import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: { default: 'MyCampusToCareer — Start your next chapter', template: '%s | MyCampusToCareer' }, description: 'Build your student profile and showcase your education, skills and campus experiences. Take your first step from campus to career.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to main content</a>{children}</body></html>; }
