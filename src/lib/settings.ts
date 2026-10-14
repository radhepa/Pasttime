import { useSyncExternalStore } from 'react';

export interface Settings {
  /** Optional: better movie search (posters, years, directors) via TMDB. */
  tmdbKey: string;
  /** Optional: better game search via RAWG. */
  rawgKey: string;
  /**
   * How a multi-season show's overall rating is worked out.
   * "seasons": average each season, then average the seasons (every season counts equally).
   * "episodes": average every rated episode (long seasons count more).
   */
  showRating: 'seasons' | 'episodes';
  /** Ask for a star rating right after you mark an episode or movie watched. */
  promptRating: boolean;
  theme: 'system' | 'light' | 'dark';
  /** Color theme: Mist (sage), Dusk (slate blue), Clay (warm sand) or Lilac. */
  palette: Palette;
  /** Yearly goals: how many titles to finish per category id. Missing / 0 = no goal. */
  goals: Record<string, number>;
  /** When you last exported a backup (ms), for the reminder in Settings. */
  lastBackupAt?: number;
}

export type Palette = 'mist' | 'dusk' | 'clay' | 'lilac';

/** Page backgrounds, for the browser/status-bar color. Keep in sync with index.css and the inline script in index.html. */
export const PALETTE_BG: Record<Palette, [light: string, dark: string]> = {
  mist: ['#eef0eb', '#141a17'],
  dusk: ['#eceef2', '#131722'],
  clay: ['#f2eee8', '#1a1613'],
  lilac: ['#efedf2', '#17141d'],
};

const KEY = 'pastime.settings';
const DEFAULTS: Settings = {
  tmdbKey: '',
  rawgKey: '',
  showRating: 'seasons',
  promptRating: true,
  theme: 'system',
  palette: 'mist',
  goals: {},
};

let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw);
    return { ...DEFAULTS, ...saved, goals: { ...DEFAULTS.goals, ...saved.goals } };
  } catch {
    return DEFAULTS;
  }
}

export function getSettings() {
  return current;
}

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage blocked: settings just won't persist */
  }
  if (patch.theme || patch.palette) applyTheme();
  listeners.forEach((l) => l());
}

/** Resolves "system" against the OS setting and tags <html data-theme data-palette>. Also mirrored by the inline script in index.html. */
export function applyTheme() {
  const dark = current.theme === 'dark' || (current.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const palette = PALETTE_BG[current.palette] ? current.palette : 'mist';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.palette = palette;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PALETTE_BG[palette][dark ? 1 : 0]);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

export function useSettings() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
