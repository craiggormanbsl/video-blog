import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'dist');
const configPath = path.resolve(root, process.env.PODCAST_CONFIG || 'podcast.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const siteUrl = process.env.SITE_URL?.replace(/\/$/, '');
const inheritedFields = ['author', 'language', 'category', 'subcategory', 'explicit', 'ownerName', 'ownerEmail'];

if (!siteUrl) {
  throw new Error('Set SITE_URL to the public HTTPS URL for this GitHub Pages site.');
}

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (character) => ({
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

function hashedName(value, extension) {
  return `${createHash('sha256').update(value).digest('hex').slice(0, 16)}.${extension}`;
}

function commandExists(command) {
  try {
    execFileSync(command, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function absoluteUrl(value) {
  return isAbsoluteUrl(value) ? value : `${siteUrl}/${encodedPath(value)}`;
}

function imageUrl(value, baseUrl) {
  return isAbsoluteUrl(value) ? value : `${(baseUrl || siteUrl).replace(/\/$/, '')}/${encodedPath(value)}`;
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

function podcastDefinitions() {
  if (config.podcasts !== undefined && !Array.isArray(config.podcasts)) {
    throw new Error('"podcasts" must be an array.');
  }
  if (Array.isArray(config.podcasts) && config.podcasts.length === 0) {
    throw new Error('"podcasts" must contain at least one podcast.');
  }
  const shared = Object.fromEntries(inheritedFields.filter((field) => config[field] !== undefined).map((field) => [field, config[field]]));
  // A config without "podcasts" is the original single-podcast format.
  const podcasts = Array.isArray(config.podcasts) ? config.podcasts.map((podcast) => ({ ...shared, ...podcast })) : [config];
  const ids = new Set();
  return podcasts.map((podcast, index) => {
    if (!podcast || typeof podcast !== 'object' || Array.isArray(podcast)) throw new Error(`Podcast ${index + 1} must be an object.`);
    if (!podcast.title) throw new Error(`Podcast ${index + 1} needs a "title".`);
    const id = slug(podcast.id || podcast.title);
    if (!id) throw new Error(`Podcast ${index + 1} needs an "id" containing letters or numbers.`);
    if (ids.has(id)) throw new Error(`Duplicate podcast id "${id}". Set a unique "id" for each podcast.`);
    if (podcast.order !== undefined && (typeof podcast.order !== 'number' || !Number.isFinite(podcast.order))) {
      throw new Error(`Podcast "${id}" has an invalid "order"; use a number.`);
    }
    ids.add(id);
    return { ...podcast, id };
  });
}

const podcasts = podcastDefinitions();
const canGenerateThumbnails = commandExists('ffmpeg');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const blogs = [];
const displayOrder = [];
let episodeCount = 0;
for (const [index, podcast] of podcasts.entries()) {
  const isDefault = index === 0;
  // The first podcast keeps the original root URLs so existing subscriptions and resume positions still work.
  const outputPrefix = isDefault ? '' : `podcasts/${podcast.id}/`;
  const mediaBaseUrl = ((isDefault && process.env.MEDIA_BASE_URL) || podcast.mediaBaseUrl || '').replace(/\/$/, '');
  const feedUrl = ((isDefault && process.env.FEED_URL) || podcast.feedUrl || `${siteUrl}/${outputPrefix}feed.xml`).replace(/\/$/, '');
  const accessCheckUrl = ((isDefault && process.env.ACCESS_CHECK_URL) || podcast.accessCheckUrl || feedUrl).replace(/\/$/, '');
  const artworkUrl = podcast.image ? imageUrl(podcast.image, mediaBaseUrl) : absoluteUrl(podcast.artwork || 'artwork.svg');
  const videosDirectory = path.resolve(root, podcast.videosDirectory || (isDefault ? 'videos' : `videos/${podcast.id}`));
  const configuredEpisodes = Array.isArray(podcast.episodes) ? podcast.episodes : [];
  const videoNames = configuredEpisodes.length
    ? configuredEpisodes.map((episode) => episode.file)
    : ((await readdir(videosDirectory).catch(() => [])))
      .filter((name) => name.toLowerCase().endsWith('.mp4'))
      .sort((left, right) => left.localeCompare(right, 'en'));

  if (videoNames.length === 0) {
    throw new Error(`No MP4 episodes found for "${podcast.title}" in ${path.relative(root, videosDirectory)}/ or its "episodes" list.`);
  }

  const podcastOutput = path.join(outputDirectory, outputPrefix);
  await mkdir(podcastOutput, { recursive: true });
  const items = [];
  const episodes = [];
  for (const name of videoNames) {
    if (!name) throw new Error(`Every episode in "${podcast.title}" needs a "file".`);
    const configuredEpisode = configuredEpisodes.find((episode) => episode.file === name) || {};
    const sourcePath = path.join(videosDirectory, name);
    const fileInfo = await localFileInfo(sourcePath);
    if (!fileInfo && !mediaBaseUrl) throw new Error(`Missing local video for "${podcast.title}": ${name}`);
    const hashSource = isDefault ? name : `${podcast.id}/${name}`;
    const mediaPath = `media/${hashedName(hashSource, 'mp4')}`;
    const mediaUrl = mediaBaseUrl ? `${mediaBaseUrl}/${encodedPath(name)}` : `${siteUrl}/${mediaPath}`;
    const thumbnailPath = `thumbnails/${hashedName(hashSource, 'jpg')}`;
    const episodeArtwork = configuredEpisode.artwork || (fileInfo && canGenerateThumbnails ? thumbnailPath : artworkUrl);
    const title = configuredEpisode.title || name.replace(/\.mp4$/i, '').replace(/^\d+\s*-\s*/, '').trim();
    const publishedAt = configuredEpisode.publishedAt
      ? new Date(configuredEpisode.publishedAt)
      : publicationDate(path.relative(root, sourcePath), fileInfo?.mtime || new Date());

    if (!mediaBaseUrl) {
      await mkdir(path.join(outputDirectory, 'media'), { recursive: true });
      await copyFile(sourcePath, path.join(outputDirectory, mediaPath));
    }
    if (!configuredEpisode.artwork && fileInfo && canGenerateThumbnails) {
      await mkdir(path.join(outputDirectory, 'thumbnails'), { recursive: true });
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
      <itunes:summary>${escapeXml(podcast.description)}</itunes:summary>
    </item>`);
  }

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(podcast.title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>${escapeXml(podcast.description)}</description>
    <language>${escapeXml(podcast.language)}</language>
    <itunes:author>${escapeXml(podcast.author)}</itunes:author>
    <itunes:explicit>${podcast.explicit ? 'true' : 'false'}</itunes:explicit>
    <itunes:category text="${escapeXml(podcast.category)}">
      <itunes:category text="${escapeXml(podcast.subcategory)}" />
    </itunes:category>
    <itunes:image href="${escapeXml(artworkUrl)}" />
${podcast.ownerName && podcast.ownerEmail ? `    <itunes:owner>
      <itunes:name>${escapeXml(podcast.ownerName)}</itunes:name>
      <itunes:email>${escapeXml(podcast.ownerEmail)}</itunes:email>
    </itunes:owner>` : ''}
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items.join('\n')}
  </channel>
</rss>
`;

  await writeFile(path.join(podcastOutput, 'feed.xml'), feed);
  await writeFile(path.join(podcastOutput, 'episodes.json'), JSON.stringify(episodes, null, 2));
  blogs.push({
    id: podcast.id,
    title: podcast.title,
    description: podcast.description,
    author: podcast.author,
    artwork: artworkUrl,
    feed: feedUrl,
    accessCheckUrl,
    episodes: `${outputPrefix}episodes.json`,
  });
  displayOrder.push(podcast.order === undefined ? index : Number(podcast.order));
  episodeCount += items.length;
}

// "order" changes landing-page position only; output paths stay tied to config position so feed URLs never move.
const orderedBlogs = blogs.map((blog, index) => ({ blog, order: displayOrder[index], index }))
  .sort((left, right) => left.order - right.order || left.index - right.index)
  .map(({ blog }) => blog);

await cp(path.join(root, 'app'), outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'site.json'), JSON.stringify({
  title: config.siteTitle || 'Video Podcasts',
  description: config.siteDescription || 'Independent video episodes.',
  author: blogs[0].author,
  artwork: blogs[0].artwork,
  feed: blogs[0].feed,
  accessCheckUrl: blogs[0].accessCheckUrl,
}, null, 2));
await writeFile(path.join(outputDirectory, 'blogs.json'), JSON.stringify(orderedBlogs, null, 2));
await copyFile(path.join(root, 'artwork.svg'), path.join(outputDirectory, 'artwork.svg'));
console.log(`Generated ${podcasts.length} podcast(s) and ${episodeCount} episodes from ${path.relative(root, configPath)} in ${outputDirectory}`);
