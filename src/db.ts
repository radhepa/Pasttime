import Dexie, { type Table } from 'dexie';
import type { Episode, LogEntry, Media, MediaList, SearchResult } from './types';
import type { CategoryRow } from './lib/categories';
import { fetchAnilistEpisodeCount, fetchBookDescription, fetchEpisodes, fetchShowStatus } from './lib/search';
import { cancelTimer, getTimer } from './lib/timer';
import { todayKey } from './lib/dates';
import { getSettings, setSettings, type Settings } from './lib/settings';

class PastimeDB extends Dexie {
  media!: Table<Media, string>;
  episodes!: Table<Episode, string>;
  logs!: Table<LogEntry, string>;
  lists!: Table<MediaList, string>;
  categories!: Table<CategoryRow, string>;

  constructor() {
    super('pastime');
    this.version(1).stores({
      media: 'id, type, status, updatedAt, [source+sourceId]',
      episodes: 'id, mediaId, [mediaId+season+number]',
      logs: 'id, mediaId, date, episodeId, at',
    });
    this.version(2).stores({
      lists: 'id, updatedAt',
    });
    // v3: categories became data; log kinds got category-neutral names.
    this.version(3)
      .stores({ categories: 'id' })
      .upgrade((tx) =>
        tx
          .table('logs')
          .toCollection()
          .modify((l: { kind: string }) => {
            l.kind = ({ movie: 'once', reading: 'progress', play: 'session' } as Record<string, string>)[l.kind] ?? l.kind;
          }),
      );
  }
}

export const db = new PastimeDB();

export const uid = () => crypto.randomUUID();

/*
 * Safari on iPhone has IndexedDB bugs with cursors ("UnknownError: Unable to open cursor", worst on an
 * empty database), so app code sticks to plain reads: get / bulkGet / where(…).equals(…).toArray() /
 * toArray() / count(), then sorts and filters in JavaScript. Avoid anyOf, each, modify, filter,
 * reverse, uniqueKeys, offset/limit and Collection.delete here.
 */
export const newestFirst = <T extends { updatedAt: number }>(rows: T[]) => rows.sort((a, b) => b.updatedAt - a.updatedAt);

export async function findBySource(source: string, sourceId: string) {
  return db.media.where('[source+sourceId]').equals([source, sourceId]).first();
}

const adding = new Map<string, Promise<string>>();

/** Adds a search result to the library (or returns the existing entry). A double tap adds it once. */
export function addFromResult(r: SearchResult): Promise<string> {
  const key = `${r.source}:${r.sourceId}`;
  const pending = adding.get(key);
  if (pending) return pending;
  const job = addNew(r).finally(() => adding.delete(key));
  adding.set(key, job);
  return job;
}

async function addNew(r: SearchResult): Promise<string> {
  const existing = await findBySource(r.source, r.sourceId);
  if (existing) return existing.id;
  const now = Date.now();
  const media: Media = {
    id: uid(),
    type: r.type,
    title: r.title,
    year: r.year,
    cover: r.cover,
    overview: r.overview,
    creators: r.creators,
    genres: r.genres,
    source: r.source,
    sourceId: r.sourceId,
    totalPages: r.totalPages,
    platforms: r.platforms,
    airStatus: r.airStatus,
    runtime: r.runtime,
    oneShot: r.oneShot || undefined,
    status: 'planned',
    addedAt: now,
    updatedAt: now,
  };
  await db.media.add(media);
  if (media.source === 'tvmaze' && !media.oneShot) await syncEpisodes(media).catch(() => undefined);
  if (r.episodeCount && !media.oneShot) await fillEpisodes(media.id, r.episodeCount);
  if (media.source === 'openlibrary' && !media.overview) {
    // Search results don't carry the blurb; fetch it in the background.
    fetchBookDescription(r.sourceId)
      .then((overview) => (overview ? touchMedia(media.id, { overview }) : undefined))
      .catch(() => undefined);
  }
  return media.id;
}

/** Makes sure season 1 has episodes 1…count (for sources that only give a count, like AniList). */
async function fillEpisodes(mediaId: string, count: number) {
  const existing = await db.episodes.where('mediaId').equals(mediaId).toArray();
  const have = new Set(existing.filter((e) => e.season === 1).map((e) => e.number));
  const add: Episode[] = [];
  for (let n = 1; n <= count; n++) if (!have.has(n)) add.push({ id: uid(), mediaId, season: 1, number: n, title: `Episode ${n}` });
  if (add.length) await db.episodes.bulkAdd(add);
  return add.length;
}

