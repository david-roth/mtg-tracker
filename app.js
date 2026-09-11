(function () {
  "use strict";

  const DATA = window.CARD_DATA || { meta: {}, cards: [] };
  const CARDS = DATA.cards;
  const STORAGE_KEY = "mtg-tracker:" + (DATA.meta.code || "set");

  const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, mythic: 3 };

  // ---- owned state (localStorage) ----
  // shape: { [id]: { n: bool, f: bool } }  (n = non-foil, f = foil)
  let owned = loadOwned();
  function loadOwned() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      // migrate old array-of-ids format -> treat each as non-foil owned
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
  function saveOwned() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(owned));
    } catch (e) {}
  }
  const hasN = (id) => !!(owned[id] && owned[id].n);
  const hasF = (id) => !!(owned[id] && owned[id].f);
  const hasAny = (id) => hasN(id) || hasF(id);
  function toggleFinish(id, finish) {
    const cur = owned[id] || { n: false, f: false };
    cur[finish] = !cur[finish];
    if (!cur.n && !cur.f) delete owned[id];
    else owned[id] = cur;
    saveOwned();
  }

  // does this card come in this finish?
  const canN = (c) => (c.finishes || []).includes("nonfoil");
  const canF = (c) => (c.finishes || []).includes("foil");

  // prices per finish (numbers; NaN when unknown)
  const priceN = (c) => parseFloat(c.usd);
  const priceF = (c) => parseFloat(c.usd_foil);

  // ---- filter state ----
  const state = { rarity: "all", owned: "all", search: "", sort: "num" };

  // ---- element refs ----
  const grid = document.getElementById("grid");
  const emptyEl = document.getElementById("empty");
  const searchEl = document.getElementById("search");
  const sortEl = document.getElementById("sort");
  const resultCount = document.getElementById("resultCount");

  // ---- header meta ----
  const fullName = DATA.meta.name || "";
  const code = (DATA.meta.code || "").toUpperCase();
  const colon = fullName.indexOf(":");
  const title = colon > -1 ? fullName.slice(0, colon).trim() : fullName;
  const subtitle = colon > -1 ? fullName.slice(colon + 1).trim() + " · " + code : code;
  document.getElementById("setName").textContent = title;
  document.getElementById("setSub").textContent = subtitle;
  document.title = title + " Set Tracker";
  document.getElementById("totalCount").textContent = CARDS.length;

  // total = value of owning every printing in every finish it comes in
  const TOTAL_VALUE = CARDS.reduce(
    (s, c) => s + (priceN(c) || 0) + (priceF(c) || 0),
    0
  );
  document.getElementById("totalValue").textContent = fmt(TOTAL_VALUE);

  function fmt(n) {
    return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // short price for badges: "$0.13" or "—" when unknown
  function price(n) {
    return isNaN(n) ? "—" : fmt(n);
  }

  // ---- rendering ----
  function currentList() {
    let list = CARDS.filter((c) => {
      if (state.rarity !== "all" && c.rarity !== state.rarity) return false;
      if (state.owned === "owned" && !hasAny(c.id)) return false;
      if (state.owned === "missing" && hasAny(c.id)) return false;
      if (state.owned === "foil" && !hasF(c.id)) return false;
      if (state.search) {
        const q = state.search;
        const hay = (c.name + " " + c.num + " " + c.type).toLowerCase();
        if (!hay.includes(q)) return false;
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
          return (parseFloat(b.usd) || 0) - (parseFloat(a.usd) || 0);
        default:
          return numCmp(a, b);
      }
    });
    return list;
  }

  function numCmp(a, b) {
    const na = parseInt(a.num, 10), nb = parseInt(b.num, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return a.num.localeCompare(b.num, undefined, { numeric: true });
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
      b.title =
        (hasN(c.id) ? "Non-foil owned — click to remove" : "Mark non-foil owned") +
        " · " + price(priceN(c));
      b.innerHTML = '<span class="fi">✓</span><span class="fp">' + price(priceN(c)) + "</span>";
      wrap.appendChild(b);
    }
    if (canF(c)) {
      const b = document.createElement("button");
      b.className = "ft foil" + (hasF(c.id) ? " on" : "");
      b.dataset.finish = "f";
      b.title =
        (hasF(c.id) ? "Foil owned — click to remove" : "Mark foil owned") +
        " · " + price(priceF(c));
      b.innerHTML = '<span class="fi">✦</span><span class="fp">' + price(priceF(c)) + "</span>";
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

    resultCount.textContent =
      list.length + (list.length === 1 ? " card" : " cards") + " shown";
    updateProgress();
  }

  function updateProgress() {
    let nCount = 0, fCount = 0, anyCount = 0, val = 0;
    for (const c of CARDS) {
      const n = hasN(c.id), f = hasF(c.id);
      if (n) { nCount++; val += priceN(c) || 0; }
      if (f) { fCount++; val += priceF(c) || 0; }
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

  // apply owned/foil classes + toggle button state to one card element in place
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
    // if the "owned/foil/missing" filter would now hide/show it, re-render
    if (state.owned !== "all") {
      render();
    } else {
      refreshCard(id);
      updateProgress();
    }
    if (lightboxId === id) syncLightboxButtons();
  }

  // ---- events: grid ----
  grid.addEventListener("click", (e) => {
    const ft = e.target.closest(".ft");
    const card = e.target.closest(".card");
    if (!card) return;
    if (ft) {
      toggle(card.dataset.id, ft.dataset.finish);
    } else {
      openLightbox(card.dataset.id);
    }
  });

  // ---- events: filters ----
  document.getElementById("rarityFilters").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.rarity = btn.dataset.rarity;
    setActive("rarityFilters", btn);
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
    if (!Object.keys(owned).length) return;
    if (confirm("Clear your entire collection for this set? This can't be undone.")) {
      owned = {};
      saveOwned();
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
    document.getElementById("lbMeta").textContent =
      "#" + c.num + " · " + cap(c.rarity) + " · " + c.type;
    const parts = [];
    if (canN(c)) parts.push("Non-foil " + price(priceN(c)));
    if (canF(c)) parts.push("Foil " + price(priceF(c)));
    document.getElementById("lbPrice").innerHTML =
      "Market price · " + parts.join(" &nbsp;·&nbsp; ");
    lbNonfoil.hidden = !canN(c);
    lbFoil.hidden = !canF(c);
    syncLightboxButtons();
    lightbox.hidden = false;
  }
  function syncLightboxButtons() {
    const n = hasN(lightboxId), f = hasF(lightboxId);
    lbNonfoil.textContent = (n ? "✓ Non-foil owned" : "＋ Non-foil");
    lbNonfoil.className = "own-btn finish-btn nf" + (n ? " on" : "");
    lbFoil.textContent = (f ? "✦ Foil owned" : "＋ Foil");
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
  render();
})();
