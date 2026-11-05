# Static video podcast app

This repository builds a static video podcast web app and RSS feed. The app shell is generic; podcast-specific title, author, artwork, episodes, and feed details come from a build-time JSON configuration and the generated JSON files.

## Publish

1. Push this repository to GitHub on the `main` branch.
2. In the repository, open **Settings > Pages** and set the source to **GitHub Actions**.
3. The workflow publishes the app at `https://OWNER.github.io/REPOSITORY/` and the feed at `https://OWNER.github.io/REPOSITORY/feed.xml`.

The workflow republishes when `main` changes. For a fully public podcast, add MP4 episodes to `videos/`; the feed is generated from that directory. For a podcast hosted by an external media service, keep MP4 files out of the repository and list episodes in the podcast config instead.

For GitHub Actions publishing, add the complete podcast configuration JSON as the repository Actions secret `PODCAST_CONFIG_JSON` (**Settings > Secrets and variables > Actions**). The workflow writes it to the runner's temporary directory for the build; the config is not included in the repository or Pages artifact. Values needed by the public player or RSS feed, such as episode titles and media URLs, are still included in the generated public files.

When local MP4 files are present, the GitHub Pages workflow extracts a thumbnail from each file and uses it as the episode image in the app and RSS feed. Local builds do the same when `ffmpeg` is available; otherwise they fall back to the podcast artwork.

By default, media files are copied into the generated site with hashed public file names. To serve media from an external host instead, set `MEDIA_BASE_URL` when running `scripts/generate-feed.mjs` or set `mediaBaseUrl` in the podcast config. Episode URLs and RSS enclosures will point at that media folder instead of copying videos into the published site.

To generate a static feed file that will be saved somewhere else, set `FEED_URL` to the final URL of that copied `feed.xml` file.

## Podcast details

For local builds, keep the configuration in an ignored `podcast.private.json` file and set `PODCAST_CONFIG` to that path. Set `SITE_URL` as well:

```powershell
$env:PODCAST_CONFIG='podcast.private.json'
$env:SITE_URL='https://OWNER.github.io/REPOSITORY'
node scripts/generate-feed.mjs
```

For an externally hosted podcast, put the media directory URL in `mediaBaseUrl`. If the local MP4 files should not be published with the site, list each episode in the config `episodes` array with its `file`, `title`, optional `number`, and `length` in bytes. If the generated `feed.xml` will be copied to another location, set `feedUrl` to its final URL. See `podcasts/example.external-media.json` for the shape.

The generated landing page reads `blogs.json` and shows each configured blog as a feed card. By default the generator creates one card for the current podcast. To add more feeds to the public landing page, add a `blogs` array to the selected podcast config with each blog's `title`, `description`, `artwork`, `feed`, and `episodes` JSON path.

This feed uses `video/mp4` enclosures. Podcast apps differ in their support for video episodes, and Apple Podcasts may require a compatible video-podcast delivery format and directory setup beyond publishing this RSS feed.