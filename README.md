# AI Smart Solver - Enterprise Backend Engine

Enterprise-grade Backend built with **Node.js, TypeScript, Express, Prisma (PostgreSQL), Playwright, noVNC, and Pluggable AI** designed for deployment on **Railway** and seamless connection to a Cloudflare Pages frontend.

---

## 🚀 Key Architectural Features

1. **Chromium & Playwright Isolation**:
   - Each student session runs in a segregated virtual display (`Xvfb`) and dedicated incognito context.
   - Built-in live stream via `x11vnc` & `websockify` (noVNC client integration).
   - Zero DOM interference with test security restrictions.

2. **Pluggable AI Architecture**:
   - Easily toggle between `Gemini`, `OpenAI`, `Anthropic`, or `Mock` provider at runtime.
   - Automatic token calculation and consumption tracking stored in `ai_usage`.

3. **High Security & Compliance**:
   - **Zero Plaintext Storage**: Passwords hashed with `bcrypt` (12 rounds); educational credentials encrypted with **AES-256-GCM**.
   - **SSRF Protection**: Strict IP filtering prevents SSRF and blocks access to cloud metadata endpoints (`169.254.169.254`) and private networks.
   - **Domain Whitelisting**: Playwright navigations are restricted to vetted educational portals.
   - **Rate Limiting**: Integrated `express-rate-limit` protects against abuse.

4. **Real-time WebSockets**:
   - Socket.IO with token-based authentication and isolated user rooms.
   - Live events: `browser:status`, `browser:started`, `browser:stopped`, `question:detected`, `ai:answer`, `task:progress`.

---

## 🛠️ Project Structure

```text
├── src/
│   ├── ai/            # Pluggable AI Provider implementations (Gemini, OpenAI, Mock)
│   ├── browser/       # Playwright browser manager, Xvfb/noVNC display isolation, SSRF security
│   ├── config/        # Environment configurations & OpenAPI/Swagger definitions
│   ├── controllers/   # REST Controllers (Auth, Browser, Platform, Questions, AI, Logs)
│   ├── database/      # Prisma Client connection
│   ├── middleware/    # JWT Authentication, Role Authorization, Zod Validation, Audit Logging
│   ├── routes/        # Express API Routers
│   ├── types/         # TypeScript definitions and interfaces
│   ├── utils/         # Crypto (AES-256-GCM), Winston Logger
│   ├── validators/    # Zod schema definitions
│   ├── websocket/     # Socket.IO real-time event manager
│   ├── app.ts         # Express App configuration
│   └── server.ts      # Server entrypoint with graceful shutdown
├── prisma/
│   └── schema.prisma  # PostgreSQL Schema with UUIDs, Enums, and Relations
├── tests/             # Unit and integration test suites
├── Dockerfile         # Multi-stage production container with Xvfb & noVNC
└── .env.example       # Sample environment configuration
```

---

## ⚙️ Environment Variables

Create a `.env` file based on `.env.example`:

```env
PORT=4000
NODE_ENV=development
JWT_SECRET=super-secret-jwt-key-min-32-chars
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/smart_solver?schema=public
REDIS_URL=redis://localhost:6379
AI_PROVIDER=gemini # or mock / openai
AI_API_KEY=your_key_here
AI_MODEL_NAME=gemini-1.5-pro
ALLOWED_DOMAINS=example.com,education.gov,khanacademy.org,coursera.org,quizlet.com
```

---

## 🏃 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate Prisma Client & Migrate
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:4000/api-docs](http://localhost:4000/api-docs) for Swagger documentation.

---

## 🧪 Testing

```bash
npm run test
```

---

## 🚢 Railway Deployment

1. Create a new project on [Railway](https://railway.app).
2. Provision a **PostgreSQL** database plugin.
3. Link this repository. Railway will detect the `Dockerfile` automatically.
4. Set the environment variables in Railway Dashboard (`JWT_SECRET`, `ENCRYPTION_KEY`, `AI_PROVIDER`, `AI_API_KEY`).
5. Set Healthcheck path to `/health`.
