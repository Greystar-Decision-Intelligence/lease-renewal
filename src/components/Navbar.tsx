'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_LINKS = [
  { href: '/',       label: 'Dashboard' },
  { href: '/model',  label: 'Model Intelligence' },
];

export function Navbar({ breadcrumb }: { breadcrumb?: { label: string; href?: string }[] }) {
  const pathname = usePathname();

  return (
    <nav
      className="sticky top-0 z-50 flex items-center justify-between px-8 py-0 h-16"
      style={{ backgroundColor: 'var(--gs-navy)' }}
    >
      {/* Logo + wordmark */}
      <div className="flex items-center gap-6 shrink-0">
        <Link href="/" className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--gs-gold)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <path
                d="M12 4C7.58 4 4 7.58 4 12c0 4.42 3.58 8 8 8 2.21 0 4.21-.9 5.66-2.34V12h-6v2h3.8c-.68 1.66-2.3 2.8-4.16 2.8C8.56 16.8 6 14.24 6 11.04S8.56 5.2 11.76 5.2c1.56 0 2.96.6 4.02 1.58L17.2 5.36A7.94 7.94 0 0 0 12 4z"
                fill="#0E2044"
              />
            </svg>
          </div>
          <span className="text-white font-semibold tracking-[0.18em] text-sm">GREYSTAR</span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: active ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: active ? '#FFFFFF' : 'var(--gs-gold-light)',
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Breadcrumb / page title */}
      {breadcrumb && breadcrumb.length > 0 && (
        <div className="flex items-center gap-2 text-sm absolute left-1/2 -translate-x-1/2">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span style={{ color: 'var(--gs-navy-light)' }}>/</span>}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="transition-colors"
                  style={{ color: 'var(--gs-gold-light)' }}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-white font-medium">{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Right side */}
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-white text-xs font-medium">Karishma Rana</p>
          <p className="text-xs" style={{ color: 'var(--gs-gold-light)' }}>Asset Manager</p>
        </div>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ backgroundColor: 'var(--gs-gold)', color: 'var(--gs-navy)' }}
        >
          KR
        </div>
      </div>
    </nav>
  );
}
