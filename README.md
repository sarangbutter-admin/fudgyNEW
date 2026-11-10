# BakeByCulture: cookie box shop

A ready-to-deploy ordering website for a cookie shop.

* **Customers** build a box, order (pickup or delivery), pay by bank transfer / e-wallet and upload proof, track the order, edit or cancel it until it is paid, report a problem, rate the cookies and leave reviews.
* **The owner** (at `/#admin`) accepts payments, moves orders through every status, prints labels and bake sheets, edits flavors, stock, prices, flash sales, coupons, boxes, extras, banners and every page of the site, and gets a sound + popup when a new order, payment proof or complaint arrives.

No build step. No frameworks. The site is plain files in `site/`, the backend is Supabase (Postgres + Auth + Storage), the host is Netlify.

```
site/                 <- CUSTOMER shop (Netlify site 1). Contains no admin code or links.
admin-site/           <- TEAM site: owner + staff sign-in and admin (Netlify site 2, separate address)
src/                  <- the source both sites are built from (edit here, then run: node tools/build.js)
supabase/migrations/  <- the database (run both files once, in order)
netlify.toml          <- settings for the customer site (admin-site/netlify.toml is for the team site)
tools/build.js        <- builds site/ and admin-site/ from src/
```

**Two sites, one database.** Customers use the shop address. The owner and staff use a different, unlisted address (for example `bakebyculture-team.netlify.app`, or a hard-to-guess name). The shop does not link to it, does not contain its code, and `/#admin` on the shop just shows the shop. The team site is marked `noindex` (search engines are told to stay away).

If `config.js` is left empty the site runs in **demo mode**: everything is stored in the visitor's own browser and nothing is shared. Handy for trying things out, never use it for real customers.

---

## Set-up (about 20 minutes)

### 1. Supabase (the database)

1. Create a project at <https://supabase.com> (any region close to your customers). Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole file `supabase/migrations/20260101000000_bakebyculture_schema.sql`, press **Run**. Then do the same with `20260102000000_roles_customers.sql` (staff roles + customer list) `20260103000000_hardening.sql` (tighter permissions) `20260104000000_storage_select.sql` (picture uploads) `20260105000000_badges_reviews.sql` (badges, best sellers, buyer-only reviews) `20260106000000_team_log.sql` (staff usernames, access checkboxes, activity log, owner password) `20260107000000_order_flow.sql` (order status rules: payment proof + owner approval, forward-only steps, courier + airway bill for delivery, only owners can go back, edit or cancel once ready) and `20260108000000_reject_approval.sql` (staff rejecting a payment proof also needs owner approval) and `20260109000000_step_rules.sql` (no skipping steps, nothing moves on before payment is confirmed) and `20260110000000_ship_options.sql` (Sameday shipment, Pickup and Scheduled delivery, each with an on/off switch and a lead time) and `20260111000000_free_delivery_promo.sql` (scheduled Free delivery promos in Flash sales) and `20260112000000_pay_deadline.sql` (time to pay follows the order's due time: the earlier of the usual payment window and the due time minus the lead time, never under the minimum; sameday gets its own short window; times that are too soon are refused). and `20260113000000_refund_visitors.sql` (owner-only visitor numbers; owner can mark a paid order as refunded, and the customer sees it in the bell and their order history). and `20260114000000_sales_performance.sql` (orders remember who cancelled them and whether Random/Shuffle was used, for the dashboard Sales and Performance tabs). and `20260115000000_owner_only_delete.sql` (only an owner account can delete flavors, extras, box sizes and categories). and `20260116000000_time_slots.sql` (one-hour time slot boxes on a 24-hour clock, each with on/off and a daily limit that only paid orders use up). and `20260117000000_gifts.sql` (Gifts promos in Flash sales: free items with certain boxes, always-given or random; saved on the order). and `20260118000000_biteship.sql` (optional Biteship courier prices and booking; does nothing until switched on), `20260119000000_google_geocode.sql` (optional Google Maps key) and `20260120000000_place_photo.sql` (optional note for the driver and photo of the place). All are safe to run again later.
3. Create your owner login: **Authentication → Users → Add user → Create new user**. Enter your email and a long password, and tick **Auto Confirm User**.
4. Tell the database that this email is the owner. In **SQL Editor** run (use your own email):
   ```sql
   insert into public.admins (email, role) values ('you@example.com', 'owner');
   ```
   Only emails in this list can sign in to the team site. Later you can add staff from the **Team** tab (no SQL needed).
5. **Turn off public sign-ups** so strangers can't create accounts: **Authentication → Sign In / Providers → "Allow new users to sign up" → OFF**. (Even if someone did sign up, they would not be an owner. This is a second lock.)
6. Copy your keys: **Project Settings → API**. You need the **Project URL** and the **anon / publishable key**. Both are safe to publish; the database only lets visitors call the public shop functions.

