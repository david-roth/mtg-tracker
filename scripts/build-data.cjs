// Rebuild the bundled data files from Scryfall + MTGJSON.
//
//   sets-data.js         every paper set (Scryfall /sets)
//   secret-lair-data.js  every Secret Lair drop / deck with its card list (MTGJSON decks)
//
// Usage: node scripts/build-data.cjs
// Runs weekly from .github/workflows/refresh-data.yml. Needs Node 18+ (global fetch), no deps.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const UA = { "User-Agent": "mtg-tracker-data-refresh/1.0", Accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(1000 * i);
    }
  }
}

// ---------- sets ----------
async function buildSets() {
  const d = await getJSON("https://api.scryfall.com/sets");
  const sets = d.data
    .filter((s) => !s.digital)
    .map((s) => ({
      code: s.code,
      name: s.name,
      type: s.set_type,
      released: s.released_at || null,
      count: s.card_count,
      icon: s.icon_svg_uri,
      parent: s.parent_set_code || null,
      nonfoil_only: !!s.nonfoil_only,
      foil_only: !!s.foil_only,
    }));
  if (sets.length < 900) throw new Error("Suspiciously few sets from Scryfall: " + sets.length);
  return sets;
}

// ---------- Secret Lair ----------
const SL_CODES = new Set(["SLD", "SLC", "SLU", "SLP"]);
const FOIL_EDITION = /\s+Foil Edition$/i;
// "Alien Auroras Galaxy Foil Edition" -> "Alien Auroras" when that drop exists
const FOIL_VARIANT = /\s+[\w-]+\s+Foil Edition$/i;

function kindOf(deck) {
  if (deck.type === "Commander Deck") return "commander";
  if (deck.code === "SLC") return "countdown";
  if (deck.code === "SLU") return "ultimate";
  return "drop";
}

function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}

async function buildSecretLair() {
  const list = (await getJSON("https://mtgjson.com/api/v5/DeckList.json")).data;
  const wanted = list.filter((x) => SL_CODES.has(x.code) || x.type === "Secret Lair Drop");
  console.log("Secret Lair decks in MTGJSON:", wanted.length);

  // fetch each deck file with a small worker pool
  const results = new Array(wanted.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < wanted.length) {
      const i = next++;
      const entry = wanted[i];
      try {
        const deck = (await getJSON("https://mtgjson.com/api/v5/decks/" + encodeURIComponent(entry.fileName) + ".json")).data;
        results[i] = { entry, deck };
      } catch (e) {
        console.warn("  skip", entry.fileName, "-", e.message);
      }
      if (++done % 100 === 0) console.log("  fetched", done, "/", wanted.length);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  // merge "<name> [Galaxy] Foil Edition" into its base drop (same cards, foil finish)
  const names = new Set(wanted.map((x) => x.name));
  function baseName(name) {
    if (!FOIL_EDITION.test(name)) return name;
    const plain = name.replace(FOIL_EDITION, "");
    if (names.has(plain)) return plain;
    const variant = name.replace(FOIL_VARIANT, "");
    return names.has(variant) ? variant : plain;
  }
  const byName = new Map();
  for (const r of results) {
    if (!r) continue;
    const { entry, deck } = r;
    const isFoilEd = FOIL_EDITION.test(entry.name);
    const base = baseName(entry.name);
    let drop = byName.get(base);
    if (!drop) {
      drop = {
        id: slugify(base),
        name: base,
        kind: kindOf(entry),
        released: entry.releaseDate || deck.releaseDate || null,
        foil_edition: false,
        cards: [],
        _seen: new Set(),
      };
      byName.set(base, drop);
    }
    if (isFoilEd) drop.foil_edition = true;
    else if (entry.releaseDate) drop.released = entry.releaseDate;
    if (entry.type === "Commander Deck") drop.kind = "commander";

    const boards = [deck.commander, deck.displayCommander, deck.mainBoard, deck.sideBoard];
    for (const board of boards) {
      for (const c of board || []) {
        const sid = c.identifiers && c.identifiers.scryfallId;
        if (!sid || drop._seen.has(sid)) continue;
        drop._seen.add(sid);
        // [scryfall id, set code, name]
        drop.cards.push([sid, (c.setCode || "").toLowerCase(), c.name]);
      }
    }
  }

  // unique ids (two drops can slug the same)
  const drops = [];
  const ids = new Set();
  for (const d of byName.values()) {
    if (!d.cards.length) continue;
    let id = d.id, n = 2;
    while (ids.has(id)) id = d.id + "-" + n++;
    ids.add(id);
    delete d._seen;
    drops.push({ ...d, id });
  }
  drops.sort((a, b) => (b.released || "").localeCompare(a.released || "") || a.name.localeCompare(b.name));
  if (drops.length < 300) throw new Error("Suspiciously few Secret Lair drops: " + drops.length);
  return drops;
}

function writeData(file, varName, obj) {
  const out = "window." + varName + "=" + JSON.stringify(obj) + ";";
  fs.writeFileSync(path.join(ROOT, file), out);
  console.log("Wrote", file, (out.length / 1024).toFixed(0) + " KB");
}

(async function main() {
  const sets = await buildSets();
  writeData("sets-data.js", "SET_DATA", { count: sets.length, sets });

  const drops = await buildSecretLair();
  writeData("secret-lair-data.js", "SECRET_LAIR", { count: drops.length, drops });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
