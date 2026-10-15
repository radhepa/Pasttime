import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import type { MediaType } from '../types';
import { getCategory } from '../lib/categories';
import { haptic } from '../lib/feedback';
import { useSettings } from '../lib/settings';
import { fmtRating, outOf, ratingWords, scaled, STEP, type RatingScale } from '../lib/ratings';

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

/** `draw`: the stroke draws itself in when the icon appears (used for check marks). */
export function Icon({ name, className = 'size-5', strokeWidth = 1.9, draw }: { name: string; className?: string; strokeWidth?: number; draw?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} pathLength={draw ? 1 : undefined} className={draw ? 'animate-draw' : undefined} />
    </svg>
  );
}

/* ---------- Stars ---------- */

const STAR = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z';

/** One star, filled from the left by `fill` (0–1): half stars and averages like 4.3 show as part-filled. */
function StarShape({ fill, className, style }: { fill: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={`relative block ${className ?? ''}`} style={style}>
      <svg viewBox="0 0 24 24" className="block size-full text-line" fill="currentColor" aria-hidden>
        <path d={STAR} />
      </svg>
      {fill > 0 && (
        <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
          <svg viewBox="0 0 24 24" className="block h-full text-star" style={{ width: `${100 / fill}%` }} fill="currentColor" aria-hidden>
            <path d={STAR} />
          </svg>
        </span>
      )}
    </span>
  );
}

const starFill = (value: number, i: number, scale: RatingScale) => Math.max(0, Math.min(1, scaled(value, scale) - i));

/**
 * Shows a rating. On 5 stars that's the stars themselves; on the 10-star scale a row of ten only fits where
 * there's room (`wide`), so small spots show one star and the number instead ("★ 9").
 */
