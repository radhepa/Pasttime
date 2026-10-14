import { useEffect, useState, type ReactNode } from 'react';
import type { MediaType } from '../types';
import { getCategory } from '../lib/categories';

/* ---------- Icons ---------- */

const PATHS: Record<string, string> = {
  timeline: 'M4 6h16M4 12h10M4 18h13',
  library: 'M5 4h3v16H5zM10.5 4h3v16h-3zM16 5.2l2.9-.8 3.6 15.4-2.9.8z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  back: 'M15 5l-7 7 7 7',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  down: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.9M4 4v4h4M4 13a8 8 0 0 0 14.9 3.9M20 20v-4h-4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  show: 'M3 6h18v12H3zM8 21h8',
  movie: 'M4 5h16v14H4zM4 9h16M8 5l-2 4M13 5l-2 4M18 5l-2 4',
  book: 'M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v14',
  game: 'M6 9h12a4 4 0 0 1 3.8 5.3l-.7 2.1a2.5 2.5 0 0 1-4.3.7L15 15H9l-1.8 2.1a2.5 2.5 0 0 1-4.3-.7l-.7-2.1A4 4 0 0 1 6 9zM8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  stats: 'M5 20V11M12 20V4M19 20v-6',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  timer: 'M12 8v5l3 2M9 2h6M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  repeat: 'M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5',
  flame: 'M12 21c-4 0-7-2.7-7-6.5 0-3.4 2.6-5.6 4-8.5.6 1.6 1.4 2.6 2.6 3.3C12 6.6 13 4.4 15 3c0 3.5 4 6 4 11.5 0 3.8-3 6.5-7 6.5z',
  leaf: 'M5 19c0-8 6-14 15-14 0 9-6 15-14 15M5 19l7-7',
  cloud: 'M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.5 4.5 0 0 0 7 18Z',
  'cloud-off': 'M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.5 4.5 0 0 0 7 18ZM4 4l16 16',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  up: 'M6 15l6-6 6 6',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  offline: 'M2 8.8a15 15 0 0 1 4.2-2.6M5 12.9a10 10 0 0 1 5.2-2.7M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18M17.8 11.8a10 10 0 0 1 1.2 1.1M14.5 6.4A15 15 0 0 1 22 8.8',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
};

export function Icon({ name, className = 'size-5', strokeWidth = 1.9 }: { name: string; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

/* ---------- Stars ---------- */

const STAR = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z';

/** Display stars, with partial fill for averages like 4.3. */
export function StarDisplay({ value, size = 'size-4' }: { value?: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-px" aria-label={value ? `${value.toFixed(1)} out of 5` : 'Not rated'}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, (value ?? 0) - i));
        return (
          <span key={i} className={`relative ${size}`}>
            <svg viewBox="0 0 24 24" className={`absolute inset-0 ${size} text-line`} fill="currentColor">
              <path d={STAR} />
            </svg>
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <svg viewBox="0 0 24 24" className={`${size} text-star`} fill="currentColor">
                <path d={STAR} />
              </svg>
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Tap a star to rate 1–5; tap the current rating again to clear it. */
export function StarInput({ value, onChange, size = 'size-8' }: { value?: number; onChange: (v: number | undefined) => void; size?: string }) {
  const [hover, setHover] = useState<number>();
  const shown = hover ?? value ?? 0;
  return (
    <span className="inline-flex items-center gap-1" onMouseLeave={() => setHover(undefined)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onMouseEnter={() => setHover(n)}
          onClick={(e) => {
            e.stopPropagation();
            onChange(value === n ? undefined : n);
          }}
          className="transition-transform active:scale-90"
        >
          <svg viewBox="0 0 24 24" className={`${size} ${n <= shown ? 'text-star' : 'text-line'}`} fill="currentColor">
            <path d={STAR} />
          </svg>
        </button>
      ))}
    </span>
  );
}

/* ---------- Cover art ---------- */

export const catColor = (type: MediaType) => `var(--c-${getCategory(type).color})`;

export function Cover({ src, title, type, className = '' }: { src?: string; title: string; type: MediaType; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  if (src && !broken) {
    return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={`object-cover bg-surface-2 ${className}`} />;
  }
  const color = catColor(type);
  return (
    <div
      className={`@container overflow-hidden ${className}`}
      style={{ background: `color-mix(in srgb, ${color} 22%, var(--surface))`, color: `color-mix(in srgb, ${color} 55%, var(--ink))` }}
    >
      {/* Padding lives on this inner box so cqw measures the cover, not the page. */}
      <div className="flex size-full flex-col justify-between p-[9cqw] @max-[56px]:hidden">
        <span className="display line-clamp-4 text-[clamp(0.55rem,17cqw,1.6rem)]">{title}</span>
        <span className="truncate text-[clamp(0.45rem,7cqw,0.65rem)] font-semibold tracking-[0.08em] uppercase opacity-70">{getCategory(type).name}</span>
      </div>
    </div>
  );
}

export function TypeBadge({ type }: { type: MediaType }) {
  const c = getCategory(type);
  const color = catColor(type);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      <span className="text-[10px] leading-none">{c.emoji}</span>
      {c.name}
    </span>
  );
}

/* ---------- Sheet (bottom sheet on phones, dialog on desktop) ---------- */

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <div className="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-sheet pb-safe relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-surface shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between bg-surface px-5 pt-4 pb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-surface-2 p-1.5 text-muted" aria-label="Close">
            <Icon name="close" className="size-4" />
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  className = '',
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'soft' | 'ghost' | 'danger';
  className?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const styles = {
    primary: 'bg-accent text-on-accent',
    soft: 'bg-surface-2 text-ink',
    ghost: 'text-muted hover:text-ink',
    danger: 'bg-red-500/12 text-red-500',
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-semibold transition active:scale-[.97] disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}
