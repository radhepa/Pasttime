/**
 * Two "devices" (a desktop and a phone) syncing through a fake Supabase that behaves like the real table:
 * rows scoped to the signed-in user (RLS), server-stamped updated_at, jsonb key reordering.
 * Each device gets its own IndexedDB, localStorage and freshly loaded modules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

/* ---------------- fake server + client ---------------- */

interface Row {
  user_id: string;
  tbl: string;
  id: string;
  data: unknown;
  deleted: boolean;
  updated_at: string;
}

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortKeys(x)])) : v;

class FakeServer {
  rows = new Map<string, Row>();
  clock = Date.parse('2026-10-14T00:00:00Z');
  users: Record<string, { id: string; password: string }> = {
    'me@example.com': { id: 'user-me', password: 'right' },
    'other@example.com': { id: 'user-other', password: 'right' },
  };
  tick() {
    this.clock += 1;
    return new Date(this.clock).toISOString();
  }
  live(user: string, tbl: string) {
    return [...this.rows.values()].filter((r) => r.user_id === user && r.tbl === tbl && !r.deleted);
  }
}

function makeClient(server: FakeServer) {
  let session: { user: { id: string; email: string } } | null = null;
  const signOutCalls: unknown[] = [];
  const client = {
    signOutCalls,
    auth: {
      getSession: async () => ({ data: { session } }),
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const u = server.users[email];
        if (!u || u.password !== password) return { data: { user: null, session: null }, error: new Error('Invalid login credentials') };
        session = { user: { id: u.id, email } };
        return { data: { user: session.user, session }, error: null };
      },
      signOut: async (opts: unknown) => {
        signOutCalls.push(opts);
        session = null;
        return { error: null };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({
      upsert: async (rows: Row[]) => {
        if (!session) return { error: { message: 'JWT missing' } };
        for (const r of rows) {
          // RLS: with check (user_id = auth.uid())
          if (r.user_id !== session.user.id) return { error: { message: 'new row violates row-level security policy' } };
        }
        for (const r of rows) {
          server.rows.set(`${r.user_id}|${r.tbl}|${r.id}`, { ...r, data: sortKeys(JSON.parse(JSON.stringify(r.data))), updated_at: server.tick() });
        }
        return { error: null };
      },
      select: () => {
        const f: { eq: Record<string, unknown>; gt?: string; limit: number } = { eq: {}, limit: Infinity };
        const b = {
          eq: (c: string, v: unknown) => ((f.eq[c] = v), b),
          order: () => b,
          limit: (n: number) => ((f.limit = n), b),
          gt: (_c: string, v: string) => ((f.gt = v), b),
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(() => {
                if (!session) return { data: [], error: null }; // RLS: anon sees nothing
                const data = [...server.rows.values()]
                  .filter((r) => r.user_id === session!.user.id)
                  .filter((r) => Object.entries(f.eq).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
                  .filter((r) => !f.gt || r.updated_at > f.gt)
                  .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1))
                  .slice(0, f.limit)
                  .map(({ tbl, id, data, deleted, updated_at }) => ({ tbl, id, data: JSON.parse(JSON.stringify(data)), deleted, updated_at }));
                return { data, error: null };
              })
              .then(res, rej),
        };
        return b;
      },
    }),
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: async () => undefined,
  };
  return client;
}


/* ---------------- devices ---------------- */

interface Device {
  idb: IDBFactory;
  storage: Record<string, string>;
  client: ReturnType<typeof makeClient>;
}

let server: FakeServer;
let current: Device | null = null;

function newDevice(): Device {
  return { idb: new IDBFactory(), storage: {}, client: makeClient(server) };
}

/** Switches to a device: its own browser storage and a fresh copy of the app's modules. */
async function boot(d: Device) {
  if (current) current.storage = { ...localStorage };
  localStorage.clear();
  for (const [k, v] of Object.entries(d.storage)) localStorage.setItem(k, v);
  Object.assign(globalThis, { indexedDB: d.idb, IDBKeyRange });
  current = d;
  // Dexie itself is loaded once for the whole test run, so point it at this device's IndexedDB.
  const Dexie = (await import('dexie')).default;
  Object.assign(Dexie.dependencies, { indexedDB: d.idb, IDBKeyRange });
  vi.resetModules();
  vi.doMock('../src/lib/supabase', () => ({ supabase: d.client }));
  const { db } = await import('../src/db');
  const sync = await import('../src/lib/sync');
  const settings = await import('../src/lib/settings');
  await db.open();
  return { db, sync, settings };
}

