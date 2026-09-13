# MTG Set Tracker

A web app for tracking your Magic: The Gathering collection across **every set**, inspired by the
card-grid layout of collection sites like TCG Collector. Browse all sets on a main page, click one,
and track which cards you own — non-foil and foil, independently.

![Sets](https://img.shields.io/badge/sets-988%20paper-c9a24b) ![Data](https://img.shields.io/badge/data-Scryfall-4caf7d)

## How it works

- **Main page (`index.html`)** — a searchable, filterable grid of all ~988 paper MTG sets
  (icon, code, type, release date, card count) with your per-set completion progress.
- **Set tracker (`set.html?code=<code>`)** — opens the tracker for one set. Card data and images
  are fetched live from the [Scryfall API](https://scryfall.com/docs/api) on demand and cached in the
  browser for a week, so revisits are instant.

## Features

- **Every set in one place** — search by name/code, filter by type, filter to sets you've started,
  and sort by release date, name, card count, or your progress.
- **Foil & non-foil tracking** — check each finish independently on every card, with a distinct
  obtained icon (green ✓ for non-foil, a shimmering gold ✦ for foil). Foil-only cards show just the
  foil toggle.
- **Per-finish prices** — each card shows its non-foil and foil market price; the header totals your
  collection value from the exact finishes you own.
- **Progress & filters** — completion %, separate non-foil / foil counts, filters by rarity,
  "In collection", "Foils", and "Missing", card search, and sorting.
- **Detail view** — click a card's art for a large view with both prices and toggle buttons.
- **Saved locally** — your collection persists in the browser via `localStorage`; nothing is uploaded.
  Progress carries across the two pages.

## Running it

Plain HTML/CSS/JS, no build step. The set tracker fetches card data at runtime, so it needs to run
over HTTP (not `file://`). Serve the folder:

```bash
python -m http.server 8731
```

Then visit <http://localhost:8731/index.html>.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Main page — the set list |
| `sets-app.js` | Set-list rendering, search/filter/sort, per-set progress |
| `sets-data.js` | Bundled list of all paper sets (from Scryfall) |
| `set.html` | Per-set tracker page |
| `app.js` | Tracker: fetches a set's cards, ownership/price logic, filters |
| `styles.css` | Styling (dark theme, foil shimmer) |

## Data

Set list, card data, images, and prices come from the [Scryfall API](https://scryfall.com/docs/api).
Prices are Scryfall's USD market prices. Card names, images, and Magic: The Gathering are property of
Wizards of the Coast; this is an unofficial fan tool.
