const { app, BrowserWindow, WebContentsView, dialog, ipcMain, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const PORT = Number(process.env.NEXUS_PORT || 8787);
const IS_PACKAGED = app.isPackaged;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const APP_ROOT = IS_PACKAGED ? app.getAppPath() : PROJECT_ROOT;
const RESOURCE_ROOT = IS_PACKAGED ? process.resourcesPath : PROJECT_ROOT;
const SUPPORT_URL = "https://t.me/level_uparena_bot";
const BROWSER_PARTITION = "nexus-nonpersistent-browser";
const DIRECT_MEDIA_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus"]);
const STREAM_EXTENSIONS = new Set([".m3u8", ".mpd", ".ism", ".isml"]);
const MIME_MEDIA = /^(video\/|audio\/|application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))/i;
const BROWSER_TOOLBAR_HEIGHT = process.platform === "win32" ? 90 : 58;

let relay = null;
let quitting = false;
let mainWindow = null;
let browserWindow = null;
let browserView = null;
let browserSession = null;
let browserSessionConfigured = false;
let browserDrawerOpen = false;
let browserLanguage = "ar";
let pageUrl = "about:blank";
let desktopRelayToken = "";
const mediaById = new Map();
const mediaIdByUrl = new Map();

function configureRuntime() {
  process.env.NEXUS_RELAY_AUTOSTART = "0";
  process.env.NEXUS_PORT = String(PORT);
  process.env.NEXUS_HOST = process.env.NEXUS_HOST || "0.0.0.0";
  process.env.NEXUS_WEB_DIR = path.join(RESOURCE_ROOT, "web-dist");
  process.env.NEXUS_DOWNLOAD_DIR = process.env.NEXUS_DOWNLOAD_DIR || path.join(app.getPath("downloads"), "LEVEL-UP-ARENA-NEXUS");

  const binaryRoot = path.join(RESOURCE_ROOT, "binaries", "win-x64");
  const tools = {
    YTDLP_PATH: path.join(binaryRoot, "yt-dlp.exe"),
    ARIA2C_PATH: path.join(binaryRoot, "aria2", "aria2c.exe"),
    FFMPEG_PATH: path.join(binaryRoot, "ffmpeg", "ffmpeg.exe"),
  };
  const missing = Object.entries(tools).filter(([, value]) => !fs.existsSync(value)).map(([name]) => name);
  if (IS_PACKAGED && missing.length) throw new Error(`The installer is missing bundled engine files: ${missing.join(", ")}`);
  if (!missing.length) for (const [name, value] of Object.entries(tools)) process.env[name] = value;
  if (!IS_PACKAGED) process.env.NEXUS_WEB_DIR = path.join(PROJECT_ROOT, "web-dist");
}