/**
 * Pulls the episode list (and whether the show has ended) from its database. Keeps existing episode ids
 * so your logs stay attached. A show that has now ended and is fully watched moves to "completed".
 */
export async function syncEpisodes(media: Media) {
  if (media.oneShot) return 0;
  const checked = { episodesCheckedAt: Date.now() };
  if (media.source === 'anilist' && media.sourceId) {
    const { count, status } = await fetchAnilistEpisodeCount(media.sourceId);
    const added = count ? await fillEpisodes(media.id, count) : 0;
    await db.media.update(media.id, status && status !== media.airStatus ? { ...checked, airStatus: status, updatedAt: Date.now() } : checked);
    await maybeCompleteShow(media.id);
    return added;
  }
  if (media.source !== 'tvmaze' || !media.sourceId) return 0;
  const [fresh, status] = await Promise.all([fetchEpisodes(media.sourceId), fetchShowStatus(media.sourceId).catch(() => undefined)]);
  await db.media.update(media.id, status && status !== media.airStatus ? { ...checked, airStatus: status, updatedAt: Date.now() } : checked);
  const existing = await db.episodes.where('mediaId').equals(media.id).toArray();
  const byKey = new Map(existing.map((e) => [`${e.season}x${e.number}`, e]));
  const rows: Episode[] = fresh.map((e) => ({
    ...e,
    id: byKey.get(`${e.season}x${e.number}`)?.id ?? uid(),
    mediaId: media.id,
  }));
  await db.episodes.bulkPut(rows);
  await maybeCompleteShow(media.id);
  return rows.length - existing.length;
}

/**
 * Switches a title between "has episodes" and "one-time, like a movie" (oneShot), carrying your history over:
 * watching its single episode becomes watching the film, and back.
 */
export async function setOneShot(id: string, on: boolean) {
  const media = await db.media.get(id);
  if (!media) return;
  const now = Date.now();
  const logs = await db.logs.where('mediaId').equals(id).toArray();
  if (on) {
    const moved = logs
      .filter((l) => l.kind === 'episode')
      .map(({ episodeId: _e, season: _s, number: _n, ...l }) => ({ ...l, kind: 'once' as const, updatedAt: now }));
    if (moved.length) await db.logs.bulkPut(moved);
    await db.media.update(id, { oneShot: true, ...(moved.length ? { status: 'completed' as const } : {}), updatedAt: now });
    return;
  }
  await db.media.update(id, { oneShot: undefined, updatedAt: now });
  let eps = await db.episodes.where('mediaId').equals(id).toArray();
  if (!eps.length) {
    await syncEpisodes({ ...media, oneShot: undefined }).catch(() => undefined);
    eps = await db.episodes.where('mediaId').equals(id).toArray();
  }
  const first = eps.sort((a, b) => (a.season || 99) - (b.season || 99) || a.number - b.number)[0];
  if (!first) return;
  const moved = logs
    .filter((l) => l.kind === 'once')
    .map((l) => ({ ...l, kind: 'episode' as const, episodeId: first.id, season: first.season, number: first.number, updatedAt: now }));
  if (moved.length) await db.logs.bulkPut(moved);
}

export async function deleteMedia(id: string) {
  if (getTimer()?.mediaId === id) cancelTimer();
  await db.transaction('rw', [db.media, db.episodes, db.logs, db.lists], async () => {
    const lists = (await db.lists.toArray()).filter((l) => l.items.includes(id));
    await db.lists.bulkPut(lists.map((l) => ({ ...l, items: l.items.filter((x) => x !== id) })));
    await db.logs.bulkDelete((await db.logs.where('mediaId').equals(id).toArray()).map((l) => l.id));
    await db.episodes.bulkDelete((await db.episodes.where('mediaId').equals(id).toArray()).map((e) => e.id));
    await db.media.delete(id);
  });
}

export async function touchMedia(id: string, patch: Partial<Media> = {}) {
  await db.media.update(id, { ...patch, updatedAt: Date.now() });
}

/** First activity on something you only planned to do moves it to "in progress". */
export async function markActiveIfPlanned(id: string) {
  const m = await db.media.get(id);
  if (m && m.status === 'planned') await touchMedia(id, { status: 'active' });
}

export async function addLog(entry: Omit<LogEntry, 'id' | 'at' | 'updatedAt'> & { at?: number }) {
  const now = Date.now();
  const log: LogEntry = { ...entry, id: uid(), at: entry.at ?? now, updatedAt: now };
  await db.logs.add(log);
  await markActiveIfPlanned(entry.mediaId);
  return log;
}

