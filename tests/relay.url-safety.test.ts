import { describe, expect, it } from "vitest";
import { assertSafeDownloadTarget, isUnsafeDownloadAddress } from "../relay/url-safety";

describe("Relay download target safety", () => {
  it("blocks loopback, link-local, multicast, and reserved IPv4 destinations", () => {
    for (const address of ["0.0.0.0", "127.0.0.1", "127.255.255.254", "169.254.169.254", "224.0.0.1", "100.64.0.1", "198.51.100.8", "203.0.113.7"]) {
      expect(isUnsafeDownloadAddress(address), address).toBe(true);
    }
  });

  it("blocks loopback, link-local, multicast, mapped-loopback, and documentation IPv6 destinations", () => {
    for (const address of ["::", "::1", "fe80::1", "ff02::1", "::ffff:7f00:1", "2001:db8::1"]) {
      expect(isUnsafeDownloadAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses and private LAN addresses for intentional local shares", () => {
    for (const address of ["8.8.8.8", "192.168.1.20", "10.0.0.7", "172.19.0.2", "2606:4700:4700::1111", "fd12:3456::2"]) {
      expect(isUnsafeDownloadAddress(address), address).toBe(false);
    }
  });

  it("rejects literal loopback URLs and accepts the local private network range", async () => {
    await expect(assertSafeDownloadTarget("http://127.0.0.1:8787/api/health")).rejects.toThrow(/not allowed/i);
    await expect(assertSafeDownloadTarget("http://192.168.1.20/media.mp4")).resolves.toBeUndefined();
  });
});
