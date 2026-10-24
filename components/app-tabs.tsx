'use client';

/**
 * The app's bottom tab bar: Today, Mind, Health, Care. Each tab stays lit for
 * the screens under it (a check-in belongs to Today, the timeline to Health).
 * Hidden on the entry screen and onboarding, which come before the app.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = { href: string; label: string; match: string[]; icon: React.ReactNode };

const TABS: Tab[] = [
  {
    href: '/home',
    label: 'Today',
    match: ['/home', '/check-in', '/assistant'],
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    href: '/mind',
    label: 'Mind',
    match: ['/mind'],
    icon: (
      <>
        <circle cx="12" cy="5.5" r="2.2" />
        <circle cx="5.5" cy="18" r="2.2" />
        <circle cx="18.5" cy="18" r="2.2" />
        <circle cx="12" cy="18" r="2.2" />
        <path d="M12 7.7v8.1M10.7 7.4 6.6 16M13.3 7.4l4.1 8.6" />
      </>
    ),
  },
  {
    href: '/health',
    label: 'Health',
    match: ['/health', '/timeline', '/real-signal'],
    icon: <path d="M3 12h4l2.2-5.5 4.2 11 2.4-5.5H21" />,
  },
  {
    href: '/care',
    label: 'Care',
    match: ['/care', '/summary', '/trials', '/family'],
    icon: <path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.9a4.3 4.3 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10Z" />,
  },
];

const HIDDEN = ['/app', '/onboarding'];

const within = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export default function AppTabs() {
  const path = usePathname() ?? '';
  if (HIDDEN.some((p) => within(path, p))) return null;

  return (
    <nav aria-label="Main" className="app-tabs">
      {TABS.map((tab) => {
        const active = tab.match.some((m) => within(path, m));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            data-active={active || undefined}
            className="app-tab tap"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {tab.icon}
            </svg>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
