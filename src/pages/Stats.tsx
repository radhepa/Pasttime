import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db';
import type { Episode, LogEntry, Media } from '../types';
import { addDays, dayLabel, parseKey, todayKey } from '../lib/dates';
import { getCategory, useCategories, verb } from '../lib/categories';
import { ratingFor } from '../lib/stats';
import { fmtRating } from '../lib/ratings';
import { setSettings, useSettings } from '../lib/settings';
import { Button, catColor, Cover, Empty, Field, Sheet, StarDisplay } from '../components/ui';

/* ---------------- Number crunching ---------------- */

interface Crunch {
  totalMinutes: number;
  estimated: boolean;
  episodes: number;
  daysActive: number;
  longestStreak: number;
  avgRating?: number;
  ratingCounts: number[]; // index 0 = 1 star
  finishedBy: Map<string, number>; // category → titles finished
  byCategory: { id: string; minutes: number; titles: number }[];
  buckets: { key: string; label: string; minutes: number }[];
  perDay: Map<string, number>;
  top: { media: Media; rating: number }[];
  years: number[];
}

function crunch(media: Media[], logs: LogEntry[], episodes: Episode[], range: string, showMode: 'seasons' | 'episodes'): Crunch {
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const epById = new Map(episodes.map((e) => [e.id, e]));
  const inRange = (d: string | null) => !!d && (range === 'all' || d.startsWith(range));
  const dated = logs.filter((l) => inRange(l.date) && mediaById.has(l.mediaId));
  const years = [...new Set(logs.filter((l) => l.date).map((l) => Number(l.date!.slice(0, 4))))].sort((a, b) => b - a);

  let estimated = false;
  const minutesOf = (l: LogEntry) => {
    const m = mediaById.get(l.mediaId)!;
    const c = getCategory(m.type);
    switch (l.kind) {
      case 'episode': {
        const rt = l.episodeId ? epById.get(l.episodeId)?.runtime : undefined;
        if (rt) return rt;
        estimated = true;
        return c.typicalMinutes ?? 30;
      }
      case 'once':
        if (m.runtime) return m.runtime;
        estimated = true;
        return c.typicalMinutes ?? 60;
      case 'progress':
        if (l.minutes) return l.minutes;
        if (c.minutesPerUnit && l.pages) estimated = true;
        return (l.pages ?? 0) * (c.minutesPerUnit ?? 0);
      case 'session':
        return l.minutes ?? 0;
      default:
        return 0;
    }
  };

  const perDay = new Map<string, number>();
  const catMinutes = new Map<string, number>();
  const catTitles = new Map<string, Set<string>>();
  const bucketMinutes = new Map<string, number>();
  let totalMinutes = 0;
  let eps = 0;
  for (const l of dated) {
    const m = mediaById.get(l.mediaId)!;
    const mins = minutesOf(l);
    totalMinutes += mins;
    if (l.kind === 'episode') eps++;
    perDay.set(l.date!, (perDay.get(l.date!) ?? 0) + 1);
    catMinutes.set(m.type, (catMinutes.get(m.type) ?? 0) + mins);
    catTitles.set(m.type, (catTitles.get(m.type) ?? new Set()).add(m.id));
    const bucket = range === 'all' ? l.date!.slice(0, 4) : l.date!.slice(0, 7);
    bucketMinutes.set(bucket, (bucketMinutes.get(bucket) ?? 0) + mins);
  }

  // Finished titles: a finish entry, a one-time log, or a completed series whose last episode falls in range.
  const finished = new Set<string>();
  for (const l of dated) {
    const m = mediaById.get(l.mediaId)!;
    if (l.kind === 'finish' || l.kind === 'once') finished.add(m.id);
  }
  for (const m of media) {
    if (getCategory(m.type).track !== 'episodes' || m.status !== 'completed') continue;
    const last = logs.filter((l) => l.mediaId === m.id && l.kind === 'episode' && l.date).sort((a, b) => b.date!.localeCompare(a.date!))[0];
    if (last && inRange(last.date)) finished.add(m.id);
  }
  const finishedBy = new Map<string, number>();
  finished.forEach((id) => {
    const t = mediaById.get(id)!.type;
    finishedBy.set(t, (finishedBy.get(t) ?? 0) + 1);
  });

  // Ratings you gave in range.
  const ratings: number[] = [];
  for (const l of dated) {
    if (l.rating) ratings.push(l.rating);
    if (l.kind === 'finish' && mediaById.get(l.mediaId)!.rating) ratings.push(mediaById.get(l.mediaId)!.rating!);
  }
  const ratingCounts = [1, 2, 3, 4, 5].map((n) => ratings.filter((r) => Math.round(r) === n).length);

  // Streaks inside the range.
  const days = [...perDay.keys()].sort();
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }

  // Columns: 12 months for a year, one per year for all time.
  const buckets =
    range === 'all'
      ? [...years].reverse().map((y) => ({ key: String(y), label: String(y), minutes: bucketMinutes.get(String(y)) ?? 0 }))
      : Array.from({ length: 12 }, (_, i) => {
          const key = `${range}-${String(i + 1).padStart(2, '0')}`;
          return { key, label: new Date(Number(range), i, 1).toLocaleDateString(undefined, { month: 'short' }), minutes: bucketMinutes.get(key) ?? 0 };
        });

  // Top rated among titles you spent time with in range.
  const touched = new Set(dated.map((l) => l.mediaId));
  const top = [...touched]
    .map((id) => {
      const m = mediaById.get(id)!;
      const r = ratingFor(
        m,
        logs.filter((l) => l.mediaId === id),
        episodes.filter((e) => e.mediaId === id),
        showMode,
      );
      return { media: m, rating: r ?? 0 };
    })
    .filter((x) => x.rating > 0)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 5);

  return {
    totalMinutes,
    estimated,
    episodes: eps,
    daysActive: perDay.size,
    longestStreak: longest,
    avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : undefined,
    ratingCounts,
    finishedBy,
    byCategory: [...catMinutes].map(([id, minutes]) => ({ id, minutes, titles: catTitles.get(id)!.size })).sort((a, b) => b.minutes - a.minutes || b.titles - a.titles),
    buckets,
    perDay,
    top,
    years,
  };
}

