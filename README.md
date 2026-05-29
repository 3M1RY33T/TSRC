# TSRC

| *> Overview <* | [Run](#run) | [Browser And ZIM Capture](#browser-and-zim-capture) | [Credits](#credits) |
| --- | --- | --- | --- |

`TSRC` is a local desktop workspace for browsing, saving, indexing, and chatting with offline knowledge sources. It connects to [`tensor-serve`](https://github.com/3M1RY33T/tensor-serve), lets you work with local ZIM files, and helps turn those files into vector databases for local retrieval-augmented chat.

The app is built with Electron, React, Vite, and TypeScript. Electron provides the desktop shell, local filesystem access, native browser view, downloads, and Docker-backed website capture. React and Vite keep the interface fast to develop.

## What It Does

- Connects to a configurable Tensor Serve endpoint.
- Runs local chat against an OpenAI-compatible `/v1/chat/completions` API.
- Shows Tensor Serve health, model, vector database, and collection status.
- Browses local folders for `.zim` archives.
- Searches and downloads ZIM files from the Kiwix/openZIM catalog.
- Opens websites in an embedded desktop browser.
- Saves websites as `.zim` files with Zimit.
- Tracks Kiwix, browser, and Zimit downloads in one Downloads view.
- Builds or loads local vector databases from selected ZIM files.

## Run

Install dependencies:

```bash
npm install
```

Start Tensor Serve:

```bash
tensor-serve start --host 127.0.0.1 --port 8000
```

Run the desktop app:

```bash
npm run dev
```

For renderer-only browser debugging:

```bash
npm run web:dev
```

Build the app:

```bash
npm run build
```

## Browser And ZIM Capture

Open the Browser activity, visit a website, and use the save/download control to create a ZIM archive with Zimit. Zimit runs through Docker using the `ghcr.io/openzim/zimit` image, so Docker Desktop must be installed and running.

The capture panel supports common Zimit options such as:

- ZIM name
- output folder
- page limit
- worker count
- `waitUntil`
- scope exclude regexes
- keeping crawl artifacts
- disabling the image entrypoint ad filtering
- advanced passthrough arguments for Zimit, Browsertrix, and warc2zim

Completed `.zim` captures are added to the local ZIM selection flow so they can be used to create a vector database.

## Downloads

The Downloads section tracks:

- ZIM files downloaded from the Kiwix/openZIM catalog
- regular files downloaded from the embedded browser
- Zimit website capture jobs

Download rows show status, file path or source URL, and progress details when available.

## Credits

TSRC builds on work from the open knowledge and offline web ecosystem:

- [openZIM](https://openzim.org/) for the ZIM file format and tooling.
- [Kiwix](https://www.kiwix.org/) for offline knowledge access and the public ZIM catalog.
- [openzim/zimit](https://github.com/openzim/zimit) for website-to-ZIM capture. Zimit uses Browsertrix Crawler to crawl websites and warc2zim to produce ZIM archives.
- [tensor-serve](https://github.com/3M1RY33T/tensor-serve) for local AI, ingestion, and vector database workflows.

ZIM files and captured website content belong to their original publishers and should be used according to their licenses and terms.

## Development Notes

Main process code lives in `electron/`. The React app lives in `src/`.

When changing Electron main or preload code, fully restart the desktop app. Vite hot module reload only updates the renderer.
