import type { Episode, LogEntry } from '../types';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Latest rating per episode (a rewatch with a new rating replaces the old one). */
export function episodeRatings(logs: LogEntry[]) {
  const latest = new Map<string, LogEntry>();
  for (const l of logs) {
    if (l.kind !== 'episode' || !l.episodeId || !l.rating) continue;
    const prev = latest.get(l.episodeId);
    if (!prev || l.at > prev.at) latest.set(l.episodeId, l);
  }
  return new Map([...latest].map(([id, l]) => [id, l.rating!]));
}

export interface ShowRating {
  overall?: number;
  bySeason: Map<number, number>;
  byEpisode: Map<string, number>;
  ratedCount: number;
}

export function showRating(episodes: Episode[], logs: LogEntry[], mode: 'seasons' | 'episodes'): ShowRating {
  const byEpisode = episodeRatings(logs);
  const seasonOf = new Map(episodes.map((e) => [e.id, e.season]));
  const perSeason = new Map<number, number[]>();
  for (const [id, r] of byEpisode) {
    const s = seasonOf.get(id);
    if (s === undefined) continue;
    perSeason.set(s, [...(perSeason.get(s) ?? []), r]);
  }
  const bySeason = new Map([...perSeason].map(([s, rs]) => [s, avg(rs)!]));
  const overall = mode === 'seasons' ? avg([...bySeason.values()]) : avg([...byEpisode.values()]);
  return { overall, bySeason, byEpisode, ratedCount: byEpisode.size };
}

/** One-time titles (movies, albums, concerts…): the rating from your most recent rated time. */
export function onceRating(logs: LogEntry[]) {
  return logs
    .filter((l) => l.kind === 'once' && l.rating)
    .sort((a, b) => b.at - a.at)[0]?.rating;
}

export const fmtRating = (r?: number) => (r === undefined ? '' : (Math.round(r * 10) / 10).toFixed(1));
