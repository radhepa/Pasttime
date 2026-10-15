import { useEffect, useId, useState } from 'react';
import { motion } from 'motion/react';
import { addLog, db, touchMedia } from '../db';
import type { LogEntry, Media } from '../types';
import { addDays, shortDay, todayKey } from '../lib/dates';
import { Button, Field, Sheet, StarInput } from './ui';
import { getCategory, unitPlural, verb } from '../lib/categories';
import { celebrate, haptic } from '../lib/feedback';
import { toast } from '../lib/toast';

/** "Logged" toast with an Undo that removes the entry again (and restores the title's status). */
function loggedToast(text: string, log: LogEntry, media: Media) {
  toast(text, {
    label: 'Undo',
    run: async () => {
      await db.logs.delete(log.id);
      await touchMedia(media.id, { status: media.status, rating: media.rating });
    },
  });
}

/** Today / Yesterday / pick a day / (optionally) no date. */
export function DayPicker({ value, onChange, allowNone }: { value: string | null; onChange: (d: string | null) => void; allowNone?: boolean }) {
  const today = todayKey();
  const yesterday = addDays(today, -1);
  const custom = value !== null && value !== today && value !== yesterday;
  const pillId = useId();
  const chip = (active: boolean) =>
    `relative rounded-xl bg-surface-2 px-3 py-2 text-sm font-semibold transition-colors duration-200 active:scale-95 ${active ? 'text-on-accent' : ''}`;
  const pill = (active: boolean) =>
    active && <motion.span layoutId={pillId} className="absolute inset-0 rounded-xl bg-accent" transition={{ type: 'spring', damping: 30, stiffness: 450 }} />;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={chip(value === today)} onClick={() => onChange(today)}>
        {pill(value === today)}
        <span className="relative">Today</span>
      </button>
      <button type="button" className={chip(value === yesterday)} onClick={() => onChange(yesterday)}>
        {pill(value === yesterday)}
        <span className="relative">Yesterday</span>
      </button>
      <label className={chip(custom)}>
        {pill(custom)}
        <span className="relative">{custom ? shortDay(value!) : 'Other day…'}</span>
        <input
          type="date"
          max={today}
          value={custom ? value! : ''}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 opacity-0"
        />
      </label>
      {allowNone && (
        <button type="button" className={chip(value === null)} onClick={() => onChange(null)}>
          {pill(value === null)}
          <span className="relative">Don't remember</span>
        </button>
      )}
    </div>
  );
}

/** Shown right after marking an episode/movie watched. One tap on a star saves and closes. */
export function RatePrompt({ log, heading, sub, onClose, pastVerb = 'Watched' }: { log?: LogEntry; heading: string; sub?: string; onClose: () => void; pastVerb?: string }) {
  const [date, setDate] = useState<string | null>(log?.date ?? todayKey());
  const [changingDay, setChangingDay] = useState(false);
  useEffect(() => {
    setDate(log?.date ?? todayKey());
    setChangingDay(false);
  }, [log?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (rating?: number) => {
    if (!log) return;
    onClose();
    await db.logs.update(log.id, { rating, date, updatedAt: Date.now() });
  };

  return (
    <Sheet open={!!log} onClose={() => save(log?.rating)} title={heading}>
      {log && (
      <>
      {sub && <p className="-mt-1 mb-4 text-sm text-muted">{sub}</p>}
      <div className="flex flex-col items-center gap-2 py-3">
        <StarInput value={log.rating} onChange={(r) => save(r)} size="size-11" />
        <p className="text-xs text-muted">Tap to rate</p>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        {changingDay ? (
          <DayPicker value={date} onChange={setDate} allowNone />
        ) : (
          <button className="text-sm text-muted" onClick={() => setChangingDay(true)}>
            {pastVerb} {date === null ? 'at some point' : date === todayKey() ? 'today' : shortDay(date)} · <span className="font-semibold text-accent">change</span>
          </button>
        )}
      </div>
      <Button variant="soft" className="mt-4 w-full" onClick={() => save(undefined)}>
        Skip rating
      </Button>
      </>
      )}
    </Sheet>
  );
}

/** Log one time you watched / listened to / went to something, with an optional rating. */
export function OnceSheet({ media, open, onClose }: { media: Media; open: boolean; onClose: () => void }) {
  const v = verb(getCategory(media.type));
  const [date, setDate] = useState<string | null>(todayKey());
  const [rating, setRating] = useState<number>();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setDate(todayKey());
      setRating(undefined);
      setNote('');
    }
  }, [open]);
  const save = async () => {
    const first = media.status !== 'completed';
    const log = await addLog({ mediaId: media.id, kind: 'once', date, rating, note: note || undefined });
    if (first) await touchMedia(media.id, { status: 'completed' });
    onClose();
    if (first) celebrate();
    else haptic('success');
    loggedToast(`${v.past} ${media.title}`, log, media);
  };
  return (
    <Sheet open={open} onClose={onClose} title={`${v.past}${v.past === 'Went' ? ' to' : ''} ${media.title}`}>
      <div className="space-y-5">
        <Field label="When">
          <DayPicker value={date} onChange={setDate} allowNone />
        </Field>
        <Field label="Your rating">
          <StarInput value={rating} onChange={setRating} />
        </Field>
        <Field label="Note (optional)">
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who you were with, where…" />
        </Field>
        <Button className="w-full" onClick={save}>
          Log it
        </Button>
      </div>
    </Sheet>
  );
}

