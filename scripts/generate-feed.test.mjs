import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteUrl = 'https://podcast.example.com/library';
const mediaBaseUrl = 'https://media.example.com/podcast';

test('publishes JSON titles and configured artwork with a public fallback asset', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-blog-feed-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(path.join(root, 'scripts'), path.join(directory, 'scripts'), { recursive: true });
  await cp(path.join(root, 'app'), path.join(directory, 'app'), { recursive: true });
  await cp(path.join(root, 'artwork.svg'), path.join(directory, 'artwork.svg'));
  await mkdir(path.join(directory, 'videos'));

  const cases = [
    { name: 'relative external image', image: 'artwork.svg', mediaBaseUrl, expected: `${mediaBaseUrl}/artwork.svg` },
    { name: 'encoded image path', image: 'cover images/artwork.svg', mediaBaseUrl: `${mediaBaseUrl}/`, expected: `${mediaBaseUrl}/cover%20images/artwork.svg` },
    { name: 'absolute image', image: 'https://images.example.com/cover.svg', mediaBaseUrl, expected: 'https://images.example.com/cover.svg' },
    { name: 'public image without media base', image: 'artwork.svg', expected: `${siteUrl}/artwork.svg` },
    { name: 'unspecified image', mediaBaseUrl, expected: `${siteUrl}/artwork.svg` },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const config = {
        title: 'Strategy - Supply Chain - Planning',
        description: 'Example episodes',
        image: fixture.image,
        mediaBaseUrl: fixture.mediaBaseUrl,
        episodes: [{ file: '01 - Introduction.mp4', title: 'Introduction' }],
      };
      if (!fixture.mediaBaseUrl) {
        await writeFile(path.join(directory, 'videos', '01 - Introduction.mp4'), 'test media');
        config.episodes[0].artwork = fixture.expected;
      }
      await writeFile(path.join(directory, 'podcast.json'), JSON.stringify(config));
      await exec(process.execPath, [path.join(directory, 'scripts', 'generate-feed.mjs')], {
        env: { ...process.env, SITE_URL: siteUrl, PODCAST_CONFIG: 'podcast.json', MEDIA_BASE_URL: '', FEED_URL: '', ACCESS_CHECK_URL: '' },
      });
      const output = path.join(directory, 'dist');
      const blogs = JSON.parse(await readFile(path.join(output, 'blogs.json'), 'utf8'));
      assert.equal(blogs[0].title, config.title);
      assert.equal(blogs[0].artwork, fixture.expected);
      assert.match(await readFile(path.join(output, 'feed.xml'), 'utf8'), new RegExp(`<itunes:image href="${fixture.expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" />`));
      assert.equal(await readFile(path.join(output, 'artwork.svg'), 'utf8'), await readFile(path.join(root, 'artwork.svg'), 'utf8'));
    });
  }

  await t.test('multiple blogs retain titles and resolve their own images', async () => {
    const blogs = [
      { title: 'First - Subtitle', image: 'artwork.svg', episodes: 'first.json' },
      { title: 'Second', image: 'cover.svg', mediaBaseUrl: 'https://other.example.com/media/', episodes: 'second.json' },
      { title: 'Third', artwork: 'public-cover.svg', episodes: 'third.json' },
    ];
    await writeFile(path.join(directory, 'podcast.json'), JSON.stringify({
      title: 'Library',
      image: 'artwork.svg',
      mediaBaseUrl,
      episodes: [{ file: 'introduction.mp4' }],
      blogs,
    }));
    await exec(process.execPath, [path.join(directory, 'scripts', 'generate-feed.mjs')], {
      env: { ...process.env, SITE_URL: siteUrl, PODCAST_CONFIG: 'podcast.json', MEDIA_BASE_URL: '', FEED_URL: '', ACCESS_CHECK_URL: '' },
    });
    const result = JSON.parse(await readFile(path.join(directory, 'dist', 'blogs.json'), 'utf8'));
    assert.deepEqual(result.map((blog) => blog.title), blogs.map((blog) => blog.title));
    assert.deepEqual(result.map((blog) => blog.episodes), blogs.map((blog) => blog.episodes));
    assert.deepEqual(result.map((blog) => blog.artwork), [
      `${mediaBaseUrl}/artwork.svg`, 'https://other.example.com/media/cover.svg', 'public-cover.svg',
    ]);
  });
});