async function waitForRelay() {
  const url = `http://127.0.0.1:${PORT}/api/health`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { const response = await fetch(url, { cache: "no-store" }); if (response.ok) return; }
    catch { /* Wait for the local Express listener. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Nexus Relay did not become ready on port ${PORT}.`);
}

function sendUpdateStatus(state, message, percent) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("nexus:update:status", { state, message, ...(Number.isFinite(percent) ? { percent } : {}) });
}

function isMainFrameSender(event, contents) {
  return Boolean(contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame);
}

function requireMainWindowSender(event) {
  if (!isMainFrameSender(event, mainWindow?.webContents)) throw new Error("This action is available only to the Nexus dashboard.");
}

function requireBrowserShellSender(event) {
  if (!isMainFrameSender(event, browserWindow?.webContents)) throw new Error("This action is available only to the internal browser controls.");
}

function requireTrustedUiSender(event) {
  if (!isMainFrameSender(event, mainWindow?.webContents) && !isMainFrameSender(event, browserWindow?.webContents)) {
    throw new Error("This action is available only to trusted Nexus windows.");
  }
}

function isHttpUrl(raw) {
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

function isTrustedRelayUrl(raw) {
  try {
    const parsed = new URL(raw);
    const expectedPort = PORT === 80 ? "" : String(PORT);
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname.toLowerCase())
      && parsed.port === expectedPort && !parsed.username && !parsed.password;
  } catch { return false; }
}

function setupAutoUpdater() {
  if (!IS_PACKAGED) return;
  const configPath = path.join(process.resourcesPath, "app-update.yml");
  if (!fs.existsSync(configPath)) {
    sendUpdateStatus("unconfigured", "No GitHub update feed is configured for this build.");
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking", "Checking for updates…"));
  autoUpdater.on("update-available", (info) => sendUpdateStatus("available", `Version ${info.version} is available. Downloading in the background.`));
  autoUpdater.on("update-not-available", () => sendUpdateStatus("current", "LEVEL UP ARENA NEXUS is up to date."));
  autoUpdater.on("download-progress", (progress) => sendUpdateStatus("downloading", `Downloading update · ${Math.round(progress.percent)}%`, progress.percent));
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus("ready", `Version ${info.version} is ready to install. Restart the app to finish.`));
  autoUpdater.on("error", (error) => sendUpdateStatus("error", error.message || "Update check failed."));
  const check = () => { if (!quitting) void autoUpdater.checkForUpdates().catch((error) => sendUpdateStatus("error", error.message || "Update check failed.")); };
  setTimeout(check, 8000).unref();
  setInterval(check, 6 * 60 * 60 * 1000).unref();
}

function registerApplicationIpc() {
  ipcMain.handle("nexus:support:open", async (event) => { requireTrustedUiSender(event); return shell.openExternal(SUPPORT_URL); });
  ipcMain.handle("nexus:download:open", async (event, request) => {
    requireMainWindowSender(event);
    const id = typeof request?.id === "string" ? request.id : "";
    const action = request?.action;
    if (!/^[a-f\d-]{36}$/i.test(id) || !["file", "folder"].includes(action)) throw new Error("Choose a completed Nexus download.");
    const target = relay?.getCompletedDownloadTargets?.(id);
    if (!target) throw new Error("The completed download is no longer available.");
    const root = fs.realpathSync(relay.getDownloadDirectory());
    const candidate = action === "file" ? target.filePath : target.filePath || target.folderPath;
    if (!candidate) throw new Error("This download has no single file to open. Open its folder instead.");
    const resolved = fs.realpathSync(candidate);
    const relative = path.relative(root, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("The download path is outside the Nexus download folder.");
    const details = fs.statSync(resolved);
    if (action === "file") {
      if (!details.isFile()) throw new Error("The download file is no longer available.");
      const error = await shell.openPath(resolved);
      if (error) throw new Error(error);
    } else if (details.isFile()) shell.showItemInFolder(resolved);
    else {
      const error = await shell.openPath(resolved);
      if (error) throw new Error(error);
    }
    return true;
  });
  ipcMain.handle("nexus:browser:open", async (event, language) => {
    requireMainWindowSender(event);
    if (["ar", "en", "fr"].includes(language)) browserLanguage = language;
    await openBrowser();
    return true;
  });
  ipcMain.handle("nexus:update:check", async (event) => {
    requireMainWindowSender(event);
    if (!IS_PACKAGED) return { ok: false, message: "Update checks are available in the installed desktop build." };
    if (!fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) return { ok: false, message: "This build has no GitHub Releases feed configured." };
    try { await autoUpdater.checkForUpdates(); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Update check failed." }; }
  });
  ipcMain.handle("nexus:update:install", async (event) => {
    requireMainWindowSender(event);
    if (!IS_PACKAGED || !fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });
}

function mediaMimeFromHeaders(headers) {
  if (!headers) return "";
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "content-type") continue;
    const item = Array.isArray(value) ? value[0] : value;
    return String(item || "").split(";")[0].trim().toLowerCase();
  }
  return "";
}

function candidateFrom(url, mime = "") {
  if (!browserView || typeof url !== "string" || url.length > 4096 || !/^https?:\/\//i.test(url)) return;
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  if (parsed.username || parsed.password) return;
  const extension = path.extname(parsed.pathname).toLowerCase();
  const isDirect = DIRECT_MEDIA_EXTENSIONS.has(extension);
  const isStream = STREAM_EXTENSIONS.has(extension);
  if (!isDirect && !isStream && !MIME_MEDIA.test(mime)) return;
  let id = mediaIdByUrl.get(url);
  let item = id ? mediaById.get(id) : undefined;
  if (!item) {
    id = crypto.randomUUID();
    const leaf = parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
    let title = leaf;
    try { title = decodeURIComponent(leaf); } catch { /* Keep the raw URL component when it is malformed. */ }
    item = {
      id, url, pageUrl: pageUrl === "about:blank" ? url : pageUrl,
      kind: mime.startsWith("audio/") || /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(parsed.pathname) ? "audio" : "video",
      mime: mime || extension.replace(".", "") || "media",
      title: title.slice(0, 140),
      direct: isDirect,
    };
    mediaById.set(id, item);
    mediaIdByUrl.set(url, id);
  } else {
    item.mime = mime || item.mime;
    item.pageUrl = pageUrl === "about:blank" ? item.pageUrl : pageUrl;
  }
  while (mediaById.size > 80) {
    const oldestId = mediaById.keys().next().value;
    if (!oldestId) break;
    const oldest = mediaById.get(oldestId);
    mediaById.delete(oldestId);
    if (oldest) mediaIdByUrl.delete(oldest.url);
  }
  publishCandidates();
}

function publishCandidates() {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  browserWindow.webContents.send("nexus:browser:candidates", { items: [...mediaById.values()] });
}

