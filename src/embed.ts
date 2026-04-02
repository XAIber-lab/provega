import { applyPatch, Operation } from 'fast-json-patch/index.mjs';
import stringify from 'json-stringify-pretty-compact';
// need this import because of https://github.com/npm/node-semver/issues/381
import satisfies from 'semver/functions/satisfies.js';
import vegaImport, { log } from 'vega';
import {
  AutoSize,
  Config as VgConfig,
  EncodeEntryName,
  isBoolean,
  isObject,
  isString,
  Loader,
  LoaderOptions,
  mergeConfig,
  Renderers,
  Spec as VgSpec,
  TooltipHandler,
  View,
} from 'vega';
import { expressionInterpreter } from 'vega-interpreter';
import * as vegaLiteImport from 'vega-lite';
import { Config as VlConfig, TopLevelSpec as VlSpec } from 'vega-lite';
import schemaParser from 'vega-schema-url-parser';
import * as themes from 'vega-themes';
import { Handler, Options as TooltipOptions } from 'vega-tooltip';
import post from './post.js';
import embedStyle from './style.js';
import { Config, ExpressionFunction, Mode } from './types.js';
import { mergeDeep } from './util.js';
import pkg from '../package.json';
import { initSocketConnection } from './socketHandler.js'; //WEBSOCKET SUPPORT

// -------------------------
// Provega enable/disable helper
// -------------------------
const DEFAULT_PROVEGA_ENABLED = true;

/**
 * Checks if Provega should run based on spec and embed options.
 */
function shouldRunProvega(spec: any, embedOptions?: any): boolean {
  // Check explicit override in embed options
  if (embedOptions && typeof embedOptions.provegaEnabled === 'boolean') {
    return embedOptions.provegaEnabled;
  }

  // Check explicit setting in spec
  if (spec && typeof spec.provega === 'object') {
    if (typeof spec.provega.enabled === 'boolean') return spec.provega.enabled;
    // If provega object exists, enable by default
    return true;
  }

  // Global fallback
  return Boolean(DEFAULT_PROVEGA_ENABLED);
}



