/**
 * Smart search across free public databases. Everything here works straight from the
 * browser with no account and no cost:
 *   TVmaze (shows + episodes) · Open Library (books) · Wikipedia (movies, games, theater, comics…)
 *   AniList (anime, manga, light novels) · Apple (podcasts, audiobooks) · MusicBrainz (albums)
 * Optional free keys in Settings swap in TMDB for movies and RAWG for games.
 */
import type { Episode, SearchResult } from '../types';
import type { Category } from './categories';
import { getSettings } from './settings';

const stripHtml = (s?: string | null) =>
  s
    ? s
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim()
    : undefined;

const yearOf = (s?: string | null) => {
  const m = s?.match(/\b(18|19|20)\d{2}\b/);
  return m ? Number(m[0]) : undefined;
};

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/* ---------------- Shows: TVmaze ---------------- */

interface TvmazeShow {
  id: number;
  name: string;
  premiered?: string;
  status?: string;
  genres?: string[];
  summary?: string;
  image?: { medium?: string; original?: string } | null;
  network?: { name: string } | null;
  webChannel?: { name: string } | null;
}

async function searchShows(q: string, type: string): Promise<SearchResult[]> {
  const rows = await getJson<{ show: TvmazeShow }[]>(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  return rows.map(({ show }) => {
    const channel = show.network?.name ?? show.webChannel?.name;
    return {
      type,
      source: 'tvmaze',
      sourceId: String(show.id),
      title: show.name,
      year: yearOf(show.premiered),
      cover: show.image?.original ?? show.image?.medium,
      overview: stripHtml(show.summary),
      genres: show.genres,
      creators: channel ? [channel] : undefined,
      airStatus: show.status,
      subtitle: [yearOf(show.premiered), channel, show.status === 'Running' ? 'Airing' : undefined].filter(Boolean).join(' · '),
    };
  });
}

export async function fetchEpisodes(showId: string): Promise<Omit<Episode, 'id' | 'mediaId'>[]> {
  const rows = await getJson<
    { season: number; number: number | null; name: string; airdate?: string; runtime?: number; summary?: string }[]
  >(`https://api.tvmaze.com/shows/${showId}/episodes`);
  return rows
    .filter((e) => e.number != null)
    .map((e) => ({
      season: e.season,
      number: e.number!,
      title: e.name,
      airdate: e.airdate || undefined,
      runtime: e.runtime,
      overview: stripHtml(e.summary),
    }));
}

/* ---------------- Books: Open Library ---------------- */

interface OLDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  number_of_pages_median?: number;
  subject?: string[];
}

async function searchBooks(q: string, type: string): Promise<SearchResult[]> {
  const fields = 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject';
  const data = await getJson<{ docs: OLDoc[] }>(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=${fields}&limit=15`);
  return data.docs.map((d) => ({
    type,
    source: 'openlibrary',
    sourceId: d.key,
    title: d.title,
    year: d.first_publish_year,
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    creators: d.author_name?.slice(0, 3),
    genres: d.subject?.slice(0, 4),
    totalPages: d.number_of_pages_median,
    subtitle: [d.author_name?.[0], d.first_publish_year, d.number_of_pages_median && `${d.number_of_pages_median} pages`].filter(Boolean).join(' · '),
  }));
}

/**
 * Descriptions arrive with Markdown from some sources (Open Library: **bold**, [links](…), "----------"
 * source notes). Show them as plain readable text.
 */
export function plainText(s?: string) {
  if (!s) return s;
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/\[([^\]]+)\]\[\d+\]/g, '$1') // [text][1] -> text
    .replace(/^\s*\[\d+\]:\s*\S+.*$/gm, '') // [1]: https://... reference lines
    .replace(/^\s*-{3,}\s*$[\s\S]*/m, '') // "----------" and the source notes after it
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Pulls a book's description from Open Library (search results don't include it). */
export async function fetchBookDescription(workKey: string) {
  const w = await getJson<{ description?: string | { value: string } }>(`https://openlibrary.org${workKey}.json`);
  return plainText(typeof w.description === 'string' ? w.description : w.description?.value);
}

/* ---------------- Wikipedia (movies, games, theater, comics, museums…) ---------------- */

interface WikiPage {
  pageid: number;
  title: string;
  index: number;
  description?: string;
  extract?: string;
  thumbnail?: { source: string };
}

async function wikiQuery(search: string, type: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'search',
    gsrsearch: search,
    gsrlimit: '12',
    prop: 'pageimages|description|extracts',
    piprop: 'thumbnail',
    pithumbsize: '400',
    pilicense: 'any',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    exlimit: '12',
  });
  const data = await getJson<{ query?: { pages: WikiPage[] } }>(`https://en.wikipedia.org/w/api.php?${params}`);
  const pages = (data.query?.pages ?? []).sort((a, b) => a.index - b.index);
  return pages.map((p) => {
    const year = yearOf(p.title) ?? yearOf(p.description) ?? yearOf(p.extract);
    const by = p.description?.match(/\bby (.+)$/)?.[1];
    return {
      type,
      source: 'wikipedia',
      sourceId: String(p.pageid),
      // "Dune (2021 film)" → "Dune", "Hamilton (musical)" → "Hamilton"
      title: p.title.replace(/\s*\([^)]*\)$/, ''),
      year,
      cover: p.thumbnail?.source.split('?')[0],
      overview: p.extract,
      creators: by ? [by] : undefined,
      subtitle: p.description ? p.description.charAt(0).toUpperCase() + p.description.slice(1) : year ? String(year) : undefined,
    };
  });
}

