import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const sidecar = join(repoRoot, "src-tauri", "binaries", "yt-dlp-x86_64-pc-windows-msvc.exe");
assert.ok(existsSync(sidecar), `yt-dlp sidecar not found: ${sidecar}`);

const tempRoot = mkdtempSync(join(tmpdir(), "levelup-yt-dlp-smoke-"));
const outputDir = join(tempRoot, "downloads");
const appData = join(tempRoot, "appdata");
mkdirSync(outputDir, { recursive: true });
mkdirSync(join(appData, "yt-dlp"), { recursive: true });
writeFileSync(join(appData, "yt-dlp", "config"), "--skip-download\n", "utf8");

const payload = Buffer.alloc(64 * 1024, 0x41);
const server = createServer((request, response) => {
  if (request.url !== "/fixture.mp4") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": String(payload.length),
    "Accept-Ranges": "bytes",
    "Last-Modified": new Date().toUTCString(),
  });
  response.end(request.method === "HEAD" ? undefined : payload);
});

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "local HTTP server did not bind");
  const url = `http://127.0.0.1:${address.port}/fixture.mp4`;
  const args = [
    "--ignore-config",
    "--no-warnings",
    "--no-update",
    "--no-playlist",
    "--force-generic-extractor",
    "--progress",
    "--progress-template",
    "download:%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(playlist_index)s|%(playlist_count)s|%(progress.filename)s",
    "--print",
    "after_move:NEXUS_OUTPUT_PATH:%(filepath)s",
    "--no-simulate",
    "-P",
    outputDir,
    "-o",
    "nexus-smoke.%(ext)s",
    url,
  ];

  const child = spawn(sidecar, args, {
    windowsHide: true,
    env: { ...process.env, APPDATA: appData, XDG_CONFIG_HOME: join(tempRoot, "xdg") },
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; process.stdout.write(chunk); });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; process.stderr.write(chunk); });

  const exitPromise = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const timeout = setTimeout(() => child.kill(), 45_000);
  const { code, signal } = await exitPromise;
  clearTimeout(timeout);
  assert.equal(code, 0, `yt-dlp smoke command exited with code ${code} signal ${signal}\n${output}`);
  assert.ok(output.includes("NEXUS_OUTPUT_PATH:"), `yt-dlp did not report its output path\n${output}`);

  const outputFile = join(outputDir, "nexus-smoke.mp4");
  assert.ok(existsSync(outputFile), `yt-dlp exited successfully but did not create ${outputFile}\n${output}`);
  assert.equal(statSync(outputFile).size, payload.length, "downloaded fixture size does not match the served file");
  console.log(`yt-dlp real-download smoke test passed: ${outputFile} (${payload.length} bytes); user config --skip-download was ignored.`);
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  rmSync(tempRoot, { recursive: true, force: true });
}
