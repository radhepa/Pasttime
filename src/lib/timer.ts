import { useSyncExternalStore } from 'react';

/** A running reading/play timer. Saved so it survives closing the app. */
export interface Timer {
  mediaId: string;
  title: string;
  kind: 'progress' | 'session';
  /** Category id, for the label and colour. */
  type: string;
  startedAt: number;
}

const KEY = 'pastime.timer';
let current: Timer | null = load();
const listeners = new Set<() => void>();

function load(): Timer | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

function save(t: Timer | null) {
  current = t;
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {
    /* the timer just won't survive a restart */
  }
  listeners.forEach((l) => l());
}

export const startTimer = (t: Omit<Timer, 'startedAt'>) => save({ ...t, startedAt: Date.now() });

/** Stops the timer and returns the whole minutes it ran (at least 1). */
export function stopTimer() {
  const t = current;
  save(null);
  return t ? { ...t, minutes: Math.max(1, Math.round((Date.now() - t.startedAt) / 60000)) } : null;
}

export const cancelTimer = () => save(null);
/** Puts a stopped or cancelled timer back, still counting from when it started. */
export const restoreTimer = (t: Timer) => save(t);
export const getTimer = () => current;

export function useTimer() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function elapsed(startedAt: number, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
