import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sourceUrls = (process.env.SOURCE_URLS || "")
  .split(/\r?\n/)
  .map(value => value.trim())
  .filter(Boolean);
const keyPrefix = process.env.KEY_PREFIX || "battle_custom";
const splitChapters = process.env.SPLIT_CHAPTERS !== "false";
const requireCreativeCommons = process.env.REQUIRE_CREATIVE_COMMONS === "true";
const assetsDir = process.env.ASSETS_DIR;
const catalogPath = process.env.CATALOG_PATH || "editor/data/bgm.json";
const youtubeApiKey = process.env.YOUTUBE_API_KEY || "";
const importedBy = (process.env.IMPORT_AUTHOR || "").trim();

if (!assetsDir || sourceUrls.length === 0) {
  throw new Error("SOURCE_URLS and ASSETS_DIR are required");
}

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options }).trim();

const slug = value =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36) || "track";

function timestampSeconds(raw) {
  const parts = raw.split(":").map(Number);
  if (parts.some(part => !Number.isFinite(part))) {
    return null;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function descriptionChapters(description, duration) {
  const found = [];
  for (const line of String(description || "").split(/\r?\n/)) {
    const match = line.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+[-|:]?\s*(.+)$/);
    if (!match) {
      continue;
    }
    const stamp = match[1] ? `${match[1]}:${match[2]}:${match[3]}` : `${match[2]}:${match[3]}`;
    const start = timestampSeconds(stamp);
    if (start !== null && start < duration) {
      found.push({ start_time: start, title: match[4].trim() });
    }
  }
  const unique = [...new Map(found.map(chapter => [chapter.start_time, chapter])).values()].sort(
    (a, b) => a.start_time - b.start_time,
  );
  if (unique.length < 2 || unique[0].start_time > 5) {
    return [];
  }
  return unique.map((chapter, index) => ({
    ...chapter,
    end_time: unique[index + 1]?.start_time ?? duration,
  }));
}

async function apiLicense(videoId) {
  if (!youtubeApiKey) {
    return null;
  }
  const params = new URLSearchParams({ part: "status,snippet", id: videoId, key: youtubeApiKey });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!response.ok) {
    console.warn(`YouTube API license lookup failed for ${videoId}: ${response.status}`);
    return null;
  }
  const item = (await response.json()).items?.[0];
  return item ? { license: item.status?.license, channelTitle: item.snippet?.channelTitle } : null;
}

function normalizedLicense(info, api) {
  const raw = `${api?.license || ""} ${info.license || ""}`.toLowerCase();
  if (raw.includes("creativecommon") || raw.includes("creative commons")) {
    return "cc-by";
  }
  if (api?.license === "youtube" || raw.includes("standard youtube")) {
    return "youtube-standard";
  }
  return "unknown";
}

function inspect(url, flat = false) {
  return JSON.parse(
    run("yt-dlp", ["--dump-single-json", "--no-warnings", ...(flat ? ["--flat-playlist"] : ["--no-playlist"]), url]),
  );
}

function expandSources() {
  const videos = [];
  for (const url of sourceUrls) {
    const info = inspect(url, true);
    if (info._type === "playlist" && Array.isArray(info.entries)) {
      for (const entry of info.entries) {
        const videoUrl =
          entry.webpage_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : "");
        if (videoUrl) {
          videos.push({ url: videoUrl, playlistTitle: info.title || "", playlistId: info.id || "" });
        }
      }
    } else {
      videos.push({ url: info.webpage_url || url, playlistTitle: "", playlistId: "" });
    }
  }
  if (videos.length > 100) {
    throw new Error(`Import expands to ${videos.length} videos; the limit is 100 per job`);
  }
  return videos;
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const existingKeys = new Set(catalog.map(track => track.key));
const existingSources = new Set(
  catalog.filter(track => track.sourceVideoId).map(track => `${track.sourceVideoId}:${track.chapterStart ?? 0}`),
);
const workRoot = mkdtempSync(join(tmpdir(), "er-bgm-"));
const bgmDir = join(assetsDir, "audio", "bgm");
let imported = 0;
let skipped = 0;

