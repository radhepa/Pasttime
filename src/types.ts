/** A category id: 'show', 'movie', 'book', 'anime'… or one you made. See lib/categories.ts. */
export type MediaType = string;
export type Status = 'planned' | 'active' | 'completed' | 'paused' | 'dropped';

export interface Media {
  id: string;
  type: MediaType;
  title: string;
  year?: number;
  cover?: string;
  overview?: string;
  /** Author(s), director(s), developer(s), network… depending on type. */
  creators?: string[];
  genres?: string[];
  /** Which database the entry came from, e.g. "tvmaze", "openlibrary", "wikipedia". */
  source?: string;
  sourceId?: string;
  status: Status;
  /** Progress categories: total pages / chapters / issues / lessons… */
  totalPages?: number;
  /** Shows: "Running" / "Ended" as reported by the database. */
  airStatus?: string;
  /** Movies: length in minutes (used for watch-time stats). */
  runtime?: number;
  /** Games */
  platforms?: string[];
  /** Books & games: the overall rating you gave it. Shows and movies compute theirs from logs. */
  rating?: number;
  notes?: string;
  addedAt: number;
  updatedAt: number;
}

export interface Episode {
  id: string;
  mediaId: string;
  season: number;
  number: number;
  title?: string;
  airdate?: string;
  runtime?: number;
  overview?: string;
}

/**
 * episode  – watched an episode (episodes categories)
 * once     – experienced the whole thing: a movie, an album, a concert
 * progress – moved forward in pages/chapters/lessons (fromPage/toPage/pages hold the unit counts)
 * session  – spent time on it (minutes)
 * finish   – finished a progress/sessions title
 * start    – began a reread/replay: progress restarts from 0 after it
 */
export type LogKind = 'episode' | 'once' | 'progress' | 'session' | 'finish' | 'start';

/** One thing you did on one day. This is what the timeline is made of. */
export interface LogEntry {
  id: string;
  mediaId: string;
  kind: LogKind;
  /** Local calendar day, YYYY-MM-DD. null = "watched at some point, date unknown" (kept off the timeline). */
  date: string | null;
  /** Sort key within a day. */
  at: number;
  episodeId?: string;
  season?: number;
  number?: number;
  fromPage?: number;
  toPage?: number;
  pages?: number;
  minutes?: number;
  rating?: number;
  note?: string;
  updatedAt: number;
}

/** A custom collection, e.g. "Comfort shows" or "Summer reading". */
export interface MediaList {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  /** Ordered media ids. */
  items: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SearchResult {
  type: MediaType;
  source: string;
  sourceId: string;
  title: string;
  year?: number;
  cover?: string;
  overview?: string;
  creators?: string[];
  genres?: string[];
  totalPages?: number;
  platforms?: string[];
  airStatus?: string;
  /** Sources that only know how many episodes there are (AniList). */
  episodeCount?: number;
  subtitle?: string;
}
