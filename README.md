# TSRC

Tensor Serve RAG Client is the first step toward a tensor-powered local AI
desktop workspace. This version is a focused Electron chat client for
[`tensor-serve`](https://github.com/3M1RY33T/tensor-serve), which exposes an
OpenAI-compatible `/v1/chat/completions` endpoint.

## Why This Stack

The long-term app wants a code editor, an embedded browser/webview, local
indexing workflows, and an agentic UI. The current foundation uses Electron,
Vite, React, and TypeScript because Electron gives us the desktop runtime,
Chromium webviews, local filesystem integration, and future automation hooks,
while React/Vite keep the app interface fast to build.

## Run

Start Tensor Serve first:

```bash
tensor-serve start
```

Then run the desktop app:

```bash
npm install
npm run dev
```

Electron will open the TSRC application window.

For renderer-only debugging in a browser:

```bash
npm run web:dev
```

During browser debugging the app defaults to `/tensor`, a Vite proxy for
`http://localhost:8000`. To point that proxy at another Tensor Serve URL:

```bash
VITE_TENSOR_SERVE_URL=http://localhost:3000 npm run web:dev
```

## Current Features

- Connects to a configurable Tensor Serve base URL, defaulting to
  `http://localhost:8000`
- Runs as an Electron desktop application
- Checks `/health` and `/config`
- Reads models from `/v1/models` when available
- Sends chat requests to `/v1/chat/completions`
- Shows Tensor Serve AI, vector DB, and active collection status

## Next Steps

- Add streaming chat responses when Tensor Serve exposes stream passthrough
- Add Electron shell and native window controls
- Add Monaco editor workspace panes
- Add browser/webview tabs
- Add ZIM scrape, archive, ingestion, and collection management workflows
