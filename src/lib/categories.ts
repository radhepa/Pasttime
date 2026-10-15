/**
 * Categories are data, not code: every built-in one can be renamed or hidden, and you can add your own.
 * What a category *does* is decided by `track`:
 *   episodes  → seasons & episodes, rate each episode (shows, anime…)
 *   once      → log each time you experience it, rate it (movies, albums, concerts…)
 *   progress  → "I'm now on page/chapter/issue N" (books, manga, courses…)
 *   sessions  → log time spent (games, podcasts, audiobooks…)
 */
import { useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../db';
import type { Status } from '../types';

export type Track = 'episodes' | 'once' | 'progress' | 'sessions';
export type Verb = 'watch' | 'read' | 'play' | 'listen' | 'attend' | 'visit' | 'take' | 'do';

export type SearchSource =
  | { provider: 'tvmaze' }
  | { provider: 'openlibrary' }
  | { provider: 'wikipedia'; templates?: string[]; extra?: string }
  | { provider: 'anilist'; type: 'ANIME' | 'MANGA'; format?: 'NOVEL' }
  | { provider: 'itunes'; media: 'podcast' | 'audiobook' }
  | { provider: 'musicbrainz' };

export const COLORS = ['violet', 'rose', 'amber', 'emerald', 'sky', 'orange', 'pink', 'teal', 'indigo', 'lime', 'red', 'cyan', 'fuchsia', 'slate'] as const;
export type ColorKey = (typeof COLORS)[number];

export interface Category {
  id: string;
  name: string;
  plural: string;
  emoji: string;
  color: ColorKey;
  track: Track;
  /** Progress categories: what you count, singular ("page", "chapter"). */
  unit?: string;
  verb: Verb;
  search?: SearchSource;
  /** Label for the people behind it: author, director, artist… */
  creatorLabel?: string;
  /** Stats: how long one time usually takes (once), or one unit (progress), when you didn't log minutes. */
  typicalMinutes?: number;
  minutesPerUnit?: number;
  builtIn?: boolean;
  hidden?: boolean;
  order?: number;
}

export const BUILT_IN: Category[] = [
  { id: 'show', name: 'Show', plural: 'Shows', emoji: '📺', color: 'violet', track: 'episodes', verb: 'watch', search: { provider: 'tvmaze' }, creatorLabel: 'Network', typicalMinutes: 45 },
  { id: 'movie', name: 'Movie', plural: 'Movies', emoji: '🎬', color: 'rose', track: 'once', verb: 'watch', search: { provider: 'wikipedia', templates: ['Infobox film'] }, creatorLabel: 'Director', typicalMinutes: 120 },
  { id: 'book', name: 'Book', plural: 'Books', emoji: '📖', color: 'amber', track: 'progress', unit: 'page', verb: 'read', search: { provider: 'openlibrary' }, creatorLabel: 'Author', minutesPerUnit: 1.5 },
  { id: 'game', name: 'Game', plural: 'Games', emoji: '🎮', color: 'emerald', track: 'sessions', verb: 'play', search: { provider: 'wikipedia', templates: ['Infobox video game'] }, creatorLabel: 'Developer' },
  { id: 'anime', name: 'Anime', plural: 'Anime', emoji: '🌸', color: 'pink', track: 'episodes', verb: 'watch', search: { provider: 'anilist', type: 'ANIME' }, creatorLabel: 'Studio', typicalMinutes: 24 },
  { id: 'manga', name: 'Manga', plural: 'Manga', emoji: '🗯️', color: 'red', track: 'progress', unit: 'chapter', verb: 'read', search: { provider: 'anilist', type: 'MANGA' }, creatorLabel: 'Author', minutesPerUnit: 6 },
  { id: 'lightnovel', name: 'Light novel', plural: 'Light novels', emoji: '📘', color: 'indigo', track: 'progress', unit: 'volume', verb: 'read', search: { provider: 'anilist', type: 'MANGA', format: 'NOVEL' }, creatorLabel: 'Author', minutesPerUnit: 240 },
  { id: 'comic', name: 'Comic', plural: 'Comics', emoji: '💥', color: 'orange', track: 'progress', unit: 'issue', verb: 'read', search: { provider: 'wikipedia', templates: ['Infobox comic book title'] }, creatorLabel: 'Writer', minutesPerUnit: 20 },
  { id: 'podcast', name: 'Podcast', plural: 'Podcasts', emoji: '🎙️', color: 'teal', track: 'sessions', verb: 'listen', search: { provider: 'itunes', media: 'podcast' }, creatorLabel: 'Host' },
  { id: 'audiobook', name: 'Audiobook', plural: 'Audiobooks', emoji: '🎧', color: 'cyan', track: 'sessions', verb: 'listen', search: { provider: 'itunes', media: 'audiobook' }, creatorLabel: 'Author' },
  { id: 'album', name: 'Album', plural: 'Albums', emoji: '💿', color: 'fuchsia', track: 'once', verb: 'listen', search: { provider: 'musicbrainz' }, creatorLabel: 'Artist', typicalMinutes: 45 },
  { id: 'documentary', name: 'Documentary', plural: 'Documentaries', emoji: '🎞️', color: 'sky', track: 'once', verb: 'watch', search: { provider: 'wikipedia', templates: ['Infobox film'], extra: 'documentary' }, creatorLabel: 'Director', typicalMinutes: 95 },
  { id: 'theater', name: 'Play / musical', plural: 'Theater', emoji: '🎭', color: 'lime', track: 'once', verb: 'attend', search: { provider: 'wikipedia', templates: ['Infobox musical', 'Infobox play'] }, creatorLabel: 'Writer', typicalMinutes: 150 },
  { id: 'concert', name: 'Concert', plural: 'Concerts', emoji: '🎤', color: 'orange', track: 'once', verb: 'attend', search: { provider: 'wikipedia', templates: ['Infobox concert tour'] }, creatorLabel: 'Artist', typicalMinutes: 150 },
  { id: 'boardgame', name: 'Board game', plural: 'Board games', emoji: '🎲', color: 'lime', track: 'sessions', verb: 'play', search: { provider: 'wikipedia', templates: ['Infobox game'] }, creatorLabel: 'Designer' },
  { id: 'magazine', name: 'Magazine', plural: 'Magazines', emoji: '🗞️', color: 'slate', track: 'progress', unit: 'issue', verb: 'read', search: { provider: 'wikipedia', templates: ['Infobox magazine'] }, creatorLabel: 'Publisher', minutesPerUnit: 40 },
  { id: 'article', name: 'Article', plural: 'Articles', emoji: '📰', color: 'slate', track: 'once', verb: 'read', creatorLabel: 'Author', typicalMinutes: 10 },
  { id: 'video', name: 'Video / channel', plural: 'Videos', emoji: '▶️', color: 'red', track: 'sessions', verb: 'watch', creatorLabel: 'Creator' },
  { id: 'course', name: 'Course', plural: 'Courses', emoji: '🎓', color: 'indigo', track: 'progress', unit: 'lesson', verb: 'take', creatorLabel: 'Teacher', minutesPerUnit: 30 },
  { id: 'museum', name: 'Museum / exhibit', plural: 'Museums & exhibits', emoji: '🖼️', color: 'amber', track: 'once', verb: 'visit', search: { provider: 'wikipedia', templates: ['Infobox museum'] }, creatorLabel: 'City', typicalMinutes: 120 },
  { id: 'sport', name: 'Sports event', plural: 'Sports', emoji: '🏟️', color: 'emerald', track: 'once', verb: 'attend', creatorLabel: 'Teams', typicalMinutes: 150 },
].map((c, i) => ({ ...c, builtIn: true, order: i }) as Category);

const VERBS: Record<Verb, { past: string; doing: string; want: string; base: string }> = {
  watch: { past: 'Watched', doing: 'Watching', want: 'Want to watch', base: 'watch' },
  read: { past: 'Read', doing: 'Reading', want: 'Want to read', base: 'read' },
  play: { past: 'Played', doing: 'Playing', want: 'Want to play', base: 'play' },
  listen: { past: 'Listened', doing: 'Listening', want: 'Want to listen', base: 'listen' },
  attend: { past: 'Went', doing: 'Going', want: 'Want to go', base: 'go' },
  visit: { past: 'Visited', doing: 'Visiting', want: 'Want to visit', base: 'visit' },
  take: { past: 'Completed', doing: 'Taking', want: 'Want to take', base: 'take' },
  do: { past: 'Done', doing: 'In progress', want: 'Want to do', base: 'do' },
};
export const VERB_OPTIONS: Verb[] = Object.keys(VERBS) as Verb[];
export const verb = (c: Category) => VERBS[c.verb] ?? VERBS.do;

export function statusLabel(c: Category, s: Status) {
  const v = verb(c);
  return { planned: v.want, active: v.doing, completed: c.verb === 'attend' ? 'Went' : v.past, paused: 'Paused', dropped: 'Dropped' }[s];
}

export const unitPlural = (c: Category, n = 2) => {
  const u = c.unit || 'part';
  return n === 1 ? u : u.endsWith('s') ? u : `${u}s`;
};

export const TRACK_INFO: Record<Track, { label: string; hint: string }> = {
  episodes: { label: 'Episodes', hint: 'Seasons and episodes. Rate every episode.' },
  once: { label: 'One-time', hint: 'Log each time you experience it and rate it.' },
  progress: { label: 'Progress', hint: 'Track how far you are: pages, chapters, lessons…' },
  sessions: { label: 'Time spent', hint: 'Log sessions with how long they lasted.' },
};

/* ---------------- Live registry (built-ins + your edits + your own) ---------------- */

/** A stored row: either your edits to a built-in (id matches) or a full custom category. */
export type CategoryRow = Partial<Category> & { id: string; custom?: boolean };

const FALLBACK: Omit<Category, 'id'> = { name: 'Other', plural: 'Other', emoji: '✨', color: 'slate', track: 'once', verb: 'do' };

let rows: CategoryRow[] = [];
let all: Category[] = BUILT_IN;
let byId = new Map(all.map((c) => [c.id, c]));
const listeners = new Set<() => void>();

function rebuild() {
  const over = new Map(rows.map((r) => [r.id, r]));
  const merged = BUILT_IN.map((b) => ({ ...b, ...over.get(b.id), builtIn: true }) as Category);
  const custom = rows.filter((r) => r.custom && !BUILT_IN.some((b) => b.id === r.id)).map((r) => ({ ...FALLBACK, ...r }) as Category);
  all = [...merged, ...custom].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  byId = new Map(all.map((c) => [c.id, c]));
  snapshot = { all, visible: all.filter((c) => !c.hidden) };
  listeners.forEach((l) => l());
}
let snapshot = { all, visible: all };

liveQuery(() => db.categories.toArray()).subscribe({
  next: (r) => {
    rows = r;
    rebuild();
  },
  error: () => undefined,
});

export function getCategory(id: string): Category {
  return byId.get(id) ?? { ...FALLBACK, id, name: id, plural: id };
}

/** How a title is tracked: its category's way, except films and one-off specials, which are always one-time. */
export const trackOf = (m: { type: string; oneShot?: boolean }): Track => (m.oneShot ? 'once' : getCategory(m.type).track);

export function useCategories() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}

export async function saveCategory(patch: CategoryRow) {
  const existing = await db.categories.get(patch.id);
  await db.categories.put({ ...existing, ...patch });
}

export async function moveCategory(id: string, dir: -1 | 1) {
  const list = [...snapshot.all];
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await db.transaction('rw', db.categories, async () => {
    for (const [order, c] of list.entries()) {
      const existing = await db.categories.get(c.id);
      await db.categories.put({ ...existing, id: c.id, order });
    }
  });
}

/** "class" → "classes", "story" → "stories", "game" → "games". */
export function guessPlural(name: string) {
  const n = name.trim();
  if (!n) return '';
  if (/(s|x|z|ch|sh)$/i.test(n)) return `${n}es`;
  if (/[^aeiou]y$/i.test(n)) return `${n.slice(0, -1)}ies`;
  return `${n}s`;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'category';
