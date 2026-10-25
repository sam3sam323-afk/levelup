import { describe, expect, it } from "vitest";
import { ariaArgs, filenameFromUrl, parseEtaSeconds, qualityHeight, ytDlpArgs, type DownloadJob } from "../relay/downloads";

const videoJob: DownloadJob = {
  id: "test-id", title: "sample", url: "https://media.example/watch/123", kind: "video", engine: "yt-dlp", quality: "4K",
  status: "queued", percent: 0, speedMBps: 0, etaSeconds: null, downloadedBytes: 0, totalBytes: null, createdAt: 0, updatedAt: 0,
};

describe("Nexus local download argument helpers", () => {
  it("maps common resolution labels to actual yt-dlp heights", () => {
    expect(qualityHeight("240p")).toBe(240);
    expect(qualityHeight("1080p")).toBe(1080);
    expect(qualityHeight("4k")).toBe(2160);
    expect(qualityHeight("8K")).toBe(4320);
    expect(qualityHeight("auto")).toBeNull();
  });

  it("requests the selected 4K/8K video height, merges audio, and remuxes to MP4", () => {
    const fourK = ytDlpArgs(videoJob, "/tmp/nexus");
    expect(fourK[fourK.indexOf("--format") + 1]).toContain("[height=2160]");
    expect(fourK).toContain("--merge-output-format");
    expect(fourK).toContain("--remux-video");
    expect(fourK[fourK.indexOf("--progress-template") + 1]).toContain("%(progress.eta)s");
    const eightK = ytDlpArgs({ ...videoJob, quality: "8K" }, "/tmp/nexus");
    expect(eightK[eightK.indexOf("--format") + 1]).toContain("[height=4320]");
  });

  it("configures aria2 for 16 connections and BitTorrent peers", () => {
    const torrent = ariaArgs({ ...videoJob, kind: "torrent", engine: "aria2c", url: "magnet:?xt=urn:btih:1234567890" }, "/tmp/nexus");
    expect(torrent).toContain("--max-connection-per-server=16");
    expect(torrent).toContain("--split=16");
    expect(torrent).toContain("--bt-max-peers=16");
    expect(torrent).toContain("--summary-interval=1");
  });

  it("preserves a direct download's extension and ignores URL query strings", () => {
    expect(filenameFromUrl("https://downloads.example/setup%20game.exe?token=temporary")).toBe("setup game.exe");
    expect(filenameFromUrl("https://downloads.example/files/client.apk")).toBe("client.apk");
  });

  it("parses ETA formats emitted by yt-dlp and aria2c", () => {
    expect(parseEtaSeconds("1m2s")).toBe(62);
    expect(parseEtaSeconds("00:01:05")).toBe(65);
    expect(parseEtaSeconds("NA")).toBeNull();
  });
});
