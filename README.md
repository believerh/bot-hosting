# CypherX Bot Platform

A full-stack bot-hosting platform where users can deploy, manage, and scale Node.js bots with coin-based payments via Paystack.

## Features

- **Bot Deployment** — Deploy from GitHub repos or ZIP uploads in seconds
- **Coin System** — Buy coins with Paystack (M-Pesa, cards, bank transfers)
- **Verified Bot Marketplace** — Pre-approved templates with one-click setup
- **Live Management** — Restart, stop, view real-time logs, configure env vars
- **Multi-User + Admin** — Separate accounts, coin wallets, admin oversight
- **PWA Ready** — Installable desktop app with dark/light theme
- **Responsive UI** — Works on mobile, tablet, and desktop

## Pricing

- **Deployment:** 10 coins per bot
- **Hosting:** 5 coins/day per running bot
- **Coin Packages:** 500 | 1,000 | 2,000 coins

## Tech Stack

| Layer | Tools |
|-------|-------|
| Frontend | Vanilla HTML / CSS / JavaScript |
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Auth | JWT + bcrypt |
| Payments | Paystack Inline JS + REST API |
| Hosting | Railway (or any Node host) |

## Prerequisites

- Node.js 18+ and npm
- A Paystack account (test or live)
- Git (for deployment)

## Local Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd "New folder"
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `backend/.env`:

```env
PORT=3001
JWT_SECRET=your-random-secret-string
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FRONTEND_ORIGIN=http://localhost:3000
PAYSTACK_BASE_URL=https://api.paystack.co
```

> Generate a secure JWT secret: `openssl rand -hex 32`

### 3. Run the server

```bash
npm start
# or for development with auto-reload
npm run dev
```

Open `http://localhost:3001` — the backend serves all frontend pages (`/`, `/dashboard`, `/settings`, etc.) and API routes under `/api/`.

## Deploy to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial CypherX deploy"
git remote add origin https://github.com/YOUR_USERNAME/cypherx.git
git push -u origin main
```

### 2. Deploy

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your repo
3. Railway auto-detects `railway.toml`:
   - **Build:** `cd backend && npm install`
   - **Start:** `cd backend && node server.js`

### 3. Set environment variables in Railway

| Variable | Value |
|----------|-------|
| `JWT_SECRET` | `openssl rand -hex 32` output |
| `PAYSTACK_SECRET_KEY` | `sk_test_...` or `sk_live_...` |
| `PAYSTACK_PUBLIC_KEY` | `pk_test_...` or `pk_live_...` |
| `FRONTEND_ORIGIN` | your Railway URL (e.g. `https://cypherx.up.railway.app`) |

Railway sets `PORT` automatically.

### 4. Update frontend config

In `js/script.js`, replace the placeholder Paystack public key:

```javascript
const CYPHERX_CONFIG = {
    paystackPublicKey: 'pk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    // ...
};
```

### 5. Configure Paystack webhook

In Paystack Dashboard → **Settings** → **Webhooks**:

```
https://your-railway-url.up.railway.app/api/payments/paystack-webhook
```

## Project Structure

```
New folder/
├── backend/
│   ├── server.js          # Express API + static file server
│   ├── package.json
│   ├── .env.example
│   ├── railway.toml       # Railway deploy config
│   └── temp-uploads/      # Uploaded ZIPs (gitignored)
├── css/
│   └── style.css          # Full theme system (dark/light)
├── js/
│   └── script.js          # All frontend logic
├── icons/                 # PWA + favicon assets
├── manifest.json          # PWA manifest
├── dashboard.html         # Main app
├── login.html
├── register.html
├── settings.html
├── request.html
├── delete-account.html
├── varified-bot.html
└── README.md
```

## Key API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/register` | User registration |
| GET | `/api/dashboard/stats` | User stats (coins, bot count) |
| GET | `/api/dashboard/notifications` | List notifications |
| GET | `/api/deploy/verified-bots` | List verified bot templates |
| POST | `/api/deploy/scan-github` | Scan repo for config |
| POST | `/api/deploy/scan-upload` | Scan ZIP for config |
| POST | `/api/deploy/verified` | Deploy a verified bot |
| POST | `/api/payments/paystack-initiate` | Start Paystack payment |
| POST | `/api/payments/paystack-verify` | Verify Paystack payment |
| POST | `/api/payments/paystack-webhook` | Paystack webhook |

## Switching to Production

1. Replace `sk_test_` / `pk_test_` with `sk_live_` / `pk_live_` in Railway env vars and `js/script.js`
2. Update `FRONTEND_ORIGIN` to your live domain
3. Verify Paystack webhook is receiving events
4. Enable rate limiting and HTTPS (Railway handles this)

## Contributing

1. Fork the repo
2. Create a feature branch
3. Submit a pull request

## License

MIT
