import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
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

const TABS = [
  { to: '/', icon: 'timeline', label: 'Timeline' },
  { to: '/library', icon: 'library', label: 'Library' },
  { to: '/search', icon: 'search', label: 'Search' },
  { to: '/stats', icon: 'stats', label: 'Stats' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
];

export default function App() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const main = useRef<HTMLElement>(null);
  const timer = useTimer();
  useCategories(); // re-render everything when you rename/recolour/hide a category
  useEffect(() => {
    main.current?.scrollTo(0, 0);
  }, [pathname]);

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

  return (
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
              `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'
              }`
            }
          >
            <Icon name={t.icon} />
            {t.label}
          </NavLink>
        ))}
        <p className="mt-auto px-3 text-xs text-muted">
          Press <kbd className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">/</kbd> to search
        </p>
      </nav>

      <main ref={main} className={`pt-safe min-w-0 flex-1 overflow-y-auto ${timer ? 'pb-44 md:pb-28' : 'pb-24 md:pb-8'}`}>
        <div className="mx-auto max-w-3xl px-4 py-4 md:px-8 md:py-8">
          <Routes>
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
        </div>
      </main>

      <TimerBar />
      <Toaster />

      {/* Phone tab bar */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl md:hidden">
        <div className="flex">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-medium ${isActive ? 'text-accent' : 'text-muted'}`
              }
            >
              <Icon name={t.icon} className="size-6" />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
