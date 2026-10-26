import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(projectRoot, "desktop");
const runtimeDirectory = path.join(sourceDirectory, "runtime");
const stagedDesktopDirectory = path.join(runtimeDirectory, "desktop");
const files = [
  "main.cjs",
  "app-preload.cjs",
  "browser-preload.cjs",
  "browser-shell.html",
  "browser-shell.css",
  "browser-shell.js",
  "relay-server.cjs",
];

if (!existsSync(path.join(runtimeDirectory, "package.json"))) {
  throw new Error("Missing desktop/runtime/package.json; restore project dependencies before staging.");
}
for (const file of files) {
  if (!existsSync(path.join(sourceDirectory, file))) {
    throw new Error(`Cannot prepare the desktop package: desktop/${file} is missing.`);
  }
}

rmSync(stagedDesktopDirectory, { recursive: true, force: true });
mkdirSync(stagedDesktopDirectory, { recursive: true });
for (const file of files) {
  copyFileSync(path.join(sourceDirectory, file), path.join(stagedDesktopDirectory, file));
}

console.log(`Prepared isolated Electron app in ${path.relative(projectRoot, runtimeDirectory)} (${files.length} files).`);
