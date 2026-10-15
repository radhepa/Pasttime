/**
 * Bring your history over from Goodreads (books) and Letterboxd (movies).
 * Both export plain CSV files, so this runs entirely on your device.
 */
import { db, uid } from '../db';
import type { LogEntry, Media, Status } from '../types';
import { getCategory } from './categories';
import { searchCategory } from './search';

/** RFC 4180-ish CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => h.replace(/^﻿/, '').trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const toDate = (s?: string) => {
  const m = s?.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};

export interface ImportResult {
  added: number;
  updated: number;
  entries: number;
  kind: string;
}

/** Finds an existing title of this category by title (+ year), so imports don't create duplicates. */
async function findExisting(type: string, title: string, year?: number) {
  const all = await db.media.where('type').equals(type).toArray();
  return all.find((m) => norm(m.title) === norm(title) && (!year || !m.year || Math.abs(m.year - year) <= 1));
}

async function upsert(partial: Omit<Media, 'id' | 'addedAt' | 'updatedAt' | 'status'> & { status: Status }, stats: ImportResult) {
  const existing = await findExisting(partial.type, partial.title, partial.year);
  const now = Date.now();
  if (existing) {
    const patch: Partial<Media> = { updatedAt: now };
    for (const k of ['cover', 'totalPages', 'creators', 'notes', 'year', 'rating'] as const)
      if (existing[k] == null && partial[k] != null) Object.assign(patch, { [k]: partial[k] });
    // Never move something backwards (e.g. "want to watch" over "watched").
    const rank: Record<Status, number> = { planned: 0, active: 1, paused: 1, dropped: 1, completed: 2 };
    if (rank[partial.status] > rank[existing.status]) patch.status = partial.status;
    await db.media.update(existing.id, patch);
    stats.updated++;
    return { ...existing, ...patch };
  }
  const media: Media = { ...partial, id: uid(), addedAt: now, updatedAt: now };
  await db.media.add(media);
  stats.added++;
  return media;
}

async function log(entry: Omit<LogEntry, 'id' | 'updatedAt' | 'at'> & { at?: number }, stats: ImportResult) {
  const now = Date.now();
  const at = entry.at ?? (entry.date ? new Date(`${entry.date}T20:00:00`).getTime() : now);
  await db.logs.add({ ...entry, id: uid(), at, updatedAt: now });
  stats.entries++;
}

/* ---------------- Goodreads: goodreads_library_export.csv ---------------- */

