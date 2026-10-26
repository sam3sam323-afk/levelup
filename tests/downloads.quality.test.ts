import { describe, expect, it } from "vitest";
import { ariaArgs, extractAvailableVideoFormats, filenameFromUrl, parseEtaSeconds, qualityHeight, ytDlpArgs, type DownloadJob } from "../relay/downloads";

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
    expect(fourK).toContain("after_move:NEXUS_OUTPUT_PATH=%(filepath)s");
    expect(fourK[fourK.indexOf("--progress-template") + 1]).toContain("%(progress.eta)s");
    const eightK = ytDlpArgs({ ...videoJob, quality: "8K" }, "/tmp/nexus");
    expect(eightK[eightK.indexOf("--format") + 1]).toContain("[height=4320]");
  });

  it("lists unique available heights from yt-dlp and prefers a compatible container", () => {
    const result = extractAvailableVideoFormats({
      title: "Nexus sample", duration: 12,
      formats: [
        { height: 1080, ext: "webm", tbr: 2400, vcodec: "vp9", acodec: "none" },
        { height: 1080, ext: "mp4", tbr: 1800, vcodec: "avc1", acodec: "mp4a" },
        { height: 2160, ext: "mp4", tbr: 6000, vcodec: "avc1", acodec: "none" },
        { height: 4320, ext: "webm", tbr: 18000, vcodec: "vp9", acodec: "none" },
        { height: 720, ext: "m4a", tbr: 128, vcodec: "none", acodec: "mp4a" },
      ],
    });
    expect(result.formats.map((format) => format.quality)).toEqual(["4320p", "2160p", "1080p"]);
    expect(result.formats.at(-1)?.extension).toBe("mp4");
  });

  it("extracts audio-only tracks to the requested MP3 or M4A format", () => {
    for (const audioFormat of ["mp3", "m4a"] as const) {
      const args = ytDlpArgs({ ...videoJob, kind: "audio", audioFormat }, "/tmp/nexus");
      expect(args).toContain("--extract-audio");
      expect(args[args.indexOf("--audio-format") + 1]).toBe(audioFormat);
      expect(args).not.toContain("--merge-output-format");
      expect(args.at(-1)).toBe(videoJob.url);
    }
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
