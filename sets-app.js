(function () {
  "use strict";

  const DATA = window.SET_DATA || { sets: [] };
  const SETS = DATA.sets;

  const grid = document.getElementById("grid");
  const emptyEl = document.getElementById("empty");
  const searchEl = document.getElementById("search");
  const typeEl = document.getElementById("typeFilter");
  const sortEl = document.getElementById("sort");
  const resultCount = document.getElementById("resultCount");
  const searchModeEl = document.getElementById("searchMode");
  const slKindEl = document.getElementById("slKind");
  const cardResults = document.getElementById("cardResults");
  const cardGrid = document.getElementById("cardGrid");
  const cardStatus = document.getElementById("cardStatus");
  const moreBtn = document.getElementById("moreCards");

  // tab: "sets" | "secret-lair"; mode (sets tab only): "sets" | "cards" | "artist"
  const state = { tab: "sets", mode: "sets", search: "", type: "main", started: "all", sort: "new", slKind: "all" };
  const SET_BY_CODE = {};
  SETS.forEach((s) => (SET_BY_CODE[s.code] = s));

  // types that are auxiliary products rather than collectible "sets" — hidden
  // from the default "Main sets" view (still reachable via the type filter)
  const EXTRA_TYPES = new Set([
    "token", "promo", "memorabilia", "minigame", "treasure_chest",
    "vanguard", "alchemy",
  ]);
  const isMain = (s) => !EXTRA_TYPES.has(s.type);

  // ---- owned counts per set ----
  // signed in -> counts come from Supabase; otherwise from localStorage
  // key "mtg-tracker:<code>" -> { id: {n,f} }
  let ownedByCode = {};
  function scanLocal() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("mtg-tracker:")) continue;
      const code = k.slice("mtg-tracker:".length);
      try {
        const v = JSON.parse(localStorage.getItem(k) || "{}");
        out[code] = Array.isArray(v) ? v.length : Object.keys(v).length;
      } catch (e) {
        out[code] = 0;
      }
    }
    return out;
  }
  const ownedCount = (code) => ownedByCode[code] || 0;

  function prettyType(t) {
    return (t || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }
  function fmtDate(d) {
    if (!d) return "—";
    const dt = new Date(d);
    return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // ---- populate type filter ----
  (function buildTypes() {
    const counts = {};
    SETS.forEach((s) => (counts[s.type] = (counts[s.type] || 0) + 1));
    const mainCount = SETS.filter(isMain).length;

    // "Main sets" (default) and "All types" come first
    typeEl.innerHTML = "";
    const optMain = document.createElement("option");
    optMain.value = "main";
    optMain.textContent = "Main sets (" + mainCount + ")";
    typeEl.appendChild(optMain);
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "All types (" + SETS.length + ")";
    typeEl.appendChild(optAll);

    Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a])
      .forEach((t) => {
        const o = document.createElement("option");
        o.value = t;
        o.textContent = prettyType(t) + " (" + counts[t] + ")";
        typeEl.appendChild(o);
      });
    typeEl.value = "main";
  })();

  // ---- header summary ----
  function updateSummary() {
    let started = 0, cards = 0;
    for (const code in ownedByCode) {
      if (ownedByCode[code] > 0) { started++; cards += ownedByCode[code]; }
    }
    document.getElementById("setsTracked").textContent = started;
    document.getElementById("cardsOwned").textContent = cards.toLocaleString();
  }

  function currentList() {
    let list = SETS.filter((s) => {
      if (state.type === "main") { if (!isMain(s)) return false; }
      else if (state.type !== "all" && s.type !== state.type) return false;
      if (state.started === "started" && ownedCount(s.code) === 0) return false;
      if (state.search) {
        const hay = (s.name + " " + s.code).toLowerCase();
        if (!hay.includes(state.search)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      switch (state.sort) {
        case "old":
          return (a.released || "").localeCompare(b.released || "");
        case "name":
          return a.name.localeCompare(b.name);
        case "size":
          return b.count - a.count;
        case "progress": {
          const pa = a.count ? ownedCount(a.code) / a.count : 0;
          const pb = b.count ? ownedCount(b.code) / b.count : 0;
          return pb - pa || (b.released || "").localeCompare(a.released || "");
        }
        default: // new
          return (b.released || "").localeCompare(a.released || "");
      }
    });
    return list;
  }

  function render() {
    if (state.tab === "secret-lair") return renderSL();
    if (state.mode !== "sets") return; // card search renders on its own
    const list = currentList();
    grid.innerHTML = "";
    emptyEl.hidden = list.length !== 0;

    const frag = document.createDocumentFragment();
    for (const s of list) {
      const owned = ownedCount(s.code);
      const pct = s.count ? Math.round((owned / s.count) * 100) : 0;

      const a = document.createElement("a");
      a.className = "set-card" + (owned ? " started" : "");
      a.href = "set.html?code=" + encodeURIComponent(s.code);

      const top = document.createElement("div");
      top.className = "set-card-top";
      if (s.icon) {
        const ic = document.createElement("img");
        ic.className = "set-card-icon";
        ic.loading = "lazy";
        ic.src = s.icon;
        ic.alt = "";
        top.appendChild(ic);
      }
      const info = document.createElement("div");
      info.className = "set-card-info";
      const h = document.createElement("h3");
      h.className = "set-card-name";
      h.textContent = s.name;
      const meta = document.createElement("div");
      meta.className = "set-card-meta";
      meta.innerHTML =
        '<span class="set-code">' + s.code.toUpperCase() + "</span>" +
        '<span class="set-type">' + prettyType(s.type) + "</span>";
      const date = document.createElement("div");
      date.className = "set-card-date";
      date.textContent = fmtDate(s.released) + " · " + s.count + " cards";
      info.appendChild(h);
      info.appendChild(meta);
      info.appendChild(date);
      top.appendChild(info);
      a.appendChild(top);

      const prog = document.createElement("div");
      prog.className = "set-card-progress";
      prog.innerHTML =
        '<div class="mini-track"><div class="mini-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="mini-stats"><span>' + owned + " / " + s.count + "</span><span>" + pct + "%</span></div>";
      a.appendChild(prog);

      frag.appendChild(a);
    }
    grid.appendChild(frag);

    resultCount.textContent = list.length.toLocaleString() + (list.length === 1 ? " set" : " sets") + " shown";
    updateSummary();
  }

  // ---- card / illustrator search (Scryfall, every paper printing) ----
  let cardReq = 0;
  let nextPage = null;

  function cardQuery() {
    const q = state.search;
    if (state.mode === "artist") return 'a:"' + q.replace(/"/g, "") + '" game:paper';
    return q + " game:paper";
  }

  async function searchCards(more) {
    const req = ++cardReq;
    const q = state.search;
    if (!more) {
      cardGrid.innerHTML = "";
      nextPage = null;
      moreBtn.hidden = true;
    }
    if (q.length < 2) {
      cardStatus.hidden = false;
      cardStatus.textContent = state.mode === "artist"
        ? "Type an illustrator’s name, e.g. Rebecca Guay."
        : "Type a card name to find every printing and the set it belongs to.";
      resultCount.textContent = "";
      return;
    }
    cardStatus.hidden = false;
    cardStatus.textContent = "Searching…";
    const url = more
      ? nextPage
      : "https://api.scryfall.com/cards/search?unique=prints&order=released&dir=desc&q=" + encodeURIComponent(cardQuery());
    let d;
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (r.status === 404) d = { data: [], total_cards: 0 };
      else if (!r.ok) throw new Error("HTTP " + r.status);
      else d = await r.json();
    } catch (e) {
      if (req !== cardReq) return;
      cardStatus.textContent = "Search failed — check your connection. (" + e.message + ")";
      return;
    }
    if (req !== cardReq) return; // a newer search started

    cardStatus.hidden = d.data.length > 0 || more;
    if (!d.data.length && !more) cardStatus.textContent = "No cards found for “" + q + "”.";
    const frag = document.createDocumentFragment();
    d.data.forEach((c) => frag.appendChild(cardTile(c)));
    cardGrid.appendChild(frag);
    nextPage = d.has_more ? d.next_page : null;
    moreBtn.hidden = !nextPage;
    const shown = cardGrid.children.length;
    resultCount.textContent = shown.toLocaleString() + " of " + (d.total_cards || shown).toLocaleString() + " printings";
  }

  function cardTile(c) {
    let img = c.image_uris || {};
    if (!img.small && c.card_faces && c.card_faces[0]) img = c.card_faces[0].image_uris || {};
    const set = SET_BY_CODE[c.set];

    const a = document.createElement("a");
    a.className = "result-card";
    a.href = "set.html?code=" + encodeURIComponent(c.set) + "&card=" + encodeURIComponent(c.id);
    a.title = c.name + " — " + c.set_name;

    const im = document.createElement("img");
    im.className = "rc-img";
    im.loading = "lazy";
    im.src = img.small || "";
    im.alt = c.name;
    a.appendChild(im);

    const info = document.createElement("div");
    info.className = "rc-info";
    const name = document.createElement("div");
    name.className = "rc-name";
    name.textContent = c.name;
    const setLine = document.createElement("div");
    setLine.className = "rc-set";
    if (set && set.icon) {
      const ic = document.createElement("img");
      ic.src = set.icon;
      ic.alt = "";
      setLine.appendChild(ic);
    }
    const sn = document.createElement("span");
    sn.textContent = c.set_name + " · #" + c.collector_number;
    setLine.appendChild(sn);
    info.appendChild(name);
    info.appendChild(setLine);
    if (c.artist) {
      const ar = document.createElement("div");
      ar.className = "rc-artist";
      ar.textContent = "Illus. " + c.artist;
      info.appendChild(ar);
    }
    a.appendChild(info);
    return a;
  }

  // ---- Secret Lair tab ----
  // drop list is loaded on first visit; owned counts span the drop cards' sets (sld, plst, ...)
  let DROPS = null;
  let slOwned = {}; // { [setCode]: { [cardId]: { n, f } } }
  const dropOwnedCache = new Map();
  const KIND_LABEL = { drop: "Drop", commander: "Commander deck", countdown: "Countdown kit", ultimate: "Ultimate Edition" };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error("couldn’t load " + src));
      document.head.appendChild(el);
    });
  }
  function localSet(code) {
    try {
      const v = JSON.parse(localStorage.getItem("mtg-tracker:" + code) || "{}");
      if (Array.isArray(v)) { const o = {}; v.forEach((id) => (o[id] = { n: true })); return o; }
      return v && typeof v === "object" ? v : {};
    } catch (e) {
      return {};
    }
  }
  async function loadSL() {
    if (DROPS) return;
    grid.innerHTML = '<div class="empty-state">Loading Secret Lair drops…</div>';
    if (!window.SECRET_LAIR) await loadScript("secret-lair-data.js?v=1");
    const drops = window.SECRET_LAIR.drops || [];
    const codes = Array.from(new Set([].concat(...drops.map((d) => d.cards.map((c) => c[1])))));
    codes.forEach((code) => (slOwned[code] = localSet(code)));
    if (window.MTG) {
      await MTG.ready;
      if (MTG.enabled && MTG.user) {
        const maps = await Promise.all(codes.map((code) => MTG.loadSet(code)));
        codes.forEach((code, i) => (slOwned[code] = maps[i]));
      }
    }
    DROPS = drops;
  }
  function dropOwned(d) {
    if (!dropOwnedCache.has(d.id)) {
      dropOwnedCache.set(d.id, d.cards.filter(([id, set]) => {
        const o = (slOwned[set] || {})[id];
        return o && (o.n || o.f);
      }).length);
    }
    return dropOwnedCache.get(d.id);
  }

  function slList() {
    const q = state.search;
    const list = [];
    for (const d of DROPS) {
      if (state.slKind !== "all" && d.kind !== state.slKind) continue;
      if (state.started === "started" && dropOwned(d) === 0) continue;
      let hit = null; // card that matched the search, if not the drop name
      if (q && !d.name.toLowerCase().includes(q)) {
        const c = d.cards.find((c) => (c[2] || "").toLowerCase().includes(q));
        if (!c) continue;
        hit = c[2];
      }
      list.push({ d, hit });
    }
    const pct = (d) => (d.cards.length ? dropOwned(d) / d.cards.length : 0);
    list.sort(({ d: a }, { d: b }) => {
      switch (state.sort) {
        case "old": return (a.released || "").localeCompare(b.released || "");
        case "name": return a.name.localeCompare(b.name);
        case "size": return b.cards.length - a.cards.length;
        case "progress": return pct(b) - pct(a) || (b.released || "").localeCompare(a.released || "");
        default: return (b.released || "").localeCompare(a.released || "") || a.name.localeCompare(b.name);
      }
    });
    return list;
  }

  function artUrl(id) {
    return "https://cards.scryfall.io/art_crop/front/" + id[0] + "/" + id[1] + "/" + id + ".jpg";
  }

  function renderSL() {
    if (!DROPS) return;
    const list = slList();
    grid.innerHTML = "";
    emptyEl.textContent = "No Secret Lair drops match these filters.";
    emptyEl.hidden = list.length !== 0;

    const frag = document.createDocumentFragment();
    for (const { d, hit } of list) {
      const owned = dropOwned(d);
      const total = d.cards.length;
      const pct = total ? Math.round((owned / total) * 100) : 0;

      const a = document.createElement("a");
      a.className = "set-card drop-card" + (owned ? " started" : "");
      a.href = "set.html?drop=" + encodeURIComponent(d.id);

      const art = document.createElement("img");
      art.className = "drop-art";
      art.loading = "lazy";
      art.src = artUrl(d.cards[0][0]);
      art.alt = "";
      a.appendChild(art);

      const h = document.createElement("h3");
      h.className = "set-card-name";
      h.textContent = d.name;
      a.appendChild(h);

      const meta = document.createElement("div");
      meta.className = "set-card-meta";
      const kind = document.createElement("span");
      kind.className = "set-type";
      kind.textContent = KIND_LABEL[d.kind] || "Drop";
      meta.appendChild(kind);
      if (d.foil_edition) {
        const f = document.createElement("span");
        f.className = "set-type foil-tag";
        f.textContent = "✦ Foil ed.";
        meta.appendChild(f);
      }
      a.appendChild(meta);

      const date = document.createElement("div");
      date.className = "set-card-date";
      date.textContent = fmtDate(d.released) + " · " + total + (total === 1 ? " card" : " cards");
      a.appendChild(date);

      if (hit) {
        const m = document.createElement("div");
        m.className = "drop-hit";
        m.textContent = "Includes " + hit;
        a.appendChild(m);
      }

      const prog = document.createElement("div");
      prog.className = "set-card-progress";
      prog.innerHTML =
        '<div class="mini-track"><div class="mini-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="mini-stats"><span>' + owned + " / " + total + "</span><span>" + pct + "%</span></div>";
      a.appendChild(prog);
      frag.appendChild(a);
    }
    grid.appendChild(frag);
    resultCount.textContent = list.length.toLocaleString() + (list.length === 1 ? " drop" : " drops") + " shown";
    updateSummary();
  }

  // ---- view switching ----
  const PLACEHOLDER = {
    sets: "Search sets by name or code…",
    cards: "Search cards by name — shows the set each printing is in…",
    artist: "Search by illustrator…",
    "secret-lair": "Search drops by name or a card in them…",
  };
  function applyView() {
    const sl = state.tab === "secret-lair";
    const cardMode = !sl && state.mode !== "sets";
    document.body.classList.toggle("tab-sl", sl);
    document.body.classList.toggle("card-search", cardMode);
    document.querySelectorAll("#tabs .tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === state.tab);
      b.setAttribute("aria-selected", b.dataset.tab === state.tab);
    });
    searchEl.placeholder = PLACEHOLDER[sl ? "secret-lair" : state.mode];
    grid.hidden = cardMode;
    cardResults.hidden = !cardMode;
    emptyEl.hidden = true;
    emptyEl.textContent = "No sets match these filters.";
    if (cardMode) searchCards(false);
    else if (sl) loadSL().then(renderSL, (e) => { grid.innerHTML = '<div class="empty-state">Couldn’t load Secret Lair data. (' + e.message + ")</div>"; });
    else render();
  }
  function setTab(tab) {
    if (tab === state.tab) return;
    state.tab = tab;
    state.search = "";
    searchEl.value = "";
    history.replaceState(null, "", tab === "secret-lair" ? "#secret-lair" : location.pathname + location.search);
    applyView();
  }

  // ---- events ----
  let t;
  searchEl.addEventListener("input", () => {
    clearTimeout(t);
    const cardMode = state.tab === "sets" && state.mode !== "sets";
    t = setTimeout(() => {
      state.search = searchEl.value.trim().toLowerCase();
      if (cardMode) searchCards(false);
      else render();
    }, cardMode ? 350 : 150);
  });
  searchModeEl.addEventListener("change", () => {
    state.mode = searchModeEl.value;
    state.search = searchEl.value.trim().toLowerCase();
    applyView();
    searchEl.focus();
  });
  moreBtn.addEventListener("click", () => searchCards(true));
  document.getElementById("tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (b) setTab(b.dataset.tab);
  });
  slKindEl.addEventListener("change", () => { state.slKind = slKindEl.value; render(); });
  typeEl.addEventListener("change", () => { state.type = typeEl.value; render(); });
  sortEl.addEventListener("change", () => { state.sort = sortEl.value; render(); });
  document.getElementById("startedFilters").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.started = btn.dataset.started;
    document.getElementById("startedFilters").querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    render();
  });

  // ---- init: account bar + counts (Supabase when signed in, else local) ----
  (async function init() {
    ownedByCode = scanLocal(); // instant first paint
    if (location.hash === "#secret-lair") state.tab = "secret-lair";
    applyView();
    if (window.MTG) {
      MTG.mountAccountBar(document.getElementById("account"));
      await MTG.ready;
      if (MTG.enabled && MTG.user) {
        await MTG.importLocalOnce();
        ownedByCode = await MTG.countsBySet();
        if (state.tab === "sets" && state.mode === "sets") render();
        else updateSummary();
      }
    }
  })();
})();
