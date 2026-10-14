import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { db, exportAll, importAll } from '../db';
import { todayKey } from '../lib/dates';
import { setSettings, useSettings, type Palette } from '../lib/settings';
import { moveCategory, saveCategory, TRACK_INFO, unitPlural, useCategories, type Category } from '../lib/categories';
import { fillMissingDetails, importCsv, importLetterboxdWatchlist } from '../lib/importers';
import { toast } from '../lib/toast';
import { Button, Field, Icon } from '../components/ui';
import { CategoryEditor } from '../components/CategoryEditor';

function Card({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="mb-6 scroll-mt-4" id={id}>
      <h2 className="mb-2 px-1 eyebrow">{title}</h2>
      <div className="space-y-4 rounded-3xl bg-surface p-4">{children}</div>
    </section>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-center gap-3 text-left" role="switch" aria-checked={on}>
      <span className="flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <Switch on={on} />
    </button>
  );
}

const Switch = ({ on }: { on: boolean }) => (
  <span className={`relative inline-block h-7 w-12 shrink-0 rounded-full align-middle transition ${on ? 'bg-accent' : 'bg-surface-2 ring-1 ring-line'}`}>
    <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
  </span>
);

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${value === k ? 'bg-surface shadow-sm' : 'text-muted'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Swatches for the theme cards, so each card shows its own palette whatever theme is active. Mirrors index.css. */
const THEMES: { id: Palette; name: string; mood: string; light: string[]; dark: string[] }[] = [
  { id: 'mist', name: 'Mist', mood: 'Sage and soft greens', light: ['#eef0eb', '#f9faf7', '#1f2a25', '#4d7060', '#c9d6cc'], dark: ['#141a17', '#1c2420', '#e6ece8', '#8fbba3', '#2e4a3c'] },
  { id: 'dusk', name: 'Dusk', mood: 'Slate blue evenings', light: ['#eceef2', '#f8f9fb', '#1d2433', '#4f6489', '#c9d2e2'], dark: ['#131722', '#1b2030', '#e5e9f2', '#9db1d9', '#2b3a5a'] },
  { id: 'clay', name: 'Clay', mood: 'Warm sand, terracotta', light: ['#f2eee8', '#fbf9f6', '#2b241e', '#9a5b3f', '#e2cdbe'], dark: ['#1a1613', '#231e1a', '#f0e9e2', '#e0a283', '#4a3226'] },
  { id: 'lilac', name: 'Lilac', mood: 'Hushed violet', light: ['#efedf2', '#faf9fc', '#241f2e', '#6b5a8e', '#d6cde4'], dark: ['#17141d', '#201c28', '#ece8f2', '#bca9e3', '#352c4d'] },
];

function ThemePicker() {
  const s = useSettings();
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Color theme">
      {THEMES.map((t) => {
        const [bg, surface, ink, accent, soft] = dark ? t.dark : t.light;
        const on = s.palette === t.id;
        return (
          <button
            key={t.id}
            role="radio"
            aria-checked={on}
            aria-label={`${t.name}: ${t.mood}`}
            onClick={() => setSettings({ palette: t.id })}
            className={`flex flex-col gap-2.5 rounded-2xl border-2 bg-surface-2/50 p-2 pb-3 text-left transition ${on ? 'border-accent' : 'border-transparent'}`}
          >
            <span className="relative flex h-16 flex-col gap-1.5 rounded-xl p-2.5" style={{ background: bg }}>
              <span className="h-2 w-1/2 rounded-full" style={{ background: ink, opacity: 0.85 }} />
              <span className="flex h-5 items-center gap-1.5 rounded-md px-1.5" style={{ background: surface }}>
                <span className="size-1.5 rounded-full" style={{ background: accent }} />
                <span className="h-1 w-2/5 rounded-full" style={{ background: soft }} />
              </span>
              <span className="absolute top-2 right-2.5 size-5 rounded-full" style={{ background: accent }} />
            </span>
            <span className="px-1">
              <span className="display block text-xl">{t.name}</span>
              <span className="block text-xs text-muted">{t.mood}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Categories() {
  const { all } = useCategories();
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.media.each((x) => m.set(x.type, (m.get(x.type) ?? 0) + 1));
    return m;
  }, []);
  const [editing, setEditing] = useState<Category | 'new'>();
  const shown = all.filter((c) => !c.hidden).length;

  return (
    <Card title="Categories" id="categories">
      <p className="text-sm text-muted">
        Showing {shown} of {all.length}. Hide the ones you don't use to keep search and your library tidy. Hidden categories keep their titles, and you can
        bring them back any time.
      </p>
      <div className="-mx-2 divide-y divide-line">
        {all.map((c, i) => {
          const n = counts?.get(c.id) ?? 0;
          return (
            <div key={c.id} className={`flex items-center gap-2 px-2 py-2 ${c.hidden ? 'opacity-50' : ''}`}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: `color-mix(in srgb, var(--c-${c.color}) 16%, transparent)` }}>
                {c.emoji}
              </span>
              <button onClick={() => setEditing(c)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-semibold">
                  {c.plural}
                  {!c.builtIn && <span className="ml-1.5 rounded bg-surface-2 px-1 py-0.5 text-[10px] font-semibold text-muted uppercase">Yours</span>}
                </span>
                <span className="block truncate text-xs text-muted">
                  {TRACK_INFO[c.track].label}
                  {c.track === 'progress' ? ` (${unitPlural(c)})` : ''}
                  {n ? ` · ${n} ${n === 1 ? 'title' : 'titles'}` : ''}
                </span>
              </button>
              <button onClick={() => moveCategory(c.id, -1)} disabled={i === 0} className="p-1 text-muted disabled:opacity-20" aria-label={`Move ${c.name} up`}>
                <Icon name="up" className="size-4" />
              </button>
              <button onClick={() => moveCategory(c.id, 1)} disabled={i === all.length - 1} className="p-1 text-muted disabled:opacity-20" aria-label={`Move ${c.name} down`}>
                <Icon name="down" className="size-4" />
              </button>
              <button
                onClick={() => saveCategory({ id: c.id, hidden: !c.hidden, ...(c.builtIn ? {} : { custom: true }) })}
                role="switch"
                aria-checked={!c.hidden}
                aria-label={`${c.hidden ? 'Show' : 'Hide'} ${c.plural}`}
              >
                <Switch on={!c.hidden} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setEditing('new')}>
          <Icon name="plus" className="size-4" /> New category
        </Button>
        <Button variant="soft" onClick={() => all.forEach((c) => c.builtIn && !counts?.get(c.id) && saveCategory({ id: c.id, hidden: true }))}>
          Hide unused
        </Button>
        <Button variant="soft" onClick={() => all.forEach((c) => c.hidden && saveCategory({ id: c.id, hidden: false, ...(c.builtIn ? {} : { custom: true }) }))}>
          Show all
        </Button>
      </div>
      <CategoryEditor category={editing === 'new' ? undefined : editing} open={!!editing} onClose={() => setEditing(undefined)} />
    </Card>
  );
}

export default function Settings() {
  const s = useSettings();
  const backupFile = useRef<HTMLInputElement>(null);
  const csvFile = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string>();
  const [filling, setFilling] = useState<string>();
  const [persisted, setPersisted] = useState<boolean>();
  const { hash } = useLocation();
  const counts = useLiveQuery(async () => ({ media: await db.media.count(), logs: await db.logs.count() }), []);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => undefined);
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  const doExport = async () => {
    const blob = new Blob([JSON.stringify(await exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pastime-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setSettings({ lastBackupAt: Date.now() });
  };

  const doImportBackup = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'pastime') throw new Error('not a Pastime backup');
      await importAll(data);
      setMsg(`Restored ${data.media.length} titles and ${data.logs.length} entries.`);
    } catch (e) {
      setMsg(`Couldn't import: ${(e as Error).message}`);
    }
  };

  const doImportCsv = async (files: FileList) => {
    const out: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const text = await f.text();
        const r = /watchlist/i.test(f.name) ? await importLetterboxdWatchlist(text) : await importCsv(text);
        out.push(`${r.kind}: ${r.added} added, ${r.updated} matched, ${r.entries} entries`);
      } catch (e) {
        out.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setMsg(out.join(' · '));
  };

  const daysSinceBackup = s.lastBackupAt ? Math.floor((Date.now() - s.lastBackupAt) / 86400000) : undefined;

  return (
    <div>
      <h1 className="mb-6 display text-[2.75rem]">Settings</h1>

      <Card title="Appearance" id="appearance">
        <Segmented
          value={s.theme}
          onChange={(theme) => setSettings({ theme })}
          options={[
            ['light', 'Light'],
            ['dark', 'Dark'],
            ['system', 'Match device'],
          ]}
        />
        <ThemePicker />
      </Card>

      <Categories />

      <Card title="Ratings">
        <Toggle
          on={s.promptRating}
          onChange={(v) => setSettings({ promptRating: v })}
          label="Ask for a rating after each episode"
          hint="Pops up the stars as soon as you tick an episode off."
        />
        <div>
          <p className="mb-2 text-sm font-semibold">Overall rating for series</p>
          <Segmented
            value={s.showRating}
            onChange={(showRating) => setSettings({ showRating })}
            options={[
              ['seasons', 'Average of seasons'],
              ['episodes', 'Average of episodes'],
            ]}
          />
          <p className="mt-2 text-xs text-muted">
            {s.showRating === 'seasons'
              ? 'Each season gets the average of its episodes, then every season counts equally toward the show.'
              : 'Every rated episode counts equally, so long seasons weigh more.'}
          </p>
        </div>
        <p className="text-sm">
          <Link to="/stats" className="font-semibold text-accent">
            Set yearly goals
          </Link>{' '}
          <span className="text-muted">on the Stats page.</span>
        </p>
      </Card>

      <Card title="Bring your history">
        <p className="text-sm text-muted">
          Import CSV exports from <span className="font-semibold text-ink">Goodreads</span> (My Books → Import and export) or{' '}
          <span className="font-semibold text-ink">Letterboxd</span> (Settings → Data → Export: pick diary.csv, ratings.csv, watched.csv or
          watchlist.csv). Everything is read on this device. Letterboxd half-stars are rounded to whole stars.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" onClick={() => csvFile.current?.click()}>
            <Icon name="upload" className="size-4" /> Import CSV
          </Button>
          <Button
            variant="soft"
            disabled={!!filling || !navigator.onLine}
            onClick={async () => {
              setFilling('Starting…');
              const r = await fillMissingDetails((done, total) => setFilling(`Checking ${done}/${total}…`));
              setFilling(undefined);
              toast(r.checked ? `Filled in details for ${r.fixed} of ${r.checked} titles` : 'Nothing missing');
            }}
          >
            {filling ?? 'Fill in missing covers'}
          </Button>
          <input ref={csvFile} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => e.target.files?.length && doImportCsv(e.target.files)} />
        </div>
      </Card>

      <Card title="Search databases">
        <p className="text-sm text-muted">
          Every category searches free databases with no setup. Free keys from TMDB or RAWG give richer movie and game results, and they're stored only
          on this device.
        </p>
        <Field label="TMDB API key (movies)" hint="Free at themoviedb.org → Settings → API">
          <input className="field font-mono" value={s.tmdbKey} onChange={(e) => setSettings({ tmdbKey: e.target.value.trim() })} placeholder="Optional" />
        </Field>
        <Field label="RAWG API key (games)" hint="Free at rawg.io/apidocs">
          <input className="field font-mono" value={s.rawgKey} onChange={(e) => setSettings({ rawgKey: e.target.value.trim() })} placeholder="Optional" />
        </Field>
      </Card>

      <Card title="Your data">
        <p className="text-sm text-muted">
          {counts ? `${counts.media} titles and ${counts.logs} timeline entries` : '…'} are saved on this device and work fully offline.
          {persisted === true && ' Your browser has agreed to keep them safe.'}
        </p>
        {(daysSinceBackup === undefined || daysSinceBackup >= 14) && (counts?.logs ?? 0) > 0 && (
          <p className="rounded-xl bg-amber-500/12 p-3 text-sm">
            {daysSinceBackup === undefined ? 'You haven’t made a backup yet.' : `Last backup was ${daysSinceBackup} days ago.`} Export one now and then so a
            lost phone doesn't mean a lost history.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" onClick={doExport}>
            <Icon name="download" className="size-4" /> Export backup
          </Button>
          <Button variant="soft" onClick={() => backupFile.current?.click()}>
            <Icon name="upload" className="size-4" /> Restore backup
          </Button>
          <input ref={backupFile} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImportBackup(e.target.files[0])} />
        </div>
        {daysSinceBackup !== undefined && daysSinceBackup < 14 && <p className="text-xs text-muted">Last backup: {daysSinceBackup === 0 ? 'today' : `${daysSinceBackup} days ago`}</p>}
      </Card>

      {msg && <p className="mb-6 rounded-xl bg-surface-2 p-3 text-sm font-semibold">{msg}</p>}

      <Card title="Install">
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">iPhone / iPad:</span> open this page in Safari, tap Share, then “Add to Home Screen”.
          <br />
          <span className="font-semibold text-ink">Windows / Mac:</span> in Chrome or Edge, click the install icon in the address bar (or menu → “Install
          Pastime”).
          <br />
          Once installed it opens like an app and works offline.
        </p>
      </Card>
    </div>
  );
}
