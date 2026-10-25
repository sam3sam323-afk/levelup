import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(ROOT, "binaries", "win-x64");
const NATIVE = {
  ytDlp: process.env.YTDLP_PATH?.trim() || "yt-dlp",
  aria2: process.env.ARIA2C_PATH?.trim() || "aria2c",
  ffmpeg: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
};
function canRun(command, args) { return spawnSync(command, args, { stdio: "ignore", timeout: 3500 }).status === 0; }
const NATIVE_READY = process.platform !== "win32" && process.env.NEXUS_SMOKE_WINDOWS !== "1"
  && canRun(NATIVE.ytDlp, ["--version"]) && canRun(NATIVE.aria2, ["--version"]) && canRun(NATIVE.ffmpeg, ["-version"]);
const USE_WINE = process.platform !== "win32" && !NATIVE_READY;
const YTDLP = NATIVE_READY ? NATIVE.ytDlp : path.join(BIN, "yt-dlp.exe");
const ARIA2 = NATIVE_READY ? NATIVE.aria2 : path.join(BIN, "aria2", "aria2c.exe");
const FFMPEG = NATIVE_READY ? NATIVE.ffmpeg : path.join(BIN, "ffmpeg", "ffmpeg.exe");

function winPath(file) {
  if (!USE_WINE) {
    if (file.includes("/") || file.includes("\\")) return path.resolve(file);
    const result = spawnSync(process.platform === "win32" ? "where" : "which", [file], { encoding: "utf8" });
    return result.status === 0 && result.stdout.trim() ? result.stdout.trim().split(/\r?\n/)[0] : file;
  }
  const result = spawnSync("winepath", ["-w", path.resolve(file)], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return `Z:${path.resolve(file).replaceAll("/", "\\")}`;
}

function run(executable, args, label) {
  const command = USE_WINE ? "wine" : executable;
  const commandArgs = USE_WINE ? [executable, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
    timeout.unref();
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk.toString("utf8")}`.slice(-8 * 1024 * 1024); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8 * 1024 * 1024); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`${label} could not start: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const output = `${stdout}\n${stderr}`;
      if (code !== 0) reject(new Error(`${label} failed (exit ${code ?? signal ?? "unknown"}).\n${output.slice(-5000)}`));
      else resolve(output);
    });
  });
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  console.log(`Engine smoke mode: ${NATIVE_READY ? "native local tools" : USE_WINE ? "bundled Windows binaries via Wine" : "bundled Windows binaries"}.`);
  for (const [executable, versionArgs] of [[YTDLP, ["--version"]], [ARIA2, ["--version"]], [FFMPEG, ["-version"]]]) {
    if (!existsSync(executable) && !canRun(executable, versionArgs)) throw new Error(`Run pnpm binaries:fetch first or install this engine: ${executable}`);
  }
  const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-engine-smoke-"));
  const sourceVideo = path.join(workspace, "source.mkv");
  const ariaOutput = path.join(workspace, "aria-download");
  const ytOutput = path.join(workspace, "yt-dlp-output");
  mkdirSync(ariaOutput, { recursive: true });
  mkdirSync(ytOutput, { recursive: true });

  let server;
  try {
    await run(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=2",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=2",
      "-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac", "-shortest", "-f", "matroska", winPath(sourceVideo),
    ], "FFmpeg local fixture generation");
    const fixtureHash = await hashFile(sourceVideo);
    const fileFixture = Buffer.alloc(512 * 1024);
    for (let i = 0; i < fileFixture.length; i += 1) fileFixture[i] = (i * 31 + 7) % 251;

    server = createServer(async (req, res) => {
      const isVideo = req.url?.startsWith("/sample.mkv");
      const filePath = isVideo ? sourceVideo : null;
      const size = isVideo ? statSync(sourceVideo).size : fileFixture.length;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(size));
      res.setHeader("Content-Type", isVideo ? "video/x-matroska" : "application/octet-stream");
      if (req.headers.range) {
        const match = req.headers.range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = Number(match[1]);
          const end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1);
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          res.setHeader("Content-Length", String(end - start + 1));
          if (isVideo) await pipeline(createReadStream(filePath, { start, end }), res);
          else res.end(fileFixture.subarray(start, end + 1));
          return;
        }
      }
      if (isVideo) await pipeline(createReadStream(filePath), res);
      else res.end(fileFixture);
    });
    const hostIPv4 = Object.values(os.networkInterfaces()).flatMap((items) => items || []).find((item) => (item.family === "IPv4" || item.family === 4) && !item.internal)?.address;
    const bindAddress = USE_WINE ? "0.0.0.0" : "127.0.0.1";
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, bindAddress, resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not bind the local smoke-test fixture server.");
    const connectAddress = USE_WINE ? hostIPv4 : "127.0.0.1";
    if (!connectAddress) throw new Error("No local IPv4 interface is available to connect Wine to the fixture server.");
    const baseUrl = `http://${connectAddress}:${address.port}`;

    const probe = await fetch(`${baseUrl}/aria-fixture.bin`, { signal: AbortSignal.timeout(5000) });
    const probeBytes = Buffer.from(await probe.arrayBuffer());
    if (!probe.ok || !probeBytes.equals(fileFixture)) throw new Error("The local HTTP fixture server failed its own byte-for-byte probe.");
    console.log(`HTTP fixture server: ${probeBytes.length} bytes verified at ${baseUrl}.`);

    await run(ARIA2, ["--console-log-level=notice", "--summary-interval=1", "--max-connection-per-server=16", "--split=16", "--continue=true", "--max-tries=1", "--connect-timeout=8", `--dir=${winPath(ariaOutput)}`, "--out=aria-fixture.bin", `${baseUrl}/aria-fixture.bin`], "aria2c local direct-download smoke test");
    const ariaFile = path.join(ariaOutput, "aria-fixture.bin");
    if (!existsSync(ariaFile) || await hashFile(ariaFile) !== createHash("sha256").update(fileFixture).digest("hex")) throw new Error("aria2c downloaded bytes did not match the local HTTP fixture.");
    console.log("aria2c: real 512 KiB HTTP download verified byte-for-byte.");

    await run(YTDLP, [
      "--ignore-config", "--no-warnings", "--force-generic-extractor", "--format", "best",
      "--merge-output-format", "mp4", "--remux-video", "mp4", "--ffmpeg-location", winPath(FFMPEG),
      "--paths", winPath(ytOutput), "--output", "fixture.%(ext)s", `${baseUrl}/sample.mkv`,
    ], "yt-dlp local media download and FFmpeg remux smoke test");
    const mp4 = path.join(ytOutput, "fixture.mp4");
    if (!existsSync(mp4) || statSync(mp4).size < 1024) throw new Error("yt-dlp did not produce the expected remuxed MP4 file.");
    const remuxHash = await hashFile(mp4);
    if (remuxHash === fixtureHash) throw new Error("yt-dlp output was not remuxed; expected a new MP4 container file.");
    console.log(`yt-dlp + FFmpeg: local Matroska input remuxed to MP4 (${statSync(mp4).size} bytes).`);
    console.log("No external media URL was contacted; test fixtures were generated locally and deleted afterward.");
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
