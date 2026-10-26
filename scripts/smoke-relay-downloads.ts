import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: Buffer) { return createHash("sha256").update(value).digest("hex"); }

async function main() {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-relay-e2e-"));
  const outputDir = path.join(workspace, "downloads");
  mkdirSync(outputDir, { recursive: true });
  process.env.NODE_ENV = "test";
  process.env.NEXUS_RELAY_TEST_FIXTURES = "1";
  process.env.NEXUS_PORT = "0";
  process.env.NEXUS_HOST = "127.0.0.1";
  process.env.NEXUS_RELAY_AUTOSTART = "0";
  process.env.NEXUS_DOWNLOAD_DIR = outputDir;
  const bundledEngines = path.join(process.cwd(), "binaries", "win-x64");
  process.env.YTDLP_PATH ||= process.platform === "win32" ? path.join(bundledEngines, "yt-dlp.exe") : "yt-dlp";
  process.env.ARIA2C_PATH ||= process.platform === "win32" ? path.join(bundledEngines, "aria2", "aria2c.exe") : "aria2c";
  const ffmpegCommand = process.env.FFMPEG_PATH?.trim() || (process.platform === "win32" ? path.join(bundledEngines, "ffmpeg", "ffmpeg.exe") : "ffmpeg");
  process.env.FFMPEG_PATH = path.isAbsolute(ffmpegCommand) ? ffmpegCommand : spawnSync(process.platform === "win32" ? "where" : "which", [ffmpegCommand], { encoding: "utf8" }).stdout?.trim().split(/\r?\n/)[0] || ffmpegCommand;

  const fixtureVideo = path.join(workspace, "sample.mkv");
  const createVideo = spawnSync(process.env.FFMPEG_PATH, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=2",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=2",
    "-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac", "-shortest", "-f", "matroska", fixtureVideo,
  ], { encoding: "utf8", timeout: 60_000 });
  assert(createVideo.status === 0, `Could not generate local Matroska fixture: ${createVideo.stderr || createVideo.error?.message || createVideo.status}`);
  const sourceVideoHash = sha256(readFileSync(fixtureVideo));
  const fileFixture = Buffer.alloc(512 * 1024);
  for (let i = 0; i < fileFixture.length; i += 1) fileFixture[i] = (i * 31 + 7) % 251;

  let relayHttp: Server | undefined;
  let fixtureHttp: Server | undefined;
  let stopRelay: (() => Promise<void>) | undefined;
  try {
    fixtureHttp = createServer(async (req, res) => {
      const isVideo = req.url?.startsWith("/sample.mkv") ?? false;
      const size = isVideo ? statSync(fixtureVideo).size : fileFixture.length;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(size));
      res.setHeader("Content-Type", isVideo ? "video/x-matroska" : "application/octet-stream");
      if (req.headers.range) {
        const range = req.headers.range.match(/bytes=(\d+)-(\d*)/);
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          res.setHeader("Content-Length", String(end - start + 1));
          if (isVideo) await pipeline(createReadStream(fixtureVideo, { start, end }), res);
          else res.end(fileFixture.subarray(start, end + 1));
          return;
        }
      }
      if (isVideo) await pipeline(createReadStream(fixtureVideo), res);
      else res.end(fileFixture);
    });
    fixtureHttp.listen(0, "127.0.0.1");
    await once(fixtureHttp, "listening");
    const fixtureAddress = fixtureHttp.address();
    assert(fixtureAddress && typeof fixtureAddress !== "string", "Local fixture server did not bind.");
    const fixtureBase = `http://127.0.0.1:${fixtureAddress.port}`;

    const relayModule = await import("../relay/server");
    relayHttp = relayModule.startRelayServer() as unknown as Server;
    stopRelay = relayModule.stopRelayServer;
    if (!relayHttp.listening) await once(relayHttp, "listening");
    const relayAddress = relayHttp.address();
    assert(relayAddress && typeof relayAddress !== "string", "Nexus Relay did not bind.");
    const relayBase = `http://127.0.0.1:${relayAddress.port}`;

    const desktopSessionResponse = await fetch(`${relayBase}/api/desktop-session`);
    assert(desktopSessionResponse.ok, `Desktop session endpoint failed: ${desktopSessionResponse.status}`);
    const { token } = await desktopSessionResponse.json() as { token: string };
    assert(token.length >= 32, "Relay returned an invalid desktop bearer token.");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const phoneRoute = await fetch(`${relayBase}/api/downloads`, {
      method: "POST", headers, body: JSON.stringify({ url: `${fixtureBase}/aria-fixture.bin`, kind: "file", target: "phone" }),
    });
    const phoneResult = await phoneRoute.json() as { target?: string; directUrl?: string };
    assert(phoneRoute.ok && phoneResult.target === "phone" && phoneResult.directUrl === `${fixtureBase}/aria-fixture.bin`, "Phone target was not routed back as a direct URL.");

    const directResponse = await fetch(`${relayBase}/api/downloads`, {
      method: "POST", headers, body: JSON.stringify({ url: `${fixtureBase}/aria-fixture.bin`, kind: "file", target: "computer" }),
    });
    assert(directResponse.status === 202, `Computer file POST was not accepted: ${directResponse.status}`);
    const direct = await directResponse.json() as { download: { id: string } };
    const videoResponse = await fetch(`${relayBase}/api/downloads`, {
      method: "POST", headers, body: JSON.stringify({ url: `${fixtureBase}/sample.mkv`, kind: "video", quality: "auto", target: "computer" }),
    });
    assert(videoResponse.status === 202, `Computer video POST was not accepted: ${videoResponse.status}`);
    const video = await videoResponse.json() as { download: { id: string } };

    async function waitForJob(id: string) {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const response = await fetch(`${relayBase}/api/downloads`, { headers });
        assert(response.ok, `Could not read live download state: ${response.status}`);
        const state = await response.json() as { downloads: Array<{ id: string; status: string; percent: number; speedMBps: number; etaSeconds: number | null; error?: string }> };
        const job = state.downloads.find((item) => item.id === id);
        assert(job, `Download ${id} disappeared from the live queue.`);
        if (job.status === "failed") throw new Error(`Download ${id} failed: ${job.error || "unknown engine error"}`);
        if (job.status === "complete") return job;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(`Timed out waiting for actual engine job ${id}.`);
    }

    await Promise.all([waitForJob(direct.download.id), waitForJob(video.download.id)]);
    const ariaFile = path.join(outputDir, "aria-fixture.bin");
    const mp4 = path.join(outputDir, "sample.mp4");
    assert(existsSync(ariaFile) && sha256(readFileSync(ariaFile)) === sha256(fileFixture), "Relay + aria2 did not save the exact direct-file bytes.");
    assert(existsSync(mp4) && statSync(mp4).size > 1024, "Relay + yt-dlp + FFmpeg did not produce the expected MP4.");
    assert(sha256(readFileSync(mp4)) !== sourceVideoHash, "The video output was not remuxed into a new MP4 container.");
    const directTargets = relayModule.getCompletedDownloadTargets(direct.download.id);
    const videoTargets = relayModule.getCompletedDownloadTargets(video.download.id);
    assert(directTargets?.filePath === ariaFile && directTargets.folderPath === outputDir, "Relay did not expose the direct result to the desktop bridge only.");
    assert(videoTargets?.filePath === mp4 && videoTargets.folderPath === outputDir, "yt-dlp did not report its final post-processed media path.");
    const publicStateResponse = await fetch(`${relayBase}/api/downloads`, { headers });
    const publicState = await publicStateResponse.json() as { downloads: Array<{ id: string; filePath?: string; folderPath?: string }> };
    const publicDirect = publicState.downloads.find((item) => item.id === direct.download.id);
    assert(publicStateResponse.ok && publicDirect && !("filePath" in publicDirect) && !("folderPath" in publicDirect), "Local filesystem paths leaked into the public Relay download API.");
    const publicLibraryResponse = await fetch(`${relayBase}/api/library`, { headers });
    const publicLibrary = await publicLibraryResponse.json() as { directory?: string; files: unknown[] };
    assert(publicLibraryResponse.ok && !("directory" in publicLibrary) && !JSON.stringify(publicLibrary).includes(workspace), "The local download directory leaked into the paired Relay library API.");
    const phoneResultAfterDownload = phoneResult as { target?: string; directUrl?: string };
    assert(phoneResultAfterDownload.target === "phone" && !("filePath" in phoneResultAfterDownload), "Computer file paths leaked into the phone route response.");
    console.log("Relay POST target=phone: direct URL returned without spawning a computer download.");
    console.log("Relay POST target=computer + aria2c: 512 KiB local file downloaded byte-for-byte.");
    console.log(`Relay POST target=computer + yt-dlp + FFmpeg: local MKV remuxed to MP4 (${statSync(mp4).size} bytes).`);
    console.log("All test media was generated and served locally; no external media URL was accessed.");
  } finally {
    if (fixtureHttp?.listening) await new Promise<void>((resolve) => fixtureHttp?.close(() => resolve()));
    if (stopRelay) await stopRelay();
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
