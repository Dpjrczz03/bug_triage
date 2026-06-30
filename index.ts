import express from 'express';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import localtunnel from 'localtunnel';

dotenv.config({ override: true });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Optional Gemini Client using OpenAI SDK compatibility
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
}) : null;

// Simple logging accumulator for UI terminal playback
let sessionLogs: string[] = [];
function log(msg: string) {
    console.log(msg);
    sessionLogs.push(msg);
}

// Local Database JSON file path
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Ensure db.json exists on startup
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
}

function loadDB(): any[] {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        }
    } catch (err) {
        console.error("Error reading db.json:", err);
    }
    return [];
}

function saveDB(data: any[]) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error("Error writing db.json:", err);
    }
}

// --- MOCK LEMMA SDK PRIMITIVES ---
class DocumentStore {
    insert(record: any) {
        const data = loadDB();
        data.push(record);
        saveDB(data);
    }
    
    query() {
        return loadDB();
    }

    clear() {
        saveDB([]);
    }

    updateStatus(id: string, status: string): boolean {
        const data = loadDB();
        const ticket = data.find(d => d.id === id);
        if (ticket) {
            ticket.status = status;
            saveDB(data);
            return true;
        }
        return false;
    }

    findSimilar(text: string) {
        const data = loadDB();
        const textLower = text.toLowerCase();
        // Extract words with length > 4 to compare, filtering common filler words
        const words = textLower.split(/\s+/)
            .map(w => w.replace(/[^a-zA-Z]/g, ''))
            .filter(w => w.length > 4 && !['about', 'after', 'again', 'could', 'would', 'should', 'there', 'their', 'these', 'where', 'which', 'button', 'crashes', 'working'].includes(w));
        
        return data.filter(d => {
            const ticketText = d.original_text.toLowerCase();
            return words.some(w => ticketText.includes(w));
        });
    }
}

class Agent {
    name: string;
    role: string;

    constructor(name: string, role: string) {
        this.name = name;
        this.role = role;
    }

    async process(input: string, context?: any): Promise<any> {
        log(`[Agent ${this.name}] Extracting intent, priority, and steps from text...`);
        
        if (openai) {
            try {
                const existingTicketsContext = context?.existingTickets && context.existingTickets.length > 0
                    ? `Here is a list of currently active tickets in the system:\n${JSON.stringify(context.existingTickets, null, 2)}\n`
                    : `No active tickets in system.\n`;

                const systemPrompt = `You are a ${this.role} in a software engineering team.
Analyze the following unstructured feedback (from Slack, GitHub, or Email).

${existingTicketsContext}

Extract:
1. Priority (Choose exactly one of: 'P1 - Critical', 'P2 - High', 'P3 - Low', 'P4 - Backlog')
2. Cluster (A short 2-4 word name grouping similar issues, e.g., 'Mobile Login Crash' or 'Stripe Payment Timeout')
3. Repro Steps (Clear numbered reproduction steps, or 'N/A' if it is a feature request)
4. Is Duplicate (Set to true if this feedback is a duplicate or reports the same core bug/issue as one of the active tickets listed above; otherwise false)

Format your response as a valid JSON object with the keys: "priority", "cluster", "repro_steps", "is_duplicate". Do not include any other markdown formatting.`;

                const completion = await openai.chat.completions.create({
                    model: "gemini-2.5-flash",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: input }
                    ],
                    response_format: { type: "json_object" }
                });

                const content = completion.choices[0].message.content;
                if (content) {
                    const parsed = JSON.parse(content);
                    return {
                        priority: parsed.priority || "P4 - Backlog",
                        cluster: parsed.cluster || "Uncategorized",
                        repro_steps: parsed.repro_steps || "Needs review",
                        is_duplicate: parsed.is_duplicate === true || parsed.is_duplicate === 'true' || (context?.similarIssues?.length > 0)
                    };
                }
            } catch (err: any) {
                log(`[OpenAI Error] ${err.message}. Falling back to rule-based engine...`);
            }
        }

        // Intelligent fallback rule-based parsing engine
        let priority = "P3 - Low";
        let cluster = "General Support";
        let repro_steps = "1. Open application.\n2. Trigger action related to issue.\n3. Observe reported behavior.";

        const lowerInput = input.toLowerCase();

        // 1. Determine priority based on severity keywords
        if (lowerInput.includes("crash") || lowerInput.includes("breakdown") || lowerInput.includes("fatal") || lowerInput.includes("security") || lowerInput.includes("vulnerability") || lowerInput.includes("emergency") || lowerInput.includes("critical")) {
            priority = "P1 - Critical";
        } else if (lowerInput.includes("error") || lowerInput.includes("fail") || lowerInput.includes("bug") || lowerInput.includes("exception") || lowerInput.includes("timeout") || lowerInput.includes("broken")) {
            priority = "P2 - High";
        } else if (lowerInput.includes("request") || lowerInput.includes("suggest") || lowerInput.includes("improve") || lowerInput.includes("dark mode") || lowerInput.includes("ui") || lowerInput.includes("theme")) {
            priority = "P3 - Low";
        } else {
            priority = "P4 - Backlog";
        }

        // 2. Extract cluster name from the first sentence or first 4 words of the input
        // Input format is usually: "Title - Body"
        const parts = input.split(" - ");
        const title = parts[0].trim();
        if (title) {
            // Clean common prefixes
            const cleanedTitle = title.replace(/^(bug|feature|issue|request|task|chore):\s*/i, '');
            // Take the first 4 words
            const words = cleanedTitle.split(/\s+/).slice(0, 4);
            cluster = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
        }

        // 3. Extract reproduction steps if a list exists in the input, otherwise template it
        const lines = input.split("\n");
        const listLines = lines.filter(line => line.trim().match(/^(\d+\.|- \[ \])/));
        if (listLines.length > 0) {
            repro_steps = listLines.map(line => line.trim()).join("\n");
        } else {
            repro_steps = `1. Navigate to the area affecting: ${cluster}.\n2. Perform actions described in: "${title}".\n3. Observe the issue.`;
        }

        return {
            priority,
            cluster,
            repro_steps,
            is_duplicate: context?.similarIssues?.length > 0
        };
    }
}

