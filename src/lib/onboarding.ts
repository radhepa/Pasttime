/**
 * First-run setup: which categories you use, what you've already seen, and how the app looks.
 * Whether it's been done is remembered per device (not synced), so running it again on one device
 * never pops it up on the others.
 */
import { addFromResult, addLog, db, maybeCompleteShow, touchMedia } from '../db';
import type { SearchResult } from '../types';
import { trackOf } from './categories';
import { todayKey } from './dates';

const KEY = 'pastime.onboarded';

export function isOnboarded() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return true; // storage blocked: don't trap anyone in setup
  }
}

export function setOnboarded() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* it will just ask again next time */
  }
}

export type Picks = Record<string, SearchResult[]>;

/** Popular titles per category for the "what have you seen?" step (loaded only when setup runs). */
let picks: Promise<Picks> | undefined;
export const loadPicks = () =>
  (picks ??= import('../data/onboardingPicks.json')
    .then((m) => m.default as unknown as Picks)
    .catch((e) => {
      picks = undefined; // offline: try again next time
      throw e;
    }));

/**
 * Adds a title you've already finished, with undated entries ("at some point") so it counts toward your
 * library and stats without filling up today's timeline. A show still airing counts as caught up.
 */
export async function addAsSeen(r: SearchResult) {
  const id = await addFromResult(r);
  const media = await db.media.get(id);
  if (!media) return id;
  const logs = await db.logs.where('mediaId').equals(id).toArray();
  const at = Date.now();
  switch (trackOf(media)) {
    case 'once':
      if (!logs.some((l) => l.kind === 'once')) await addLog({ mediaId: id, kind: 'once', date: null, at });
      await touchMedia(id, { status: 'completed' });
      break;
    case 'episodes': {
      const today = todayKey();
      const seen = new Set(logs.map((l) => l.episodeId));
      const eps = (await db.episodes.where('mediaId').equals(id).toArray())
        .filter((e) => (!e.airdate || e.airdate <= today) && !seen.has(e.id))
        .sort((a, b) => a.season - b.season || a.number - b.number);
      const now = Date.now();
      await db.logs.bulkAdd(
        eps.map((e, i) => ({
          id: crypto.randomUUID(),
          mediaId: id,
          kind: 'episode' as const,
          date: null,
          at: at + i,
          episodeId: e.id,
          season: e.season,
          number: e.number,
          updatedAt: now,
        })),
      );
      await touchMedia(id, { status: 'active' });
      await maybeCompleteShow(id); // finished shows move on to "completed"
      break;
    }
    default:
      if (!logs.some((l) => l.kind === 'finish')) await addLog({ mediaId: id, kind: 'finish', date: null, at });
      await touchMedia(id, { status: 'completed' });
  }
  return id;
}
