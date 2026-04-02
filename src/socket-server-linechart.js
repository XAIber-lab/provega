// src/live-socket-server.js

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

// 1. App Express + HTTP server
const app = express();
const server = http.createServer(app);

// 2. Socket.IO with open CORS (dev)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 3. Baseline trends per cluster (magenta low, orange mid-low, green mid-high)
const clusterTrends = [
  { clusterID: 'Cluster-0', base: 50,  spikeRange: [10, 20] },  // green: starts mid
  { clusterID: 'Cluster-1', base: 30,  spikeRange: [5, 15]  },  // orange: above magenta
  { clusterID: 'Cluster-2', base: 10,  spikeRange: [2, 8]   }   // magenta: always low
];

// 4. Categorie per triplicare le linee
const categories = ['A', 'B', 'C'];

// 5. Initialize the "lines"
const lines = clusterTrends.flatMap(({ clusterID, base, spikeRange }) =>
  categories.map(category => ({
    id: `${clusterID}-${category}`,
    clusterID,
    category,
    base,
    spikeRange,
    y: base + (Math.random() * 6 - 3)  // start jitter
  }))
);

// 6. Stato globale per il contatore x
let globalX = 0;

// 7. Spike probability
const SPIKE_PROBABILITY = 0.05;

// 8. Random helper
function randBetween(min, max) {
  return Math.random() * (max - min) + min;
}

// 9. Linear decay function (from 1 down to minDecay)
function decayFactor(x, startDecayX = 200, minDecay = 0.2) {
  const f = 1 - Math.min(x / startDecayX, 1) * (1 - minDecay);
  return Math.max(f, minDecay);
}

io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);

  const interval = setInterval(() => {
    const xValue = globalX++;

    lines.forEach(line => {
      // Light drift towards base
      const driftStrength = 0.005;
      const drift = (line.base - line.y) * driftStrength;

      // Wide noise to encourage crossings
      const noise = randBetween(-10, 10);

      // Apply drift + noise
      line.y += drift + noise;

      // --- Cluster-specific spike handling ---
      if (line.clusterID === 'Cluster-1') {
        // -- Orange: huge initial spikes (x<5), then gradual decay
        if (xValue < 5) {
          // mega-spike at startup
          const mega = randBetween(100, 150);
          line.y += mega;
        } else if (Math.random() < SPIKE_PROBABILITY) {
          // decayed spike:
          const decay = decayFactor(xValue, 500, 0.1);
          const [minS, maxS] = line.spikeRange;
          const spike = randBetween(minS, maxS) / decay;
          line.y += spike;
        }
      }
      else if (line.clusterID === 'Cluster-2') {
        // -- Magenta: never large spikes, always in the low range
        // use only the normal spikeRange
        if (Math.random() < SPIKE_PROBABILITY * 0.5) {
          const [minS, maxS] = line.spikeRange;
          const spike = randBetween(minS, maxS);
          line.y += spike;
        }
      }
      else if (line.clusterID === 'Cluster-0') {
        // -- Green: regular, with occasional medium spikes that decay then rise again
        if (Math.random() < SPIKE_PROBABILITY * 1.2) {
          // decay+bounce cycle: use a slow sine wave
          const osc = (Math.sin(xValue / 100) + 1) / 2;  // da 0 a 1
          const [minS, maxS] = [20, 60];
          const spike = randBetween(minS, maxS) * osc;
          line.y += spike;
        }
      }

      // Emit point
      const point = {
        x: xValue,
        y: Math.round(line.y),
        clusterID: line.clusterID,
        category: line.category
      };
      socket.emit('data', point);
    });

  }, 500);

  socket.on('disconnect', () => {
    console.log(`Client disconnesso: ${socket.id}`);
    clearInterval(interval);
  });
});

// 10. Start on port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Socket.IO server in ascolto su http://localhost:${PORT}`);
});
