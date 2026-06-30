// Dashboard Client Logic
document.addEventListener("DOMContentLoaded", () => {
    // Navigation Nodes
    const navTriage = document.getElementById("nav-triage");
    const navRelease = document.getElementById("nav-release");
    const triagePanel = document.getElementById("triage-panel");
    const releasePanel = document.getElementById("release-panel");
    const pageTitle = document.getElementById("page-title");
    const pageSubtitle = document.getElementById("page-subtitle");

    // Triage Action Nodes
    const btnRunPipeline = document.getElementById("btn-run-pipeline");
    const consoleOutput = document.getElementById("console-output");
    const ticketsTableBody = document.getElementById("tickets-table-body");
    
    // Metrics Nodes
    const metricRawCount = document.getElementById("metric-raw-count");
    const metricTicketCount = document.getElementById("metric-ticket-count");
    const metricDupCount = document.getElementById("metric-dup-count");

    // Release Hub Nodes
    const btnGenerateRelease = document.getElementById("btn-generate-release");
    const btnCopyNotes = document.getElementById("btn-copy-notes");
    const releaseNotesView = document.getElementById("release-notes-view");
    const metricReadiness = document.getElementById("metric-readiness");
    const metricBugsSquashed = document.getElementById("metric-bugs-squashed");
    const metricFeatures = document.getElementById("metric-features");

    // Modal Nodes
    const ticketModal = document.getElementById("ticket-modal");
    const modalOverlay = document.getElementById("modal-overlay");
    const closeModal = document.getElementById("close-modal");
    const modalTicketId = document.getElementById("modal-ticket-id");
    const detailText = document.getElementById("detail-text");
    const detailPriority = document.getElementById("detail-priority");
    const detailCluster = document.getElementById("detail-cluster");
    const detailRepro = document.getElementById("detail-repro");
    const detailLinearRow = document.getElementById("detail-linear-row");
    const detailLinearLink = document.getElementById("detail-linear-link");
    const btnPublishGithub = document.getElementById("btn-publish-github");

    // Application State
    let ticketsStore = [];
    let activeTicketsStore = [];
    let releaseNotesMarkdown = "";
    let priorityChartInstance = null;

    // Undo Toast Nodes & State
    const undoToast = document.getElementById("undo-toast");
    const undoToastMessage = document.getElementById("undo-toast-message");
    const btnUndoToast = document.getElementById("btn-undo-toast");
    const undoToastTimer = document.getElementById("undo-toast-timer");

    let undoTimeout = null;
    let undoCountdown = null;
    let undoSecondsLeft = 5;
    let pendingTicketIdToClose = null;

    // Status helper function
    const getStatusClass = (status) => {
        if (status === 'Resolved') return 'status-resolved';
        if (status === 'In Progress') return 'status-progress';
        return 'status-open';
    };

    // Initialize metrics on load
    fetchRawDataCount();

    // Tab Navigation
    navTriage.addEventListener("click", (e) => {
        e.preventDefault();
        navTriage.classList.add("active");
        navRelease.classList.remove("active");
        triagePanel.classList.remove("hidden");
        releasePanel.classList.add("hidden");
        pageTitle.innerText = "Bug Triage Center";
        pageSubtitle.innerText = "Ingest, analyze, and cluster raw feedback logs in real-time.";
    });

    navRelease.addEventListener("click", (e) => {
        e.preventDefault();
        navRelease.classList.add("active");
        navTriage.classList.remove("active");
        releasePanel.classList.remove("hidden");
        triagePanel.classList.add("hidden");
        pageTitle.innerText = "Release Hub";
        pageSubtitle.innerText = "Analyze release metrics and generate publication-ready release logs.";
        
        // Auto-generate if we have tickets but no notes yet
        if (activeTicketsStore.length > 0 && !releaseNotesMarkdown) {
            generateReleaseNotes();
        }
    });

    // Fetch initial counts of raw data
    async function fetchRawDataCount() {
        try {
            const res = await fetch("/api/feedback");
            const data = await res.json();
            const rawCount = data.github ? data.github.length : 0;
            metricRawCount.innerText = rawCount;
        } catch (err) {
            console.error("Error fetching raw count:", err);
        }
    }

    // Trigger Triage Ingestion Batch Run
    btnRunPipeline.addEventListener("click", async () => {
        btnRunPipeline.disabled = true;
        btnRunPipeline.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;
        consoleOutput.innerHTML = "";

        try {
            const res = await fetch("/api/triage", { method: "POST" });
            const data = await res.json();
            
            ticketsStore = data.tickets;
            activeTicketsStore = data.activeTickets;

            // Stream logs visually to the terminal
            await streamLogs(data.logs);
            
            // Populate metrics & table
            updateTriageMetrics();
            populateTicketsTable();

            // Clear release cache to force refresh on next visit
            releaseNotesMarkdown = "";

        } catch (err) {
            consoleOutput.innerHTML = `<div class="console-log-line" style="color: var(--accent-rose)">Error running pipeline: ${err.message}</div>`;
        } finally {
            btnRunPipeline.disabled = false;
            btnRunPipeline.innerHTML = `<i class="fa-solid fa-play"></i> Run Ingestion & Triage`;
        }
    });



    // Stream logs to console with typewriter/delay effect
    function streamLogs(logs) {
        return new Promise((resolve) => {
            let index = 0;
            function printNext() {
                if (index < logs.length) {
                    const line = document.createElement("div");
                    line.className = "console-log-line";
                    
                    // Highlight specific logs
                    const text = logs[index];
                    if (text.startsWith("===")) {
                        line.style.color = "var(--accent-purple)";
                        line.style.fontWeight = "bold";
                    } else if (text.includes("Created Ticket")) {
                        line.style.color = "var(--accent-emerald)";
                    } else if (text.includes("Marked as DUPLICATE")) {
                        line.style.color = "var(--accent-rose)";
                    } else if (text.includes("[Agent")) {
                        line.style.color = "var(--accent-cyan)";
                    }
                    
                    line.textContent = text;
                    consoleOutput.appendChild(line);
                    consoleOutput.scrollTop = consoleOutput.scrollHeight;
                    index++;
                    setTimeout(printNext, 180); // 180ms delay per line for visualization
                } else {
                    resolve();
                }
            }
            printNext();
        });
    }

    function updateTriageMetrics() {
        // "GitHub Issues Synced" shows the total count of issues processed (including duplicates and resolved ones)
        metricRawCount.innerText = ticketsStore.length;

        // "Triage Tickets Created" shows the count of unique unresolved tickets currently in active triage
        const activeUnique = ticketsStore.filter(t => !t.is_duplicate && t.status !== 'Resolved');
        metricTicketCount.innerText = activeUnique.length;

        // "Duplicates Intercepted" shows all duplicate issues in the database
        const dups = ticketsStore.filter(t => t.is_duplicate).length;
        metricDupCount.innerText = dups;
    }

    function populateTicketsTable() {
        if (activeTicketsStore.length === 0) {
            ticketsTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="table-empty">
                        <i class="fa-solid fa-database"></i>
                        <p>No active tickets in datastore. Ingest feedback to populate.</p>
                    </td>
                </tr>
            `;
            return;
        }

        ticketsTableBody.innerHTML = "";
        
        // Filter out duplicates only (keep resolved tickets in table list)
        const visibleTickets = activeTicketsStore.filter(t => !t.is_duplicate);

        if (visibleTickets.length === 0) {
            ticketsTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state" style="text-align: center; padding: 40px 24px; color: var(--text-muted);">
                        <i class="fa-solid fa-circle-check" style="color: var(--accent-emerald); font-size: 28px; margin-bottom: 12px; display: block;"></i>
                        <strong>Queue Cleared!</strong>
                        <p style="margin: 8px 0 0 0; font-size: 13px;">No feedback logs or issues synced yet.</p>
                    </td>
                </tr>
            `;
            return;
        }

        visibleTickets.forEach(ticket => {
            const row = document.createElement("tr");
            
            // Format source badge
            const sourceIcon = ticket.source === "GitHub" ? "fa-github" : "fa-slack";
            
            // Format priority badge
            let priorityBadgeClass = "badge-p4";
            if (ticket.priority.includes("P1")) priorityBadgeClass = "badge-p1";
            else if (ticket.priority.includes("P2")) priorityBadgeClass = "badge-p2";
            else if (ticket.priority.includes("P3")) priorityBadgeClass = "badge-p3";

            // Format body length
            const textSummary = ticket.original_text.length > 50 
                ? ticket.original_text.substring(0, 50) + "..." 
                : ticket.original_text;

            // If ticket is Resolved, disable selector to lock it out
            const isResolved = ticket.status === 'Resolved';
            const statusSelectHtml = `
                <select class="status-select ${getStatusClass(ticket.status)}" data-id="${ticket.id}" ${isResolved ? 'disabled' : ''}>
                    <option value="Open" ${ticket.status === 'Open' ? 'selected' : ''}>Open</option>
                    <option value="In Progress" ${ticket.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                    <option value="Resolved" ${ticket.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                </select>
            `;

            const closeButtonHtml = isResolved
                ? ''
                : `<button class="btn-close-issue" data-id="${ticket.id}" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; border-radius: 4px; padding: 4px 8px; margin-left: 4px; font-size: 11px; cursor: pointer; transition: 0.2s;"><i class="fa-solid fa-circle-check"></i> Close</button>`;

            row.innerHTML = `
                <td><strong>${ticket.id}</strong></td>
                <td><i class="fa-brands ${sourceIcon}"></i> ${ticket.source}</td>
                <td>${textSummary}</td>
                <td><span class="badge-cluster">${ticket.cluster}</span></td>
                <td><span class="badge ${priorityBadgeClass}">${ticket.priority}</span></td>
                <td>${statusSelectHtml}</td>
                <td style="white-space: nowrap;">
                    <button class="btn-detail" data-id="${ticket.id}">View Details</button>
                    ${closeButtonHtml}
                </td>
            `;
            ticketsTableBody.appendChild(row);
        });

        // Add details click handlers
        document.querySelectorAll(".btn-detail").forEach(btn => {
            btn.addEventListener("click", () => {
                const ticketId = btn.getAttribute("data-id");
                const ticket = activeTicketsStore.find(t => t.id === ticketId);
                if (ticket) showTicketDetails(ticket);
            });
        });

        // Add Close Issue click handlers
        document.querySelectorAll(".btn-close-issue").forEach(btn => {
            btn.addEventListener("click", () => {
                const ticketId = btn.getAttribute("data-id");
                
                // If another ticket is already in undo state, resolve it immediately first
                if (pendingTicketIdToClose) {
                    executePendingClose();
                }

                startUndoFlow(ticketId);
            });
        });

        // Add status change handlers to sync with backend datastore
        document.querySelectorAll(".status-select").forEach(select => {
            select.addEventListener("change", async (e) => {
                const ticketId = select.getAttribute("data-id");
                const newStatus = e.target.value;

                try {
                    const res = await fetch(`/api/tickets/${ticketId}/status`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status: newStatus })
                    });
                    
                    if (res.ok) {
                        const ticket = activeTicketsStore.find(t => t.id === ticketId);
                        if (ticket) {
                            ticket.status = newStatus;
                        }
                        
                        // Dynamically update class
                        select.className = `status-select ${getStatusClass(newStatus)}`;
                        
                        // Clear release cache to force dynamic calculation of readiness score
                        releaseNotesMarkdown = "";

                        // Show visual confirmation inside terminal
                        const line = document.createElement("div");
                        line.className = "console-log-line";
                        line.style.color = newStatus === 'Resolved' ? "var(--accent-emerald)" : "var(--accent-amber)";
                        line.textContent = `[System] Ticket ${ticketId} status updated to: ${newStatus}`;
                        consoleOutput.appendChild(line);
                        consoleOutput.scrollTop = consoleOutput.scrollHeight;
                    } else {
                        alert("Failed to update status on server.");
                    }
                } catch (err) {
                    console.error("Error updating status:", err);
                }
            });
        });
    }

    // Modal Details Viewer
    function showTicketDetails(ticket) {
        modalTicketId.innerText = `Details for ${ticket.id}`;
        detailText.innerText = ticket.original_text;
        detailPriority.innerText = ticket.priority;
        
        let priorityBadgeClass = "badge-p4";
        if (ticket.priority.includes("P1")) priorityBadgeClass = "badge-p1";
        else if (ticket.priority.includes("P2")) priorityBadgeClass = "badge-p2";
        else if (ticket.priority.includes("P3")) priorityBadgeClass = "badge-p3";
        detailPriority.className = `badge ${priorityBadgeClass}`;

        detailCluster.innerText = ticket.cluster;
        detailRepro.innerText = ticket.repro_steps;

        if (ticket.linear_url) {
            detailLinearRow.classList.remove("hidden");
            detailLinearLink.href = ticket.linear_url;
            detailLinearLink.innerText = "Linear Ticket Link (Sync Active)";
        } else {
            detailLinearRow.classList.add("hidden");
        }

        ticketModal.classList.remove("hidden");
    }

    // Modal Close Trigger
    function hideModal() {
        ticketModal.classList.add("hidden");
    }
    closeModal.addEventListener("click", hideModal);
    modalOverlay.addEventListener("click", hideModal);

    // GitHub Release Publish Click Handler
    btnPublishGithub.addEventListener("click", async () => {
        if (!releaseNotesMarkdown) {
            alert("Please generate release notes first.");
            return;
        }

        btnPublishGithub.disabled = true;
        btnPublishGithub.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Publishing...`;
        let publishSuccess = false;

        try {
            const res = await fetch("/api/release/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ releaseNotes: releaseNotesMarkdown })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed draft release publication.");
            }

            const data = await res.json();
            
            // Output to visual console
            const line = document.createElement("div");
            line.className = "console-log-line";
            line.style.color = "var(--accent-purple)";
            line.style.fontWeight = "bold";
            line.textContent = `[GitHub] Draft Release published successfully: ${data.url}`;
            consoleOutput.appendChild(line);
            consoleOutput.scrollTop = consoleOutput.scrollHeight;

            publishSuccess = true;
            if (data.mode === 'simulation') {
                window.open('/mock-github-releases.html', '_blank');
            } else {
                window.open(data.url, '_blank');
            }

        } catch (err) {
            alert(`Error publishing to GitHub: ${err.message}`);
        } finally {
            btnPublishGithub.disabled = false;
            if (publishSuccess) {
                btnPublishGithub.innerHTML = `<i class="fa-solid fa-check"></i> Published!`;
                setTimeout(() => {
                    btnPublishGithub.innerHTML = `<i class="fa-brands fa-github"></i> Publish to GitHub`;
                }, 3000);
            } else {
                btnPublishGithub.innerHTML = `<i class="fa-brands fa-github"></i> Publish to GitHub`;
            }
        }
    });

    // Release Hub Trigger
    btnGenerateRelease.addEventListener("click", generateReleaseNotes);

    async function generateReleaseNotes() {
        btnGenerateRelease.disabled = true;
        btnGenerateRelease.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating...`;

        try {
            const res = await fetch("/api/release", { method: "POST" });
            const text = await res.text();
            
            let data;
            try {
                data = JSON.parse(text);
            } catch (parseErr) {
                throw new Error("Server returned an invalid response. Is the server running?");
            }
            
            if (!res.ok) {
                throw new Error(data.error || "Failed notes compilation.");
            }
            
            releaseNotesMarkdown = data.releaseNotes;
            localStorage.setItem("releaseNotes", releaseNotesMarkdown);

            // Render Markdown preview to HTML
            let htmlNotes = releaseNotesMarkdown
                .replace(/# (.*)/g, '<h1>$1</h1>')
                .replace(/## (.*)/g, '<h2>$1</h2>')
                .replace(/>\s\[!WARNING\]/g, '<div class="alert-warning-box">')
                .replace(/>\s\*\*(.*?)\*\*:\s(.*)/g, '<strong>$1</strong>: $2</div>')
                .replace(/-\s\*\*(.*?)\*\*:\s(.*)/g, '<li><strong>$1</strong>: $2</li>')
                .replace(/\n\n/g, '<br/>')
                .replace(/\n/g, '<br/>');
            
            // Cleanup list items
            htmlNotes = htmlNotes.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');

            releaseNotesView.innerHTML = htmlNotes;

            // Update Dynamic Metrics
            metricReadiness.innerText = `${data.metrics.releaseReadinessScore}%`;
            metricBugsSquashed.innerText = data.metrics.totalBugsResolved;
            metricFeatures.innerText = data.metrics.totalFeaturesDeployed;

            // Color indicator for readiness metric
            if (data.metrics.releaseReadinessScore < 70) {
                metricReadiness.style.color = "var(--accent-rose)";
            } else if (data.metrics.releaseReadinessScore < 90) {
                metricReadiness.style.color = "var(--accent-amber)";
            } else {
                metricReadiness.style.color = "var(--accent-emerald)";
            }

            // Render Chart
            renderChart(data.metrics.priorityDistribution);

        } catch (err) {
            releaseNotesView.innerHTML = `
                <div style="color: var(--accent-rose); text-align: center; padding: 20px;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 32px; margin-bottom: 8px;"></i>
                    <p>${err.message}</p>
                </div>
            `;
        } finally {
            btnGenerateRelease.disabled = false;
            btnGenerateRelease.innerHTML = `<i class="fa-solid fa-rotate"></i> Re-Generate`;
        }
    }

    // Render Distribution Chart via Chart.js
    function renderChart(distribution) {
        if (priorityChartInstance) {
            priorityChartInstance.destroy();
        }

        const ctx = document.getElementById('priorityChart').getContext('2d');
        priorityChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['P1 - Critical', 'P2 - High', 'P3 - Low', 'P4 - Backlog'],
                datasets: [{
                    label: 'Ticket Distribution',
                    data: [distribution.P1, distribution.P2, distribution.P3, distribution.P4],
                    backgroundColor: [
                        '#f43f5e', // P1 - Rose
                        '#f59e0b', // P2 - Amber
                        '#06b6d4', // P3 - Cyan
                        '#6b7280'  // P4 - Grey
                    ],
                    borderColor: 'rgba(18, 16, 28, 0.7)',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#9ca3af',
                            font: {
                                family: 'Inter',
                                size: 12
                            }
                        }
                    }
                }
            }
        });
    }

    // Copy to clipboard
    btnCopyNotes.addEventListener("click", () => {
        if (!releaseNotesMarkdown) return;
        navigator.clipboard.writeText(releaseNotesMarkdown).then(() => {
            const originalText = btnCopyNotes.innerHTML;
            btnCopyNotes.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
            setTimeout(() => {
                btnCopyNotes.innerHTML = originalText;
            }, 2000);
        });
    });

    // Fetch existing tickets from persistent store on page load
    async function fetchExistingTickets() {
        try {
            const res = await fetch("/api/tickets");
            if (!res.ok) throw new Error("Failed to load database");
            const data = await res.json();
            
            if (data.tickets && data.tickets.length > 0) {
                ticketsStore = data.tickets;
                activeTicketsStore = data.tickets;
                updateTriageMetrics();
                populateTicketsTable();
                
                const line = document.createElement("div");
                line.className = "console-log-line";
                line.style.color = "var(--accent-emerald)";
                line.textContent = `[Database] Loaded ${data.tickets.length} persistent tickets successfully.`;
                consoleOutput.appendChild(line);
                consoleOutput.scrollTop = consoleOutput.scrollHeight;
            }
        } catch (err) {
            console.error("Error fetching persistent tickets:", err);
        }
    }

    // Undo toast handler functions
    function startUndoFlow(ticketId) {
        pendingTicketIdToClose = ticketId;
        undoSecondsLeft = 5;
        
        undoToastMessage.innerHTML = `Ticket <strong>${ticketId}</strong> will disappear from dashboard and close on GitHub.`;
        undoToastTimer.innerText = `(${undoSecondsLeft}s)`;
        undoToast.classList.remove("hidden");

        // Countdown interval
        undoCountdown = setInterval(() => {
            undoSecondsLeft--;
            undoToastTimer.innerText = `(${undoSecondsLeft}s)`;
            if (undoSecondsLeft <= 0) {
                clearInterval(undoCountdown);
            }
        }, 1000);

        // Timeout to execute close
        undoTimeout = setTimeout(async () => {
            await executePendingClose();
        }, 5000);
    }

    async function executePendingClose() {
        if (!pendingTicketIdToClose) return;
        
        const ticketId = pendingTicketIdToClose;
        clearUndoState();

        try {
            // Optimistically update the UI dropdown to Resolved
            const selectEl = document.querySelector(`.status-select[data-id="${ticketId}"]`);
            if (selectEl) {
                selectEl.value = 'Resolved';
                selectEl.className = `status-select status-resolved`;
            }

            const res = await fetch(`/api/tickets/${ticketId}/status`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "Resolved" })
            });

            if (res.ok) {
                // Log to terminal feed
                const line = document.createElement("div");
                line.className = "console-log-line";
                line.style.color = "var(--accent-emerald)";
                line.textContent = `[System] Ticket ${ticketId} marked as Resolved and closed on GitHub.`;
                consoleOutput.appendChild(line);
                consoleOutput.scrollTop = consoleOutput.scrollHeight;
                
                // Clear release notes cache to force dynamic calculation of readiness score
                releaseNotesMarkdown = "";

                // Refresh list
                await fetchExistingTickets();
            }
        } catch (err) {
            console.error("Error executing pending close:", err);
        }
    }

    function clearUndoState() {
        if (undoTimeout) clearTimeout(undoTimeout);
        if (undoCountdown) clearInterval(undoCountdown);
        undoTimeout = null;
        undoCountdown = null;
        pendingTicketIdToClose = null;
        undoToast.classList.add("hidden");
    }

    btnUndoToast.addEventListener("click", () => {
        if (!pendingTicketIdToClose) return;

        const line = document.createElement("div");
        line.className = "console-log-line";
        line.style.color = "var(--accent-amber)";
        line.textContent = `[System] Close action for ticket ${pendingTicketIdToClose} cancelled.`;
        consoleOutput.appendChild(line);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;

        clearUndoState();
    });

    // Polling loop to fetch new webhook tickets every 5 seconds
    setInterval(async () => {
        // Only fetch if we are not actively counting down to prevent table re-renders during undo
        if (pendingTicketIdToClose) return;
        
        try {
            const res = await fetch("/api/tickets");
            if (res.ok) {
                const data = await res.json();
                if (data.tickets && data.tickets.length !== activeTicketsStore.length) {
                    ticketsStore = data.tickets;
                    activeTicketsStore = data.tickets;
                    releaseNotesMarkdown = ""; // Clear release notes cache on remote webhook update
                    updateTriageMetrics();
                    populateTicketsTable();
                    
                    const line = document.createElement("div");
                    line.className = "console-log-line";
                    line.style.color = "var(--accent-purple)";
                    line.textContent = `[Live Sync] Webhook sync completed. Total tickets: ${data.tickets.length}`;
                    consoleOutput.appendChild(line);
                    consoleOutput.scrollTop = consoleOutput.scrollHeight;
                }
            }
        } catch (err) {
            console.error("Polling error:", err);
        }
    }, 5000);
});
