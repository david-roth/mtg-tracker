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

  const state = { search: "", type: "main", started: "all", sort: "new" };

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

  // ---- events ----
  let t;
  searchEl.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.search = searchEl.value.trim().toLowerCase(); render(); }, 150);
  });
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
    render();
    if (window.MTG) {
      MTG.mountAccountBar(document.getElementById("account"));
      await MTG.ready;
      if (MTG.enabled && MTG.user) {
        await MTG.importLocalOnce();
        ownedByCode = await MTG.countsBySet();
        render();
      }
    }
  })();
})();
