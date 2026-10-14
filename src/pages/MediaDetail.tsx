import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addLog, db, logEpisode, maybeCompleteShow, rateViaLogs, startOver, syncEpisodes, touchMedia } from '../db';
import type { Episode, LogEntry, Media, Status } from '../types';
import { dateKey, episodeCode, formatMinutes, shortDay, todayKey } from '../lib/dates';
import { fmtRating, showRating } from '../lib/ratings';
import { currentPage, ratingFor } from '../lib/stats';
import { getCategory, statusLabel, unitPlural, verb } from '../lib/categories';
import { useSettings } from '../lib/settings';
import { SOURCE_LABEL } from '../lib/search';
import { Button, catColor, Cover, Icon, StarDisplay, StarInput, TypeBadge } from '../components/ui';
import { LogEditor } from '../components/LogEditor';
import { BulkWatchSheet, FinishSheet, OnceSheet, ProgressSheet, RatePrompt, SessionSheet } from '../components/LogSheets';
import { ListsSheet } from '../components/ListsSheet';
import { startTimer, useTimer } from '../lib/timer';
import { toast } from '../lib/toast';

export default function MediaDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useLiveQuery(async () => {
    const media = await db.media.get(id!);
    if (!media) return { media: null };
    const [logs, episodes] = await Promise.all([db.logs.where('mediaId').equals(id!).toArray(), db.episodes.where('mediaId').equals(id!).toArray()]);
    episodes.sort((a, b) => a.season - b.season || a.number - b.number);
    return { media, logs, episodes };
  }, [id]);

  if (!data) return null;
  if (!data.media)
    return (
      <div className="py-20 text-center text-muted">
        This title isn't in your library anymore.{' '}
        <button onClick={() => navigate('/library')} className="font-semibold text-accent">
          Back to library
        </button>
      </div>
    );
  return <Detail media={data.media} logs={data.logs!} episodes={data.episodes!} />;
}