const dataStore = new DocumentStore();
const triageAgent = new Agent("TriageBot", "Senior QA Triage Engineer");
const releaseAgent = new Agent("ReleaseBot", "Release Manager");

// --- API ENDPOINTS ---

// Fetch live feedback issues from GitHub
app.get('/api/feedback', async (req, res) => {
    try {
        const token = process.env.GITHUB_TOKEN;
        const repo = process.env.GITHUB_REPO;
        if (token && repo) {
            const response = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'Lemma-Triage-Operator'
                }
            });
            if (response.ok) {
                const issues = await response.json();
                // Filter out pull requests (GitHub returns PRs as issues)
                const actualIssues = issues.filter((i: any) => !i.pull_request);
                return res.json({ github: actualIssues });
            } else {
                const errText = await response.text();
                log(`[GitHub API Error] Failed to fetch feedback issues: ${errText}`);
            }
        }
        res.json({ github: [] });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Update ticket status in database
app.post('/api/tickets/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Missing status field" });

    const tickets = dataStore.query();
    const ticket = tickets.find(t => t.id === id);
    if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
    }

    const success = dataStore.updateStatus(id, status);
    if (success) {
        log(`[Datastore] Ticket ${id} status updated to: ${status}`);

        // Bi-directional Sync: Close GitHub Issue if ticket is marked Resolved
        if (status === 'Resolved' && ticket.github_issue_number) {
            const token = process.env.GITHUB_TOKEN;
            const repo = process.env.GITHUB_REPO;
            if (token && repo) {
                log(`[GitHub API] Ticket ${id} resolved. Closing corresponding issue #${ticket.github_issue_number} on GitHub...`);
                try {
                    const response = await fetch(`https://api.github.com/repos/${repo}/issues/${ticket.github_issue_number}`, {
                        method: 'PATCH',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/vnd.github+json',
                            'X-GitHub-Api-Version': '2022-11-28',
                            'User-Agent': 'Lemma-Triage-Operator'
                        },
                        body: JSON.stringify({ state: 'closed' })
                    });
                    if (response.ok) {
                        log(`[GitHub API] Successfully closed GitHub Issue #${ticket.github_issue_number}.`);
                    } else {
                        const errText = await response.text();
                        log(`[GitHub API Error] Failed to close issue #${ticket.github_issue_number}: ${errText}`);
                    }
                } catch (err: any) {
                    log(`[GitHub API Error] Connection failed: ${err.message}`);
                }
            } else {
                log(`[GitHub API Simulation] Ticket ${id} resolved. Closed GitHub Issue #${ticket.github_issue_number} (Simulation mode).`);
            }
        }

        res.json({ success: true });
    } else {
        res.status(500).json({ error: "Failed to update status in store" });
    }
});

// Fetch All Existing Tickets
app.get('/api/tickets', (req, res) => {
    res.json({
        tickets: dataStore.query()
    });
});

