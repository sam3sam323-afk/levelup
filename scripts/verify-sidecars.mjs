import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "src-tauri/sidecars.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let failed = false;

for (const sidecar of manifest.sidecars) {
  const filePath = resolve(root, "src-tauri", sidecar.file.replace(/^binaries[\\/]/, "binaries/"));
  if (!existsSync(filePath)) {
    console.error(`[missing] ${sidecar.name}: ${filePath}`);
    failed = true;
    continue;
  }
  const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  if (digest !== sidecar.sha256) {
    console.error(`[mismatch] ${sidecar.name}: expected ${sidecar.sha256}, got ${digest}`);
    failed = true;
  } else {
    console.log(`[ok] ${sidecar.name} ${sidecar.version} ${digest}`);
  }
}

if (failed) process.exit(1);
console.log(`All ${manifest.sidecars.length} Windows x64 Sidecars verified for ${manifest.target}.`);
