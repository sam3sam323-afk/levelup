import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type DownloadKind = "video" | "file" | "torrent";
export type DownloadStatus = "queued" | "downloading" | "complete" | "failed" | "cancelled";
export type NewDownload = { url: string; kind: DownloadKind; quality?: string; deviceName?: string };
export type DownloadJob = {
  id: string;
  title: string;
  url: string;
  kind: DownloadKind;
  engine: "yt-dlp" | "aria2c";
  quality?: string;
  status: DownloadStatus;
  percent: number;
  speedMBps: number;
  etaSeconds: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  createdAt: number;
  updatedAt: number;
  error?: string;
};

const jobs = new Map<string, DownloadJob>();
const childByJob = new Map<string, ChildProcess>();
const queue: string[] = [];
const events = new EventEmitter();
const MAX_ACTIVE = Math.max(1, Math.min(4, Number(process.env.NEXUS_MAX_PARALLEL ?? 2) || 2));
let activeCount = 0;

export function getDownloadDirectory() {
  const dir = process.env.NEXUS_DOWNLOAD_DIR?.trim() || path.join(os.homedir(), "Downloads", "LEVEL-UP-ARENA-NEXUS");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function executable(envName: string, fallback: string) { return process.env[envName]?.trim() || fallback; }
function canRun(command: string, args: string[]) {
  try { return spawnSync(command, args, { encoding: "utf8", timeout: 3500, windowsHide: true }).status === 0; }
  catch { return false; }
}

export function getEngineStatus() {
  const ytDlp = executable("YTDLP_PATH", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const ffmpeg = executable("FFMPEG_PATH", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const aria2c = executable("ARIA2C_PATH", process.platform === "win32" ? "aria2c.exe" : "aria2c");
  return {
    ytDlp: { installed: canRun(ytDlp, ["--version"]), executable: ytDlp },
    ffmpeg: { installed: canRun(ffmpeg, ["-version"]), executable: ffmpeg },
    aria2c: { installed: canRun(aria2c, ["--version"]), executable: aria2c },
  };
}

function titleFromUrl(value: string, kind: DownloadKind) {
  if (value.startsWith("magnet:")) return "Magnet download";
  try {
    const url = new URL(value);
    const leaf = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    const base = leaf.replace(/\.[A-Za-z0-9]{1,8}$/, "");
    return base ? base.slice(0, 88) : url.hostname;
  } catch { return kind === "video" ? "Video download" : "Direct download"; }
}

export function qualityHeight(value?: string) {
  if (!value || value === "auto") return null;
  const match = value.match(/^(\d{3,4})(?:p)?$/i);
  if (match) return Number(match[1]);
  const k = value.match(/^(\d)k$/i);
  if (k) return Number(k[1]) === 4 ? 2160 : Number(k[1]) === 8 ? 4320 : null;
  return null;
}

function rateFromYtDlp(value: string) {
  const match = value.match(/([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB)\/s/i);
  if (!match) return 0;
  const n = Number(match[1]);
  const unit = match[2].toUpperCase();
  const factor = unit.startsWith("G") ? 1024 ** 3 : unit.startsWith("M") ? 1024 ** 2 : unit.startsWith("K") ? 1024 : 1;
  return (n * factor) / (1024 ** 2);
}

function parseProgress(job: DownloadJob, line: string) {
  if (job.engine === "yt-dlp" && line.includes("|")) {
    const [rawPercent, rawSpeed, rawDownloaded, rawTotal, rawEta] = line.split("|");
    const p = Number(rawPercent?.replace(/[^\d.]/g, ""));
    if (Number.isFinite(p)) job.percent = Math.min(99.9, Math.max(0, p));
    job.speedMBps = rateFromYtDlp(rawSpeed || "");
    job.etaSeconds = parseEtaSeconds(rawEta || "");
    const downloaded = Number(rawDownloaded);
    const total = Number(rawTotal);
    if (Number.isFinite(downloaded) && downloaded >= 0) job.downloadedBytes = downloaded;
    if (Number.isFinite(total) && total > 0) job.totalBytes = total;
  } else {
    const p = line.match(/\(([\d.]+)%\)/);
    if (p) job.percent = Math.min(99.9, Math.max(0, Number(p[1]) || 0));
    const downloaded = line.match(/([\d.]+)\s*([KMGT]?i?B)\s*\/\s*([\d.]+)\s*([KMGT]?i?B)/i);
    if (downloaded) {
      job.downloadedBytes = parseBytes(downloaded[1], downloaded[2]);
      job.totalBytes = parseBytes(downloaded[3], downloaded[4]);
    }
    const speed = line.match(/DL:([\d.]+)\s*([KMGT]?i?B)/i);
    if (speed) job.speedMBps = parseBytes(speed[1], speed[2]) / (1024 ** 2);
    const eta = line.match(/\bETA:([^\s]+)/i);
    if (eta) job.etaSeconds = parseEtaSeconds(eta[1]);
  }
  job.updatedAt = Date.now();
  emitUpdate();
}

function parseBytes(amount: string, unit: string) {
  const value = Number(amount);
  const normalized = unit.toUpperCase().replace("IB", "B");
  const exponent = normalized.startsWith("T") ? 4 : normalized.startsWith("G") ? 3 : normalized.startsWith("M") ? 2 : normalized.startsWith("K") ? 1 : 0;
  return Math.round(value * (1024 ** exponent));
}

export function parseEtaSeconds(value: string) {
  const source = value.trim().toLowerCase();
  if (!source || ["na", "n/a", "--", "unknown", "unknowns"].includes(source)) return null;
  const direct = Number(source);
  if (Number.isFinite(direct) && direct >= 0) return Math.ceil(direct);
  const clock = source.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const units = source.match(/^(?:(\d+(?:\.\d+)?)d)?(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (!units || !units.slice(1).some(Boolean)) return null;
  return Math.ceil(Number(units[1] || 0) * 86400 + Number(units[2] || 0) * 3600 + Number(units[3] || 0) * 60 + Number(units[4] || 0));
}

function emitUpdate() { events.emit("update", listDownloads()); }
export function onDownloadUpdate(listener: (items: DownloadJob[]) => void) { events.on("update", listener); return () => events.off("update", listener); }
export function listDownloads() { return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map((job) => ({ ...job })); }

export function createDownload(input: NewDownload) {
  const id = randomUUID();
  const engine = input.kind === "video" ? "yt-dlp" : "aria2c";
  const title = titleFromUrl(input.url, input.kind);
  const job: DownloadJob = {
    id, title, url: input.url, kind: input.kind, engine, quality: input.quality,
    status: "queued", percent: 0, speedMBps: 0, etaSeconds: null, downloadedBytes: 0, totalBytes: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  jobs.set(id, job);
  queue.push(id);
  emitUpdate();
  startNext();
  return { ...job };
}

export function cancelDownload(id: string) {
  const job = jobs.get(id);
  if (!job || ["complete", "failed", "cancelled"].includes(job.status)) return false;
  job.status = "cancelled";
  job.speedMBps = 0;
  job.updatedAt = Date.now();
  const queuedIndex = queue.indexOf(id);
  if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
  childByJob.get(id)?.kill();
  emitUpdate();
  return true;
}

function startNext() {
  while (activeCount < MAX_ACTIVE && queue.length) {
    const id = queue.shift();
    if (!id) continue;
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;
    activeCount += 1;
    void runJob(job).finally(() => { activeCount = Math.max(0, activeCount - 1); startNext(); });
  }
}

async function runJob(job: DownloadJob) {
  const engines = getEngineStatus();
  if (job.engine === "yt-dlp" && (!engines.ytDlp.installed || !engines.ffmpeg.installed)) {
    job.status = "failed"; job.error = "Install yt-dlp and FFmpeg on this computer, then restart Nexus Relay."; job.updatedAt = Date.now(); emitUpdate(); return;
  }
  if (job.engine === "aria2c" && !engines.aria2c.installed) {
    job.status = "failed"; job.error = "Install aria2c on this computer, then restart Nexus Relay."; job.updatedAt = Date.now(); emitUpdate(); return;
  }

  const dir = getDownloadDirectory();
  const args = job.engine === "yt-dlp" ? ytDlpArgs(job, dir) : ariaArgs(job, dir);
  const command = job.engine === "yt-dlp" ? engines.ytDlp.executable : engines.aria2c.executable;
  job.status = "downloading"; job.updatedAt = Date.now(); emitUpdate();

  await new Promise<void>((resolve) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    const child = spawn(command, args, { cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    childByJob.set(job.id, child);
    const consume = (chunk: Buffer, target: "stdout" | "stderr") => {
      const current = target === "stdout" ? stdoutBuffer + chunk.toString("utf8") : stderrBuffer + chunk.toString("utf8");
      const lines = current.split(/[\r\n]+/);
      const tail = lines.pop() || "";
      if (target === "stdout") stdoutBuffer = tail; else stderrBuffer = tail;
      for (const line of lines) if (line.trim()) parseProgress(job, line.trim());
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
    child.once("error", () => {
      if (settled) return; settled = true;
      childByJob.delete(job.id);
      if (job.status !== "cancelled") { job.status = "failed"; job.error = `Could not start ${job.engine}. Check that the executable is available.`; }
      job.speedMBps = 0; job.updatedAt = Date.now(); emitUpdate(); resolve();
    });
    child.once("close", (code) => {
      if (settled) return; settled = true;
      childByJob.delete(job.id);
      if (stdoutBuffer.trim()) parseProgress(job, stdoutBuffer.trim());
      if (stderrBuffer.trim()) parseProgress(job, stderrBuffer.trim());
      if (job.status !== "cancelled") {
        if (code === 0) { job.status = "complete"; job.percent = 100; job.speedMBps = 0; job.error = undefined; }
        else { job.status = "failed"; job.speedMBps = 0; job.error = `${job.engine} exited with code ${code ?? "unknown"}. Check the source URL, quality, and installed codecs.`; }
      }
      job.updatedAt = Date.now(); emitUpdate(); resolve();
    });
  });
}

export function ytDlpArgs(job: DownloadJob, directory: string) {
  const height = qualityHeight(job.quality);
  const format = height
    ? `bv*[height=${height}]+ba/b[height=${height}]/bv*[height<=${height}]+ba/b[height<=${height}]`
    : "bv*+ba/b";
  const args = [
    "--no-warnings", "--newline", "--progress",
    "--progress-template", "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.eta)s",
    "--format", format, "--merge-output-format", "mp4", "--remux-video", "mp4",
    "--paths", directory, "--output", "%(title).140B.%(ext)s",
  ];
  if (process.env.FFMPEG_PATH) args.push("--ffmpeg-location", process.env.FFMPEG_PATH);
  args.push(job.url);
  return args;
}

export function ariaArgs(job: DownloadJob, directory: string) {
  const args = [
    "--max-connection-per-server=16", "--split=16", "--bt-max-peers=16", "--min-split-size=1M",
    "--continue=true", "--summary-interval=1", "--console-log-level=notice",
    "--download-result=hide", "--file-allocation=none", "--seed-time=0", `--dir=${directory}`,
  ];
  if (!job.url.startsWith("magnet:")) args.push(`--out=${filenameFromUrl(job.url)}`);
  args.push(job.url);
  return args;
}

export function filenameFromUrl(value: string) {
  try {
    const name = decodeURIComponent(new URL(value).pathname.split("/").filter(Boolean).pop() || "download.bin");
    return safeFilename(name) || "download.bin";
  } catch { return "download.bin"; }
}

function safeFilename(value: string) {
  return value.normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "").slice(0, 100);
}

export function listLibraryFiles() {
  const directory = getDownloadDirectory();
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => {
        const fullPath = path.join(directory, entry.name);
        const info = statSync(fullPath);
        return { name: entry.name, sizeBytes: info.size, modifiedAt: info.mtimeMs, extension: path.extname(entry.name).replace(".", "").toLowerCase() };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
      .slice(0, 200);
  } catch { return []; }
}

export function shutdownDownloads() {
  for (const child of childByJob.values()) child.kill();
  childByJob.clear();
  events.removeAllListeners();
}
