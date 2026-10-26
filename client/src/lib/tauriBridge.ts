import { invoke as tauriInvoke, isTauri as isTauriApp } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export type TauriEngine = "yt-dlp" | "aria2c";
export type DownloadQuality = "best" | "1080p" | "720p" | "480p" | "audio-320" | "audio-192" | "audio-128";

export type PlaylistItemProgress = {
  index: number;
  total?: number;
  title: string;
  progress: number;
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSecond: number;
  etaSeconds?: number;
  state: DownloadTask["state"];
};

export type DownloadOptions = {
  connections?: number;
  outputTemplate?: string;
  audioOnly?: boolean;
  playlist?: boolean;
  quality?: DownloadQuality;
};

export type DownloadTask = {
  taskId: string;
  url: string;
  engine: TauriEngine;
  options?: DownloadOptions;
  downloadDir: string;
  outputPath?: string;
  state: "queued" | "starting" | "downloading" | "paused" | "completed" | "cancelled" | "failed";
  progress: number;
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSecond: number;
  etaSeconds?: number;
  filename?: string;
  pid?: number;
  lastError?: string;
  playlistItems: PlaylistItemProgress[];
  playlistCurrentIndex?: number;
  playlistTotal?: number;
};

export type DownloadProgressEvent = {
  taskId: string;
  state: DownloadTask["state"];
  progress: number;
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSecond: number;
  etaSeconds?: number;
  filename?: string;
  engine: TauriEngine;
  error?: string;
  playlistItems: PlaylistItemProgress[];
  playlistCurrentIndex?: number;
  playlistTotal?: number;
};

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type Listen = (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;

function getTauriRuntime(): { invoke: Invoke; listen: Listen } | null {
  if (!isTauriApp()) return null;
  return {
    invoke: tauriInvoke as Invoke,
    listen: tauriListen as Listen,
  };
}

export function isTauriRuntime(): boolean {
  return isTauriApp();
}

export async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  const runtime = await getTauriRuntime();
  if (!runtime) return null;
  return runtime.invoke(command, args) as Promise<T>;
}

export async function listenTauri<T>(event: string, handler: (payload: T) => void): Promise<(() => void) | null> {
  const runtime = await getTauriRuntime();
  if (!runtime) return null;
  return runtime.listen(event, (received) => handler(received.payload as T));
}


let browserWindow: { close: () => Promise<void> } | null = null;

export async function openBrowserWindow(rawUrl: string): Promise<boolean> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url) || /[\u0000-\u001f\u007f]/.test(url) || url.length > 8192) {
    throw new Error("Only valid http(s) URLs are allowed");
  }
  const runtime = await getTauriRuntime();
  if (!runtime) return false;
  if (browserWindow) {
    await browserWindow.close().catch(() => undefined);
    browserWindow = null;
  }
  const child = new WebviewWindow("nexus-browser", {
    url,
    title: "LEVEL UP NEXUS — Browser",
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    resizable: true,
    center: true,
  });
  browserWindow = child;
  await new Promise<void>((resolve, reject) => {
    child.once("tauri://created", () => resolve());
    child.once("tauri://error", (event) => reject(event));
  });
  return true;
}
