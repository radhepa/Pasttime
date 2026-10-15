/**
 * Cloud sync between your devices.
 *
 * The app still reads and writes only the local database (so it works offline); this file mirrors it
 * to one private Supabase table, `pastime_rows`: one row per local record, readable only by you.
 *  - Every local change is noted (Dexie hooks) and pushed a moment later.
 *  - Changes from your other devices arrive live (Realtime) and whenever the app comes back into view.
 *  - A record you changed here and haven't pushed yet always beats the copy coming down.
 * Deletions travel as "deleted" markers so they reach the other devices too.
 */
import { useSyncExternalStore } from 'react';
import type { Transaction } from 'dexie';
import type { RealtimeChannel, User } from '@supabase/supabase-js';
import { db } from '../db';
import type { Media } from '../types';
import { supabase } from './supabase';
import { getSettings, onLocalSettingsChange, setSettings, type Settings } from './settings';

const TABLES = ['media', 'episodes', 'logs', 'lists', 'categories'] as const;
type DataTable = (typeof TABLES)[number];
type Tbl = DataTable | 'settings';
const SETTINGS_ID = 'settings';

const LINK_KEY = 'pastime.sync.account';
const DIRTY_KEY = 'pastime.sync.pending';
const CURSOR_KEY = 'pastime.sync.cursor';
/** Marks a local write that came from another device, so it isn't sent straight back. */
const FROM_SYNC = '__pastimeFromSync';
const PAGE = 1000;

type Op = 'put' | 'del';
/**
 * The account this device's library belongs to. `ready` once the first merge with the cloud copy finished.
 * `signedOut`: you signed out here; changes (including deletions) are still noted, and go up when you sign back in.
 */
interface Link {
  id: string;
  email?: string;
  ready: boolean;
  signedOut?: boolean;
}

function readJSON<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
function writeJSON(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: sync state just won't survive a reload */
  }
}

let link: Link | null = readJSON<Link>(LINK_KEY);
let version = 0;
/** "table/id" → what happened to it here since the last push. */
const dirty = new Map<string, { op: Op; v: number }>(
  Object.entries(readJSON<Record<string, Op>>(DIRTY_KEY) ?? {}).map(([k, op]) => [k, { op, v: 0 }]),
);

const keyOf = (tbl: Tbl, id: string) => `${tbl}/${id}`;
const splitKey = (key: string) => {
  const i = key.indexOf('/');
  return [key.slice(0, i) as Tbl, key.slice(i + 1)] as const;
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveDirty() {
  clearTimeout(saveTimer);
  writeJSON(DIRTY_KEY, dirty.size ? Object.fromEntries([...dirty].map(([k, e]) => [k, e.op])) : null);
}

/* ---------------- Status (for the Settings card) ---------------- */

export type SyncState = 'off' | 'syncing' | 'synced' | 'offline' | 'signed-out' | 'error';
export interface SyncStatus {
  state: SyncState;
  email?: string;
  lastSyncAt?: number;
  error?: string;
  pending: number;
}

const active = () => !!link && !link.signedOut;

let status: SyncStatus = { state: active() ? 'syncing' : 'off', email: link?.email, pending: dirty.size };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch, email: link?.email, pending: dirty.size };
  listeners.forEach((l) => l());
}

export function useSyncStatus() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}

/* ---------------- Noticing local changes ---------------- */

function mark(tbl: Tbl, id: string, op: Op) {
  if (!link) return;
  dirty.set(keyOf(tbl, id), { op, v: ++version });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDirty, 300);
  setStatus({});
  scheduleSync(1200);
}

const fromSync = (tx: Transaction | undefined) => Boolean(tx && (tx as unknown as Record<string, unknown>)[FROM_SYNC]);

for (const t of TABLES) {
  const table = db.table(t);
  table.hook('creating', (key, obj, tx) => {
    if (!fromSync(tx)) mark(t, String(key ?? (obj as { id: string }).id), 'put');
  });
  table.hook('updating', (mods, key, _obj, tx) => {
    // Dexie calls this for every put, even when nothing changed (e.g. refreshing a show's episodes).
    if (!fromSync(tx) && Object.keys(mods as object).length) mark(t, String(key), 'put');
  });
  table.hook('deleting', (key, _obj, tx) => {
    if (!fromSync(tx)) mark(t, String(key), 'del');
  });
}
onLocalSettingsChange(() => mark('settings', SETTINGS_ID, 'put'));

