import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { createList, db, newestFirst } from '../db';
import type { Episode, LogEntry, Media, Status } from '../types';
import { getCategory, statusLabel, useCategories } from '../lib/categories';
import { statsFor } from '../lib/stats';
import { fmtRating } from '../lib/ratings';
import { useSettings } from '../lib/settings';
import { catColor, Cover, Empty, Icon } from '../components/ui';

const STATUSES: { key: Status | 'all'; label: string }[] = [
  { key: 'active', label: 'In progress' },
  { key: 'planned', label: 'Up next' },
  { key: 'completed', label: 'Finished' },
  { key: 'paused', label: 'Paused' },
  { key: 'dropped', label: 'Dropped' },
  { key: 'all', label: 'Everything' },
];
const SORTS = { recent: 'Recently active', title: 'Title', rating: 'Your rating', added: 'Date added' } as const;

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition ${
        active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink'
      }`}
    >
      {color && <span className="size-2 rounded-full" style={{ background: active ? 'currentColor' : color }} />}
      {children}
    </button>
  );
}

export default function Library() {
  const [params, setParams] = useSearchParams();
  const type = params.get('type') ?? 'all';
  const { all: categories } = useCategories();
  const status = (params.get('status') ?? 'all') as Status | 'all';
  const sort = (params.get('sort') ?? 'recent') as keyof typeof SORTS;
  const view = params.get('view') === 'lists' ? 'lists' : 'titles';
  const [filter, setFilter] = useState('');
  const update = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };
  const { showRating } = useSettings();

  const items = useLiveQuery(async () => {
    const [media, logs, episodes] = await Promise.all([db.media.toArray(), db.logs.toArray(), db.episodes.toArray()]);
    const logsBy = new Map<string, LogEntry[]>();
    logs.forEach((l) => logsBy.set(l.mediaId, [...(logsBy.get(l.mediaId) ?? []), l]));
    const epsBy = new Map<string, Episode[]>();
    episodes.forEach((e) => epsBy.set(e.mediaId, [...(epsBy.get(e.mediaId) ?? []), e]));
    return media.map((m) => ({ m, s: statsFor(m, logsBy.get(m.id) ?? [], epsBy.get(m.id) ?? [], showRating) }));
  }, [showRating]);

  const usedTypes = new Set(items?.map((i) => i.m.type));
  const counts = new Map<string, number>();
  items?.filter((i) => type === 'all' || i.m.type === type).forEach((i) => counts.set(i.m.status, (counts.get(i.m.status) ?? 0) + 1));

  const needle = filter.trim().toLowerCase();
  const shown = (items ?? [])
    .filter((i) => (type === 'all' || i.m.type === type) && (status === 'all' || i.m.status === status))
    .filter(
      (i) =>
        !needle ||
        i.m.title.toLowerCase().includes(needle) ||
        i.m.creators?.some((c) => c.toLowerCase().includes(needle)) ||
        i.m.genres?.some((g) => g.toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      if (sort === 'title') return a.m.title.localeCompare(b.m.title);
      if (sort === 'rating') return (b.s.rating ?? 0) - (a.s.rating ?? 0);
      if (sort === 'added') return b.m.addedAt - a.m.addedAt;
      return b.s.lastActivity - a.s.lastActivity;
    });

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="display text-[2.75rem]">Library</h1>
        <Link to="/search" className="rounded-full bg-accent p-2 text-on-accent" aria-label="Add">
          <Icon name="plus" />
        </Link>
      </header>

      <div className="mb-4 flex gap-1 rounded-xl bg-surface-2 p-1">
        {(['titles', 'lists'] as const).map((v) => (
          <button
            key={v}
            onClick={() => update('view', v)}
            className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${view === v ? 'bg-surface shadow-sm' : 'text-muted'}`}
          >
            {v === 'titles' ? 'All titles' : 'Lists'}
          </button>
        ))}
      </div>

      {view === 'lists' ? (
        <Lists />
      ) : (
        <>
      <div className="relative mb-3">
        <Icon name="search" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter your library" className="field py-2! pl-9!" />
      </div>

      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {['all', ...categories.filter((c) => usedTypes.has(c.id) || c.id === type).map((c) => c.id)].map((t) => (
          <Chip key={t} active={type === t} onClick={() => update('type', t)} color={t === 'all' ? undefined : catColor(t)}>
            {t === 'all' ? 'All' : getCategory(t).plural}
          </Chip>
        ))}
      </div>

      <div className="mb-5 flex items-center gap-2">
        <div className="no-scrollbar -ml-4 flex flex-1 gap-1 overflow-x-auto pl-4">
          {STATUSES.map((s) => {
            const label = s.key !== 'all' && type !== 'all' ? statusLabel(getCategory(type), s.key) : s.label;
            const n = s.key === 'all' ? undefined : counts.get(s.key);
            if (s.key !== 'all' && s.key !== status && !n && (s.key === 'paused' || s.key === 'dropped')) return null;
            return (
              <button
                key={s.key}
                onClick={() => update('status', s.key)}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-medium ${status === s.key ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted'}`}
              >
                {label}
                {n ? <span className="ml-1 text-xs text-muted">{n}</span> : null}
              </button>
            );
          })}
        </div>
        <select value={sort} onChange={(e) => update('sort', e.target.value)} className="rounded-lg bg-surface-2 px-2 py-1 text-sm! font-medium text-muted outline-none">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {items && shown.length === 0 ? (
        <Empty title={items.length ? 'Nothing here' : 'Your library is empty'}>
          <Link to="/search" className="font-semibold text-accent">
            Search
          </Link>{' '}
          for a show, movie, book or game to add it.
        </Empty>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-5">
          {shown.map(({ m, s }) => (
            <Link key={m.id} to={`/m/${m.id}`} className="group block">
              <div className="relative overflow-hidden rounded-xl shadow-sm ring-1 ring-line">
                <Cover src={m.cover} title={m.title} type={m.type} className="aspect-[2/3] w-full transition group-hover:scale-[1.03]" />
                {s.rating !== undefined && (
                  <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[11px] font-bold text-white backdrop-blur">
                    <span className="text-star">★</span>
                    {fmtRating(s.rating)}
                  </span>
                )}
                {s.progress !== undefined && s.progress < 1 && (
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                    <span className="block h-full" style={{ width: `${s.progress * 100}%`, background: catColor(m.type) }} />
                  </span>
                )}
                <span className="absolute bottom-1.5 left-1.5 size-2 rounded-full ring-2 ring-black/30" style={{ background: catColor(m.type) }} />
              </div>
              <p className="mt-1.5 truncate text-sm font-semibold">{m.title}</p>
              <p className="truncate text-xs text-muted">{s.progressLabel ?? m.year ?? statusLabel(getCategory(m.type), m.status)}</p>
            </Link>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

function Lists() {
  const lists = useLiveQuery(async () => {
    const all = newestFirst(await db.lists.toArray());
    const covers = await db.media.bulkGet([...new Set(all.flatMap((l) => l.items.slice(0, 4)))]);
    const byId = new Map(covers.filter(Boolean).map((m) => [m!.id, m!]));
    return all.map((l) => ({ l, preview: l.items.slice(0, 4).map((id) => byId.get(id)).filter(Boolean) as Media[] }));
  }, []);
  const [name, setName] = useState('');
  const navigate = useNavigate();
  if (!lists) return null;
  return (
    <div>
      <form
        className="mb-5 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const l = await createList(name, '📌');
          navigate(`/lists/${l.id}`);
        }}
      >
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="New list name, e.g. Comfort shows" />
        <button type="submit" disabled={!name.trim()} className="shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-40">
          Create
        </button>
      </form>
      {lists.length === 0 ? (
        <Empty title="No lists yet">Group titles however you like: “Comfort shows”, “Books for the beach”, “Games to play with Sam”.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {lists.map(({ l, preview }) => (
            <Link key={l.id} to={`/lists/${l.id}`} className="block">
              <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-line">
                {[0, 1, 2, 3].map((i) =>
                  preview[i] ? (
                    <Cover key={i} src={preview[i].cover} title={preview[i].title} type={preview[i].type} className="size-full" />
                  ) : (
                    <div key={i} className="flex items-center justify-center text-2xl opacity-60">
                      {i === 0 ? (l.emoji ?? '📌') : ''}
                    </div>
                  ),
                )}
              </div>
              <p className="mt-1.5 truncate font-semibold">
                {l.emoji} {l.name}
              </p>
              <p className="text-xs text-muted">{l.items.length} titles</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
