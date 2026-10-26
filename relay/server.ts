import "dotenv/config";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import QRCode from "qrcode";

import { cancelDownload, createDownload, getCompletedDownloadTargets, getDownloadDirectory, getEngineStatus, inspectVideoFormats, listDownloads, listLibraryFiles, onDownloadUpdate, qualityHeight, shutdownDownloads } from "./downloads";
import type { DownloadKind } from "./downloads";
import { assertSafeDownloadTarget } from "./url-safety";

export { getCompletedDownloadTargets, getDownloadDirectory };

const PORT = Number(process.env.NEXUS_PORT ?? 8787);
const HOST = process.env.NEXUS_HOST ?? "0.0.0.0";
const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_PAIR_ATTEMPTS = 5;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WEB_DIR = path.resolve(process.env.NEXUS_WEB_DIR?.trim() || path.join(process.cwd(), "web-dist"));
const tokens = new Map<string, { deviceName: string; expiresAt: number }>();
let pairing = { code: newPairingCode(), expiresAt: Date.now() + PAIRING_TTL_MS, attempts: 0, consumed: false };
let desktopToken = "";
let server: Server | null = null;

function newPairingCode() { return String(randomInt(0, 1_000_000)).padStart(6, "0"); }
function rotatePairing() { pairing = { code: newPairingCode(), expiresAt: Date.now() + PAIRING_TTL_MS, attempts: 0, consumed: false }; }
function ensurePairing() { if (pairing.expiresAt <= Date.now() || pairing.consumed || pairing.attempts >= MAX_PAIR_ATTEMPTS) rotatePairing(); }
function isPrivateIPv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}
function localAddresses() {
  const result: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const item of entries || []) {
      if (item.family !== "IPv4" || item.internal) continue;
      const ip = item.address;
      if (!isPrivateIPv4(ip)) continue;
      result.push(ip);
    }
  }
  const configured = process.env.NEXUS_RELAY_IP?.trim();
  if (configured && isPrivateIPv4(configured)) return [configured, ...result.filter((ip) => ip !== configured)];
  const priority = (ip: string) => ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  return [...new Set(result)].sort((a, b) => priority(a) - priority(b));
}
function primaryAddress() { return localAddresses()[0] ?? "127.0.0.1"; }
function isLoopback(address?: string) {
  const normalized = (address || "").replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}
function safeEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function authToken(req: Request) { return req.header("authorization")?.replace(/^Bearer\s+/i, "") || String(req.query.token || ""); }
function tokenValid(req: Request) {
  const candidate = authToken(req);
  if (!candidate) return false;
  const current = tokens.get(candidate);
  if (!current || current.expiresAt <= Date.now()) { tokens.delete(candidate); return false; }
  return [...tokens.keys()].some((token) => safeEqual(token, candidate));
}

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.header("origin") || "";
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  if (localOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    if (req.header("access-control-request-private-network") === "true") res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  if (req.method === "OPTIONS") return res.sendStatus(localOrigin ? 204 : 403);
  next();
});
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, product: "LEVEL UP ARENA NEXUS", port: PORT, timestamp: Date.now() }));
app.get("/api/relay-info", (_req, res) => res.json({ ok: true, localUrls: localAddresses().map((ip) => `http://${ip}:${PORT}`), pairingRequired: true, port: PORT }));

app.get("/api/pairing", async (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Open the desktop dashboard on this computer to view its pairing QR." });
  ensurePairing();
  const relay = `http://${primaryAddress()}:${PORT}`;
  const payload = JSON.stringify({ type: "nexus-pair", relay, code: pairing.code });
  const qrDataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width: 220, color: { dark: "#071321", light: "#ffffff" } });
  res.json({ localUrls: localAddresses().map((ip) => `http://${ip}:${PORT}`), relay, code: pairing.code, expiresAt: pairing.expiresAt, qrDataUrl });
});

app.post("/api/pairing/refresh", (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Pairing codes can only be refreshed from the computer." });
  rotatePairing();
  res.json({ ok: true, expiresAt: pairing.expiresAt });
});

app.get("/api/desktop-session", (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Desktop session is available only on this computer." });
  if (!desktopToken || !tokens.has(desktopToken)) {
    desktopToken = randomBytes(32).toString("base64url");
    tokens.set(desktopToken, { deviceName: "Desktop dashboard", expiresAt: Date.now() + TOKEN_TTL_MS });
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ token: desktopToken, baseUrl: `http://localhost:${PORT}` });
});

app.post("/api/pair", (req, res) => {
  ensurePairing();
  if (pairing.attempts >= MAX_PAIR_ATTEMPTS) return res.status(429).json({ error: "Too many attempts. Refresh the code on the computer." });
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const deviceName = typeof req.body?.deviceName === "string" ? req.body.deviceName.trim().slice(0, 50) : "Nexus phone";
  pairing.attempts += 1;
  if (!/^\d{6}$/.test(code) || !safeEqual(code, pairing.code)) {
    if (pairing.attempts >= MAX_PAIR_ATTEMPTS) pairing.expiresAt = 0;
    return res.status(401).json({ error: "Invalid or expired pairing code." });
  }
  pairing.consumed = true;
  const token = randomBytes(32).toString("base64url");
  tokens.set(token, { deviceName: deviceName || "Nexus phone", expiresAt: Date.now() + TOKEN_TTL_MS });
  res.setHeader("Cache-Control", "no-store");
  res.json({ token, deviceName: deviceName || "Nexus phone", expiresAt: Date.now() + TOKEN_TTL_MS });
});

const requireToken = (req: Request, res: Response, next: NextFunction) => {
  if (!tokenValid(req)) return res.status(401).json({ error: "Pair this device with Nexus Relay again." });
  next();
};

