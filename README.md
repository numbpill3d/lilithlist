# ✦ SISTERNET ✦

**Community Safety Network for Sex Workers**

A fully encrypted, anonymous peer-to-peer safety platform for client ratings, venue intelligence, session check-ins, and community communication.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + React Router |
| Styling | Inline styles (Y2K aesthetic, no Tailwind dep) |
| Backend | Node.js + Express |
| Database | PostgreSQL (via Supabase or self-hosted) |
| Auth | JWT + bcrypt (no OAuth, no phone required) |
| Real-time | Supabase Realtime (alerts/forum) |

---

## Project Structure

```
sisternet/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── context/
│   │   └── styles/
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── middleware/
│   │   ├── models/
│   │   └── lib/
│   ├── server.js
│   └── package.json
├── supabase/
│   └── schema.sql
└── README.md
```

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/sisternet.git
cd sisternet
cd backend && npm install
cd ../frontend && npm install
```

### 2. Environment Variables

**backend/.env**
```
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/sisternet
JWT_SECRET=your_super_secret_256bit_key_here
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
ENCRYPTION_KEY=your_32_char_aes_key_here_32chars!
CORS_ORIGIN=http://localhost:5173
```

**frontend/.env**
```
VITE_API_URL=http://localhost:4000/api
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### 3. Database

```bash
psql -U postgres -d sisternet -f supabase/schema.sql
```

### 4. Run

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

App at http://localhost:5173

---

## Privacy & Security

- No real names or phone numbers required
- Invite code signup system
- AES-256 encryption on all PII fields
- JWT auth, 7-day expiry
- Rate limiting on all endpoints
- Row Level Security in Postgres
- Deployable as Tor hidden service

