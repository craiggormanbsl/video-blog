# Static video podcast app

This repository builds a static video podcast web app and RSS feed. The app shell is generic; podcast-specific title, author, artwork, episodes, and feed details come from a build-time JSON configuration and the generated JSON files.

## Publish

1. Push this repository to GitHub on the `main` branch.
2. In the repository, open **Settings > Pages** and set the source to **GitHub Actions**.
3. The workflow publishes the app at `https://OWNER.github.io/REPOSITORY/` and the feed at `https://OWNER.github.io/REPOSITORY/feed.xml`.

The workflow republishes when `main` changes. For a fully public podcast, add MP4 episodes to `videos/`; the feed is generated from that directory. For a podcast hosted by an external media service, keep MP4 files out of the repository and list episodes in the podcast config instead.

For GitHub Actions publishing, add the complete podcast configuration JSON as the repository Actions secret `PODCAST_CONFIG_JSON` (**Settings > Secrets and variables > Actions**). The workflow writes it to the runner's temporary directory for the build; the config is not included in the repository or Pages artifact. Values needed by the public player or RSS feed, such as episode titles and media URLs, are still included in the generated public files.

To commit, update the secret from the ignored local `podcast.private.json`, and publish in one step, install and sign in to GitHub CLI (`winget install --id GitHub.cli`, then `gh auth login`) and run:

```powershell
.\scripts\publish.ps1 -Message "Describe the change"
```

If only `podcast.private.json` changed, omit `-Message`; the script updates the secret and starts the publish workflow. Use `-DryRun` to preview the actions without committing, changing the secret, pushing, or starting a workflow.

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

The config has site-wide settings at the top level (`siteTitle`, `siteDescription`, and defaults such as `author`, `language`, `category`, `subcategory`, `explicit`, `ownerName`, `ownerEmail`) and a `podcasts` array with one entry per podcast set. Each entry needs a unique `id` and a `title`, and may override any of the top-level defaults. See `podcasts/example.external-media.json` for the shape. The original single-podcast format (no `podcasts` array) is still accepted.

The first podcast publishes to the site root (`feed.xml`, `episodes.json`) so existing links keep working; each later podcast publishes to `podcasts/<id>/feed.xml` and `podcasts/<id>/episodes.json`. Local MP4s for the first podcast go in `videos/`; later podcasts use `videos/<id>/` unless `videosDirectory` is set.

For an externally hosted podcast, put the media directory URL in that podcast's `mediaBaseUrl`. If the local MP4 files should not be published with the site, list each episode in the podcast's `episodes` array with its `file`, `title`, optional `number`, and `length` in bytes. If the generated `feed.xml` will be copied to another location, set `feedUrl` to its final URL. `accessCheckUrl` (defaulting to `feedUrl`) is checked by the landing page to decide whether to show the podcast.

The generated landing page reads `blogs.json` and shows each podcast as a card using its JSON `title`. The first ` - ` in a card title starts a new line: the first part stays large and bold, and the remainder is a smaller, normal-weight subtitle. Titles without that separator stay on one line (wrapping as needed).

The podcast's `image` can be a full HTTPS URL or a file path such as `artwork.svg`. Relative image paths resolve under `mediaBaseUrl` when configured, otherwise under the public site URL. The player attempts to display that image and falls back to the public generic artwork if it cannot load, including when SharePoint requires authorization. This does not prompt for sign-in or bypass SharePoint permissions.


This feed uses `video/mp4` enclosures. Podcast apps differ in their support for video episodes, and Apple Podcasts may require a compatible video-podcast delivery format and directory setup beyond publishing this RSS feed.