/** One request per infobox template (e.g. musicals + plays), merged in rank order. */
async function searchWikipedia(q: string, type: string, templates: string[] = [], extra?: string) {
  const query = extra ? `${q} ${extra}` : q;
  if (!templates.length) return wikiQuery(query, type);
  const lists = await Promise.all(templates.map((t) => wikiQuery(`${query} hastemplate:"${t}"`, type).catch(() => [] as SearchResult[])));
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++)
    for (const l of lists)
      if (l[i] && !seen.has(l[i].sourceId)) {
        seen.add(l[i].sourceId);
        out.push(l[i]);
      }
  return out;
}

/* ---------------- Anime, manga, light novels: AniList ---------------- */

interface AniMedia {
  id: number;
  title: { romaji?: string; english?: string };
  episodes?: number | null;
  nextAiringEpisode?: { episode: number } | null;
  chapters?: number | null;
  volumes?: number | null;
  startDate?: { year?: number };
  coverImage?: { large?: string };
  format?: string;
  status?: string;
  genres?: string[];
  description?: string;
  studios?: { nodes: { name: string }[] };
  staff?: { nodes: { name: { full: string } }[] };
}

async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await getJson<{ data: T }>('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.data;
}

async function searchAnilist(q: string, type: string, kind: 'ANIME' | 'MANGA', format?: 'NOVEL') {
  const vars: Record<string, unknown> = { s: q, t: kind };
  if (format) vars.f = format;
  else if (kind === 'MANGA') vars.nf = 'NOVEL'; // manga search shouldn't drown in light novels
  const data = await anilist<{ Page: { media: AniMedia[] } }>(
    `query($s:String,$t:MediaType,$f:MediaFormat,$nf:MediaFormat){Page(perPage:15){media(search:$s,type:$t,format:$f,format_not:$nf,isAdult:false){
      id title{romaji english} episodes nextAiringEpisode{episode} chapters volumes startDate{year} coverImage{large} format status genres description(asHtml:false)
      studios(isMain:true){nodes{name}} staff(perPage:2){nodes{name{full}}}}}}`,
    vars,
  );
  return data.Page.media.map((m): SearchResult => {
    const title = m.title.english || m.title.romaji || 'Untitled';
    const units = format === 'NOVEL' ? m.volumes : m.chapters;
    const creators = kind === 'ANIME' ? m.studios?.nodes.map((s) => s.name) : m.staff?.nodes.map((s) => s.name.full);
    return {
      type,
      source: 'anilist',
      sourceId: String(m.id),
      title,
      year: m.startDate?.year,
      cover: m.coverImage?.large,
      overview: stripHtml(m.description),
      genres: m.genres?.slice(0, 4),
      creators: creators?.length ? creators : undefined,
      airStatus: m.status,
      // Airing shows only get the episodes that are out so far (AniList's total includes future ones).
      episodeCount: kind === 'ANIME' ? airedAnimeEpisodes(m) || undefined : undefined,
      totalPages: kind === 'MANGA' ? (units ?? undefined) : undefined,
      subtitle: [
        m.startDate?.year,
        m.format?.replace('_', ' '),
        kind === 'ANIME' && m.episodes ? `${m.episodes} episodes` : undefined,
        kind === 'MANGA' && units ? `${units} ${format === 'NOVEL' ? 'volumes' : 'chapters'}` : undefined,
        m.title.english && m.title.romaji && m.title.english !== m.title.romaji ? m.title.romaji : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  });
}

/** Episodes out so far: up to the next one due to air, or the full count once it's finished. */
const airedAnimeEpisodes = (m: { episodes?: number | null; nextAiringEpisode?: { episode: number } | null }) =>
  m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : (m.episodes ?? 0);

/** Latest aired-episode count and status for an anime (picks up new episodes of airing shows). */
export async function fetchAnilistEpisodeCount(id: string) {
  const data = await anilist<{ Media: { episodes?: number; status?: string; nextAiringEpisode?: { episode: number } } }>(
    'query($id:Int){Media(id:$id){episodes status nextAiringEpisode{episode}}}',
    { id: Number(id) },
  );
  return { count: airedAnimeEpisodes(data.Media), status: data.Media.status };
}

/** A TV show's current status ("Running", "Ended"…), so finished shows can complete. */
export async function fetchShowStatus(showId: string) {
  return (await getJson<{ status?: string }>(`https://api.tvmaze.com/shows/${showId}`)).status;
}

/* ---------------- Podcasts & audiobooks: Apple ---------------- */

async function searchItunes(q: string, type: string, media: 'podcast' | 'audiobook') {
  const data = await getJson<{
    results: {
      collectionId: number;
      collectionName: string;
      artistName?: string;
      artworkUrl600?: string;
      artworkUrl100?: string;
      releaseDate?: string;
      primaryGenreName?: string;
      description?: string;
    }[];
  }>(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=${media}&limit=15`);
  return data.results.map(
    (r): SearchResult => ({
      type,
      source: 'itunes',
      sourceId: String(r.collectionId),
      title: r.collectionName.replace(/\s*\((Unabridged|Abridged)\)$/i, ''),
      year: yearOf(r.releaseDate),
      cover: r.artworkUrl600 ?? r.artworkUrl100?.replace('100x100', '600x600'),
      overview: stripHtml(r.description),
      creators: r.artistName ? [r.artistName] : undefined,
      genres: r.primaryGenreName ? [r.primaryGenreName] : undefined,
      subtitle: [r.artistName, media === 'audiobook' ? yearOf(r.releaseDate) : r.primaryGenreName].filter(Boolean).join(' · '),
    }),
  );
}

/* ---------------- Albums: MusicBrainz + Cover Art Archive ---------------- */

/** MusicBrainz search is Lucene syntax: "AC/DC" or "Help!" must be escaped or the request fails. */
const luceneEscape = (q: string) => q.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, (c) => `\\${c}`);

async function searchMusicBrainz(q: string, type: string) {
  const data = await getJson<{
    'release-groups': { id: string; title: string; 'first-release-date'?: string; 'primary-type'?: string; 'artist-credit'?: { name: string }[] }[];
  }>(`https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(`(${luceneEscape(q)}) AND (primarytype:album OR primarytype:ep)`)}&fmt=json&limit=15`);
  return data['release-groups'].map((r): SearchResult => {
    const artist = r['artist-credit']?.map((a) => a.name).join(', ');
    return {
      type,
      source: 'musicbrainz',
      sourceId: r.id,
      title: r.title,
      year: yearOf(r['first-release-date']),
      cover: `https://coverartarchive.org/release-group/${r.id}/front-500`,
      creators: artist ? [artist] : undefined,
      subtitle: [artist, yearOf(r['first-release-date']), r['primary-type']].filter(Boolean).join(' · '),
    };
  });
}