function publishPageState() {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  const title = browserView?.webContents.getTitle() || "";
  const url = browserView?.webContents.getURL() || pageUrl;
  browserWindow.webContents.send("nexus:browser:page-state", { title, url });
}

function configureBrowserSession() {
  if (browserSessionConfigured || !browserSession) return;
  browserSessionConfigured = true;
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  const filter = { urls: ["http://*/*", "https://*/*"] };
  browserSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    candidateFrom(details.url);
    callback({});
  });
  browserSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const mime = mediaMimeFromHeaders(details.responseHeaders);
    if (MIME_MEDIA.test(mime)) candidateFrom(details.url, mime);
    callback({});
  });
}

function updateBrowserBounds() {
  if (!browserWindow || browserWindow.isDestroyed() || !browserView) return;
  const { width, height } = browserWindow.getContentBounds();
  const panelSpace = browserDrawerOpen ? 310 : 40;
  browserView.setBounds({ x: 0, y: BROWSER_TOOLBAR_HEIGHT, width, height: Math.max(100, height - BROWSER_TOOLBAR_HEIGHT - panelSpace) });
}

function normalizeAddress(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Enter a web address or search terms.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS pages are available in the internal browser.");
    if (parsed.username || parsed.password) throw new Error("Browser addresses cannot include embedded credentials.");
    return parsed.toString();
  }
  if (/\s/.test(value)) return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
  const parsed = new URL(`https://${value}`);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS pages are available in the internal browser.");
  if (parsed.username || parsed.password) throw new Error("Browser addresses cannot include embedded credentials.");
  return parsed.toString();
}

async function openBrowser() {
  if (browserWindow && !browserWindow.isDestroyed()) { browserWindow.show(); browserWindow.focus(); browserWindow.webContents.send("nexus:browser:language", browserLanguage); return; }
  browserSession = session.fromPartition(BROWSER_PARTITION);
  configureBrowserSession();
  browserWindow = new BrowserWindow({
    width: 1380, height: 900, minWidth: 820, minHeight: 560,
    title: "LEVEL UP ARENA NEXUS — Browser", parent: mainWindow || undefined,
    autoHideMenuBar: true, backgroundColor: "#070D19",
    ...(process.platform === "win32" ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#070D19", symbolColor: "#8293AE", height: 32 } } : {}),
    webPreferences: {
      preload: path.join(APP_ROOT, "desktop", "browser-preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  browserView = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: true,
    },
  });
  browserWindow.contentView.addChildView(browserView);
  updateBrowserBounds();
  browserWindow.on("resize", updateBrowserBounds);
  browserWindow.on("closed", () => {
    browserWindow = null;
    browserView = null;
    mediaById.clear();
    mediaIdByUrl.clear();
  });
  browserWindow.webContents.on("did-finish-load", () => {
    browserWindow.webContents.send("nexus:browser:language", browserLanguage);
    publishCandidates();
    publishPageState();
  });
  browserWindow.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame) sendBrowserStatus(`Page failed to load: ${description || code} · ${validatedURL || ""}`);
  });
  const wc = browserView.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void wc.loadURL(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, target) => {
    if (!isHttpUrl(target) && target !== "about:blank") event.preventDefault();
  });
  wc.on("will-redirect", (event, target) => {
    if (!isHttpUrl(target) && target !== "about:blank") event.preventDefault();
  });
  wc.on("did-start-navigation", (_event, url, _inPlace, isMainFrame) => {
    if (!isMainFrame) return;
    pageUrl = url;
    mediaById.clear();
    mediaIdByUrl.clear();
    publishCandidates();
    publishPageState();
  });
  wc.on("did-finish-load", publishPageState);
  wc.on("page-title-updated", publishPageState);
  await browserWindow.loadFile(path.join(APP_ROOT, "desktop", "browser-shell.html"));
  if (process.platform === "win32") {
    await browserWindow.webContents.insertCSS(".toolbar { height: 90px !important; flex-basis: 90px !important; padding-top: 32px !important; background: #070D19 !important; }");
  }
  browserWindow.webContents.send("nexus:browser:language", browserLanguage);
  publishCandidates();
  publishPageState();
  await wc.loadURL("about:blank");
}

function sendBrowserStatus(message) {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.send("nexus:browser:status", { message });
}

