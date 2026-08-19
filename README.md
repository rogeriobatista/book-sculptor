# Book Sculptor

Web micro-SaaS for writers: full book projects, typographic formatting, multi-format export, and Stripe subscriptions. UI locales: **English**, **Português (Brasil)**, **Español**.

## Monorepo

```
apps/
  api/      # FastAPI + formatting engine
  web/      # Next.js + next-intl + Clerk
  worker/   # Export job poller
packages/
  i18n/     # Shared typographic labels
render.yaml # Render Blueprint
```

## Local development

### API

```bash
cd apps/api
python -m venv .venv
.\.venv\Scripts\activate   # Windows
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

With `AUTH_DEV_BYPASS=true`, call the API using:

`Authorization: Bearer dev:user_1:you@example.com`

### Web

```bash
cd apps/web
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:8000
# Set Clerk keys
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_URL=same` so the browser talks to Next, which proxies `/api/v1` to FastAPI (`API_INTERNAL_URL`).

## Public tunnel + Stripe webhooks (recommended)

Use **ngrok** (HTTPS URL for phones / remote tests) and **Stripe CLI** (forwards webhooks to your local API). Prefer this over binding to the home LAN.

### One-time setup

```powershell
winget install ngrok.ngrok
winget install Stripe.StripeCli
ngrok config add-authtoken <token>   # https://dashboard.ngrok.com/get-started/your-authtoken
stripe login
```

### Run

1. Start API (`:8000`) and Next (`:3000`) locally as usual.
2. From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-tunnel.ps1
```

This starts `stripe listen --forward-to 127.0.0.1:8000/api/v1/billing/webhook` (writes `STRIPE_WEBHOOK_SECRET` into `apps/api/.env` — restart the API after the first run) and `ngrok http 3000`.

3. Open the ngrok HTTPS URL on any device.
4. Add that URL in **Clerk** → Allowed origins / Redirect URLs.
5. For Checkout return URLs, set `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` to the ngrok host (or keep localhost if you only test billing on this PC).

Manual Stripe webhook only:

```bash
stripe listen --forward-to localhost:8000/api/v1/billing/webhook
# copy whsec_… into STRIPE_WEBHOOK_SECRET and restart the API
```

### Worker (optional locally)

```bash
cd apps/worker
set PYTHONPATH=..\api
python worker.py
```

Exports also run via FastAPI `BackgroundTasks` when the API creates a job.

## Plans

| Plan   | Books        | Export        | AI (Phase 2) |
|--------|--------------|---------------|--------------|
| Free   | 1            | Watermarked   | No           |
| Pro    | Soft unlimited | Clean       | Monthly quota |
| Studio | Soft unlimited | Priority    | Higher quota + collab |

## Deploy

Use [render.yaml](render.yaml): API + worker + Postgres + web. Configure Clerk, Stripe, and R2 secrets in the Render dashboard. Bind the API with `uvicorn ... --host 0.0.0.0 --port $PORT`.

## Phase roadmap

1. **Foundation** — done: auth (Clerk + local dev bypass), books/chapters, import, preview, export jobs, Stripe checkout/portal/webhooks, i18n en/pt-BR/es, Render blueprint
2. **Editor + AI** — TipTap autosave + chapter AI actions (`/api/v1/ai`) with plan quotas. Supports OpenAI cloud or any OpenAI-compatible endpoint (`LLM_BASE_URL`, e.g. Ollama / LM Studio / vLLM); offline stub when cloud has no API key
3. **Collab + versions** — book members + chapter version history/restore; realtime Yjs presence still to wire
4. **Marketplace** — multi-locale listings API; Stripe Connect checkout still to wire
