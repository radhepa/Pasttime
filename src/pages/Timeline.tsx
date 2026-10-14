import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { db, logEpisode } from '../db';
import type { Episode, LogEntry, Media } from '../types';
import { addDays, dateKey, dayLabel, episodeCode, formatMinutes, parseKey, todayKey, weekOf } from '../lib/dates';
import { getCategory, unitPlural, verb } from '../lib/categories';
import { currentPage, statsFor } from '../lib/stats';
import { useSettings } from '../lib/settings';
import { catColor, Cover, Empty, Icon, StarDisplay, TypeBadge } from '../components/ui';
import { LogEditor } from '../components/LogEditor';
import { OnceSheet, ProgressSheet, RatePrompt, SessionSheet } from '../components/LogSheets';

interface DayGroup {
  media: Media;
  logs: LogEntry[];
}

/** Everything logged on the given days, grouped per day and per title. */
function useDays(dates: string[]) {
  return useLiveQuery(async () => {
    const logs = await db.logs.where('date').anyOf(dates).toArray();
    const media = new Map((await db.media.bulkGet([...new Set(logs.map((l) => l.mediaId))])).filter(Boolean).map((m) => [m!.id, m!]));
    const epIds = logs.map((l) => l.episodeId).filter(Boolean) as string[];
    const episodes = new Map((await db.episodes.bulkGet(epIds)).filter(Boolean).map((e) => [e!.id, e!]));
    const byDay = new Map<string, DayGroup[]>();
    for (const day of dates) {
      const dayLogs = logs.filter((l) => l.date === day && media.has(l.mediaId)).sort((a, b) => a.at - b.at);
      const groups = new Map<string, DayGroup>();
      for (const l of dayLogs) {
        const g = groups.get(l.mediaId) ?? { media: media.get(l.mediaId)!, logs: [] };
        g.logs.push(l);
        groups.set(l.mediaId, g);
      }
      // Most recent activity first.
      byDay.set(day, [...groups.values()].sort((a, b) => b.logs.at(-1)!.at - a.logs.at(-1)!.at));
    }
    return { byDay, episodes };
  }, [dates.join(',')]);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 episodes · 15 pages · 2 chapters · 1 movie · 1h 30m played" */
function daySummary(groups: DayGroup[]) {
  let eps = 0;
  let finished = 0;
  const minutes = new Map<string, number>(); // "played" → 90
  const units = new Map<string, number>(); // "page" → 15
  const once = new Map<string, number>(); // category id → count
  for (const g of groups) {
    const c = getCategory(g.media.type);
    for (const l of g.logs) {
      if (l.kind === 'episode') eps++;
      if (l.kind === 'once') once.set(c.id, (once.get(c.id) ?? 0) + 1);
      if (l.kind === 'progress') units.set(c.unit ?? 'part', (units.get(c.unit ?? 'part') ?? 0) + (l.pages ?? 0));
      if (l.kind === 'session' && l.minutes) {
        const v = verb(c).past.toLowerCase();
        minutes.set(v, (minutes.get(v) ?? 0) + l.minutes);
      }
      if (l.kind === 'finish') finished++;
    }
  }
  return [
    eps && plural(eps, 'episode'),
    ...[...units].filter(([, n]) => n).map(([u, n]) => plural(n, u)),
    ...[...once].map(([id, n]) => (n === 1 ? `1 ${getCategory(id).name.toLowerCase()}` : `${n} ${getCategory(id).plural.toLowerCase()}`)),
    ...[...minutes].map(([v, m]) => `${formatMinutes(m)} ${v}`),
    finished && `${finished} finished`,
  ].filter(Boolean) as string[];
}

function headline(g: DayGroup) {
  const c = getCategory(g.media.type);
  const v = verb(c);
  const parts: string[] = [];
  const eps = g.logs.filter((l) => l.kind === 'episode').length;
  const once = g.logs.filter((l) => l.kind === 'once').length;
  const units = g.logs.filter((l) => l.kind === 'progress').reduce((s, l) => s + (l.pages ?? 0), 0);
  const mins = g.logs.filter((l) => l.kind === 'session').reduce((s, l) => s + (l.minutes ?? 0), 0);
  if (eps) parts.push(`${v.past} ${plural(eps, 'episode')}`);
  if (once) parts.push(once > 1 ? `${v.past} ${once} times` : v.past);
  if (units) parts.push(`${v.past} ${units} ${unitPlural(c, units)}`);
  if (mins) parts.push(`${v.past} ${formatMinutes(mins)}`);
  if (g.logs.some((l) => l.kind === 'session') && !mins) parts.push(v.past);
  if (g.logs.some((l) => l.kind === 'finish')) parts.push('Finished');
  if (g.logs.some((l) => l.kind === 'start')) parts.push('Started again');
  return parts.join(' · ');
}

function EntryRow({ log, media, episode, onEdit }: { log: LogEntry; media: Media; episode?: Episode; onEdit: () => void }) {
  const c = getCategory(media.type);
  let main = '';
  let sub = '';
  switch (log.kind) {
    case 'episode':
      main = `${episodeCode(log.season, log.number)}${episode?.title ? ` · ${episode.title}` : ''}`;
      break;
    case 'once':
      main = verb(c).past;
      break;
    case 'progress':
      main = log.pages ? `${log.pages} ${unitPlural(c, log.pages)}` : 'Progress';
      if (log.fromPage != null && log.toPage != null) sub = `${log.fromPage} → ${log.toPage}${media.totalPages ? ` of ${media.totalPages}` : ''}`;
      if (log.minutes) sub = [sub, formatMinutes(log.minutes)].filter(Boolean).join(' · ');
      break;
    case 'session':
      main = log.minutes ? formatMinutes(log.minutes) : 'Session';
      break;
    case 'finish':
      main = 'Finished';
      break;
    case 'start':
      main = 'Started again from the beginning';
      break;
  }
  const rating = log.kind === 'finish' ? media.rating : log.rating;
  return (
    <button onClick={onEdit} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{main}</span>
        {(sub || log.note) && <span className="block truncate text-xs text-muted">{[sub, log.note].filter(Boolean).join(' — ')}</span>}
      </span>
      {rating ? <StarDisplay value={rating} size="size-3.5" /> : null}
      <Icon name="edit" className="size-3.5 shrink-0 text-muted" />
    </button>
  );
}

function DayCard({ groups, episodes, onEdit }: { groups: DayGroup[]; episodes: Map<string, Episode>; onEdit: (l: LogEntry, m: Media) => void }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.media.id} className="overflow-hidden rounded-3xl bg-surface shadow-sm">
          <Link to={`/m/${g.media.id}`} className="flex items-center gap-3 p-3">
            <Cover src={g.media.cover} title={g.media.title} type={g.media.type} className="h-16 w-11 shrink-0 rounded-md" />
            <span className="min-w-0 flex-1">
              <TypeBadge type={g.media.type} />
              <span className="mt-0.5 block truncate font-semibold">{g.media.title}</span>
              <span className="block truncate text-sm text-muted">{headline(g)}</span>
            </span>
            <Icon name="right" className="size-4 text-muted" />
          </Link>
          <div className="border-t border-line px-1.5 py-1.5">
            {g.logs.map((l) => (
              <EntryRow key={l.id} log={l} media={g.media} episode={l.episodeId ? episodes.get(l.episodeId) : undefined} onEdit={() => onEdit(l, g.media)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Continue: one-tap logging for what you're in the middle of ---------------- */

interface ContinueItem {
  media: Media;
  next?: Episode;
  page?: number;
  label?: string;
}

function ContinueRow() {
  const { showRating } = useSettings();
  const items = useLiveQuery(async () => {
    const active = await db.media.where('status').equals('active').toArray();
    const out: (ContinueItem & { last: number })[] = [];
    for (const m of active) {
      const [logs, eps] = await Promise.all([db.logs.where('mediaId').equals(m.id).toArray(), db.episodes.where('mediaId').equals(m.id).toArray()]);
      const s = statsFor(m, logs, eps, showRating);
      const today = todayKey();
      const watched = new Set(logs.map((l) => l.episodeId));
      const next = eps
        .sort((a, b) => a.season - b.season || a.number - b.number)
        .find((e) => (!e.airdate || e.airdate <= today) && !watched.has(e.id));
      out.push({ media: m, next, page: currentPage(logs), label: next ? `Next: ${episodeCode(next.season, next.number)}` : s.progressLabel, last: s.lastActivity });
    }
    return out.sort((a, b) => b.last - a.last).slice(0, 12);
  }, [showRating]);
  const [open, setOpen] = useState<ContinueItem>();
  const [prompt, setPrompt] = useState<{ log: LogEntry; ep: Episode; media: Media }>();
  const settings = useSettings();

  if (!items?.length) return null;

  const quick = async (it: ContinueItem) => {
    const c = getCategory(it.media.type);
    if (c.track === 'episodes') {
      if (!it.next) return;
      const log = await logEpisode(it.media, it.next);
      if (settings.promptRating) setPrompt({ log, ep: it.next, media: it.media });
    } else setOpen(it);
  };

  const track = open ? getCategory(open.media.type).track : undefined;
  return (
    <section className="mb-6">
      <h2 className="mb-2 eyebrow">Continue</h2>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {items.map((it) => {
          const c = getCategory(it.media.type);
          const disabled = c.track === 'episodes' && !it.next;
          return (
            <div key={it.media.id} className="w-28 shrink-0">
              <Link to={`/m/${it.media.id}`} className="relative block overflow-hidden rounded-xl ring-1 ring-line">
                <Cover src={it.media.cover} title={it.media.title} type={it.media.type} className="aspect-[2/3] w-full" />
                <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: catColor(it.media.type) }} />
              </Link>
              <p className="mt-1.5 truncate text-sm font-semibold">{it.media.title}</p>
              <p className="truncate text-xs text-muted">{it.label ?? verb(c).doing}</p>
              <button
                disabled={disabled}
                onClick={() => quick(it)}
                className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg bg-surface-2 py-1.5 text-xs font-semibold disabled:opacity-40"
              >
                <Icon name={c.track === 'episodes' ? 'check' : 'plus'} className="size-3.5" strokeWidth={2.5} />
                {c.track === 'episodes' ? (disabled ? 'Caught up' : 'Watched') : 'Log'}
              </button>
            </div>
          );
        })}
      </div>
      {open && track === 'progress' && <ProgressSheet media={open.media} open currentPage={open.page} onClose={() => setOpen(undefined)} onReachedEnd={() => undefined} />}
      {open && track === 'sessions' && <SessionSheet media={open.media} open onClose={() => setOpen(undefined)} />}
      {open && track === 'once' && <OnceSheet media={open.media} open onClose={() => setOpen(undefined)} />}
      <RatePrompt
        log={prompt?.log}
        heading={prompt ? `How was ${episodeCode(prompt.ep.season, prompt.ep.number)}?` : ''}
        sub={prompt ? `${prompt.media.title} · ${prompt.ep.title ?? ''}` : undefined}
        onClose={() => setPrompt(undefined)}
      />
    </section>
  );
}

/* ---------------- Calendar ---------------- */

function useActivityCounts() {
  return useLiveQuery(async () => {
    const counts = new Map<string, number>();
    await db.logs.where('date').above('').each((l) => counts.set(l.date!, (counts.get(l.date!) ?? 0) + 1));
    return counts;
  }, []);
}

/** Consecutive days with something logged, ending today (or yesterday, if today's still empty). */
function streak(counts: Map<string, number>) {
  let day = todayKey();
  if (!counts.has(day)) day = addDays(day, -1);
  let n = 0;
  while (counts.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

const heat = (n: number) => (n === 0 ? 'var(--heat-0)' : n === 1 ? 'var(--heat-1)' : n <= 3 ? 'var(--heat-2)' : n <= 6 ? 'var(--heat-3)' : 'var(--heat-4)');

function MonthGrid({ day, counts, onPick }: { day: string; counts: Map<string, number>; onPick: (d: string) => void }) {
  const d = parseKey(day);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = addDays(dateKey(first), -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = todayKey();
  return (
    <div className="mb-5 rounded-3xl bg-surface p-3">
      <div className="mx-auto mb-2 flex max-w-sm items-center justify-between">
        <button onClick={() => onPick(dateKey(new Date(d.getFullYear(), d.getMonth() - 1, 1)))} className="p-1.5 text-muted" aria-label="Previous month">
          <Icon name="left" className="size-4" />
        </button>
        <span className="text-sm font-semibold">{d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button onClick={() => onPick(dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 1)))} className="p-1.5 text-muted" aria-label="Next month">
          <Icon name="right" className="size-4" />
        </button>
      </div>
      <div className="mx-auto grid max-w-sm grid-cols-7 gap-1 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <span key={i} className="text-[10px] font-semibold text-muted">
            {w}
          </span>
        ))}
        {days.map((k) => {
          const inMonth = parseKey(k).getMonth() === d.getMonth();
          const n = counts.get(k) ?? 0;
          return (
            <button
              key={k}
              onClick={() => onPick(k)}
              title={`${dayLabel(k)}: ${n} ${n === 1 ? 'entry' : 'entries'}`}
              className={`aspect-square rounded-lg text-xs font-semibold transition ${inMonth ? '' : 'opacity-30'} ${k === day ? 'ring-2 ring-accent' : ''} ${k > today ? 'opacity-30' : ''}`}
              style={{ background: heat(n), color: n > 3 ? '#fff' : undefined }}
            >
              {parseKey(k).getDate()}
            </button>
          );
        })}
      </div>
      <div className="mx-auto mt-2 flex max-w-sm items-center justify-end gap-1 text-[10px] text-muted">
        Less
        {[0, 1, 2, 4, 7].map((n) => (
          <span key={n} className="size-2.5 rounded-sm" style={{ background: heat(n) }} />
        ))}
        More
      </div>
    </div>
  );
}

/* ---------------- Page ---------------- */

export default function Timeline() {
  const [params, setParams] = useSearchParams();
  const day = params.get('d') ?? todayKey();
  const view = params.get('view') === 'month' ? 'month' : 'week';
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) next.delete(k);
      else next.set(k, v);
    }
    if (next.get('d') === todayKey()) next.delete('d');
    setParams(next, { replace: true });
  };
  const setDay = (d: string) => update({ d });
  const week = weekOf(day);
  const data = useDays(week.includes(day) ? week : [...week, day]);
  const counts = useActivityCounts();
  const dateInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{ log: LogEntry; media: Media }>();

  const recentDays = useLiveQuery(async () => {
    const keys = (await db.logs.orderBy('date').reverse().uniqueKeys()) as string[];
    return keys.filter((k) => k && k <= todayKey()).slice(0, 20);
  }, []);
  const recent = useDays(recentDays?.filter((d) => d !== day) ?? []);

  const groups = data?.byDay.get(day) ?? [];
  const summary = daySummary(groups);
  const isToday = day === todayKey();
  const currentStreak = counts ? streak(counts) : 0;

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{parseKey(day).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
          <h1 className="display text-[2.75rem]">{dayLabel(day)}</h1>
        </div>
        <div className="flex items-center gap-1">
          {currentStreak > 1 && (
            <span className="mr-1 flex items-center gap-1.5 rounded-full bg-soft px-3 py-1.5 text-xs font-semibold text-soft-ink" title="Days in a row with something logged">
              <Icon name="leaf" className="size-4" />
              {currentStreak}-day streak
            </span>
          )}
          {!isToday && (
            <button onClick={() => setDay(todayKey())} className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold">
              Today
            </button>
          )}
          <button
            onClick={() => update({ view: view === 'month' ? undefined : 'month' })}
            className={`rounded-full p-2 ${view === 'month' ? 'bg-accent text-on-accent' : 'bg-surface-2'}`}
            aria-label={view === 'month' ? 'Show week' : 'Show month'}
            title={view === 'month' ? 'Week view' : 'Month view'}
          >
            <Icon name="grid" className="size-5" />
          </button>
          <button
            onClick={() => {
              try {
                dateInput.current?.showPicker();
              } catch {
                dateInput.current?.focus();
              }
            }}
            className="relative rounded-full bg-surface-2 p-2"
            aria-label="Pick a day"
          >
            <Icon name="calendar" className="size-5" />
            <input
              ref={dateInput}
              type="date"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="pointer-events-none absolute inset-0 opacity-0"
              tabIndex={-1}
            />
          </button>
        </div>
      </header>

      {view === 'month' && counts ? (
        <MonthGrid day={day} counts={counts} onPick={setDay} />
      ) : (
        <div className="mb-5 flex items-center gap-1 rounded-3xl bg-surface p-1.5">
          <button onClick={() => setDay(addDays(day, -7))} className="p-1.5 text-muted" aria-label="Previous week">
            <Icon name="left" className="size-4" />
          </button>
          {week.map((d) => {
            const types = [...new Set((data?.byDay.get(d) ?? []).map((g) => g.media.type))].slice(0, 4);
            const selected = d === day;
            const future = d > todayKey();
            return (
              <button
                key={d}
                onClick={() => setDay(d)}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 transition ${selected ? 'bg-accent text-on-accent' : future ? 'text-muted/50' : ''}`}
              >
                <span className={`text-[10px] font-semibold uppercase ${selected ? '' : 'text-muted'}`}>
                  {parseKey(d).toLocaleDateString(undefined, { weekday: 'narrow' })}
                </span>
                <span className={`text-base font-semibold ${d === todayKey() && !selected ? 'text-accent' : ''}`}>{parseKey(d).getDate()}</span>
                <span className="flex h-1.5 gap-0.5">
                  {types.map((t) => (
                    <span key={t} className="size-1.5 rounded-full" style={{ background: selected ? 'currentColor' : catColor(t) }} />
                  ))}
                </span>
              </button>
            );
          })}
          <button onClick={() => setDay(addDays(day, 7))} className="p-1.5 text-muted" aria-label="Next week">
            <Icon name="right" className="size-4" />
          </button>
        </div>
      )}

      {isToday && <ContinueRow />}

      {summary.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {summary.map((s) => (
            <span key={s} className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold">
              {s}
            </span>
          ))}
        </div>
      )}

      {data && groups.length === 0 ? (
        <Empty title={isToday ? 'Nothing logged yet today' : 'Nothing logged this day'}>
          <Link to="/search" className="font-semibold text-accent">
            Find something
          </Link>{' '}
          or open a title from your library to log an episode, some pages or a session.
        </Empty>
      ) : (
        data && <DayCard groups={groups} episodes={data.episodes} onEdit={(log, media) => setEditing({ log, media })} />
      )}

      {recent && recentDays && recentDays.filter((d) => d !== day).length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 eyebrow">Recent days</h2>
          <div className="space-y-2">
            {recentDays
              .filter((d) => d !== day)
              .map((d) => {
                const gs = recent.byDay.get(d) ?? [];
                return (
                  <button key={d} onClick={() => setDay(d)} className="flex w-full items-center gap-3 rounded-3xl bg-surface p-3 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{dayLabel(d)}</span>
                      <span className="block truncate text-sm text-muted">{daySummary(gs).join(' · ')}</span>
                    </span>
                    <span className="flex -space-x-2">
                      {gs.slice(0, 4).map((g) => (
                        <Cover key={g.media.id} src={g.media.cover} title={g.media.title} type={g.media.type} className="h-10 w-7 rounded ring-2 ring-surface" />
                      ))}
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      )}

      <LogEditor log={editing?.log} media={editing?.media} onClose={() => setEditing(undefined)} />
    </div>
  );
}