const hours = (min: number) => (min >= 600 ? Math.round(min / 60).toLocaleString() : (Math.round(min / 6) / 10).toLocaleString());
const compact = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : n.toLocaleString());

/* ---------------- Pieces ---------------- */

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-3xl bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-3xl bg-surface p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Single-series column chart: hours per month (or per year). Hover/focus a column for its value. */
function Columns({ data }: { data: { key: string; label: string; minutes: number }[] }) {
  const [hover, setHover] = useState<number>();
  const [asTable, setAsTable] = useState(false);
  const W = 640;
  const H = 180;
  const pad = { l: 32, r: 8, t: 12, b: 22 };
  const max = Math.max(60, ...data.map((d) => d.minutes));
  const niceMaxH = (() => {
    const h = max / 60;
    const step = h <= 4 ? 1 : h <= 10 ? 2 : h <= 25 ? 5 : h <= 50 ? 10 : h <= 100 ? 20 : 50;
    return Math.ceil(h / step) * step;
  })();
  const ticks = [0, niceMaxH / 2, niceMaxH];
  const band = (W - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.min(24, band * 0.6);
  const y = (min: number) => pad.t + (H - pad.t - pad.b) * (1 - min / 60 / niceMaxH);

  if (asTable)
    return (
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 text-right font-medium">Hours</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key} className="border-t border-line">
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-right tabular-nums">{hours(d.minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setAsTable(false)} className="mt-2 text-xs font-semibold text-accent">
          Show chart
        </button>
      </div>
    );

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hours per period">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t * 60)} y2={y(t * 60)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t * 60) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">
              {t}h
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          const top = y(d.minutes);
          const base = y(0);
          const h = base - top;
          const r = Math.min(4, h);
          const x0 = cx - bw / 2;
          return (
            <g
              key={d.key}
              tabIndex={0}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(undefined)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(undefined)}
              className="outline-none"
            >
              {/* Hit area: the whole band, not just the painted column */}
              <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${base} Z`}
                  fill="var(--accent)"
                  opacity={hover === undefined || hover === i ? 1 : 0.55}
                />
              )}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== undefined && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-bg shadow-lg"
          style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%` }}
        >
          <span className="block text-sm font-semibold">{hours(data[hover].minutes)} h</span>
          <span className="opacity-75">{data[hover].label}</span>
        </div>
      )}
      <button onClick={() => setAsTable(true)} className="mt-1 text-xs font-semibold text-accent">
        Show as table
      </button>
    </div>
  );
}

