import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(ROOT, "binaries", "win-x64");
const packaged = [
  { label: "yt-dlp", key: "yt-dlp.exe", executable: path.join(BIN, "yt-dlp.exe"), args: ["--version"], version: /2026\.10\.21/ },
  { label: "aria2c", key: "aria2/aria2c.exe", executable: path.join(BIN, "aria2", "aria2c.exe"), args: ["--version"], version: /aria2 version 1\.37\.0/i },
  { label: "FFmpeg", key: "ffmpeg/ffmpeg.exe", executable: path.join(BIN, "ffmpeg", "ffmpeg.exe"), args: ["-version"], version: /ffmpeg version N-127957-g935f29eaae/i },
];
const manifestPath = path.join(BIN, ".nexus-binaries-manifest.json");
if (!existsSync(manifestPath)) throw new Error("Windows binary manifest is missing. Run pnpm binaries:fetch first.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const useWine = process.platform !== "win32";

function run(executable, args) {
  const command = useWine ? "wine" : executable;
  const commandArgs = useWine ? [executable, ...args] : args;
  return spawnSync(command, commandArgs, { encoding: "utf8", timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  for (const item of packaged) {
    if (!existsSync(item.executable)) throw new Error(`Missing packaged ${item.label} binary: ${item.executable}`);
    const expected = manifest.binaries[item.key]?.sha256;
    if (!expected) throw new Error(`SHA-256 is absent from the manifest for ${item.label}.`);
    const actual = await sha256(item.executable);
    if (actual !== expected) throw new Error(`${item.label} binary SHA-256 mismatch. Expected ${expected}, received ${actual}.`);
    const result = run(item.executable, item.args);
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (result.error) throw new Error(`${item.label} did not start: ${result.error.message}`);
    if (result.status !== 0 || !item.version.test(output)) throw new Error(`${item.label} failed its real executable/version check (exit ${result.status}).\n${output.slice(0, 1800)}`);
    console.log(`Verified ${item.label} ${manifest.binaries[item.key].version}: ${actual}`);
  }

  const ffmpeg = packaged[2].executable;
  const buildconf = run(ffmpeg, ["-buildconf"]);
  if (buildconf.error || buildconf.status !== 0) throw new Error(`FFmpeg build configuration query failed: ${buildconf.stderr || buildconf.error?.message || buildconf.status}`);
  if (/--enable-gpl(?:\s|$)/m.test(`${buildconf.stdout}\n${buildconf.stderr}`)) throw new Error("The selected FFmpeg binary enables GPL components; this package expects the pinned LGPL build.");
  console.log("Verified FFmpeg build flags: no --enable-gpl flag found.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
