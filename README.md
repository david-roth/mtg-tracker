# The Hobbit — MTG Set Tracker

A single-page web app for tracking your Magic: The Gathering **The Hobbit** (`hob`) collection,
inspired by the card-grid layout of collection sites like TCG Collector.

![Set](https://img.shields.io/badge/set-The%20Hobbit%20(hob)-c9a24b) ![Cards](https://img.shields.io/badge/cards-321-4caf7d)

## Features

- **Full set as an image grid** — all 321 cards of The Hobbit, with real art from [Scryfall](https://scryfall.com).
- **Foil & non-foil tracking** — check each finish independently on every card, with a distinct
  obtained icon (green ✓ for non-foil, a shimmering gold ✦ for foil). Foil-only cards show just the foil toggle.
- **Per-finish prices** — each card shows its non-foil and foil market price; the header totals your
  collection value from the exact finishes you own.
- **Progress & filters** — completion %, separate non-foil / foil counts, plus filters by rarity,
  "In collection", "Foils", and "Missing", search, and sorting (number / name / rarity / value).
- **Detail view** — click a card's art for a large view with both prices and toggle buttons.
- **Saved locally** — your collection persists in the browser via `localStorage`; nothing is uploaded.

## Running it

It's plain HTML/CSS/JS with no build step. The card data is bundled locally (`cards-data.js`),
so you can just open `index.html` — or serve the folder to avoid any browser file:// quirks:

```bash
python -m http.server 8731
```

Then visit <http://localhost:8731/index.html>.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Styling (dark theme, foil shimmer) |
| `app.js` | Rendering, filtering, ownership/price logic |
| `cards-data.js` | Bundled card data (embedded for offline use) |
| `cards.json` | Same data as raw JSON |

## Data

Card data and images are sourced from the [Scryfall API](https://scryfall.com/docs/api).
Prices are Scryfall's USD market prices at the time the data was fetched. Card names, images,
and Magic: The Gathering are property of Wizards of the Coast; this is an unofficial fan tool.
