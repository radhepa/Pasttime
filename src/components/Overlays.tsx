import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dismiss, useToasts } from '../lib/toast';
import { cancelTimer, elapsed, stopTimer, useTimer } from '../lib/timer';
import { Icon } from './ui';
import { getCategory, verb } from '../lib/categories';

/** Little pop-up messages, some with an Undo button. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-8">
      {toasts.map((t) => (
        <div key={t.id} className="animate-sheet pointer-events-auto flex items-center gap-3 rounded-full bg-float py-2 pr-2 pl-4 text-sm font-semibold text-float-ink shadow-lg">
          <span>{t.text}</span>
          {t.action ? (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              className="rounded-full bg-float-2 px-3 py-1"
            >
              {t.action.label}
            </button>
          ) : (
            <span className="w-2" />
          )}
        </div>
      ))}
    </div>
  );
}

/** A soft accent that reads on the dark timer pill in every theme. */
const DOT = 'color-mix(in srgb, var(--float-ink) 55%, var(--accent))';

/** Shows a running reading/play timer everywhere in the app. */
export function TimerBar() {
  const timer = useTimer();
  const navigate = useNavigate();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timer) return;
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [timer]);
  if (!timer) return null;

  const stop = () => {
    const done = stopTimer();
    if (done) navigate(`/m/${done.mediaId}?log=${done.kind}&minutes=${done.minutes}`);
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+62px)] z-40 flex justify-center px-3 md:bottom-4 md:left-56">
      <div className="flex w-full max-w-md items-center gap-3 rounded-3xl bg-float py-2 pr-2 pl-4 text-float-ink shadow-xl">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: DOT }} />
          <span className="relative inline-flex size-2.5 rounded-full" style={{ background: DOT }} />
        </span>
        <button onClick={() => navigate(`/m/${timer.mediaId}`)} className="min-w-0 flex-1 text-left">
          <span className="block text-xs text-float-ink/65">{verb(getCategory(timer.type)).doing}</span>
          <span className="block truncate text-sm font-semibold">{timer.title}</span>
        </button>
        <span className="font-mono text-lg font-semibold tabular-nums">{elapsed(timer.startedAt)}</span>
        <button onClick={cancelTimer} className="rounded-full p-2 text-float-ink/65" aria-label="Cancel timer">
          <Icon name="close" className="size-4" />
        </button>
        <button onClick={stop} className="rounded-2xl bg-float-2 px-3.5 py-2.5 text-sm font-semibold">
          Stop &amp; log
        </button>
      </div>
    </div>
  );
}
