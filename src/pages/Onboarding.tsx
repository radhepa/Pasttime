import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { SearchResult } from '../types';
import { saveCategory, TRACK_INFO, useCategories, verb, type Category } from '../lib/categories';
import { searchCategory } from '../lib/search';
import { setLook, setSettings, useSettings } from '../lib/settings';
import { addAsSeen, isOnboarded, loadPicks, type Picks } from '../lib/onboarding';
import { celebrate, haptic } from '../lib/feedback';
import { Button, Cover, Icon } from '../components/ui';
import { SyncCard } from '../components/SyncCard';
import { Segmented, ThemePicker } from './Settings';

type Step = 'welcome' | 'categories' | 'seen' | 'look' | 'adding';
const STEPS: Step[] = ['categories', 'seen', 'look'];

/** A first-time pick of categories: the everyday ones. Everything else is one tap away. */
const STARTERS = ['show', 'movie', 'anime', 'book', 'game'];

const SPRING = { type: 'spring', damping: 30, stiffness: 320 } as const;
const keyOf = (r: SearchResult) => `${r.source}:${r.sourceId}`;

/**
 * First run: pick your categories, tap what you've already finished, choose a look. Also reachable from
 * Settings (as /welcome) to run again; then it starts from what you already have.
 */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const again = useRef(isOnboarded()).current;
  const [step, setStep] = useState<Step>(again ? 'categories' : 'welcome');
  const [dir, setDir] = useState(1);
  const { all, visible } = useCategories();
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(again ? visible.map((c) => c.id) : STARTERS.filter((id) => all.some((c) => c.id === id))),
  );
  const [seen, setSeen] = useState<Map<string, SearchResult>>(() => new Map());
  const [progress, setProgress] = useState({ done: 0, total: 0, title: '' });
  // Leaving setup happens once, whether adding finishes or you go ahead while it's still working.
  const left = useRef(false);
  const leave = () => {
    if (left.current) return;
    left.current = true;
    onDone();
  };

  const go = (to: Step) => {
    setDir(STEPS.indexOf(to) >= STEPS.indexOf(step) ? 1 : -1);
    setStep(to);
    document.getElementById('onboarding-scroll')?.scrollTo(0, 0);
  };

  const saveCategories = async () => {
    // Only what changed, so a category's other settings (name, colour, order) are left alone.
    for (const c of all) {
      const show = chosen.has(c.id);
      if (show === !c.hidden) continue;
      await saveCategory({ id: c.id, hidden: !show, ...(c.builtIn ? {} : { custom: true }) });
    }
  };

  const finish = async () => {
    const items = [...seen.values()];
    if (!items.length) {
      haptic('success');
      onDone();
      return;
    }
    go('adding');
    setProgress({ done: 0, total: items.length, title: '' });
    // A few at a time: shows fetch their episode lists, which takes a moment each.
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < items.length) {
        const r = items[next++];
        setProgress((p) => ({ ...p, title: r.title }));
        await addAsSeen(r).catch(() => undefined);
        done++;
        setProgress((p) => ({ ...p, done }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (left.current) return;
    celebrate();
    setTimeout(leave, 900);
  };

  const index = STEPS.indexOf(step);
  const picked = all.filter((c) => chosen.has(c.id));

  return (
    <div className="flex h-dvh flex-col bg-bg">
      {step !== 'welcome' && step !== 'adding' && (
        <header className="pt-safe shrink-0">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 pt-3 pb-2 md:px-8">
            {index > 0 ? (
              <button onClick={() => go(STEPS[index - 1])} className="-ml-2 flex items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold text-accent">
                <Icon name="back" className="size-5" /> Back
              </button>
            ) : (
              <span className="w-16" />
            )}
            <div className="flex flex-1 justify-center gap-1.5" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
              {STEPS.map((s, i) => (
                <motion.span
                  key={s}
                  className="h-1.5 rounded-full"
                  animate={{ width: i === index ? 28 : 8, background: i <= index ? 'var(--accent)' : 'var(--line)' }}
                  transition={SPRING}
                />
              ))}
            </div>
            <button onClick={onDone} className="w-16 text-right text-sm font-semibold text-muted">
              Skip
            </button>
          </div>
        </header>
      )}

      <div id="onboarding-scroll" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: 40 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 * dir }}
            transition={{ type: 'spring', damping: 34, stiffness: 380 }}
            className="mx-auto max-w-3xl px-4 pt-2 pb-32 md:px-8"
          >
            {step === 'welcome' && <Welcome onStart={() => go('categories')} onDone={onDone} />}
            {step === 'categories' && <PickCategories all={all} chosen={chosen} setChosen={setChosen} />}
            {step === 'seen' && <PickSeen categories={picked} seen={seen} setSeen={setSeen} />}
            {step === 'look' && <PickLook />}
            {step === 'adding' && <Adding {...progress} onLeave={leave} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {step !== 'welcome' && step !== 'adding' && (
        <footer className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 bg-gradient-to-t from-bg from-60% to-transparent pt-10">
          <div className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-3 px-4 pb-4 md:px-8">
            {step === 'categories' && (
              <>
                <p className="flex-1 text-sm text-muted">{chosen.size ? `${chosen.size} picked` : 'Pick at least one'}</p>
                <Button
                  disabled={!chosen.size}
                  className="px-6 py-3!"
                  onClick={async () => {
                    await saveCategories();
                    go('seen');
                  }}
                >
                  Continue
                </Button>
              </>
            )}
            {step === 'seen' && (
              <>
                <p className="flex-1 text-sm text-muted">
                  {seen.size ? (
                    <motion.span key={seen.size} initial={{ opacity: 0.4, y: 3 }} animate={{ opacity: 1, y: 0 }} className="inline-block font-semibold text-ink">
                      {seen.size} added
                    </motion.span>
                  ) : (
                    'Nothing yet? That’s fine too.'
                  )}
                </p>
                <Button className="px-6 py-3!" onClick={() => go('look')}>
                  {seen.size ? 'Continue' : 'Skip for now'}
                </Button>
              </>
            )}
            {step === 'look' && (
              <>
                <span className="flex-1" />
                <Button className="px-6 py-3!" onClick={finish}>
                  {seen.size ? `Add ${seen.size} and finish` : 'Finish'}
                </Button>
              </>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

/* ---------------- Welcome ---------------- */

function Welcome({ onStart, onDone }: { onStart: () => void; onDone: () => void }) {
  const [syncing, setSyncing] = useState(false);
  return (
    <div className="pt-safe flex min-h-[calc(100dvh-2rem)] flex-col justify-center py-10">
      <motion.img
        src="/icon.svg"
        alt=""
        className="size-16 rounded-2xl shadow-lg"
        initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', damping: 14, stiffness: 260, delay: 0.05 }}
      />
      <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.12 }} className="display mt-6 text-[3.2rem] leading-[1.02]">
        Welcome to Pastime
      </motion.h1>
      <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.2 }} className="mt-3 max-w-md text-lg text-muted">
        One calm place for everything you watch, read and play, with a timeline of your days.
      </motion.p>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.28 }} className="mt-8 flex flex-col gap-3 sm:max-w-sm">
        <Button className="py-3.5! text-base" onClick={onStart}>
          Set up my library
        </Button>
        <Button variant="soft" className="py-3!" onClick={() => setSyncing((s) => !s)}>
          I already use Pastime on another device
        </Button>
      </motion.div>
      <AnimatePresence>
        {syncing && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden sm:max-w-sm">
            <div className="mt-4 space-y-4 rounded-3xl bg-surface p-4">
              <SyncCard />
              <Button className="w-full" onClick={onDone}>
                Go to my library
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="mt-8 max-w-md text-xs text-muted">
        Your library is private. It lives on this device, and only syncs to your own account if you sign in.
      </p>
    </div>
  );
}

/* ---------------- Step 1: categories ---------------- */

function PickCategories({ all, chosen, setChosen }: { all: Category[]; chosen: Set<string>; setChosen: (s: Set<string>) => void }) {
  const toggle = (id: string) => {
    haptic();
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };
  return (
    <div>
      <h1 className="display text-[2.4rem] leading-[1.05] text-balance">What do you keep track of?</h1>
      <p className="mt-2 mb-6 text-muted">Pick as many as you like. You can change these any time in Settings.</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {all.map((c, i) => {
          const on = chosen.has(c.id);
          return (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: Math.min(i, 14) * 0.022 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => toggle(c.id)}
              aria-pressed={on}
              className={`relative flex flex-col rounded-2xl p-3 text-left ring-1 transition-colors duration-200 ${
                on ? 'bg-soft ring-2 ring-accent' : 'bg-surface ring-line'
              }`}
            >
              <span className="flex items-start justify-between">
                <span className="text-2xl leading-none">{c.emoji}</span>
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
                >
                  {on && (
                    <span className="animate-pop">
                      <Icon name="check" className="size-3.5" strokeWidth={3} draw />
                    </span>
                  )}
                </span>
              </span>
              <span className="mt-2 block leading-tight font-semibold">{c.plural}</span>
              <span className="mt-0.5 block text-xs text-muted">{c.track === 'progress' ? `By ${c.unit ?? 'part'}` : TRACK_INFO[c.track].label}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Step 2: what you've already seen ---------------- */

function PickSeen({ categories, seen, setSeen }: { categories: Category[]; seen: Map<string, SearchResult>; setSeen: (m: Map<string, SearchResult>) => void }) {
  const [picks, setPicks] = useState<Picks>();
  useEffect(() => {
    loadPicks()
      .then(setPicks)
      .catch(() => setPicks({}));
  }, []);
  // Categories you can pick from: ones with popular titles here or a database to search.
  const usable = categories.filter((c) => c.search || picks?.[c.id]?.length);
  const [active, setActive] = useState<string>();
  const cat = usable.find((c) => c.id === active) ?? usable[0];
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ for: string; items?: SearchResult[]; error?: boolean }>();
  const query = q.trim();
  const animeHome = categories.some((c) => c.id === 'anime') ? 'anime' : undefined;

  useEffect(() => {
    setResults(undefined);
    if (!cat || query.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setResults({ for: query });
      searchCategory(cat, query, animeHome)
        .then((items) => !cancelled && setResults({ for: query, items }))
        .catch(() => !cancelled && setResults({ for: query, error: true }));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, cat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of seen.values()) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  }, [seen]);

  if (!picks) return <TileSkeletons />;
  if (!cat)
    return (
      <div>
        <h1 className="display text-[2.4rem] leading-[1.05] text-balance">You're all set here</h1>
        <p className="mt-2 text-muted">The categories you picked don't have a database to search, so you'll add things yourself as you go.</p>
      </div>
    );

  const v = verb(cat);
  const toggle = (r: SearchResult) => {
    haptic();
    const next = new Map(seen);
    if (next.has(keyOf(r))) next.delete(keyOf(r));
    else next.set(keyOf(r), r);
    setSeen(next);
  };
  const showing = query.length >= 2 ? results?.items : picks[cat.id];
  const loading = query.length >= 2 && (!results || (!results.items && !results.error));
  const pastWords = [...new Set(categories.map((c) => verb(c).past.toLowerCase()))].slice(0, 3);

  return (
    <div>
      <h1 className="display text-[2.4rem] leading-[1.05] text-balance">What have you already {pastWords.length > 1 ? `${pastWords.slice(0, -1).join(', ')} or ${pastWords.at(-1)}` : pastWords[0]}?</h1>
      <p className="mt-2 text-muted">Tap everything you've finished. It goes into your library as done, no dates needed.</p>

      <div className="sticky top-0 z-10 -mx-4 mt-4 bg-bg/90 px-4 pt-2 pb-3 backdrop-blur-xl md:-mx-8 md:px-8">
        {usable.length > 1 && (
          <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 md:-mx-8 md:px-8">
            {usable.map((c) => {
              const on = c.id === cat.id;
              const n = counts.get(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setActive(c.id);
                    setQ('');
                  }}
                  className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${on ? 'text-on-accent' : 'bg-surface text-ink ring-1 ring-line'}`}
                >
                  {on && <motion.span layoutId="seen-cat" className="absolute inset-0 rounded-full bg-accent" transition={{ type: 'spring', damping: 30, stiffness: 420 }} />}
                  <span className="relative">
                    {c.emoji} {c.plural}
                  </span>
                  {!!n && (
                    <motion.span
                      key={n}
                      initial={{ scale: 0.5 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', damping: 12, stiffness: 500 }}
                      className={`relative min-w-5 rounded-full px-1.5 text-center text-xs ${on ? 'bg-white/25' : 'bg-soft text-accent'}`}
                    >
                      {n}
                    </motion.span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {cat.search && (
          <div className="relative">
            <Icon name="search" className="absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Find ${/^[aeiou]/i.test(cat.name) ? 'an' : 'a'} ${cat.name.toLowerCase()} you've ${v.past.toLowerCase()}…`}
              className="field rounded-2xl! py-3! pl-11!"
              enterKeyHint="search"
              autoCorrect="off"
            />
            {q && (
              <button onClick={() => setQ('')} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-surface-2 p-1 text-muted" aria-label="Clear">
                <Icon name="close" className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {query.length < 2 && picks[cat.id]?.length ? <p className="mb-3 eyebrow">Popular {cat.plural.toLowerCase()}</p> : null}
      {loading ? (
        <TileSkeletons />
      ) : results?.error && query.length >= 2 ? (
        <p className="py-6 text-sm text-muted">Couldn't search just now. Check your connection, or pick from the popular ones.</p>
      ) : showing?.length ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5">
          {showing.map((r, i) => (
            <SeenTile key={keyOf(r)} r={r} index={i} on={seen.has(keyOf(r))} onToggle={() => toggle(r)} />
          ))}
        </div>
      ) : (
        <p className="py-6 text-sm text-muted">
          {query.length >= 2 ? `No ${cat.plural.toLowerCase()} called “${query}”.` : `Search above for ${cat.plural.toLowerCase()} you've ${v.past.toLowerCase()}.`}
        </p>
      )}
    </div>
  );
}

function SeenTile({ r, on, index, onToggle }: { r: SearchResult; on: boolean; index: number; onToggle: () => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: Math.min(index, 15) * 0.025 }}
      whileTap={{ scale: 0.94 }}
      onClick={onToggle}
      aria-pressed={on}
      aria-label={`${r.title}${r.year ? ` (${r.year})` : ''}`}
      className="text-left"
    >
      <span className={`relative block overflow-hidden rounded-xl ring-1 transition-shadow duration-200 ${on ? 'shadow-lg ring-2 ring-accent' : 'ring-line'}`}>
        <Cover src={r.cover} title={r.title} type={r.type} className={`aspect-[2/3] w-full transition duration-300 ${on ? 'scale-[1.04] brightness-[.7]' : ''}`} />
        <AnimatePresence>
          {on && (
            <motion.span
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={{ type: 'spring', damping: 13, stiffness: 420 }}
              className="absolute inset-0 m-auto flex size-11 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg"
            >
              <Icon name="check" className="size-6" strokeWidth={3} draw />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="mt-1.5 line-clamp-2 text-[13px] leading-snug font-semibold">{r.title}</span>
      {r.year && <span className="block text-xs text-muted">{r.year}</span>}
    </motion.button>
  );
}

function TileSkeletons() {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{ opacity: 1 - i * 0.07 }}>
          <span className="skeleton block aspect-[2/3] rounded-xl" />
          <span className="skeleton mt-2 block h-3 w-4/5 rounded-full" />
        </span>
      ))}
    </div>
  );
}

/* ---------------- Step 3: the look ---------------- */

function PickLook() {
  const s = useSettings();
  return (
    <div>
      <h1 className="display text-[2.4rem] leading-[1.05] text-balance">Make it yours</h1>
      <p className="mt-2 mb-6 text-muted">Pick a colour theme. Everything changes as you tap, and you can switch any time in Settings.</p>
      <ThemePicker />
      <p className="mt-6 mb-2 text-sm font-semibold">Light or dark</p>
      <Segmented
        value={s.theme}
        onChange={(theme) => setLook({ theme })}
        options={[
          ['light', 'Light'],
          ['dark', 'Dark'],
          ['system', 'Match device'],
        ]}
      />
      <p className="mt-6 mb-2 text-sm font-semibold">Ratings</p>
      <Segmented
        value={s.ratingScale}
        onChange={(ratingScale) => setSettings({ ratingScale })}
        options={[
          ['five', '5 stars, with halves'],
          ['ten', '10 stars'],
        ]}
      />
    </div>
  );
}

/* ---------------- Adding ---------------- */

function Adding({ done, total, title, onLeave }: { done: number; total: number; title: string; onLeave: () => void }) {
  const finished = done >= total;
  // Slow connection: after a few seconds you can go ahead; the rest keeps arriving in the background.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="pt-safe flex min-h-[calc(100dvh-2rem)] flex-col items-center justify-center text-center">
      <motion.div
        animate={finished ? { scale: [1, 1.15, 1] } : { rotate: 360 }}
        transition={finished ? { duration: 0.45 } : { repeat: Infinity, duration: 2.4, ease: 'linear' }}
        className="flex size-16 items-center justify-center rounded-full bg-soft text-accent"
      >
        <Icon name={finished ? 'check' : 'refresh'} className="size-8" strokeWidth={finished ? 2.6 : 1.9} draw={finished} />
      </motion.div>
      <h1 className="display mt-6 text-[2.4rem]">{finished ? 'Your library is ready' : 'Adding your library…'}</h1>
      <p className="mt-2 h-5 max-w-xs truncate text-sm text-muted">{finished ? `${total} ${total === 1 ? 'title' : 'titles'} added` : title}</p>
      <div className="mt-6 h-2 w-56 overflow-hidden rounded-full bg-surface-2">
        <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${total ? (done / total) * 100 : 0}%` }} transition={{ type: 'spring', damping: 30, stiffness: 160 }} />
      </div>
      <p className="mt-3 text-xs text-muted">
        {done} of {total}
        {!finished && ' · shows bring their full episode lists'}
      </p>
      <AnimatePresence>
        {slow && !finished && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-8">
            <Button variant="soft" onClick={onLeave}>
              Open my library now
            </Button>
            <p className="mt-2 text-xs text-muted">The rest keeps adding while you look around.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
