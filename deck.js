(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let deckId = params.get("id");
  const wantNew = params.get("new") === "1";

  const BOARDS = [
    { key: "commander", label: "Commander" },
    { key: "main", label: "Mainboard" },
    { key: "side", label: "Sideboard" },
  ];

  let deck = null;       // deck row
  let cards = [];        // deck_cards rows
  let isOwner = false;

  const esc = (s) => (window.MTG ? MTG.escapeHtml(s) : String(s));
  const money = (n) => "$" + (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  (async function init() {
    if (!window.MTG || !MTG.enabled) return fail("Decks need accounts", "Supabase isn't configured for this deployment.");
    MTG.mountAccountBar($("account"));
    await MTG.ready;

    if (wantNew) {
      if (!MTG.user) return fail("Sign in to build a deck", "You need an account to create decks.");
      const { data, error } = await MTG.createDeck({ name: "Untitled deck", is_public: true });
      if (error) return fail("Couldn’t create deck", error.message);
      deckId = data.id;
      history.replaceState(null, "", "deck.html?id=" + encodeURIComponent(deckId));
    }
    if (!deckId) return fail("No deck specified", "This link is missing a deck id.");

    const res = await MTG.getDeck(deckId);
    if (!res) return fail("Deck not found", "It doesn’t exist, or it’s private.");
    deck = res.deck;
    cards = res.cards;
    isOwner = MTG.user && deck.user_id === MTG.user.id;

    $("status").hidden = true;
    $("deckView").hidden = false;
    renderHeader();
    if (isOwner) setupEditor();
    renderBoards();
  })();

  function fail(title, detail) {
    const s = $("status");
    s.className = "status-state error";
    s.innerHTML = '<div class="status-title">' + esc(title) + '</div><div class="status-detail">' + esc(detail) +
      '</div><a class="ghost-btn" href="index.html">← All sets</a>';
  }

  async function renderHeader() {
    document.title = deck.name + " — MTG Deck";
    $("deckTitle").textContent = deck.name || "Untitled deck";
    // author (only if their profile is public/readable)
    let author = "";
    try {
      const { data } = await MTG.sb.from("profiles").select("username,display_name").eq("id", deck.user_id).maybeSingle();
      if (data) author = " · by " + (data.display_name || data.username);
    } catch (e) {}
    $("deckSub").textContent = (deck.format || "Deck") + author + (deck.is_public ? "" : " · private");

    if (!isOwner) {
      $("readHead").hidden = false;
      $("rName").textContent = deck.name;
      $("rMeta").textContent = (deck.format || "") + author;
      $("rDesc").textContent = deck.description || "";
    }
  }

  // ---------- owner editor ----------
  function setupEditor() {
    $("editor").hidden = false;
    $("dName").value = deck.name || "";
    $("dFormat").value = deck.format || "";
    $("dDesc").value = deck.description || "";
    $("dPublic").checked = deck.is_public !== false;

    let t;
    const saveMeta = (fields, msg) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const { error } = await MTG.updateDeck(deck.id, fields);
        Object.assign(deck, fields);
        flash(error ? error.message : (msg || "Saved"), !error);
        if (fields.name !== undefined) { $("deckTitle").textContent = fields.name || "Untitled deck"; }
      }, 350);
    };
    $("dName").addEventListener("input", (e) => saveMeta({ name: e.target.value.trim() || "Untitled deck" }));
    $("dDesc").addEventListener("input", (e) => saveMeta({ description: e.target.value.trim() || null }));
    $("dFormat").addEventListener("change", (e) => saveMeta({ format: e.target.value || null }, "Format saved"));
    $("dPublic").addEventListener("change", (e) => saveMeta({ is_public: e.target.checked }, e.target.checked ? "Deck is public" : "Deck is private"));

    $("copyLink").addEventListener("click", () => {
      const url = location.origin + location.pathname.replace(/[^/]*$/, "deck.html") + "?id=" + deck.id;
      navigator.clipboard.writeText(url).then(() => flash("Link copied", true), () => flash(url, true));
    });
    $("deleteDeck").addEventListener("click", async () => {
      if (!confirm("Delete this deck permanently?")) return;
      const { error } = await MTG.deleteDeck(deck.id);
      if (error) return flash(error.message, false);
      location.href = "profile.html";
    });

    setupSearch();
  }

  function flash(msg, ok) {
    const m = $("deckMsg");
    m.className = "field-msg " + (ok ? "ok" : "err");
    m.textContent = msg;
  }

  // ---------- add-card search (Scryfall) ----------
  function setupSearch() {
    const input = $("cardSearch");
    const box = $("searchResults");
    let t, seq = 0;
    input.addEventListener("input", () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (q.length < 2) { box.hidden = true; box.innerHTML = ""; return; }
      t = setTimeout(() => runSearch(q, ++seq), 250);
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".add-card")) box.hidden = true; });

    async function runSearch(q, mine) {
      box.hidden = false;
      box.innerHTML = '<div class="sr-empty">Searching…</div>';
      try {
        const r = await fetch("https://api.scryfall.com/cards/search?unique=cards&order=name&q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } });
        if (mine !== seq) return;
        if (!r.ok) { box.innerHTML = '<div class="sr-empty">No cards found.</div>'; return; }
        const d = await r.json();
        const list = (d.data || []).slice(0, 10);
        box.innerHTML = "";
        list.forEach((c) => {
          const img = (c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {});
          const row = document.createElement("button");
          row.className = "sr-row";
          row.innerHTML =
            '<img src="' + (img.small || "") + '" alt="" loading="lazy">' +
            '<span class="sr-name">' + esc(c.name) + '</span>' +
            '<span class="sr-set">' + (c.set || "").toUpperCase() + " · " + (c.prices && c.prices.usd ? money(c.prices.usd) : "—") + "</span>";
          row.addEventListener("click", () => addCard(c, img.small));
          box.appendChild(row);
        });
        if (!list.length) box.innerHTML = '<div class="sr-empty">No cards found.</div>';
      } catch (e) {
        if (mine === seq) box.innerHTML = '<div class="sr-empty">Search failed.</div>';
      }
    }
  }

  async function addCard(sc, imgSmall) {
    const board = $("addBoard").value;
    const existing = cards.find((x) => x.card_id === sc.id && x.board === board);
    const qty = (existing ? existing.qty : 0) + 1;
    const card = {
      id: sc.id, name: sc.name, set: sc.set,
      image: imgSmall || "", usd: (sc.prices && sc.prices.usd) || null,
    };
    const { error } = await MTG.setDeckCard(deck.id, card, qty, board);
    if (error) return flash(error.message, false);
    if (existing) existing.qty = qty;
    else cards.push({ deck_id: deck.id, card_id: sc.id, name: sc.name, set_code: sc.set, image: card.image, usd: card.usd, qty: 1, board: board });
    flash("Added " + sc.name, true);
    renderBoards();
  }

  async function changeQty(row, delta) {
    const qty = row.qty + delta;
    const card = { id: row.card_id, name: row.name, set: row.set_code, image: row.image, usd: row.usd };
    const { error } = await MTG.setDeckCard(deck.id, card, qty, row.board);
    if (error) return flash(error.message, false);
    if (qty <= 0) cards = cards.filter((x) => !(x.card_id === row.card_id && x.board === row.board));
    else row.qty = qty;
    renderBoards();
  }

  // ---------- render boards ----------
  function renderBoards() {
    const host = $("boards");
    host.innerHTML = "";
    let totalCount = 0, totalValue = 0;

    BOARDS.forEach((b) => {
      const inBoard = cards.filter((c) => c.board === b.key);
      if (!inBoard.length) return;
      inBoard.sort((a, z) => a.name.localeCompare(z.name));
      const count = inBoard.reduce((s, c) => s + c.qty, 0);
      const value = inBoard.reduce((s, c) => s + c.qty * (parseFloat(c.usd) || 0), 0);
      totalCount += count; totalValue += value;

      const sec = document.createElement("section");
      sec.className = "deck-board";
      sec.innerHTML = '<h3>' + b.label + ' <span class="muted">' + count + " cards · " + money(value) + "</span></h3>";
      const grid = document.createElement("div");
      grid.className = "deck-grid";
      inBoard.forEach((c) => grid.appendChild(cardTile(c)));
      sec.appendChild(grid);
      host.appendChild(sec);
    });

    if (!cards.length) {
      host.innerHTML = '<p class="muted" style="padding:10px">' +
        (isOwner ? "No cards yet — search above to add some." : "This deck is empty.") + "</p>";
    }
    $("deckSummary").textContent = totalCount + " cards · est. " + money(totalValue);
  }

  function cardTile(row) {
    const el = document.createElement("div");
    el.className = "deck-card";
    el.innerHTML =
      '<img src="' + (row.image || "") + '" alt="' + esc(row.name) + '" loading="lazy">' +
      '<span class="qty-badge">' + row.qty + "×</span>";
    if (isOwner) {
      const ctr = document.createElement("div");
      ctr.className = "qty-ctrl";
      const minus = document.createElement("button"); minus.textContent = "−"; minus.title = "Remove one";
      const plus = document.createElement("button"); plus.textContent = "+"; plus.title = "Add one";
      minus.addEventListener("click", () => changeQty(row, -1));
      plus.addEventListener("click", () => changeQty(row, +1));
      ctr.appendChild(minus); ctr.appendChild(plus);
      el.appendChild(ctr);
    }
    return el;
  }
})();