async function relayRequest(endpoint, body) {
  const base = `http://127.0.0.1:${PORT}`;
  if (!desktopRelayToken) {
    const sessionResponse = await fetch(`${base}/api/desktop-session`, { cache: "no-store" });
    const sessionData = await sessionResponse.json();
    if (!sessionResponse.ok || typeof sessionData.token !== "string") throw new Error("Could not authenticate with the local Nexus Relay.");
    desktopRelayToken = sessionData.token;
  }
  const response = await fetch(`${base}${endpoint}`, {
    method: "POST", headers: { Authorization: `Bearer ${desktopRelayToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Local Relay returned HTTP ${response.status}.`);
  return data;
}

function registerBrowserIpc() {
  ipcMain.handle("nexus:browser:back", (event) => { requireBrowserShellSender(event); if (browserView?.webContents.canGoBack()) browserView.webContents.goBack(); });
  ipcMain.handle("nexus:browser:forward", (event) => { requireBrowserShellSender(event); if (browserView?.webContents.canGoForward()) browserView.webContents.goForward(); });
  ipcMain.handle("nexus:browser:reload", (event) => { requireBrowserShellSender(event); return browserView?.webContents.reload(); });
  ipcMain.handle("nexus:browser:navigate", async (event, value) => {
    requireBrowserShellSender(event);
    if (!browserView) throw new Error("The internal browser is not open.");
    const address = normalizeAddress(value);
    await browserView.webContents.loadURL(address);
    return address;
  });
  ipcMain.on("nexus:browser:panel-state", (event, open) => { requireBrowserShellSender(event); browserDrawerOpen = Boolean(open); updateBrowserBounds(); });
  ipcMain.handle("nexus:browser:inspect", async (event, id) => {
    requireBrowserShellSender(event);
    const item = mediaById.get(String(id));
    if (!item) throw new Error("This media link is no longer available. Refresh the page and try again.");
    const parsed = new URL(item.url);
    const directMedia = item.direct || STREAM_EXTENSIONS.has(path.extname(parsed.pathname).toLowerCase()) || MIME_MEDIA.test(item.mime || "");
    return relayRequest("/api/media/formats", { url: directMedia ? item.url : item.pageUrl || item.url });
  });
  ipcMain.handle("nexus:browser:download", async (event, request) => {
    requireBrowserShellSender(event);
    const item = mediaById.get(String(request?.id));
    if (!item) throw new Error("This media link is no longer available. Refresh the page and try again.");
    const kind = request?.kind;
    if (!["video", "audio", "file"].includes(kind)) throw new Error("Choose a supported media download type.");
    const parsed = new URL(item.url);
    const directMedia = item.direct || STREAM_EXTENSIONS.has(path.extname(parsed.pathname).toLowerCase()) || MIME_MEDIA.test(item.mime || "");
    const url = kind === "file" || directMedia ? item.url : item.pageUrl || item.url;
    return relayRequest("/api/downloads", {
      url, kind, target: "computer",
      ...(kind === "video" ? { quality: typeof request.quality === "string" ? request.quality : "auto" } : {}),
      ...(kind === "audio" ? { audioFormat: request.audioFormat === "m4a" ? "m4a" : "mp3" } : {}),
    });
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1050, minHeight: 700,
    title: "LEVEL UP ARENA NEXUS", autoHideMenuBar: true,
    backgroundColor: "#070D19",
    ...(process.platform === "win32" ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#070D19", symbolColor: "#8293AE", height: 32 } } : {}),
    icon: IS_PACKAGED ? path.join(RESOURCE_ROOT, "app-icon.ico") : path.join(PROJECT_ROOT, "assets", "images", "icon.ico"),
    webPreferences: {
      preload: path.join(APP_ROOT, "desktop", "app-preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === SUPPORT_URL) void shell.openExternal(SUPPORT_URL);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => { if (!isTrustedRelayUrl(target)) event.preventDefault(); });
  mainWindow.webContents.on("will-redirect", (event, target) => { if (!isTrustedRelayUrl(target)) event.preventDefault(); });
  await mainWindow.loadURL(`http://localhost:${PORT}`);
  if (process.platform === "win32") {
    await mainWindow.webContents.insertCSS("#nexus-titlebar { -webkit-app-region: drag; } #nexus-titlebar-controls, #nexus-titlebar-search, #nexus-titlebar button, #nexus-titlebar input { -webkit-app-region: no-drag; }");
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

async function startDesktop() {
  try {
    configureRuntime();
    registerApplicationIpc();
    registerBrowserIpc();
    relay = require("./relay-server.cjs");
    const server = relay.startRelayServer();
    server.once("error", (error) => {
      dialog.showErrorBox("Nexus Relay could not start", `${error.message}\n\nClose the other app using TCP ${PORT}, or choose another local port using NEXUS_PORT.`);
      app.quit();
    });
    await waitForRelay();
    await createWindow();
    setupAutoUpdater();
  } catch (error) {
    dialog.showErrorBox("LEVEL UP ARENA NEXUS", error instanceof Error ? error.message : String(error));
    app.quit();
  }
}

app.whenReady().then(startDesktop);
app.on("activate", () => { if (!mainWindow) void createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (!relay || quitting) return;
  event.preventDefault();
  quitting = true;
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
  void relay.stopRelayServer().finally(() => app.quit());
});