/* ---------------- Optional keyed providers ---------------- */

async function searchTmdb(q: string, key: string, type: string): Promise<SearchResult[]> {
  // Accept either a v3 API key or a v4 "read access token".
  const bearer = key.length > 40;
  const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(q)}${bearer ? '' : `&api_key=${key}`}`;
  const data = await getJson<{
    results: { id: number; title: string; release_date?: string; poster_path?: string; overview?: string }[];
  }>(url, bearer ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
  return data.results.map((m) => ({
    type,
    source: 'tmdb',
    sourceId: String(m.id),
    title: m.title,
    year: yearOf(m.release_date),
    cover: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : undefined,
    overview: m.overview || undefined,
    subtitle: yearOf(m.release_date) ? String(yearOf(m.release_date)) : undefined,
  }));
}

async function searchRawg(q: string, key: string, type: string): Promise<SearchResult[]> {
  const data = await getJson<{
    results: {
      id: number;
      name: string;
      released?: string;
      background_image?: string;
      platforms?: { platform: { name: string } }[];
      genres?: { name: string }[];
    }[];
  }>(`https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(q)}&page_size=15`);
  return data.results.map((g) => {
    const platforms = g.platforms?.map((p) => p.platform.name);
    return {
      type,
      source: 'rawg',
      sourceId: String(g.id),
      title: g.name,
      year: yearOf(g.released),
      cover: g.background_image,
      platforms,
      genres: g.genres?.map((x) => x.name),
      subtitle: [yearOf(g.released), platforms?.slice(0, 3).join(', ')].filter(Boolean).join(' · '),
    };
  });
}

/* ---------------- Entry points ---------------- */

export function searchCategory(c: Category, q: string): Promise<SearchResult[]> {
  const { tmdbKey, rawgKey } = getSettings();
  if (c.id === 'movie' && tmdbKey) return searchTmdb(q, tmdbKey, c.id);
  if (c.id === 'game' && rawgKey) return searchRawg(q, rawgKey, c.id);
  const s = c.search;
  switch (s?.provider) {
    case 'tvmaze':
      return searchShows(q, c.id);
    case 'openlibrary':
      return searchBooks(q, c.id);
    case 'wikipedia':
      return searchWikipedia(q, c.id, s.templates, s.extra);
    case 'anilist':
      return searchAnilist(q, c.id, s.type, s.format);
    case 'itunes':
      return searchItunes(q, c.id, s.media);
    case 'musicbrainz':
      return searchMusicBrainz(q, c.id);
    default:
      return Promise.resolve([]);
  }
}

export const SOURCE_LABEL: Record<string, string> = {
  tvmaze: 'TVmaze',
  openlibrary: 'Open Library',
  wikipedia: 'Wikipedia',
  tmdb: 'TMDB',
  rawg: 'RAWG',
  anilist: 'AniList',
  itunes: 'Apple',
  musicbrainz: 'MusicBrainz',
  manual: 'Added by you',
  import: 'Imported',
};

/** Search sources a category you create can use. */
export const CUSTOM_SOURCES: { key: string; label: string; source?: Category['search'] }[] = [
  { key: 'none', label: 'None: I’ll add things myself' },
  { key: 'wikipedia', label: 'Wikipedia (any article)', source: { provider: 'wikipedia' } },
  { key: 'tvmaze', label: 'TV shows (TVmaze)', source: { provider: 'tvmaze' } },
  { key: 'openlibrary', label: 'Books (Open Library)', source: { provider: 'openlibrary' } },
  { key: 'anime', label: 'Anime (AniList)', source: { provider: 'anilist', type: 'ANIME' } },
  { key: 'manga', label: 'Manga (AniList)', source: { provider: 'anilist', type: 'MANGA' } },
  { key: 'podcast', label: 'Podcasts (Apple)', source: { provider: 'itunes', media: 'podcast' } },
  { key: 'audiobook', label: 'Audiobooks (Apple)', source: { provider: 'itunes', media: 'audiobook' } },
  { key: 'music', label: 'Albums (MusicBrainz)', source: { provider: 'musicbrainz' } },
];