/** Log progress: "I'm now on page/chapter X" or "I did N pages/chapters". */
export function ProgressSheet({
  media,
  open,
  onClose,
  currentPage,
  onReachedEnd,
  initialMinutes,
}: {
  media: Media;
  open: boolean;
  onClose: () => void;
  currentPage?: number;
  onReachedEnd: () => void;
  /** Pre-filled from a stopped timer. */
  initialMinutes?: number;
}) {
  const [date, setDate] = useState<string | null>(todayKey());
  const [mode, setMode] = useState<'page' | 'count'>('page');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [minutes, setMinutes] = useState('');
  const cat = getCategory(media.type);
  const v = verb(cat);
  const unit = cat.unit || 'part';
  const units = (n: number) => `${n} ${unitPlural(cat, n)}`;
  useEffect(() => {
    if (open) {
      setDate(todayKey());
      setValue('');
      setNote('');
      setMinutes(initialMinutes ? String(initialMinutes) : '');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = currentPage ?? 0;
  const n = Number(value);
  const to = mode === 'page' ? n : from + n;
  const pages = to - from;
  const tooFar = !!media.totalPages && to > media.totalPages;
  const valid = value !== '' && n > 0 && pages > 0 && !tooFar;

  const save = async () => {
    const log = await addLog({
      mediaId: media.id,
      kind: 'progress',
      date,
      fromPage: from,
      toPage: to,
      pages,
      minutes: Number(minutes) > 0 ? Math.round(Number(minutes)) : undefined,
      note: note || undefined,
    });
    onClose();
    haptic('success');
    if (media.totalPages && to >= media.totalPages && media.status !== 'completed') onReachedEnd();
    else loggedToast(`Logged ${units(pages)}`, log, media);
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Log progress · ${media.title}`}>
      <div className="space-y-5">
        <Field label="When">
          <DayPicker value={date} onChange={setDate} />
        </Field>
        <div>
          <div className="mb-2 flex gap-1 rounded-xl bg-surface-2 p-1">
            {(['page', 'count'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${mode === m ? 'bg-surface shadow-sm' : 'text-muted'}`}>
                {m === 'page' ? `I'm now on ${unit}…` : `I ${v.base === 'go' ? 'did' : v.base} … ${unitPlural(cat)}`}
              </button>
            ))}
          </div>
          <input
            type="number"
            inputMode="numeric"
            autoFocus
            className="field text-center text-2xl! font-semibold"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === 'page' ? String(from + 20) : '20'}
          />
          <p className="mt-2 text-center text-sm text-muted">
            {tooFar
              ? `It has ${units(media.totalPages!)}. Different edition? Change the total with Edit.`
              : valid
              ? `${units(pages)} · ${from} → ${to}${media.totalPages ? ` of ${media.totalPages}` : ''}`
              : mode === 'page' && value !== '' && n <= from
                ? `You were already on ${unit} ${from}`
                : currentPage != null
                  ? `Last time you stopped on ${unit} ${currentPage}`
                  : 'Starting from the beginning'}
          </p>
        </div>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label="Minutes">
            <input type="number" inputMode="numeric" className="field" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Note (optional)">
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Button className="w-full" disabled={!valid} onClick={save}>
          Log {valid ? units(pages) : 'progress'}
        </Button>
      </div>
    </Sheet>
  );
}

