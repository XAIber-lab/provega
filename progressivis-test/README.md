# progressivis-test

ProgressiVis + ProVega example that streams a sample of taxi pickups (Uber NYC 2014) and visualizes it with a progressive heatmap on a map.

## Prerequisites
- Python 3.11+ with `pip`
- The `vega-embed` build already present at `../build/vega-embed.min.js`

## Installation
```bash
python -m pip install -r requirements.txt
```

> Note: ProgressiVis 0.2.x expects `np.typing` on NumPy; the backend script automatically applies the patch `np.typing = numpy.typing`.

## Start backend (ProgressiVis + Socket.IO)
```bash
cd progressivis-test
python backend.py
# optional: variables to customize
# DATA_PATH=data/uber-rides-aug14-sample.csv MAX_ROWS=20000 CHUNK_SIZE=800 CHUNK_DELAY=0.35 python backend.py
```

- Stream on `ws://localhost:8765`, `data` event (Socket.IO v4), sequential chunks read from a CSV into a ProgressiVis `PTable`.
- Default data comes from `data/uber-rides-aug14-sample.csv` (first 60k rows of the Uber 2014 dataset, limited to 20k by default).

## Start frontend (ProVega)
In another terminal, serve the static files:
```bash
cd progressivis-test
python -m http.server 8000
```
Then open http://localhost:8000/index.html. The Vega-Lite spec in `index.html` points to the backend at `ws://localhost:8765`, uses `data/nyc-boroughs.geojson` for the basemap, and enables `provega` with sequential chunking.

## Key files
- `backend.py`: reads the taxi CSV, populates a ProgressiVis `PTable`, and sends chunks via Socket.IO.
- `index.html`: uses `../build/vega-embed.min.js` for progressive logic and renders a heatmap + pickup timeline.
- `data/uber-rides-aug14-sample.csv`: Uber NYC 2014 sample (reduced).
- `data/nyc-boroughs.geojson`: borough geometries for the background.
- `requirements.txt`: minimal Python dependencies (ProgressiVis + python-socketio).

## What happens
1. `backend.py` loads the first N rows of the taxi CSV, computes hour/weekday, adds a `batch` field, and stores everything in a `PTable`.
2. ProVega opens the Socket.IO connection (`data.url = "ws://localhost:8765"`), accumulates chunks in `_auxBuffer`, and progressively inserts them into the Vega dataset.
3. The UI shows a binned heatmap over NYC and a histogram by hour; play/pause/back controls are handled by the ProVega fork already present in `vega-embed.min.js`.