### 2. Put the keys in the site

Edit `src/config.js` (then run `node tools/build.js`, which copies it into both sites):

```js
window.BAKEBYCULTURE_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-OR-PUBLISHABLE-KEY",
  shopUrl: "https://YOUR-SHOP-ADDRESS"   // team site only: the "View shop" button
};
```

Never put the `service_role` / secret key anywhere in this repo.

### 3. GitHub

Create an empty repository on GitHub, then in this folder:

```bash
git init
git add .
git commit -m "BakeByCulture shop"
git branch -M main
git remote add origin https://github.com/YOU/bakebyculture.git
git push -u origin main
```

### 4. Netlify (the host): two sites from the same repository

**Site 1: the customer shop**
1. **Add new site → Import an existing project → GitHub**, pick the repository.
2. Leave the build command empty. Base directory empty. Publish directory `site` (already set by `netlify.toml`).

**Site 2: the team site**
1. **Add new site → Import an existing project → GitHub**, pick the same repository.
2. Set **Base directory** to `admin-site`, build command empty, publish directory `.`. It reads `admin-site/netlify.toml`.
3. Give it a name that isn't obvious and don't link to it anywhere public.

Both sites skip builds of `main` and only build other branches (see "Previews without spending credits"). In Supabase go to **Authentication → URL Configuration** and set **Site URL** to the shop address. Add the team address under **Redirect URLs**.

### 5. First sign-in

Open the **team site** (not the shop), sign in with the owner email and password. The first time, the shop is filled with starter flavors, boxes and extras (no fake orders or reviews). Everything on the left menu is yours to edit. Add staff in **Team** and see everyone who ordered in **Customers**. Changes save automatically (look for "All changes saved" in the sidebar) and are live for customers within seconds.

First things to do in the admin:
* **Shop settings**: name, address, opening hours, delivery fee, order cut-off, **time zone**, payment window, closed days.
* **Shop settings → Payment methods**: your bank / e-wallet details and QR pictures (customers see these after they order).
* **Flavors, Boxes & extras**: replace the starter content.

### Staff and customers

* **Owner** can do everything. **Staff** can only work with orders (confirm payment, change status), complaints, shipping labels and the customer list. This is enforced inside the database, not just hidden in the screen.
* To add staff: **Team** tab → name, username, password, role name, and tick what they may do. They sign in on the team site with that username. You can change their access, set a new password or remove them (their login is deleted too).
* **Activity** (owners only): who did what and when. Entries older than 3 months are deleted automatically; owners can add notes, delete entries, or delete everything with their own password.
* Deleting a flavor, category, box size or extra, and changing any price, asks for the owner password (unlocked for 10 minutes). This is checked in the database too.
* **Customers**: every order saves the name and WhatsApp number automatically, once per number (`0812…` and `+62 812…` are the same customer). You can add a customer by hand (name + WhatsApp). Deleting is owner-only; a deleted customer returns automatically on their next order.

### 6. Optional

* **Cancel unpaid orders on the dot**: unpaid orders are cancelled (and their cookies put back in stock) whenever anyone opens the shop or the admin, which in practice is within seconds. For a guarantee even when nobody is online: **Database → Extensions → enable `pg_cron`**, then run  
  `select cron.schedule('bakebyculture-sweep', '* * * * *', $$select public.sweep_orders()$$);`
* **Backups**: Supabase keeps daily backups on paid plans. On the free plan, export your data now and then (**Database → Backups**, or `pg_dump`).

---

## How the security works

| Risk | What stops it |
| --- | --- |
| A visitor reading other people's orders, phone numbers or addresses | All tables are locked (row level security on, no access granted to the public roles). Visitors can only call specific functions. Each customer only gets their own orders, proven by a secret token that stays in their browser (stored hashed in the database). To open an order on another device they need the order code **and** the WhatsApp number (rate-limited). |
| A visitor changing prices, stock or shop content | Every price, discount, coupon, delivery fee, stock check and delivery date is recomputed **on the server** when an order is placed. The browser's total is only a "did the price change?" check. |
| Someone opening the admin | The admin lives on a separate, unlisted site that the shop doesn't link to or contain. It needs a Supabase login whose email is in the `admins` table, checked again inside every admin function (owner vs staff is enforced in the database). Public sign-ups are off. The database functions behind it can't be hidden from the internet, but they refuse everyone who isn't signed in as a team member. |
| Leaking unpromoted coupon codes | Customers only receive coupons the owner marked "show to customers". Other codes are checked one at a time by the server (rate-limited). |
| Fake payment proofs / photos with scripts | Only real JPG/PNG/WebP data under 1 MB is accepted. Pictures are stored apart from the order and shown only to the order's customer and the owner. |
| Script injection (XSS) | Everything is escaped before display, and the Content-Security-Policy in `netlify.toml` allows scripts from this site only (no inline scripts), so injected code can't run anyway. |
| Spam / bots | Per-minute limits on orders, tracking attempts, reviews, proofs and complaints; max 3 unpaid orders per phone number; a cap on total open unpaid orders so cookies can't be locked up by a bot (`maxOpenOrders` in settings, default 150). |
| Clickjacking, mixed content, sniffing | `X-Frame-Options`, `frame-ancestors`, HSTS, `nosniff`, strict referrer policy (all in `netlify.toml`). |