/** Log a session (playing, listening…) with how long it lasted. */
export function SessionSheet({ media, open, onClose, initialMinutes }: { media: Media; open: boolean; onClose: () => void; initialMinutes?: number }) {
  const v = verb(getCategory(media.type));
  const [date, setDate] = useState<string | null>(todayKey());
  const [hours, setHours] = useState('');
  const [mins, setMins] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setDate(todayKey());
      setHours(initialMinutes ? String(Math.floor(initialMinutes / 60)) : '');
      setMins(initialMinutes ? String(initialMinutes % 60) : '');
      setNote('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const minutes = Math.round((Number(hours) || 0) * 60 + (Number(mins) || 0));
  const save = async () => {
    const log = await addLog({ mediaId: media.id, kind: 'session', date, minutes: minutes || undefined, note: note || undefined });
    onClose();
    haptic('success');
    loggedToast(`${v.past} ${media.title}`, log, media);
  };
  return (
    <Sheet open={open} onClose={onClose} title={`${v.past} ${media.title}`}>
      <div className="space-y-5">
        <Field label="When">
          <DayPicker value={date} onChange={setDate} />
        </Field>
        <Field label="How long">
          <div className="flex gap-2">
            {[
              [hours, setHours, 'hours'],
              [mins, setMins, 'min'],
            ].map(([v, set, unit]) => (
              <div key={unit as string} className="relative flex-1">
                <input
                  type="number"
                  inputMode="decimal"
                  className="field pr-14"
                  value={v as string}
                  onChange={(e) => (set as (s: string) => void)(e.target.value)}
                  placeholder="0"
                />
                <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">{unit as string}</span>
              </div>
            ))}
          </div>
        </Field>
        <div className="flex flex-wrap gap-2">
          {[30, 60, 90, 120, 180].map((m) => (
            <button
              key={m}
              onClick={() => {
                setHours(String(Math.floor(m / 60)));
                setMins(String(m % 60));
              }}
              className="rounded-lg bg-surface-2 px-2.5 py-1 text-sm font-medium"
            >
              {m < 60 ? `${m}m` : `${m / 60}h`}
            </button>
          ))}
        </div>
        <Field label="Note (optional)">
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Beat the second boss, episode 42…" />
        </Field>
        <Button className="w-full" onClick={save}>
          Log session
        </Button>
      </div>
    </Sheet>
  );
}

/** Mark a progress/sessions title finished and give it an overall rating. */
export function FinishSheet({ media, open, onClose }: { media: Media; open: boolean; onClose: () => void }) {
  const [date, setDate] = useState<string | null>(todayKey());
  const [rating, setRating] = useState<number | undefined>(media.rating);
  useEffect(() => {
    if (open) {
      setDate(todayKey());
      setRating(media.rating);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const log = await addLog({ mediaId: media.id, kind: 'finish', date });
    await touchMedia(media.id, { status: 'completed', rating });
    onClose();
    celebrate();
    loggedToast(`Finished ${media.title}`, log, media);
  };
  return (
    <Sheet open={open} onClose={onClose} title={`Finished ${media.title}?`}>
      <div className="space-y-5">
        <Field label="When">
          <DayPicker value={date} onChange={setDate} allowNone />
        </Field>
        <Field label="Overall rating">
          <StarInput value={rating} onChange={setRating} />
        </Field>
        <Button className="w-full" onClick={save}>
          Mark finished
        </Button>
      </div>
    </Sheet>
  );
}

/** Bulk-mark a set of episodes (a season, or "everything up to here"). */
export function BulkWatchSheet({
  open,
  title,
  count,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  count: number;
  onClose: () => void;
  onConfirm: (date: string | null) => Promise<void>;
}) {
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDate(null);
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="mb-4 text-sm text-muted">
        Marks {count} episode{count === 1 ? '' : 's'} watched. Catching up on old episodes? Leave it on “Don't remember” so they count toward your progress
        without filling up one day of your timeline.
      </p>
      <Field label="When">
        <DayPicker value={date} onChange={setDate} allowNone />
      </Field>
      <Button
        className="mt-5 w-full"
        onClick={async () => {
          await onConfirm(date);
          onClose();
        }}
      >
        Mark {count} watched
      </Button>
    </Sheet>
  );
}