// Run Ingestion and Batch Triage
app.post('/api/triage', async (req, res) => {
    try {
        sessionLogs = [];
        const token = process.env.GITHUB_TOKEN;
        const repo = process.env.GITHUB_REPO;

        if (!token || !repo) {
            log(`[Error] GitHub credentials not configured in .env. Cannot ingest live issues.`);
            return res.status(400).json({ error: "GitHub credentials not configured in .env." });
        }

        log("=== Starting Live GitHub Issue Ingestion ===");
        log(`Fetching open issues from repository: ${repo}...`);

        const response = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'Lemma-Triage-Operator'
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`GitHub API returned ${response.status}: ${errText}`);
        }

        const gitIssues = await response.json();
        // Filter out pull requests
        const allIssues = gitIssues.filter((i: any) => !i.pull_request);

        log(`Ingested ${allIssues.length} issues from GitHub.`);

        // Preserve any custom user-assigned local status changes
        const localStatusMap = new Map<number, string>();
        dataStore.query().forEach(t => {
            if (t.github_issue_number) {
                localStatusMap.set(t.github_issue_number, t.status);
            }
        });

        // Clear datastore to build fresh from current active GitHub issues
        dataStore.clear();

        const processedTickets = [];

        for (const item of allIssues) {
            log(`--- Analyzing GitHub Issue #${item.number} by ${item.user.login} ---`);
            
            const combinedText = `${item.title} - ${item.body || ''}`;
            const similarIssues = dataStore.findSimilar(combinedText);
            const existingTickets = dataStore.query().map(t => ({ id: t.id, text: t.original_text, cluster: t.cluster }));
            const analysis = await triageAgent.process(combinedText, { similarIssues, existingTickets });

            // Linear integration simulated ticket creation for P1/P2 issues
            let linearUrl = null;
            if (analysis.priority.includes("P1") || analysis.priority.includes("P2")) {
                const linearId = `LNR-${Math.floor(1000 + Math.random() * 9000)}`;
                linearUrl = `https://linear.app/demo/issue/${linearId}`;
                log(`[Linear Agent] Auto-created Linear Ticket: ${linearId} (Linked to P1/P2 bug)`);
            }

            // All ingested issues are open on GitHub; preserve local status if user changed it
            const finalStatus = localStatusMap.get(item.number) || 'Open';

            const ticket = {
                id: `TKT-${Math.floor(1000 + Math.random() * 9000)}`,
                original_text: combinedText,
                source: 'GitHub',
                author: item.user.login,
                status: finalStatus,
                linear_url: linearUrl,
                github_issue_number: item.number,
                ...analysis
            };

            if (ticket.is_duplicate) {
                log(`-> Marked as DUPLICATE of an existing issue in cluster: ${ticket.cluster}`);
                dataStore.insert(ticket);
            } else {
                log(`-> Created Ticket: ${ticket.id} | Priority: ${ticket.priority} | Cluster: ${ticket.cluster}`);
                dataStore.insert(ticket);
            }
            processedTickets.push(ticket);
        }

        res.json({
            tickets: processedTickets,
            activeTickets: dataStore.query(),
            logs: sessionLogs
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Incoming GitHub Issue Webhook
app.post('/api/webhooks/github', async (req, res) => {
    try {
        const { action, issue, text, author, title, body } = req.body || {};
        
        // Handle Issue Close Events
        if (action === 'closed' && issue) {
            const ticketNumber = issue.number;
            const data = dataStore.query();
            const ticket = data.find(t => t.github_issue_number === ticketNumber);
            if (ticket) {
                dataStore.updateStatus(ticket.id, 'Resolved');
                log(`[Webhook GitHub] Issue #${ticketNumber} was CLOSED on GitHub. Syncing status to Resolved.`);
                return res.json({ success: true, message: `Synced ticket ${ticket.id} status to Resolved.` });
            } else {
                log(`[Webhook GitHub] Received close event for Issue #${ticketNumber}, but no matching ticket was found in database.`);
                return res.json({ success: false, message: "No matching ticket found." });
            }
        }

        // Handle Issue Reopened Events
        if (action === 'reopened' && issue) {
            const ticketNumber = issue.number;
            const data = dataStore.query();
            const ticket = data.find(t => t.github_issue_number === ticketNumber);
            if (ticket) {
                dataStore.updateStatus(ticket.id, 'Open');
                log(`[Webhook GitHub] Issue #${ticketNumber} was REOPENED on GitHub. Syncing status to Open.`);
                return res.json({ success: true, message: `Synced ticket ${ticket.id} status to Open.` });
            }
        }

        // Handle standard issue creation / trigger
        const parsedTitle = title || (issue && issue.title) || "GitHub Bug Report";
        const parsedBody = body || (issue && issue.body) || "";
        const parsedAuthor = author || (issue && issue.user && issue.user.login) || "github_webhook";
        const combinedText = text || `${parsedTitle} - ${parsedBody}`;
        const issueNumber = (issue && issue.number) || null;

        log(`[Webhook GitHub] Received new webhook issue #${issueNumber}: "${parsedTitle}" from ${parsedAuthor}`);

        const similarIssues = dataStore.findSimilar(combinedText);
        const existingTickets = dataStore.query().map(t => ({ id: t.id, text: t.original_text, cluster: t.cluster }));
        const analysis = await triageAgent.process(combinedText, { similarIssues, existingTickets });

        let linearUrl = null;
        if (analysis.priority.includes("P1") || analysis.priority.includes("P2")) {
            const linearId = `LNR-${Math.floor(1000 + Math.random() * 9000)}`;
            linearUrl = `https://linear.app/demo/issue/${linearId}`;
            log(`[Linear Agent] Auto-created Linear Ticket: ${linearId}`);
        }

        const ticket = {
            id: `TKT-${Math.floor(1000 + Math.random() * 9000)}`,
            original_text: combinedText,
            source: 'GitHub Webhook',
            author: parsedAuthor,
            status: 'Open',
            linear_url: linearUrl,
            github_issue_number: issueNumber,
            ...analysis
        };

        if (ticket.is_duplicate) {
            log(`-> Marked as DUPLICATE of cluster: ${ticket.cluster}`);
            dataStore.insert(ticket);
        } else {
            log(`-> Created Ticket: ${ticket.id} | Priority: ${ticket.priority} | Cluster: ${ticket.cluster}`);
            dataStore.insert(ticket);
        }

        res.json({ success: true, ticket });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Incoming Slack Webhook
app.post('/api/webhooks/slack', async (req, res) => {
    try {
        const { text, user } = req.body || {};
        const author = user || "slack_webhook";

        if (!text) {
            return res.status(400).json({ error: "Missing message text in body." });
        }

        log(`[Webhook Slack] Received Slack webhook from ${author}: "${text.substring(0, 40)}..."`);

        const similarIssues = dataStore.findSimilar(text);
        const existingTickets = dataStore.query().map(t => ({ id: t.id, text: t.original_text, cluster: t.cluster }));
        const analysis = await triageAgent.process(text, { similarIssues, existingTickets });

        let linearUrl = null;
        if (analysis.priority.includes("P1") || analysis.priority.includes("P2")) {
            const linearId = `LNR-${Math.floor(1000 + Math.random() * 9000)}`;
            linearUrl = `https://linear.app/demo/issue/${linearId}`;
            log(`[Linear Agent] Auto-created Linear Ticket: ${linearId}`);
        }

        const ticket = {
            id: `TKT-${Math.floor(1000 + Math.random() * 9000)}`,
            original_text: text,
            source: 'Slack Webhook',
            author,
            status: 'Open',
            linear_url: linearUrl,
            ...analysis
        };

        if (ticket.is_duplicate) {
            log(`-> Marked as DUPLICATE of cluster: ${ticket.cluster}`);
        } else {
            log(`-> Created Ticket: ${ticket.id} | Priority: ${ticket.priority} | Cluster: ${ticket.cluster}`);
            dataStore.insert(ticket);
        }

        res.json({ success: true, ticket });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Generate release notes dynamically based on resolved issues
app.post('/api/release', async (req, res) => {
    try {
        const tickets = dataStore.query();
        if (tickets.length === 0) {
            return res.status(400).json({ error: "No tickets in database. Please run triage first." });
        }

        log("=== Starting Release Operator Workflow ===");
        log(`[Agent ${releaseAgent.name}] Analyzing ticket status constraints...`);

        const resolvedTickets = tickets.filter(t => t.status === 'Resolved');
        const openP1Count = tickets.filter(t => t.priority.includes("P1") && t.status !== 'Resolved').length;
        const openP2Count = tickets.filter(t => t.priority.includes("P2") && t.status !== 'Resolved').length;

        // Dynamic Release Readiness Score
        let readinessScore = 100 - (openP1Count * 25) - (openP2Count * 10);
        if (readinessScore < 0) readinessScore = 0;

        let releaseNotes = `# Release Notes - v1.4.0\n\n`;

        if (readinessScore < 70) {
            releaseNotes += `> [!WARNING]\n`;
            releaseNotes += `> **Release Blocked**: ${openP1Count} P1 and ${openP2Count} P2 open issues remaining. Fix critical blockers to secure production deployment stability.\n\n`;
        }

        releaseNotes += `We have successfully squashed several critical bugs and deployed highly requested features!\n\n`;
        
        releaseNotes += `## Critical Bug Fixes (P1 & P2)\n`;
        const bugsResolved = resolvedTickets.filter(t => t.priority.includes("P1") || t.priority.includes("P2"));
        if (bugsResolved.length > 0) {
            bugsResolved.forEach(t => {
                releaseNotes += `- **${t.cluster}**: Resolved an issue affecting users. (Reported by ${t.author} via ${t.source})\n`;
            });
        } else {
            releaseNotes += `_No major bug fixes resolved in this release._\n`;
        }

        releaseNotes += `\n## Feature Enhancements (P3)\n`;
        const p3Resolved = resolvedTickets.filter(t => t.priority.includes("P3"));
        if (p3Resolved.length > 0) {
            p3Resolved.forEach(t => {
                releaseNotes += `- **${t.cluster}**: Added new support. (Thanks ${t.author}!)\n`;
            });
        } else {
            releaseNotes += `_No new features deployed in this release._\n`;
        }

        releaseNotes += `\n## Minor Fixes & Backlog (P4)\n`;
        const p4Resolved = resolvedTickets.filter(t => t.priority.includes("P4"));
        if (p4Resolved.length > 0) {
            p4Resolved.forEach(t => {
                releaseNotes += `- **${t.cluster}**: Minor fix and backlog task resolved. (Reported by ${t.author} via ${t.source})\n`;
            });
        } else {
            releaseNotes += `_No minor fixes in this release._\n`;
        }

        const metrics = {
            totalBugsResolved: resolvedTickets.filter(t => t.priority.includes("P1") || t.priority.includes("P2") || t.priority.includes("P4")).length,
            totalFeaturesDeployed: p3Resolved.length,
            priorityDistribution: {
                P1: tickets.filter(t => t.priority.includes("P1")).length,
                P2: tickets.filter(t => t.priority.includes("P2")).length,
                P3: tickets.filter(t => t.priority.includes("P3")).length,
                P4: tickets.filter(t => t.priority.includes("P4")).length
            },
            releaseReadinessScore: readinessScore,
            hasBlockingBugs: openP1Count > 0
        };

        res.json({
            releaseNotes,
            metrics,
            logs: sessionLogs
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Publish Release Notes to GitHub as a Draft Release
app.post('/api/release/publish', async (req, res) => {
    try {
        const { releaseNotes } = req.body;
        if (!releaseNotes) {
            return res.status(400).json({ error: "Missing release notes content." });
        }

        const token = process.env.GITHUB_TOKEN;
        const repo = process.env.GITHUB_REPO;

        log(`[GitHub Publisher Agent] Initiating draft release publication...`);

        if (token && repo) {
            log(`[GitHub API] Connecting to repository: ${repo}...`);
            const url = `https://api.github.com/repos/${repo}/releases`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Lemma-SDK-Hackathon-Triage-Agent'
                },
                body: JSON.stringify({
                    tag_name: `v1.4.0-draft-${Math.floor(100 + Math.random() * 900)}`,
                    target_commitish: 'main',
                    name: 'v1.4.0 Release Notes (AI Compiled)',
                    body: releaseNotes,
                    draft: true,
                    prerelease: false
                })
            });

            if (response.ok) {
                const releaseData: any = await response.json();
                log(`-> [GitHub API] Draft Release successfully pushed: ${releaseData.html_url}`);
                return res.json({ success: true, url: releaseData.html_url, mode: 'production' });
            } else {
                const errMsg = await response.text();
                log(`-> [GitHub API] Request failed: ${errMsg}`);
                throw new Error(`GitHub API failed: ${errMsg}`);
            }
        } else {
            // Local simulation fallback
            log(`[GitHub Publisher Agent] Running in Local Mode (No keys configured in .env).`);
            log(`-> [Simulated Publication] Draft Release created successfully.`);
            log(`-> Target Repository: dhruv/lemma`);
            log(`-> Draft URL: https://github.com/dhruv/lemma/releases/tag/v1.4.0-draft-simulated`);
            
            return res.json({
                success: true,
                url: 'https://github.com/dhruv/lemma/releases/tag/v1.4.0-draft-simulated',
                mode: 'simulation'
            });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    
    // Automatically establish a public tunnel for webhooks
    try {
        const tunnel = await localtunnel({ port: PORT as number });
        console.log(`[Tunnel Agent] Public Webhook Tunnel is active: ${tunnel.url}`);
        tunnel.on('close', () => {
            console.log('[Tunnel Agent] Webhook tunnel closed.');
        });
    } catch (err: any) {
        console.error(`[Tunnel Agent] Failed to start tunnel: ${err.message}`);
    }
});
