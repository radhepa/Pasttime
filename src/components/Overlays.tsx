import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { dismiss, useToasts } from '../lib/toast';
import { cancelTimer, elapsed, restoreTimer, stopTimer, useTimer } from '../lib/timer';
import { toast } from '../lib/toast';
import { Icon } from './ui';
import { getCategory, verb } from '../lib/categories';

/** Little pop-up messages, some with an Undo button. */
export function Toaster() {
  const toasts = useToasts();
  const timer = useTimer();
  // Sit above the tab bar, and above the timer bar while one is running.
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 transition-[bottom] duration-300 ${
        timer ? 'bottom-[calc(env(safe-area-inset-bottom)+8.75rem)] md:bottom-24' : 'bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] md:bottom-8'
      }`}
    >
      <AnimatePresence initial={false}>
      {toasts.map((t) => (
        <motion.div
          key={t.id}
          layout
          initial={{ opacity: 0, y: 24, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
          transition={{ type: 'spring', damping: 26, stiffness: 420 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.6}
          onDragEnd={(_, info) => Math.abs(info.offset.x) > 80 && dismiss(t.id)}
          className="pointer-events-auto flex max-w-full touch-pan-y items-center gap-3 rounded-full bg-float py-2 pr-2 pl-4 text-sm font-semibold text-float-ink shadow-lg"
        >
          <span>{t.text}</span>
          {t.action ? (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              className="rounded-full bg-float-2 px-3 py-1 transition active:scale-95"
            >
              {t.action.label}
            </button>
          ) : (
            <span className="w-2" />
          )}
        </motion.div>
      ))}
      </AnimatePresence>
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
  const stop = () => {
    const done = stopTimer();
    if (done) navigate(`/m/${done.mediaId}?log=${done.kind}&minutes=${done.minutes}&started=${done.startedAt}`);
  };
  const cancel = () => {
    if (!timer) return;
    const t = timer;
    cancelTimer();
    toast(`Timer cancelled (${elapsed(t.startedAt)})`, { label: 'Undo', run: () => restoreTimer(t) });
  };

  return (
    <AnimatePresence>
    {timer && (
    <motion.div
      key="timer"
      initial={{ y: 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 90, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 360 }}
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+62px)] z-40 flex justify-center px-3 md:bottom-4 md:left-56"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-3xl bg-float py-2 pr-2 pl-4 text-float-ink shadow-xl">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: DOT }} />
          <span className="relative inline-flex size-2.5 rounded-full" style={{ background: DOT }} />
        </span>
        <button onClick={() => navigate(`/m/${timer.mediaId}`)} className="min-w-0 flex-1 text-left">
          <span className="block text-xs text-float-ink/65">{verb(getCategory(timer.type)).doing}</span>
          <span className="block truncate text-sm font-semibold">{timer.title}</span>
        </button>
        <span className="shrink-0 font-mono text-base font-semibold tabular-nums min-[400px]:text-lg">{elapsed(timer.startedAt)}</span>
        <button onClick={cancel} className="rounded-full p-2 text-float-ink/65" aria-label="Cancel timer">
          <Icon name="close" className="size-4" />
        </button>
        <button onClick={stop} className="rounded-2xl bg-float-2 px-3.5 py-2.5 text-sm font-semibold transition active:scale-95">
          Stop<span className="hidden min-[400px]:inline"> &amp; log</span>
        </button>
      </div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