/** Settings that follow you between devices (the backup reminder is per device). */
function syncedSettings(): Partial<Settings> {
  const { lastBackupAt: _, ...rest } = getSettings();
  return rest;
}

/** JSON with sorted keys, so a record that went through the database compares equal to the local copy. */
const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );

/* ---------------- Push: local → cloud ---------------- */

async function push() {
  while (link && dirty.size) {
    const batch = [...dirty].slice(0, 500);
    const byTable = new Map<Tbl, string[]>();
    for (const [key] of batch) {
      const [tbl, id] = splitKey(key);
      byTable.set(tbl, [...(byTable.get(tbl) ?? []), id]);
    }
    const local = new Map<string, unknown>();
    for (const [tbl, ids] of byTable) {
      if (tbl === 'settings') local.set(keyOf(tbl, SETTINGS_ID), syncedSettings());
      else if ((TABLES as readonly string[]).includes(tbl)) {
        const rows = await db.table(tbl).bulkGet(ids);
        ids.forEach((id, i) => rows[i] && local.set(keyOf(tbl, id), rows[i]));
      }
    }
    const rows = [];
    for (const [key, { op }] of batch) {
      const [tbl, id] = splitKey(key);
      const data = local.get(key);
      // A write that never landed (rolled back) leaves nothing here: skip it rather than delete anything.
      if (data) rows.push({ user_id: link.id, tbl, id, data, deleted: false });
      else if (op === 'del') rows.push({ user_id: link.id, tbl, id, data: null, deleted: true });
    }
    if (rows.length) {
      const { error } = await supabase.from('pastime_rows').upsert(rows, { onConflict: 'user_id,tbl,id' });
      if (error) throw error;
    }
    for (const [key, e] of batch) if (dirty.get(key)?.v === e.v) dirty.delete(key);
    saveDirty();
    setStatus({});
  }
}

/* ---------------- Pull: cloud → local ---------------- */

interface RemoteRow {
  tbl: Tbl;
  id: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  updated_at: string;
}

/**
 * Applies rows from the cloud. On the first merge, a local record with a newer `updatedAt` is kept
 * (and returned so it gets pushed); otherwise the cloud copy wins.
 */
async function apply(rows: RemoteRow[], firstMerge: boolean): Promise<string[]> {
  const keptLocal: string[] = [];
  const puts = new Map<DataTable, Record<string, unknown>[]>();
  const dels = new Map<DataTable, string[]>();
  let remoteSettings: Partial<Settings> | null = null;

  for (const r of rows) {
    if (dirty.has(keyOf(r.tbl, r.id))) continue; // your unsent change here is newer
    if (r.tbl === 'settings') {
      if (!r.deleted && r.data) remoteSettings = r.data as Partial<Settings>;
      continue;
    }
    if (!(TABLES as readonly string[]).includes(r.tbl)) continue;
    const t = r.tbl as DataTable;
    if (r.deleted || !r.data) dels.set(t, [...(dels.get(t) ?? []), r.id]);
    else puts.set(t, [...(puts.get(t) ?? []), r.data]);
  }

  const tables = TABLES.filter((t) => puts.has(t) || dels.has(t)).map((t) => db.table(t));
  if (tables.length) {
    await db.transaction('rw', tables, async (tx) => {
      (tx as unknown as Record<string, unknown>)[FROM_SYNC] = true;
      for (const t of TABLES) {
        const incoming = puts.get(t) ?? [];
        if (incoming.length) {
          const current = await db.table(t).bulkGet(incoming.map((d) => d.id as string));
          const changed = incoming.filter((d, i) => {
            const mine = current[i] as Record<string, unknown> | undefined;
            if (!mine) return true;
            if (stable(mine) === stable(d)) return false;
            if (firstMerge && typeof mine.updatedAt === 'number' && typeof d.updatedAt === 'number' && mine.updatedAt > d.updatedAt) {
              keptLocal.push(keyOf(t, d.id as string));
              return false;
            }
            return true;
          });
          if (changed.length) await db.table(t).bulkPut(changed);
        }
        const gone = dels.get(t) ?? [];
        if (gone.length) await db.table(t).bulkDelete(gone);
      }
    });
  }

  if (remoteSettings) {
    const mine = syncedSettings();
    if (stable(mine) !== stable({ ...mine, ...remoteSettings })) setSettings(remoteSettings, true);
  }
  return keptLocal;
}

