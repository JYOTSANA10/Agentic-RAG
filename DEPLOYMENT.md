# 🚀 Deployment Guide — Enterprise IT Support Copilot

This guide outlines how to deploy the **Enterprise IT Support Copilot** to live production environments.

---

## Deployment Options

| Platform | Best For | Estimated Cost | Setup Effort |
| :--- | :--- | :--- | :--- |
| **Render.com** | Free live demo / Portfolio | Free / \$7/mo | ⭐ Easy (Web Service) |
| **Railway.app** | Production / Scalable | \$5/mo trial | ⭐ Easy (Docker / Git) |
| **DigitalOcean / AWS VPS** | Dedicated enterprise server | \$4–\$12/mo | ⭐⭐ Medium (Docker Compose) |
| **Local Docker** | Local testing & verification | Free | ⭐ Easy (1 Command) |

---

## Option 1: Deploy Live on Render.com (Recommended for Portfolio Demo)

Render provides free hosting for web services and natively supports Node.js monorepos and Docker.

### Steps:
1. **Push your code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "feat: Enterprise IT Support Copilot ready for deployment"
   git remote add origin https://github.com/<your-username>/Enterprise-IT-Support-Agentic-RAG-Copilot.git
   git push -u origin main
   ```

2. **Create a Web Service on Render:**
   - Go to [dashboard.render.com](https://dashboard.render.com) and click **New + > Web Service**.
   - Connect your GitHub repository.
   - Choose **Docker** as the Environment (Render detects `Dockerfile` automatically) OR **Node**:
     - **Build Command:** `npm install && npm run build`
     - **Start Command:** `cd packages/backend && npx prisma db push && node dist/index.js`

3. **Configure Environment Variables:**
   Under **Environment Variables**, add:
   - `GROQ_API_KEY`: your Groq API key (`gsk_...`)
   - `GROQ_MODEL`: `qwen/qwen3.8-27b`
   - `PINECONE_API_KEY`: your Pinecone API key (`pcsk_...`)
   - `PINECONE_INDEX_NAME`: `it-copilot`
   - `PINECONE_NAMESPACE`: `company-it-kb`
   - `TAVILY_API_KEY`: your Tavily API key (`tvly-...`)
   - `JWT_SECRET`: 32+ character random secret
   - `ADMIN_API_KEY`: 32+ character random secret
   - `NODE_ENV`: `production`
   - `PORT`: `3001`

4. **Deploy:**
   Click **Create Web Service**. Within 3–5 minutes, your application will be live at `https://<your-service-name>.onrender.com`!

---

## Option 2: Deploy Live on Railway

1. Go to [railway.app](https://railway.app) and click **New Project > Deploy from GitHub Repo**.
2. Select your repository.
3. Railway will automatically detect the `Dockerfile`.
4. In the Railway dashboard under **Variables**, set the environment variables from your `.env`.
5. Under **Settings > Networking**, click **Generate Domain**.
6. Done! Your live app URL is generated automatically.

---

## Option 3: Deploy with Docker Compose (Local or Cloud VPS)

To spin up the entire application in a containerized environment with persistent volumes:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in your API keys in `.env`.
3. Build and launch:
   ```bash
   docker compose up --build -d
   ```
4. Access the application at `http://localhost:3001`.
5. View container logs:
   ```bash
   docker compose logs -f it-copilot
   ```

---

## Post-Deployment Verification

1. **Verify Health Endpoint:**
   ```bash
   curl https://<your-live-domain>/api/health
   # Expected response: {"status":"ok","timestamp":"..."}
   ```

2. **Create Admin User:**
   Connect via Render Shell / SSH and run:
   ```bash
   cd packages/backend
   ADMIN_EMAIL=admin@company.com ADMIN_PASSWORD=AdminPassword123! node scripts/create-admin.mjs
   ```

3. **Upload IT Knowledge Base:**
   - Log in at `https://<your-live-domain>/login` with your admin account.
   - Go to `/admin` and upload company runbooks/handbooks (PDF, TXT, DOCX).
   - Test questions in `/chat`!

