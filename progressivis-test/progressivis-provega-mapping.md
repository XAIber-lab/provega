# ProgressiVis ↔ ProVega property mapping (reference)

This document summarizes which responsibilities and properties belong to **ProgressiVis** (backend) vs **ProVega** (frontend fork of vega-embed), how they integrate, and how they communicate. It is written against the examples in this repo (e.g., `progressivis-test/backend.py` + `progressivis-test/index.html`).

## High-level roles
- **ProgressiVis (backend)**: produces tabular data progressively; owns chunk sizes/timing; publishes chunks over Socket.IO (`event: "data"`). Has no notion of Vega or visualization.
- **ProVega (frontend)**: consumes a Vega-Lite spec with `provega` block; opens Socket.IO/WebSocket; buffers chunks; drives progressive insertion into Vega datasets; renders marks and UI controls (play/pause/back).

## Property/feature mapping

| Concern / property | Owned by ProgressiVis | Owned by ProVega | Notes |
| --- | --- | --- | --- |
| Data model | `PTable` schema (columns/types) | Vega/Vega-Lite encodings and transforms | Backend schema must match fields used in the spec. |
| Chunk size & cadence | `CHUNK_SIZE`, `CHUNK_DELAY` (e.g., env vars in `backend.py`) | `provega.progression.chunking.reading` (guides UI/progress expectations) | Frontend does **not** push chunk sizes to backend; values can be aligned manually. |
| Total rows | Defined by backend data source (`MAX_ROWS`, file length) | Used only for progress display if provided; otherwise inferred as chunks arrive | No automatic handshake; ProVega infers loaded chunk count. |
| Connection endpoint | Socket.IO server (`ws://host:port`, `event: "data"`) | `data.url` in Vega-Lite spec (`ws://…` or `sio://…`) | ProVega wraps Socket.IO via `initSocketConnection`. |
| Transport protocol | Socket.IO (aiohttp) | Socket.IO client (`socket.io.min.js`) | No REST/fetch for progressive data. Loader bypass prevents Vega fetch. |
| Buffering | N/A (backend just emits) | `_auxBuffer` in ProVega; `_insertNextChunk` drains it | ProVega buffers when paused or faster-than-render data arrives. |
| Play/pause/back controls | N/A | `provega.progression.control` (mode, pause, stop, backward) | Controls are client-side only; backend keeps streaming unless stopped via socket disconnect. |
| Stop/Disconnect | Backend listens for disconnect (Socket.IO) | Stop button disconnects socket; Play reconnects only on reload | No server-side pause; disconnect stops further emits. |
| Progress indicators | Backend prints logs | ProVega progress bar/process panel | Driven by chunk counts buffered/loaded. |
| Visual stability / change marks | N/A | `provega.monitoring.change` and `visualization.visual_stability` | Purely visual; does not affect backend. |
| Filtering / transforms | Backend can pre-filter (optional) | Vega-Lite transforms (`filter`, `bin`, `aggregate`, etc.) | In examples, filters (e.g., bbox) are frontend-only. |
| Field naming | Backend column names | Spec encodings (e.g., `x: {field: "lon"}`) | Must match; otherwise records are dropped/mis-encoded. |
| Error handling | Backend logs errors | Frontend catches socket/load errors, updates info UI | No retry protocol defined beyond reconnecting socket. |

## Integration path (example)
1. Backend loads CSV → builds `PTable` with fields (`id`, `lat`, `lon`, `hour`, `weekday`, `batch`, …).
2. Backend emits chunks on Socket.IO `data` event (`List[dict]`) at cadence `CHUNK_DELAY`, size `CHUNK_SIZE`.
3. Frontend spec sets `data: { name: "pickups", url: "ws://localhost:8765", format: {type: "json"} }` and `provega` block for progressive behavior.
4. ProVega detects `ws://`/`sio://`, opens Socket.IO, writes incoming records into `_auxBuffer`, then into the named dataset `pickups`.
5. Vega-Lite encodings/transforms operate on the progressively growing dataset; UI controls manage insertion cadence (but do not slow the backend stream unless socket is stopped).

## Do ProVega properties inform ProgressiVis? And vice versa?
- **ProVega → ProgressiVis**: No direct control channel. The frontend cannot change backend chunk size/frequency or filters; stopping disconnects the socket (server stops emitting to that client).
- **ProgressiVis → ProVega**: Data schema and chunk cadence implicitly drive visualization; any fields absent/mismatched break encodings. Chunk frequency affects perceived smoothness but ProVega will buffer if render is slower.

## Communication channel
- **Socket.IO** over WebSocket (`ws://…`).
- Event `data` carries an array of records matching the expected schema.
- Disconnect/close events stop emission; reconnect requires a page reload (in current example).

## Alignment tips
- Keep backend `CHUNK_SIZE` ≈ frontend `provega.progression.chunking.reading.chunk_size` for intuitive progress.
- Ensure `data.name` in the spec matches the dataset used in `vegaEmbed` (`pickups`, etc.).
- If you need backend throttling based on UI state, add a custom Socket.IO event (e.g., `pause`/`resume`)—not implemented in these examples.

## Short narrative for an academic paper
ProVega acts as a drop-in progressive renderer for any Vega/Vega-Lite spec, while ProgressiVis remains a generic progressive data engine. The two are loosely coupled: ProgressiVis streams plain JSON rows over Socket.IO, unaware of visualization semantics; ProVega intercepts `ws://`/`sio://` data sources, buffers chunks, and feeds them into Vega’s dataflow, exposing UI controls (play, pause, back) and stability/change cues. This separation of concerns demonstrates generality: any backend capable of emitting chunked JSON (not just ProgressiVis) can drive ProVega, and any Vega-Lite spec can become progressive by adding a `provega` block without changing marks, encodings, or transforms. Conversely, ProgressiVis can power non-ProVega frontends if needed, because it exports neutral tabular chunks. Communication is unidirectional data streaming plus optional disconnect; there is no tight handshake or shared schema beyond matching field names, which keeps both systems independently evolvable yet interoperable.