/** Marks an episode watched (today by default) and returns the new log so it can be rated. */
export async function logEpisode(media: Media, ep: Episode, date: string | null = todayKey(), rating?: number) {
  const log = await addLog({
    mediaId: media.id,
    kind: 'episode',
    date,
    episodeId: ep.id,
    season: ep.season,
    number: ep.number,
    rating,
  });
  await maybeCompleteShow(media.id);
  return log;
}

/** A finished series with every aired episode watched moves to "completed". */
export async function maybeCompleteShow(mediaId: string) {
  const m = await db.media.get(mediaId);
  if (!m || !['Ended', 'FINISHED'].includes(m.airStatus ?? '')) return;
  const eps = await db.episodes.where('mediaId').equals(mediaId).toArray();
  const watched = new Set((await db.logs.where('mediaId').equals(mediaId).toArray()).map((l) => l.episodeId));
  const today = todayKey();
  const aired = eps.filter((e) => !e.airdate || e.airdate <= today);
  if (aired.length && aired.every((e) => watched.has(e.id))) await touchMedia(mediaId, { status: 'completed' });
}

/** Sets the rating for an episode or a one-time title: updates its most recent log, or records an undated one. */
export async function rateViaLogs(media: Media, rating: number | undefined, ep?: Episode) {
  const logs = (await db.logs.where('mediaId').equals(media.id).toArray())
    .filter((l) => (ep ? l.episodeId === ep.id : l.kind === 'once'))
    .sort((a, b) => b.at - a.at);
  if (rating === undefined) {
    // Clearing: the shown rating may come from an older viewing, so clear every rated one.
    const rated = logs.filter((l) => l.rating);
    if (rated.length) await db.logs.bulkPut(rated.map((l) => ({ ...l, rating: undefined, updatedAt: Date.now() })));
    return;
  }
  if (logs[0]) {
    await db.logs.update(logs[0].id, { rating, updatedAt: Date.now() });
  } else if (rating) {
    await addLog(
      ep
        ? { mediaId: media.id, kind: 'episode', date: null, episodeId: ep.id, season: ep.season, number: ep.number, rating }
        : { mediaId: media.id, kind: 'once', date: null, rating },
    );
  }
}

export async function exportAll() {
  return {
    app: 'pastime',
    version: 3,
    exportedAt: new Date().toISOString(),
    media: await db.media.toArray(),
    episodes: await db.episodes.toArray(),
    logs: await db.logs.toArray(),
    lists: await db.lists.toArray(),
    categories: await db.categories.toArray(),
    settings: (() => {
      const { lastBackupAt: _, ...rest } = getSettings();
      return rest;
    })(),
  };
}

const OLD_KINDS: Record<string, LogEntry['kind']> = { movie: 'once', reading: 'progress', play: 'session' };

export async function importAll(data: {
  media?: Media[];
  episodes?: Episode[];
  logs?: LogEntry[];
  lists?: MediaList[];
  categories?: CategoryRow[];
  settings?: Partial<Settings>;
}) {
  if (data.settings && typeof data.settings === 'object') {
    const { lastBackupAt: _, ...rest } = data.settings;
    setSettings(rest);
  }
  await db.transaction('rw', [db.media, db.episodes, db.logs, db.lists, db.categories], async () => {
    await db.media.bulkPut(data.media ?? []);
    await db.episodes.bulkPut(data.episodes ?? []);
    await db.logs.bulkPut((data.logs ?? []).map((l) => ({ ...l, kind: OLD_KINDS[l.kind] ?? l.kind })));
    await db.lists.bulkPut(data.lists ?? []);
    await db.categories.bulkPut(data.categories ?? []);
  });
}

/* ---------------- Lists ---------------- */

export async function createList(name: string, emoji?: string) {
  const now = Date.now();
  const list: MediaList = { id: uid(), name: name.trim(), emoji, items: [], createdAt: now, updatedAt: now };
  await db.lists.add(list);
  return list;
}

export async function toggleInList(listId: string, mediaId: string) {
  const list = await db.lists.get(listId);
  if (!list) return;
  const items = list.items.includes(mediaId) ? list.items.filter((x) => x !== mediaId) : [...list.items, mediaId];
  await db.lists.update(listId, { items, updatedAt: Date.now() });
}

/** Begin a reread / replay: progress starts over, history is kept. */
export async function startOver(media: Media) {
  await addLog({ mediaId: media.id, kind: 'start', date: todayKey() });
  await touchMedia(media.id, { status: 'active' });
}
