(function () {
  "use strict";

  const SETS = (window.SET_DATA && window.SET_DATA.sets) || [];
  const setByCode = {};
  SETS.forEach((s) => (setByCode[s.code] = s));

  const $ = (id) => document.getElementById(id);

  (async function init() {
    if (window.MTG) MTG.mountAccountBar($("account"));

    if (!window.MTG || !MTG.enabled) {
      $("localMode").hidden = false;
      return;
    }
    await MTG.ready;
    if (!MTG.user) {
      $("signedOut").hidden = false;
      $("signInPrompt").addEventListener("click", () => MTG.openAuthModal());
      return;
    }

    $("signedIn").hidden = false;
    $("acctEmail").textContent = MTG.user.email || "—";
    await MTG.importLocalOnce();
    const profile = (await MTG.getMyProfile()) || {};
    fillProfile(profile);
    loadOverview();
    loadDecks();
    wireProfileForm();
    wireAccount();
  })();

  async function loadDecks() {
    const box = $("deckList");
    const decks = await MTG.listDecks();
    if (!decks.length) {
      box.innerHTML = '<p class="muted">No decks yet. Create one to start building.</p>';
      return;
    }
    box.innerHTML = "";
    decks.forEach((d) => {
      const a = document.createElement("a");
      a.className = "deck-row";
      a.href = "deck.html?id=" + encodeURIComponent(d.id);
      a.innerHTML =
        '<span class="dr-name">' + MTG.escapeHtml(d.name || "Untitled deck") + "</span>" +
        '<span class="dr-meta">' + (d.format ? MTG.escapeHtml(d.format) + " · " : "") +
        (d.is_public ? "public" : "private") + "</span>";
      box.appendChild(a);
    });
  }

  function fillProfile(p) {
    const f = $("profileForm");
    f.username.value = p.username || "";
    f.display_name.value = p.display_name || "";
    f.avatar_url.value = p.avatar_url || "";
    f.bio.value = p.bio || "";
    f.is_public.checked = p.is_public !== false;
    $("uPreview").textContent = p.username || "…";
    f.username.addEventListener("input", () => ($("uPreview").textContent = f.username.value || "…"));
  }

  function wireProfileForm() {
    const f = $("profileForm");
    const msg = $("profileMsg");
    const uMsg = $("usernameMsg");

    let checkTimer;
    f.username.addEventListener("input", () => {
      clearTimeout(checkTimer);
      const v = f.username.value.trim();
      uMsg.className = "field-msg";
      if (!/^[a-z0-9_-]{3,30}$/.test(v)) {
        uMsg.textContent = v ? "3–30 chars: lowercase letters, numbers, _ or -" : "";
        uMsg.classList.add("err");
        return;
      }
      uMsg.textContent = "Checking…";
      checkTimer = setTimeout(async () => {
        const ok = await MTG.usernameAvailable(v);
        uMsg.textContent = ok ? "✓ available" : "✕ taken";
        uMsg.className = "field-msg " + (ok ? "ok" : "err");
      }, 300);
    });

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.className = "field-msg";
      msg.textContent = "Saving…";
      const fields = {
        username: f.username.value.trim(),
        display_name: f.display_name.value.trim() || null,
        avatar_url: f.avatar_url.value.trim() || null,
        bio: f.bio.value.trim() || null,
        is_public: f.is_public.checked,
      };
      if (!/^[a-z0-9_-]{3,30}$/.test(fields.username)) {
        msg.textContent = "Fix the username first.";
        msg.classList.add("err");
        return;
      }
      const { error } = await MTG.updateProfile(fields);
      if (error) {
        msg.className = "field-msg err";
        msg.textContent = error.code === "23505" ? "That username is taken." : error.message;
      } else {
        msg.className = "field-msg ok";
        msg.textContent = "✓ Saved";
        $("uPreview").textContent = fields.username;
      }
    });
  }

  async function loadOverview() {
    const box = $("collectionOverview");
    const counts = await MTG.countsBySet();
    const codes = Object.keys(counts).filter((c) => counts[c] > 0);
    if (!codes.length) {
      box.innerHTML = '<p class="muted">No cards yet. <a href="index.html">Browse sets</a> to start tracking.</p>';
      return;
    }
    codes.sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
    box.innerHTML = "";
    codes.forEach((code) => {
      const s = setByCode[code];
      const total = s ? s.count : "?";
      const name = s ? s.name : code.toUpperCase();
      const pct = s && s.count ? Math.round((counts[code] / s.count) * 100) : 0;
      const a = document.createElement("a");
      a.className = "overview-row";
      a.href = "set.html?code=" + encodeURIComponent(code);
      a.innerHTML =
        '<span class="ov-name">' + MTG.escapeHtml(name) + '</span>' +
        '<span class="ov-stat">' + counts[code] + " / " + total + "</span>" +
        '<span class="mini-track"><span class="mini-fill" style="width:' + pct + '%"></span></span>';
      box.appendChild(a);
    });
  }

  function wireAccount() {
    $("emailForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const m = $("emailMsg");
      const email = e.target.email.value.trim();
      if (!email) return;
      m.className = "field-msg";
      m.textContent = "Updating…";
      const { error } = await MTG.updateEmail(email);
      m.className = "field-msg " + (error ? "err" : "ok");
      m.textContent = error ? error.message : "✓ Check your new email to confirm the change.";
    });

    $("passwordForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const m = $("passwordMsg");
      const pw = e.target.password.value;
      if (pw.length < 6) { m.className = "field-msg err"; m.textContent = "Min 6 characters."; return; }
      m.className = "field-msg";
      m.textContent = "Updating…";
      const { error } = await MTG.updatePassword(pw);
      m.className = "field-msg " + (error ? "err" : "ok");
      m.textContent = error ? error.message : "✓ Password changed.";
      if (!error) e.target.reset();
    });

    $("exportBtn").addEventListener("click", async () => {
      const data = await MTG.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mtg-collection-export.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    $("deleteBtn").addEventListener("click", async () => {
      const m = $("dangerMsg");
      if (!confirm("Delete your account and all collection data permanently? This cannot be undone.")) return;
      if (!confirm("Really delete everything? Last chance.")) return;
      m.className = "field-msg";
      m.textContent = "Deleting…";
      const { error } = await MTG.deleteAccount();
      if (error) { m.className = "field-msg err"; m.textContent = error.message; return; }
      await MTG.signOut();
      alert("Your account has been deleted.");
      location.href = "index.html";
    });
  }
})();