async function pull(firstMerge: boolean) {
  if (!link) return;
  let since = firstMerge ? null : readJSON<string>(CURSOR_KEY);
  const seen = new Set<string>();
  const keptLocal: string[] = [];
  for (;;) {
    let q = supabase.from('pastime_rows').select('tbl,id,data,deleted,updated_at').eq('user_id', link.id).order('updated_at').limit(PAGE);
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as RemoteRow[];
    keptLocal.push(...(await apply(rows, firstMerge)));
    rows.forEach((r) => seen.add(keyOf(r.tbl, r.id)));
    if (rows.length) since = rows[rows.length - 1].updated_at;
    if (rows.length < PAGE) break;
  }
  // Re-read the last half minute next time, in case a slow write from another device landed out of order.
  if (since) writeJSON(CURSOR_KEY, new Date(Date.parse(since) - 30_000).toISOString());

  if (firstMerge) {
    await foldDuplicateTitles(seen);
    // Everything only this device has (or has newer) goes up.
    for (const t of TABLES) {
      const keys = ((await db.table(t).toArray()) as { id: string }[]).map((r) => r.id);
      for (const id of keys) if (!seen.has(keyOf(t, id))) mark(t, id, 'put');
    }
    keptLocal.forEach((k) => {
      const [t, id] = splitKey(k);
      mark(t, id, 'put');
    });
    if (!seen.has(keyOf('settings', SETTINGS_ID))) mark('settings', SETTINGS_ID, 'put');
  }
}

/**
 * First merge: a title both devices added before syncing (same show from the same database) would end up
 * twice. Fold this device's copy into the cloud one: its history, episodes and list spots move over.
 */
async function foldDuplicateTitles(seen: Set<string>) {
  const media = await db.media.toArray();
  const sourceKey = (m: Media) => (m.source && m.sourceId && m.source !== 'manual' ? `${m.source}:${m.sourceId}` : undefined);
  const cloud = new Map<string, Media>();
  for (const m of media) {
    const k = sourceKey(m);
    if (k && seen.has(keyOf('media', m.id))) cloud.set(k, m);
  }
  const dupes = media.filter((m) => !seen.has(keyOf('media', m.id)) && cloud.has(sourceKey(m) ?? ''));
  if (!dupes.length) return;
  const touchedLists = new Set<string>();
  await db.transaction('rw', [db.media, db.episodes, db.logs, db.lists], async (tx) => {
    (tx as unknown as Record<string, unknown>)[FROM_SYNC] = true;
    const lists = await db.lists.toArray();
    for (const local of dupes) {
      const keep = cloud.get(sourceKey(local)!)!;
      const [localEps, keepEps, localLogs, keepLogs] = await Promise.all([
        db.episodes.where('mediaId').equals(local.id).toArray(),
        db.episodes.where('mediaId').equals(keep.id).toArray(),
        db.logs.where('mediaId').equals(local.id).toArray(),
        db.logs.where('mediaId').equals(keep.id).toArray(),
      ]);
      const slot = (e: { season: number; number: number }) => `${e.season}x${e.number}`;
      const keepSlot = new Map(keepEps.map((e) => [slot(e), e.id]));
      const epMap = new Map(localEps.map((e) => [e.id, keepSlot.get(slot(e))]));
      const already = new Set(keepLogs.map((l) => `${l.kind}|${l.episodeId ?? ''}|${l.date}`));
      const moved = localLogs
        .map((l) => ({ ...l, mediaId: keep.id, episodeId: l.episodeId ? (epMap.get(l.episodeId) ?? l.episodeId) : undefined }))
        .filter((l) => !already.has(`${l.kind}|${l.episodeId ?? ''}|${l.date}`)); // the same viewing logged on both devices
      await db.logs.bulkDelete(localLogs.map((l) => l.id));
      await db.logs.bulkPut(moved);
      await db.episodes.bulkDelete(localEps.filter((e) => keepSlot.has(slot(e))).map((e) => e.id));
      const extraEps = localEps.filter((e) => !keepSlot.has(slot(e))).map((e) => ({ ...e, mediaId: keep.id }));
      if (extraEps.length) await db.episodes.bulkPut(extraEps);
      await db.media.delete(local.id);
      for (const l of lists)
        if (l.items.includes(local.id)) {
          l.items = [...new Set(l.items.map((x) => (x === local.id ? keep.id : x)))];
          touchedLists.add(l.id);
        }
    }
    await db.lists.bulkPut(lists.filter((l) => touchedLists.has(l.id)));
  });
  touchedLists.forEach((id) => mark('lists', id, 'put'));
}

