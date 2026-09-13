# Setup — accounts, sync & deploy (free)

This app runs fine with **no setup** (collection saved in your browser). To enable
**user accounts, cross-device sync, profiles, and public profile pages**, connect a
free Supabase project. Total cost: **$0**.

## 1. Create a free Supabase project (~3 min)

1. Go to <https://supabase.com> and sign up (free).
2. **New project** → give it a name, set a database password (save it), pick a region near you.
3. Wait ~2 minutes for it to provision.

## 2. Load the database schema

1. In your project: **SQL Editor → New query**.
2. Open [`supabase/schema.sql`](supabase/schema.sql) from this repo, copy all of it, paste, and **Run**.
   - This creates the `profiles` and `collection` tables, security rules, and the
     signup trigger. It's safe to re-run.

## 3. Connect the app

1. In Supabase: **Project Settings → Data API** (or **API**). Copy:
   - **Project URL**
   - the **anon / publishable** key (NOT the `service_role` secret).
2. Paste both into [`config.js`](config.js).

That's it — reload the app and you'll have Sign up / Log in.

> The **anon key is meant for browsers and is safe to commit**; your data is protected
> by row-level security, not by hiding the key. Never put the `service_role` key in `config.js`.

## 4. (Optional) Email settings

By default Supabase requires email confirmation on signup. For a personal setup you can
turn confirmation off under **Authentication → Providers → Email** to skip the confirm step.

## 5. Deploy online for free

The frontend is static, so host it free and point it at your Supabase project.

**Cloudflare Pages (works with a private repo):**
1. <https://pages.cloudflare.com> → **Create → Connect to Git** → pick `mtg-tracker`.
2. Framework preset **None**, build command **empty**, output directory **`/`**.
3. Deploy. You'll get a `*.pages.dev` URL.
4. In Supabase → **Authentication → URL Configuration**, add that URL to **Site URL** /
   **Redirect URLs** so logins redirect correctly.

**GitHub Pages** works too, but the repo must be public (Settings → Pages → deploy from `main`).

## Free-tier note

Supabase's free tier pauses a project after ~7 days of inactivity; it resumes on your next
visit or from the dashboard. Fine for personal use.
