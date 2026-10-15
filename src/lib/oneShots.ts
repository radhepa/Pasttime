import { db, setOneShot } from '../db';
import { trackOf } from './categories';

/**
 * Titles added before films had their own mode: an episodes title that has finished with exactly one episode
 * (an anime movie from AniList, a TV movie from TVmaze) becomes one-time. Runs once per device.
 */
export async function convertSingleEpisodeTitles() {
  const KEY = 'pastime.oneShotSweep';
  try {
    if (localStorage.getItem(KEY)) return;
  } catch {
    return;
  }
  const [media, episodes] = await Promise.all([db.media.toArray(), db.episodes.toArray()]);
  const perMedia = new Map<string, number>();
  for (const e of episodes) perMedia.set(e.mediaId, (perMedia.get(e.mediaId) ?? 0) + 1);
  for (const m of media) {
    const ended = ['Ended', 'FINISHED'].includes(m.airStatus ?? '');
    if (!m.oneShot && ended && (m.source === 'anilist' || m.source === 'tvmaze') && perMedia.get(m.id) === 1 && trackOf(m) === 'episodes')
      await setOneShot(m.id, true);
  }
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* fine: it just runs again next time */
  }
}

