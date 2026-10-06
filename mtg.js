/* Shared Supabase layer: auth, profile CRUD, collection sync, account mgmt,
   and the account/sign-in UI. Loads after config.js and the supabase-js UMD. */
(function () {
  "use strict";

  const cfg = window.MTG_CONFIG || {};
  const enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = enabled ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const MTG = {
    enabled,
    sb,
    user: null,
    profile: null,
    ready: null,
    _authCbs: [],
  };
  window.MTG = MTG;

  // ---------- init: resolve current session + profile ----------
  MTG.ready = (async function init() {
    if (!enabled) return;
    const { data } = await sb.auth.getSession();
    MTG.user = data.session ? data.session.user : null;
    if (MTG.user) MTG.profile = await MTG.getMyProfile();
    sb.auth.onAuthStateChange((_evt, session) => {
      const wasId = MTG.user && MTG.user.id;
      MTG.user = session ? session.user : null;
      const isId = MTG.user && MTG.user.id;
      if (wasId !== isId) MTG._authCbs.forEach((cb) => cb(MTG.user));
    });
  })();

  MTG.onAuthChange = (cb) => MTG._authCbs.push(cb);

  // ---------- auth ----------
  MTG.signUp = (email, password) =>
    sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  MTG.signIn = (email, password) => sb.auth.signInWithPassword({ email, password });
  MTG.signOut = () => sb.auth.signOut();

  // ---------- profiles ----------
  MTG.getMyProfile = async function () {
    if (!MTG.user) return null;
    const { data } = await sb.from("profiles").select("*").eq("id", MTG.user.id).maybeSingle();
    return data;
  };
  MTG.getProfileByUsername = async function (username) {
    const { data } = await sb.from("profiles").select("*").eq("username", username).maybeSingle();
    return data;
  };
  MTG.updateProfile = async function (fields) {
    const { data, error } = await sb.from("profiles").update(fields).eq("id", MTG.user.id).select().single();
    if (!error) MTG.profile = data;
    return { data, error };
  };
  MTG.usernameAvailable = async function (username) {
    const { data } = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
    return !data || (MTG.user && data.id === MTG.user.id);
  };

  // ---------- collection ----------
  // returns { [cardId]: { n, f } } for one set
  MTG.loadSet = async function (code, userId) {
    const uid = userId || (MTG.user && MTG.user.id);
    if (!uid) return {};
    const { data, error } = await sb
      .from("collection")
      .select("card_id,nonfoil,foil")
      .eq("user_id", uid)
      .eq("set_code", code);
    if (error || !data) return {};
    const map = {};
    data.forEach((r) => (map[r.card_id] = { n: r.nonfoil, f: r.foil }));
    return map;
  };
  // upsert or delete one card's ownership
  MTG.setCard = async function (code, cardId, own) {
    if (!MTG.user) return;
    if (!own.n && !own.f) {
      return sb.from("collection").delete().eq("user_id", MTG.user.id).eq("card_id", cardId);
    }
    return sb.from("collection").upsert(
      { user_id: MTG.user.id, card_id: cardId, set_code: code, nonfoil: !!own.n, foil: !!own.f },
      { onConflict: "user_id,card_id" }
    );
  };
  // remove all of a set's cards from the current user's collection
  MTG.clearSet = function (code) {
    if (!MTG.user) return;
    return sb.from("collection").delete().eq("user_id", MTG.user.id).eq("set_code", code);
  };

  // owned-card counts per set for the current user: { [set_code]: count }
  MTG.countsBySet = async function (userId) {
    const uid = userId || (MTG.user && MTG.user.id);
    if (!uid) return {};
    const { data, error } = await sb.from("collection").select("set_code").eq("user_id", uid);
    if (error || !data) return {};
    const counts = {};
    data.forEach((r) => (counts[r.set_code] = (counts[r.set_code] || 0) + 1));
    return counts;
  };

  // one-time import of any browser-local collections into the account
  MTG.importLocalOnce = async function () {
    if (!MTG.user) return { imported: 0 };
    const flag = "mtg-imported:" + MTG.user.id;
    if (localStorage.getItem(flag)) return { imported: 0 };
    const rows = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("mtg-tracker:")) continue;
      const code = k.slice("mtg-tracker:".length);
      let map;
      try { map = JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { continue; }
      Object.keys(map).forEach((cardId) => {
        const o = map[cardId] || {};
        if (o.n || o.f) rows.push({ user_id: MTG.user.id, card_id: cardId, set_code: code, nonfoil: !!o.n, foil: !!o.f });
      });
    }
    if (rows.length) {
      // chunk to stay within request limits
      for (let i = 0; i < rows.length; i += 500) {
        await sb.from("collection").upsert(rows.slice(i, i + 500), { onConflict: "user_id,card_id" });
      }
    }
    try { localStorage.setItem(flag, "1"); } catch (e) {}
    return { imported: rows.length };
  };

  // ---------- prices (Card Kingdom, from the prices table) ----------
  // returns { [card_id]: { n, f } } (Card Kingdom normal/foil USD)
  MTG.getPrices = async function (ids) {
    if (!enabled || !ids || !ids.length) return {};
    const out = {};
    for (let i = 0; i < ids.length; i += 900) {
      const chunk = ids.slice(i, i + 900);
      const { data, error } = await sb.rpc("prices_for", { ids: chunk });
      if (!error && data) data.forEach((r) => (out[r.card_id] = { n: r.ck_normal, f: r.ck_foil }));
    }
    return out;
  };

  // ---------- decks ----------
  function slug(n) {
    const a = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    const arr = new Uint32Array(n || 10);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 1e9);
    for (let i = 0; i < arr.length; i++) s += a[arr[i] % a.length];
    return s;
  }
  MTG.listDecks = async function (userId) {
    const uid = userId || (MTG.user && MTG.user.id);
    if (!uid) return [];
    const { data } = await sb.from("decks").select("*").eq("user_id", uid).order("updated_at", { ascending: false });
    return data || [];
  };
  MTG.getDeck = async function (id) {
    const { data: deck } = await sb.from("decks").select("*").eq("id", id).maybeSingle();
    if (!deck) return null;
    const { data: cards } = await sb.from("deck_cards").select("*").eq("deck_id", id);
    return { deck: deck, cards: cards || [] };
  };
  MTG.createDeck = async function (fields) {
    if (!MTG.user) return { error: { message: "Not signed in" } };
    for (let attempt = 0; attempt < 4; attempt++) {
      const id = slug(10);
      const row = Object.assign({ id: id, user_id: MTG.user.id }, fields || {});
      const { data, error } = await sb.from("decks").insert(row).select().single();
      if (!error) return { data: data };
      if (error.code !== "23505") return { error: error };
    }
    return { error: { message: "Could not allocate a deck id" } };
  };
  MTG.updateDeck = (id, fields) => sb.from("decks").update(fields).eq("id", id).select().single();
  MTG.deleteDeck = (id) => sb.from("decks").delete().eq("id", id);
  MTG.setDeckCard = function (deckId, card, qty, board) {
    board = board || "main";
    if (qty <= 0) {
      return sb.from("deck_cards").delete().eq("deck_id", deckId).eq("card_id", card.id).eq("board", board);
    }
    return sb.from("deck_cards").upsert(
      {
        deck_id: deckId, card_id: card.id, name: card.name,
        set_code: card.set_code || card.set || null,
        image: card.image || card.small || null,
        usd: card.usd != null ? card.usd : null, qty: qty, board: board,
      },
      { onConflict: "deck_id,card_id,board" }
    );
  };

  // ---------- account management ----------
  MTG.updateEmail = (email) => sb.auth.updateUser({ email });
  MTG.updatePassword = (password) => sb.auth.updateUser({ password });
  MTG.deleteAccount = () => sb.rpc("delete_own_account");
  MTG.exportData = async function () {
    const profile = await MTG.getMyProfile();
    const { data: collection } = await sb.from("collection").select("*").eq("user_id", MTG.user.id);
    return { exported_at: new Date().toISOString(), profile, collection: collection || [] };
  };

  // ================= account UI =================
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  MTG.mountAccountBar = function (container) {
    if (!container) return;
    render();
    MTG.onAuthChange(() => location.reload());

    async function render() {
      await MTG.ready;
      container.innerHTML = "";
      if (!enabled) {
        const badge = el("span", "acct-local", "Local mode");
        badge.title = "Sign-in is off until Supabase is configured (see SETUP.md). Your collection is saved in this browser.";
        container.appendChild(badge);
        return;
      }
      if (MTG.user) {
        const name = (MTG.profile && (MTG.profile.display_name || MTG.profile.username)) || MTG.user.email;
        const wrap = el("div", "acct-menu");
        const btn = el("button", "acct-btn", "▾ " + escapeHtml(name));
        const menu = el("div", "acct-dropdown");
        menu.hidden = true;
        menu.innerHTML =
          '<a href="profile.html">My profile & collection</a>' +
          '<a href="profile.html#decks">My decks</a>' +
          '<a href="deck.html?new=1">+ New deck</a>' +
          (MTG.profile ? '<a href="u.html?user=' + encodeURIComponent(MTG.profile.username) + '">View public profile</a>' : "") +
          '<a href="profile.html#account">Account settings</a>' +
          '<button class="acct-signout">Sign out</button>';
        btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
        document.addEventListener("click", () => (menu.hidden = true));
        menu.querySelector(".acct-signout").addEventListener("click", async () => { await MTG.signOut(); location.reload(); });
        wrap.appendChild(btn);
        wrap.appendChild(menu);
        container.appendChild(wrap);
      } else {
        const btn = el("button", "acct-btn signin", "Sign in");
        btn.addEventListener("click", openAuthModal);
        container.appendChild(btn);
      }
    }
  };

  function openAuthModal() {
    if (document.getElementById("authModal")) return;
    const modal = el("div", "auth-modal");
    modal.id = "authModal";
    modal.innerHTML =
      '<div class="auth-card">' +
      '  <button class="auth-close" aria-label="Close">✕</button>' +
      '  <div class="auth-tabs"><button data-tab="in" class="active">Log in</button><button data-tab="up">Sign up</button></div>' +
      '  <form class="auth-form">' +
      '    <input type="email" name="email" placeholder="Email" autocomplete="email" required>' +
      '    <input type="password" name="password" placeholder="Password (min 6 chars)" autocomplete="current-password" minlength="6" required>' +
      '    <button type="submit" class="auth-submit">Log in</button>' +
      '    <div class="auth-msg" role="status"></div>' +
      "  </form>" +
      "</div>";
    document.body.appendChild(modal);

    let mode = "in";
    const form = modal.querySelector(".auth-form");
    const msg = modal.querySelector(".auth-msg");
    const submit = modal.querySelector(".auth-submit");
    const close = () => modal.remove();
    modal.querySelector(".auth-close").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    modal.querySelectorAll(".auth-tabs button").forEach((t) =>
      t.addEventListener("click", () => {
        mode = t.dataset.tab;
        modal.querySelectorAll(".auth-tabs button").forEach((b) => b.classList.remove("active"));
        t.classList.add("active");
        submit.textContent = mode === "in" ? "Log in" : "Create account";
        form.password.autocomplete = mode === "in" ? "current-password" : "new-password";
        msg.textContent = "";
      })
    );

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      msg.className = "auth-msg";
      msg.textContent = mode === "in" ? "Logging in…" : "Creating account…";
      const email = form.email.value.trim();
      const password = form.password.value;
      try {
        if (mode === "in") {
          const { error } = await MTG.signIn(email, password);
          if (error) throw error;
          location.reload();
        } else {
          const { data, error } = await MTG.signUp(email, password);
          if (error) throw error;
          if (data.session) { location.reload(); }
          else { msg.textContent = "Check your email to confirm your account, then log in."; }
        }
      } catch (err) {
        msg.className = "auth-msg err";
        msg.textContent = err.message || "Something went wrong.";
        submit.disabled = false;
      }
    });
  }
  MTG.openAuthModal = openAuthModal;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  MTG.escapeHtml = escapeHtml;
})();