export function StarDisplay({ value, size = 'size-4', wide }: { value?: number; size?: string; wide?: boolean }) {
  const { ratingScale: scale } = useSettings();
  if (scale === 'ten' && !wide) {
    if (!value) return null;
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-bold tabular-nums" aria-label={ratingWords(value, scale)}>
        <StarShape fill={1} className={size} />
        {fmtRating(value, scale)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-px" aria-label={ratingWords(value, scale)}>
      {Array.from({ length: outOf(scale) }, (_, i) => (
        <StarShape key={i} fill={starFill(value ?? 0, i, scale)} className={size} />
      ))}
    </span>
  );
}

/**
 * Rate by tapping or sliding a finger along the stars. On 5 stars the left half of a star gives a half star;
 * on 10 stars each star is one point. Tap your current rating again to clear it. Arrow keys work too.
 * `size` is the star size in pixels on the 5-star scale; ten stars shrink to fit the same row.
 */
export function StarInput({ value, onChange, size = 32 }: { value?: number; onChange: (v: number | undefined) => void; size?: number }) {
  const { ratingScale: scale } = useSettings();
  const ten = scale === 'ten';
  const count = outOf(scale);
  const px = ten ? Math.round(size * 0.74) : size;
  const [hover, setHover] = useState<number>();
  // Bumped on every rating so the filled stars replay their little pop, left to right.
  const [bump, setBump] = useState(0);
  const row = useRef<HTMLSpanElement>(null);
  const press = useRef<{ x: number; slid: boolean } | null>(null);
  // What you just picked stays lit until the saved value comes back (a sheet may close a moment later).
  const [picked, setPicked] = useState<{ v?: number } | null>(null);
  useEffect(() => setPicked(null), [value]);
  const shown = hover ?? (picked ? picked.v : value) ?? 0;

  /** The rating under a finger or pointer at clientX. */
  const valueAt = (x: number) => {
    const stars = [...(row.current?.children ?? [])] as HTMLElement[];
    for (const [i, el] of stars.entries()) {
      const r = el.getBoundingClientRect();
      if (x <= r.right || i === stars.length - 1) return ten ? (i + 1) * STEP : i + (x < r.left + r.width / 2 ? STEP : 1);
    }
    return STEP;
  };
  const commit = (v: number | undefined) => {
    setBump((b) => b + 1);
    setPicked({ v });
    onChange(v);
  };

  return (
    <span
      ref={row}
      role="slider"
      tabIndex={0}
      aria-label="Your rating"
      aria-valuemin={0}
      aria-valuemax={count}
      aria-valuenow={value ? scaled(value, scale) : 0}
      aria-valuetext={ratingWords(value, scale)}
      className={`inline-flex max-w-full touch-none items-center rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-accent ${ten ? 'gap-0.5' : 'gap-1'}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        row.current?.setPointerCapture(e.pointerId);
        press.current = { x: e.clientX, slid: false };
        haptic();
        setHover(valueAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (press.current) {
          if (Math.abs(e.clientX - press.current.x) > 6) press.current.slid = true;
          setHover(valueAt(e.clientX));
        } else if (e.pointerType === 'mouse') setHover(valueAt(e.clientX));
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (!p) return;
        const v = valueAt(e.clientX);
        setHover(undefined);
        // A tap on the rating you already gave clears it; sliding always sets.
        commit(!p.slid && v === value ? undefined : v);
      }}
      onPointerCancel={() => {
        press.current = null;
        setHover(undefined);
      }}
      onPointerLeave={() => !press.current && setHover(undefined)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const now = value ?? 0;
        let next: number | undefined | null = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, now + STEP);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = now - STEP >= STEP ? now - STEP : undefined;
        if (e.key === 'Home') next = STEP;
        if (e.key === 'End') next = 5;
        if (e.key === 'Delete' || e.key === 'Backspace' || e.key === '0') next = undefined;
        if (next === null) return;
        e.preventDefault();
        commit(next);
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const fill = starFill(shown, i, scale);
        return (
          <StarShape
            key={fill > 0 ? `on-${bump}-${i}` : `off-${i}`}
            fill={fill}
            className={`shrink transition-transform duration-150 ${bump && fill > 0 && hover === undefined ? 'animate-pop' : ''} ${hover !== undefined && fill > 0 ? 'scale-110' : ''}`}
            style={{ width: px, height: px, minWidth: 0, flexBasis: px, animationDelay: `${i * (ten ? 22 : 35)}ms` }}
          />
        );
      })}
    </span>
  );
}

/** A small "★ 4.5" / "Rate" button for tight rows (episodes): opens the full stars in a sheet. */
export function RatingChip({ value, onClick, label = 'Rate' }: { value?: number; onClick: () => void; label?: string }) {
  const { ratingScale: scale } = useSettings();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        haptic();
        onClick();
      }}
      aria-label={value ? `Your rating: ${ratingWords(value, scale)}. Change it` : label}
      className={`flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-bold tabular-nums transition active:scale-90 ${value ? 'bg-soft text-ink' : 'text-muted'}`}
    >
      <StarShape fill={value ? 1 : 0} className="size-4" />
      {value ? fmtRating(value, scale) : label}
    </button>
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
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        // Some databases answer "no cover" with a 1x1 or blank placeholder image instead of an error.
        onLoad={(e) => e.currentTarget.naturalWidth < 16 && setBroken(true)}
        className={`object-cover bg-surface-2 ${className}`}
      />
    );
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

const isWide = () => matchMedia('(min-width: 640px)').matches;
const SPRING = { type: 'spring', damping: 34, stiffness: 420, mass: 0.9 } as const;

/**
 * Slides up from the bottom on phones (drag the handle or title down to dismiss) and pops in as a dialog
 * on wider screens. Keep it rendered with `open={false}` rather than unmounting it, so it can slide away.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const drag = useDragControls();
  const wide = isWide();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Keyboard: focus moves into the sheet, Tab stays inside it, and focus returns where it was on close.
    const before = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [open]);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 650) onClose();
  };
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="sheet" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label={title}>
          <motion.div
            className="absolute inset-0 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            tabIndex={-1}
            className="pb-safe relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-2xl outline-none sm:max-w-md sm:rounded-3xl"
            initial={wide ? { opacity: 0, scale: 0.94, y: 12 } : { y: '100%' }}
            animate={wide ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={wide ? { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.16 } } : { y: '100%', transition: { type: 'spring', damping: 40, stiffness: 420 } }}
            transition={SPRING}
            drag={wide ? false : 'y'}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.7 }}
            onDragEnd={onDragEnd}
          >
            <div className="shrink-0 touch-none bg-surface px-5 pt-2 pb-2 select-none sm:pt-4" onPointerDown={(e) => drag.start(e)}>
              <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line sm:hidden" />
              <div className="flex items-center justify-between gap-3">
                <h2 className="min-w-0 text-lg font-semibold">{title}</h2>
                <button
                  onClick={onClose}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="shrink-0 rounded-full bg-surface-2 p-1.5 text-muted transition active:scale-90"
                  aria-label="Close"
                >
                  <Icon name="close" className="size-4" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** A progress bar that fills smoothly to its value. */
export function Bar({ pct, color, className = 'h-2' }: { pct: number; color: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-full bg-surface-2 ${className}`}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        transition={{ type: 'spring', damping: 30, stiffness: 140, delay: 0.08 }}
      />
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-semibold transition duration-150 ease-out active:scale-[.96] disabled:opacity-40 disabled:active:scale-100 ${styles} ${className}`}
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
