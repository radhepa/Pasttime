import type { Episode, LogEntry, Media } from '../types';
import { formatMinutes, todayKey } from './dates';
import { onceRating, showRating } from './ratings';
import { getCategory, unitPlural, verb } from './categories';

export interface MediaStats {
  rating?: number;
  /** 0–1, when it makes sense for the category. */
  progress?: number;
  progressLabel?: string;
  lastActivity: number;
  currentPage?: number;
  totalMinutes?: number;
}

/** Where you are (page/chapter/lesson…): the latest progress entry since you last started over. */
export function currentPage(logs: LogEntry[]) {
  const restart = Math.max(0, ...logs.filter((l) => l.kind === 'start').map((l) => l.at));
  return logs.filter((l) => l.kind === 'progress' && l.toPage != null && l.at > restart).sort((a, b) => b.at - a.at)[0]?.toPage;
}

/** The rating shown for a title, whatever its category. */
export function ratingFor(media: Media, logs: LogEntry[], episodes: Episode[], showMode: 'seasons' | 'episodes') {
  const track = getCategory(media.type).track;
  if (track === 'episodes') return showRating(episodes, logs, showMode).overall;
  if (track === 'once') return onceRating(logs) ?? media.rating;
  return media.rating;
}

export function statsFor(media: Media, logs: LogEntry[], episodes: Episode[], showMode: 'seasons' | 'episodes'): MediaStats {
  const c = getCategory(media.type);
  const lastActivity = Math.max(media.updatedAt, ...logs.map((l) => l.at));
  const rating = ratingFor(media, logs, episodes, showMode);
  const minutes = logs.reduce((s, l) => s + (l.kind === 'session' || l.kind === 'progress' ? (l.minutes ?? 0) : 0), 0);
  switch (c.track) {
    case 'episodes': {
      const today = todayKey();
      const aired = episodes.filter((e) => !e.airdate || e.airdate <= today);
      const watched = new Set(logs.filter((l) => l.kind === 'episode').map((l) => l.episodeId));
      const seen = aired.filter((e) => watched.has(e.id)).length;
      return {
        rating,
        progress: aired.length ? seen / aired.length : undefined,
        progressLabel: aired.length ? `${seen}/${aired.length} episodes` : undefined,
        lastActivity,
      };
    }
    case 'once': {
      const times = logs.filter((l) => l.kind === 'once').length;
      return { rating, lastActivity, progressLabel: times > 1 ? `${verb(c).past} ${times}×` : undefined };
    }
    case 'progress': {
      const page = currentPage(logs);
      const unit = c.unit === 'page' ? 'p.' : `${c.unit ?? ''}`.replace(/^./, (x) => x.toUpperCase());
      return {
        rating,
        currentPage: page,
        totalMinutes: minutes,
        progress: page != null && media.totalPages ? Math.min(1, page / media.totalPages) : media.status === 'completed' ? 1 : undefined,
        progressLabel: page != null ? `${unit} ${page}${media.totalPages ? ` of ${media.totalPages}` : ''}` : undefined,
        lastActivity,
      };
    }
    case 'sessions':
      return {
        rating,
        totalMinutes: minutes,
        progressLabel: minutes ? `${formatMinutes(minutes)} ${verb(c).past.toLowerCase()}` : undefined,
        lastActivity,
      };
  }
}

/** "15 pages", "3 chapters", "1 lesson". */
export const unitCount = (type: string, n: number) => `${n} ${unitPlural(getCategory(type), n)}`;
