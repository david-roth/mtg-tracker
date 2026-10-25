(function () {
  "use strict";

  // ---- which set (or Secret Lair drop)? ----
  // set.html?code=<set>        one Scryfall set
  // set.html?drop=<drop id>    one Secret Lair drop; its cards can span sets (sld, plst, ...)
  //                            and each card is still saved under its own set code
  const params = new URLSearchParams(location.search);
  const DROP_ID = (params.get("drop") || "").trim();
  const CODE = DROP_ID ? "sld" : (params.get("code") || "").toLowerCase().trim();
  const FOCUS_CARD = params.get("card"); // open this card's detail view once loaded
  const storageKey = (code) => "mtg-tracker:" + code;
  const CACHE_KEY = "mtg-cache:v3:" + (DROP_ID ? "drop:" + DROP_ID : CODE); // v3: cards include colors + EUR prices + buy links
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, mythic: 3 };

  // populated after load
  let CARDS = [];
  let META = { code: CODE, name: CODE.toUpperCase(), released: null };
  let TOTAL_VALUE = 0;

  const statusEl = document.getElementById("status");

  // ---- owned state ----
  // { [setCode]: { [cardId]: { n, f } } }. Source is Supabase when signed in, else localStorage.
  // localStorage is always kept as a cache/offline copy.
  let ownedBySet = {};
  let SET_CODES = [CODE]; // sets this page's cards belong to
  const cardSet = {};     // cardId -> set code (drop pages); defaults to CODE
  let DROP = null;
  let useCloud = false;

  const setOf = (id) => cardSet[id] || CODE;
  const ownOf = (id) => ownedBySet[setOf(id)] || {};

  function loadLocal(code) {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey(code)) || "{}");
      if (Array.isArray(raw)) {
        const o = {};
        raw.forEach((id) => (o[id] = { n: true, f: false }));
        return o;
      }
      return raw && typeof raw === "object" ? raw : {};
    } catch (e) {
      return {};
    }
  }
  function saveLocal(code) {
    try {
      localStorage.setItem(storageKey(code), JSON.stringify(ownedBySet[code] || {}));
    } catch (e) {}
  }
  const hasN = (id) => !!(ownOf(id)[id] && ownOf(id)[id].n);
  const hasF = (id) => !!(ownOf(id)[id] && ownOf(id)[id].f);
  const hasAny = (id) => hasN(id) || hasF(id);
  function toggleFinish(id, finish) {
    const code = setOf(id);
    const owned = (ownedBySet[code] = ownedBySet[code] || {});
    const cur = owned[id] || { n: false, f: false };
    cur[finish] = !cur[finish];
    if (!cur.n && !cur.f) delete owned[id];
    else owned[id] = cur;
    saveLocal(code);
    if (useCloud) {
      Promise.resolve(window.MTG.setCard(code, id, cur)).catch(() => {});
    }
  }

  const canN = (c) => (c.finishes || []).includes("nonfoil");
  const canF = (c) => (c.finishes || []).includes("foil");
  const priceN = (c) => parseFloat(c.usd);
  const priceF = (c) => parseFloat(c.usd_foil);
  // Card Kingdom (primary source); falls back to TCGplayer when CK is unknown
  const ckN = (c) => parseFloat(c.ck);
  const ckF = (c) => parseFloat(c.ck_foil);
  const primaryN = (c) => (isNaN(ckN(c)) ? priceN(c) : ckN(c));
  const primaryF = (c) => (isNaN(ckF(c)) ? priceF(c) : ckF(c));

  // ---- filter state ----
  const state = { rarity: "all", color: "all", owned: "all", search: "", sort: "num" };

  function colorMatch(c) {
    if (state.color === "all") return true;
    const cols = c.colors || [];
    if (state.color === "colorless") return cols.length === 0;
    if (state.color === "multi") return cols.length >= 2;
    return cols.indexOf(state.color) !== -1;
  }

  // ---- element refs ----
  const grid = document.getElementById("grid");
  const emptyEl = document.getElementById("empty");
  const searchEl = document.getElementById("search");
  const sortEl = document.getElementById("sort");
  const resultCount = document.getElementById("resultCount");

  function fmt(n) {
    return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function price(n) {
    return isNaN(n) ? "—" : fmt(n);
  }
  function eur(n) {
    n = parseFloat(n);
    return isNaN(n) ? "—" : "€" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Multi-vendor price + buy-links block for the detail view
  function priceBlock(c) {
    const row = (label, nf, fo, cls) =>
      '<div class="price-vendor ' + (cls || "") + '"><span class="pv-name">' + label + "</span>" +
      '<span class="pv-vals"><span class="pv-nf">' + nf + '</span><span class="pv-fo">' + fo + "</span></span></div>";
    const ckRow = row("Card Kingdom", canN(c) ? price(ckN(c)) : "—", canF(c) ? price(ckF(c)) : "—", "primary");
    const usdRow = row("TCGplayer", canN(c) ? price(priceN(c)) : "—", canF(c) ? price(priceF(c)) : "—");
    const eurRow = row("Cardmarket", canN(c) ? eur(c.eur) : "—", canF(c) ? eur(c.eur_foil) : "—");
    const q = encodeURIComponent(c.name);
    const ck = "https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=" + q;
    const ebay = "https://www.ebay.com/sch/i.html?_nkw=" + q + "+mtg";
    const tcg = c.tcg || "https://www.tcgplayer.com/search/all/product?q=" + q;
    const cm = c.cm || "https://www.cardmarket.com/en/Magic/Products/Search?searchString=" + q;
    const link = (href, label) =>
      '<a class="buy-link" href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    return (
      '<div class="price-grid">' +
      '<div class="price-head"><span></span><span class="pv-vals"><span>Non-foil</span><span>Foil</span></span></div>' +
      ckRow + usdRow + eurRow +
      "</div>" +
      '<div class="buy-row">' + link(ck, "Card Kingdom") + link(tcg, "TCGplayer") + link(cm, "Cardmarket") + link(ebay, "eBay") + "</div>"
    );
  }

  // ---- data loading (Scryfall, with localStorage cache) ----
  function getJSON(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c && c.ts && Date.now() - c.ts < CACHE_TTL && Array.isArray(c.cards)) return c;
    } catch (e) {}
    return null;
  }
  function writeCache(meta, cards) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), meta, cards }));
    } catch (e) {
      // quota: drop other cached sets, then retry once
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith("mtg-cache:") && k !== CACHE_KEY)
          .forEach((k) => localStorage.removeItem(k));
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), meta, cards }));
      } catch (e2) {}
    }
  }

  function trimCard(c) {
    let img = c.image_uris || {};
    if (!img.small && c.card_faces && c.card_faces[0]) img = c.card_faces[0].image_uris || {};
    const p = c.prices || {};
    let colors = c.colors;
    if (!colors && c.card_faces) {
      colors = (c.card_faces[0] && c.card_faces[0].colors) || [];
    }
    const pu = c.purchase_uris || {};
    return {
      id: c.id,
      name: c.name,
      num: c.collector_number,
      rarity: c.rarity,
      type: c.type_line || "",
      colors: colors || [],
      small: img.small,
      normal: img.normal,
      usd: p.usd,
      usd_foil: p.usd_foil,
      eur: p.eur,
      eur_foil: p.eur_foil,
      tcg: pu.tcgplayer || null,
      cm: pu.cardmarket || null,
      finishes: c.finishes || [],
      set: c.set,
    };
  }

  function numKey(c) {
    const m = /^(\d+)/.exec(c.num || "");
    return m ? parseInt(m[1], 10) : 99999;
  }

  async function fetchSet() {
    const meta = await getJSON("https://api.scryfall.com/sets/" + encodeURIComponent(CODE));
    const cards = [];
    let url =
      "https://api.scryfall.com/cards/search?q=" +
      encodeURIComponent("e:" + CODE) +
      "&unique=prints&order=set&include_extras=true";
    let page = 0;
    while (url) {
      const d = await getJSON(url);
      d.data.forEach((c) => cards.push(trimCard(c)));
      page++;
      statusEl.textContent = "Loading cards… " + cards.length + " so far";
      url = d.has_more ? d.next_page : null;
      if (url) await new Promise((r) => setTimeout(r, 120));
    }
    cards.sort((a, b) => numKey(a) - numKey(b) || (a.num || "").localeCompare(b.num || "", undefined, { numeric: true }));
    const m = {
      code: meta.code,
      name: meta.name,
      released: meta.released_at,
      icon: meta.icon_svg_uri,
    };
    return { meta: m, cards };
  }

  // Secret Lair drop: card list comes from secret-lair-data.js, card data from Scryfall
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("couldn’t load " + src));
      document.head.appendChild(s);
    });
  }
  async function findDrop() {
    if (!window.SECRET_LAIR) await loadScript("secret-lair-data.js");
    const d = (window.SECRET_LAIR.drops || []).find((x) => x.id === DROP_ID);
    if (!d) return null;
    d.cards.forEach(([id, set]) => (cardSet[id] = set || CODE));
    SET_CODES = Array.from(new Set(d.cards.map(([, set]) => set || CODE)));
    return d;
  }
  async function fetchDrop() {
    const ids = DROP.cards.map(([id]) => id);
    const byId = {};
    for (let i = 0; i < ids.length; i += 75) {
      const r = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      (await r.json()).data.forEach((c) => (byId[c.id] = trimCard(c)));
      statusEl.textContent = "Loading cards… " + Object.keys(byId).length + " so far";
      if (i + 75 < ids.length) await new Promise((r) => setTimeout(r, 120));
    }
    const kind = { commander: "Secret Lair Commander Deck", countdown: "Secret Lair Countdown Kit", ultimate: "Secret Lair: Ultimate Edition" };
    const meta = {
      code: "sld",
      name: DROP.name,
      released: DROP.released,
      icon: "https://svgs.scryfall.io/sets/sld.svg",
      label: (kind[DROP.kind] || "Secret Lair Drop") + (DROP.foil_edition ? " · Foil edition available" : ""),
    };
    return { meta, cards: ids.map((id) => byId[id]).filter(Boolean) };
  }

  // decide the ownership source and load it into `ownedBySet`
  async function hydrateOwned() {
    if (window.MTG) {
      window.MTG.mountAccountBar(document.getElementById("account"));
      await window.MTG.ready;
      useCloud = window.MTG.enabled && !!window.MTG.user;
    }
    if (useCloud) {
      try {
        await window.MTG.importLocalOnce();
        const maps = await Promise.all(SET_CODES.map((code) => window.MTG.loadSet(code)));
        SET_CODES.forEach((code, i) => (ownedBySet[code] = maps[i]));
        return;
      } catch (e) {} // fall back to cache on network error
    }
    SET_CODES.forEach((code) => (ownedBySet[code] = loadLocal(code)));
  }

  async function load() {
    if (DROP_ID) {
      document.querySelector(".back-link").href = "index.html#secret-lair";
      try {
        DROP = await findDrop();
      } catch (e) {
        showError("Couldn’t load Secret Lair data.", e.message);
        return;
      }
      if (!DROP) {
        showError("Secret Lair drop not found.", "Go back to the Secret Lair list and pick a drop.");
        return;
      }
    } else if (!CODE) {
      showError("No set specified.", "Go back to the set list and pick a set.");
      return;
    }
    await hydrateOwned();
    const cached = readCache();
    if (cached) {
      init(cached.meta, cached.cards);
      return;
    }
    try {
      const { meta, cards } = await (DROP ? fetchDrop() : fetchSet());
      if (!cards.length) {
        showError("No cards found for “" + CODE + "”.", "This set may have no card data on Scryfall.");
        return;
      }
      writeCache(meta, cards);
      init(meta, cards);
    } catch (e) {
      showError("Couldn’t load this set.", "Check your connection and reload. (" + e.message + ")");
    }
  }

  function showError(title, detail) {
    statusEl.innerHTML =
      '<div class="status-title">' + title + "</div>" +
      '<div class="status-detail">' + detail + "</div>" +
      '<a class="ghost-btn" href="index.html">← All sets</a>';
    statusEl.classList.add("error");
    document.getElementById("setName").textContent = "Set not found";
  }

  // ---- init once data is present ----
  async function init(meta, cards) {
    META = meta;
    CARDS = cards;
    statusEl.hidden = true;

    // header
    const name = meta.name || CODE.toUpperCase();
    const code = (meta.code || CODE).toUpperCase();
    document.getElementById("setName").textContent = name;
    const dateStr = meta.released
      ? new Date(meta.released).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : "";
    document.getElementById("setSub").textContent = (meta.label || code) + (dateStr ? " · " + dateStr : "");
    document.title = name + " — Set Tracker";
    if (meta.icon) {
      const ic = document.getElementById("setIcon");
      ic.src = meta.icon;
      ic.hidden = false;
    }
    document.getElementById("totalCount").textContent = CARDS.length;

    // paint immediately with TCGplayer prices, then upgrade to Card Kingdom
    recomputeTotal();
    render();
    mergeCardKingdomPrices();
    if (FOCUS_CARD && CARDS.some((c) => c.id === FOCUS_CARD)) openLightbox(FOCUS_CARD);
  }

  function recomputeTotal() {
    TOTAL_VALUE = CARDS.reduce((s, c) => s + (primaryN(c) || 0) + (primaryF(c) || 0), 0);
    document.getElementById("totalValue").textContent = fmt(TOTAL_VALUE);
  }

  // fetch Card Kingdom prices (primary source) and re-render once merged
  async function mergeCardKingdomPrices() {
    if (!window.MTG || !window.MTG.enabled) return;
    try {
      const pm = await window.MTG.getPrices(CARDS.map((c) => c.id));
      let any = false;
      CARDS.forEach((c) => {
        const p = pm[c.id];
        if (p) { c.ck = p.n; c.ck_foil = p.f; any = true; }
      });
      if (any) { recomputeTotal(); render(); }
    } catch (e) {}
  }

  // ---- rendering ----
  function currentList() {
    let list = CARDS.filter((c) => {
      if (state.rarity !== "all" && c.rarity !== state.rarity) return false;
      if (!colorMatch(c)) return false;
      if (state.owned === "owned" && !hasAny(c.id)) return false;
      if (state.owned === "foil" && !hasF(c.id)) return false;
      // missing a specific finish: that finish exists for the card but isn't owned
      if (state.owned === "nfmiss" && !(canN(c) && !hasN(c.id))) return false;
      if (state.owned === "foilmiss" && !(canF(c) && !hasF(c.id))) return false;
      if (state.search) {
        const hay = (c.name + " " + c.num + " " + c.type).toLowerCase();
        if (!hay.includes(state.search)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      switch (state.sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "rarity":
          return (RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]) || numCmp(a, b);
        case "value":
          return (primaryN(b) || 0) - (primaryN(a) || 0);
        default:
          return numCmp(a, b);
      }
    });
    return list;
  }

  function numCmp(a, b) {
    const na = numKey(a), nb = numKey(b);
    if (na !== nb) return na - nb;
    return (a.num || "").localeCompare(b.num || "", undefined, { numeric: true });
  }

  function cardClasses(c) {
    let cls = "card";
    if (hasAny(c.id)) cls += " owned";
    if (hasF(c.id)) cls += " foil-owned";
    return cls;
  }

  function finishToggles(c) {
    const wrap = document.createElement("div");
    wrap.className = "finish-toggles";
    if (canN(c)) {
      const b = document.createElement("button");
      b.className = "ft nf" + (hasN(c.id) ? " on" : "");
      b.dataset.finish = "n";
      b.title = (hasN(c.id) ? "Non-foil owned — click to remove" : "Mark non-foil owned") + " · " + price(primaryN(c));
      b.innerHTML = '<span class="fi">✓</span><span class="fp">' + price(primaryN(c)) + "</span>";
      wrap.appendChild(b);
    }
    if (canF(c)) {
      const b = document.createElement("button");
      b.className = "ft foil" + (hasF(c.id) ? " on" : "");
      b.dataset.finish = "f";
      b.title = (hasF(c.id) ? "Foil owned — click to remove" : "Mark foil owned") + " · " + price(primaryF(c));
      b.innerHTML = '<span class="fi">✦</span><span class="fp">' + price(primaryF(c)) + "</span>";
      wrap.appendChild(b);
    }
    return wrap;
  }

  function render() {
    const list = currentList();
    grid.innerHTML = "";
    emptyEl.hidden = list.length !== 0;

    const frag = document.createDocumentFragment();
    for (const c of list) {
      const el = document.createElement("div");
      el.className = cardClasses(c);
      el.dataset.id = c.id;

      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = c.small || "";
      img.alt = c.name;
      el.appendChild(img);

      const num = document.createElement("span");
      num.className = "num-badge";
      num.textContent = "#" + c.num;
      el.appendChild(num);

      const dot = document.createElement("span");
      dot.className = "rarity-dot " + c.rarity;
      dot.title = c.rarity;
      el.appendChild(dot);

      el.appendChild(finishToggles(c));
      frag.appendChild(el);
    }
    grid.appendChild(frag);

    resultCount.textContent = list.length + (list.length === 1 ? " card" : " cards") + " shown";
    updateProgress();
  }

  function updateProgress() {
    let nCount = 0, fCount = 0, anyCount = 0, val = 0;
    for (const c of CARDS) {
      const n = hasN(c.id), f = hasF(c.id);
      if (n) { nCount++; val += primaryN(c) || 0; }
      if (f) { fCount++; val += primaryF(c) || 0; }
      if (n || f) anyCount++;
    }
    const pct = CARDS.length ? Math.round((anyCount / CARDS.length) * 100) : 0;
    document.getElementById("ownedCount").textContent = anyCount;
    document.getElementById("pctLabel").textContent = pct + "%";
    document.getElementById("progressFill").style.width = pct + "%";
    document.getElementById("ownedValue").textContent = fmt(val);
    document.getElementById("nfCount").textContent = nCount;
    document.getElementById("foilCount").textContent = fCount;
  }

  function refreshCard(id) {
    const el = grid.querySelector('.card[data-id="' + CSS.escape(id) + '"]');
    if (!el) return;
    el.classList.toggle("owned", hasAny(id));
    el.classList.toggle("foil-owned", hasF(id));
    const nfBtn = el.querySelector(".ft.nf");
    if (nfBtn) nfBtn.classList.toggle("on", hasN(id));
    const fBtn = el.querySelector(".ft.foil");
    if (fBtn) fBtn.classList.toggle("on", hasF(id));
  }

  function toggle(id, finish) {
    toggleFinish(id, finish);
    if (state.owned !== "all") render();
    else { refreshCard(id); updateProgress(); }
    if (lightboxId === id) syncLightboxButtons();
  }

  // ---- events: grid ----
  grid.addEventListener("click", (e) => {
    const ft = e.target.closest(".ft");
    const card = e.target.closest(".card");
    if (!card) return;
    if (ft) toggle(card.dataset.id, ft.dataset.finish);
    else openLightbox(card.dataset.id);
  });

  // ---- events: filters ----
  document.getElementById("rarityFilters").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.rarity = btn.dataset.rarity;
    setActive("rarityFilters", btn);
    render();
  });
  document.getElementById("colorFilters").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.color = btn.dataset.color;
    setActive("colorFilters", btn);
    render();
  });
  document.getElementById("ownedFilters").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.owned = btn.dataset.owned;
    setActive("ownedFilters", btn);
    render();
  });
  function setActive(groupId, btn) {
    document.getElementById(groupId).querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
  }

  let searchTimer;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = searchEl.value.trim().toLowerCase();
      render();
    }, 150);
  });

  sortEl.addEventListener("change", () => {
    state.sort = sortEl.value;
    render();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (DROP) {
      // only this drop's cards — the rest of the set (e.g. other sld cards) stays
      const mine = CARDS.filter((c) => hasAny(c.id));
      if (!mine.length) return;
      if (!confirm("Clear the " + mine.length + " owned cards in this drop? This can't be undone.")) return;
      mine.forEach((c) => {
        const code = setOf(c.id);
        delete ownedBySet[code][c.id];
        if (useCloud) Promise.resolve(window.MTG.setCard(code, c.id, { n: false, f: false })).catch(() => {});
      });
      SET_CODES.forEach(saveLocal);
      render();
      return;
    }
    if (!Object.keys(ownedBySet[CODE] || {}).length) return;
    if (confirm("Clear your entire collection for this set? This can't be undone.")) {
      ownedBySet[CODE] = {};
      saveLocal(CODE);
      if (useCloud) Promise.resolve(window.MTG.clearSet(CODE)).catch(() => {});
      render();
    }
  });

  // ---- lightbox ----
  const lightbox = document.getElementById("lightbox");
  const lbImg = document.getElementById("lightboxImg");
  const lbNonfoil = document.getElementById("lbNonfoil");
  const lbFoil = document.getElementById("lbFoil");
  let lightboxId = null;

  function openLightbox(id) {
    const c = CARDS.find((x) => x.id === id);
    if (!c) return;
    lightboxId = id;
    lbImg.src = c.normal || c.small || "";
    lbImg.alt = c.name;
    document.getElementById("lbName").textContent = c.name;
    document.getElementById("lbMeta").textContent = "#" + c.num + " · " + cap(c.rarity) + " · " + c.type;
    document.getElementById("lbPrice").innerHTML = priceBlock(c);
    lbNonfoil.hidden = !canN(c);
    lbFoil.hidden = !canF(c);
    syncLightboxButtons();
    lightbox.hidden = false;
  }
  function syncLightboxButtons() {
    const n = hasN(lightboxId), f = hasF(lightboxId);
    lbNonfoil.textContent = n ? "✓ Non-foil owned" : "＋ Non-foil";
    lbNonfoil.className = "own-btn finish-btn nf" + (n ? " on" : "");
    lbFoil.textContent = f ? "✦ Foil owned" : "＋ Foil";
    lbFoil.className = "own-btn finish-btn foil" + (f ? " on" : "");
  }
  lbNonfoil.addEventListener("click", () => toggle(lightboxId, "n"));
  lbFoil.addEventListener("click", () => toggle(lightboxId, "f"));
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  function closeLightbox() {
    lightbox.hidden = true;
    lightboxId = null;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
  });

  function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // ---- go ----
  load();
})();
