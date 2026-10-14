import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db';
import {
  COLORS,
  getCategory,
  saveCategory,
  guessPlural,
  slugify,
  useCategories,
  TRACK_INFO,
  VERB_OPTIONS,
  type Category,
  type ColorKey,
  type Track,
  type Verb,
} from '../lib/categories';
import { CUSTOM_SOURCES } from '../lib/search';
import { toast } from '../lib/toast';
import { Button, Field, Sheet } from './ui';

const EMOJI = ['✨', '🎬', '📺', '📖', '🎮', '🎧', '🎙️', '🎤', '🎭', '🎨', '🖼️', '📰', '🧩', '🎲', '🏟️', '⚽', '🏀', '🎓', '🍳', '🍷', '☕', '🏕️', '✈️', '🧘', '🏃', '🎻', '🎹', '📷', '🎡', '🎯', '🧵', '💻'];
const VERB_LABEL: Record<Verb, string> = {
  watch: 'Watch',
  read: 'Read',
  play: 'Play',
  listen: 'Listen',
  attend: 'Go to',
  visit: 'Visit',
  take: 'Take',
  do: 'Do',
};
const UNIT_SUGGESTIONS = ['page', 'chapter', 'issue', 'volume', 'lesson', 'episode', 'level', 'mile', 'song', 'puzzle'];

