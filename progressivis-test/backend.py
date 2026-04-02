"""
ProgressiVis + Socket.IO backend that streams real-ish taxi pickups
into the ProVega frontend. It reads a small Uber NYC 2014 sample CSV,
pushes chunks over WebSocket, and keeps the same chunking semantics the
progressive Vega embed expects.

Run with:
    cd progressivis-test
    python backend.py

Environment knobs:
    DATA_PATH=<csv>   # defaults to data/uber-rides-aug14-sample.csv
    MAX_ROWS=20000    # cap how many rows to stream from the CSV
    CHUNK_SIZE=800    # rows per emitted chunk
    CHUNK_DELAY=0.35  # seconds between chunks
"""

import asyncio
import os
from pathlib import Path
from typing import List

import numpy as np
import numpy.typing as npt
import pandas as pd
import socketio
from aiohttp import web

# ProgressiVis 0.2.x expects np.typing to exist; expose it if NumPy removed the attribute
np.typing = npt  # type: ignore[attr-defined]

# Import after the NumPy patch so progressivis doesn't crash at import time
from progressivis import PTable  # noqa: E402

# Data and streaming parameters
ROOT = Path(__file__).parent
DATA_PATH = Path(os.environ.get("DATA_PATH", ROOT / "data" / "uber-rides-aug14-sample.csv"))
MAX_ROWS = int(os.environ.get("MAX_ROWS", 20_000))
CHUNK_SIZE = max(1, int(os.environ.get("CHUNK_SIZE", 800)))
DELAY_SEC = float(os.environ.get("CHUNK_DELAY", 0.35))

# Socket.IO server setup (aiohttp transport)
sio = socketio.AsyncServer(async_mode="aiohttp", cors_allowed_origins="*")
app = web.Application()
sio.attach(app)


def load_pickups() -> pd.DataFrame:
    """Load and pre-process the NYC Uber sample."""
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"Taxi sample not found at {DATA_PATH}. "
            "Download a CSV with columns Date/Time, Lat, Lon or set DATA_PATH."
        )

    df = pd.read_csv(DATA_PATH, nrows=MAX_ROWS, parse_dates=["Date/Time"])
    df = df.rename(columns={"Lat": "lat", "Lon": "lon"})
    timestamps = pd.to_datetime(df["Date/Time"])
    df = df.assign(
        pickup_ts=timestamps.dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        hour=timestamps.dt.hour.astype(np.int16),
        weekday=timestamps.dt.day_name(),
    )
    df["id"] = np.arange(len(df), dtype=np.int64)
    ordered = df[["id", "lat", "lon", "pickup_ts", "hour", "weekday"]]
    return ordered.reset_index(drop=True)


def make_table() -> PTable:
    """
    Create a ProgressiVis table mirroring the streamed fields.
    The table itself is only here to keep a progressive state server-side.
    """
    return PTable(
        "pickups",
        dshape="{id: int64, lat: float64, lon: float64, pickup_ts: string, hour: int16, weekday: string, batch: int32}",
        create=True,
    )


PICKUPS = load_pickups()
TOTAL_POINTS = len(PICKUPS)
TABLE = make_table()


async def stream_pickups(sid: str) -> None:
    """Send taxi pickup rows in chunks, store them in the PTable, and emit to the client."""
    total_chunks = max(1, (TOTAL_POINTS + CHUNK_SIZE - 1) // CHUNK_SIZE)

    for chunk_idx, start in enumerate(range(0, TOTAL_POINTS, CHUNK_SIZE), start=1):
        chunk = PICKUPS.iloc[start : start + CHUNK_SIZE].copy()
        chunk["batch"] = np.int32(chunk_idx)

        TABLE.append(chunk)

        payload: List[dict] = chunk.to_dict(orient="records")
        await sio.emit("data", payload, to=sid)
        print(f"Sent chunk {chunk_idx}/{total_chunks} -> {len(payload)} records to {sid}")
        await asyncio.sleep(DELAY_SEC)


@sio.event
async def connect(sid, environ) -> None:  # type: ignore[override]
    print(f"[socketio] client connected: {sid}")
    sio.start_background_task(stream_pickups, sid)


@sio.event
async def disconnect(sid) -> None:  # type: ignore[override]
    print(f"[socketio] client disconnected: {sid}")


async def healthcheck(_request: web.Request) -> web.Response:
    return web.Response(text=f"ProgressiVis taxi stream up (rows={TOTAL_POINTS}, chunk={CHUNK_SIZE})\n")


app.router.add_get("/", healthcheck)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    print(
        f"Starting Socket.IO server on ws://localhost:{port} "
        f"(data={DATA_PATH.name}, rows={TOTAL_POINTS}, chunk={CHUNK_SIZE}, delay={DELAY_SEC}s)"
    )
    web.run_app(app, port=port)
