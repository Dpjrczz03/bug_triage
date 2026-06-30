# AI Bug Triage & Release Operator 🚀

An agentic, AI-powered system designed to automate bug classification, prioritize developer workflows, synchronize issues with Linear, and generate dynamic release notes using the **Gemini API**.

---

## Features

### 1. Intelligent AI Triage (Gemini 2.5 Flash)
* **Automated Classification**: Automatically analyzes raw feedback from GitHub issues and classifies them into priorities: `P1 - Critical`, `P2 - High`, `P3 - Low`, `P4 - Backlog`.
* **Semantic Clustering**: Groups related feedback entries into common clusters (e.g. `Coupon Acceptance Failure`, `Add to Cart Redirect`).
* **Dynamic Repro Steps**: Semantically reads unstructured issues and generates clear, numbered reproduction steps.
* **Duplicate Detection**: Inspects existing active tickets to flag incoming duplicates and groups them together dynamically.

### 2. Bi-directional Integrations
* **Linear Auto-Creation**: Automatically creates simulated Linear tickets (e.g., `LNR-9044`) for critical `P1/P2` bugs.
* **GitHub Sync**: When an active ticket is marked as **Resolved** in the dashboard, the corresponding issue is automatically closed on your real GitHub repository.
* **Smart GitHub Ingestion**: Only active, open issues from your repo are ingested to keep the developer dashboard focused.

### 3. Dynamic Release Hub
* **Automated Release Notes**: Compiles resolved tickets into classified groups (Critical Bug Fixes, Feature Enhancements, Minor Fixes/Backlog).
* **Automatic Version Bumping**: Connects to the GitHub API, queries the latest release tag, and bumps the version automatically (e.g., `v1.0.0` $\rightarrow$ `v1.0.1`).
* **Release Readiness Score**: Dynamically calculates a health score based on remaining open blocker issues.
* **One-Click Draft Publish**: Publishes draft releases directly to your GitHub repository with generated release notes markdown.

---

## Technical Architecture

* **Backend**: Node.js, Express, TypeScript, `tsx`
* **Frontend**: HTML5, Vanilla CSS, JavaScript, Chart.js (Doughnut distribution charts)
* **LLM Engine**: Gemini 2.5 Flash via the OpenAI SDK compatibility layer
* **Database**: Lightweight persistent JSON datastore (`data/db.json`)

---

## Setup & Local Running Guide

### 1. Prerequisites
* **Node.js** (v18 or higher recommended)
* A **Gemini API Key** (Google AI Studio)
* A **GitHub Personal Access Token (PAT)** with repository edit permissions

### 2. Installation
Clone this repository to your local machine and install dependencies:
```bash
npm install
```

### 3. Configuration (.env)
Create a `.env` file in the root directory (based on `.env.example`) and fill in your credentials:
```env
# GitHub configuration
GITHUB_TOKEN=your_personal_access_token
GITHUB_REPO=username/repository_name

# Gemini API Key (Using OpenAI SDK compatibility layer)
OPENAI_API_KEY=your_gemini_api_key
```

### 4. Running Locally
Start the server using `tsx`:
```bash
npx tsx index.ts
```
The server will start listening on [http://localhost:3000](http://localhost:3000).

---

## Webhook Connection Setup

To enable real-time ingestion from GitHub (instead of manually clicking ingestion), setup a webhook tunnel:

### 1. Start a Local Tunnel
Run `ngrok` or a similar tunneling tool to expose port `3000` to a public URL:
```bash
ngrok http 3000
```
This will give you a public URL (e.g., `https://your-tunnel-subdomain.ngrok-free.app`).

### 2. Configure GitHub Webhook
1. Go to your GitHub repository Settings $\rightarrow$ **Webhooks** $\rightarrow$ **Add webhook**.
2. Enter the **Payload URL**: `https://your-tunnel-subdomain.ngrok-free.app/api/webhooks/github`
3. Set **Content type** to `application/json`.
4. Under "Which events would you like to trigger this webhook?", select **Let me select individual events** and check **Issues**.
5. Save the webhook. Now, opening or closing issues on GitHub will sync instantly to your local database!

---

## Production Deployment Guide (Linux VM)

If deploying to a Linux Virtual Machine (e.g. AWS EC2, DigitalOcean Droplet):

### 1. Manage with PM2
Install PM2 globally to run the Node server persistently in the background:
```bash
sudo npm install -g pm2
pm2 start npx -- tsx index.ts --name lemma
pm2 startup
pm2 save
```

### 2. Configure Nginx Reverse Proxy
To expose the app on port `80/443` and secure it with SSL, configure Nginx:
1. Copy the provided `nginx.conf` file to Nginx sites directory:
   ```bash
   sudo cp nginx.conf /etc/nginx/sites-available/lemma
   sudo ln -s /etc/nginx/sites-available/lemma /etc/nginx/sites-enabled/
   sudo rm /etc/nginx/sites-enabled/default
   ```
2. Edit `/etc/nginx/sites-available/lemma` to replace `yourdomain.com` with your VM IP or custom domain.
3. Test and reload Nginx:
   ```bash
   sudo nginx -t
   sudo systemctl restart nginx
   ```
4. Obtain free SSL certs using Let's Encrypt:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com
   ```
5. Update your GitHub Webhook URL to: `https://yourdomain.com/api/webhooks/github`.