function Heatmap({ perDay, range }: { perDay: Map<string, number>; range: string }) {
  const today = todayKey();
  const end = range === 'all' || range === today.slice(0, 4) ? today : `${range}-12-31`;
  const startRaw = range === 'all' || range === today.slice(0, 4) ? addDays(end, -364) : `${range}-01-01`;
  const start = addDays(startRaw, -parseKey(startRaw).getDay());
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const weeks = Math.ceil(days.length / 7);
  const heat = (n: number) => (n === 0 ? 'var(--heat-0)' : n === 1 ? 'var(--heat-1)' : n <= 3 ? 'var(--heat-2)' : n <= 6 ? 'var(--heat-3)' : 'var(--heat-4)');
  // Open scrolled to the most recent weeks (phones can't fit a whole year).
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth });
  }, [range]);
  return (
    <div>
      <div ref={scroller} className="no-scrollbar overflow-x-auto">
        <svg width={weeks * 13} height={7 * 13} role="img" aria-label="Activity per day">
          {days.map((d, i) => {
            const n = perDay.get(d) ?? 0;
            return (
              <rect key={d} x={Math.floor(i / 7) * 13} y={(i % 7) * 13} width={11} height={11} rx={2} fill={heat(n)} opacity={d < startRaw ? 0.25 : 1}>
                <title>{`${dayLabel(d)}: ${n} ${n === 1 ? 'entry' : 'entries'}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted">
        Less
        {[0, 1, 2, 4, 7].map((n) => (
          <span key={n} className="size-2.5 rounded-sm" style={{ background: heat(n) }} />
        ))}
        More
      </div>
    </div>
  );
}

function GoalsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { goals } = useSettings();
  const { visible } = useCategories();
  return (
    <Sheet open={open} onClose={onClose} title="Yearly goals">
      <p className="mb-4 text-sm text-muted">How many titles do you want to finish this year? Leave a category empty for no goal.</p>
      <div className="grid grid-cols-2 gap-3">
        {visible.map((c) => (
          <Field key={c.id} label={`${c.emoji} ${c.plural}`}>
            <input
              type="number"
              inputMode="numeric"
              className="field"
              value={goals[c.id] || ''}
              placeholder="—"
              onChange={(e) => setSettings({ goals: { ...goals, [c.id]: Math.max(0, Number(e.target.value) || 0) } })}
            />
          </Field>
        ))}
      </div>
      <Button className="mt-5 w-full" onClick={onClose}>
        Done
      </Button>
    </Sheet>
  );
}

/* ---------------- Page ---------------- */

export default function Stats() {
  const settings = useSettings();
  const thisYear = todayKey().slice(0, 4);
  const [range, setRange] = useState(thisYear);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const raw = useLiveQuery(async () => {
    const [media, logs, episodes] = await Promise.all([db.media.toArray(), db.logs.toArray(), db.episodes.toArray()]);
    return { media, logs, episodes };
  }, []);
  const s = useMemo(() => (raw ? crunch(raw.media, raw.logs, raw.episodes, range, settings.showRating) : undefined), [raw, range, settings.showRating]);
  if (!s) return null;

  const years = [...new Set([Number(thisYear), ...s.years])].sort((a, b) => b - a);
  const finishedTotal = [...s.finishedBy.values()].reduce((a, b) => a + b, 0);
  const goals = Object.entries(settings.goals).filter(([, n]) => n > 0);
  const maxCat = Math.max(1, ...s.byCategory.map((c) => c.minutes));
  const maxRating = Math.max(1, ...s.ratingCounts);
  const rangeLabel = range === 'all' ? 'all time' : range;

  return (
    <div>
      <h1 className="mb-4 display text-[2.75rem]">Stats</h1>

      {/* Filter row: scopes everything below */}
      <div className="no-scrollbar -mx-4 mb-5 flex gap-1 overflow-x-auto px-4">
        {[...years.map(String), 'all'].map((y) => (
          <button
            key={y}
            onClick={() => setRange(y)}
            className={`shrink-0 rounded-lg px-3 py-1 text-sm font-medium ${range === y ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted'}`}
          >
            {y === 'all' ? 'All time' : y}
          </button>
        ))}
      </div>

      {s.daysActive === 0 ? (
        <Empty title={`Nothing logged in ${rangeLabel}`}>Log an episode, some pages or a session and your stats show up here.</Empty>
      ) : (
        <div className="space-y-4">
          {/* Hero figure */}
          <div className="rounded-3xl bg-surface p-5">
            <p className="text-sm text-muted">Time spent in {rangeLabel}</p>
            <p className="text-5xl font-semibold tracking-tight">
              {hours(s.totalMinutes)} <span className="text-2xl text-muted">hours</span>
            </p>
            {s.estimated && <p className="mt-1 text-xs text-muted">Includes estimates where you didn't log minutes (e.g. a typical movie length).</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Titles finished" value={compact(finishedTotal)} />
            <Tile label="Episodes watched" value={compact(s.episodes)} />
            <Tile label="Days active" value={compact(s.daysActive)} sub={`Longest streak ${s.longestStreak} ${s.longestStreak === 1 ? 'day' : 'days'}`} />
            <Tile label="Average rating" value={s.avgRating ? fmtRating(s.avgRating) : '—'} sub={`${s.ratingCounts.reduce((a, b) => a + b, 0)} ratings`} />
          </div>

          {range === thisYear && (
            <Card
              title={`${thisYear} goals`}
              action={
                <button onClick={() => setGoalsOpen(true)} className="text-xs font-semibold text-accent">
                  {goals.length ? 'Edit' : 'Set goals'}
                </button>
              }
            >
              {goals.length === 0 ? (
                <p className="text-sm text-muted">Set a target, like 24 books or 50 movies this year, and track it here.</p>
              ) : (
                <div className="space-y-3">
                  {goals.map(([id, goal]) => {
                    const c = getCategory(id);
                    const done = s.finishedBy.get(id) ?? 0;
                    return (
                      <div key={id}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="font-medium">
                            {c.emoji} {c.plural}
                          </span>
                          <span className="tabular-nums text-muted">
                            <span className="font-semibold text-ink">{done}</span> / {goal}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (done / goal) * 100)}%`, background: catColor(id) }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          <Card title={range === 'all' ? 'Hours per year' : 'Hours per month'}>
            <Columns data={s.buckets} />
          </Card>

          <Card title="By category">
            <div className="space-y-2.5">
              {s.byCategory.map((c) => {
                const cat = getCategory(c.id);
                return (
                  <div key={c.id}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">
                        {cat.emoji} {cat.plural}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted">
                        {c.minutes ? `${hours(c.minutes)} h · ` : ''}
                        {c.titles} {c.titles === 1 ? 'title' : 'titles'}
                        {s.finishedBy.get(c.id) ? ` · ${s.finishedBy.get(c.id)} ${verb(cat).past.toLowerCase()}` : ''}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-2">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, (c.minutes / maxCat) * 100)}%`, background: catColor(c.id) }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Activity">
            <Heatmap perDay={s.perDay} range={range} />
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Your ratings">
              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div key={n} className="flex items-center gap-2 text-sm">
                    <span className="w-8 shrink-0 tabular-nums text-muted">{n}★</span>
                    <div className="h-3 flex-1 rounded-r bg-surface-2">
                      <div className="h-full rounded-r" style={{ width: `${(s.ratingCounts[n - 1] / maxRating) * 100}%`, background: 'var(--star)' }} />
                    </div>
                    <span className="w-8 shrink-0 text-right tabular-nums">{s.ratingCounts[n - 1]}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Top rated">
              {s.top.length === 0 ? (
                <p className="text-sm text-muted">Rate a few things to see your favourites.</p>
              ) : (
                <div className="space-y-2">
                  {s.top.map(({ media, rating }) => (
                    <Link key={media.id} to={`/m/${media.id}`} className="flex items-center gap-3">
                      <Cover src={media.cover} title={media.title} type={media.type} className="h-12 w-8 shrink-0 rounded" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{media.title}</span>
                      <StarDisplay value={rating} size="size-3" />
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <GoalsSheet open={goalsOpen} onClose={() => setGoalsOpen(false)} />
    </div>
  );
}

