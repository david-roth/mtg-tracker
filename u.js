(function () {
  "use strict";

  const SETS = (window.SET_DATA && window.SET_DATA.sets) || [];
  const setByCode = {};
  SETS.forEach((s) => (setByCode[s.code] = s));
  const $ = (id) => document.getElementById(id);

  const username = new URLSearchParams(location.search).get("user");

  (async function init() {
    if (window.MTG) MTG.mountAccountBar($("account"));

    if (!window.MTG || !MTG.enabled) {
      return fail("Profiles aren't available", "Accounts aren't configured for this deployment.");
    }
    if (!username) return fail("No user specified", "This link is missing a username.");

    await MTG.ready;
    const profile = await MTG.getProfileByUsername(username);
    if (!profile) {
      return fail("Profile not found", "This user doesn't exist, or their profile is private.");
    }

    // header + head panel
    const display = profile.display_name || profile.username;
    document.title = display + " — MTG Set Tracker";
    $("pName").textContent = display;
    $("pSub").textContent = "@" + profile.username;
    $("pDisplay").textContent = display;
    $("pBio").textContent = profile.bio || "";
    if (profile.avatar_url) { $("pAvatar").src = profile.avatar_url; $("pAvatar").hidden = false; }

    // their collection (RLS lets us read a public user's rows)
    const counts = await MTG.countsBySet(profile.id);
    const codes = Object.keys(counts).filter((c) => counts[c] > 0);
    let totalOwned = 0;
    codes.forEach((c) => (totalOwned += counts[c]));
    $("pSummary").textContent = codes.length + " sets started · " + totalOwned + " cards collected";

    const box = $("overview");
    if (!codes.length) {
      box.innerHTML = '<p class="muted">No cards tracked yet.</p>';
    } else {
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
          '<span class="ov-name">' + MTG.escapeHtml(name) + "</span>" +
          '<span class="ov-stat">' + counts[code] + " / " + total + "</span>" +
          '<span class="mini-track"><span class="mini-fill" style="width:' + pct + '%"></span></span>';
        box.appendChild(a);
      });
    }

    $("status").hidden = true;
    $("profileView").hidden = false;
  })();

  function fail(title, detail) {
    const s = $("status");
    s.className = "status-state error";
    s.innerHTML =
      '<div class="status-title">' + title + "</div>" +
      '<div class="status-detail">' + detail + "</div>" +
      '<a class="ghost-btn" href="index.html">← All sets</a>';
  }
})();
