import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import worker, { CRON, dispatchRun } from "../scheduler/worker.mjs";

const env = { GITHUB_OWNER: "o", GITHUB_REPO: "r", GITHUB_REF: "main", WORKFLOW: "news-broadcast.yml", GITHUB_ACTIONS_TOKEN: "t" };

test("dispatches the workflow with string inputs", async () => {
  const calls = [];
  const result = await dispatchRun(env, async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  });
  assert.deepEqual(result, { dispatched: true, status: 204 });
  assert.equal(calls[0].url, "https://api.github.com/repos/o/r/actions/workflows/news-broadcast.yml/dispatches");
  assert.deepEqual(JSON.parse(calls[0].init.body), { ref: "main", inputs: { dry_run: "false", force_digest: "false" } });
});

test("reports GitHub's reason when a dispatch is refused", async () => {
  await assert.rejects(
    dispatchRun(env, async () => new Response("Resource not accessible by personal access token", { status: 403 })),
    /HTTP 403.*Resource not accessible/
  );
});

test("the cron in wrangler.jsonc matches the worker", () => {
  const config = fs.readFileSync(new URL("../scheduler/wrangler.jsonc", import.meta.url), "utf8");
  assert.ok(config.includes(`"crons": ["${CRON}"]`));
  assert.equal(typeof worker.scheduled, "function");
});
