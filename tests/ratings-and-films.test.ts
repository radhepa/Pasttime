/**
 * Half stars / 10 stars, and films inside episode categories (anime movies) behaving like movies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

async function fresh() {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  vi.resetModules();
  localStorage.clear();
  const Dexie = (await import('dexie')).default;
  Dexie.dependencies.indexedDB = new IDBFactory();
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  return {
    db: await import('../src/db'),
    ratings: await import('../src/lib/ratings'),
    settings: await import('../src/lib/settings'),
    oneShots: await import('../src/lib/oneShots'),
  };
}

const media = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'anime',
  title: id,
  status: 'planned' as const,
  addedAt: 1,
  updatedAt: 1,
  ...extra,
});

describe('ratings', () => {
  beforeEach(() => localStorage.clear());

  it('shows the same stored rating on either scale', async () => {
    const { ratings, settings } = await fresh();
    expect(ratings.fmtRating(4.5, 'five')).toBe('4.5');
    expect(ratings.fmtRating(4.5, 'ten')).toBe('9');
    expect(ratings.fmtRating(4.3, 'ten')).toBe('8.6');
    expect(ratings.fmtRating(4, 'five')).toBe('4.0');
    settings.setSettings({ ratingScale: 'ten' });
    expect(ratings.fmtRating(0.5)).toBe('1');
    expect(ratings.ratingWords(3.5)).toBe('7 out of 10 stars');
  });

  it('snaps anything onto half steps between ½ and 5', async () => {
    const { ratings } = await fresh();
    expect([0, 0.2, 0.74, 3.3, 3.76, 9].map(ratings.snapRating)).toEqual([0.5, 0.5, 0.5, 3.5, 4, 5]);
  });
});

describe('films in episode categories', () => {
  it('turns a one-episode finished anime into a one-time title, keeping when and how you watched it', async () => {
    const { db: m, oneShots } = await fresh();
    const { db } = m;
    await db.media.bulkPut([
      media('movie', { source: 'anilist', sourceId: '1', airStatus: 'FINISHED' }),
      media('series', { source: 'anilist', sourceId: '2', airStatus: 'FINISHED' }),
      media('airing', { source: 'anilist', sourceId: '3', airStatus: 'RELEASING' }),
    ]);
    await db.episodes.bulkPut([
      { id: 'm1', mediaId: 'movie', season: 1, number: 1 },
      { id: 's1', mediaId: 'series', season: 1, number: 1 },
      { id: 's2', mediaId: 'series', season: 1, number: 2 },
      { id: 'a1', mediaId: 'airing', season: 1, number: 1 },
    ]);
    await db.logs.put({ id: 'L', mediaId: 'movie', kind: 'episode', date: '2026-10-01', at: 5, episodeId: 'm1', season: 1, number: 1, rating: 4.5, updatedAt: 5 });

    await oneShots.convertSingleEpisodeTitles();

    expect((await db.media.get('movie'))?.oneShot).toBe(true);
    expect((await db.media.get('movie'))?.status).toBe('completed');
    expect((await db.media.get('series'))?.oneShot).toBeUndefined();
    expect((await db.media.get('airing'))?.oneShot).toBeUndefined(); // one episode so far, more coming
    const log = await db.logs.get('L');
    expect(log).toMatchObject({ kind: 'once', date: '2026-10-01', rating: 4.5 });
    expect(log?.episodeId).toBeUndefined();

    // ...and back to a series: the viewing becomes episode 1 again.
    await m.setOneShot('movie', false);
    expect(await db.logs.get('L')).toMatchObject({ kind: 'episode', episodeId: 'm1', season: 1, number: 1, rating: 4.5 });
  });

  it('only sweeps once per device', async () => {
    const { db: m, oneShots } = await fresh();
    await oneShots.convertSingleEpisodeTitles();
    await m.db.media.put(media('late', { source: 'anilist', sourceId: '9', airStatus: 'FINISHED' }));
    await m.db.episodes.put({ id: 'e', mediaId: 'late', season: 1, number: 1 });
    await oneShots.convertSingleEpisodeTitles();
    expect((await m.db.media.get('late'))?.oneShot).toBeUndefined();
  });

  it('adds an anime movie from search as one-time, without an episode list', async () => {
    const { db: m } = await fresh();
    const id = await m.addFromResult({ type: 'anime', source: 'anilist', sourceId: '21519', title: 'Your Name.', oneShot: true, runtime: 107 });
    expect(await m.db.media.get(id)).toMatchObject({ oneShot: true, runtime: 107 });
    expect(await m.db.episodes.where('mediaId').equals(id).count()).toBe(0);
  });
});

describe('onboarding: things you already finished', () => {
  it('adds them as done with undated entries, so they stay off the timeline', async () => {
    const { db: m } = await fresh();
    const { addAsSeen } = await import('../src/lib/onboarding');
    const film = await addAsSeen({ type: 'anime', source: 'anilist', sourceId: '199', title: 'Spirited Away', oneShot: true });
    const book = await addAsSeen({ type: 'book', source: 'openlibrary', sourceId: '/works/OL1W', title: 'Dune', totalPages: 600 });
    const again = await addAsSeen({ type: 'book', source: 'openlibrary', sourceId: '/works/OL1W', title: 'Dune' });
    expect(again).toBe(book); // picked twice: still one title, one entry
    for (const id of [film, book]) expect((await m.db.media.get(id))?.status).toBe('completed');
    const logs = await m.db.logs.toArray();
    expect(logs.map((l) => [l.kind, l.date]).sort()).toEqual([
      ['finish', null],
      ['once', null],
    ]);
  });
});
