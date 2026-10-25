import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const RELAY_URL_KEY = "@levelup-nexus/relay-url";
const RELAY_TOKEN_KEY = "levelup-nexus.relay-token";
export type RelaySession = { baseUrl: string; token: string };
export type PairPayload = { type: "nexus-pair"; relay: string; code: string };
export type Transfer = {
  id: string; title: string; url: string; kind: "video" | "file" | "torrent";
  engine: "yt-dlp" | "aria2c"; quality?: string;
  status: "queued" | "downloading" | "complete" | "failed" | "cancelled";
  percent: number; speedMBps: number; etaSeconds?: number | null; downloadedBytes: number; totalBytes: number | null;
  createdAt: number; updatedAt: number; error?: string;
};
export type EngineStatus = {
  ytDlp: { installed: boolean; executable: string };
  ffmpeg: { installed: boolean; executable: string };
  aria2c: { installed: boolean; executable: string };
};

function isPrivateRelayHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".localhost")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

function normalizeRelayUrl(value: string) {
  const url = new URL(value.trim());
  if (!(url.protocol === "http:" || url.protocol === "https:")) throw new Error("Use a local HTTP/HTTPS relay address.");
  if (!isPrivateRelayHost(url.hostname)) throw new Error("Relay address must be on the local network.");
  if (url.username || url.password) throw new Error("Relay address cannot include credentials.");
  return `${url.protocol}//${url.host}`;
}

export function isLocalDesktop() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "[::1]";
}

export function parsePairPayload(raw: string): PairPayload | null {
  try {
    const value = JSON.parse(raw);
    if (value?.type === "nexus-pair" && typeof value.relay === "string" && /^\d{6}$/.test(value.code)) {
      return { type: "nexus-pair", relay: normalizeRelayUrl(value.relay), code: value.code };
    }
  } catch {
    try {
      const url = new URL(raw);
      const relay = url.searchParams.get("relay");
      const code = url.searchParams.get("code");
      if (relay && code && /^\d{6}$/.test(code)) return { type: "nexus-pair", relay: normalizeRelayUrl(relay), code };
    } catch { return null; }
  }
  return null;
}

export async function getRelaySession(): Promise<RelaySession | null> {
  if (isLocalDesktop()) {
    try {
      const response = await fetch(`${window.location.origin}/api/desktop-session`, { cache: "no-store" });
      if (!response.ok) return null;
      const value = await response.json();
      if (typeof value.token === "string") return { baseUrl: window.location.origin, token: value.token };
    } catch { return null; }
  }
  try {
    const [baseUrl, token] = await Promise.all([
      AsyncStorage.getItem(RELAY_URL_KEY),
      Platform.OS === "web" ? AsyncStorage.getItem(RELAY_TOKEN_KEY) : SecureStore.getItemAsync(RELAY_TOKEN_KEY),
    ]);
    return baseUrl && token ? { baseUrl, token } : null;
  } catch { return null; }
}

export function subscribeRelayDownloads(onDownloads: (items: Transfer[]) => void) {
  if (Platform.OS !== "web" || !isLocalDesktop()) return () => undefined;
  type EventStream = { onmessage: ((event: { data: string }) => void) | null; close: () => void };
  const EventSourceCtor = (globalThis as unknown as { EventSource?: new (url: string) => EventStream }).EventSource;
  if (!EventSourceCtor) return () => undefined;
  let closed = false;
  let stream: EventStream | null = null;
  void getRelaySession().then((session) => {
    if (closed || !session) return;
    stream = new EventSourceCtor(`${session.baseUrl}/api/events?token=${encodeURIComponent(session.token)}`);
    stream.onmessage = (event) => {
      try {
        const value = JSON.parse(event.data);
        if (Array.isArray(value.downloads)) onDownloads(value.downloads as Transfer[]);
      } catch { /* Ignore malformed event payloads and keep the local stream open. */ }
    };
  });
  return () => { closed = true; stream?.close(); };
}

export async function pairWithRelay(address: string, code: string, deviceName = "Nexus phone") {
  const baseUrl = normalizeRelayUrl(address);
  if (!/^\d{6}$/.test(code.trim())) throw new Error("Enter the six-digit pairing code.");
  const response = await fetch(`${baseUrl}/api/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim(), deviceName }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.token !== "string") throw new Error(typeof payload.error === "string" ? payload.error : "Pairing failed. Check that both devices are on the same Wi-Fi.");
  await AsyncStorage.setItem(RELAY_URL_KEY, baseUrl);
  if (Platform.OS === "web") await AsyncStorage.setItem(RELAY_TOKEN_KEY, payload.token);
  else await SecureStore.setItemAsync(RELAY_TOKEN_KEY, payload.token);
  return { baseUrl, token: payload.token } satisfies RelaySession;
}

export async function disconnectRelay() {
  await AsyncStorage.multiRemove([RELAY_URL_KEY, ...(Platform.OS === "web" ? [RELAY_TOKEN_KEY] : [])]);
  if (Platform.OS !== "web") await SecureStore.deleteItemAsync(RELAY_TOKEN_KEY).catch(() => undefined);
}

export async function relayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await getRelaySession();
  if (!session) throw new Error("No computer is paired yet.");
  const response = await fetch(`${session.baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}`, ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Relay request failed (${response.status}).`);
  return payload as T;
}

export async function createComputerDownload(input: { url: string; kind: "video" | "file" | "torrent"; quality?: string }) {
  return relayRequest<{ download: Transfer }>("/api/downloads", { method: "POST", body: JSON.stringify({ ...input, target: "computer" }) });
}

export async function routePhoneDownload(url: string) {
  return relayRequest<{ target: "phone"; directUrl: string }>("/api/downloads", {
    method: "POST", body: JSON.stringify({ url, kind: "file", target: "phone" }),
  });
}

export async function cancelComputerDownload(id: string) {
  return relayRequest<{ ok: boolean }>(`/api/downloads/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
}

export async function downloadDirectToPhone(url: string, onProgress: (percent: number, speedMBps: number) => void) {
  if (Platform.OS === "web") throw new Error("Phone storage downloads are available in the native app. Use the phone's browser for a direct link on web.");
  const parsed = new URL(url.trim());
  if (!(parsed.protocol === "http:" || parsed.protocol === "https:") || parsed.username || parsed.password) throw new Error("Phone direct downloads require an HTTP/HTTPS file URL without embedded credentials.");
  const directory = FileSystem.documentDirectory;
  if (!directory) throw new Error("Phone storage is not available.");
  const rawName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "nexus-download.bin");
  const fileName = rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120) || "nexus-download.bin";
  let previousAt = Date.now();
  let previousBytes = 0;
  const task = FileSystem.createDownloadResumable(url, `${directory}${encodeURIComponent(fileName)}`, {}, (progress) => {
    const total = progress.totalBytesExpectedToWrite;
    const written = progress.totalBytesWritten;
    const percent = total > 0 ? Math.min(100, (written / total) * 100) : 0;
    const now = Date.now();
    const seconds = Math.max((now - previousAt) / 1000, 0.2);
    const speedMBps = Math.max(0, (written - previousBytes) / seconds / (1024 ** 2));
    previousAt = now; previousBytes = written;
    onProgress(percent, speedMBps);
  });
  const result = await task.downloadAsync();
  if (!result || result.status < 200 || result.status >= 300) throw new Error(`Download failed${result ? ` (${result.status})` : ""}.`);
  onProgress(100, 0);
  return { uri: result.uri, fileName };
}
