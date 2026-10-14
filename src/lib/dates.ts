const pad = (n: number) => String(n).padStart(2, '0');

export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => dateKey(new Date());

export function parseKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function dayLabel(key: string) {
  const today = todayKey();
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  if (key === addDays(today, 1)) return 'Tomorrow';
  const d = parseKey(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function shortDay(key: string) {
  return parseKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The 7 days (Sun–Sat) of the week containing `key`. */
export function weekOf(key: string) {
  const d = parseKey(key);
  const start = addDays(key, -d.getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const episodeCode = (s?: number, e?: number) => `S${pad(s ?? 0)}E${pad(e ?? 0)}`;
