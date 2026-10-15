import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, deleteMedia, uid } from '../db';
import type { Episode, Media, Status } from '../types';
import { getCategory, statusLabel, TRACK_INFO, unitPlural, useCategories } from '../lib/categories';
import { Button, Cover, Field, Icon } from '../components/ui';

const STATUSES: Status[] = ['planned', 'active', 'completed', 'paused', 'dropped'];

/** Whole numbers above zero only (no "-50 pages"); `max` keeps years sane. */
const wholeNumber = (v: string, max = Infinity) => {
  const n = Math.round(Number(v));
  return v && n > 0 && n <= max ? n : undefined;
};

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Add something by hand, or fix up any entry that came from a database. */
export default function EditMedia() {
  const { id, type: newType } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [m, setM] = useState<Media>();
  /** The title as it was when the form opened, so Save only writes the fields you changed. */
  const original = useRef<Media>();
  const [creators, setCreators] = useState('');
  const [genres, setGenres] = useState('');
  const [platforms, setPlatforms] = useState('');
  const [seasonPlan, setSeasonPlan] = useState('');
  const [existingEps, setExistingEps] = useState<Episode[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { visible } = useCategories();

  useEffect(() => {
    (async () => {
      let media: Media | undefined;
      if (id) {
        media = await db.media.get(id);
        const eps = await db.episodes.where('mediaId').equals(id).toArray();
        setExistingEps(eps);
        const perSeason = new Map<number, number>();
        eps.forEach((e) => perSeason.set(e.season, Math.max(perSeason.get(e.season) ?? 0, e.number)));
        setSeasonPlan([...perSeason].sort((a, b) => a[0] - b[0]).map(([, n]) => n).join(', '));
      } else {
        const now = Date.now();
        media = {
          id: uid(),
          type: newType ?? 'movie',
          title: params.get('title') ?? '',
          status: 'planned',
          source: 'manual',
          addedAt: now,
          updatedAt: now,
        };
      }
      if (!media) return navigate('/library', { replace: true });
      original.current = media;
      setM(media);
      setCreators(media.creators?.join(', ') ?? '');
      setGenres(media.genres?.join(', ') ?? '');
      setPlatforms(media.platforms?.join(', ') ?? '');
    })();
  }, [id, newType]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m) return null;
  const set = (patch: Partial<Media>) => setM({ ...m, ...patch });
  const isNew = !id;
  const cat = getCategory(m.type);
  const manualEpisodes = cat.track === 'episodes' && m.source !== 'tvmaze' && m.source !== 'anilist';
  const choices = isNew ? visible : visible.filter((c) => c.track === cat.track || c.id === m.type);

  const save = async () => {
    if (!m.title.trim()) return;
    const media: Media = {
      ...m,
      title: m.title.trim(),
      creators: list(creators).length ? list(creators) : undefined,
      genres: list(genres).length ? list(genres) : undefined,
      platforms: list(platforms).length ? list(platforms) : undefined,
      updatedAt: Date.now(),
    };
    if (isNew) await db.media.put(media);
    else {
      // Only what you edited: a description that loaded in the background, or a change synced from
      // another device while this form was open, is kept.
      const before = (original.current ?? {}) as unknown as Record<string, unknown>;
      const changes = Object.fromEntries(
        Object.entries(media).filter(([k, v]) => k !== 'updatedAt' && JSON.stringify(v) !== JSON.stringify(before[k])),
      );
      for (const k of Object.keys(before)) if (!(k in media)) changes[k] = undefined;
      if (Object.keys(changes).length) await db.media.update(media.id, { ...changes, updatedAt: media.updatedAt });
    }
    if (manualEpisodes) {
      // "10, 8, 12" → season 1 has 10 episodes, season 2 has 8… Only adds what's missing.
      const counts = seasonPlan.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => n > 0);
      const have = new Set(existingEps.map((e) => `${e.season}x${e.number}`));
      const add: Episode[] = [];
      counts.forEach((n, i) => {
        for (let ep = 1; ep <= n; ep++)
          if (!have.has(`${i + 1}x${ep}`)) add.push({ id: uid(), mediaId: media.id, season: i + 1, number: ep, title: `Episode ${ep}` });
      });
      if (add.length) await db.episodes.bulkAdd(add);
    }
    // Editing: go back to the title page you came from (so Back afterwards leaves it in one tap).
    if (!isNew && (window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(`/m/${media.id}`, { replace: true });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="-ml-2 flex items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold text-accent">
          <Icon name="back" className="size-5" />
          Cancel
        </button>
        <Button onClick={save} disabled={!m.title.trim()}>
          {isNew ? 'Add to library' : 'Save'}
        </Button>
      </div>
      <h1 className="mb-6 display text-[2.75rem]">{isNew ? `New ${cat.name.toLowerCase()}` : 'Edit details'}</h1>

      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="shrink-0">
          <Cover src={m.cover} title={m.title || '?'} type={m.type} className="mx-auto h-48 w-32 rounded-xl shadow ring-1 ring-line" />
        </div>
        <div className="flex-1 space-y-4">
          <Field label="Category" hint={isNew ? TRACK_INFO[cat.track].hint : 'You can move it to another category that’s tracked the same way.'}>
            <select className="field" value={m.type} onChange={(e) => set({ type: e.target.value })}>
              {!choices.some((c) => c.id === m.type) && <option value={m.type}>{cat.emoji} {cat.name}</option>}
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input className="field" value={m.title} onChange={(e) => set({ title: e.target.value })} autoFocus={isNew} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year">
              <input
                type="number"
                inputMode="numeric"
                className="field"
                value={m.year ?? ''}
                onChange={(e) => set({ year: wholeNumber(e.target.value, 2200) })}
              />
            </Field>
            <Field label="Status">
              <select className="field" value={m.status} onChange={(e) => set({ status: e.target.value as Status })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(cat, s)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {cat.track === 'progress' && (
            <Field label={`Total ${unitPlural(cat)}`} hint="Leave empty if it's ongoing or you don't know.">
              <input
                type="number"
                inputMode="numeric"
                className="field"
                value={m.totalPages ?? ''}
                onChange={(e) => set({ totalPages: wholeNumber(e.target.value) })}
              />
            </Field>
          )}
          {manualEpisodes && (
            <Field label="Episodes per season" hint="e.g. “10, 8, 12” = season 1 has 10 episodes, season 2 has 8… Adding more later keeps what you've watched.">
              <input className="field" value={seasonPlan} onChange={(e) => setSeasonPlan(e.target.value)} placeholder="10, 8, 12" />
            </Field>
          )}
          {cat.track === 'once' && (
            <Field label="Length (minutes)" hint="Used for time-spent stats.">
              <input
                type="number"
                inputMode="numeric"
                className="field"
                value={m.runtime ?? ''}
                onChange={(e) => set({ runtime: wholeNumber(e.target.value) })}
              />
            </Field>
          )}
          <Field label={cat.creatorLabel ? `${cat.creatorLabel}(s)` : 'Made by'} hint="Separate several with commas">
            <input className="field" value={creators} onChange={(e) => setCreators(e.target.value)} />
          </Field>
          {(m.type === 'game' || m.platforms?.length) && (
            <Field label="Platforms">
              <input className="field" value={platforms} onChange={(e) => setPlatforms(e.target.value)} placeholder="PC, Switch" />
            </Field>
          )}
          <Field label="Genres">
            <input className="field" value={genres} onChange={(e) => setGenres(e.target.value)} />
          </Field>
          <Field label="Cover image URL">
            <input className="field" value={m.cover ?? ''} onChange={(e) => set({ cover: e.target.value.trim() || undefined })} placeholder="https://…" />
          </Field>
          <Field label="Description">
            <textarea className="field min-h-28" value={m.overview ?? ''} onChange={(e) => set({ overview: e.target.value || undefined })} />
          </Field>
          <Field label="Private notes">
            <textarea className="field min-h-20" value={m.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
          </Field>

          {!isNew && (
            <div className="border-t border-line pt-6">
              {confirmDelete ? (
                <div className="rounded-2xl bg-red-500/10 p-4">
                  <p className="text-sm font-semibold">Remove {m.title} and everything you've logged for it?</p>
                  <p className="mt-1 text-xs text-muted">Its entries disappear from your timeline too. This can't be undone.</p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="soft" onClick={() => setConfirmDelete(false)}>
                      Keep it
                    </Button>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        await deleteMedia(m.id);
                        navigate('/library', { replace: true });
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" className="size-4" /> Remove from library
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
