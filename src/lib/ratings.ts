import type { Episode, LogEntry } from '../types';
import { getSettings, type Settings } from './settings';

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

/*
 * Ratings are stored from 0.5 to 5 in half steps whatever scale you pick. The 10-star scale just shows them
 * doubled: ½★ = 1/10, 4½★ = 9/10. Averages can land anywhere in between (4.3★ = 8.6/10).
 */
export type RatingScale = Settings['ratingScale'];
export const STEP = 0.5;
export const outOf = (scale: RatingScale) => (scale === 'ten' ? 10 : 5);
/** A stored rating in the units of the chosen scale (4.5 → 9 on the 10-star scale). */
export const scaled = (r: number, scale: RatingScale) => (scale === 'ten' ? r * 2 : r);
/** Snaps any number onto the stored scale: 0.5–5 in half steps. */
export const snapRating = (r: number) => Math.min(5, Math.max(STEP, Math.round(r / STEP) * STEP));

/** "4.5", "4.3" on 5 stars; "9", "8.6" on 10. */
export function fmtRating(r?: number, scale: RatingScale = getSettings().ratingScale) {
  if (r === undefined) return '';
  const v = Math.round(scaled(r, scale) * 10) / 10;
  return scale === 'ten' && Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** For screen readers and tooltips: "4.5 out of 5 stars". */
export const ratingWords = (r: number | undefined, scale: RatingScale = getSettings().ratingScale) =>
  r ? `${fmtRating(r, scale)} out of ${outOf(scale)} stars` : 'Not rated';