// ---------------------
// TSNE PROCESS HANDLER
// ---------------------
function initProcessTSNE(view: any, dataSpec: any) {
  console.log("[Provega-Process] initProcessTSNE: starting TSNE process...");

  const candidates = [
    (dataSpec && dataSpec.data && dataSpec.data.name) || undefined,
    dataSpec && dataSpec.name,
    'table',
    'source_0',
    'data_0',
    'root'
  ].filter((v: any, i: number, a: any[]) => v && a.indexOf(v) === i) as string[];

  const initialLen = (dataSpec && dataSpec._initialData && Array.isArray(dataSpec._initialData))
    ? dataSpec._initialData.length
    : (dataSpec && dataSpec.data && Array.isArray(dataSpec.data.values) ? dataSpec.data.values.length : undefined);

  let resolvedName: string | undefined = undefined;
  let runtimeValues: any[] | undefined = undefined;

  // Try explicit candidates from view.data
  for (const name of candidates) {
    if (!name) continue;
    try {
      const vals = (typeof view.data === 'function') ? view.data(name) : undefined;
      if (Array.isArray(vals) && vals.length > 0) {
        if (initialLen === undefined || vals.length === initialLen) {
          resolvedName = name;
          runtimeValues = vals;
          break;
        }
        if (!resolvedName) {
          resolvedName = name;
          runtimeValues = vals;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // If not found, inspect view._runtime.data
  try {
    const runtimeObj = (view as any)._runtime && (view as any)._runtime.data ? (view as any)._runtime.data : null;
    if (runtimeObj && typeof runtimeObj === 'object') {
      let bestName: string | undefined = undefined;
      let bestLen = -1;
      let exactMatchName: string | undefined = undefined;

      for (const key of Object.keys(runtimeObj)) {
        try {
          const vals = (typeof view.data === 'function') ? view.data(key) : undefined;
          const len = Array.isArray(vals) ? vals.length : 0;
          if (initialLen !== undefined && len === initialLen) {
            exactMatchName = key;
            break;
          }
          if (len > bestLen) {
            bestLen = len;
            bestName = key;
          }
        } catch (e) { /* ignore per-key errors */ }
      }

      if (exactMatchName) {
        resolvedName = exactMatchName;
        runtimeValues = view.data(exactMatchName);
      } else if (bestName) {
        resolvedName = bestName;
        runtimeValues = view.data(bestName);
      }
    }
  } catch (e) {
    // ignore introspection errors
  }

  // If still nothing, examine vgSpec.data names
  if ((!runtimeValues || runtimeValues.length === 0) && Array.isArray((dataSpec && dataSpec._vgSpec && dataSpec._vgSpec.data) || [])) {
    const vgDataArr = dataSpec._vgSpec.data;
    let bestName: string | undefined;
    let bestLen = -1;
    for (const d of vgDataArr) {
      if (!d || !d.name) continue;
      try {
        const vals = view.data(d.name);
        const len = Array.isArray(vals) ? vals.length : 0;
        if (initialLen !== undefined && len === initialLen) {
          bestName = d.name;
          bestLen = len;
          break;
        }
        if (len > bestLen) {
          bestLen = len;
          bestName = d.name;
        }
      } catch (e) { /* ignore */ }
    }
    if (bestName) {
      resolvedName = bestName;
      runtimeValues = view.data(bestName);
    }
  }

  // Last attempt: enumerate plausible names
  if (!runtimeValues && typeof (view as any).data === 'function') {
    for (const name of candidates) {
      try {
        const vals = view.data(name);
        if (Array.isArray(vals)) {
          resolvedName = name;
          runtimeValues = vals;
          break;
        }
      } catch (e) { /* ignore */ }
    }
  }

  if (!runtimeValues) {
    console.warn("[Provega-Process] initProcessTSNE: no runtime data found in view (tried candidates):", candidates);
    try {
      const keys = (view as any)._runtime && (view as any)._runtime.data ? Object.keys((view as any)._runtime.data) : [];
      console.log("[Provega-Process] view._runtime.data keys:", keys);
    } catch (e) { /* ignore */ }
    return;
  }

  // Debug snapshot
  try {
    console.log("[Provega-Process] resolvedName:", resolvedName, "runtimeValues.length:", runtimeValues.length, "initialLen:", initialLen);
    console.log("[Provega-Process] runtimeValues sample:", JSON.parse(JSON.stringify(runtimeValues.slice(0, 5))));
  } catch (e) { /* ignore serialization errors */ }

  // Build features array
  const features: number[][] = runtimeValues.map((d: any) => {
    if (!d) return [];
    if (Array.isArray(d.features) && d.features.length > 0) return d.features;
    if (Array.isArray(d.pixels) && d.pixels.length > 0) return d.pixels.map((v: number) => v / 255);
    const numericKeys = Object.keys(d).filter(k => /^f\d+$/.test(k)).sort((a, b) => {
      const ia = parseInt(a.replace(/^f/, ''), 10);
      const ib = parseInt(b.replace(/^f/, ''), 10);
      return ia - ib;
    });
    if (numericKeys.length) return numericKeys.map(k => Number(d[k]) || 0);
    const allNum = Object.keys(d).filter(k => typeof d[k] === 'number').sort();
    if (allNum.length) return allNum.map(k => Number(d[k]) || 0);
    return [];
  });

  // Remove empty feature rows
  const indexMap: number[] = [];
  const packedFeatures: number[][] = [];
  for (let i = 0; i < features.length; i++) {
    if (Array.isArray(features[i]) && features[i].length > 0) {
      indexMap.push(i);
      packedFeatures.push(features[i]);
    }
  }
  if (packedFeatures.length === 0) {
    console.error("[Provega-Process] initProcessTSNE: no valid features found in runtime records.");
    return;
  }

  // Check tsnejs availability
  const tsnelib = (window as any).tsnejs || (window as any).tsne;
  if (!tsnelib || typeof tsnelib.tSNE !== 'function') {
    console.error("[Provega-Process] initProcessTSNE: tsnejs not found in page. Include tsne.js.");
    return;
  }

  // Initialize model
  const N = packedFeatures.length;
  const perplexity = Math.min(30, Math.max(5, Math.floor(N / 10)));
  console.log("[Provega-Process] TSNE config:", { N, perplexity });
  const model = new (tsnelib as any).tSNE({
    epsilon: 13.0, // learning rate
    perplexity,
    dim: 2,
    earlyExaggeration: 1,
    barneshut: true
  });

  const tInitStart = performance.now();
  try {
    model.initDataRaw(packedFeatures);
  } catch (e) {
    console.error("[Provega-Process] initDataRaw failed:", e);
    return;
  }
  const tInitEnd = performance.now();
  console.log(`[Provega-Process] model.initDataRaw done in ${(tInitEnd - tInitStart).toFixed(1)} ms`);

  // Ensure every runtime datum has x,y
  runtimeValues.forEach((d: any) => {
    if (typeof d.x !== 'number') d.x = (Math.random() * 2 - 1) * 5;
    if (typeof d.y !== 'number') d.y = (Math.random() * 2 - 1) * 5;
  });

  // Clear existing handle if present
  if ((view as any)._tsneProcessHandle) {
    try { clearInterval((view as any)._tsneProcessHandle); } catch (e) { /* ignore */ }
    (view as any)._tsneProcessHandle = null;
  }

  // Parameters from spec or fallback
  const freqMs = (dataSpec && dataSpec.provega && dataSpec.provega.progression && dataSpec.provega.progression.chunking && dataSpec.provega.progression.chunking.reading && dataSpec.provega.progression.chunking.reading.frequency) || 200;
  const totalIters = (dataSpec && dataSpec.provega && dataSpec.provega.progression && dataSpec.provega.progression.total_iters) || 500;
  console.log("[Provega-Process] runtime parameters:", { freqMs, totalIters });

  let iter = 0;
  const dsName = resolvedName || (dataSpec && dataSpec.name) || 'source_0';

  const handle = setInterval(async () => {
    iter++;
    const iterStart = performance.now();
    try {
      const stepStart = performance.now();
      model.step();
      const stepEnd = performance.now();

      const Y = (() => {
        try {
          if (typeof model.getSolution === 'function') return model.getSolution();
          return (model as any).Y || (model as any)._y || (model as any).y || null;
        } catch (e) {
          console.warn("[Provega-Process] getSolution failed:", e);
          return null;
        }
      })();

      if (!Y || !Y.length) {
        if (iter % 10 === 0) console.warn("[Provega-Process] model produced empty Y at iter", iter);
        return;
      }

      // Telemetry
      const stepMs = stepEnd - stepStart;
      if (iter <= 10 || iter % 10 === 0) {
        console.log(`[Provega-Process] iter=${iter}/${totalIters} stepMs=${stepMs.toFixed(2)} Ylen=${Y.length}`);
      }

      // Prepare changeset
      const cs = (window as any).vega.changeset();
      const runtimeSnapshot = (typeof view.data === 'function') ? view.data(dsName) || runtimeValues : runtimeValues;
      const targetArray = Array.isArray(runtimeSnapshot) && runtimeSnapshot.length >= runtimeValues.length ? runtimeSnapshot : runtimeValues;

      for (let j = 0; j < indexMap.length; j++) {
        const origIdx = indexMap[j];
        const coords = Y[j] || [0, 0];
        const runtimeDatum = targetArray[origIdx];
        if (runtimeDatum) {
          cs.modify(runtimeDatum, 'x', () => coords[0]);
          cs.modify(runtimeDatum, 'y', () => coords[1]);
        }
      }

      try {
        await view.change(dsName, cs).runAsync();
      } catch (e) {
        try { view.change(dsName, cs).run(); } catch (err) { /* ignore */ }
      }

      const iterEnd = performance.now();
      if (iter <= 5 || iter % 50 === 0) {
        console.log(`[Provega-Process] iter ${iter} roundtrip ${(iterEnd - iterStart).toFixed(1)} ms (step ${stepMs.toFixed(1)} ms)`);
      }

      if (iter >= totalIters) {
        clearInterval(handle);
        (view as any)._tsneProcessHandle = null;
        console.log("[Provega-Process] t-SNE: completed");
      }
    } catch (e) {
      console.error("[Provega-Process] TSNE step error:", e);
      try { clearInterval(handle); } catch (err) { /* ignore */ }
      (view as any)._tsneProcessHandle = null;
    }
  }, freqMs);

  (view as any)._tsneProcessHandle = handle;
  console.log(`[Provega-Process] TSNE started: dataset='${dsName}', runtimeRecords=${runtimeValues.length}, packed=${packedFeatures.length}, freqMs=${freqMs}, totalIters=${totalIters}`);
}



// ---------------------
// Mixed TSNE loop starter / stopper
// ---------------------

function startMixedLoop(view: any, freqMs = 40) {
  const store = (view as any)._mixedTSNE;
  if (!store) {
    console.warn("[Provega-Mixed] startMixedLoop: store missing");
    return;
  }
  if ((view as any)._mixedTSNEHandle) return; // already started

  store._iterCounter = store._iterCounter || 0;

  const handle = setInterval(async () => {
    try {
      if (!store.model || !store.allFeatures || store.allFeatures.length === 0) return;

      const tStepStart = performance.now();
      try {
        store.model.step();
      } catch (e) {
        console.warn("[Provega-Mixed] model.step() error:", e);
      }
      const tStepEnd = performance.now();

      let Y = null;
      try {
        if (typeof store.model.getSolution === 'function') Y = store.model.getSolution();
        else Y = (store.model as any).Y || (store.model as any)._y || (store.model as any).y || null;
      } catch (e) {
        console.warn("[Provega-Mixed] getSolution error:", e);
        Y = null;
      }
      if (!Y || !Y.length) return;

      store.currentY = Y.map((c: any) => [c[0], c[1]]);

      store._iterCounter++;
      if (store._iterCounter <= 5 || store._iterCounter % 20 === 0) {
        console.log(`[Provega-Mixed] loop tick #${store._iterCounter} — stepMs=${(tStepEnd - tStepStart).toFixed(2)} Ylen=${Y.length}`);
      }

      const runtime = typeof view.data === 'function' ? view.data(store.datasetName) : null;
      if (!Array.isArray(runtime) || runtime.length === 0) return;

      const idToDatum = new Map<string, any>();
      for (const d of runtime) {
        if (d && d.id !== undefined) idToDatum.set(String(d.id), d);
      }

      const cs = (window as any).vega.changeset();
      for (let i = 0; i < store.allIds.length; i++) {
        const id = store.allIds[i];
        const coords = store.currentY[i] || [0, 0];
        let datum = null;
        if (id != null && idToDatum.has(String(id))) {
          datum = idToDatum.get(String(id));
        } else if (i < runtime.length) {
          datum = runtime[i];
        }
        if (datum) {
          cs.modify(datum, 'x', () => coords[0]);
          cs.modify(datum, 'y', () => coords[1]);
        }
      }

      try {
        await view.change(store.datasetName, cs).runAsync();
      } catch (e) {
        try { view.change(store.datasetName, cs).run(); } catch (er) { /* ignore */ }
      }
    } catch (err) {
      console.error("[Provega-Mixed] loop error:", err);
    }
  }, freqMs);

  (view as any)._mixedTSNEHandle = handle;
  console.log("[Provega-Mixed] optimization loop started (freqMs =", freqMs, ")");
}

function stopMixedLoop(view: any) {
  const h = (view as any)._mixedTSNEHandle;
  if (h) {
    clearInterval(h);
    (view as any)._mixedTSNEHandle = null;
    console.log("[Provega-Mixed] optimization loop stopped");
  }
}

// Process a newly arrived chunk (append features/ids to store and ensure model init).
// IMPORTANT: call this AFTER view.change(...).runAsync() has completed, so view.data(datasetName)
// actually contains the inserted datum objects (used for mapping id->datum in the loop).
function processChunkMixed(view: any, datasetName: string, newChunk: any[]) {
  const store = (view as any)._mixedTSNE;
  if (!store) {
    console.warn("[Provega-Mixed] processChunkMixed called before setup");
    return;
  }
  if (!Array.isArray(newChunk) || newChunk.length === 0) return;

  const chunkT0 = performance.now();

  // Extract features and ids
  const newFeatures: number[][] = [];
  const newIds: (string | number)[] = [];
  for (const d of newChunk) {
    newIds.push(d.id !== undefined ? d.id : (d._id !== undefined ? d._id : null));
    if (Array.isArray(d.features) && d.features.length) {
      newFeatures.push(d.features);
    } else if (Array.isArray(d.pixels) && d.pixels.length) {
      newFeatures.push(d.pixels.map((v: number) => v / 255));
    } else {
      const keys = Object.keys(d).filter(k => /^f\d+$/.test(k)).sort();
      if (keys.length) newFeatures.push(keys.map(k => Number(d[k]) || 0));
      else newFeatures.push([]); // fallback
    }
  }

  // Append to store arrays
  const prevLen = store.allFeatures.length;
  store.allFeatures = store.allFeatures.concat(newFeatures);
  store.allIds = store.allIds.concat(newIds);

  // Re-init model with full features array
  try {
    const tReinit0 = performance.now();
    const prevY = Array.isArray(store.currentY) && store.currentY.length ? store.currentY.slice() : null;

    store.model.initDataRaw(store.allFeatures);

    // Reuse previous Y for stability
    if (prevY && prevY.length === prevLen) {
      const appended = newFeatures.map(() => [(Math.random() * 2 - 1), (Math.random() * 2 - 1)]);
      try {
        if ((store.model as any).Y && Array.isArray((store.model as any).Y)) {
          (store.model as any).Y = prevY.concat(appended);
        } else if ((store.model as any)._y) {
          (store.model as any)._y = prevY.concat(appended);
        } else if ((store.model as any).y) {
          (store.model as any).y = prevY.concat(appended);
        }
      } catch (e) {
        // ignore
      }
    }

    // Warmup steps
    const warmIters = Math.min(100, Math.max(10, Math.floor(20 * Math.log10(store.allFeatures.length + 1))));
    for (let i = 0; i < warmIters; i++) {
      try { store.model.step(); } catch (e) { /* ignore */ }
    }

    const tReinit1 = performance.now();
    console.log(`[Provega-Mixed] processChunkMixed: reinit+warmup took ${(tReinit1 - tReinit0).toFixed(1)} ms; warmIters=${warmIters}`);

    // Update currentY from model
    let Y = null;
    try {
      if (typeof store.model.getSolution === 'function') Y = store.model.getSolution();
      else Y = (store.model as any).Y || (store.model as any)._y || (store.model as any).y || null;
    } catch (e) { Y = null; }

    if (Y && Y.length) store.currentY = Y.map((c: any) => [c[0], c[1]]);
    else {
      // Fallback: create random coords for new points
      for (let i = prevLen; i < store.allFeatures.length; i++) {
        store.currentY[i] = [(Math.random() * 2 - 1), (Math.random() * 2 - 1)];
      }
    }

    // Ensure loop is running
    startMixedLoop(view);

    const chunkT1 = performance.now();
    console.log(`[Provega-Mixed] appended chunk: prev=${prevLen}, added=${newFeatures.length}, total=${store.allFeatures.length} (proc ${(chunkT1 - chunkT0).toFixed(1)} ms)`);
  } catch (err) {
    console.error("[Provega-Mixed] error re-init model:", err);
  }
}


// ---------------------
// Mixed TSNE setup
// ---------------------
function setupMixedTSNE(view: any, dataSpec: any, vgSpec: any) {
  const store: any = {
    model: null,
    allFeatures: [] as number[][],
    allIds: [] as (string | number)[],
    currentY: [] as number[][],
    datasetName: (dataSpec && dataSpec.data && dataSpec.data.name) || dataSpec.name || 'source_0',
    initialized: false
  };

  (view as any)._mixedTSNE = store;

  const tsnelib = (window as any).tsnejs || (window as any).tsne;
  if (!tsnelib || typeof tsnelib.tSNE !== 'function') {
    console.error("[Provega-Mixed] tsnejs not found - mixed mode unavailable");
    return;
  }

  store.model = new tsnelib.tSNE({
    epsilon: 3.0,
    perplexity: 30,
    dim: 2,
    earlyExaggeration: 2,
    barneshut: true
  });

  console.log("[Provega-Mixed] setup complete. Waiting for chunks to arrive (dataset:", store.datasetName, ")");
}




export const version = pkg.version;

export * from './types.js';

export const vega = vegaImport;
export let vegaLite = vegaLiteImport;

// To handle socketIO
declare var io: any;


// For backwards compatibility with Vega-Lite before v4.
const w = (typeof window !== 'undefined' ? window : undefined) as any;
if (vegaLite === undefined && w?.vl?.compile) {
  vegaLite = w.vl;
}

export interface Actions {
  export?: boolean | { svg?: boolean; png?: boolean };
  source?: boolean;
  compiled?: boolean;
  editor?: boolean;
}

export const DEFAULT_ACTIONS = { export: { svg: true, png: true }, source: true, compiled: true, editor: true };

export interface Hover {
  hoverSet?: EncodeEntryName;
  updateSet?: EncodeEntryName;
}

export type PatchFunc = (spec: VgSpec) => VgSpec;

const I18N = {
  CLICK_TO_VIEW_ACTIONS: 'Click to view actions',
  COMPILED_ACTION: 'View Compiled Vega',
  EDITOR_ACTION: 'Open in Vega Editor',
  PNG_ACTION: 'Save as PNG',
  SOURCE_ACTION: 'View Source',
  SVG_ACTION: 'Save as SVG',
};

export interface EmbedOptions<S = string, R = Renderers> {
  bind?: HTMLElement | string;
  actions?: boolean | Actions;
  mode?: Mode;
  theme?: keyof Omit<typeof themes, 'version'>;
  defaultStyle?: boolean | string;
  logLevel?: number;
  loader?: Loader | LoaderOptions;
  renderer?: R;
  tooltip?: TooltipHandler | TooltipOptions | boolean;
  patch?: S | PatchFunc | Operation[];
  width?: number;
  height?: number;
  padding?: number | { left?: number; right?: number; top?: number; bottom?: number };
  scaleFactor?: number | { svg?: number; png?: number };
  config?: S | Config;
  sourceHeader?: string;
  sourceFooter?: string;
  editorUrl?: string;
  hover?: boolean | Hover;
  i18n?: Partial<typeof I18N>;
  downloadFileName?: string;
  formatLocale?: Record<string, unknown>;
  timeFormatLocale?: Record<string, unknown>;
  expressionFunctions?: ExpressionFunction;
  ast?: boolean;
  expr?: typeof expressionInterpreter;
  viewClass?: typeof View;
  forceActionsMenu?: boolean;
}

const NAMES: { [key in Mode]: string } = {
  vega: 'Vega',
  'vega-lite': 'Vega-Lite',
};

const VERSION = {
  vega: vega.version,
  'vega-lite': vegaLite ? vegaLite.version : 'not available',
};

const PREPROCESSOR: { [mode in Mode]: (spec: any, config?: Config) => VgSpec } = {
  vega: (vgSpec: VgSpec) => vgSpec,
  'vega-lite': (vlSpec, config) => vegaLite.compile(vlSpec as VlSpec, { config: config as VlConfig }).spec,
};

const SVG_CIRCLES = `
<svg viewBox="0 0 16 16" fill="currentColor" stroke="none" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
  <circle r="2" cy="8" cx="2"></circle>
  <circle r="2" cy="8" cx="8"></circle>
  <circle r="2" cy="8" cx="14"></circle>
</svg>`;

const CHART_WRAPPER_CLASS = 'chart-wrapper';

export type VisualizationSpec = VlSpec | VgSpec;

export interface Result {
  /** The Vega view. */
  view: View;

  /** The input specification. */
  spec: VisualizationSpec;

  /** The compiled and patched Vega specification. */
  vgSpec: VgSpec;

  /** The Vega-Embed options. */
  embedOptions: EmbedOptions;

  /** Removes references to unwanted behaviors and memory leaks. Calls Vega's `view.finalize`.  */
  finalize: () => void;
}

function isTooltipHandler(h?: boolean | TooltipOptions | TooltipHandler): h is TooltipHandler {
  return typeof h === 'function';
}

function viewSource(source: string, sourceHeader: string, sourceFooter: string, mode: Mode) {
  const header = `<html><head>${sourceHeader}</head><body><pre><code class="json">`;
  const footer = `</code></pre>${sourceFooter}</body></html>`;

  const win = window.open('')!;
  win.document.write(header + source + footer);
  win.document.title = `${NAMES[mode]} JSON Source`;
}

/**
 * Try to guess the type of spec.
 *
 * @param spec Vega or Vega-Lite spec.
 */
export function guessMode(spec: VisualizationSpec, providedMode?: Mode): Mode {
  // Decide mode
  if (spec.$schema) {
    const parsed = schemaParser(spec.$schema);
    if (providedMode && providedMode !== parsed.library) {
      console.warn(
        `The given visualization spec is written in ${NAMES[parsed.library]}, but mode argument sets ${NAMES[providedMode] ?? providedMode
        }.`,
      );
    }

    const mode = parsed.library as Mode;

    if (!satisfies(VERSION[mode], `^${parsed.version.slice(1)}`)) {
      console.warn(
        `The input spec uses ${NAMES[mode]} ${parsed.version}, but the current version of ${NAMES[mode]} is v${VERSION[mode]}.`,
      );
    }

    return mode;
  }

  // try to guess from the provided spec
  if (
    'mark' in spec ||
    'encoding' in spec ||
    'layer' in spec ||
    'hconcat' in spec ||
    'vconcat' in spec ||
    'facet' in spec ||
    'repeat' in spec
  ) {
    return 'vega-lite';
  }

  if ('marks' in spec || 'signals' in spec || 'scales' in spec || 'axes' in spec) {
    return 'vega';
  }

  return providedMode ?? 'vega';
}

function isLoader(o?: LoaderOptions | Loader): o is Loader {
  return !!(o && 'load' in o);
}

function createLoader(opts?: Loader | LoaderOptions) {
  return isLoader(opts) ? opts : vega.loader(opts);
}

function embedOptionsFromUsermeta(parsedSpec: VisualizationSpec) {
  const opts = (parsedSpec.usermeta as any)?.embedOptions ?? {};
  if (isString(opts.defaultStyle)) {
    // we don't allow styles set via usermeta since it would allow injection of logic (we set the style via innerHTML)
    opts.defaultStyle = false;
  }
  return opts;
}

/**
 * Embed a Vega visualization component in a web page. This function returns a promise.
 *
 * @param el        DOM element in which to place component (DOM node or CSS selector).
 * @param spec      String : A URL string from which to load the Vega specification.
 *                  Object : The Vega/Vega-Lite specification as a parsed JSON object.
 * @param opts       A JavaScript object containing options for embedding.
 */
export default async function embed(
  el: HTMLElement | string,
  spec: VisualizationSpec | string,
  opts: EmbedOptions = {},
): Promise<Result> {
  let parsedSpec: VisualizationSpec;
  let loader: Loader | undefined;

  if (isString(spec)) {
    loader = createLoader(opts.loader);
    parsedSpec = JSON.parse(await loader.load(spec));
  } else {
    parsedSpec = spec;
  }

  const loadedEmbedOptions = embedOptionsFromUsermeta(parsedSpec);
  var usermetaLoader = loadedEmbedOptions.loader;

  // either create the loader for the first time or create a new loader if the spec has new loader options
  if (!loader || usermetaLoader) {
    loader = createLoader(opts.loader ?? usermetaLoader);
  }

  var usermetaOpts = await loadOpts(loadedEmbedOptions, loader);
  const parsedOpts = await loadOpts(opts, loader);

  const mergedOpts = {
    ...mergeDeep(parsedOpts, usermetaOpts),
    config: mergeConfig(parsedOpts.config ?? {}, usermetaOpts.config ?? {}),
  };

  return await _embed(el, parsedSpec, mergedOpts, loader);
}

async function loadOpts(opt: EmbedOptions, loader: Loader): Promise<EmbedOptions<never>> {
  const config: Config = isString(opt.config) ? JSON.parse(await loader.load(opt.config)) : (opt.config ?? {});
  const patch: PatchFunc | Operation[] = isString(opt.patch) ? JSON.parse(await loader.load(opt.patch)) : opt.patch;
  return {
    ...(opt as any),
    ...(patch ? { patch } : {}),
    ...(config ? { config } : {}),
  };
}

function getRoot(el: Element) {
  const possibleRoot = el.getRootNode ? el.getRootNode() : document;
  return possibleRoot instanceof ShadowRoot
    ? { root: possibleRoot, rootContainer: possibleRoot }
    : { root: document, rootContainer: document.head ?? document.body };
}

async function _embed(
  el: HTMLElement | string,
  spec: VisualizationSpec,
  opts: EmbedOptions<never> = {},
  loader: Loader,
): Promise<Result> {
  const config = opts.theme ? mergeConfig(themes[opts.theme], opts.config ?? {}) : opts.config;

  const actions = isBoolean(opts.actions) ? opts.actions : mergeDeep<Actions>({}, DEFAULT_ACTIONS, opts.actions ?? {});
  const i18n = { ...I18N, ...opts.i18n };

  const renderer = opts.renderer ?? 'svg';
  const logLevel = opts.logLevel ?? vega.Warn;
  const downloadFileName = opts.downloadFileName ?? 'visualization';

  const element = typeof el === 'string' ? document.querySelector(el) : el;
  if (!element) {
    throw new Error(`${el} does not exist`);
  }

  if (opts.defaultStyle !== false) {
    const ID = 'vega-embed-style';
    const { root, rootContainer } = getRoot(element);
    if (!root.getElementById(ID)) {
      const style = document.createElement('style');
      style.id = ID;
      style.innerHTML =
        opts.defaultStyle === undefined || opts.defaultStyle === true
          ? (embedStyle ?? '').toString()
          : opts.defaultStyle;
      rootContainer.appendChild(style);
    }
  }

  const mode = guessMode(spec, opts.mode);

  let vgSpec: VgSpec = PREPROCESSOR[mode](spec, config);

  if (mode === 'vega-lite') {
    if (vgSpec.$schema) {
      const parsed = schemaParser(vgSpec.$schema);

      if (!satisfies(VERSION.vega, `^${parsed.version.slice(1)}`)) {
        console.warn(`The compiled spec uses Vega ${parsed.version}, but current version is v${VERSION.vega}.`);
      }
    }
  }

  element.classList.add('vega-embed');
  if (actions) {
    element.classList.add('has-actions');
  }
  element.innerHTML = ''; // clear container

  let container = element;
  if (actions) {
    const chartWrapper = document.createElement('div');
    chartWrapper.classList.add(CHART_WRAPPER_CLASS);
    element.appendChild(chartWrapper);
    container = chartWrapper;
  }

  const patch = opts.patch;
  if (patch) {
    vgSpec = patch instanceof Function ? patch(vgSpec) : applyPatch(vgSpec, patch, true, false).newDocument;
  }

  // Set locale. Note that this is a global setting.
  if (opts.formatLocale) {
    vega.formatLocale(opts.formatLocale);
  }

  if (opts.timeFormatLocale) {
    vega.timeFormatLocale(opts.timeFormatLocale);
  }

  // Set custom expression functions
  if (opts.expressionFunctions) {
    for (const name in opts.expressionFunctions) {
      const expressionFunction = opts.expressionFunctions[name];
      if ('fn' in expressionFunction) {
        vega.expressionFunction(name, expressionFunction.fn, expressionFunction['visitor']);
      } else if (expressionFunction instanceof Function) {
        vega.expressionFunction(name, expressionFunction);
      }
    }
  }

  const { ast } = opts;

  ///////// Modified from here
  function setSpinnerActive(spinnerEl: HTMLElement, active: boolean) {
    if (spinnerEl == null) return;
    if (active) {
      spinnerEl.classList.add('spinning');
    } else {
      spinnerEl.classList.remove('spinning');
    }
  }

  // -- SPEC NORMALIZATION & PARTIAL RESULTS BUFFER --
  // Prepare the buffer for originalValues
  // after spec and embedOptions are ready
  const runProvega = shouldRunProvega(spec, opts);
  console.log("[Provega] runProvega =", runProvega);
  var qualitySignals: string[] = [];
  var q: Record<string, any> = {}; // opzionale: mantiene la reference alla "quality" config

  // ANTI-GLITCH: if we run Provega, back up values and clear spec.data.values
  // *before* Vega starts rendering, to avoid the initial flash of the full dataset.
  if (runProvega) {
    try {
      // Top-level spec.data.values
      if (spec && spec.data && Array.isArray(spec.data.values) && spec.data.values.length > 0) {
        spec._initialData = spec._initialData || spec.data.values.slice();
        spec.data.values = [];
        console.log("[Provega] backed up initial data -> spec.data.values cleared (len=", spec._initialData.length, ")");
      }

      // Top-level spec.values case (less common)
      if (Array.isArray((spec as any).values) && (spec as any).values.length > 0) {
        spec._initialData = spec._initialData || (spec as any).values.slice();
        (spec as any).values = [];
        console.log("[Provega] backed up top-level spec.values -> cleared");
      }

      // If we already have a compiled vgSpec, try clearing .values in vgSpec.data
      if (spec._vgSpec && Array.isArray(spec._vgSpec.data)) {
        spec._vgSpec.data.forEach((d: any, idx: number) => {
          if (d && Array.isArray(d.values) && d.values.length > 0) {
            // store into _initialValues and clear values
            d._initialValues = d._initialValues || d.values.slice();
            d.values = [];
            console.log(`[Provega] cleared spec._vgSpec.data[${idx}].values (backup to _initialValues)`);
          }
        });
      }
    } catch (e) {
      console.warn("[Provega] anti-glitch backup/clear failed:", e);
    }
  }

  let originalValues: any[] = [];
  var isColorEncoding = false;
  var socketCheck = false;

  if (spec.data && spec.data.url && /^wss?:\/\//.test(spec.data.url)) {
    console.log("SocketIO URL detected:", spec.data.url);
    socketCheck = true;
  }

  if (spec && spec !== true && runProvega) {
    const dataSpec = spec as any;
    console.log("Data Spec Not Normalized:", dataSpec);
    console.log("spec", spec);
    if (
      spec &&
      typeof spec === "object" &&
      "encoding" in spec &&
      spec.encoding &&
      "color" in spec.encoding &&
      spec.encoding.color &&
      "scale" in spec.encoding.color &&
      spec.encoding.color.scale &&
      spec.encoding.color.type == "quantitative"
      //&& spec.encoding.color.scale.scheme === "blues"
    ) {
      isColorEncoding = true;
    }

    // Chunking: tipo e parametri di lettura
    console.log(dataSpec);
    dataSpec.provega = dataSpec.provega || {};
    dataSpec.provega.progression = dataSpec.provega.progression || {};
    dataSpec.provega.progression.chunking = dataSpec.provega.progression.chunking || {};
    dataSpec.provega.progression.chunking.reading = dataSpec.provega.progression.chunking.reading || {};

    dataSpec.provega.progression.chunking.type =
      dataSpec.provega.progression.chunking.type || "data";
    dataSpec.provega.progression.chunking.reading.method =
      dataSpec.provega.progression.chunking.reading.method || "sequential";
    dataSpec.provega.progression.chunking.reading.ascending =
      dataSpec.provega.progression.chunking.reading.ascending !== false;
    dataSpec.provega.progression.chunking.reading.chunk_size =
      dataSpec.provega.progression.chunking.reading.chunk_size || 10;
    dataSpec.provega.progression.chunking.reading.frequency =
      dataSpec.provega.progression.chunking.reading.frequency || 1000;
    dataSpec.provega.progression.chunking.reading.seed =
      dataSpec.provega.progression.chunking.reading.seed || 0;

    console.log(vgSpec);
    // Find the dataset in vgSpec.data
    // --- Robust dataset detection ---
    const vgData = Array.isArray(vgSpec.data) ? vgSpec.data : [];

    const wantedName = (dataSpec.data && dataSpec.data.name) || dataSpec.name || "source_0";

    let dataset =
      vgData.find((d: any) => d.name === wantedName) ||
      vgData.find((d: any) => d.source === wantedName) ||
      vgData.find((d: any) => Array.isArray(d.values) && d.values.length > 0) ||
      vgData.find((d: any) => !("source" in d)) ||
      vgData[0];

    console.log("vgSpec.data:", vgData);
    console.log("Resolved dataset (candidate):", dataset, "wantedName:", wantedName);

    // 1) If values are partialResult wrappers, buffer them into _initialPartials
    if (
      Array.isArray((dataSpec as any).values) &&
      (dataSpec as any).values.length > 0 &&
      typeof (dataSpec as any).values[0] === "object" &&
      "process_metadata" in (dataSpec as any).values[0]
    ) {
      dataSpec._initialPartials = (dataSpec as any).values.slice();
      if (dataset) dataset.values = [];
      originalValues = dataSpec._initialPartials;
    }
    // 2) Otherwise in "data" mode: prefer _initialData if already present (anti-glitch),
    //    otherwise read from dataset.values as before.
    else if (Array.isArray(dataSpec._initialData) && dataSpec._initialData.length > 0) {
      // we already backed up data in _initialData (anti-glitch)
      originalValues = dataSpec._initialData;
      // ensure the source in vgSpec does not contain values (already cleared earlier),
      // but keep the buffer in dataSpec._initialData for chunking.
      if (dataset && Array.isArray(dataset.values) && dataset.values.length > 0) {
        // edge: se per qualche motivo ci sono ancora values, svuotiamoli
        dataset.values = [];
      }
    } else if (dataset && Array.isArray(dataset.values)) {
      dataSpec._initialData = dataset.values.slice();
      dataset.values = [];
      originalValues = dataSpec._initialData;
    }

    console.log("Data Spec Normalized & Buffered:", dataSpec, "– buffer length:", originalValues.length);
  }

  // -- spec.progressive initialization --
  spec.progressive = spec.progressive || {};

  // Execution flags
  spec.provega = spec.provega || {};
  spec.provega.progression = spec.provega.progression || {};
  const exec = (spec.provega.progression.control = spec.provega.progression.control || {});
  console.log("Execution Control Settings:", exec);
  exec.mode = exec.mode || "monitoring";
  if (exec.mode === "monitoring") {
    exec.pause = false;
    exec.stop = false;
    exec.backward = false;
  }
  exec.pause = !!exec.pause;
  exec.stop = !!exec.stop;
  exec.backward = !!exec.backward;
  exec.results_min_frequency = exec.results_min_frequency || 1000;

  // ── Normalizzazione visual_representation ──
  const visRep = (spec.provega.visualization = spec.provega.visualization || {});
  visRep.visual_stability = !!visRep.visual_stability;
  visRep.noise_reduction = !!visRep.noise_reduction;
  console.log("Visual Representation Settings:", visRep);

  spec.provega.progression = spec.provega.progression || {};
  spec.provega.progression.monitoring = spec.provega.progression.monitoring || {};

  // ── Normalizzazione quality ──
  q = (spec.provega.progression.monitoring.quality = spec.provega.progression.monitoring.quality || {});
  ['absolute_progress', 'relative_progress', 'relative_stability', 'absolute_certainty'].forEach(key => {
    q[key] = q[key] || {};
    ['on_data_input', 'on_result_output', 'on_visual_output'].forEach(evt => {
      let v = q[key][evt];
      if (v === true) {
        // boolean true → default metadata path
        q[key][evt] = `metadata.quality.${key}.${evt}`;
      } else if (!v) {
        // empty or undefined → disable
        q[key][evt] = null;
      }
      // else v is the user-provided signal name
    });
  });

  // Raccogli tutti i signal richiesti
  qualitySignals.length = 0;
  Object.values(q).forEach(branch => {
    Object.values(branch as Record<string, string | null>).forEach(name => {
      if (typeof name === 'string' && name) {
        qualitySignals.push(name);
      }
    });
  });

  // Inietta i signal in vgSpec
  vgSpec.signals = vgSpec.signals || [];
  qualitySignals.forEach(signalName => {
    if (!vgSpec.signals.find(s => s.name === signalName)) {
      vgSpec.signals.push({ name: signalName, value: null });
    }
  });

  // ── Normalizzazione process ──
  var proc = (spec.provega.progression.monitoring = spec.provega.progression.monitoring || {});

  if (proc.etc) {
    vgSpec.signals = vgSpec.signals || [];
    if (!vgSpec.signals.find(s => s.name === proc.etc)) {
      vgSpec.signals.push({ name: proc.etc, value: 0 });
    }
  }

  // defaults
  proc.aliveness = proc.aliveness !== false;       // default true
  proc.etc = proc.etc || null;           // nome del signal ETA o null

  // uncertainty branch
  proc.uncertainty = proc.uncertainty || {};
  var u = proc.uncertainty;
  u.show = !!u.show;                       // default false
  u.value = u.value || null;                // nome del signal incertezza o null
  u.domain = Array.isArray(u.domain) ? u.domain : [0, 1];
  u.percentage = !!u.percentage;
  u.show_label = u.show_label !== false;         // default true
  u.show_max = u.show_max !== false;         // default true
  u.label = u.label || 'Process Uncertainty';
  u.style = u.style || {};
  u.style.label = u.style.label || {};
  u.style.value = u.style.value || {};
  // inj signal names if boolean true used
  if (proc.etc === true) proc.etc = 'metadata.etc';
  if (u.value === true) u.value = 'metadata.uncertainty';

  // raccogliamo i nomi di tutti i signal da creare
  var processSignals: string[] = [];
  if (proc.etc) processSignals.push(proc.etc);
  if (u.show && u.value) processSignals.push(u.value);

  // iniettiamo nel vgSpec.signals
  vgSpec.signals = vgSpec.signals || [];
  processSignals.forEach(name => {
    if (!vgSpec.signals.find(s => s.name === name)) {
      vgSpec.signals.push({ name, value: null });
    }
  });

  // ── Normalizzazione change ──
  var ch = spec.provega.progression.monitoring.change
    = spec.provega.progression.monitoring.change
    || {};


  // Helper to turn either `false`, `true` or an object into a full config
  function normalizeFlag(

    v: boolean | { active?: boolean, blink?: boolean, aggregate?: boolean, style?: Record<string, any> },
    defaults: { active: boolean; blink: boolean; aggregate: boolean; style: Record<string, any> }
  ) {
    if (!runProvega) return;
    if (v === false || v == null) {
      return { ...defaults, active: false };
    }
    if (v === true) {
      return { ...defaults, active: true };
    }
    // object
    return {
      active: v.active ?? defaults.active,
      blink: v.blink ?? defaults.blink,
      aggregate: v.aggregate ?? defaults.aggregate,
      style: { ...defaults.style, ...(v.style || {}) }
    };
  }
  if (runProvega) {
    // area defaults
    ch.area = normalizeFlag(ch.area as any, {
      active: false,
      blink: false,
      aggregate: false,
      style: { color: '#FF0000', opacity: 0.5 }
    });


    if ((ch.area as any).aggregate == null) {
      console.log(ch.area);
      console.log("Change area aggregate setting not defined, defaulting to false.");
      (ch.area as any).aggregate = false;
    }

    // mark defaults
    ch.mark = normalizeFlag(ch.mark as any, {
      active: false,
      blink: false,
      style: { color: '#FF0000' }
    });

    console.log('Change settings:', ch);

    function hexToRgb(hex: string): [number, number, number] {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) return [255, 165, 0]; // fallback arancione
      const v = parseInt(m[1], 16);
      return [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF];
    }
  }

  function resetHeatmap() {
    console.log("Resetting change heatmap grid");
    const grid = document.getElementById('change-heatmap-grid');
    if (!grid) return;
    Array.from(grid.children).forEach((cell: HTMLElement) => {
      cell.setAttribute('data-count', '0');
      cell.style.background = 'transparent';
    });
  }

  // State variables (define at module top)
  let observer: MutationObserver | null = null;
  let observerInitialized = false;

  // These store the initial transforms
  let initX = 0;
  let initY = 0;

  // highlightChange implementation
  function highlightChange(chunk: any[], progressID: number) {
    console.log(`Highlighting change for chunk with progress ID: ${progressID}`);
    const cfg = spec.provega.progression.monitoring.change!;
    const areaCfg = cfg.area as {
      active: boolean;
      blink: boolean;
      style: { color: string; opacity: number };
      aggregate: boolean;
      grid?: { columns: number; rows: number };
      blinkDuration?: number;
      blinkInterval?: number;
    };

    const vis = document.getElementById('vis')!;
    // Remove any default grids
    vis.querySelectorAll<SVGGElement>('g.mark-rule.role-axis-grid').forEach(g => g.remove());
    if (!chunk.length) return;

    if (areaCfg.active) {



      // —————————————————————————
      // 1) Create / update the overlay grid
      // —————————————————————————
      vis.style.position = vis.style.position || 'relative';
      let grid = document.getElementById('change-heatmap-grid') as HTMLDivElement | null;
      const COLS = areaCfg.grid?.columns || 15;
      const ROWS = areaCfg.grid?.rows || 15;

      if (!grid) {
        // creation

        const w = view.width(), h = view.height();
        console.log("plotWidth:", view.width(), "plotHeight:", view.height());
        grid = document.createElement('div');
        grid.id = 'change-heatmap-grid';
        Object.assign(grid.style, {
          position: 'absolute', top: '30px', left: '0px',
          width: `${w}px`, height: `${h}px`,
          display: 'grid',
          gridTemplateColumns: `repeat(${COLS},1fr)`,
          gridTemplateRows: `repeat(${ROWS},1fr)`,
          gridGap: '2px', pointerEvents: 'none',
          zIndex: '999',
          transform: 'translate(0,0)'
        });
        for (let i = 0; i < ROWS * COLS; i++) {
          const cell = document.createElement('div');
          cell.className = 'change-heatmap-cell';
          cell.setAttribute('data-count', '0');
          Object.assign(cell.style, {
            background: 'transparent',
            transition: 'background 0.5s ease'
          });
          grid.appendChild(cell);
        }
        vis.appendChild(grid);
      } else {
        // resize
        const wNew = vis.clientWidth, hNew = vis.clientHeight; // NOTE: verify sizing logic
        if (grid.clientWidth !== wNew || grid.clientHeight !== hNew) {
          Object.assign(grid.style, {
            width: `${wNew}px`,
            height: `${hNew}px`
          });
        }
      }

      // —————————————————————————
      // 2) If not initialized, assign IDs and attach the observer
      // —————————————————————————
      if (!observerInitialized) {
        // a) individua il primo tick X
        const xTick = vis.querySelector<SVGLineElement>(
          'g.mark-group[aria-label*="X-axis"] g.mark-rule.role-axis-tick line:nth-of-type(2)'
        );
        // b) individua il primo tick Y
        const yTick = vis.querySelector<SVGLineElement>(
          'g.mark-group[aria-label*="Y-axis"] g.mark-rule.role-axis-tick line:nth-of-type(2)'
        );

        if (xTick) {
          xTick.id = 'xTickRef';
        // store initial transform for X
          const m = /translate\(([^,]+),([^)]+)\)/.exec(xTick.getAttribute('transform') || '');
          initX = m ? parseFloat(m[1]) : 0;
        }
        if (yTick) {
          yTick.id = 'yTickRef';
          // store initial transform for Y
          const m = /translate\(([^,]+),([^)]+)\)/.exec(yTick.getAttribute('transform') || '');
          initY = m ? parseFloat(m[2]) : 0;
        }

        // c) create the observer
        observer = new MutationObserver(muts => {
          muts.forEach(mut => {
            if (mut.type === 'attributes' && mut.attributeName === 'transform') {
              const tgt = mut.target as Element;
              if (tgt.id === 'xTickRef' || tgt.id === 'yTickRef') {
                // estrai i valori correnti
                const tr = tgt.getAttribute('transform') || '';
                const m = /translate\(\s*([0-9.+-]+)[, ]\s*([0-9.+-]+)\s*\)/.exec(tr);
                if (!m) return;
                const dx = parseFloat(m[1]);
                const dy = parseFloat(m[2]);

                // calcolo delta rispetto all'iniziale
                const deltaX = (tgt.id === 'xTickRef') ? dx - initX : 0;
                const deltaY = (tgt.id === 'yTickRef') ? dy - initY : 0;

                // apply a single cumulative translate
                const cur = grid!.style.transform;
                const mc = /translate\(\s*([0-9.+-]+)[, ]\s*([0-9.+-]+)\)/.exec(cur);
                let cx = 0, cy = 0;
                if (mc) {
                  cx = parseFloat(mc[1]);
                  cy = parseFloat(mc[2]);
                }

                grid!.style.transform = `translate(${cx + deltaX}px, ${cy + deltaY}px)`;

                // once applied, update init and temporarily disconnect
                if (tgt.id === 'xTickRef') initX = dx;
                if (tgt.id === 'yTickRef') initY = dy;

                observer!.disconnect();
                observerInitialized = false;
              }
            }
          });
        });

        // d) observe ONLY those two elements
        const observeTargets: (Element | null)[] = [
          document.getElementById('xTickRef'),
          document.getElementById('yTickRef')
        ];
        observeTargets.forEach(el => {
          if (el) observer!.observe(el, { attributes: true, attributeFilter: ['transform'] });
        });

        observerInitialized = true;
      }

      // ——————————————
      // 3) Conteggi e colorazione (invariato)
      // ——————————————
      const cells = Array.from(grid.children) as HTMLElement[];
      const counts: number[] = areaCfg.aggregate
        ? cells.map(c => Number(c.getAttribute('data-count') || '0'))
        : new Array(cells.length).fill(0);

      const w = vis.clientWidth, h = vis.clientHeight;
      const cellW = w / COLS, cellH = h / ROWS;
      const xS = view.scale('x'), yS = view.scale('y');

      chunk.forEach(d => {
        const px = xS(d.x), py = yS(d.y);
        const c = Math.min(COLS - 1, Math.max(0, Math.floor(px / cellW)));
        const r = Math.min(ROWS - 1, Math.max(0, Math.floor(py / cellH)));
        counts[r * COLS + c]++;
        // Log x/y position and cell only when not aggregated
        if (!areaCfg.aggregate) {
          console.log(`[highlightChange] x: ${d.x}, y: ${d.y} → px: ${px}, py: ${py} → cell: (${c},${r})`);
        }
      });

      const maxC = Math.max(...counts, 1);
      cells.forEach((cell, i) => {
        cell.setAttribute('data-count', `${counts[i]}`);
        if (counts[i] > 0) {
          const t = counts[i] / maxC;
          const [r, g, b] = hexToRgb(areaCfg.style.color);
          const alpha = areaCfg.style.opacity * t;
          cell.style.background = `rgba(${r},${g},${b},${alpha})`;
        } else {
          cell.style.background = 'transparent';
        }
      });
    }
    // ——————————————
    // 4) Fade–out e mark–highlight (invariato)
    // ——————————————
    if (!areaCfg.aggregate && areaCfg.blink) {
      const duration = areaCfg.blinkDuration || 800;
      setTimeout(() => cells.forEach(c => c.style.background = 'transparent'), duration);
    }
    if (cfg.mark.active && chunk.length) {
      setTimeout(() => {
        const container = view.container() as HTMLElement;
        const symbols = Array.from(container.querySelectorAll<SVGElement>('[role="graphics-symbol"]'));
        const N = chunk.length;
        const oldMarks = symbols.slice(0, symbols.length - N);
        const newMarks = symbols.slice(-N);
        oldMarks.forEach(m => {
          ['fill', 'stroke'].forEach(a => {
            const orig = m.getAttribute(`data-orig-${a}`);
            if (orig != null) {
              m.setAttribute(a, orig);
              m.removeAttribute(`data-orig-${a}`);
            }
          });
          m.style.visibility = 'visible';
        });
        newMarks.forEach(m => {
          if (!m.hasAttribute('data-orig-fill') && m.hasAttribute('fill'))
            m.setAttribute('data-orig-fill', m.getAttribute('fill')!);
          if (!m.hasAttribute('data-orig-stroke') && m.hasAttribute('stroke'))
            m.setAttribute('data-orig-stroke', m.getAttribute('stroke')!);
          if (cfg.mark.style?.color) {
            if (m.hasAttribute('fill')) m.setAttribute('fill', cfg.mark.style.color);
            if (m.hasAttribute('stroke')) m.setAttribute('stroke', cfg.mark.style.color);
          }
          if (cfg.mark.blink) {
            const highlightColor = 'yellow';
            const interval = cfg.mark.blinkInterval || 100;
            const totalDuration = cfg.mark.blinkDuration || 800;
            const iterations = Math.ceil(totalDuration / interval);
            let count = 0;

            // Fetch the "original" color from the data-attribute,
            // otherwise from the current fill/stroke
            const origFill = m.getAttribute('data-orig-fill') ?? m.getAttribute('fill') ?? '';
            const origStroke = m.getAttribute('data-orig-stroke') ?? m.getAttribute('stroke') ?? '';

            // If not set yet, persist them
            if (!m.hasAttribute('data-orig-fill') && m.hasAttribute('fill')) {
              m.setAttribute('data-orig-fill', origFill);
            }
            if (!m.hasAttribute('data-orig-stroke') && m.hasAttribute('stroke')) {
              m.setAttribute('data-orig-stroke', origStroke);
            }

            const iv = setInterval(() => {
              const isHighlightPhase = count % 2 === 0;

              // toggle highlight / original
              if (m.hasAttribute('fill')) {
                m.setAttribute('fill', isHighlightPhase ? highlightColor : origFill);
              }
              if (m.hasAttribute('stroke')) {
                m.setAttribute('stroke', isHighlightPhase ? highlightColor : origStroke);
              }

              count++;
              if (count >= iterations) {
                clearInterval(iv);
                // Make sure to restore permanently
                if (m.hasAttribute('fill')) m.setAttribute('fill', origFill);
                if (m.hasAttribute('stroke')) m.setAttribute('stroke', origStroke);
                // Remove the data-attributes if no longer needed
                m.removeAttribute('data-orig-fill');
                m.removeAttribute('data-orig-stroke');
              }
            }, interval);
          }
        });
        if (!cfg.mark.blink) {
          setTimeout(() => {
            newMarks.forEach(m => {
              ['fill', 'stroke'].forEach(a => {
                const orig = m.getAttribute(`data-orig-${a}`);
                if (orig != null) {
                  m.setAttribute(a, orig);
                  m.removeAttribute(`data-orig-${a}`);
                }
              });
              m.style.visibility = 'visible';
            });
          }, 800);
        }
      }, 0);
    }
  }





  // --- end highlightChange ---


  // Do not apply the config to Vega when we have already applied it to Vega-Lite.
  // This call may throw an Error if parsing fails.
  const runtime = vega.parse(vgSpec, mode === 'vega-lite' ? {} : (config as VgConfig), { ast });

  const view = new (opts.viewClass || vega.View)(runtime, {
    loader,
    logLevel,
    renderer,
    ...(ast ? { expr: (vega as any).expressionInterpreter ?? opts.expr ?? expressionInterpreter } : {}),
  });

  view.addSignalListener('autosize', (_, autosize: Exclude<AutoSize, string>) => {
    const { type } = autosize;
    if (type == 'fit-x') {
      container.classList.add('fit-x');
      container.classList.remove('fit-y');
    } else if (type == 'fit-y') {
      container.classList.remove('fit-x');
      container.classList.add('fit-y');
    } else if (type == 'fit') {
      container.classList.add('fit-x', 'fit-y');
    } else {
      container.classList.remove('fit-x', 'fit-y');
    }
  });

  if (opts.tooltip !== false) {
    const { loader: loader_, tooltip } = opts;
    const baseURL = loader_ && !isLoader(loader_) ? loader_?.baseURL : undefined;
    const handler = isTooltipHandler(tooltip)
      ? tooltip
      : // user provided boolean true or tooltip options
      new Handler({ baseURL, ...(tooltip === true ? {} : tooltip) }).call;

    view.tooltip(handler);
  }

  let { hover } = opts;

  if (hover === undefined) {
    hover = mode === 'vega';
  }

  if (hover) {
    const { hoverSet, updateSet } = (typeof hover === 'boolean' ? {} : hover) as Hover;

    view.hover(hoverSet, updateSet);
  }

  if (opts) {
    if (opts.width != null) {
      view.width(opts.width);
    }
    if (opts.height != null) {
      view.height(opts.height);
    }
    if (opts.padding != null) {
      view.padding(opts.padding);
    }
  }

  //modifica

  await view.initialize(container, opts.bind).runAsync(); // CREA LA VIEW!!!




  if (runProvega) {
    // ─── QUALITY PANEL + SPARKLINES CON TEMPO SULL'ASSE X ───
    if (qualitySignals.length > 0) {
      var visEl = document.getElementById('vis')!;
      // rimuovi eventuale pannello precedente
      const oldPanel = visEl.querySelector('#quality-panel');
      if (oldPanel) oldPanel.remove();

      // crea il pannello
      const panel = document.createElement('div');
      panel.id = 'quality-panel';
      Object.assign(panel.style, {
        position: 'absolute',
        top: '0', right: '-450px',
        marginTop: '8px', marginLeft: '50px',
        width: '260px', padding: '8px',
        background: '#fff', border: '1px solid #ccc',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        fontFamily: 'Arial, sans-serif', fontSize: '14px'
      });
      panel.innerHTML = `<strong>Quality Indicators:</strong>`;
      const ul = document.createElement('ul');
      ul.id = 'quality-list';
      Object.assign(ul.style, { listStyle: 'none', padding: '0', margin: '5px 0' });
      panel.appendChild(ul);
      visEl.style.position = 'relative';
      visEl.appendChild(panel);

      // etichette
      const labels: Record<string, string> = {
        absolute_progress: 'Absolute Progress',
        relative_progress: 'Relative Progress',
        relative_stability: 'Relative Stability',
        absolute_certainty: 'Absolute Certainty'
      };
      const eventLabels: Record<string, string> = {
        on_data_input: '(data in)',
        on_result_output: '(result out)',
        on_visual_output: '(visual out)'
      };

      // per le sparkline: dimensioni e buffer
      const W2 = 100, H2 = 30, MAX_POINTS = 50;
      // ora history contiene array di { t: numero, v: numero }
      const history: Record<string, { t: number, v: number }[]> = {};

      qualitySignals.forEach(sig => {
        // 1) create <li>
        const li = document.createElement('li');
        li.id = `quality-${sig}`;
        li.style.marginBottom = '12px';

        // 2) find a human-readable label
        let label = sig;
        for (const [k, branch] of Object.entries(q)) {
          for (const [evt, name] of Object.entries(branch as Record<string, string>)) {
            if (name === sig) label = `${labels[k]} ${eventLabels[evt]}`;
          }
        }

        // 3) create the text <span>
        const span = document.createElement('span');
        span.textContent = `${label}: —`;
        li.appendChild(span);

        // 4) crea contenitore SVG
        const chartWrapper = document.createElement('div');
        chartWrapper.style.position = 'relative';
        chartWrapper.style.marginTop = '4px';
        chartWrapper.style.width = `${W2}px`;
        chartWrapper.style.height = `${H2 + 20}px`; // + spazio per etichette X

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', `${W2}`);
        svg.setAttribute('height', `${H2}`);
        svg.style.display = 'block';
        svg.style.background = '#f9f9f9';
        svg.style.border = '1px solid #ddd';

        const poly = document.createElementNS(svgNS, 'polyline');
        poly.setAttribute('fill', 'none');
        poly.setAttribute('stroke', '#4C78A8');
        poly.setAttribute('stroke-width', '1');
        svg.appendChild(poly);

        // 5) create axes and labels
        const yLabel = document.createElement('div');
        yLabel.textContent = 'Value';
        Object.assign(yLabel.style, {
          position: 'absolute',
          right: '-40px',
          top: '4px',
          fontSize: '10px',
          transform: 'rotate(90deg)',
          transformOrigin: 'left top',
          color: '#444'
        });

        // Labels for min time (first timestamp) and max time
        const xMinLabel = document.createElement('div');
        xMinLabel.textContent = ''; // set on first update
        Object.assign(xMinLabel.style, {
          position: 'absolute',
          bottom: '0px',
          left: '0',
          fontSize: '10px',
          color: '#444'
        });

        const xMaxLabel = document.createElement('div');
        xMaxLabel.textContent = '';
        Object.assign(xMaxLabel.style, {
          position: 'absolute',
          bottom: '0px',
          right: '0',
          fontSize: '10px',
          color: '#444'
        });

        // 6) assembla elementi
        chartWrapper.appendChild(svg);
        chartWrapper.appendChild(yLabel);
        chartWrapper.appendChild(xMinLabel);
        chartWrapper.appendChild(xMaxLabel);
        li.appendChild(chartWrapper);
        ul.appendChild(li);

        // 7) init buffer (ora array di {t, v})
        const historyBuf: { t: number, v: number }[] = [];
        history[sig] = historyBuf;

        // 8) listener di aggiornamento
        view.addSignalListener(sig, (_: any, v: number) => {
          // update the text label
          span.textContent = `${label}: ${v != null ? v.toFixed(3) : '—'}`;

          // store current timestamp (ms) and value (number)
          const now = Date.now();
          historyBuf.push({ t: now, v: v == null ? 0 : v });
          if (historyBuf.length > MAX_POINTS) historyBuf.shift();

          // Check if all values are 0 or null/undefined
          const allZero = historyBuf.every(pt => pt.v === 0);
          if (allZero) {
            // do not draw the chart: clear polyline and X labels
            poly.setAttribute('points', '');
            xMinLabel.textContent = '';
            xMaxLabel.textContent = '';
            return;
          }

          // Find t_min and t_max
          const t_min = historyBuf[0].t;
          const t_max = historyBuf[historyBuf.length - 1].t;
          const spanT = Math.max(t_max - t_min, 1); // avoid division by zero

          // Find min/max for Y scale
          const values = historyBuf.map(pt => pt.v);
          const mn = Math.min(...values);
          const mx = Math.max(...values);
          const spanY = Math.max(mx - mn, 1e-6);

          // Compute polyline points
          const pts = historyBuf.map(pt => {
            const x = ((pt.t - t_min) / spanT) * W2;
            const y = H2 - ((pt.v - mn) / spanY) * H2;
            return `${x},${y}`;
          }).join(' ');
          poly.setAttribute('points', pts);

          // Format timestamp in HH:MM:SS
          const fmt = (ts: number) => {
            const d = new Date(ts);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
          };

          xMinLabel.textContent = fmt(t_min);
          xMaxLabel.textContent = fmt(t_max);
        });
      });
    }



    // -- Helper to apply user-defined styles --
    function applyStyle(
      target: CSSStyleDeclaration,
      styleObj: Record<string, string | number> | undefined
    ) {
      if (!styleObj) return;
      Object.entries(styleObj).forEach(([key, val]) => {
        // if it's a number, append 'px'
        if (typeof val === 'number') {
          target[key as any] = `${val}px`;
        } else {
          target[key as any] = val;
        }
      });
    }

    // Global declaration for Socket.IO (if used)
    declare var io: any;

  }
  (async function progressiveLoadingHandler() {

    if (!runProvega) return;

    console.log("[Progressive Loading Handler] Initializing...");
    // ── Default settings per spec ──
    const chunkType = spec.provega.progression.chunking?.type || "data";
    spec = spec || {} as any;
    const dataSpec = spec as any;
    // preferisci il nome dichiarato dentro data (es. data: { name: 'foo' })
    // altrimenti usa dataSpec.name se presente, altrimenti fallback 'source_0'
    const declaredDataName = (dataSpec.data && dataSpec.data.name) ? dataSpec.data.name : undefined;
    if (dataSpec.name === undefined) dataSpec.name = declaredDataName || "source_0";

    dataSpec.format = dataSpec.format || { type: "json" };
    dataSpec.data.url = dataSpec.data.url || "";
    dataSpec.provega.progression.chunking = dataSpec.provega.progression.chunking || { type: "data", reading: {} };
    dataSpec.provega.progression.chunking.reading = dataSpec.provega.progression.chunking.reading || {};
    dataSpec.provega.progression.chunking.reading.method = dataSpec.provega.progression.chunking.reading.method || "sequential";
    dataSpec.provega.progression.chunking.reading.ascending =
      typeof dataSpec.provega.progression.chunking.reading.ascending === "boolean"
        ? dataSpec.provega.progression.chunking.reading.ascending
        : true;
    dataSpec.provega.progression.chunking.reading.chunk_size = dataSpec.provega.progression.chunking.reading.chunk_size || 10;
    dataSpec.provega.progression.chunking.reading.frequency = dataSpec.provega.progression.chunking.reading.frequency || 1000;
    dataSpec.provega.progression.chunking.reading.seed = dataSpec.provega.progression.chunking.reading.seed || 0;

    // ── Normalizzazione spec.provega.visualization ──
    const visRep = spec.provega.visualization =
      spec.provega.visualization || {};
    visRep.visual_stability = !!visRep.visual_stability;
    visRep.noise_reduction = !!visRep.noise_reduction;

    // ── Inizializzazione contatori e stato ──
    dataSpec._loadedChunks = 0;
    dataSpec._progressCounter = 1;
    dataSpec._chunkHistory = dataSpec._chunkHistory || [];
    dataSpec._undoneChunks = dataSpec._undoneChunks || [];

    let progressState: "playing" | "paused" = "playing";
    let lockState = false;
    dataSpec._setProgressState = (newState) => progressState = newState;
    dataSpec._progressState = () => progressState;

    const datasetName = dataSpec.name;

    // ── Inizializza il dataset in Vega ──
    if (!view.data(datasetName)) {
      console.log(`[Progressive Loading] Initializing dataset '${datasetName}' as empty.`);
      view.data(datasetName, []);
    }


    // ===== Imposta il container target per la progressione =====
    let targetContainer: HTMLElement | null = document.querySelector(".vega-embed.has-actions");
    if (!targetContainer) {
      targetContainer = document.getElementById("vis");
    }
    if (!targetContainer) {
      targetContainer = document.body;
    }
    const containerWidth = targetContainer.clientWidth || 800;

    const visEl = document.getElementById("vis");
    if (!visEl) return;

    if (runProvega && chunkType === 'mixed') {
      console.log("[Provega] chunking.type === 'mixed' -> setup mixed TSNE+progressive");
      // store dataSpec for later use
      (view as any)._progressiveDataSpec = dataSpec;

      // Initialize mixed structure
      setupMixedTSNE(view, dataSpec, vgSpec);

      // do not return: let the progressive 'data' pipeline continue
      // (but the chunk callback must call processChunkMixed)
    }
    // then process it for mixed

    if (runProvega && chunkType === 'mixed') {
      const cs = (window as any).vega.changeset();
      await view.change(datasetName, cs).runAsync();  // IMPORTANT: await
      await processChunkMixed(view, datasetName, dataSpec._initialData);
    }

    if (chunkType === 'process') {
      (view as any)._progressiveDataSpec = dataSpec;
      console.log("[Progressive Loading] Process chunking type detected, initializing TSNE process handler (awaiting view readiness)...");

      // async wrapper: wait for the view to finish initializing and populating datasets;
      // otherwise manually insert _initialData before starting
      (async () => {
        try {
          // 1) wait for view.runAsync() if available
          if (typeof view.runAsync === 'function') {
            try {
              await view.runAsync();
            } catch (e) {
              // ignore: view.runAsync can fail if already executed; not critical
              console.warn("[Provega-Process] view.runAsync() warning:", e);
            }
          }

          // 2) resolve the target dataset name (prefer declared data.name)
          const targetName = (dataSpec && dataSpec.data && dataSpec.data.name) || dataSpec.name || 'source_0';

          // 3) if view.data(targetName) is empty but we have _initialData, populate the source explicitly
          let runtimeVals = (typeof view.data === 'function') ? view.data(targetName) : undefined;
          if ((!Array.isArray(runtimeVals) || runtimeVals.length === 0)
            && dataSpec && Array.isArray(dataSpec._initialData) && dataSpec._initialData.length > 0) {
            console.log("[Provega-Process] Populating view dataset '%s' from dataSpec._initialData (len=%d)", targetName, dataSpec._initialData.length);
            const cs = (window as any).vega.changeset();




            // remove everything and insert _initialData (safe)
            try {
              cs.remove(() => true);
              cs.insert(dataSpec._initialData);
              await view.change(targetName, cs).runAsync();
            } catch (e) {
              // fallback: usa view.insert se change non va
              try {
                await view.insert(targetName, dataSpec._initialData);
                await view.runAsync();
              } catch (err) {
                console.error("[Provega-Process] failed to populate dataset by changeset/insert:", err);
              }
            }
            runtimeVals = (typeof view.data === 'function') ? view.data(targetName) : undefined;
            console.log("[Provega-Process] After populate runtimeVals.length =", Array.isArray(runtimeVals) ? runtimeVals.length : runtimeVals);
          }

          // 4) ora chiamiamo initProcessTSNE: dovrebbe trovare il dataset riempito
          try {
            initProcessTSNE(view, dataSpec);
          } catch (e) {
            console.error("[Provega-Process] initProcessTSNE failed:", e);
          }
        } catch (err) {
          console.error("[Provega-Process] error while preparing view for TSNE:", err);
        }
      })();

      // Esci per evitare l'altra logica progressive
      return;
    }




    // --- 1) Create or reuse the footer wrapper ---
    let footerPanel = document.getElementById("footer-panel");
    if (!footerPanel) {
      footerPanel = document.createElement("div");
      footerPanel.id = "footer-panel";
      Object.assign(footerPanel.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginLeft: "25px",
        marginTop: "10px",
        width: "115%",
        boxSizing: "border-box",
        padding: "0 8px",
      });
      visEl.appendChild(footerPanel);
    }

    // --- 2) Create or reuse the progress container (left) ---
    let progressContainer = document.getElementById("progress-container");
    if (!progressContainer) {
      progressContainer = document.createElement("div");
      progressContainer.id = "progress-container";
      Object.assign(progressContainer.style, {
        marginTop: "0",
        textAlign: "center",
        fontFamily: "Roboto, sans-serif",
        flex: "1",               // takes available space on the left
        boxSizing: "border-box",
      });
      // Set a fixed width for the progress bar (optional)
      progressContainer.style.maxWidth = containerWidth + "px";
      footerPanel.appendChild(progressContainer);
    }

    // ─── 2.1) Progress Bar ───
    let progressBar = document.getElementById("progress-bar");
    if (!progressBar) {
      progressBar = document.createElement("div");
      progressBar.id = "progress-bar";
      progressBar.className = "progress-bar";
      progressContainer.appendChild(progressBar);
    }

    // ─── 2.2) Progress Fill ───
    let progressFill = document.getElementById("progress-fill");
    if (!progressFill) {
      progressFill = document.createElement("div");
      progressFill.id = "progress-fill";
      progressFill.className = "progress-fill";
      progressBar.appendChild(progressFill);
    }



    // --- 2.4) Loading info ---
    let infoEl = document.getElementById("progress-info");
    if (!infoEl) {
      infoEl = document.createElement("div");
      infoEl.id = "progress-info";
      Object.assign(infoEl.style, {
        marginTop: "10px",
        fontWeight: "bold",
        width: "100%",
      });
      progressContainer.appendChild(infoEl);
    }
    infoEl.textContent = "Loading all chunks...";

    // --- 3) Create or reuse the process panel (right) ---
    const proc = spec.provega.progression.monitoring;
    let procPanel = document.getElementById("proc-panel");

    // Check whether to show anything
    const showProcessPanel = !!(proc.aliveness || proc.etc || proc.uncertainty?.show);
    if (showProcessPanel) {
      console.log("[Progressive Loading] Process indicators enabled, initializing process panel.");
      if (!procPanel) {
        procPanel = document.createElement("div");
        procPanel.id = "proc-panel";
        Object.assign(procPanel.style, {
          width: "260px",
          padding: "8px",
          background: "#fff",
          border: "1px solid #ccc",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          fontFamily: "Arial, sans-serif",
          fontSize: "14px",
          marginLeft: "16px",
          marginTop: "10px",
          boxSizing: "border-box",
        });
        procPanel.innerHTML = `<strong>Process Indicators:</strong>`;
        footerPanel.appendChild(procPanel);
      }

      // ── 3.1) Aliveness (spinner) ──
      if (proc.aliveness) {
        let spinner = procPanel.querySelector(".process-spinner");
        if (!spinner) {
          spinner = document.createElement("div");
          spinner.className = "process-spinner spinning";
          spinner.style.marginTop = "8px";
          procPanel.appendChild(spinner);
        }
      } else {
        const spinner = procPanel.querySelector(".process-spinner");
        if (spinner) spinner.remove();
      }

      // ── 3.2) ETC ──
      var etcDiv = procPanel.querySelector(".etc-div");
      if (proc.etc) {
        if (!etcDiv) {
          etcDiv = document.createElement("div");
          etcDiv.className = "etc-div";
          etcDiv.textContent = "Estimated Time of Completion (ETC): —";
          etcDiv.style.marginTop = "12px";
          procPanel.appendChild(etcDiv);
        }
      } else if (etcDiv) {
        etcDiv.remove();
      }

      // ── 3.3) Uncertainty ──
      const u = proc.uncertainty || {};
      let uncLabelDiv = procPanel.querySelector(".uncertainty-label");
      let uncValueDiv = procPanel.querySelector(".uncertainty-value");
      let uncMaxDiv = procPanel.querySelector(".uncertainty-max");

      if (u.show && u.value) {
        // Label (opzionale)
        if (u.show_label) {
          if (!uncLabelDiv) {
            uncLabelDiv = document.createElement("div");
            uncLabelDiv.className = "uncertainty-label";
            uncLabelDiv.textContent = u.label || "Uncertainty";
            Object.assign(uncLabelDiv.style, {
              fontSize: "12px",
              fontWeight: "bold",
              marginTop: "12px",
              color: "#333",
              fontFamily: "Arial",
            });
            applyStyle(uncLabelDiv.style, u.style?.label);
            procPanel.appendChild(uncLabelDiv);
          }
        } else if (uncLabelDiv) {
          uncLabelDiv.remove();
          uncLabelDiv = null;
        }

        // Value
        if (!uncValueDiv) {
          uncValueDiv = document.createElement("div");
          uncValueDiv.className = "uncertainty-value";
          uncValueDiv.textContent = u.percentage ? "N/A" : "0%";
          Object.assign(uncValueDiv.style, {
            fontSize: "14px",
            color: "#d62728",
            fontFamily: "Arial",
            marginTop: "4px",
          });
          applyStyle(uncValueDiv.style, u.style?.value);
          procPanel.appendChild(uncValueDiv);
        }

        // Max
        if (u.show_max) {
          if (!uncMaxDiv) {
            uncMaxDiv = document.createElement("div");
            uncMaxDiv.className = "uncertainty-max";
            uncMaxDiv.textContent = "Max: N/A";
            Object.assign(uncMaxDiv.style, {
              fontSize: "12px",
              color: "#555",
              marginTop: "4px",
              fontFamily: "Arial",
            });
            procPanel.appendChild(uncMaxDiv);
          }
        } else if (uncMaxDiv) {
          uncMaxDiv.remove();
          uncMaxDiv = null;
        }

        // Listener sul signal
        view.addSignalListener(u.value, (_event, raw) => {
          let num = typeof raw === "number" ? raw : 0;
          const [min, max] = u.domain || [0, 1];
          num = Math.max(min, Math.min(max, num));
          const disp = u.percentage ? (num * 100).toFixed(1) + "%" : num.toFixed(3);
          if (uncValueDiv) uncValueDiv.textContent = disp;

          if (u.show_max && uncMaxDiv) {
            if (num > (uncMaxDiv._maxObserved || -Infinity)) {
              uncMaxDiv._maxObserved = num;
            }
            const maxObserved = uncMaxDiv._maxObserved || 0;
            const dispMax = u.percentage
              ? (maxObserved * 100).toFixed(1) + "%"
              : maxObserved.toFixed(3);
            uncMaxDiv.textContent = `Max: ${dispMax}`;
          }
        });
      } else {
        if (uncLabelDiv) uncLabelDiv.remove();
        if (uncValueDiv) uncValueDiv.remove();
        if (uncMaxDiv) uncMaxDiv.remove();
      }
    } else if (procPanel) {
      // Se non devo mostrare niente, rimuovo l'intero pannello
      procPanel.remove();
      procPanel = null;
    }

    // DEFINIZIONE DI updateControls, ora disponibile per tutto il blocco
    function updateControls(mode: "playing" | "paused" | "final") {
      console.log(`[Progressive Loading] Updating controls to mode: ${mode}`);
      if (mode === "final") {
        const spinner = document.querySelector<HTMLElement>('.process-spinner')!;
        setSpinnerActive(spinner, false);
        dataSpec._startBtn && (dataSpec._startBtn.disabled = true);
        dataSpec._pauseBtn && (dataSpec._pauseBtn.disabled = true);
        dataSpec._nextStepBtn && (dataSpec._nextStepBtn.disabled = true);
        dataSpec._stepBackBtn && (dataSpec._stepBackBtn.disabled = false);
        dataSpec._startOverBtn && (dataSpec._startOverBtn.disabled = false);
        if (infoEl && spec.provega.progression.control.mode != "monitoring" && socketCheck == false) {
          infoEl.textContent = "All chunks have been processed. Click on the Start Over button to start again.";
        }
        else if (socketCheck == true) {
          infoEl.textContent = "All chunks have been processed. Reload the page and restart the websocket connection to start again, or freely navigate between data chunks.";
        }
        else infoEl.textContent = "All chunks have been processed."
        return;
      }
      if (mode === "playing") {
        const spinner = document.querySelector<HTMLElement>('.process-spinner')!;
        setSpinnerActive(spinner, true);
        dataSpec._startBtn && (dataSpec._startBtn.disabled = true);
        dataSpec._pauseBtn && (dataSpec._pauseBtn.disabled = false);
        dataSpec._nextStepBtn && (dataSpec._nextStepBtn.disabled = true);
        dataSpec._startOverBtn && (dataSpec._startOverBtn.disabled = true);
        dataSpec._stepBackBtn && (dataSpec._stepBackBtn.disabled = true);
        //dataSpec._stepBackBtn && (dataSpec._stepBackBtn.disabled = (dataSpec._chunkHistory.length === 0));
      } else if (mode === "paused") {
        const spinner = document.querySelector<HTMLElement>('.process-spinner')!;
        setSpinnerActive(spinner, false);
        dataSpec._startBtn && (dataSpec._startBtn.disabled = false);
        dataSpec._pauseBtn && (dataSpec._pauseBtn.disabled = true);
        dataSpec._nextStepBtn && (dataSpec._nextStepBtn.disabled = false);
        dataSpec._stepBackBtn && (dataSpec._stepBackBtn.disabled = false);
        //dataSpec._nextStepBtn && (dataSpec._nextStepBtn.disabled = true); //attention
        dataSpec._startOverBtn && (dataSpec._startOverBtn.disabled = false);
        //if(!isColorEncoding) dataSpec._stepBackBtn && (dataSpec._stepBackBtn.disabled = (dataSpec._chunkHistory.length === 0));

      }
    }

    // Funzione per aggiornare la progress bar
    function updateProgressBar() {
      let total: number;
      if (dataSpec.data.url && (dataSpec.data.url.startsWith("sio:") || /^wss?:\/\//.test(dataSpec.data.url))) {
        if (dataSpec._socket && !dataSpec._socket.disconnected) {
          total = (dataSpec._loadedChunks || 0) +
            Math.ceil((dataSpec._auxBuffer?.length || 0) / (dataSpec.provega.progression.chunking.reading.chunk_size || 10));
        } else {
          total = dataSpec._fixedTotalChunks !== undefined ? dataSpec._fixedTotalChunks : (dataSpec._loadedChunks || 0);
        }
      } else {
        total = total = dataSpec._fixedTotalChunks ?? Math.ceil((dataSpec._initialData?.length || 0) / dataSpec.provega.progression.chunking.reading.chunk_size); //Math.ceil((dataSpec._initialData?.length || 0) / (dataSpec.provega.progression.chunking.reading.chunk_size || 10));
      }
      const loaded = dataSpec._loadedChunks || 0;
      const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
      progressFill.style.width = percent + "%";
      progressFill.textContent = loaded + " / " + (total || "0") + " (" + percent + "%)";
      // Se abbiamo raggiunto o superato il totale, imposta lo stato su "final"
      if ((!dataSpec.data.url || (dataSpec.data.url && (!dataSpec._socket || dataSpec._socket.disconnected))) &&
        total > 0 && loaded >= total) {
        console.log("[Progressive Loading] All chunks have been processed.");
        const spinner = document.querySelector<HTMLElement>('.process-spinner')!;
        setSpinnerActive(spinner, false);
        progressState = "final";
        updateControls("final");
      }
    }


    // ─── 2.3) Controlli della progress ───
    let controlsContainer = document.getElementById("progress-controls");
    if (!controlsContainer) {
      controlsContainer = document.createElement("div");
      controlsContainer.id = "progress-controls";
      Object.assign(controlsContainer.style, {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "10px",
        marginTop: "10px",
        width: "100%",
      });
      progressContainer.appendChild(controlsContainer);
    }
    // Funzione d’aiuto per creare i bottoni
    function createButton(id: string, text: string, tooltip: string): HTMLButtonElement {
      let btn = document.getElementById(id) as HTMLButtonElement;
      if (!btn) {
        btn = document.createElement("button");
        btn.id = id;
        btn.textContent = text;
        btn.title = tooltip;
        controlsContainer!.appendChild(btn);
      }
      return btn;
    }


    // ----- Definiamo progressiveLoading all'interno dello stesso scope -----
    function progressiveLoading(
      originalValues: any[],
      dataSpec: any,
      view: any,
      datasetName: string,
      visRep: { visual_stability: boolean; noise_reduction: boolean }
    ) {
      if (!runProvega) return;
      // Leggiamo i parametri di chunking dalla spec
      const chunkSize = dataSpec.provega.progression.chunking.reading.chunk_size || 10;
      const frequency = dataSpec.provega.progression.chunking.reading.frequency || 1000;
      const readingType = dataSpec.provega.progression.chunking.reading.method || "sequential";
      const asc = dataSpec.provega.progression.chunking.reading.ascending !== false;
      const seed = dataSpec.provega.progression.chunking.reading.seed || 0;
      const totalChunksHint = dataSpec.provega.progression.chunking.total_chunks;
      if (typeof totalChunksHint === "number" && totalChunksHint > 0 && !Number.isNaN(totalChunksHint)) {
        dataSpec._fixedTotalChunks = totalChunksHint;
      }
      let index = asc ? 0 : originalValues.length;

      let progressState = dataSpec._progressState ? dataSpec._progressState() : "playing";
      const randomGenerator = (seed || seed === 0) ? seededRandom(seed) : Math.random;


      // State for visual stability
      let initialDomains: { x: [number, number]; y: [number, number] } | null = null;

      // At the beginning, capture "natural" domains and compute the padded domain
      if (visRep.visual_stability) {
        view.runAsync().then(() => {
          try {
            if (typeof view.scale === "function") {
              const xDom0 = view.scale("x").domain() as [number, number];
              const yDom0 = view.scale("y").domain() as [number, number];

              // 5% padding on each range
              const padX = (xDom0[1] - xDom0[0]) * 0.05;
              const padY = (yDom0[1] - yDom0[0]) * 0.05;

              initialDomains = {
                x: [xDom0[0] - padX, xDom0[1] + padX],
                y: [yDom0[0] - padY, yDom0[1] + padY]
              };
            } else {
              console.warn("[Progressive Loading] visual_stability: view.scale is not a function.");
            }
          } catch (err) {
            console.warn("[Progressive Loading] visual_stability: error accessing scales:", err);
          }
        });
      }
      function updateProgressBarInner() {
        updateProgressBar();
      }

      //ETC SUPPORT

      function updateETC() {
        //console.log("[Progressive Loading] Updating Estimated Time of Completion (ETC)...");
        if (!etcDiv) return;
        //console.log("[Progressive Loading] etcDiv found:", etcDiv);
        const freq = dataSpec.provega.progression.chunking.reading.frequency;               // in ms
        const totalChunks = dataSpec._fixedTotalChunks ||
          Math.ceil((dataSpec._initialData?.length || 0) / dataSpec.provega.progression.chunking.reading.chunk_size);
        const loaded = dataSpec._loadedChunks || 0;
        const remaining = Math.max(0, totalChunks - loaded);
        const etcMs = remaining * freq;
        const etcSec = (etcMs / 1000).toFixed(1);
        etcDiv.textContent = `Estimated Time of Completion (ETC): ${etcSec}s`;
      }



      //NOISE REDUCTION PART

      // Utility function: mean of an array
      function mean(arr: number[]): number {
        return arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
      }

      // Utility function: standard deviation
      function std(arr: number[], m: number): number {
        const sumSq = arr.reduce((s, v) => s + (v - m) ** 2, 0);
        return Math.sqrt(sumSq / (arr.length || 1));
      }

      // Utility function: clamp
      function clamp(v: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, v));
      }

       /**
        * Reduce noise on a chunk:
        *  1) Clipping to +/- 2 sigma
        *  2) Moving average with a window of size windowSize
        *
        * @param chunk      Array of objects { x, y, ... }
        * @param windowSize Window size for smoothing (number of points)
        */
      function noiseReduce(chunk: any[], windowSize = 5): any[] {
        console.log("[Progressive Loading] Noise reduction applied with window size:", windowSize);
        if (!chunk.length) return chunk;

        // -- 1) Clipping a ±2σ --------------------------------------------------
        const xs = chunk.map(d => d.x);
        const ys = chunk.map(d => d.y);

        const meanX = mean(xs), stdX = std(xs, meanX);
        const meanY = mean(ys), stdY = std(ys, meanY);

        const minX = meanX - 2 * stdX, maxX = meanX + 2 * stdX;
        const minY = meanY - 2 * stdY, maxY = meanY + 2 * stdY;

        const clipped = chunk.map(d => ({
          ...d,
          x: clamp(d.x, minX, maxX),
          y: clamp(d.y, minY, maxY)
        }));

        // -- 2) Moving average ---------------------------------------------------
        // Build two arrays with only x and y values
        const xsCl = clipped.map(d => d.x);
        const ysCl = clipped.map(d => d.y);
        const halfWin = Math.floor(windowSize / 2);

        // Compute neighbor mean in [i-halfWin..i+halfWin]
        function smoothArray(arr: number[]): number[] {
          const n = arr.length;
          const out = new Array<number>(n);
          for (let i = 0; i < n; i++) {
            const start = Math.max(0, i - halfWin);
            const end = Math.min(n - 1, i + halfWin);
            let sum = 0;
            for (let j = start; j <= end; j++) sum += arr[j];
            out[i] = sum / (end - start + 1);
          }
          return out;
        }

        const xsSm = smoothArray(xsCl);
        const ysSm = smoothArray(ysCl);

        // Recompose objects with the new "smoothed" coordinates
        return clipped.map((d, i) => ({
          ...d,
          x: xsSm[i],
          y: ysSm[i]
        }));
      }


      async function insertNextChunk(manualStep: boolean = false, force: boolean = false) {

        if (!runProvega) return;


        // 0) Controlla stato (pause/play)
        const state = dataSpec._progressState?.() ?? "playing";
        if (state === "paused" && !force) return;

        if (socketCheck == true) {

          if (socketCheck == true) console.log("[Progressive Loading] Inserting next chunk...", { loaded: dataSpec._loadedChunks, bufferLen: dataSpec._auxBuffer.length });
          // quanti punti vogliamo in questo chunk
          const sz = chunkSize;
          // preleva e rimuovi i primi `sz` elementi dal buffer
          const rawChunk = dataSpec._auxBuffer.splice(0, sz);
          if (rawChunk.length === 0) {
            console.log("[Progressive Loading] Buffer vuoto, niente da inserire.");
            return;
          }

          // assegna ID, history, ecc.
          const chunkId = (dataSpec._loadedChunks || 0) + 1;
          rawChunk.forEach(d => d._progressID = chunkId);
          dataSpec._chunkHistory.push({ id: chunkId, chunk: rawChunk });
          dataSpec._loadedChunks = chunkId;
          dataSpec._progressCounter = chunkId;

          // 7) Inserisci in Vega e aggiorna contatori
          await view.change(datasetName, vega.changeset().insert(rawChunk)).runAsync();
          highlightChange(rawChunk, chunkId);
          updateProgressBar();
          updateETC();

          // quality signals, visual stability, etc. (reuse existing code here)

          // 12) schedula prossimo passo se playing
          if (dataSpec._progressState() === "playing" && dataSpec._auxBuffer.length > 0) {
            setTimeout(() => insertNextChunk(false), frequency);
          }

          return;
        }

        // 1) Compute how many chunks are loaded vs total
        const loaded = dataSpec._loadedChunks ?? 0;
        const total = dataSpec._fixedTotalChunks!;
        if (loaded >= total) {
          dataSpec._setProgressState("final");
          updateControls("final");
          return;
        }

        // 2) Prepare the chunk: SEQUENTIAL vs RANDOM
        let indices = [];
        if (readingType === "random") {
          // Draw a set of random indices from the remaining items
          const remaining = originalValues.map((_, i) => i);
          while (indices.length < chunkSize && remaining.length) {
            const idx = Math.floor(randomGenerator() * remaining.length);
            indices.push(remaining[idx]);
            remaining.splice(idx, 1);
          }
        } else {
          // SEQUENTIAL
          const start = loaded * chunkSize;
          const end = Math.min(start + chunkSize, originalValues.length);
          for (let i = start; i < end; i++) indices.push(i);
        }
        if (!indices.length) return;

        // 3) Extract rawChunk and metadata
        const candidate = indices.map(i => originalValues[i]);
        let rawChunk = [], metadata = {};
        if (candidate.length === 1 && candidate[0].process_metadata) {
          rawChunk = candidate[0].data;
          metadata = candidate[0].process_metadata;
        } else {
          rawChunk = candidate;
        }

        // 4) Quality signals on input
        const idx = loaded;
        const fallbackTotal = Math.ceil((dataSpec._initialData?.length || 0) / chunkSize) || 1;
        const absoluteTotal = metadata.total ?? fallbackTotal;
        const absProg = metadata.absolute_progress ?? (idx + 1) / absoluteTotal;
        const relProg = metadata.relative_progress ?? absProg;
        const relStab = metadata.relative_stability ?? (1 - absProg);
        const absCert = metadata.absolute_certainty ?? null;
        console.log(q)
        if (q.absolute_progress.on_data_input) view.signal(q.absolute_progress.on_data_input, absProg);
        if (q.relative_progress.on_data_input) view.signal(q.relative_progress.on_data_input, relProg);
        if (q.relative_stability.on_data_input) view.signal(q.relative_stability.on_data_input, relStab);
        if (q.absolute_certainty.on_data_input) view.signal(q.absolute_certainty.on_data_input, absCert);

        // 5) Noise‐reduction (se attivata)
        if (visRep.noise_reduction) rawChunk = noiseReduce(rawChunk);

        // 6) History, ID, and removal from original data
        const chunkId = loaded + 1;
        rawChunk.forEach(d => d._progressID = chunkId);
        dataSpec._chunkHistory.push({ id: chunkId, chunk: rawChunk });
        dataSpec._undoneChunks = [];
        if (readingType === "random") {
          // Remove those indices from originalValues
          originalValues = originalValues.filter((_, i) => !indices.includes(i));
        }

        // 7) Inserisci in Vega
        await view.change(datasetName, vega.changeset().insert(rawChunk)).runAsync();
        dataSpec._loadedChunks = chunkId;
        dataSpec._progressCounter = chunkId;
        dataSpec._nextIndex = readingType === "random"
          ? null
          : (chunkId * chunkSize);

        // 8) Highlight, progress bar, ETC
        highlightChange(rawChunk, chunkId);
        updateProgressBar();
        updateETC();

        // 9) Quality signals on result_output
        if (q.absolute_progress.on_result_output) view.signal(q.absolute_progress.on_result_output, absProg);
        if (q.relative_progress.on_result_output) view.signal(q.relative_progress.on_result_output, relProg);
        if (q.relative_stability.on_result_output) view.signal(q.relative_stability.on_result_output, relStab);
        if (q.absolute_certainty.on_result_output) view.signal(q.absolute_certainty.on_result_output, absCert);

        if (visRep.visual_stability && initialDomains) {
          // Read the "natural" domain computed on the current data
          const xDomNew = view.scale("x").domain() as [number, number];
          const yDomNew = view.scale("y").domain() as [number, number];

          // Build final domains while keeping the initial padding
          const finalX: [number, number] = [
            Math.min(xDomNew[0], initialDomains.x[0]),
            Math.max(xDomNew[1], initialDomains.x[1])
          ];
          const finalY: [number, number] = [
            Math.min(yDomNew[0], initialDomains.y[0]),
            Math.max(yDomNew[1], initialDomains.y[1])
          ];

          // Apply "locked" domains
          view.scale("x").domain(finalX);
          view.scale("y").domain(finalY);

          // Re-render with the new domains
          await view.runAsync();
        }

        // 11) Quality signals on visual_output
        if (q.absolute_progress.on_visual_output) view.signal(q.absolute_progress.on_visual_output, absProg);
        if (q.relative_progress.on_visual_output) view.signal(q.relative_progress.on_visual_output, relProg);
        if (q.relative_stability.on_visual_output) view.signal(q.relative_stability.on_visual_output, relStab);

        // 12) Schedule the next chunk
        if (!manualStep && dataSpec._progressState() === "playing") {
          setTimeout(() => insertNextChunk(false), frequency);
        }
      }


      dataSpec._insertNextChunk = insertNextChunk; // export for external use





      // ── BRANCH COLORS: skip data chunks, solo colori
      if (isColorEncoding) {
        console.log("[Progressive Loading] CHUNK TYPE = colors → skipping data chunking");

        const ds = dataSpec;
        const dsName = ds.name;
        const field = ds.colorField || "value";
        const freq = ds.provega.progression.chunking.reading?.frequency ?? 2000;

        // ─── 0) Salva copia immutata + inietta __origIndex
        if (!ds._baseCopy) {
          ds._baseCopy = JSON.parse(JSON.stringify(originalValues))
            .map((d, i) => ({ ...d, __origIndex: i }));
        }

        // ─── 0b) Crea la BLANK copy per l’inserimento iniziale (tutti a 0)
        if (!ds._blankCopy) {
          ds._blankCopy = ds._baseCopy.map(d => ({
            ...d,
            [field]: 0    // o null, se preferisci
          }));
        }

        // ─── conserva dominio colore iniziale
        if (!ds._initialColorDomain && view.scale && typeof view.scale === "function") {
          const scale = view.scale("color");
          ds._initialColorDomain = Array.isArray(scale.domain)
            ? [...scale.domain]
            : null;
        }

        // ─── Prepara i valori reali e ordine SEQUENZIALE ───
        if (!ds._newValues) {
          ds._newValues = ds._baseCopy.map(d => d[field]);
          ds._order = ds._newValues.map((_, i) => i);
        }

        // ─── Stato e storico
        let tick = 0;
        let colorInterval;
        ds._history = [];
        ds._undoneChunks = [];

        // ─── 2) updateColors
        function updateColors() {
          const dataArr = view.data(dsName);
          if (tick >= ds._fixedTotalChunks) {
            clearInterval(colorInterval);
            ds._setProgressState("final");
            updateControls(ds._progressState());
            return;
          }

          // segnali di progresso
          const absProg = (tick + 1) / ds._fixedTotalChunks;
          const relStab = 1 - absProg;
          [
            [q.absolute_progress.on_data_input, absProg],
            [q.relative_progress.on_data_input, absProg],
            [q.relative_stability.on_data_input, relStab],
            [q.absolute_certainty.on_data_input, null]
          ].forEach(([sig, val]) => sig && view.signal(sig, val));

          // applica il colore “vero” alla cella idx
          const idx = ds._order[tick];
          const rec = dataArr.find(d => d.__origIndex === idx);
          const oldV = rec[field];
          const newV = ds._newValues[tick];
          ds._history.push({ idx, oldValue: oldV, newValue: newV });

          view.change(dsName, vega.changeset()
            .modify(d => d.__origIndex === idx, field, () => newV))
            .runAsync()
            .then(() => {
              // segnali di visual output
              [
                q.absolute_progress.on_visual_output,
                q.relative_progress.on_visual_output,
                q.relative_stability.on_visual_output
              ].forEach(sig => sig && view.signal(
                sig,
                sig === q.relative_stability.on_visual_output ? relStab : absProg
              ));

              // estendi dominio scala se serve
              const scale = view.scale("color");
              if (scale && Array.isArray(scale.domain)) {
                const vals = view.data(dsName).map(d => d[field]);
                const maxV = Math.max(...vals);
                if (maxV > scale.domain[1]) {
                  scale.domain = [scale.domain[0], maxV];
                  return view.runAsync();
                }
              }
            })
            .then(() => {
              tick++;
              ds._loadedChunks = tick;
              ds._progressCounter = tick;
              updateProgressBar();
              updateETC();
              updateControls(ds._progressState());
              view.container().dispatchEvent(new CustomEvent("progressive:chunk", {
                detail: { dataName: dsName, chunkID: tick, loaded: tick, total: ds._fixedTotalChunks }
              }));
            });
        }

        // ─── 3) Pulsanti
        ds._pauseBtn = createButton("btn-pause", "❚❚", "Pause");
        ds._startBtn = createButton("btn-start", "►", "Play");
        ds._nextStepBtn = createButton("btn-next", "⏭", "Step Forward");
        ds._stepBackBtn = createButton("btn-stepback", "⏮", "Step Back");
        if (socketCheck == false) ds._restartBtn = createButton("btn-restart", "↺", "Start Over");

        // Pause
        ds._pauseBtn.addEventListener("click", () => {
          clearInterval(colorInterval);
          ds._setProgressState("paused");
          updateControls("paused");
          ds._startBtn.disabled = false;
          ds._nextStepBtn.disabled = ds._undoneChunks.length === 0 && ds._loadedChunks >= ds._fixedTotalChunks;
        });

        // Play
        ds._startBtn.addEventListener("click", () => {
          tick = ds._loadedChunks;
          ds._setProgressState("playing");
          updateControls("playing");
          updateProgressBar();
          clearInterval(colorInterval);
          colorInterval = setInterval(updateColors, freq);
        });

        // Step Forward (⏭)
        ds._nextStepBtn.addEventListener("click", () => {
          const state = ds._progressState();
          if (state !== "paused" && state !== "final") return;
          const redo = ds._undoneChunks.pop();
          if (redo) {
            view.change(dsName, vega.changeset()
              .modify(d => d.__origIndex === redo.idx, field, () => redo.newValue))
              .run();
            ds._history.push(redo);
            ds._loadedChunks++;
            ds._progressCounter = ds._loadedChunks;
            updateProgressBar();
            updateControls(state);
            ds._startBtn.disabled = false;
            ds._stepBackBtn.disabled = ds._history.length === 0;
          } else if (ds._loadedChunks < ds._fixedTotalChunks) {
            updateColors();
          }
          ds._nextStepBtn.disabled = ds._undoneChunks.length === 0 && ds._loadedChunks >= ds._fixedTotalChunks;
        });

        // Step Back (⏮)
        ds._stepBackBtn.addEventListener("click", () => {
          const state = ds._progressState();
          if (state !== "paused" && state !== "final") return;
          const last = ds._history.pop();
          if (!last) return;
          view.change(dsName, vega.changeset()
            .modify(d => d.__origIndex === last.idx, field, () => last.oldValue))
            .run();
          ds._undoneChunks.push(last);
          ds._loadedChunks--;
          ds._progressCounter = ds._loadedChunks;
          updateProgressBar();
          updateControls(state);
          ds._startBtn.disabled = false;
          ds._nextStepBtn.disabled = false;
          ds._stepBackBtn.disabled = ds._history.length === 0;
        });

        // Restart (↺)
        if (socketCheck == false) {
          ds._restartBtn.addEventListener("click", () => {
            clearInterval(colorInterval);
            tick = 0;
            ds._history = [];
            ds._undoneChunks = [];
            ds._loadedChunks = 0;
            ds._progressCounter = 0;
            // reset sequenziale dell’ordine
            ds._order = ds._newValues.map((_, i) => i);
            // ripristina BLANK copy
            view.change(dsName, vega.changeset().remove(() => true))
              .runAsync()
              .then(() => view.change(dsName, vega.changeset().insert(ds._blankCopy)).runAsync())
              .then(() => {
                if (view.scale && typeof view.scale === "function" && ds._initialColorDomain) {
                  const scale = view.scale("color");
                  scale.domain = [...ds._initialColorDomain];
                  view.runAsync();
                }
              })
              .then(() => {
                updateProgressBar();
                ds._setProgressState("playing");
                updateControls(ds._progressState());
                colorInterval = setInterval(updateColors, freq);
              });
          });

          // ─── 4) Initial load: inserisci BLANK copy, poi parti con updateColors
          ds._fixedTotalChunks = ds._baseCopy.length;
          view.change(dsName, vega.changeset().insert(ds._blankCopy))
            .runAsync()
            .then(() => {
              ds._setProgressState("playing");
              updateControls(ds._progressState());
              colorInterval = setInterval(updateColors, freq);
            });

          return;
        }
        // -- END COLORS BRANCH --

      }


      // Expose function for buttons
      dataSpec._insertNextChunk = insertNextChunk;

      // Start progression
      insertNextChunk();
    }
    // ----- End progressiveLoading -----

    if (!runProvega) return;
    // ===== Setup controls based on spec.provega.progression.control =====
    const exec = spec.provega.progression?.control || {};

    // If no control is enabled (except Play/StartOver), do not create anything
    if (exec.backward || exec.pause || exec.stop) {


      // 1. Step Back (only if backward=true)
      if (exec.backward) {
        dataSpec._stepBackBtn = createButton(
          "btn-stepback",
          "⏮",
          "Step Back: Remove the last inserted chunk"
        );
      }

      // 2. Pause (only if pause=true)
      if (exec.pause) {
        dataSpec._pauseBtn = createButton(
          "btn-pause",
          "❚❚",
          "Pause: Temporarily stop inserting data"
        );
      }

      // 3. Play (always available)
      dataSpec._startBtn = createButton(
        "btn-start",
        "►",
        "Play: Resume the progression"
      );

      // 4. Next Step (only if pause=true)
      if (exec.pause) {
        dataSpec._nextStepBtn = createButton(
          "btn-next",
          "⏭",
          "Next Step: Insert the next chunk manually"
        );
      }

      // 5. Stop (only if stop=true **and** WebSocket connection)
      let stopBtn: HTMLButtonElement | null = null;
      if (
        exec.stop &&
        dataSpec.data.url &&
        (dataSpec.data.url.startsWith("sio:") || /^wss?:\/\//.test(dataSpec.data.url))
      ) {
        stopBtn = createButton(
          "btn-stop",
          "■",
          "Stop: Completely stop receiving websocket data"
        );
        stopBtn.disabled = false;
      }

      // 6. Start Over (sempre disponibile)
      if (!isColorEncoding && socketCheck == false) {
        dataSpec._startOverBtn = createButton(
          "btn-startover",
          "↺",
          "Start Over: Reset and restart the progression"
        );
      }

      // Imposta subito lo stato iniziale dei bottoni
      updateControls("playing");

      function captureSnapshot(view) {
        const dataSnapshot: Record<string, any> = {};
        const signalSnapshot: Record<string, any> = {};

        const datasets = view._runtime.data;
        const signals = view._signals;

        const dataPromises = Object.keys(datasets).map(async (name) => {
          try {
            dataSnapshot[name] = await view.data(name);
          } catch (e) {
            console.warn(`Error on dataset "${name}":`, e);
          }
        });

        for (const name in signals) {
          try {
            signalSnapshot[name] = view.signal(name);
          } catch (e) {
            console.warn(`Error on signal "${name}":`, e);
          }
        }

        return Promise.all(dataPromises).then(() => ({
          data: dataSnapshot,
          signals: signalSnapshot,
        }));
      }

      function restoreSnapshot(view, snapshot) {
        Object.entries(snapshot.data).forEach(([name, values]) => {
          view.change(name, vega.changeset().remove(() => true).insert(values));
        });

        Object.entries(snapshot.signals).forEach(([name, value]) => {
          try {
            view.signal(name, value);
          } catch (e) {
            console.warn(`Error setting signal "${name}":`, e);
          }
        });

        view.run(); // Force update
      }
      window.restoreSnapshot = restoreSnapshot; // Expose for debugging


      if (exec.pause) {

        dataSpec._pauseBtn.addEventListener("click", async () => {
          if (lockState) return;
          lockState = true;
          var snapshot = await captureSnapshot(view);
          window.__vega_snapshot__ = snapshot;
          console.log("✅ State saved:", snapshot);

          if (progressState === "playing") {

            const spinner = document.querySelector<HTMLElement>('.process-spinner')!;
            setSpinnerActive(spinner, false);
            console.log("[Progressive Loading] Pausing progression.");
            progressState = "paused";
            if (socketCheck == false) {
              infoEl.textContent = "Loading paused."
            }
            else if (socketCheck == true && dataSpec._socket.connected) infoEl.textContent = "Loading paused. The WebSocket connection is still active and sending data in the background. When play is pressed, the other available data will be reinserted from the buffer.";
            updateControls("paused");
          }

          lockState = false;
        });
      }

      // Controls for NON COLORS branch
      if (!isColorEncoding) {


        dataSpec._startBtn.addEventListener("click", () => {
          if (lockState) return;
          lockState = true;

          // 1) If coming from stop/step-back and the buffer is empty...
          if ((dataSpec._auxBuffer?.length || 0) === 0
            && Array.isArray(dataSpec._undoneChunks)
            && dataSpec._undoneChunks.length > 0) {
            // Rebuild the buffer from all removed chunks
            const chunksToRedo = dataSpec._undoneChunks
              // optional: sort by chunk.id to restore original order
              .sort((a, b) => a.id - b.id)
              .flatMap(entry => entry.chunk);

            // Repopulate it
            dataSpec._auxBuffer = chunksToRedo.slice();
            // Clear undone chunks (we're about to re-insert all of them)
            dataSpec._undoneChunks = [];
            console.log(
              "[Progressive Loading] Refilled buffer from undoneChunks:",
              dataSpec._auxBuffer.length,
              "points"
            );
          }

          // 2) Set state and resume
          if (progressState !== "playing") {
            console.log("[Progressive Loading] Resuming progression (play).");
            progressState = "playing";
            infoEl.textContent = "Loading all chunks...";
            updateControls("playing");
            if (typeof dataSpec._insertNextChunk === "function") {
              dataSpec._insertNextChunk();
            }
          }

          lockState = false;
        });


        const chunkSize = dataSpec.provega.progression.chunking.reading.chunk_size ?? 1;

        // -- Next Step listener for the "non-colors" branch --
        if (exec.pause && !isColorEncoding) {
          dataSpec._nextStepBtn.addEventListener("click", () => {
            const state = dataSpec._progressState();
            if (state !== "paused" && state !== "final") return;

            console.log("[Progressive Loading] Forward (redo) clicked.");
            //console.log(`   → loadedChunks=${dataSpec._loadedChunks}, fixedTotalChunks=${dataSpec._fixedTotalChunks}, undoneChunks=${dataSpec._undoneChunks.length}`);

            // 1) re-insert an undo-able chunk
            const undone = dataSpec._undoneChunks.pop();
            if (undone && Array.isArray(undone.chunk)) {
              console.log("[Progressive Loading] Re‑inserting chunk", undone.id);
              view.change(dataSpec.name!, vega.changeset().insert(undone.chunk)).run();

              dataSpec._loadedChunks! += 1;
              dataSpec._progressCounter = dataSpec._loadedChunks;
              dataSpec._chunkHistory.push(undone);
              dataSpec._nextIndex = dataSpec._loadedChunks! * chunkSize;

              if (state === "final") {
                dataSpec._progressState("paused");
                updateControls("paused");
              }
              updateProgressBar();
              dataSpec._stepBackBtn.disabled = false;
              dataSpec._nextStepBtn.disabled =
                dataSpec._undoneChunks.length === 0 &&
                dataSpec._loadedChunks! >= dataSpec._fixedTotalChunks!;

              return;
            }

            // 2) fallback "manual load": if there are still chunks to load,
            //    update nextIndex first, then call the method
            if (dataSpec._undoneChunks.length === 0 &&
              ((dataSpec._fixedTotalChunks ?? Infinity) > (dataSpec._loadedChunks || 0))) {
              console.log("[Progressive Loading] Manual step: forcing next chunk");
              // realign nextIndex as before
              dataSpec._nextIndex = (dataSpec._loadedChunks || 0) * chunkSize;
              // pass force=true
              dataSpec._insertNextChunk(false, true);
              return;
            }

            // 3) if we're already at the end
            console.log("[Progressive Loading] No more chunks to step forward.");
            dataSpec._nextStepBtn.disabled = true;
          });
        }


        // -- Step Back listener (if enabled) --
        if (exec.backward) {
          dataSpec._stepBackBtn.addEventListener("click", () => {
            if (lockState) return;
            lockState = true;

            // If we were in final, go back to paused
            if (dataSpec._progressState() === "final") {
              dataSpec._progressState("paused");
              updateControls("paused");
            }

            console.log("[Progressive Loading] Stepping backwards (removing last chunk).");
            const history = dataSpec._chunkHistory;
            if (history && history.length > 0) {
              const lastEntry = history.pop()!;
              if (Array.isArray(lastEntry.chunk)) {
                // 1) accumulate for redo
                dataSpec._undoneChunks.push(lastEntry);

                // 2) remove from the view
                const cs = vega.changeset().remove((d: any) => d._progressID === lastEntry.id);
                view.change(dataSpec.name!, cs).run();

                // 3) update counters
                dataSpec._loadedChunks = Math.max((dataSpec._loadedChunks || 1) - 1, 0);
                dataSpec._progressCounter = dataSpec._loadedChunks;
                updateProgressBar();

                // 4) disable Step Back if we're back to the first
                if (lastEntry.id === 1) {
                  dataSpec._stepBackBtn.disabled = true;
                  console.log("[Progressive Loading] No other chunk to step back.");
                }

                // 5) always enable Next Step when there is something to redo
                if (dataSpec._undoneChunks.length > 0) {
                  dataSpec._nextStepBtn.disabled = false;
                  console.log("[Progressive Loading] Restored forward button.");
                }

                console.log(`[Progressive Loading] Step Back: removed chunk id ${lastEntry.id}.`);
              }
            } else {
              console.log("[Progressive Loading] No chunk to step back.");
            }

            lockState = false;
          });
        }


        // — Event listener per Stop (se abilitato) —
        if (stopBtn) {
          stopBtn.addEventListener("click", () => {
            if (!dataSpec._socket) return;
            console.log("[Progressive Loading] Stop: disconnecting socket.");
            dataSpec._socket.disconnect();
            stopBtn.disabled = true;

            // Passiamo in PLAYING e aggiorniamo i controlli
            dataSpec._setProgressState("playing");
            infoEl.textContent = "Websocket disconnected. Flushing remaining chunks…";
            updateControls("playing");

            // Ricalcolo quanti chunk ci sono da processare
            const cs = dataSpec.provega.progression.chunking.reading.chunk_size || 10;
            dataSpec._fixedTotalChunks =
              (dataSpec._loadedChunks || 0) +
              Math.ceil((dataSpec._auxBuffer?.length || 0) / cs);
            updateProgressBar();

            dataSpec._insertNextChunk?.(false /*manualStep*/, true /*force*/);
          });
        }

        // — Event listener per Start Over (sempre) —
        if (socketCheck == false) {
          dataSpec._startOverBtn.addEventListener("click", () => {
            if (lockState) return;
            lockState = true;
            console.log("[Progressive Loading] Resetting and restarting progression.");
            view.change(datasetName, vega.changeset().remove(() => true)).run();
            dataSpec._loadedChunks = 0;
            dataSpec._progressCounter = 1;
            dataSpec._chunkHistory = [];
            dataSpec._undoneChunks = [];
            progressBar.innerHTML = "";
            progressFill = document.createElement("div");
            progressFill.id = "progress-fill";
            progressFill.className = "progress-fill";
            progressBar.appendChild(progressFill);
            infoEl.textContent = "Loading all chunks...";
            progressState = "playing";
            updateControls("playing");
            if (dataSpec._initialData) {
              progressiveLoading(dataSpec._initialData.slice(), dataSpec, view, datasetName, false, visRep);
              resetHeatmap();
            }
            if (dataSpec._auxBuffer) {
              dataSpec._auxBuffer = [];
            }
            lockState = false;
          });
        }


        // Conserviamo le funzioni di stato
        dataSpec._progressState = () => progressState;
        dataSpec._setProgressState = (newState: "playing" | "paused") => {
          progressState = newState;
          updateControls(newState);
        };
      }
      // End control setup
    }

    // Initialize the auxiliary buffer for WebSocket, if needed
    if (!dataSpec._auxBuffer) {
      dataSpec._auxBuffer = [];
    }

    // ===== Setup controlli basati su spec.provega.progression.control =====
    //const exec = spec.progressive?.execution || {};

    // If no control is enabled (except Play/StartOver), do not create anything
    if (exec.backward || exec.pause || exec.stop) {





      // 1. Step Back (only if backward=true)
      if (exec.backward) {
        dataSpec._stepBackBtn = createButton(
          "btn-stepback",
          "⏮",
          "Step Back: Remove the last inserted chunk"
        );
      }

      // 2. Pause (only if pause=true)
      if (exec.pause) {
        dataSpec._pauseBtn = createButton(
          "btn-pause",
          "❚❚",
          "Pause: Temporarily stop inserting data"
        );
      }

      // 3. Play (sempre disponibile)
      dataSpec._startBtn = createButton(
        "btn-start",
        "►",
        "Play: Resume the progression"
      );

      // 4. Next Step (only if pause=true)
      if (exec.pause) {
        dataSpec._nextStepBtn = createButton(
          "btn-next",
          "⏭",
          "Next Step: Insert the next chunk manually"
        );
      }

      // 5. Stop (only if stop=true **and** WebSocket connection)
      let stopBtn: HTMLButtonElement | null = null;
      if (
        exec.stop &&
        dataSpec.data.url &&
        (dataSpec.data.url.startsWith("sio:") || /^wss?:\/\//.test(dataSpec.data.url))
      ) {
        stopBtn = createButton(
          "btn-stop",
          "■",
          "Stop: Completely stop receiving websocket data"
        );
        stopBtn.disabled = false;
      }

      // 6. Start Over (sempre disponibile)
      if (!isColorEncoding && socketCheck == false) {
        dataSpec._startOverBtn = createButton(
          "btn-startover",
          "↺",
          "Start Over: Reset and restart the progression"
        );
      }
      // Imposta subito lo stato iniziale dei bottoni
      updateControls("playing");

    }

    // Data loading:
    // If the URL indicates WebSocket, use initSocketConnection; otherwise use local data or fetch().
    if (socketCheck == true) {
      console.log("[Progressive Loading] WebSocket URL detected:", dataSpec.data.url);
      const socketUrl = dataSpec.data.url.startsWith("sio:") ? dataSpec.data.url.substring(4) : dataSpec.data.url;
      console.log(socketUrl)
      initSocketConnection(socketUrl, datasetName, view, dataSpec);
      progressiveLoading(dataSpec._auxBuffer, dataSpec, view, datasetName, true, visRep);

    } else if (!dataSpec.data.url || dataSpec.data.url.trim() === "") {
      // if there is no URL, use values; if values is empty, use _initialData
      const originalValues: any[] =
        Array.isArray(dataSpec.values) && dataSpec.values.length > 0
          ? dataSpec.values
          : (Array.isArray(dataSpec._initialData) ? dataSpec._initialData : []);
      // keep a copy for StartOver
      dataSpec._initialData = originalValues.slice();
      // clear values to avoid drawing everything at startup
      dataSpec.values = [];
      // start progressive loading
      progressiveLoading(originalValues, dataSpec, view, datasetName, false, visRep);
    } else {
      console.log("[Progressive Loading] Fetching data from file:", dataSpec.data.url);

      if (dataSpec.data.url.toLowerCase().endsWith('.csv')) {
        fetch(dataSpec.data.url)
          .then(response => response.text())
          .then(text => {
            // 1) parse CSV with Vega (no d3 dependency)
            const all = vega.read(text, { type: 'csv' });
            console.log("[Progressive Loading] CSV parsed, columns found:", Object.keys(all[0] || {}));

            // 2) dynamically detect lat/lon column names
            const headerKeys = Object.keys(all[0] || {});
            const latKey = headerKeys.find(c => c.toLowerCase() === 'latitude');
            const lonKey = headerKeys.find(c => c.toLowerCase().startsWith('longitude'));

            // 3) build the array to load
            let toLoad;
            if (latKey && lonKey) {
              // map to {lat, lon, ...other fields}
              toLoad = all.map(d => ({
                ...d,
                lat: +d[latKey],
                lon: +d[lonKey]
              }));
              console.log(`[Progressive Loading] Found lat/lon in '${latKey}', '${lonKey}'. Loaded ${toLoad.length} points.`);
            } else {
              // no lat/lon: load the full CSV as-is
              toLoad = all;
              console.warn("[Progressive Loading] Latitude/longitude columns not found; loading all fields.");
            }

            // 4) reset layer and start progressiveLoading
            view.change(datasetName, vega.changeset().remove(() => true)).run();
            dataSpec._initialData = toLoad.slice();
            console.log(toLoad, dataSpec, view, datasetName, false, visRep);
            progressiveLoading(toLoad, dataSpec, view, datasetName, false, visRep);
          })
          .catch(err => {
            console.error("Error fetching/parsing CSV:", err);
            infoEl.textContent = "CSV parsing error. Check console.";
          });
      }
      else {
        // JSON branch unchanged
        fetch(dataSpec.data.url)
          .then(response => response.json())
          .then(fetchedData => {
            console.log("[Progressive Loading] JSON fetched (first 5):", fetchedData.slice(0, 5));
            view.change(datasetName, vega.changeset().remove(() => true)).run();
            dataSpec._initialData = fetchedData.slice();
            progressiveLoading(fetchedData, dataSpec, view, datasetName, false, visRep);
          })
          .catch(err => {
            console.error("Error fetching data from URL:", err);
            infoEl.textContent = "Data fetch error. Check console.";
          });
      }
    }



  })(); // End IIFE progressiveLoadingHandler



  function seededRandom(seed: number) {
    let state = seed;
    return function () {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return (state >>> 0) / 4294967296;
    };
  }

  // end change


  let documentClickHandler: ((this: Document, ev: MouseEvent) => void) | undefined;

  if (actions !== false) {
    let wrapper = element;

    if (opts.defaultStyle !== false || opts.forceActionsMenu) {
      const details = document.createElement('details');
      details.title = i18n.CLICK_TO_VIEW_ACTIONS;
      element.append(details);

      wrapper = details;
      const summary = document.createElement('summary');
      summary.innerHTML = SVG_CIRCLES;

      details.append(summary);

      documentClickHandler = (ev: MouseEvent) => {
        if (!details.contains(ev.target as any)) {
          details.removeAttribute('open');
        }
      };
      document.addEventListener('click', documentClickHandler);
    }

    const ctrl = document.createElement('div');
    wrapper.append(ctrl);
    ctrl.classList.add('vega-actions');

    // add 'Export' action
    if (actions === true || actions.export !== false) {
      for (const ext of ['svg', 'png'] as const) {
        if (actions === true || actions.export === true || (actions.export as { svg?: boolean; png?: boolean })[ext]) {
          const i18nExportAction = (i18n as { [key: string]: string })[`${ext.toUpperCase()}_ACTION`];
          const exportLink = document.createElement('a');
          const scaleFactor = isObject(opts.scaleFactor) ? opts.scaleFactor[ext] : opts.scaleFactor;

          exportLink.text = i18nExportAction;
          exportLink.href = '#';
          exportLink.target = '_blank';
          exportLink.download = `${downloadFileName}.${ext}`;
          // add link on mousedown so that it's correct when the click happens
          exportLink.addEventListener('mousedown', async function (this, e) {
            e.preventDefault();
            var url = await view.toImageURL(ext, scaleFactor);
            this.href = url;
          });

          ctrl.append(exportLink);
        }
      }
    }

    // add 'View Source' action
    if (actions === true || actions.source !== false) {
      const viewSourceLink = document.createElement('a');

      viewSourceLink.text = i18n.SOURCE_ACTION;
      viewSourceLink.href = '#';
      viewSourceLink.addEventListener('click', function (this, e) {
        viewSource(stringify(spec), opts.sourceHeader ?? '', opts.sourceFooter ?? '', mode);
        e.preventDefault();
      });

      ctrl.append(viewSourceLink);
    }

    // add 'View Compiled' action
    if (mode === 'vega-lite' && (actions === true || actions.compiled !== false)) {
      const compileLink = document.createElement('a');

      compileLink.text = i18n.COMPILED_ACTION;
      compileLink.href = '#';
      compileLink.addEventListener('click', function (this, e) {
        viewSource(stringify(vgSpec), opts.sourceHeader ?? '', opts.sourceFooter ?? '', 'vega');
        e.preventDefault();
      });

      ctrl.append(compileLink);
    }

    // add 'Open in Vega Editor' action
    if (actions === true || actions.editor !== false) {
      const editorUrl = opts.editorUrl ?? 'https://vega.github.io/editor/';
      const editorLink = document.createElement('a');

      editorLink.text = i18n.EDITOR_ACTION;
      editorLink.href = '#';
      editorLink.addEventListener('click', function (this, e) {
        post(window, editorUrl, {
          config: config as Config,
          mode: patch ? 'vega' : mode,
          renderer,
          spec: stringify(patch ? vgSpec : spec),
        });
        e.preventDefault();
      });

      ctrl.append(editorLink);
    }
  }

  function finalize() {
    if (documentClickHandler) {
      document.removeEventListener('click', documentClickHandler);
    }
    view.finalize();
  }

  return { view, spec, vgSpec, finalize, embedOptions: opts };
}
