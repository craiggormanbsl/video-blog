# Supply Chain Strategy podcast feed

This repository publishes the MP4 videos as a video podcast RSS feed using GitHub Pages.

## Publish

1. Push this repository to GitHub on the `main` branch.
2. In the repository, open **Settings > Pages** and set the source to **GitHub Actions**.
3. The workflow publishes the feed at `https://OWNER.github.io/REPOSITORY/feed.xml` (or `https://OWNER.github.io/feed.xml` for an `OWNER.github.io` repository).

The workflow republishes when `main` changes. Add MP4 episodes to `videos/`; the feed is generated from that directory and the media files are published with it. Episode publication dates come from the latest Git commit for each video.

## Podcast details

Edit `podcast.json` to set the show title, description, author, language, category, and explicit-content flag. Add square podcast artwork and an owner contact email before submitting the feed to a podcast directory; those details are not present in the supplied files.

This feed uses `video/mp4` enclosures. Podcast apps differ in their support for video episodes, and Apple Podcasts may require a compatible video-podcast delivery format and directory setup beyond publishing this RSS feed.