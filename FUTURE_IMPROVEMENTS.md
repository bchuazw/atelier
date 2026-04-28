# Future improvements — items needing human input

These are commercialization moves I (Claude) cannot ship end-to-end on my own
because they require account signups, dashboard configuration, billing setup,
brand decisions, or production secrets. The "Why deferred" line on each item
explains the specific blocker so a human can unblock it in one sitting.

Each item is sized as **S** (≤1h once unblocked), **M** (1-3h), or **L** (>3h).

---

## 1. Real auth replacing localStorage `workspace_id` — **L**

**Status:** highest-impact commercial gap. Current "identity" is a UUID in
`localStorage["atelier:workspace_id"]`. A user clearing browser data, switching
device, or using incognito loses access to their projects (data still exists
server-side but they can't list it). For paying customers this is unworkable.

**Why deferred:** needs you to:
- Enable Supabase Auth in the Supabase dashboard
- Pick provider mix (email/password? Google OAuth? GitHub OAuth?)
- Provide `SUPABASE_URL` + `SUPABASE_ANON_KEY` env vars on Render
- Provide `SUPABASE_JWT_SECRET` for backend JWT verification
- Decide: do existing localStorage workspaces auto-migrate to the first
  account that signs in from that browser? Or are they orphaned?

**Once unblocked I can ship:** `<SignInDialog>` + `useAuth` hook + backend
JWT-validation middleware + migration of `project.settings.workspace_id` →
`project.settings.user_id` + a one-time "claim your projects" flow for
existing users.

---

## 2. Error monitoring (Sentry) — **S**

**Status:** zero visibility into prod errors that don't surface to the UI.
A failed publish, a 500 on the fork SSE, a JS exception during canvas drag
— all silent today.

**Why deferred:** needs a Sentry account + DSN. Free tier covers 5K
events/month which is plenty for current scale.

**Once unblocked I can ship:** wire `@sentry/react` (frontend) +
`sentry-sdk[fastapi]` (backend), set `SENTRY_DSN` on Render, configure
release tagging via git SHA.

---

## 3. Billing + quota / soft paywall — **L**

**Status:** `cost_cap_cents` exists per-project but no global per-user limit
and no way to charge for usage. A free-tier user could rack up unlimited
Sonnet/Opus calls on your Anthropic bill.

**Why deferred:** needs you to:
- Sign up for Stripe (or Paddle / Lemon Squeezy)
- Decide pricing tiers (free quota? per-fork? per-month?)
- Provide `STRIPE_SECRET_KEY` + webhook secret
- Make pricing decisions: free tier limits, paid tier prices, what counts
  as a billable event (per fork? per million tokens? flat monthly?)
- Set up Tax / VAT collection if applicable

**Once unblocked I can ship:** Stripe Checkout integration, webhook
listener for subscription events, per-user `quota_used_cents` /
`quota_limit_cents` columns, hard cap with a "Upgrade" CTA when hit.

---

## 4. Marketing landing page at `/` — **M**

**Status:** the root currently dumps you straight into the app. Standard
SaaS pattern is hero + 3-feature row + signup CTA at `/`, app at `/app`.

**Why deferred:** needs your input on:
- Brand voice (premium / playful / technical?)
- Tagline (current sub-copy "Iterate on landing pages with AI" is OK
  but "marketing" — for the actual landing page you may want more punch)
- 3-5 feature bullets you want highlighted
- Pricing display (depends on item 3)
- Testimonials / social proof copy
- Hero image / video (a 30s screencast of the canvas in action would be
  ideal but I can't record one)

**Once unblocked I can ship:** the landing page route, the routing split
(`/` → marketing, `/app` → current EmptyState), and basic SEO meta
(`og:image`, `og:description`, structured data).

---

## 5. Custom domain — **S**

**Status:** currently `atelier-web.onrender.com`. Not commercializable.

**Why deferred:** needs you to:
- Buy a domain
- Add DNS records pointing at Render
- Configure SSL via Render dashboard

**Once unblocked I can ship:** update `VITE_API_BASE` build config,
update CORS allowlist, update share-URL minting in `_public_url_for_slug`,
update OpenAPI server URL.

---

## 6. Email transactional sends — **M**

**Status:** no email today. Commercial product needs at least:
- Welcome email on signup
- Password reset (depends on item 1)
- Quota-warning email at 80% (depends on item 3)
- Project shared notification (optional)

**Why deferred:** needs Resend / Postmark / SendGrid account + API key
+ verified sending domain (depends on item 5).

**Once unblocked I can ship:** template renderer, Resend API wrapper,
hooks at signup / quota-warning / share endpoints.

---

## 7. Privacy policy + Terms of Service — **S** (drafting) / **M** (legal review)

**Status:** none. Required by Stripe, App Store guidelines, GDPR/CCPA,
and basic enterprise procurement.

**Why deferred:** the *drafting* I can do (boilerplate from a template),
but you should have a lawyer review before publishing. Anything beyond
boilerplate (e.g. data residency promises) is a business decision.

**Once unblocked I can ship:** `/privacy` and `/terms` static pages
(Markdown-rendered), cookie consent banner if you target EU users.

---

## 8. CI/CD: tests run on every PR — **S**

**Status:** new pytest suite exists but doesn't run on push. Render
auto-deploys without verification — a broken test could ship to prod.

**Why deferred:** needs you to enable GitHub Actions on the repo (free
for public repos, paid for private over the free minutes quota). I can
write the workflow yaml but you may want to gate it behind a paid plan
decision if the repo is private and minutes-bound.

**Once unblocked I can ship:** `.github/workflows/test.yml` running
pytest + `npx tsc --noEmit` + (future) Vitest on every push, blocking
merges to main when red.

---

## 9. Production database backups — **M**

**Status:** Supabase provides daily backups on paid tiers. Currently
unknown which tier you're on.

**Why deferred:** needs you to verify Supabase backup config in their
dashboard, possibly upgrade to Pro for point-in-time recovery, decide
retention policy.

**Once unblocked I can ship:** a `pg_dump`-based local-export script + a
restore-runbook in `docs/`.

---

## 10. Status page / uptime monitoring — **S**

**Status:** no public status page. If the API goes down, users see a
silent failure.

**Why deferred:** needs a UptimeRobot / BetterUptime / Statuspage.io
account.

**Once unblocked I can ship:** `/healthz` endpoint that pings DB + a
status page widget in the EmptyState if the API is degraded.

---

## What I am NOT deferring (working on these now)

- **Plain-English diff summary** — uses your existing Anthropic key
- **Project archive UI** — server already supports, no UI gap
- **Onboarding tour** — pure frontend, no external services
- **Frontend test suite (Vitest)** — bedrock work, no signups needed
- **Backend test coverage expansion** — same
- **Better error visibility / loading states / empty states** — pure UX

I will keep this file updated. When you unblock any item above, ping me
and I'll implement it in the same session.