app.get("/api/tools", requireToken, (_req, res) => res.json(getEngineStatus()));
app.get("/api/downloads", requireToken, (_req, res) => res.json({ downloads: listDownloads() }));
app.get("/api/library", requireToken, (_req, res) => res.json({ files: listLibraryFiles() }));
app.post("/api/media/formats", requireToken, async (req, res) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url || url.length > 4096) return res.status(400).json({ error: "Provide a valid page or media URL." });
  let parsed: URL;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: "The link format is not valid." }); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return res.status(400).json({ error: "Only HTTP/HTTPS links without embedded credentials are accepted." });
  try { await assertSafeDownloadTarget(parsed, { allowLoopbackForTests: true }); }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "This network destination is not allowed." }); }
  try { res.json(await inspectVideoFormats(url)); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "yt-dlp could not inspect this page." }); }
});
app.post("/api/downloads", requireToken, async (req, res) => {
  const { url, kind, target, quality, audioFormat } = req.body ?? {};
  if (typeof url !== "string" || url.length > 4096) return res.status(400).json({ error: "Provide a valid video, file, or magnet URL." });
  const normalizedKind = kind as DownloadKind;
  if (!["video", "audio", "file", "torrent"].includes(normalizedKind)) return res.status(400).json({ error: "Choose video, audio, direct file, or torrent." });
  const routeTarget = target ?? "computer";
  if (routeTarget !== "computer" && routeTarget !== "phone") return res.status(400).json({ error: "Choose computer or phone as the download target." });
  if (routeTarget === "phone" && normalizedKind !== "file") return res.status(400).json({ error: "Direct phone downloads accept HTTP/HTTPS file links only." });
  const isMagnet = url.startsWith("magnet:");
  if (isMagnet) {
    if (routeTarget === "phone" || normalizedKind !== "torrent" || !/^magnet:\?xt=urn:btih:[a-zA-Z0-9]{20,100}/i.test(url)) return res.status(400).json({ error: "Use a valid Magnet link with the torrent download type on the computer." });
  } else {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: "The link format is not valid." }); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return res.status(400).json({ error: "Only HTTP/HTTPS links without embedded credentials are accepted." });
    try { await assertSafeDownloadTarget(parsed, { allowLoopbackForTests: true }); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "This network destination is not allowed." }); }
  }
  if (normalizedKind === "torrent" && !isMagnet && !/\.torrent(?:$|\?)/i.test(url)) return res.status(400).json({ error: "Torrent type requires a .torrent URL or a Magnet link." });
  if (routeTarget === "phone") return res.json({ target: "phone", directUrl: url });
  const chosenQuality = typeof quality === "string" ? quality : "1080p";
  if (normalizedKind === "video" && chosenQuality !== "auto" && (!qualityHeight(chosenQuality) || (qualityHeight(chosenQuality) ?? 0) < 144 || (qualityHeight(chosenQuality) ?? 99999) > 4320)) return res.status(400).json({ error: "Choose a video height between 144p and 4320p, or auto." });
  const chosenAudioFormat = typeof audioFormat === "string" ? audioFormat.toLowerCase() : "mp3";
  if (normalizedKind === "audio" && !["mp3", "m4a"].includes(chosenAudioFormat)) return res.status(400).json({ error: "Audio-only format must be MP3 or M4A." });
  const download = createDownload({ url, kind: normalizedKind, quality: chosenQuality, audioFormat: normalizedKind === "audio" ? chosenAudioFormat as "mp3" | "m4a" : undefined });
  res.status(202).json({ download });
});

app.post("/api/downloads/:id/cancel", requireToken, (req, res) => {
  const ok = cancelDownload(req.params.id);
  if (!ok) return res.status(404).json({ error: "Download is not active." });
  res.json({ ok: true });
});

app.get("/api/events", requireToken, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (items = listDownloads()) => res.write(`data: ${JSON.stringify({ downloads: items })}\n\n`);
  send();
  const unsubscribe = onDownloadUpdate(send);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown local Relay API endpoint." }));

app.use((req, res, next) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).type("text").send("Open the desktop dashboard on this computer at http://localhost:8787.");
  if (!existsSync(path.join(WEB_DIR, "index.html"))) return res.status(503).type("text").send("Nexus Relay is running. Build the local dashboard first with: pnpm desktop");
  express.static(WEB_DIR, { index: "index.html", fallthrough: true })(req, res, next);
});

app.use((req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).end();
  if (existsSync(path.join(WEB_DIR, "index.html"))) return res.sendFile(path.join(WEB_DIR, "index.html"));
  res.status(404).end();
});

function logReady() {
  const urls = localAddresses().map((ip) => `http://${ip}:${PORT}`);
  console.log("\nLEVEL UP ARENA NEXUS — local relay ready");
  console.log(`Desktop dashboard: http://localhost:${PORT}`);
  console.log(`Local network endpoints: ${urls.length ? urls.join("  |  ") : "No non-loopback IPv4 address found"}`);
  console.log(`Download folder: ${getDownloadDirectory()}`);
  console.log("Pairing code is visible only from the desktop dashboard. This process does not connect to a cloud account.\n");
}

export function startRelayServer() {
  if (server?.listening) return server;
  server = createServer(app);
  server.listen(PORT, HOST, logReady);
  return server;
}

export function stopRelayServer() {
  shutdownDownloads();
  const current = server;
  server = null;
  if (!current?.listening) return Promise.resolve();
  return new Promise<void>((resolve) => {
    current.close(() => resolve());
    current.closeAllConnections();
  });
}

if (process.env.NEXUS_RELAY_AUTOSTART !== "0") {
  startRelayServer();
  const shutdown = () => {
    void stopRelayServer().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 1800).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
