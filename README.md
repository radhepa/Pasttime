# Pastime

Track everything you watch, read, play, listen to, and go to, with a day-by-day timeline of what you did.

## Features

- **Categories for everything:** shows, movies, books, games, anime, manga, light novels, comics, podcasts, audiobooks, albums, documentaries, theater, concerts, board games, magazines, articles, videos, courses, museums and sports.
  - **Your own categories:** make any category you like and choose how it's tracked: by episode, one-time, progress (pages, chapters, lessons, or any unit you name), or time spent.
  - **Hide what you don't use:** hide, reorder, rename or recolor any category to keep things tidy.
- **Smart search, free and with no account:**
  - **TVmaze:** shows, with every episode.
  - **Open Library:** books, with page counts.
  - **Wikipedia:** movies, games, theater, comics, museums and more.
  - **AniList:** anime, manga and light novels.
  - **Apple:** podcasts and audiobooks.
  - **MusicBrainz:** albums.
  - **Optional upgrades:** free TMDB and RAWG keys give richer movie and game results.
- **Timeline:**
  - **Any day:** see exactly what you did, like "Read 15 pages (135 → 150)", "Watched 3 episodes" or "Went to a concert".
  - **Week and month views:** a week strip, plus a month calendar shaded by how much you did each day.
  - **Streaks:** counts how many days in a row you've logged something.
  - **Continue row:** log the next episode or session with one tap.
- **Ratings:**
  - **Episodes:** rate each one 1–5 stars. Season averages roll up into the show's overall rating, averaged by season or by episode (your choice).
  - **Everything else:** rate any other title directly.
- **Stats:**
  - **Time spent:** your total hours, plus hours per month.
  - **Breakdowns:** hours and titles by category.
  - **Activity:** a heatmap of the days you were active.
  - **Ratings:** how your ratings are spread out, and your top-rated titles.
  - **Yearly goals:** set a target per category and track it.
- **Lists:** make your own collections, like "Comfort shows" or "Books for the beach".
- **Timer:** start it when you begin reading or playing; it keeps running if you close the app. Stopping it fills in the minutes.
- **Your notes:** write your thoughts on any title. You can edit or delete any entry, with undo.
- **Bring your history:** import CSV exports from Goodreads and Letterboxd. "Fill in missing covers" looks up artwork for imported titles.
- **Syncs between phone and computer:** sign in under Settings → Sync and every device shares one private library. Changes show up live.
- **Works offline:** your data lives on your device first, and cover art is cached. Search falls back to your own library when you're offline.
- **Light or dark:** match your device, or pick one.
- **Installs on iPhone and desktop:** in Safari, use "Add to Home Screen"; in Chrome or Edge, click Install.

## Run it

```bash
npm install
npm run dev
```

`npm run build` creates the installable app in `dist/`. Deploy it to any static host, such as Vercel or GitHub Pages.

Your data is stored on the device (IndexedDB) and, once you sign in, mirrored to a private Supabase table (`pastime_rows`) that only your account can read (row-level security). `src/lib/sync.ts` has the details; `npm test` runs a two-device sync simulation. Settings → Export / Restore backup still works as a manual backup.
