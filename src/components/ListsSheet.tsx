import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { createList, db, newestFirst, toggleInList } from '../db';
import type { Media } from '../types';
import { Button, Icon, Sheet } from './ui';

export const LIST_EMOJI = ['📌', '❤️', '🍿', '📚', '🎮', '🛋️', '🌙', '☀️', '🎄', '👻', '🔥', '🏆', '😂', '😭', '✈️', '🧠'];

/** Tick which of your lists this title belongs to, or make a new one. */
export function ListsSheet({ media, open, onClose }: { media: Media; open: boolean; onClose: () => void }) {
  const lists = useLiveQuery(() => db.lists.toArray().then(newestFirst), []);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(LIST_EMOJI[0]);

  const create = async () => {
    if (!name.trim()) return;
    const list = await createList(name, emoji);
    await toggleInList(list.id, media.id);
    setName('');
  };

  return (
    <Sheet open={open} onClose={onClose} title="Lists">
      <div className="space-y-1">
        {lists?.length === 0 && <p className="pb-2 text-sm text-muted">No lists yet. Make one below, like “Comfort shows” or “Summer reading”.</p>}
        {lists?.map((l) => {
          const on = l.items.includes(media.id);
          return (
            <button key={l.id} onClick={() => toggleInList(l.id, media.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
              <span className="text-xl">{l.emoji ?? '📌'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{l.name}</span>
                <span className="text-xs text-muted">{l.items.length} titles</span>
              </span>
              <span className={`flex size-6 items-center justify-center rounded-full border-2 ${on ? 'border-accent bg-accent text-on-accent' : 'border-line text-transparent'}`}>
                <Icon name="check" className="size-3.5" strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">New list</p>
        <div className="no-scrollbar mb-2 flex gap-1 overflow-x-auto">
          {LIST_EMOJI.map((e) => (
            <button key={e} onClick={() => setEmoji(e)} className={`shrink-0 rounded-lg p-1.5 text-lg ${emoji === e ? 'bg-surface-2 ring-2 ring-accent' : ''}`}>
              {e}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="List name" />
          <Button type="submit" disabled={!name.trim()} className="shrink-0">
            Create
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
