import { useEffect, useState } from 'react';
import { db } from '../db';
import type { LogEntry, Media } from '../types';
import { episodeCode, todayKey } from '../lib/dates';
import { Button, Field, Sheet, StarInput } from './ui';
import { toast } from '../lib/toast';
import { getCategory } from '../lib/categories';

/** Edit or delete any timeline entry: change its day, pages, time played, rating or note. */
export function LogEditor({ log, media, onClose }: { log?: LogEntry; media?: Media; onClose: () => void }) {
  const [draft, setDraft] = useState<LogEntry | undefined>(log);
  useEffect(() => {
    setDraft(log);
  }, [log]);
  if (!draft || !media) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  const set = (patch: Partial<LogEntry>) => setDraft({ ...draft, ...patch });
  const unit = getCategory(media.type).unit ?? 'part';
  const num = (v: string) => (v === '' ? undefined : Math.max(0, Number(v)));

  const save = async () => {
    const patch = { ...draft, updatedAt: Date.now() };
    if (draft.kind === 'progress' && draft.fromPage != null && draft.toPage != null) {
      patch.pages = Math.max(0, draft.toPage - draft.fromPage);
    }
    await db.logs.put(patch);
    onClose();
  };
  const remove = async () => {
    const original = log!;
    await db.logs.delete(original.id);
    onClose();
    toast('Entry deleted', { label: 'Undo', run: () => db.logs.put(original) });
  };

  const title =
    draft.kind === 'episode'
      ? `${media.title} · ${episodeCode(draft.season, draft.number)}`
      : draft.kind === 'finish'
        ? `Finished ${media.title}`
        : draft.kind === 'start'
          ? `Started ${media.title} again`
          : media.title;

  return (
    <Sheet open onClose={onClose} title="Edit entry">
      <p className="mb-4 text-sm text-muted">{title}</p>
      <div className="space-y-4">
        <Field label="Day">
          <div className="flex gap-2">
            <input
              type="date"
              className="field"
              value={draft.date ?? ''}
              max={todayKey()}
              disabled={draft.date === null}
              onChange={(e) => set({ date: e.target.value || todayKey() })}
            />
            <Button variant="soft" onClick={() => set({ date: draft.date === null ? todayKey() : null })} className="shrink-0">
              {draft.date === null ? 'Set a day' : 'No date'}
            </Button>
          </div>
          {draft.date === null && <span className="mt-1 block text-xs text-muted">Undated entries count toward progress and ratings but stay off the timeline.</span>}
        </Field>

        {draft.kind === 'progress' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`From ${unit}`}>
              <input type="number" inputMode="numeric" className="field" value={draft.fromPage ?? ''} onChange={(e) => set({ fromPage: num(e.target.value) })} />
            </Field>
            <Field label={`To ${unit}`}>
              <input type="number" inputMode="numeric" className="field" value={draft.toPage ?? ''} onChange={(e) => set({ toPage: num(e.target.value) })} />
            </Field>
          </div>
        )}

        {(draft.kind === 'session' || draft.kind === 'progress') && (
          <Field label={draft.kind === 'session' ? 'Minutes' : 'Minutes spent (optional)'}>
            <input type="number" inputMode="numeric" className="field" value={draft.minutes ?? ''} onChange={(e) => set({ minutes: num(e.target.value) })} />
          </Field>
        )}

        {(draft.kind === 'episode' || draft.kind === 'once') && (
          <Field label="Your rating">
            <StarInput value={draft.rating} onChange={(rating) => set({ rating })} />
          </Field>
        )}

        <Field label="Note">
          <textarea className="field min-h-20" value={draft.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} />
        </Field>

        <div className="flex gap-2 pt-1">
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
          <Button onClick={save} className="flex-1">
            Save
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
