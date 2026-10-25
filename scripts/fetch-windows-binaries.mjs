import { createHash } from "node:crypto";
import { createWriteStream, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import extract from "extract-zip";

const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, ".cache", "nexus-binaries");
const SOURCE_CACHE = path.join(CACHE, "sources");
const BINARY_ROOT = path.join(ROOT, "binaries", "win-x64");
const STAGE_ROOT = path.join(ROOT, "binaries", `.win-x64-stage-${process.pid}`);
const LICENSE_ROOT = path.join(ROOT, "licenses");
const SOURCE_OUT = path.join(LICENSE_ROOT, "sources");

const ASSETS = [
  { file: "yt-dlp-2026.10.21.exe", url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe", sha256: "33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555", output: path.join(CACHE, "yt-dlp-2026.10.21.exe") },
  { file: "aria2-1.37.0-win-x64.zip", url: "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip", sha256: "67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288", output: path.join(CACHE, "aria2-1.37.0-win-x64.zip") },
  { file: "ffmpeg-9.0.2-win64-lgpl.zip", url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-23-13-04/ffmpeg-N-127957-g935f29eaae-win64-lgpl.zip", sha256: "4c0e53a40ee844ea237f47060316aab077484af51c098eeab4f1a7b0ca9d1302", output: path.join(CACHE, "ffmpeg-9.0.2-win64-lgpl.zip") },
];
const SOURCES = [
  { file: "yt-dlp-2026.10.21.tar.gz", url: "https://github.com/yt-dlp/yt-dlp/archive/refs/tags/2026.10.21.tar.gz", sha256: "d3550322daafb24e1cddc55256fbc8b3b5886cdb5793444ff1ed7c08262a56fb" },
  { file: "aria2-1.37.0.tar.gz", url: "https://github.com/aria2/aria2/archive/refs/tags/release-1.37.0.tar.gz", sha256: "9104878396cc30441976afdd3af9331ec51306fabf92fb82724c3b8fa7d72932" },
  { file: "ffmpeg-9a9b70bb8c96c633f6e588c79f769964b10213b5.tar.gz", url: "https://github.com/FFmpeg/FFmpeg/archive/9a9b70bb8c96c633f6e588c79f769964b10213b5.tar.gz", sha256: "425622f6cf9c3add96709478ed4eca5287fd0f769090a945e3ac6974c4831370" },
];

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function downloadVerified({ file, url, sha256: expected, output }) {
  mkdirSync(path.dirname(output), { recursive: true });
  if (!existsSync(output)) {
    const temporary = `${output}.part-${process.pid}`;
    console.log(`Downloading ${file} from its pinned upstream URL...`);
    const response = await fetch(url, { headers: { "User-Agent": "LEVEL-UP-ARENA-NEXUS binary fetcher" } });
    if (!response.ok || !response.body) throw new Error(`Download failed for ${file}: HTTP ${response.status}`);
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
      renameSync(temporary, output);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
  const actual = sha256(output);
  if (actual !== expected) throw new Error(`${file} SHA-256 mismatch. Expected ${expected}, received ${actual}; remove the cached file and investigate the upstream release.`);
  console.log(`Verified SHA-256: ${file} (${actual})`);
  return output;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "LEVEL-UP-ARENA-NEXUS license fetcher" } });
  if (!response.ok) throw new Error(`Could not retrieve third-party license text: HTTP ${response.status} at ${url}`);
  return response.text();
}

function findFile(directory, filename) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const nested = findFile(full, filename);
      if (nested) return nested;
    }
  }
  return null;
}