function Detail({ media, logs, episodes }: { media: Media; logs: LogEntry[]; episodes: Episode[] }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const cat = getCategory(media.type);
  const v = verb(cat);
  const [editing, setEditing] = useState<LogEntry>();
  const [sheet, setSheet] = useState<'once' | 'progress' | 'session' | 'finish' | 'lists'>();
  const [timerMinutes, setTimerMinutes] = useState<number>();
  const [showOverview, setShowOverview] = useState(false);
  const [params, setParams] = useSearchParams();
  const timer = useTimer();
  const inLists = useLiveQuery(() => db.lists.toArray().then((all) => all.filter((l) => l.items.includes(media.id))), [media.id]);

  // Arriving from "Stop & log" on the timer: open the right sheet with the minutes filled in.
  useEffect(() => {
    const kind = params.get('log');
    if (kind === 'progress' || kind === 'session') {
      setTimerMinutes(Number(params.get('minutes')) || undefined);
      setSheet(kind);
      setParams({}, { replace: true });
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeSheet = () => {
    setSheet(undefined);
    setTimerMinutes(undefined);
  };
  const timing = timer?.mediaId === media.id;
  const canTime = cat.track === 'progress' || cat.track === 'sessions';
  const begin = () => {
    startTimer({ mediaId: media.id, title: media.title, kind: cat.track === 'progress' ? 'progress' : 'session', type: media.type });
    toast('Timer started. Stop it when you’re done.');
  };

  const rating = useMemo(() => ratingFor(media, logs, episodes, settings.showRating), [media, logs, episodes, settings.showRating]);

  const history = [...logs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.at - a.at);
  const page = currentPage(logs);
  const minutes = logs.reduce((s, l) => s + (l.kind === 'session' || l.kind === 'progress' ? (l.minutes ?? 0) : 0), 0);
  const epById = new Map(episodes.map((e) => [e.id, e]));
  const timesDone = logs.filter((l) => l.kind === 'once').length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="-ml-2 flex items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold text-accent">
          <Icon name="back" className="size-5" />
          Back
        </button>
        <Link to={`/m/${media.id}/edit`} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold">
          <Icon name="edit" className="size-4" />
          Edit
        </Link>
      </div>

      {/* Hero */}
      <div className="flex gap-4 sm:gap-6">
        <Cover src={media.cover} title={media.title} type={media.type} className="h-44 w-[118px] shrink-0 rounded-xl shadow-lg ring-1 ring-line sm:h-60 sm:w-40" />
        <div className="min-w-0 flex-1 py-1">
          <TypeBadge type={media.type} />
          <h1 className="display mt-1.5 text-[2.1rem] sm:text-[2.6rem]">{media.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {[
              media.year,
              media.creators?.join(', '),
              media.airStatus === 'Running' || media.airStatus === 'RELEASING' ? 'Still airing' : undefined,
              media.totalPages && `${media.totalPages} ${unitPlural(cat, media.totalPages)}`,
              media.runtime && formatMinutes(media.runtime),
              media.platforms?.slice(0, 3).join(', '),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <select
            value={media.status}
            onChange={(e) => touchMedia(media.id, { status: e.target.value as Status })}
            className="mt-3 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm! font-semibold outline-none"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(cat, s)}
              </option>
            ))}
          </select>
          <div className="mt-3">
            {cat.track === 'episodes' ? (
              <div className="flex items-center gap-2">
                <StarDisplay value={rating} size="size-5" />
                <span className="text-lg font-bold">{rating ? fmtRating(rating) : ''}</span>
                {!rating && <span className="text-sm text-muted">Rate episodes to build a score</span>}
              </div>
            ) : (
              <StarInput
                value={rating}
                size="size-7"
                onChange={(r) => (cat.track === 'once' ? rateViaLogs(media, r) : touchMedia(media.id, { rating: r }))}
              />
            )}
          </div>
        </div>
      </div>

      {media.overview && (
        <button onClick={() => setShowOverview(!showOverview)} className="mt-4 block text-left text-sm leading-relaxed text-muted">
          <span className={showOverview ? 'whitespace-pre-line' : 'line-clamp-3'}>{media.overview}</span>
        </button>
      )}

      {/* Secondary actions */}
      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4">
        <button onClick={() => setSheet('lists')} className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold">
          <Icon name="bookmark" className="size-4" />
          {inLists?.length ? inLists.map((l) => `${l.emoji ?? ''} ${l.name}`.trim()).join(', ') : 'Add to list'}
        </button>
        {canTime && !timing && (
          <button onClick={begin} className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold">
            <Icon name="timer" className="size-4" />
            Start timer
          </button>
        )}
        {canTime && media.status === 'completed' && (
          <button
            onClick={async () => {
              await startOver(media);
              toast(cat.track === 'progress' ? 'Started over from the beginning' : 'Started again');
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold"
          >
            <Icon name="repeat" className="size-4" />
            Start again
          </button>
        )}
      </div>

      {/* Main actions, by how this category is tracked */}
      <div className="mt-5">
        {cat.track === 'once' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setSheet('once')}>
              <Icon name="check" /> {timesDone ? `Log another time` : `Mark ${v.past.toLowerCase()}`}
            </Button>
            {timesDone > 1 && (
              <span className="text-sm text-muted">
                {v.past} {timesDone} times
              </span>
            )}
          </div>
        )}
        {cat.track === 'progress' && (
          <ProgressPanel media={media} page={page} minutes={minutes} onLog={() => setSheet('progress')} onFinish={() => setSheet('finish')} />
        )}
        {cat.track === 'sessions' && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setSheet('session')}>
              <Icon name="plus" /> Log a session
            </Button>
            {media.status !== 'completed' && (
              <Button variant="soft" onClick={() => setSheet('finish')}>
                Finished it
              </Button>
            )}
            {minutes > 0 && (
              <span className="ml-1 text-sm text-muted">
                {formatMinutes(minutes)} {v.past.toLowerCase()} in total
              </span>
            )}
          </div>
        )}
        {cat.track === 'episodes' && <ShowPanel media={media} logs={logs} episodes={episodes} />}
      </div>

      <NotesCard media={media} />

      {/* History */}
      <section className="mt-10">
        <h2 className="mb-2 eyebrow">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">Nothing logged yet.</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface">
            {history.slice(0, 60).map((l) => (
              <button key={l.id} onClick={() => setEditing(l)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                <span className="w-24 shrink-0 text-xs font-medium text-muted">{l.date ? (l.date === todayKey() ? 'Today' : shortDay(l.date)) : 'No date'}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{describe(l, media, epById)}</span>
                {(l.rating || (l.kind === 'finish' && media.rating)) && <StarDisplay value={l.rating ?? media.rating} size="size-3" />}
              </button>
            ))}
          </div>
        )}
      </section>

      <p className="mt-8 text-center text-xs text-muted">
        {media.source && media.source !== 'manual' ? `Details from ${SOURCE_LABEL[media.source] ?? media.source}` : 'Added by you'} · in your library since{' '}
        {shortDay(dateKey(new Date(media.addedAt)))}
      </p>

      <OnceSheet media={media} open={sheet === 'once'} onClose={closeSheet} />
      <ProgressSheet
        media={media}
        open={sheet === 'progress'}
        currentPage={page}
        initialMinutes={timerMinutes}
        onClose={closeSheet}
        onReachedEnd={() => setSheet('finish')}
      />
      <SessionSheet media={media} open={sheet === 'session'} initialMinutes={timerMinutes} onClose={closeSheet} />
      <ListsSheet media={media} open={sheet === 'lists'} onClose={closeSheet} />
      <FinishSheet media={media} open={sheet === 'finish'} onClose={closeSheet} />
      <LogEditor log={editing} media={media} onClose={() => setEditing(undefined)} />
    </div>
  );
}