async function importGoodreads(rows: Record<string, string>[]): Promise<ImportResult> {
  const stats: ImportResult = { added: 0, updated: 0, entries: 0, kind: 'Goodreads' };
  for (const r of rows) {
    if (!r.Title) continue;
    const isbn = (r.ISBN13 || r.ISBN || '').replace(/[^0-9X]/gi, '');
    const shelf = r['Exclusive Shelf'];
    const status: Status = shelf === 'read' ? 'completed' : shelf === 'currently-reading' ? 'active' : 'planned';
    const rating = Number(r['My Rating']) || undefined;
    const authors = [r.Author, ...(r['Additional Authors'] || '').split(',')].map((a) => a.trim()).filter(Boolean);
    const media = await upsert(
      {
        type: 'book',
        title: r.Title.replace(/\s*\([^)]*#\d+[^)]*\)$/, ''), // "Dune (Dune #1)" → "Dune"
        year: Number(r['Original Publication Year'] || r['Year Published']) || undefined,
        creators: authors.length ? authors : undefined,
        totalPages: Number(r['Number of Pages']) || undefined,
        cover: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : undefined,
        notes: r['My Review'] || undefined,
        rating,
        source: 'import',
        sourceId: `goodreads:${r['Book Id']}`,
        status,
      },
      stats,
    );
    if (status === 'completed') {
      const already = (await db.logs.where('mediaId').equals(media.id).toArray()).some((l) => l.kind === 'finish');
      if (!already) await log({ mediaId: media.id, kind: 'finish', date: toDate(r['Date Read']) }, stats);
    }
  }
  return stats;
}

/* ---------------- Letterboxd: diary.csv, watched.csv, ratings.csv, watchlist.csv ---------------- */

async function importLetterboxd(rows: Record<string, string>[], file: 'diary' | 'watched' | 'ratings' | 'watchlist'): Promise<ImportResult> {
  const stats: ImportResult = { added: 0, updated: 0, entries: 0, kind: `Letterboxd ${file}` };
  // Letterboxd uses half stars; Pastime uses whole stars, so 3.5 → 4.
  const stars = (s?: string) => (Number(s) ? Math.max(0.5, Math.min(5, Math.round(Number(s) * 2) / 2)) : undefined);
  for (const r of rows) {
    if (!r.Name) continue;
    const year = Number(r.Year) || undefined;
    const media = await upsert(
      {
        type: 'movie',
        title: r.Name,
        year,
        source: 'import',
        sourceId: `letterboxd:${norm(r.Name)}|${year ?? ''}`,
        status: file === 'watchlist' ? 'planned' : 'completed',
      },
      stats,
    );
    const logs = (await db.logs.where('mediaId').equals(media.id).toArray()).filter((l) => l.kind === 'once');
    if (file === 'diary') {
      const date = toDate(r['Watched Date'] || r.Date);
      const undated = logs.find((l) => l.date === null);
      if (logs.some((l) => l.date === date)) {
        // already have this viewing
      } else if (undated) {
        // watched.csv / ratings.csv went first and made an undated entry: give it this date instead of adding a second viewing
        await db.logs.update(undated.id, { date, rating: stars(r.Rating) ?? undated.rating, note: r.Tags || undated.note, updatedAt: Date.now() });
      } else await log({ mediaId: media.id, kind: 'once', date, rating: stars(r.Rating), note: r.Tags || undefined }, stats);
    } else if (file === 'watched' && logs.length === 0) {
      await log({ mediaId: media.id, kind: 'once', date: null }, stats);
    } else if (file === 'ratings' && stars(r.Rating)) {
      const latest = logs.sort((a, b) => b.at - a.at)[0];
      if (latest) await db.logs.update(latest.id, { rating: stars(r.Rating), updatedAt: Date.now() });
      else await log({ mediaId: media.id, kind: 'once', date: null, rating: stars(r.Rating) }, stats);
    }
  }
  return stats;
}

/** Works out which export a CSV is from its columns. */
export async function importCsv(text: string): Promise<ImportResult> {
  const rows = parseCsv(text);
  const cols = new Set(Object.keys(rows[0] ?? {}));
  if (cols.has('Exclusive Shelf') && cols.has('Title')) return importGoodreads(rows);
  if (cols.has('Letterboxd URI') && cols.has('Name')) {
    if (cols.has('Watched Date')) return importLetterboxd(rows, 'diary');
    if (cols.has('Rating')) return importLetterboxd(rows, 'ratings');
    // watched.csv and watchlist.csv share columns; the file name tells them apart (passed via text marker below).
    return importLetterboxd(rows, 'watched');
  }
  throw new Error('This doesn’t look like a Goodreads or Letterboxd export');
}

export async function importLetterboxdWatchlist(text: string) {
  return importLetterboxd(parseCsv(text), 'watchlist');
}

/* ---------------- Fill in missing covers & details (free databases, needs a connection) ---------------- */

export async function fillMissingDetails(onProgress: (done: number, total: number) => void) {
  const todo = (await db.media.toArray()).filter((m) => !m.cover || m.cover.includes('default=false') || !m.overview);
  let fixed = 0;
  for (const [i, m] of todo.entries()) {
    onProgress(i, todo.length);
    const c = getCategory(m.type);
    if (!c.search) continue;
    try {
      const results = await searchCategory(c, m.title);
      const match =
        results.find((r) => norm(r.title) === norm(m.title) && (!m.year || !r.year || Math.abs(r.year - m.year) <= 1)) ??
        results.find((r) => norm(r.title).startsWith(norm(m.title)) && m.year && r.year === m.year);
      if (!match) continue;
      const patch: Partial<Media> = {};
      if ((!m.cover || m.cover.includes('default=false')) && match.cover) patch.cover = match.cover;
      if (!m.overview && match.overview) patch.overview = match.overview;
      if (!m.totalPages && match.totalPages) patch.totalPages = match.totalPages;
      if (!m.creators && match.creators) patch.creators = match.creators;
      if (!m.year && match.year) patch.year = match.year;
      if (Object.keys(patch).length) {
        await db.media.update(m.id, { ...patch, updatedAt: Date.now() });
        fixed++;
      }
    } catch {
      /* skip this one; try the rest */
    }
    await new Promise((r) => setTimeout(r, 250)); // be gentle with the free APIs
  }
  onProgress(todo.length, todo.length);
  return { checked: todo.length, fixed };
}