try {
  const videos = expandSources();
  for (let videoIndex = 0; videoIndex < videos.length; videoIndex++) {
    const source = videos[videoIndex];
    const info = inspect(source.url);
    const duration = Number(info.duration) || 0;
    if (!info.id || duration <= 0 || duration > 14_400) {
      throw new Error(`${source.url}: missing duration or longer than four hours`);
    }
    const api = await apiLicense(info.id);
    const license = normalizedLicense(info, api);
    if (requireCreativeCommons && license !== "cc-by") {
      throw new Error(`${info.title}: license is ${license}; this job requires Creative Commons`);
    }
    let chapters = [];
    let splitMethod = "whole";
    if (splitChapters && Array.isArray(info.chapters) && info.chapters.length > 1) {
      chapters = info.chapters;
      splitMethod = "chapter";
    } else if (splitChapters) {
      chapters = descriptionChapters(info.description, duration);
      splitMethod = chapters.length > 1 ? "timestamp" : "whole";
    }
    if (chapters.length === 0) {
      chapters = [{ title: info.title, start_time: 0, end_time: duration }];
    }

    const videoDir = join(workRoot, String(videoIndex));
    mkdirSync(videoDir, { recursive: true });
    run("yt-dlp", ["-f", "bestaudio/best", "--no-playlist", "-o", join(videoDir, "source.%(ext)s"), source.url]);
    const inputFile = readdirSync(videoDir)
      .map(name => join(videoDir, name))
      .find(name => /source\.[^.]+$/.test(name));
    if (!inputFile) {
      throw new Error(`${info.title}: yt-dlp produced no audio file`);
    }

    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
      const chapter = chapters[chapterIndex];
      const start = Math.max(0, Number(chapter.start_time) || 0);
      const end = Math.min(duration, Number(chapter.end_time) || duration);
      if (end - start < 8) {
        continue;
      }
      const sourceIdentity = `${info.id}:${start}`;
      if (existingSources.has(sourceIdentity)) {
        skipped++;
        continue;
      }
      const trackTitle = chapters.length > 1 ? chapter.title || `${info.title} ${chapterIndex + 1}` : info.title;
      let key = `${keyPrefix}_${String(videoIndex + 1).padStart(2, "0")}_${slug(trackTitle)}`.slice(0, 64);
      let collision = 2;
      while (existingKeys.has(key)) {
        const suffix = `_${collision++}`;
        key = `${key.slice(0, 64 - suffix.length)}${suffix}`;
      }
      const output = join(bgmDir, `${key}.mp3`);
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(start),
        "-to",
        String(end),
        "-i",
        inputFile,
        "-vn",
        "-af",
        "loudnorm=I=-16:LRA=11:TP=-1.5",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "160k",
        output,
      ]);
      const channel = api?.channelTitle || info.channel || info.uploader || "Unknown uploader";
      catalog.push({
        key,
        battle: true,
        title: trackTitle,
        artist: channel,
        sourceUrl: info.webpage_url || source.url,
        sourceVideoId: info.id,
        sourceType: source.playlistId ? "youtube-playlist" : "youtube-video",
        playlistId: source.playlistId || undefined,
        playlistTitle: source.playlistTitle || undefined,
        license,
        attributionRequired: license === "cc-by",
        attribution: `${trackTitle} by ${channel} (${info.webpage_url || source.url})`,
        splitMethod,
        chapterStart: start,
        chapterEnd: end,
        needsManualSplit: splitMethod === "whole" && duration >= 900,
        importedAt: new Date().toISOString(),
        importedBy: importedBy || undefined,
      });
      existingKeys.add(key);
      existingSources.add(sourceIdentity);
      imported++;
      console.log(`${key}: ${license}, ${splitMethod}, ${Math.round(end - start)}s`);
    }
  }
  catalog.sort((a, b) => Number(b.battle) - Number(a.battle) || a.key.localeCompare(b.key));
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Imported ${imported} track(s); skipped ${skipped} existing source segment(s).`);
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
