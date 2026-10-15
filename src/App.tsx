import { NavLink, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { Icon } from './components/ui';
import { TimerBar, Toaster } from './components/Overlays';
import { useTimer } from './lib/timer';
import { useCategories } from './lib/categories';
import Timeline from './pages/Timeline';
import Library from './pages/Library';
import ListDetail from './pages/ListDetail';
import Search from './pages/Search';
import MediaDetail from './pages/MediaDetail';
import EditMedia from './pages/EditMedia';
import Stats from './pages/Stats';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';
import { db } from './db';
import { isOnboarded, setOnboarded } from './lib/onboarding';

const TABS = [
  { to: '/', icon: 'timeline', label: 'Timeline' },
  { to: '/library', icon: 'library', label: 'Library' },
  { to: '/search', icon: 'search', label: 'Search' },
  { to: '/stats', icon: 'stats', label: 'Stats' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
];

/** Detail screens slide in from the side (and back out the other way); tabs just rise in. */
function usePageMotion(pathname: string) {
  const pop = useNavigationType() === 'POP';
  const isDetail = /^\/(m|lists|new)\//.test(pathname);
  if (!isDetail) return { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } };
  return { initial: { opacity: 0, x: pop ? -28 : 28 }, animate: { opacity: 1, x: 0 } };
}

const tabActive = (to: string, pathname: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

export default function App() {
  const location = useLocation();
  const { pathname } = location;
  const pageMotion = usePageMotion(pathname);
  const navigate = useNavigate();
  const main = useRef<HTMLElement>(null);
  const timer = useTimer();
  useCategories(); // re-render everything when you rename/recolour/hide a category
  // First run on this device with an empty library: the welcome setup. Libraries from before setup existed skip it.
  const [welcome, setWelcome] = useState<boolean | undefined>(() => (isOnboarded() ? false : undefined));
  useEffect(() => {
    if (welcome !== undefined) return;
    db.media
      .count()
      .then((n) => {
        if (n) setOnboarded();
        setWelcome(!n);
      })
      .catch(() => setWelcome(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // New screens open at the top; going Back returns to where you were scrolled.
  const navType = useNavigationType();
  const scrollKey = pathname + location.search;
  const scrolls = useRef(new Map<string, number>());
  const currentKey = useRef(scrollKey);
  currentKey.current = scrollKey;
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const saved = navType === 'POP' ? scrolls.current.get(scrollKey) : undefined;
    if (!saved) {
      el.scrollTo(0, 0);
      return;
    }
    // The list fills in from the database a moment later, so keep trying until it's tall enough.
    let tries = 0;
    let frame = 0;
    const restore = () => {
      el.scrollTop = saved;
      if (Math.abs(el.scrollTop - saved) > 2 && tries++ < 40) frame = requestAnimationFrame(restore);
    };
    restore();
    return () => cancelAnimationFrame(frame);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop: press "/" anywhere to jump to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (welcome === undefined) return null;
  if (welcome || pathname === '/welcome')
    return (
      <MotionConfig reducedMotion="user">
        <Onboarding
          onDone={() => {
            setOnboarded();
            setWelcome(false);
            navigate('/library', { replace: true });
          }}
        />
        <Toaster />
      </MotionConfig>
    );

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-dvh">
      {/* Desktop sidebar */}
      <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="mb-5 flex items-center gap-2 px-3">
          <img src="/icon.svg" alt="" className="size-7 rounded-lg" />
          <span className="display text-2xl">Pastime</span>
        </div>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`
            }
          >
            {tabActive(t.to, pathname) && (
              <motion.span layoutId="side-pill" className="absolute inset-0 rounded-xl bg-surface-2" transition={{ type: 'spring', damping: 30, stiffness: 400 }} />
            )}
            <span className="relative flex items-center gap-3">
              <Icon name={t.icon} />
              {t.label}
            </span>
          </NavLink>
        ))}
        <p className="mt-auto px-3 text-xs text-muted">
          Press <kbd className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">/</kbd> to search
        </p>
      </nav>

      <main ref={main} onScroll={(e) => scrolls.current.set(currentKey.current, e.currentTarget.scrollTop)} className={`pt-safe min-w-0 flex-1 overflow-y-auto ${timer ? 'pb-44 md:pb-28' : 'pb-24 md:pb-8'}`}>
        <div className="mx-auto max-w-3xl px-4 py-4 md:px-8 md:py-8">
          <motion.div key={pathname} initial={pageMotion.initial} animate={pageMotion.animate} transition={{ type: 'spring', damping: 32, stiffness: 340, mass: 0.8 }}>
          <Routes location={location}>
            <Route path="/" element={<Timeline />} />
            <Route path="/library" element={<Library />} />
            <Route path="/lists/:id" element={<ListDetail />} />
            <Route path="/search" element={<Search />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/m/:id" element={<MediaDetail />} />
            <Route path="/m/:id/edit" element={<EditMedia />} />
            <Route path="/new/:type" element={<EditMedia />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
          </motion.div>
        </div>
      </main>

      <TimerBar />
      <Toaster />

      {/* Home-screen app on iPhone: keep scrolling content from showing through under the status bar. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-bg/85 backdrop-blur-xl" />

      {/* Phone tab bar */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl md:hidden">
        <div className="flex">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                `relative flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-medium transition-colors ${isActive ? 'text-accent' : 'text-muted'}`
              }
            >
              {tabActive(t.to, pathname) && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute top-1 h-8 w-14 rounded-full bg-soft"
                  transition={{ type: 'spring', damping: 30, stiffness: 420 }}
                />
              )}
              <motion.span className="relative" whileTap={{ scale: 0.82 }} transition={{ type: 'spring', damping: 15, stiffness: 500 }}>
                <Icon name={t.icon} className="size-6" />
              </motion.span>
              <span className="relative">{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
    </MotionConfig>
  );
}
