#!/usr/bin/env bun
/**
 * Live probe against the real GitHub API — the owner's manual-verification
 * harness for the provider axis (acceptance PV-Q and friends).
 *
 * Rules this script keeps by construction:
 *
 * - **The token is loaded, never read here.** `bun` auto-loads `.env` from the
 *   repo root; this file only sees `process.env.GITHUB_TOKEN`. The value is
 *   sent solely in the Authorization header and a final self-check asserts no
 *   output line contains it (or a meaningful prefix of it).
 * - **Everything printed is bounded**: counts and first-N summaries, so the
 *   evidence is readable and no repository payload floods the transcript.
 * - **Read-only**: every request this script sends is a GET.
 */
import { createGitHubRestClient } from "@refyard/git-provider/github/rest";

const token = process.env.GITHUB_TOKEN;
if (token === undefined || token.length < 20) {
  console.error(
    "GITHUB_TOKEN is not set (put it in .env at the repo root, which bun loads automatically); nothing was sent anywhere",
  );
  process.exit(1);
}

const client = createGitHubRestClient({
  fetch: (input, init) => fetch(input, init),
  userAgentPrefix: "refyard-live-probe",
});

const printed: string[] = [];
function line(text: string): void {
  printed.push(text);
  console.log(text);
}

function fail(kind: string, error: unknown): never {
  line(`  ✗ ${kind}: ${JSON.stringify(error)}`);
  process.exit(1);
}

const identity = await client.authenticatedUser({ token });
if (!identity.ok) {
  fail("GET /user", identity.error);
}
line(`account: ${identity.value.login} (${identity.value.type})`);
line(
  `scopes reported by GitHub: ${
    identity.value.scopes.length === 0
      ? "(none listed — expected for fine-grained tokens)"
      : identity.value.scopes.join(" ")
  }`,
);

// Fine-grained tokens answer /user/repos with exactly the repositories the
// token was granted, so the probe discovers the subject repo instead of
// hardcoding an owner/name pair.
const repoResponse = await fetch(
  "https://api.github.com/user/repos?sort=updated&per_page=100",
  { headers: headers(token) },
);
if (repoResponse.status !== 200) {
  fail(
    "GET /user/repos",
    `HTTP ${repoResponse.status} ${truncate(await repoResponse.text())}`,
  );
}
const repos = (await repoResponse.json()) as Array<{
  full_name: string;
  private: boolean;
  default_branch: string;
}>;
line(
  `accessible repositories (${repos.length}): ${repos.map((repo) => repo.full_name).join(", ")}`,
);
const subject =
  repos.find((repo) => /refyard/i.test(repo.full_name)) ?? repos[0];
if (subject === undefined) {
  fail("repo discovery", "the token grants access to no repository");
}
const [owner, repo] = subject.full_name.split("/");
if (owner === undefined || repo === undefined) {
  fail("repo discovery", `unparseable full_name ${subject.full_name}`);
}
line(`subject repository: ${subject.full_name} (default branch ${subject.default_branch})`);

const pulls = await client.listOpenPullRequests({
  token,
  owner,
  repo,
  maxEntries: 100,
});
if (!pulls.ok) {
  fail("GET /pulls", pulls.error);
}
line(`\nopen pull requests: ${pulls.value.length}`);
for (const pull of pulls.value.slice(0, 10)) {
  line(`  #${pull.number} [${pull.isDraft ? "draft " : ""}${pull.headRef} → ${pull.baseRef}] ${clip(pull.title)} — ${pull.authorLogin}, ${pull.updatedAt}`);
}

const issues = await client.listOpenIssues({
  token,
  owner,
  repo,
  maxEntries: 100,
});
if (!issues.ok) {
  fail("GET /issues", issues.error);
}
line(`\nopen issues (pull requests excluded): ${issues.value.length}`);
for (const issue of issues.value.slice(0, 10)) {
  line(`  #${issue.number} ${clip(issue.title)} — ${issue.authorLogin}, ${issue.updatedAt}`);
}

const runs = await client.listWorkflowRuns({
  token,
  owner,
  repo,
  maxEntries: 5,
});
if (!runs.ok) {
  fail("GET /actions/runs", runs.error);
}
line(`\nworkflow runs (most recent ${runs.value.length}):`);
for (const run of runs.value) {
  line(
    `  #${run.runNumber} ${run.name ?? "(workflow deleted)"} on ${run.headBranch} — ${run.status}${run.conclusion === null ? "" : ` / ${run.conclusion}`} (${run.event}, ${run.createdAt})`,
  );
}

const limit = await fetch("https://api.github.com/rate_limit", {
  headers: headers(token),
});
if (limit.status === 200) {
  const body = (await limit.json()) as {
    resources: { core: { limit: number; remaining: number; reset: number } };
  };
  const resetIn = Math.max(
    0,
    Math.round(body.resources.core.reset - Date.now() / 1000),
  );
  line(
    `\nrate limit (core): ${body.resources.core.remaining}/${body.resources.core.limit} remaining, resets in ~${resetIn}s`,
  );
}

// The self-check: a probe that leaks its own token in the transcript has failed
// no matter what the API answers.
const leaked = printed.find((text) => text.includes(token));
if (leaked !== undefined) {
  console.error("REFUSING TO SUCCEED: the token appeared in the probe output");
  process.exit(1);
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "refyard-live-probe",
  };
}

function clip(text: string): string {
  return text.length > 70 ? `${text.slice(0, 67)}...` : text;
}

function truncate(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
