import { describe, expect, it } from "vitest";
import { filenameFromUrl, qualityHeight } from "../relay/downloads";

describe("Nexus local download argument helpers", () => {
  it("maps common resolution labels to actual yt-dlp heights", () => {
    expect(qualityHeight("240p")).toBe(240);
    expect(qualityHeight("1080p")).toBe(1080);
    expect(qualityHeight("4k")).toBe(2160);
    expect(qualityHeight("8K")).toBe(4320);
    expect(qualityHeight("auto")).toBeNull();
  });

  it("preserves a direct download's extension and ignores URL query strings", () => {
    expect(filenameFromUrl("https://downloads.example/setup%20game.exe?token=temporary")).toBe("setup game.exe");
    expect(filenameFromUrl("https://downloads.example/files/client.apk")).toBe("client.apk");
  });
});
