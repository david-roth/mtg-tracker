// Ingest Card Kingdom retail prices from MTGJSON into the Supabase `prices`
// table, keyed by Scryfall card id.
//
// Usage: node scripts/ingest-ck-prices.mjs <AllPricesToday.json> <AllIdentifiers.json>
// Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// AllPricesToday.json is small (~50MB) and loaded fully. AllIdentifiers.json
// is large (~1.5GB) so it is streamed to map MTGJSON uuid -> Scryfall id.

import fs from "node:fs";
import { chain } from "stream-chain";
import { parser } from "stream-json";
import Pick from "stream-json/filters/Pick.js";
import StreamObject from "stream-json/streamers/StreamObject.js";

const [, , PRICES_FILE, IDS_FILE] = process.argv;
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!PRICES_FILE || !IDS_FILE) { console.error("Usage: node ingest-ck-prices.mjs <prices.json> <ids.json>"); process.exit(1); }
if (!SUPABASE_URL || !KEY) { console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const firstVal = (o) => (o && typeof o === "object" ? Object.values(o)[0] : undefined);

// 1) Load CK retail prices keyed by MTGJSON uuid
console.log("Reading prices:", PRICES_FILE);
const pricesDoc = JSON.parse(fs.readFileSync(PRICES_FILE, "utf8"));
const priceData = pricesDoc.data || pricesDoc;
const ckByUuid = new Map();
for (const uuid of Object.keys(priceData)) {
  const ck = priceData[uuid]?.paper?.cardkingdom?.retail;
  if (!ck) continue;
  const normal = firstVal(ck.normal);
  const foil = firstVal(ck.foil);
  if (normal == null && foil == null) continue;
  ckByUuid.set(uuid, { n: normal ?? null, f: foil ?? null });
}
console.log("Cards with CK retail:", ckByUuid.size);

// 2) Stream identifiers, map uuid -> scryfallId, build rows for priced cards
console.log("Streaming identifiers:", IDS_FILE);
const rows = [];
let seen = 0;
await new Promise((resolve, reject) => {
  const pipeline = chain([
    fs.createReadStream(IDS_FILE),
    parser(),
    new Pick({ filter: "data" }),
    new StreamObject(),
  ]);
  pipeline.on("data", ({ key: uuid, value }) => {
    seen++;
    const ck = ckByUuid.get(uuid);
    if (!ck) return;
    const sid = value?.identifiers?.scryfallId;
    if (!sid) return;
    rows.push({ card_id: sid, ck_normal: ck.n, ck_foil: ck.f });
  });
  pipeline.on("end", resolve);
  pipeline.on("error", reject);
});
console.log("Scanned identifiers:", seen, "| matched rows:", rows.length);

// 3) Batch upsert into Supabase
const now = new Date().toISOString();
const BATCH = 1000;
let done = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH).map((r) => ({ ...r, updated_at: now }));
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/prices", {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (res.ok) { ok = true; }
    else {
      const t = await res.text();
      console.error("Batch", i, "attempt", attempt, res.status, t.slice(0, 200));
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!ok) { console.error("Giving up at batch", i); process.exit(1); }
  done += batch.length;
  if (done % 10000 < BATCH) console.log("Upserted", done, "/", rows.length);
}
console.log("Done. Upserted", done, "price rows.");
