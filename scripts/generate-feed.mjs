import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'dist');
const videosDirectory = path.join(root, 'videos');
const configPath = path.resolve(root, process.env.PODCAST_CONFIG || 'podcast.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const siteUrl = process.env.SITE_URL?.replace(/\/$/, '');
const mediaBaseUrl = (process.env.MEDIA_BASE_URL || config.mediaBaseUrl || '').replace(/\/$/, '');
const feedUrl = (process.env.FEED_URL || config.feedUrl || `${siteUrl}/feed.xml`).replace(/\/$/, '');

if (!siteUrl) {
  throw new Error('Set SITE_URL to the public HTTPS URL for this GitHub Pages site.');
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);
}

function encodedPath(fileName) {
  return fileName.split('/').map(encodeURIComponent).join('/');
}

function publicMediaName(fileName) {
  const hash = createHash('sha256').update(fileName).digest('hex').slice(0, 16);
  return `${hash}.mp4`;
}

function publicThumbnailName(fileName) {
  const hash = createHash('sha256').update(fileName).digest('hex').slice(0, 16);
  return `${hash}.jpg`;
}

function commandExists(command) {
  try {
    execFileSync(command, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function absoluteUrl(value) {
  return /^https?:\/\//i.test(value) ? value : `${siteUrl}/${encodedPath(value)}`;
}

async function localFileInfo(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function publicationDate(filePath, modifiedAt) {
  try {
    const committedAt = execFileSync('git', ['log', '-1', '--format=%cI', '--', filePath], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (committedAt) return new Date(committedAt);
  } catch {}
  return modifiedAt;
}

const configuredEpisodes = Array.isArray(config.episodes) ? config.episodes : [];
const videoNames = configuredEpisodes.length
  ? configuredEpisodes.map((episode) => episode.file)
  : (await readdir(videosDirectory))
    .filter((name) => name.toLowerCase().endsWith('.mp4'))
    .sort((left, right) => left.localeCompare(right, 'en'));

if (videoNames.length === 0) {
  throw new Error('No MP4 episodes found in videos/.');
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
if (!mediaBaseUrl) await mkdir(path.join(outputDirectory, 'media'), { recursive: true });
const canGenerateThumbnails = commandExists('ffmpeg');
if (canGenerateThumbnails) await mkdir(path.join(outputDirectory, 'thumbnails'), { recursive: true });

const items = [];
const episodes = [];
for (const name of videoNames) {
  const configuredEpisode = configuredEpisodes.find((episode) => episode.file === name) || {};
  const sourcePath = path.join(videosDirectory, name);
  const fileInfo = await localFileInfo(sourcePath);
  if (!fileInfo && !mediaBaseUrl) throw new Error(`Missing local video: ${name}`);
  const mediaName = publicMediaName(name);
  const mediaPath = `media/${mediaName}`;
  const mediaUrl = mediaBaseUrl ? `${mediaBaseUrl}/${encodedPath(name)}` : `${siteUrl}/${mediaPath}`;
  const thumbnailPath = `thumbnails/${publicThumbnailName(name)}`;
  const episodeArtwork = configuredEpisode.artwork || (fileInfo && canGenerateThumbnails ? thumbnailPath : 'artwork.jpg');
  const title = configuredEpisode.title || name.replace(/\.mp4$/i, '').replace(/^\d+\s*-\s*/, '').trim();
  const publishedAt = configuredEpisode.publishedAt
    ? new Date(configuredEpisode.publishedAt)
    : publicationDate(path.relative(root, sourcePath), fileInfo?.mtime || new Date());

  if (!mediaBaseUrl) await copyFile(sourcePath, path.join(outputDirectory, 'media', mediaName));
  if (!configuredEpisode.artwork && fileInfo && canGenerateThumbnails) {
    execFileSync('ffmpeg', [
      '-y',
      '-ss', '00:00:05',
      '-i', sourcePath,
      '-frames:v', '1',
      '-vf', 'scale=320:-1',
      path.join(outputDirectory, thumbnailPath),
    ], { stdio: 'ignore' });
  }
  episodes.push({
    number: configuredEpisode.number || name.match(/^(\d+)/)?.[1] || '',
    title,
    file: name,
    url: mediaBaseUrl ? mediaUrl : encodedPath(mediaPath),
    artwork: episodeArtwork,
  });
  items.push(`    <item>
      <title>${escapeXml(title)}</title>
      <guid isPermaLink="false">${escapeXml(mediaUrl)}</guid>
      <pubDate>${publishedAt.toUTCString()}</pubDate>
      <enclosure url="${escapeXml(mediaUrl)}" length="${fileInfo?.size || configuredEpisode.length || 0}" type="video/mp4" />
      <itunes:image href="${escapeXml(absoluteUrl(episodeArtwork))}" />
      <itunes:summary>${escapeXml(config.description)}</itunes:summary>
    </item>`);
}

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(config.title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>${escapeXml(config.description)}</description>
    <language>${escapeXml(config.language)}</language>
    <itunes:author>${escapeXml(config.author)}</itunes:author>
    <itunes:explicit>${config.explicit ? 'true' : 'false'}</itunes:explicit>
    <itunes:category text="${escapeXml(config.category)}">
      <itunes:category text="${escapeXml(config.subcategory)}" />
    </itunes:category>
    <itunes:image href="${escapeXml(`${siteUrl}/artwork.jpg`)}" />
${config.ownerName && config.ownerEmail ? `    <itunes:owner>
      <itunes:name>${escapeXml(config.ownerName)}</itunes:name>
      <itunes:email>${escapeXml(config.ownerEmail)}</itunes:email>
    </itunes:owner>` : ''}
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items.join('\n')}
  </channel>
</rss>
`;

await writeFile(path.join(outputDirectory, 'feed.xml'), feed);
await cp(path.join(root, 'app'), outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'site.json'), JSON.stringify({
  title: config.title,
  description: config.description,
  author: config.author,
  artwork: 'artwork.jpg',
  feed: feedUrl,
}, null, 2));
await writeFile(path.join(outputDirectory, 'episodes.json'), JSON.stringify(episodes, null, 2));
await copyFile(path.join(root, 'artwork.jpg'), path.join(outputDirectory, 'artwork.jpg'));
console.log(`Generated ${items.length} episodes from ${path.relative(root, configPath)} at ${path.join(outputDirectory, 'feed.xml')}`);