/** Create a category, or edit one (built-ins: looks and name only; how they track is fixed). */
export function CategoryEditor({ category, open, onClose }: { category?: Category; open: boolean; onClose: () => void }) {
  const isNew = !category;
  const [draft, setDraft] = useState<Category>(blank());
  const [sourceKey, setSourceKey] = useState('none');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const { all } = useCategories();
  const count = useLiveQuery(() => (category ? db.media.where('type').equals(category.id).count() : Promise.resolve(0)), [category?.id]);

  useEffect(() => {
    if (!open) return;
    setDraft(category ? { ...category } : blank());
    setSourceKey(category ? (CUSTOM_SOURCES.find((s) => JSON.stringify(s.source) === JSON.stringify(category.search))?.key ?? 'none') : 'none');
    setConfirmDelete(false);
    setMoveTo('');
  }, [open, category]);

  const set = (patch: Partial<Category>) => setDraft((d) => ({ ...d, ...patch }));
  const builtIn = !!category?.builtIn;

  const save = async () => {
    const name = draft.name.trim();
    if (!name) return;
    if (isNew) {
      let id = slugify(name);
      while (getCategory(id).builtIn || (await db.categories.get(id))) id = `${slugify(name)}-${Math.random().toString(36).slice(2, 5)}`;
      await saveCategory({
        ...draft,
        id,
        name,
        plural: draft.plural.trim() || guessPlural(name),
        search: CUSTOM_SOURCES.find((s) => s.key === sourceKey)?.source,
        custom: true,
        order: 1000 + Date.now() / 1e10,
      });
      toast(`Added ${draft.emoji} ${name}`);
    } else if (builtIn) {
      await saveCategory({ id: draft.id, name, plural: draft.plural.trim() || name, emoji: draft.emoji, color: draft.color });
    } else {
      await saveCategory({
        ...draft,
        name,
        plural: draft.plural.trim() || guessPlural(name),
        search: CUSTOM_SOURCES.find((s) => s.key === sourceKey)?.source,
        custom: true,
      });
    }
    onClose();
  };

  const remove = async () => {
    if (!category) return;
    await db.transaction('rw', [db.categories, db.media, db.logs, db.episodes, db.lists], async () => {
      const items = await db.media.where('type').equals(category.id).toArray();
      if (moveTo) {
        await db.media.bulkPut(items.map((m) => ({ ...m, type: moveTo })));
      } else {
        const ids = items.map((m) => m.id);
        const gone = new Set(ids);
        await db.logs.bulkDelete((await db.logs.toArray()).filter((l) => gone.has(l.mediaId)).map((l) => l.id));
        await db.episodes.bulkDelete((await db.episodes.toArray()).filter((e) => gone.has(e.mediaId)).map((e) => e.id));
        await db.media.bulkDelete(ids);
        const lists = (await db.lists.toArray()).filter((l) => l.items.some((x) => gone.has(x)));
        await db.lists.bulkPut(lists.map((l) => ({ ...l, items: l.items.filter((x) => !gone.has(x)) })));
      }
      await db.categories.delete(category.id);
    });
    toast(`Deleted ${category.name}`);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={isNew ? 'New category' : `Edit ${category!.name}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl text-3xl" style={{ background: `color-mix(in srgb, var(--c-${draft.color}) 18%, transparent)` }}>
            {draft.emoji}
          </span>
          <div className="grid flex-1 grid-cols-2 gap-2">
            <Field label="Name">
              <input className="field" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Cooking class" autoFocus={isNew} />
            </Field>
            <Field label="Plural">
              <input className="field" value={draft.plural} onChange={(e) => set({ plural: e.target.value })} placeholder={guessPlural(draft.name)} />
            </Field>
          </div>
        </div>

        <Field label="Icon">
          <div className="flex flex-wrap gap-1">
            {EMOJI.map((e) => (
              <button key={e} onClick={() => set({ emoji: e })} className={`rounded-lg p-1.5 text-lg ${draft.emoji === e ? 'bg-surface-2 ring-2 ring-accent' : ''}`}>
                {e}
              </button>
            ))}
            <input
              className="field w-16! text-center"
              maxLength={4}
              placeholder="Any"
              aria-label="Type any emoji"
              onChange={(e) => e.target.value.trim() && set({ emoji: e.target.value.trim() })}
            />
          </div>
        </Field>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => set({ color: c as ColorKey })}
                aria-label={c}
                className={`size-8 rounded-full ${draft.color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`}
                style={{ background: `var(--c-${c})` }}
              />
            ))}
          </div>
        </Field>

        {builtIn ? (
          <p className="text-xs text-muted">
            Built-in category · tracked as <span className="font-semibold">{TRACK_INFO[draft.track].label.toLowerCase()}</span>. You can rename it, change its look, or hide it.
          </p>
        ) : (
          <>
            <Field label="How do you track it?">
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TRACK_INFO) as Track[]).map((t) => (
                  <button
                    key={t}
                    disabled={!isNew && !!count}
                    onClick={() => set({ track: t, unit: t === 'progress' ? (draft.unit ?? 'page') : draft.unit })}
                    className={`rounded-xl p-2.5 text-left ring-1 disabled:opacity-50 ${draft.track === t ? 'bg-surface-2 ring-2 ring-accent' : 'ring-line'}`}
                  >
                    <span className="block text-sm font-semibold">{TRACK_INFO[t].label}</span>
                    <span className="block text-xs text-muted">{TRACK_INFO[t].hint}</span>
                  </button>
                ))}
              </div>
              {!isNew && !!count && <span className="mt-1 block text-xs text-muted">Locked because this category has titles in it.</span>}
            </Field>

            {draft.track === 'progress' && (
              <Field label="What do you count?" hint="Singular, e.g. page, chapter, lesson">
                <input className="field" value={draft.unit ?? ''} onChange={(e) => set({ unit: e.target.value.trim().toLowerCase() || undefined })} />
                <div className="mt-2 flex flex-wrap gap-1">
                  {UNIT_SUGGESTIONS.map((u) => (
                    <button key={u} onClick={() => set({ unit: u })} className={`rounded-lg px-2 py-0.5 text-xs font-medium ${draft.unit === u ? 'bg-accent text-on-accent' : 'bg-surface-2'}`}>
                      {u}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label="What do you do with it?" hint="Used for wording like “Watched”, “Went to”, “Want to play”.">
              <div className="flex flex-wrap gap-1">
                {VERB_OPTIONS.map((v) => (
                  <button key={v} onClick={() => set({ verb: v })} className={`rounded-lg px-2.5 py-1 text-sm font-medium ${draft.verb === v ? 'bg-accent text-on-accent' : 'bg-surface-2'}`}>
                    {VERB_LABEL[v]}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Search database">
              <select className="field" value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
                {CUSTOM_SOURCES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="People behind it (optional)" hint="Shown on the edit page, e.g. Chef, Host, Artist">
              <input className="field" value={draft.creatorLabel ?? ''} onChange={(e) => set({ creatorLabel: e.target.value || undefined })} />
            </Field>
          </>
        )}

        <Button className="w-full" onClick={save} disabled={!draft.name.trim()}>
          {isNew ? 'Create category' : 'Save'}
        </Button>

        {category && !builtIn && (
          <div className="border-t border-line pt-4">
            {confirmDelete ? (
              <div className="space-y-3 rounded-2xl bg-red-500/10 p-3">
                {count ? (
                  <>
                    <p className="text-sm font-semibold">
                      {category.name} has {count} {count === 1 ? 'title' : 'titles'}. What should happen to them?
                    </p>
                    <select className="field" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                      <option value="">Delete them and their history</option>
                      {all
                        .filter((c) => c.id !== category.id && c.track === category.track)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            Move them to {c.emoji} {c.name}
                          </option>
                        ))}
                    </select>
                  </>
                ) : (
                  <p className="text-sm font-semibold">Delete {category.name}?</p>
                )}
                <div className="flex gap-2">
                  <Button variant="soft" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </Button>
                  <Button variant="danger" onClick={remove}>
                    Delete category
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete category
              </Button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function blank(): Category {
  return { id: '', name: '', plural: '', emoji: '✨', color: 'violet', track: 'once', verb: 'do' };
}
