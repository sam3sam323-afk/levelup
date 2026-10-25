const { app, BrowserWindow, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const PORT = Number(process.env.NEXUS_PORT || 8787);
const IS_PACKAGED = app.isPackaged;
const PROJECT_ROOT = IS_PACKAGED ? process.resourcesPath : path.resolve(__dirname, "..");
const RESOURCE_ROOT = IS_PACKAGED ? process.resourcesPath : PROJECT_ROOT;

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
  if (!IS_PACKAGED) {
    process.env.NEXUS_WEB_DIR = path.join(PROJECT_ROOT, "web-dist");
  }
}

async function waitForRelay() {
  const url = `http://127.0.0.1:${PORT}/api/health`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch { /* Wait for the local Express listener. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Nexus Relay did not become ready on port ${PORT}.`);
}

let relay = null;
let quitting = false;
let mainWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 700,
    title: "LEVEL UP ARENA NEXUS",
    autoHideMenuBar: true,
    backgroundColor: "#070D19",
    icon: IS_PACKAGED ? path.join(RESOURCE_ROOT, "app-icon.ico") : path.join(PROJECT_ROOT, "assets", "images", "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, target) => {
    const allowed = `http://localhost:${PORT}`;
    if (!target.startsWith(allowed)) event.preventDefault();
  });
  await mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on("closed", () => { mainWindow = null; });
}

async function startDesktop() {
  try {
    configureRuntime();
    relay = require("./relay-server.cjs");
    const server = relay.startRelayServer();
    server.once("error", (error) => {
      dialog.showErrorBox("Nexus Relay could not start", `${error.message}\n\nClose the other app using TCP ${PORT}, or choose another local port using NEXUS_PORT.`);
      app.quit();
    });
    await waitForRelay();
    await createWindow();
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
  void relay.stopRelayServer().finally(() => app.quit());
});
