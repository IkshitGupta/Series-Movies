# 🎬 MoviesSeriesHub

A local-first mobile app to **track the movies & TV shows you've watched** and maintain a **"To Watch"** list. Search titles from [TMDB](https://www.themoviedb.org), mark movies as watched, and track TV shows **episode by episode** with a live progress bar — all stored on-device, no account required.

Built as a modern, cross-platform (iOS + Android) React Native app.

---

## ✨ Features

- 🔎 **Search** movies & TV shows via TMDB (posters, ratings, cast, genres).
- ✅ **Mark movies watched** with a single tap.
- 📺 **Per-episode TV tracking** — tick individual episodes, "mark all" a season, mark the **whole series** watched, or tap **↑ to mark everything up to an episode** (including previous seasons). Live progress bar.
- 🔖 **"To Watch" watchlist** split into **Movies** and **TV Series** tabs. Items already watched or categorized no longer offer a "to watch" option.
- 🏷️ **TV show status** — *Watching* and *Completed* are auto-derived from episode progress; for a show you're still watching you can manually mark it **Stopped watching** or **Continue later** (these options are hidden once a show is completed). Manual flags don't affect stats and auto-clear the moment you watch another episode.
- 🗂️ **Separate Movies and Series tabs** — watched movies in one tab; series split into **4 views** with counts: *Watching · Completed · Stopped watching · Continue later*.
- 📊 **Stats** — totals, **total watch time**, and a per-genre breakdown, tracked separately for movies and TV shows. Tap any genre to see the titles in it.
- 🎭 **Genres** shown on both movie and TV detail screens.
- 🌓 **Dark mode** that follows your system theme.
- 💾 **Offline-first** — your data lives on the device via MMKV. No sign-in.

---

## 📸 Screenshots

| Search | Live results | Per-episode tracking | Stats |
|---|---|---|---|
| ![Search](docs/screenshots/search.png) | ![Results](docs/screenshots/search-results.png) | ![Show detail](docs/screenshots/show-detail.png) | ![Stats](docs/screenshots/stats.png) |

---

## 🧱 Tech Stack

| Concern | Choice |
|---|---|
| Framework | [Expo](https://expo.dev) (SDK 56) + React Native + TypeScript |
| Architecture | React Native **New Architecture** (Fabric / TurboModules) + React Compiler |
| Routing | [Expo Router](https://docs.expo.dev/router/introduction/) (file-based, typed routes) |
| Data fetching | [TanStack Query](https://tanstack.com/query) (caching, loading/error states) |
| App state | [Zustand](https://github.com/pmndrs/zustand) |
| Persistence | [react-native-mmkv](https://github.com/mrousavy/react-native-mmkv) via a Zustand `persist` adapter |
| Styling | [NativeWind](https://www.nativewind.dev) (Tailwind CSS for RN) |
| Data source | [TMDB API](https://developer.themoviedb.org) |
| Builds | [EAS Build](https://docs.expo.dev/build/introduction/) + Expo Dev Client |

---

## 🚀 Getting Started

### 1. Prerequisites

- [Node.js](https://nodejs.org) 20+ and npm
- An [Expo account](https://expo.dev/signup) + the EAS CLI for device builds: `npm i -g eas-cli`
- **Android:** Android Studio (works on Windows/macOS/Linux)
- **iOS:** built in the cloud with **EAS Build** — no Mac required

### 2. Install dependencies

```bash
npm install
```

### 3. Add your (free) TMDB API key

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to **Settings → API** and request an **API Key (v3 auth)**.
3. Copy the example env file and paste your key:

```bash
cp .env.example .env
```

```dotenv
# .env
EXPO_PUBLIC_TMDB_API_KEY=your_tmdb_v3_api_key_here
```

> The app runs without a key, but Search will prompt you to add one.

### 4. Run it

Because this app uses native modules (MMKV) and the New Architecture, it runs in a **custom Dev Client**, not Expo Go.

**Android (locally, incl. on Windows):**

```bash
npm run android      # builds & installs a dev build, then starts Metro
```

**iOS (via EAS cloud build — no Mac needed):**

```bash
eas login
eas build --profile development --platform ios
# Install the resulting build on your device / TestFlight, then:
npm start            # start the dev server and open it in the dev client
```

**Start the dev server for an already-installed dev client:**

```bash
npm start            # expo start --dev-client
```

> **Bonus — run in a browser (no emulator needed):** `npm run web` starts a web build (handy for quick demos and screenshots). On web, storage falls back to `localStorage` since MMKV is native-only; iOS/Android behaviour is unchanged.

---

## 📦 Building for Distribution

Build profiles live in [`eas.json`](./eas.json):

```bash
eas build --profile preview    --platform android   # shareable internal build
eas build --profile production  --platform all       # store-ready builds
```

---

## 🗂️ Project Structure

```
src/
  app/                     # Expo Router routes
    _layout.tsx            # providers (QueryClient, theme) + root stack
    (tabs)/
      _layout.tsx          # bottom tabs: Search · Watchlist · Movies · Series · Stats
      index.tsx            # Search
      watchlist.tsx        # single "To Watch" list
      movies.tsx           # watched movies
      series.tsx           # tracked series (4 views)
      stats.tsx            # totals + genre breakdown
    movie/[id].tsx         # movie detail + watched toggle
    show/[id].tsx          # show detail + per-episode tracking
  api/
    tmdb.ts                # typed fetch client
    queries.ts             # TanStack Query hooks
  store/
    useLibraryStore.ts     # Zustand store (watchlist, watched, tracked shows)
    storage.ts             # MMKV adapter for Zustand persist
  components/              # PosterImage, MediaCard, EpisodeRow, etc. (NativeWind)
  lib/                     # image URLs, normalization, hooks
  types/                   # domain + TMDB types
```

---

## 🧑‍💻 Scripts

| Command | Description |
|---|---|
| `npm start` | Start the Expo dev server (dev client) |
| `npm run android` | Build & run a dev build on Android |
| `npm run ios` | Build & run a dev build on iOS (macOS) |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | Type-check with TypeScript |
| `npm run format` | Format with Prettier |

---

## 🔮 Roadmap Ideas

- Optional cloud sync of watch history (e.g. via [Trakt](https://trakt.tv)).
- Filtering / sorting the library; "continue watching" shelf.
- Home-screen widgets and share extensions.

---

## 🧠 Implementation Notes

- **NativeWind + New Architecture:** interactive components toggle dynamic styles via the
  `style` prop with a **static** `className` (see the Watched segmented control, season chips,
  and the movie "Mark watched" button). On Expo SDK 56 / RN New Arch, changing a `Pressable`'s
  `className` string on re-render can throw a spurious "navigation context" error, so dynamic
  values are kept in `style`.
- **React Compiler** (`experiments.reactCompiler`) is disabled — it's still experimental and
  altered render behavior during development.

---

## 📝 Attribution

This product uses the **TMDB API** but is **not endorsed or certified by TMDB**.
Movie and TV data and images are provided by [The Movie Database (TMDB)](https://www.themoviedb.org).

---

## 📄 License

See [LICENSE](./LICENSE).
# Series-Movies
