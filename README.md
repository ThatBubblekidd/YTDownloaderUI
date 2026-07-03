# YT Downloader UI

A macOS desktop app for browsing YouTube and downloading permitted videos or audio with bundled `yt-dlp` and `ffmpeg`.

## Download

Use the latest GitHub Release assets:

- Apple Silicon Macs: `YT Downloader UI-1.0.0-arm64.dmg`
- Intel Macs: `YT Downloader UI-1.0.0.dmg`

The app is not notarized yet, so macOS may require right-clicking the app and choosing **Open** the first time.

## Development

```sh
npm install
npm start
```

## Build

```sh
npm run dist
```

Release artifacts are written to `release/`.
