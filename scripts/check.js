import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["src", "tests", "scripts"];
const files = roots.flatMap(walk).filter((file) => file.endsWith(".js"));
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax check passed for ${files.length} files.`);

function walk(relativePath) {
  const absolutePath = path.resolve(relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(relativePath, entry.name);
    return entry.isDirectory() ? walk(next) : [next];
  });
}
