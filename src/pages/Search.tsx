import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { haptic } from '../lib/feedback';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { addFromResult, db } from '../db';
import type { SearchResult } from '../types';
import { searchCategory, SOURCE_LABEL } from '../lib/search';
import { getCategory, useCategories, type Category } from '../lib/categories';
import { useSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import { catColor, Cover, Icon, TypeBadge } from '../components/ui';

type Results = Record<string, { items?: SearchResult[]; error?: string; loading: boolean }>;

/** How many categories "All" searches at once (the rest are one tap away). */
const ALL_LIMIT = 6;

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** Placeholder rows while a database is being searched. */
function SkeletonRows() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 p-2" style={{ opacity: 1 - i * 0.25 }}>
          <span className="skeleton h-[72px] w-12 shrink-0 rounded-md" />
          <span className="flex-1 space-y-2">
            <span className="skeleton block h-3.5 w-3/5 rounded-full" />
            <span className="skeleton block h-3 w-2/5 rounded-full" />
          </span>
        </div>
      ))}
    </div>
  );
}

function ResultRow({ r, inLibrary, justAdded, index, onOpen, onAdd }: { r: SearchResult; inLibrary?: string; justAdded?: boolean; index: number; onOpen: () => void; onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 340, delay: Math.min(index, 8) * 0.035 }}
      className="flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-surface"
    >
      <button onClick={onOpen} className="press flex min-w-0 flex-1 items-center gap-3 text-left">
        <Cover src={r.cover} title={r.title} type={r.type} className="h-[72px] w-12 shrink-0 rounded-md shadow-sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{r.title}</span>
          {r.subtitle && <span className="block truncate text-sm text-muted">{r.subtitle}</span>}
          <span className="mt-1 block">
            <TypeBadge type={r.type} />
          </span>
        </span>
      </button>
      {inLibrary ? (
        <Link
          to={`/m/${inLibrary}`}
          className={`flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent ${justAdded ? 'animate-ring' : ''}`}
          aria-label="In your library"
        >
          <span className={justAdded ? 'animate-pop' : undefined}>
            <Icon name="check" className="size-5" strokeWidth={2.5} draw={justAdded} />
          </span>
        </Link>
      ) : (
        <button onClick={onAdd} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition active:scale-85" aria-label={`Add ${r.title}`}>
          <Icon name="plus" className="size-5" strokeWidth={2.5} />
        </button>
      )}
    </motion.div>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const type = params.get('type') ?? 'all';
  const [results, setResults] = useState<Results>({});
  const navigate = useNavigate();
  const settings = useSettings();
  const online = useOnline();
  const { visible } = useCategories();
  const input = useRef<HTMLInputElement>(null);
  const searchable = visible.filter((c) => c.search);
  const wanted: Category[] = type === 'all' ? searchable.slice(0, ALL_LIMIT) : [getCategory(type)];
  const wantedKey = wanted.map((c) => c.id).join(',');
  const query = q.trim();

  const library = useLiveQuery(async () => {
    const all = await db.media.toArray();
    return { bySource: new Map(all.filter((m) => m.source).map((m) => [`${m.source}:${m.sourceId}`, m.id])), all };
  }, []);
  const needle = query.toLowerCase();
  const localMatches =
    needle.length >= 2
      ? (library?.all ?? [])
          .filter((m) => (type === 'all' || m.type === type) && (m.title.toLowerCase().includes(needle) || m.creators?.some((c) => c.toLowerCase().includes(needle))))
          .slice(0, 6)
      : [];

  useEffect(() => {
    if (!params.get('q')) input.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the box in step with the address (e.g. a link to /search?q=…).
  const urlQ = params.get('q') ?? '';
  useEffect(() => {
    if (urlQ !== q.trim()) setQ(urlQ);
  }, [urlQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const type_ = (text: string) => {
    setQ(text);
    const next = new URLSearchParams(params);
    if (text.trim()) next.set('q', text.trim());
    else next.delete('q');
    setParams(next, { replace: true });
  };

  // Debounced search; re-runs when the query, the category or an API key changes.
  useEffect(() => {
    if (query.length < 2 || !online) {
      setResults({});
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setResults(Object.fromEntries(wanted.filter((c) => c.search).map((c) => [c.id, { loading: true }])));
      for (const c of wanted) {
        if (!c.search) continue;
        searchCategory(c, query)
          .then((items) => !cancelled && setResults((r) => ({ ...r, [c.id]: { items, loading: false } })))
          .catch((e: Error) => !cancelled && setResults((r) => ({ ...r, [c.id]: { error: e.message, loading: false } })));
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, wantedKey, online, settings.tmdbKey, settings.rawgKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setType = (t: string) => {
    const next = new URLSearchParams(params);
    next.set('type', t);
    setParams(next, { replace: true });
  };

  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const add = async (r: SearchResult, open: boolean) => {
    haptic();
    setAdded((a) => new Set(a).add(`${r.source}:${r.sourceId}`));
    const id = await addFromResult(r);
    if (open) navigate(`/m/${id}`);
    else toast(`Added ${r.title}`, { label: 'Open', run: () => navigate(`/m/${id}`) });
  };

  const sections = wanted.filter((c) => results[c.id]);
  const notSearched = type === 'all' ? searchable.slice(ALL_LIMIT) : [];

  return (
    <div>
      <h1 className="mb-4 display text-[2.75rem]">Search</h1>
      <div className="sticky top-0 z-10 -mx-4 bg-bg/90 px-4 pt-1 pb-3 backdrop-blur-xl">
        <div className="relative">
          <Icon name="search" className="absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => type_(e.target.value)}
            placeholder={type === 'all' ? 'Shows, movies, books, anime, albums…' : `Search ${getCategory(type).plural.toLowerCase()}…`}
            className="field rounded-2xl! py-3! pl-11!"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {q && (
            <button onClick={() => type_('')} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-surface-2 p-1 text-muted" aria-label="Clear">
              <Icon name="close" className="size-3.5" />
            </button>
          )}
        </div>
        <div className="no-scrollbar mt-3 flex gap-1 overflow-x-auto">
          {['all', ...visible.map((c) => c.id)].map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`relative shrink-0 rounded-lg px-3 py-1 text-sm font-medium transition-colors ${type === t ? 'text-ink' : 'text-muted'}`}
            >
              {type === t && (
                <motion.span layoutId="search-type" className="absolute inset-0 rounded-lg bg-surface shadow-sm ring-1 ring-line" transition={{ type: 'spring', damping: 30, stiffness: 420 }} />
              )}
              <span className="relative">{t === 'all' ? 'All' : `${getCategory(t).emoji} ${getCategory(t).plural}`}</span>
            </button>
          ))}
        </div>
      </div>

      {!online && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl bg-surface-2 p-3 text-sm">
          <Icon name="offline" className="mt-0.5 size-5 shrink-0 text-muted" />
          <p>
            <span className="font-semibold">You're offline.</span> Searching your own library still works, and you can add anything by hand. Online
            search comes back when you reconnect.
          </p>
        </div>
      )}

      {query.length < 2 ? (
        <div className="mt-6 text-sm text-muted">
          <p>
            Search pulls titles, cover art, page and chapter counts and full episode lists from free databases, so you rarely need to type anything in
            yourself.
          </p>
          <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide">Can't find it? Add it yourself</p>
          <div className="flex flex-wrap gap-2">
            {visible.map((c) => (
              <Link key={c.id} to={`/new/${c.id}`} className="flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 font-semibold text-ink shadow-sm ring-1 ring-line">
                <span>{c.emoji}</span>
                {c.name}
              </Link>
            ))}
          </div>
          <p className="mt-6">
            Missing a category, or seeing too many? <Link to="/settings#categories" className="font-semibold text-accent">Manage categories</Link>
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {localMatches.length > 0 && (
            <section>
              <h2 className="mb-1 px-2 eyebrow">In your library</h2>
              {localMatches.map((m) => (
                <Link key={m.id} to={`/m/${m.id}`} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-surface">
                  <Cover src={m.cover} title={m.title} type={m.type} className="h-14 w-10 shrink-0 rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{m.title}</span>
                    <TypeBadge type={m.type} />
                  </span>
                  <Icon name="right" className="size-4 text-muted" />
                </Link>
              ))}
            </section>
          )}

          {type !== 'all' && !getCategory(type).search && (
            <p className="px-2 text-sm text-muted">
              {getCategory(type).plural} don't have a database to search, so add them yourself. It only takes a few seconds.
            </p>
          )}

          {sections.map((c) => {
            const r = results[c.id]!;
            const items = type === 'all' ? r.items?.slice(0, 4) : r.items;
            const source = r.items?.[0]?.source;
            return (
              <section key={c.id}>
                <div className="mb-1 flex items-baseline justify-between px-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: catColor(c.id) }}>
                    {c.emoji} {c.plural}
                  </h2>
                  {type === 'all' && (r.items?.length ?? 0) > 4 && (
                    <button onClick={() => setType(c.id)} className="text-sm font-semibold text-accent">
                      See all {r.items!.length}
                    </button>
                  )}
                </div>
                {r.loading && <SkeletonRows />}
                {r.error && <p className="px-2 py-3 text-sm text-red-500">Couldn't reach the {c.name.toLowerCase()} database ({r.error}).</p>}
                {items?.length === 0 && <p className="px-2 py-3 text-sm text-muted">No matches.</p>}
                {items?.map((it, i) => (
                  <ResultRow
                    key={`${it.source}:${it.sourceId}`}
                    index={i}
                    r={it}
                    justAdded={added.has(`${it.source}:${it.sourceId}`)}
                    inLibrary={library?.bySource.get(`${it.source}:${it.sourceId}`)}
                    onOpen={() => add(it, true)}
                    onAdd={() => add(it, false)}
                  />
                ))}
                {items && (
                  <div className="flex items-center justify-between px-2 pt-1 text-xs text-muted">
                    <span>{source && `From ${SOURCE_LABEL[source]}`}</span>
                    <Link to={`/new/${c.id}?title=${encodeURIComponent(query)}`} className="font-semibold text-accent">
                      Add “{query}” manually
                    </Link>
                  </div>
                )}
              </section>
            );
          })}

          {notSearched.length > 0 && online && (
            <section className="px-2">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Also search in</p>
              <div className="flex flex-wrap gap-2">
                {notSearched.map((c) => (
                  <button key={c.id} onClick={() => setType(c.id)} className="rounded-xl bg-surface px-3 py-1.5 text-sm font-semibold shadow-sm ring-1 ring-line">
                    {c.emoji} {c.plural}
                  </button>
                ))}
              </div>
            </section>
          )}

          {type !== 'all' && (
            <div className="px-2">
              <Link to={`/new/${type}?title=${encodeURIComponent(query)}`} className="text-sm font-semibold text-accent">
                + Add “{query}” as a {getCategory(type).name.toLowerCase()} yourself
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
