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
