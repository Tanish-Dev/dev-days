// Extension: kanban-triage
// A focused Kanban board for prioritizing GitHub issues and adding them to the current session context.
//
// This single-file skeleton is a starting point. For more complex canvases
// (multiple actions with non-trivial logic, shared state, a custom renderer,
// etc.) prefer splitting things out: move each action handler into its own
// function, extract `open`/`onClose` into helpers, and pull large units
// (renderer assets, schema definitions, shared utilities) into sibling files
// imported from this entry point. Keep extension.mjs focused on wiring.

import { createServer } from "node:http";
import { URL } from "node:url";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const servers = new Map();
const repository = "Tanish-Dev/dev-days";

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function scoreIssue(issue) {
    const labels = issue.labels.map((label) => label.name.toLowerCase());
    let score = 0;
    if (labels.some((label) => label.includes("bug") || label.includes("security"))) score += 5;
    if (labels.some((label) => label.includes("urgent") || label.includes("priority"))) score += 4;
    if (issue.comments > 0) score += Math.min(issue.comments, 4);
    const daysSinceUpdate = (Date.now() - Date.parse(issue.updated_at)) / 86_400_000;
    if (daysSinceUpdate < 3) score += 3;
    else if (daysSinceUpdate < 14) score += 1;
    if (issue.state === "open") score += 1;
    return score;
}

function triageReason(issue) {
    const labels = issue.labels.map((label) => label.name.toLowerCase());
    const reasons = [];
    if (labels.some((label) => label.includes("bug") || label.includes("security"))) {
        reasons.push("it is marked as a bug or security concern");
    }
    if (labels.some((label) => label.includes("urgent") || label.includes("priority"))) {
        reasons.push("it carries a priority label");
    }
    if (issue.comments > 0) reasons.push(`it has ${issue.comments} ${issue.comments === 1 ? "comment" : "comments"}`);
    const daysSinceUpdate = Math.floor((Date.now() - Date.parse(issue.updated_at)) / 86_400_000);
    if (daysSinceUpdate < 3) reasons.push("it was updated recently");
    return reasons.length > 0 ? `Top priority because ${reasons.join(", ")}.` : "Top priority because it is an active open issue with the strongest current triage score.";
}

