// Cloudflare Worker that starts the news broadcast on time.
//
// GitHub's own `schedule` trigger is best effort: in November 2026 the
// "every 10 minutes" cron fired about four times a day, at random hours. This
// worker asks GitHub to run .github/workflows/news-broadcast.yml every 15
// minutes, so digest cards go out at their slot and emergencies within
// minutes. It reads no news and posts nothing itself. GitHub's schedule stays
// in the workflow as a backup.
//
// Repeated runs are safe: the workflow's concurrency group queues them, a slot
// posts once (last_digest_slot in .state/news.db) and sent items are recorded.

export const CRON = "1,16,31,46 * * * *";

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required scheduler binding: ${name}`);
  return value;
}

export async function dispatchRun(env, fetchImpl = fetch) {
  const owner = required(env, "GITHUB_OWNER");
  const repo = required(env, "GITHUB_REPO");
  const ref = required(env, "GITHUB_REF");
  const workflow = encodeURIComponent(required(env, "WORKFLOW"));
  const token = required(env, "GITHUB_ACTIONS_TOKEN");
  const response = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "NewsBroadcastScheduler/1.0",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      // Inputs must be strings; "false" makes the run post like a scheduled one.
      body: JSON.stringify({ ref, inputs: { dry_run: "false", force_digest: "false" } }),
    },
  );
  if (!response.ok) {
    const requestId = response.headers.get("x-github-request-id");
    // GitHub's message (e.g. "Resource not accessible by personal access token") says what is wrong; it holds no secrets.
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`GitHub workflow dispatch failed with HTTP ${response.status}${requestId ? ` (request ${requestId})` : ""}: ${detail}`);
  }
  return { dispatched: true, status: response.status };
}

export default {
  async scheduled(controller, env, ctx) {
    if (controller.cron !== CRON) throw new Error(`Unregistered scheduler cron: ${controller.cron}`);
    ctx.waitUntil(
      dispatchRun(env).then((result) => {
        console.log(JSON.stringify({ event: "news_broadcast_dispatch", scheduledTime: controller.scheduledTime, ...result }));
      }),
    );
  },
};