## Privacy notes

* Customer name, email, phone, address, payment proof and complaint photos are stored in your Supabase project only. Visitors never receive other customers' data.
* The site loads its two fonts from **Google Fonts**, which means Google sees visitors' IP addresses. If you want to avoid that, download the fonts (Unbounded, Instrument Sans), put them in `site/` with `@font-face` rules in `styles.css`, delete the two Google `<link>` tags in `index.html`, and remove the Google entries from the `Content-Security-Policy` in `netlify.toml`.
* Visit counting stores only a random id made by the browser (no IP address, no cookies).
* Owner pictures (flavor photos, banners) are uploaded to a **public** storage bucket named `shop-media`, so customers can see them. Do not upload anything private there.

## Things worth knowing

* **Messages to customers**: the admin logs every status message and gives you one-tap WhatsApp / email buttons (they open your own WhatsApp or mail app). Fully automatic sending needs a messaging service and is not included.
* **Time zone**: the order cut-off and the days customers can choose follow *Shop settings → Shop time zone* (default Asia/Jakarta), whatever the visitor's own time zone is.
* **Free-plan limits**: Supabase pauses free projects after a week without activity and has storage / bandwidth limits. For a real shop the Pro plan is recommended.
* **Draft and publish**: edits to Shop settings, Marquee banner and Landing page (and Top banner) stay in the owner's browser as a draft. A yellow bar shows "Not published yet" with **Publish changes** and **Discard changes**. Customers only see the published version. The Announcer and Top banner have their own Save & publish / Discard buttons too.
* **Updating the site**: edit files in `src/`, run `node tools/build.js`, commit `src/`, `site/` and `admin-site/`, `git push`, Netlify redeploys. For database changes, add a new file in `supabase/migrations/` and run it in the SQL editor.
* **Preview without Netlify**: `cd site && python3 -m http.server 8080`, then open <http://localhost:8080>.
* **Single-file preview**: `python3 tools/bundle.py` writes `dist/bakebyculture-single.html`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "We couldn't load the shop" | `config.js` URL / key wrong or the SQL file wasn't run. Open the browser console for details. |
| "This account isn't on the team" | The email isn't in `public.admins` (step 1.4), or differs in spelling. |
| "Could not find the function … in the schema cache" | Re-run the SQL file, then wait a few seconds (or **Project Settings → API → Reload schema**). |
| Pictures don't upload | Re-run the SQL file (it creates the `shop-media` bucket and its policies). |
| Customers see an empty shop | Sign in to `/#admin` once so the starter content is created. |

## Optional: Biteship courier delivery

Live courier prices at checkout, booking and tracking. It is **off by default**: with it off, customers pay your normal delivery fee and you use your own courier, exactly as before.

1. Run `supabase/migrations/20260118000000_biteship.sql` once (SQL Editor).
2. Deploy the two Edge Functions (Supabase CLI):
   ```
   supabase functions deploy biteship
   supabase functions deploy biteship-webhook --no-verify-jwt
   ```
   (`supabase/config.toml` already marks the webhook as public. It is protected by a secret in its address.)
3. Create a Biteship account and copy the **test** API key.
4. On the team site: **Delivery & courier → Courier delivery (Biteship)**. Paste the key, press **Save key**, **Test connection**, fill in your pickup details, choose couriers, **Save courier settings**, then switch it on.
5. In the Biteship dashboard add the webhook URL shown at the bottom of that panel.
   Optional: run `20260119000000_google_geocode.sql` and paste a Google Maps key (Geocoding API) in the same panel for more exact "Find my address on the map". Without it a free map service is used.
6. Test a delivery order with the test key. When happy, replace it with your live key.

Customers pick a courier at checkout (the price is signed by the server and checked again when the order is placed). After you confirm payment, press **Book courier now** on the order. Status and tracking show on the order for you and the customer.

## Tests that were run

The database file and the website were tested together against a real PostgreSQL 16 with a Supabase-compatible request layer, driving a real browser: ordering, price/stock/coupon enforcement, editing and cancelling orders, payment proof, tracking from another device, every owner status change with stock effects, complaints and replies, ratings, auto-cancel of unpaid orders, picture uploads, sign-in / sign-out, non-owner accounts, anonymous access to every table and admin function, and script-injection attempts. It has not been run against Supabase's own servers; follow the steps above and test one order end to end before announcing the shop.