const media = (id: string, title: string, updatedAt = 1000) => ({ id, type: 'book', title, status: 'active' as const, addedAt: 1000, updatedAt });
const log = (id: string, mediaId: string) => ({ id, mediaId, kind: 'progress' as const, date: '2026-10-14', at: 1, pages: 10, updatedAt: 1000 });

beforeEach(() => {
  server = new FakeServer();
  current = null;
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

describe('sync between a desktop and a phone', () => {
  it('merges, syncs edits and deletions both ways, and never sends remote changes back', async () => {
    const desktop = newDevice();
    const phone = newDevice();

    // Desktop: a library that existed before sync.
    let app = await boot(desktop);
    await app.db.media.bulkPut([media('m1', 'Piranesi'), media('m2', 'Dune')]);
    await app.db.logs.put(log('l1', 'm1'));
    await app.db.categories.put({ id: 'book', name: 'Novel' });
    app.settings.setSettings({ palette: 'clay', theme: 'dark' });
    expect(app.sync.useSyncStatus).toBeTypeOf('function');

    await expect(app.sync.signIn('me@example.com', 'wrong')).rejects.toThrow(/Invalid login/);
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();
    expect(server.live('user-me', 'media').map((r) => r.id).sort()).toEqual(['m1', 'm2']);
    expect(server.live('user-me', 'logs')).toHaveLength(1);
    expect(server.live('user-me', 'categories')[0].data).toMatchObject({ name: 'Novel' });
    expect(server.live('user-me', 'settings')[0].data).toMatchObject({ palette: 'clay', theme: 'dark' });

    // Phone: brand new, default settings. Signing in must not overwrite the desktop's settings.
    app = await boot(phone);
    expect(app.settings.getSettings().palette).toBe('mist');
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();
    expect((await app.db.media.toArray()).map((m) => m.title).sort()).toEqual(['Dune', 'Piranesi']);
    expect(await app.db.logs.count()).toBe(1);
    expect((await app.db.categories.get('book'))?.name).toBe('Novel');
    expect(app.settings.getSettings().palette).toBe('clay');
    expect(server.live('user-me', 'settings')[0].data).toMatchObject({ palette: 'clay' });

    // Pulling wrote to the phone's database, but nothing should be queued to go back up.
    const writesBefore = server.clock;
    await app.sync.syncNow();
    expect(server.clock).toBe(writesBefore);

    // Phone: add a book, finish reading entry deleted, rename a title, change theme.
    await app.db.media.put(media('m3', 'Circe'));
    await app.db.logs.delete('l1');
    await app.db.media.update('m2', { title: 'Dune Messiah', updatedAt: 2000 });
    app.settings.setSettings({ palette: 'lilac' });
    await app.sync.syncNow();
    expect(server.live('user-me', 'logs')).toHaveLength(0);
    expect([...server.rows.values()].find((r) => r.id === 'l1')?.deleted).toBe(true);

    // Desktop picks all of that up.
    app = await boot(desktop);
    await app.sync.syncNow();
    expect((await app.db.media.toArray()).map((m) => m.title).sort()).toEqual(['Circe', 'Dune Messiah', 'Piranesi']);
    expect(await app.db.logs.count()).toBe(0);
    expect(app.settings.getSettings().palette).toBe('lilac');
    const quiet = server.clock;
    await app.sync.syncNow();
    expect(server.clock).toBe(quiet);
  });

  it('a change made here that has not been sent yet wins over the cloud copy', async () => {
    const desktop = newDevice();
    const phone = newDevice();
    let app = await boot(desktop);
    await app.db.media.put(media('m1', 'Original'));
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();

    app = await boot(phone);
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();
    await app.db.media.update('m1', { title: 'From phone', updatedAt: 2000 });
    await app.sync.syncNow();

    // Desktop edited offline before hearing about the phone's change.
    app = await boot(desktop);
    await app.db.media.update('m1', { title: 'From desktop', updatedAt: 3000 });
    await app.sync.syncNow();
    expect((await app.db.media.get('m1'))?.title).toBe('From desktop');
    expect(server.live('user-me', 'media')[0].data).toMatchObject({ title: 'From desktop' });
  });

  it('keeps accounts apart and signs out only this device', async () => {
    const mine = newDevice();
    const theirs = newDevice();
    let app = await boot(mine);
    await app.db.media.put(media('m1', 'Private'));
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();

    app = await boot(theirs);
    expect(await app.sync.signIn('other@example.com', 'right')).toEqual({ ok: true });
    await app.sync.syncNow();
    expect(await app.db.media.count()).toBe(0);

    app = await boot(mine);
    await app.sync.signOut();
    expect(mine.client.signOutCalls).toEqual([{ scope: 'local' }]);
    expect(await app.db.media.count()).toBe(1); // what's on the device stays
  });

  it('a deletion made while signed out reaches the account after signing back in', async () => {
    const desktop = newDevice();
    let app = await boot(desktop);
    await app.db.media.bulkPut([media('m1', 'Keep'), media('m2', 'Delete me')]);
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();
    await app.sync.signOut();

    await app.db.media.delete('m2');
    const quiet = server.clock;
    await app.sync.syncNow(); // signed out: nothing is sent
    expect(server.clock).toBe(quiet);

    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();
    expect(server.live('user-me', 'media').map((r) => r.id)).toEqual(['m1']);
    expect(await app.db.media.count()).toBe(1);
  });

  it("asks before mixing another account's library into this one", async () => {
    const shared = newDevice();
    let app = await boot(shared);
    await app.db.media.put(media('m1', 'Mine'));
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();
    await app.sync.signOut();

    // Someone else signs in on the same device.
    const result = await app.sync.signIn('other@example.com', 'right');
    expect(result).toEqual({ ok: false, libraryOf: 'me@example.com' });
    await app.sync.syncNow();
    expect(server.live('user-other', 'media')).toHaveLength(0); // nothing merged yet

    await app.sync.finishAccountSwitch('replace');
    await app.sync.syncNow();
    expect(await app.db.media.count()).toBe(0); // device cleared...
    expect(server.live('user-me', 'media')).toHaveLength(1); // ...but nothing deleted from the first account
    expect(server.live('user-other', 'media')).toHaveLength(0);
  });

  it('folds a title both devices added before syncing into one', async () => {
    const desktop = newDevice();
    const phone = newDevice();
    const show = (id: string) => ({ ...media(id, 'Severance'), type: 'show', source: 'tvmaze', sourceId: '44933' });

    let app = await boot(desktop);
    await app.db.media.put(show('desk-show'));
    await app.db.episodes.put({ id: 'desk-e1', mediaId: 'desk-show', season: 1, number: 1 });
    await app.db.logs.put({ ...log('desk-l1', 'desk-show'), kind: 'episode', episodeId: 'desk-e1', season: 1, number: 1 });
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();

    app = await boot(phone);
    await app.db.media.put(show('phone-show'));
    await app.db.episodes.bulkPut([
      { id: 'phone-e1', mediaId: 'phone-show', season: 1, number: 1 },
      { id: 'phone-e2', mediaId: 'phone-show', season: 1, number: 2 },
    ]);
    await app.db.logs.bulkPut([
      { ...log('phone-l1', 'phone-show'), kind: 'episode', episodeId: 'phone-e1', season: 1, number: 1 }, // same viewing as the desktop's
      { ...log('phone-l2', 'phone-show'), kind: 'episode', episodeId: 'phone-e2', season: 1, number: 2, date: '2026-10-15' },
    ]);
    await app.db.lists.put({ id: 'L1', name: 'Faves', items: ['phone-show'], createdAt: 1, updatedAt: 1 });
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();

    expect((await app.db.media.toArray()).map((m) => m.id)).toEqual(['desk-show']);
    const logs = await app.db.logs.toArray();
    expect(logs.map((l) => l.episodeId).sort()).toEqual(['desk-e1', 'phone-e2']); // E1 once, E2 moved over
    expect(logs.every((l) => l.mediaId === 'desk-show')).toBe(true);
    expect((await app.db.lists.get('L1'))?.items).toEqual(['desk-show']);
    expect(server.live('user-me', 'media')).toHaveLength(1);
    expect(server.live('user-me', 'logs')).toHaveLength(2);
  });

  it('does not re-upload records that did not change', async () => {
    const desktop = newDevice();
    const app = await boot(desktop);
    await app.db.media.put(media('m1', 'Same'));
    await app.sync.signIn('me@example.com', 'right');
    await app.sync.syncNow();
    const quiet = server.clock;
    await app.db.media.put(media('m1', 'Same')); // identical
    await app.sync.syncNow();
    expect(server.clock).toBe(quiet);
  });
});
