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
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-blog-feed-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(path.join(root, 'scripts'), path.join(directory, 'scripts'), { recursive: true });
  await cp(path.join(root, 'app'), path.join(directory, 'app'), { recursive: true });
  await cp(path.join(root, 'artwork.svg'), path.join(directory, 'artwork.svg'));
  return directory;
}

async function generate(directory, config) {
  await writeFile(path.join(directory, 'podcast.json'), JSON.stringify(config));
  await exec(process.execPath, [path.join(directory, 'scripts', 'generate-feed.mjs')], {
    env: { ...process.env, SITE_URL: siteUrl, PODCAST_CONFIG: 'podcast.json', MEDIA_BASE_URL: '', FEED_URL: '', ACCESS_CHECK_URL: '' },
  });
  const output = path.join(directory, 'dist');
  return {
    blogs: JSON.parse(await readFile(path.join(output, 'blogs.json'), 'utf8')),
    read: (file) => readFile(path.join(output, file), 'utf8'),
  };
}

test('legacy single-podcast config resolves title and artwork', async (t) => {
  const directory = await workspace(t);
  await mkdir(path.join(directory, 'videos'));
  await writeFile(path.join(directory, 'videos', '01 - Introduction.mp4'), 'test media');
  const cases = [
    { name: 'relative external image', image: 'artwork.svg', mediaBaseUrl, expected: `${mediaBaseUrl}/artwork.svg` },
    { name: 'encoded image path', image: 'cover images/artwork.jpg', mediaBaseUrl: `${mediaBaseUrl}/`, expected: `${mediaBaseUrl}/cover%20images/artwork.jpg` },
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
        episodes: [{ file: '01 - Introduction.mp4', title: 'Introduction', artwork: 'episode.svg' }],
      };
      const { blogs, read } = await generate(directory, config);
      assert.equal(blogs.length, 1);
      assert.equal(blogs[0].title, config.title);
      assert.equal(blogs[0].artwork, fixture.expected);
      assert.equal(blogs[0].episodes, 'episodes.json');
      assert.match(await read('feed.xml'), new RegExp(`<itunes:image href="${escape(fixture.expected)}" />`));
      assert.equal(await read('artwork.svg'), await readFile(path.join(root, 'artwork.svg'), 'utf8'));
    });
  }
});

test('podcasts array publishes a feed and episode list per podcast', async (t) => {
  const directory = await workspace(t);
  await mkdir(path.join(directory, 'videos', 'second-set'), { recursive: true });
  await writeFile(path.join(directory, 'videos', 'second-set', '01 - Local.mp4'), 'test media');
  const { blogs, read } = await generate(directory, {
    siteTitle: 'Library',
    author: 'Shared Author',
    language: 'en-au',
    podcasts: [
      {
        id: 'first',
        title: 'First Set - Planning',
        image: 'artwork.jpg',
        mediaBaseUrl,
        feedUrl: `${mediaBaseUrl}/feed.xml`,
        episodes: [{ file: '01 - Remote.mp4', title: 'Remote', artwork: 'episode.svg' }],
      },
      {
        id: 'second-set',
        title: 'Second Set',
        author: 'Override Author',
        episodes: [{ file: '01 - Local.mp4', title: 'Local', artwork: 'episode.svg' }],
      },
    ],
  });

  assert.deepEqual(blogs.map((blog) => [blog.id, blog.title, blog.episodes, blog.author]), [
    ['first', 'First Set - Planning', 'episodes.json', 'Shared Author'],
    ['second-set', 'Second Set', 'podcasts/second-set/episodes.json', 'Override Author'],
  ]);
  assert.equal(blogs[0].artwork, `${mediaBaseUrl}/artwork.jpg`);
  assert.equal(blogs[0].feed, `${mediaBaseUrl}/feed.xml`);
  assert.equal(blogs[1].artwork, `${siteUrl}/artwork.svg`);
  assert.equal(blogs[1].feed, `${siteUrl}/podcasts/second-set/feed.xml`);

  const [firstEpisodes, secondEpisodes] = await Promise.all([
    read('episodes.json').then(JSON.parse),
    read('podcasts/second-set/episodes.json').then(JSON.parse),
  ]);
  assert.equal(firstEpisodes[0].url, `${mediaBaseUrl}/01%20-%20Remote.mp4`);
  assert.match(secondEpisodes[0].url, /^media\/[0-9a-f]{16}\.mp4$/);
  assert.equal(await read(secondEpisodes[0].url), 'test media');

  const secondFeed = await read('podcasts/second-set/feed.xml');
  assert.match(secondFeed, /<title>Second Set<\/title>/);
  assert.match(secondFeed, /<language>en-au<\/language>/);
  assert.doesNotMatch(secondFeed, /Remote/);
});

test('podcasts array rejects duplicate ids', async (t) => {
  const directory = await workspace(t);
  const episodes = [{ file: 'one.mp4' }];
  await assert.rejects(
    generate(directory, { podcasts: [{ title: 'Same', mediaBaseUrl, episodes }, { title: 'same', mediaBaseUrl, episodes }] }),
    /Duplicate podcast id "same"/,
  );
});

test('order changes landing-page position without moving feed paths', async (t) => {
  const directory = await workspace(t);
  const episodes = [{ file: 'one.mp4' }];
  const { blogs } = await generate(directory, {
    podcasts: [
      { id: 'first', title: 'First', mediaBaseUrl, episodes, order: 2 },
      { id: 'second', title: 'Second', mediaBaseUrl, episodes, order: 1 },
    ],
  });
  assert.deepEqual(blogs.map((blog) => [blog.id, blog.episodes]), [
    ['second', 'podcasts/second/episodes.json'],
    ['first', 'episodes.json'],
  ]);
});
test('an explicit empty episodes list publishes a coming-soon set', async (t) => {
  const directory = await workspace(t);
  const { blogs } = await generate(directory, {
    podcasts: [
      { id: 'live', title: 'Live', mediaBaseUrl, episodes: [{ file: 'one.mp4' }] },
      { id: 'soon', title: 'Soon', mediaBaseUrl, episodes: [] },
    ],
  });
  assert.deepEqual(blogs.map((blog) => [blog.id, blog.episodeCount]), [['live', 1], ['soon', 0]]);
});

test('a podcast with no episodes and no videos is rejected', async (t) => {
  const directory = await workspace(t);
  await assert.rejects(generate(directory, { podcasts: [{ id: 'none', title: 'None', mediaBaseUrl }] }), /No MP4 episodes found/);
});
