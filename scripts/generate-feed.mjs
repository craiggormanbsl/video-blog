import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'dist');
const videosDirectory = path.join(root, 'videos');
const config = JSON.parse(await readFile(path.join(root, 'podcast.json'), 'utf8'));
const siteUrl = process.env.SITE_URL?.replace(/\/$/, '');

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

const videoNames = (await readdir(videosDirectory))
  .filter((name) => name.toLowerCase().endsWith('.mp4'))
  .sort((left, right) => left.localeCompare(right, 'en'));

if (videoNames.length === 0) {
  throw new Error('No MP4 episodes found in videos/.');
}

await mkdir(path.join(outputDirectory, 'videos'), { recursive: true });

const items = [];
const episodes = [];
for (const name of videoNames) {
  const sourcePath = path.join(videosDirectory, name);
  const fileInfo = await stat(sourcePath);
  const mediaUrl = `${siteUrl}/videos/${encodedPath(name)}`;
  const title = name.replace(/\.mp4$/i, '').replace(/^\d+\s*-\s*/, '').trim();
  const publishedAt = publicationDate(path.relative(root, sourcePath), fileInfo.mtime);

  await copyFile(sourcePath, path.join(outputDirectory, 'videos', name));
  episodes.push({
    number: name.match(/^(\d+)/)?.[1] ?? '',
    title,
    file: name,
    url: `videos/${encodedPath(name)}`,
  });
  items.push(`    <item>
      <title>${escapeXml(title)}</title>
      <guid isPermaLink="false">${escapeXml(mediaUrl)}</guid>
      <pubDate>${publishedAt.toUTCString()}</pubDate>
      <enclosure url="${escapeXml(mediaUrl)}" length="${fileInfo.size}" type="video/mp4" />
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
    <atom:link href="${escapeXml(`${siteUrl}/feed.xml`)}" rel="self" type="application/rss+xml" />
${items.join('\n')}
  </channel>
</rss>
`;

await writeFile(path.join(outputDirectory, 'feed.xml'), feed);
await writeFile(path.join(outputDirectory, 'episodes.json'), JSON.stringify(episodes, null, 2));
await cp(path.join(root, 'app'), outputDirectory, { recursive: true });
await copyFile(path.join(root, 'artwork.jpg'), path.join(outputDirectory, 'artwork.jpg'));
console.log(`Generated ${items.length} episodes at ${path.join(outputDirectory, 'feed.xml')}`);