# Static video podcast app

This repository builds a static video podcast web app and RSS feed. The app shell is generic; podcast-specific title, author, artwork, episodes, and feed details come from `podcast.json` and the generated JSON files.

## Publish

1. Push this repository to GitHub on the `main` branch.
2. In the repository, open **Settings > Pages** and set the source to **GitHub Actions**.
3. The workflow publishes the app at `https://OWNER.github.io/REPOSITORY/` and the feed at `https://OWNER.github.io/REPOSITORY/feed.xml`.

The workflow republishes when `main` changes. For a fully public podcast, add MP4 episodes to `videos/`; the feed is generated from that directory. For a protected SharePoint-backed podcast, keep the MP4 files out of the repository and list episodes in the podcast config instead.

When local MP4 files are present, the GitHub Pages workflow extracts a thumbnail from each file and uses it as the episode image in the app and RSS feed. Local builds do the same when `ffmpeg` is available; otherwise they fall back to the podcast artwork.

By default, media files are copied into the generated site with hashed public file names. To keep the public app generic while serving protected media from another location, set `MEDIA_BASE_URL` when running `scripts/generate-feed.mjs` or set `mediaBaseUrl` in the podcast config. Episode URLs and RSS enclosures will point at that media folder instead of copying videos into the published site.

To generate a static feed file that will be saved somewhere else, such as a protected SharePoint folder, also set `FEED_URL` to the final URL of that copied `feed.xml` file.

## Podcast details

Edit `podcast.json` to set the show title, description, author, language, category, explicit-content flag, artwork, and owner contact details. To build a different podcast from another config file, set `PODCAST_CONFIG`:

```powershell
$env:PODCAST_CONFIG='podcasts/example.sharepoint.json'
$env:SITE_URL='https://OWNER.github.io/REPOSITORY'
node scripts/generate-feed.mjs
```

For a SharePoint-directory backed podcast, put the directory URL in `mediaBaseUrl`. If the local MP4 files should not be published with the site, list each episode in the config `episodes` array with its `file`, `title`, optional `number`, and `length` in bytes. If the generated `feed.xml` will be copied into that same protected SharePoint directory, set `feedUrl` to its final SharePoint URL. See `podcasts/example.sharepoint.json` for the shape.

The generated landing page reads `blogs.json` and shows each configured blog as a feed card. By default the generator creates one card for the current podcast. To add more SharePoint-backed blogs to the public landing page, add a `blogs` array to the selected podcast config with each blog's `title`, `description`, `artwork`, `feed`, and `episodes` JSON path.

This feed uses `video/mp4` enclosures. Podcast apps differ in their support for video episodes, and Apple Podcasts may require a compatible video-podcast delivery format and directory setup beyond publishing this RSS feed.