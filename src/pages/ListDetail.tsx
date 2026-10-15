import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db, newestFirst, toggleInList } from '../db';
import type { Media, MediaList } from '../types';
import { toast } from '../lib/toast';
import { Button, Cover, Empty, Icon, Sheet, TypeBadge } from '../components/ui';
import { LIST_EMOJI } from '../components/ListsSheet';

export default function ListDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useLiveQuery(async () => {
    const list = await db.lists.get(id!);
    if (!list) return { list: null, items: [] as Media[] };
    const items = (await db.media.bulkGet(list.items)).filter(Boolean) as Media[];
    return { list, items };
  }, [id]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!data) return null;
  const { list, items } = data;
  if (!list)
    return (
      <div className="py-20 text-center text-muted">
        This list was deleted.{' '}
        <Link to="/library?view=lists" className="font-semibold text-accent">
          Back to lists
        </Link>
      </div>
    );

  const save = (patch: Partial<MediaList>) => db.lists.update(list.id, { ...patch, updatedAt: Date.now() });
  const move = (i: number, dir: -1 | 1) => {
    const next = [...list.items];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    save({ items: next });
  };
  const remove = (m: Media) => {
    const at = list.items.indexOf(m.id);
    toggleInList(list.id, m.id);
    // Undo puts back just this title, where it was (other removals since then stay removed).
    toast(`Removed ${m.title}`, {
      label: 'Undo',
      run: async () => {
        const current = await db.lists.get(list.id);
        if (!current || current.items.includes(m.id)) return;
        const items = [...current.items];
        items.splice(Math.min(at, items.length), 0, m.id);
        await save({ items });
      },
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate('/library?view=lists')} className="-ml-2 flex items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold text-accent">
          <Icon name="back" className="size-5" />
          Lists
        </button>
        <button onClick={() => setEditing(!editing)} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold">
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <div className="mb-6 space-y-3 rounded-3xl bg-surface p-4">
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {LIST_EMOJI.map((e) => (
              <button key={e} onClick={() => save({ emoji: e })} className={`shrink-0 rounded-lg p-1.5 text-lg ${list.emoji === e ? 'bg-surface-2 ring-2 ring-accent' : ''}`}>
                {e}
              </button>
            ))}
          </div>
          <input className="field text-lg! font-semibold" defaultValue={list.name} onBlur={(e) => e.target.value.trim() && save({ name: e.target.value.trim() })} />
          <textarea
            className="field min-h-16"
            defaultValue={list.description}
            placeholder="What's this list for? (optional)"
            onBlur={(e) => save({ description: e.target.value.trim() || undefined })}
          />
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm">Delete this list? The titles stay in your library.</span>
              <Button variant="soft" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await db.lists.delete(list.id);
                  navigate('/library?view=lists', { replace: true });
                }}
              >
                Delete
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" className="size-4" /> Delete list
            </Button>
          )}
        </div>
      ) : (
        <header className="mb-6">
          <h1 className="display text-[2.75rem]">
            {list.emoji} {list.name}
          </h1>
          {list.description && <p className="mt-1 text-muted">{list.description}</p>}
          <p className="mt-1 text-sm text-muted">{items.length} titles</p>
        </header>
      )}

      <Button variant="soft" className="mb-4" onClick={() => setAdding(true)}>
        <Icon name="plus" className="size-4" /> Add from your library
      </Button>

      {items.length === 0 ? (
        <Empty title="This list is empty">Add titles from your library, or use “Add to list” on any title’s page.</Empty>
      ) : (
        <div className="space-y-2">
          {items.map((m, i) => (
            <div key={m.id} className="flex items-center gap-3 rounded-3xl bg-surface p-2">
              <span className="w-6 text-center text-sm font-semibold text-muted">{i + 1}</span>
              <Link to={`/m/${m.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Cover src={m.cover} title={m.title} type={m.type} className="h-16 w-11 shrink-0 rounded-md" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{m.title}</span>
                  <TypeBadge type={m.type} />
                </span>
              </Link>
              {editing && (
                <span className="flex items-center">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 text-muted disabled:opacity-30" aria-label="Move up">
                    <Icon name="up" className="size-4" />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="p-1.5 text-muted disabled:opacity-30" aria-label="Move down">
                    <Icon name="down" className="size-4" />
                  </button>
                  <button onClick={() => remove(m)} className="p-1.5 text-red-500" aria-label={`Remove ${m.title}`}>
                    <Icon name="close" className="size-4" />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <AddFromLibrary list={list} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddFromLibrary({ list, open, onClose }: { list: MediaList; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const all = useLiveQuery(() => db.media.toArray().then(newestFirst), []);
  const needle = q.trim().toLowerCase();
  const shown = (all ?? []).filter((m) => !needle || m.title.toLowerCase().includes(needle)).slice(0, 60);
  return (
    <Sheet open={open} onClose={onClose} title={`Add to ${list.name}`}>
      <input className="field mb-3" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter your library" autoFocus />
      <div className="space-y-1">
        {shown.map((m) => {
          const on = list.items.includes(m.id);
          return (
            <button key={m.id} onClick={() => toggleInList(list.id, m.id)} className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left hover:bg-surface-2">
              <Cover src={m.cover} title={m.title} type={m.type} className="h-12 w-8 shrink-0 rounded" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.title}</span>
              <span className={`flex size-6 items-center justify-center rounded-full border-2 ${on ? 'border-accent bg-accent text-on-accent' : 'border-line text-transparent'}`}>
                <Icon name="check" className="size-3.5" strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