const STATUSES: Status[] = ['planned', 'active', 'completed', 'paused', 'dropped'];

function describe(l: LogEntry, media: Media, eps: Map<string, Episode>) {
  const cat = getCategory(media.type);
  const v = verb(cat);
  const note = l.note ? ` — ${l.note}` : '';
  switch (l.kind) {
    case 'episode': {
      const t = l.episodeId ? eps.get(l.episodeId)?.title : undefined;
      return `${episodeCode(l.season, l.number)}${t ? ` · ${t}` : ''}`;
    }
    case 'once':
      return `${v.past}${note}`;
    case 'progress':
      return `${l.pages ?? '?'} ${unitPlural(cat, l.pages ?? 2)}${l.fromPage != null ? ` (${l.fromPage} → ${l.toPage})` : ''}${l.minutes ? ` · ${formatMinutes(l.minutes)}` : ''}${note}`;
    case 'session':
      return `${l.minutes ? formatMinutes(l.minutes) : v.past}${note}`;
    case 'finish':
      return 'Finished';
    case 'start':
      return 'Started again';
  }
}

/** Your own review / notes, saved when you leave the box. */
function NotesCard({ media }: { media: Media }) {
  const [text, setText] = useState(media.notes ?? '');
  useEffect(() => {
    setText(media.notes ?? '');
  }, [media.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    if ((media.notes ?? '') !== text) touchMedia(media.id, { notes: text.trim() || undefined });
  };
  return (
    <section className="mt-8">
      <h2 className="mb-2 eyebrow">Your thoughts</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        placeholder={`What did you think of ${media.title}? Only you can see this.`}
        className="field min-h-24 rounded-2xl! leading-relaxed"
      />
    </section>
  );
}

function ProgressPanel({ media, page, minutes, onLog, onFinish }: { media: Media; page?: number; minutes: number; onLog: () => void; onFinish: () => void }) {
  const cat = getCategory(media.type);
  const unit = (cat.unit ?? 'part').replace(/^./, (x) => x.toUpperCase());
  const pct = page != null && media.totalPages ? Math.min(100, Math.round((page / media.totalPages) * 100)) : undefined;
  return (
    <div className="rounded-3xl bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-semibold">{page != null ? `${unit} ${page}${media.totalPages ? ` of ${media.totalPages}` : ''}` : 'Not started'}</span>
        <span className="text-muted">
          {[minutes ? formatMinutes(minutes) : undefined, pct !== undefined ? `${pct}%` : undefined].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct ?? (media.status === 'completed' ? 100 : 0)}%`, background: catColor(media.type) }} />
      </div>
      {!media.totalPages && (
        <p className="mb-3 text-xs text-muted">
          Add the total number of {unitPlural(cat)} with <span className="font-semibold">Edit</span> to see a progress bar.
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={onLog} className="flex-1">
          <Icon name="plus" /> Log progress
        </Button>
        {media.status !== 'completed' && (
          <Button variant="soft" onClick={onFinish}>
            Finished it
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Shows ---------------- */

function ShowPanel({ media, logs, episodes }: { media: Media; logs: LogEntry[]; episodes: Episode[] }) {
  const settings = useSettings();
  const today = todayKey();
  const watched = useMemo(() => new Set(logs.filter((l) => l.kind === 'episode').map((l) => l.episodeId!)), [logs]);
  const ratings = useMemo(() => showRating(episodes, logs, settings.showRating), [episodes, logs, settings.showRating]);
  const seasons = useMemo(() => {
    const m = new Map<number, Episode[]>();
    episodes.forEach((e) => m.set(e.season, [...(m.get(e.season) ?? []), e]));
    return [...m];
  }, [episodes]);
  const aired = (e: Episode) => !e.airdate || e.airdate <= today;
  const next = episodes.find((e) => aired(e) && !watched.has(e.id));
  const upcoming = episodes.find((e) => !aired(e));
  const airedCount = episodes.filter(aired).length;
  const seenCount = episodes.filter((e) => aired(e) && watched.has(e.id)).length;

  const [open, setOpen] = useState<number | undefined>(next?.season ?? seasons[0]?.[0]);
  const [prompt, setPrompt] = useState<{ log: LogEntry; ep: Episode }>();
  const [bulk, setBulk] = useState<{ title: string; eps: Episode[] }>();
  const [refreshing, setRefreshing] = useState<string>();

  const markWatched = async (ep: Episode) => {
    const log = await logEpisode(media, ep);
    if (settings.promptRating) setPrompt({ log, ep });
  };

  const unmark = async (ep: Episode) => {
    const removed = await db.logs.where('episodeId').equals(ep.id).toArray();
    await db.logs.bulkDelete(removed.map((l) => l.id));
    toast(`${episodeCode(ep.season, ep.number)} marked unwatched`, { label: 'Undo', run: () => db.logs.bulkPut(removed) });
  };


  const bulkMark = async (eps: Episode[], date: string | null) => {
    const base = Date.now();
    const todo = eps.filter((e) => !watched.has(e.id));
    for (const [i, e] of todo.entries()) {
      await addLog({ mediaId: media.id, kind: 'episode', date, episodeId: e.id, season: e.season, number: e.number, at: base + i });
    }
    await maybeCompleteShow(media.id);
  };

  const refresh = async () => {
    setRefreshing('Checking…');
    try {
      const added = await syncEpisodes(media);
      setRefreshing(added > 0 ? `${added} new episode${added > 1 ? 's' : ''}` : 'Up to date');
    } catch {
      setRefreshing("Couldn't reach TVmaze");
    }
    setTimeout(() => setRefreshing(undefined), 2500);
  };

  return (
    <div>
      {/* Progress + next up */}
      <div className="rounded-3xl bg-surface p-4">
        {episodes.length > 0 && (
          <>
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-semibold">
                {seenCount} of {airedCount} episodes
              </span>
              <span className="text-muted">{airedCount ? Math.round((seenCount / airedCount) * 100) : 0}%</span>
            </div>
            <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full transition-all"  style={{ width: `${airedCount ? (seenCount / airedCount) * 100 : 0}%`, background: catColor(media.type) }} />
            </div>
          </>
        )}
        {next ? (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">Up next · {episodeCode(next.season, next.number)}</p>
              <p className="truncate font-semibold">{next.title}</p>
            </div>
            <Button onClick={() => markWatched(next)}>
              <Icon name="check" /> Watched
            </Button>
          </div>
        ) : episodes.length ? (
          <p className="text-sm font-semibold">{upcoming ? `All caught up. Next episode airs ${shortDay(upcoming.airdate!)}.` : 'All caught up 🎉'}</p>
        ) : (
          <p className="text-sm text-muted">
            No episode list for this show.{' '}
            {media.source === 'tvmaze' ? 'Try refreshing below.' : 'Shows added by hand don’t have episodes yet — search for it to get the full list.'}
          </p>
        )}
      </div>

      {/* Seasons */}
      <div className="mt-6 mb-2 flex items-center justify-between">
        <h2 className="eyebrow">Seasons</h2>
        {media.source === 'tvmaze' && (
          <button onClick={refresh} className="flex items-center gap-1 text-xs font-semibold text-accent">
            <Icon name="refresh" className="size-3.5" />
            {refreshing ?? 'Check for new episodes'}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {seasons.map(([s, eps]) => {
          const seen = eps.filter((e) => watched.has(e.id)).length;
          const avg = ratings.bySeason.get(s);
          const isOpen = open === s;
          const airedEps = eps.filter(aired);
          return (
            <div key={s} className="overflow-hidden rounded-3xl bg-surface">
              <button onClick={() => setOpen(isOpen ? undefined : s)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="flex-1">
                  <span className="block font-semibold">{s === 0 ? 'Specials' : `Season ${s}`}</span>
                  <span className="text-xs text-muted">
                    {seen}/{eps.length} watched
                  </span>
                </span>
                {avg !== undefined && (
                  <span className="flex items-center gap-1.5">
                    <StarDisplay value={avg} size="size-3.5" />
                    <span className="text-sm font-bold">{fmtRating(avg)}</span>
                  </span>
                )}
                {seen === eps.length && <Icon name="check" className="size-4 text-accent" strokeWidth={2.6} />}
                <Icon name="down" className={`size-4 text-muted transition ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="border-t border-line">
                  {airedEps.some((e) => !watched.has(e.id)) && (
                    <button
                      onClick={() => setBulk({ title: `Mark ${s === 0 ? 'specials' : `season ${s}`} watched`, eps: airedEps })}
                      className="w-full px-4 py-2 text-left text-xs font-semibold text-accent"
                    >
                      Mark whole season watched
                    </button>
                  )}
                  {eps.map((e) => {
                    const isSeen = watched.has(e.id);
                    const isAired = aired(e);
                    return (
                      <div key={e.id} className={`flex items-center gap-3 border-t border-line/60 px-3 py-2 ${isAired ? '' : 'opacity-50'}`}>
                        <button
                          disabled={!isAired}
                          onClick={() => (isSeen ? unmark(e) : markWatched(e))}
                          aria-label={isSeen ? 'Mark unwatched' : 'Mark watched'}
                          className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition ${
                            isSeen ? 'border-accent bg-accent text-on-accent' : 'border-line text-transparent hover:border-accent'
                          }`}
                        >
                          <Icon name="check" className="size-4" strokeWidth={3} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            <span className="mr-1.5 text-muted">{e.number}</span>
                            {e.title}
                          </p>
                          <p className="text-xs text-muted">
                            {e.airdate ? (isAired ? shortDay(e.airdate) : `Airs ${shortDay(e.airdate)}`) : ''}
                            {e.runtime ? ` · ${e.runtime}m` : ''}
                          </p>
                        </div>
                        {isAired && (
                          <StarInput value={ratings.byEpisode.get(e.id)} onChange={(r) => rateViaLogs(media, r, e)} size="size-4.5" />
                        )}
                        {!isSeen && isAired && next && e.id !== next.id && (
                          <button
                            title="Mark everything up to here watched"
                            onClick={() =>
                              setBulk({
                                title: `Watched up to ${episodeCode(e.season, e.number)}`,
                                eps: episodes.filter((x) => aired(x) && (x.season < e.season || (x.season === e.season && x.number <= e.number))),
                              })
                            }
                            className="hidden text-[11px] font-semibold text-accent sm:block"
                          >
                            up to here
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <RatePrompt
        log={prompt?.log}
        heading={prompt ? `How was ${episodeCode(prompt.ep.season, prompt.ep.number)}?` : ''}
        sub={prompt?.ep.title}
        onClose={() => setPrompt(undefined)}
      />
      <BulkWatchSheet
        open={!!bulk}
        title={bulk?.title ?? ''}
        count={bulk?.eps.filter((e) => !watched.has(e.id)).length ?? 0}
        onClose={() => setBulk(undefined)}
        onConfirm={(date) => bulkMark(bulk!.eps, date)}
      />
    </div>
  );
}
