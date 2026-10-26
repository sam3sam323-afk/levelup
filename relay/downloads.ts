import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type DownloadKind = "video" | "audio" | "file" | "torrent";
export type DownloadStatus = "queued" | "downloading" | "complete" | "failed" | "cancelled";
export type NewDownload = { url: string; kind: DownloadKind; quality?: string; audioFormat?: "mp3" | "m4a"; deviceName?: string };
export type DownloadJob = {
  id: string;
  title: string;
  url: string;
  kind: DownloadKind;
  engine: "yt-dlp" | "aria2c";
  quality?: string;
  audioFormat?: "mp3" | "m4a";
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
const completedTargets = new Map<string, { filePath?: string; folderPath: string }>();
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

export function getCompletedDownloadTargets(id: string) {
  const job = jobs.get(id);
  const target = completedTargets.get(id);
  if (!job || job.status !== "complete" || !target) return null;
  try {
    const folderPath = existsSync(target.folderPath) && statSync(target.folderPath).isDirectory() ? target.folderPath : null;
    const filePath = target.filePath && existsSync(target.filePath) && statSync(target.filePath).isFile() ? target.filePath : undefined;
    return folderPath ? { filePath, folderPath } : null;
  } catch { return null; }
}

function singleFileInDirectory(directory: string) {
  try {
    const files = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.name.startsWith("."));
    return files.length === 1 ? path.join(directory, files[0].name) : undefined;
  } catch { return undefined; }
}

export function createDownload(input: NewDownload) {
  const id = randomUUID();
  const engine = input.kind === "video" || input.kind === "audio" ? "yt-dlp" : "aria2c";
  const title = titleFromUrl(input.url, input.kind);
  const job: DownloadJob = {
    id, title, url: input.url, kind: input.kind, engine, quality: input.quality, audioFormat: input.audioFormat,
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

  const rootDirectory = getDownloadDirectory();
  const dir = job.kind === "torrent" ? path.join(rootDirectory, `torrent-${job.id}`) : rootDirectory;
  mkdirSync(dir, { recursive: true });
  const args = job.engine === "yt-dlp" ? ytDlpArgs(job, dir) : ariaArgs(job, dir);
  const command = job.engine === "yt-dlp" ? engines.ytDlp.executable : engines.aria2c.executable;
  job.status = "downloading"; job.updatedAt = Date.now(); emitUpdate();

  await new Promise<void>((resolve) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let reportedOutputPath = "";
    let settled = false;
    const child = spawn(command, args, { cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    childByJob.set(job.id, child);
    const processLine = (line: string, target: "stdout" | "stderr") => {
      const value = line.trim();
      if (!value) return;
      if (target === "stdout" && value.startsWith("NEXUS_OUTPUT_PATH=")) {
        reportedOutputPath = value.slice("NEXUS_OUTPUT_PATH=".length).trim();
        return;
      }
      parseProgress(job, value);
    };
    const consume = (chunk: Buffer, target: "stdout" | "stderr") => {
      const current = target === "stdout" ? stdoutBuffer + chunk.toString("utf8") : stderrBuffer + chunk.toString("utf8");
      const lines = current.split(/[\r\n]+/);
      const tail = lines.pop() || "";
      if (target === "stdout") stdoutBuffer = tail; else stderrBuffer = tail;
      for (const line of lines) processLine(line, target);
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
      processLine(stdoutBuffer, "stdout");
      processLine(stderrBuffer, "stderr");
      if (job.status !== "cancelled") {
        if (code === 0) {
          job.status = "complete"; job.percent = 100; job.speedMBps = 0; job.error = undefined;
          const filePath = job.engine === "yt-dlp" && reportedOutputPath
            ? path.resolve(dir, reportedOutputPath)
            : job.kind === "torrent" ? singleFileInDirectory(dir) : path.join(dir, filenameFromUrl(job.url));
          completedTargets.set(job.id, { filePath, folderPath: dir });
        }
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
  const args = ["--no-warnings", "--newline", "--progress", "--no-playlist", "--no-simulate",
    "--print", "after_move:NEXUS_OUTPUT_PATH=%(filepath)s",
    "--progress-template", "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.eta)s"];
  if (job.kind === "audio") args.push("--extract-audio", "--audio-format", job.audioFormat || "mp3", "--audio-quality", "0");
  else args.push("--format", format, "--merge-output-format", "mp4", "--remux-video", "mp4");
  args.push("--paths", directory, "--output", "%(title).140B.%(ext)s");
  if (process.env.FFMPEG_PATH) args.push("--ffmpeg-location", process.env.FFMPEG_PATH);
  args.push(job.url);
  return args;
}

export type AvailableVideoFormat = { quality: string; height: number; extension: string; filesizeBytes: number | null };
export type MediaFormatInfo = { title: string; durationSeconds: number | null; formats: AvailableVideoFormat[] };

export function extractAvailableVideoFormats(info: Record<string, unknown>): MediaFormatInfo {
  const byHeight = new Map<number, { option: AvailableVideoFormat; score: number }>();
  const rawFormats = Array.isArray(info.formats) ? info.formats as Record<string, unknown>[] : [];
  for (const raw of rawFormats) {
    const height = Number(raw.height);
    if (!Number.isInteger(height) || height < 1 || raw.vcodec === "none") continue;
    const extension = typeof raw.ext === "string" ? raw.ext : "unknown";
    const filesize = Number(raw.filesize ?? raw.filesize_approx);
    const score = Number(raw.tbr) + (extension === "mp4" ? 100000 : 0) + (raw.acodec !== "none" ? 50000 : 0);
    const current = byHeight.get(height);
    if (current && current.score >= score) continue;
    byHeight.set(height, {
      score,
      option: { quality: `${height}p`, height, extension, filesizeBytes: Number.isFinite(filesize) && filesize > 0 ? Math.round(filesize) : null },
    });
  }
  const title = typeof info.title === "string" && info.title.trim() ? info.title.slice(0, 140) : "Media";
  const duration = Number(info.duration);
  return {
    title,
    durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
    formats: [...byHeight.values()].map((item) => item.option).sort((a, b) => b.height - a.height),
  };
}

export async function inspectVideoFormats(url: string): Promise<MediaFormatInfo> {
  const status = getEngineStatus();
  if (!status.ytDlp.installed) throw new Error("yt-dlp is not available on this computer.");
  return new Promise<MediaFormatInfo>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let tooLarge = false;
    const child = spawn(status.ytDlp.executable, ["--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", "--no-call-home", url], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > 12 * 1024 * 1024) { tooLarge = true; child.kill(); return; }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2048); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("Could not start yt-dlp metadata inspection.")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) { reject(new Error("Media format inspection timed out after 30 seconds.")); return; }
      if (tooLarge) { reject(new Error("The format response exceeded the local size limit.")); return; }
      if (code !== 0) { reject(new Error(stderr.trim() ? "yt-dlp could not inspect this page. It may be unsupported or require a sign-in." : "yt-dlp could not inspect this page.")); return; }
      try { resolve(extractAvailableVideoFormats(JSON.parse(stdout) as Record<string, unknown>)); }
      catch { reject(new Error("yt-dlp returned invalid format metadata.")); }
    });
  });
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