async function fetchIssues() {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues?state=open&per_page=50`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "kanban-triage-extension" },
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const issues = await response.json();
    return issues
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({ ...issue, triageScore: scoreIssue(issue), triageReason: triageReason(issue) }))
        .sort((a, b) => b.triageScore - a.triageScore || Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

function renderIssueCard(issue, featured) {
    return `<article class="card ${featured ? "featured" : ""}">
      <div class="card-top"><span class="number">#${issue.number}</span><span class="score">Score ${issue.triageScore}</span></div>
      <h3><a href="${escapeHtml(issue.html_url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a></h3>
      <p>${escapeHtml(issue.body || "No description provided.")}</p>
      ${featured ? `<p class="reason"><strong>Why it is here:</strong> ${escapeHtml(issue.triageReason)}</p>` : ""}
      <div class="meta">${issue.labels.map((label) => `<span class="label">${escapeHtml(label.name)}</span>`).join("")}<span>${issue.comments} comments</span></div>
      <button data-testid="add-issue-${issue.number}" data-issue-number="${issue.number}" type="button">Add to current context</button>
    </article>`;
}

function renderHtml(instanceId) {
    return `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Issue triage board</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: var(--background-color-default, #0d1117); color: var(--text-color-default, #f0f6fc); font: 14px/1.5 var(--font-sans, system-ui, sans-serif); }
  h1 { margin: 0 0 4px; font-size: 24px; } h2 { margin: 28px 0 12px; font-size: 16px; }
  .intro { color: var(--text-color-muted, #8b949e); margin: 0 0 20px; }
  .board { display: grid; gap: 12px; } .card { border: 1px solid var(--border-color-default, #30363d); border-radius: 10px; padding: 16px; background: #161b22; }
  .featured { border-color: var(--true-color-blue, #58a6ff); } .card-top, .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .number { color: var(--text-color-muted, #8b949e); } .score { margin-left: auto; color: #79c0ff; font-size: 12px; }
  h3 { margin: 8px 0; font-size: 16px; } a { color: #79c0ff; text-decoration: none; } a:hover { text-decoration: underline; }
  p { margin: 8px 0 12px; white-space: pre-wrap; } .reason { color: #d2a8ff; font-size: 13px; }
  .meta { color: var(--text-color-muted, #8b949e); font-size: 12px; margin-bottom: 14px; } .label { background: #21262d; border-radius: 999px; padding: 2px 8px; }
  button { border: 0; border-radius: 6px; padding: 8px 12px; background: #238636; color: white; cursor: pointer; font: inherit; }
  button:hover { background: #2ea043; } button:focus-visible { outline: 2px solid var(--color-focus-outline, #58a6ff); outline-offset: 2px; }
  button:disabled { cursor: wait; opacity: .7; } .status { min-height: 22px; color: #7ee787; margin: 14px 0 0; }
</style></head>
<body data-instance-id="${escapeHtml(instanceId)}">
  <h1>Issue triage board</h1><p class="intro">The top three issues are ranked by urgency signals, recent activity, labels, and discussion.</p>
  <div id="status" class="status" role="status" aria-live="polite"></div>
  <main id="board"><p>Loading open issues...</p></main>
  <script>
    const board = document.querySelector("#board");
    const status = document.querySelector("#status");
    const card = (issue, featured) => ${renderIssueCard.toString()}(issue, featured);
    const escapeHtml = ${escapeHtml.toString()};
    const load = async () => {
      try {
        const response = await fetch("/api/issues");
        if (!response.ok) throw new Error("Unable to load issues");
        const issues = await response.json();
        board.innerHTML = issues.length
          ? '<section><h2>Needs attention now</h2><div class="board">' + issues.slice(0, 3).map(issue => card(issue, true)).join("") + '</div></section>' +
            (issues.length > 3 ? '<section><h2>Remaining open issues</h2><div class="board">' + issues.slice(3).map(issue => card(issue, false)).join("") + '</div></section>' : '')
          : "<p>No open issues found.</p>";
        document.querySelectorAll("button[data-issue-number]").forEach(button => button.addEventListener("click", async () => {
          button.disabled = true; status.textContent = "Adding issue to the current context...";
          const result = await fetch("/api/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: Number(button.dataset.issueNumber) }) });
          const payload = await result.json();
          status.textContent = result.ok ? payload.message : "Could not add the issue: " + payload.message;
          button.disabled = false;
        }));
      } catch (error) { board.innerHTML = "<p>Could not load issues. " + escapeHtml(error.message) + "</p>"; }
    };
    load();
  </script>
</body>
</html>`;
}

async function startServer(instanceId) {
    const server = createServer(async (req, res) => {
        const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
        try {
            if (requestUrl.pathname === "/api/issues") {
                const issues = await fetchIssues();
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(issues));
                return;
            }
            if (requestUrl.pathname === "/api/add" && req.method === "POST") {
                let body = "";
                for await (const chunk of req) body += chunk;
                const issueNumber = JSON.parse(body).number;
                const issues = await fetchIssues();
                const issue = issues.find((candidate) => candidate.number === issueNumber);
                if (!issue) throw new Error("Issue was not found among open issues.");
                await session.send({ prompt: `Work on GitHub issue #${issue.number}: ${issue.title}\n\n${issue.body || "No description provided."}\n\nIssue URL: ${issue.html_url}` });
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ message: `Issue #${issue.number} added to the current context.` }));
                return;
            }
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(renderHtml(instanceId));
        } catch (error) {
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ message: error instanceof Error ? error.message : "Unexpected error" }));
        }
    });
    // Port 0 = let the OS pick a free ephemeral port. Bind to loopback only.
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "kanban-triage",
            displayName: "Issue triage board",
            description: "A Kanban board that ranks open GitHub issues and adds selected issues to the current session context.",
            actions: [
                {
                    name: "add_issue_to_context",
                    description: "Add an open issue to the current session context so work can begin immediately.",
                    inputSchema: {
                        type: "object",
                        properties: { number: { type: "integer", minimum: 1 } },
                        required: ["number"],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        const issues = await fetchIssues();
                        const issue = issues.find((candidate) => candidate.number === ctx.input.number);
                        if (!issue) throw new Error("Issue was not found among open issues.");
                        await session.send({ prompt: `Work on GitHub issue #${issue.number}: ${issue.title}\n\n${issue.body || "No description provided."}\n\nIssue URL: ${issue.html_url}` });
                        return { number: issue.number, message: `Issue #${issue.number} added to the current context.` };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: "Issue triage board",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