function copyRequired(source, destination, label) {
  if (!source || !existsSync(source)) throw new Error(`Required ${label} was not found in the pinned archive.`);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const assets = await Promise.all(ASSETS.map((asset) => downloadVerified(asset)));
  const sources = await Promise.all(SOURCES.map(async (source) => downloadVerified({ ...source, output: path.join(SOURCE_CACHE, source.file) })));

  const oldManifest = path.join(BINARY_ROOT, ".nexus-binaries-manifest.json");
  if (existsSync(BINARY_ROOT) && readdirSync(BINARY_ROOT).length && !existsSync(oldManifest)) {
    throw new Error(`Refusing to overwrite unmanaged binaries in ${BINARY_ROOT}. Move that directory aside first.`);
  }

  rmSync(STAGE_ROOT, { recursive: true, force: true });
  mkdirSync(path.join(STAGE_ROOT, "aria2"), { recursive: true });
  mkdirSync(path.join(STAGE_ROOT, "ffmpeg"), { recursive: true });
  mkdirSync(SOURCE_OUT, { recursive: true });
  const ariaStage = path.join(CACHE, `extract-aria2-${process.pid}`);
  const ffmpegStage = path.join(CACHE, `extract-ffmpeg-${process.pid}`);
  rmSync(ariaStage, { recursive: true, force: true });
  rmSync(ffmpegStage, { recursive: true, force: true });
  mkdirSync(ariaStage, { recursive: true });
  mkdirSync(ffmpegStage, { recursive: true });

  const [ytDlp, aria, ffmpeg] = assets;
  const [ariaSource, ffmpegSource, ytSource] = sources;
  copyFileSync(ytDlp, path.join(STAGE_ROOT, "yt-dlp.exe"));
  await extract(aria, { dir: ariaStage });
  await extract(ffmpeg, { dir: ffmpegStage });
  copyRequired(findFile(ariaStage, "aria2c.exe"), path.join(STAGE_ROOT, "aria2", "aria2c.exe"), "aria2c.exe");
  copyRequired(findFile(ffmpegStage, "ffmpeg.exe"), path.join(STAGE_ROOT, "ffmpeg", "ffmpeg.exe"), "ffmpeg.exe");

  copyRequired(findFile(ariaStage, "COPYING"), path.join(LICENSE_ROOT, "aria2", "COPYING"), "aria2 COPYING");
  copyRequired(findFile(ariaStage, "LICENSE.OpenSSL"), path.join(LICENSE_ROOT, "aria2", "LICENSE.OpenSSL"), "aria2 OpenSSL license");
  copyRequired(findFile(ariaStage, "README.mingw"), path.join(LICENSE_ROOT, "aria2", "README.mingw"), "aria2 Windows build notes");
  mkdirSync(path.join(LICENSE_ROOT, "yt-dlp"), { recursive: true });
  mkdirSync(path.join(LICENSE_ROOT, "ffmpeg"), { recursive: true });
  copyRequired(findFile(ffmpegStage, "LICENSE.txt"), path.join(LICENSE_ROOT, "ffmpeg", "BtbN-LICENSE.txt"), "FFmpeg build license");
  writeFileSync(path.join(LICENSE_ROOT, "ffmpeg", "COPYING.LGPLv2.1"), await fetchText("https://raw.githubusercontent.com/FFmpeg/FFmpeg/9a9b70bb8c96c633f6e588c79f769964b10213b5/COPYING.LGPLv2.1"));
  writeFileSync(path.join(LICENSE_ROOT, "yt-dlp", "LICENSE"), await fetchText("https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.21/LICENSE"));
  writeFileSync(path.join(LICENSE_ROOT, "yt-dlp", "THIRD_PARTY_LICENSES.txt"), await fetchText("https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.21/THIRD_PARTY_LICENSES.txt"));

  for (const file of [ariaSource, ffmpegSource, ytSource]) copyFileSync(file, path.join(SOURCE_OUT, path.basename(file)));
  const manifest = {
    platform: "win32-x64",
    binaries: {
      "yt-dlp.exe": { version: "2026.10.21", sha256: sha256(path.join(STAGE_ROOT, "yt-dlp.exe")), source: ASSETS[0].url },
      "aria2/aria2c.exe": { version: "1.37.0", sha256: sha256(path.join(STAGE_ROOT, "aria2", "aria2c.exe")), source: ASSETS[1].url },
      "ffmpeg/ffmpeg.exe": { version: "N-127957-g935f29eaae", sha256: sha256(path.join(STAGE_ROOT, "ffmpeg", "ffmpeg.exe")), source: ASSETS[2].url, build: "BtbN LGPL build, 2026-10-23" },
    },
    sourceArchives: Object.fromEntries(SOURCES.map((source) => [source.file, source.sha256])),
  };
  writeFileSync(path.join(STAGE_ROOT, ".nexus-binaries-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  if (existsSync(BINARY_ROOT)) rmSync(BINARY_ROOT, { recursive: true, force: true });
  renameSync(STAGE_ROOT, BINARY_ROOT);
  rmSync(ariaStage, { recursive: true, force: true });
  rmSync(ffmpegStage, { recursive: true, force: true });

  const report = {
    platform: manifest.platform,
    assets: ASSETS.map((asset) => ({ file: asset.file, sha256: asset.sha256, bytes: statSync(asset.output).size })),
    engines: manifest.binaries,
    sourceArchives: manifest.sourceArchives,
    licenseDirectory: path.relative(ROOT, LICENSE_ROOT),
  };
  console.log(`\nWindows engines staged in ${path.relative(ROOT, BINARY_ROOT)}.`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