/* ---------------- Running it ---------------- */

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleSync(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

export function syncNow(): Promise<void> {
  if (!active()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        setStatus({ state: 'syncing', error: undefined });
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setStatus({ state: 'signed-out' });
          return;
        }
        if (!link!.ready) {
          await pull(true);
          link = { ...link!, ready: true };
          writeJSON(LINK_KEY, link);
        } else {
          await pull(false);
        }
        await push();
      } while (again && active());
      setStatus({ state: 'synced', lastSyncAt: Date.now() });
    } catch (e) {
      const offline = !navigator.onLine || e instanceof TypeError || /fetch|network/i.test(String((e as Error)?.message));
      setStatus({ state: offline ? 'offline' : 'error', error: offline ? undefined : (e as Error)?.message ?? String(e) });
      scheduleSync(offline ? 30_000 : 60_000);
    } finally {
      running = null;
    }
  })();
  return running;
}

let channel: RealtimeChannel | null = null;
let poll: ReturnType<typeof setInterval> | undefined;

function start() {
  if (!link || link.signedOut) return;
  const id = link.id;
  stop();
  channel = supabase
    .channel(`pastime-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pastime_rows', filter: `user_id=eq.${id}` }, () => scheduleSync(400))
    .subscribe();
  // Realtime can drop quietly (phones suspend web apps), so also check every minute while open.
  poll = setInterval(() => document.visibilityState === 'visible' && void syncNow(), 60_000);
  void syncNow();
}

function stop() {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  clearInterval(poll);
  clearTimeout(timer);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && active()) void syncNow();
  else saveDirty();
});
window.addEventListener('online', () => active() && void syncNow());
window.addEventListener('pagehide', saveDirty);

// The session ended elsewhere (password changed, or it expired): keep your changes, ask to sign in again.
supabase.auth.onAuthStateChange((event) => {
  if (active() && event === 'SIGNED_OUT') setStatus({ state: 'signed-out' });
});

if (active()) start();

/* ---------------- Account ---------------- */

/** Signed in, but this device's library belongs to a different account: waiting for you to choose. */
let pendingUser: User | null = null;

export type SignInResult = { ok: true } | { ok: false; libraryOf: string };

/**
 * Signs in with an existing account (the same one as FitPip). There is deliberately no sign-up here:
 * creating an account would also set one up in FitPip.
 * If this device's library came from another account, nothing is merged until you pick what to do.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  if (link && link.id !== data.user.id && (await hasLocalData())) {
    pendingUser = data.user;
    return { ok: false, libraryOf: link.email ?? 'another account' };
  }
  linkTo(data.user, link?.id !== data.user.id);
  return { ok: true };
}

/** After `signIn` found another account's library here: replace it, merge it in, or back out. */
export async function finishAccountSwitch(choice: 'replace' | 'merge' | 'cancel') {
  const user = pendingUser;
  pendingUser = null;
  if (!user || choice === 'cancel') {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return;
  }
  if (choice === 'replace') await clearLocalLibrary();
  linkTo(user, true);
}

async function hasLocalData() {
  for (const t of TABLES) if ((await db.table(t).count()) > 0) return true;
  return false;
}

/** Empties this device's library without telling the cloud (so nothing is deleted there). */
async function clearLocalLibrary() {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async (tx) => {
    (tx as unknown as Record<string, unknown>)[FROM_SYNC] = true;
    for (const t of TABLES) {
      const ids = ((await db.table(t).toArray()) as { id: string }[]).map((r) => r.id);
      await db.table(t).bulkDelete(ids);
    }
  });
}

function linkTo(user: User, fresh: boolean) {
  if (fresh) {
    // First sign-in on this device, or a different account: merge with the cloud copy from scratch.
    dirty.clear();
    saveDirty();
    writeJSON(CURSOR_KEY, null);
    link = { id: user.id, email: user.email, ready: false };
  } else {
    // Same account again: changes made while signed out (deletions too) go up now.
    link = { ...link!, email: user.email, signedOut: false };
  }
  writeJSON(LINK_KEY, link);
  setStatus({});
  start();
}

/**
 * Stops syncing on this device only. `scope: 'local'` matters: the default would also sign you out of
 * FitPip and every other device. What's already here stays here, and changes you make are still noted
 * so they reach your account when you sign back in.
 */
export async function signOut() {
  stop();
  try {
    await push();
  } catch {
    /* offline: unsent changes wait for the next sign-in */
  }
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  if (link) {
    link = { ...link, signedOut: true };
    writeJSON(LINK_KEY, link);
  }
  setStatus({ state: 'off', lastSyncAt: undefined, error: undefined });
}
