// progressive-icicle.js
// Assumes: vega, vega-lite, vegaEmbed, d3, Papa are loaded before this script.
// Saves: builds icicle from CSV or sequences.json; robust delimiter/header detection.

(function () {
  'use strict';

  // ----- Config -----
  const WIDTH = 980;
  const HEIGHT = 560;
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  // ----- Small DOM helpers -----
  function setStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.innerText = msg;
    console.log('[PROVEGA]', msg);
  }

  function removeBOM(text) {
    return text.replace(/^\uFEFF/, '');
  }

  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).slice(0, 40).filter(l => l.trim().length > 0);
    if (!lines.length) return ',';
    const candidates = [',', ';', '\t', '|'];
    const scores = {};
    for (const c of candidates) scores[c] = 0;
    for (const line of lines) {
      for (const c of candidates) {
        scores[c] += (line.split(c).length - 1);
      }
    }
    const best = candidates.reduce((a, b) => (scores[a] >= scores[b] ? a : b));
    return scores[best] > 0 ? best : ',';
  }

  // robust-ish date parser: ISO, Y-M-D, D/M/Y, D-M-Y, fallback to Date()
  function parseDateSafe(s) {
    if (!s && s !== 0) return null;
    const raw = ('' + s).trim();
    if (raw === '') return null;

    // Try ISO and common formats
    const tryIso = new Date(raw);
    if (!isNaN(tryIso)) return tryIso;

    // Try dd/mm/yyyy or dd-mm-yyyy
    const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/;
    const m = raw.match(dmy);
    if (m) {
      let dd = parseInt(m[1], 10);
      let mm = parseInt(m[2], 10) - 1;
      let yy = parseInt(m[3], 10);
      if (yy < 100) yy += (yy >= 70 ? 1900 : 2000); // heuristic
      const d = new Date(yy, mm, dd);
      if (!isNaN(d)) return d;
    }

    // Try yyyy/mm/dd or yyyy-mm-dd
    const ymd = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/;
    const m2 = raw.match(ymd);
    if (m2) {
      const yy = parseInt(m2[1], 10);
      const mm = parseInt(m2[2], 10) - 1;
      const dd = parseInt(m2[3], 10);
      const d = new Date(yy, mm, dd);
      if (!isNaN(d)) return d;
    }

    // As last resort try Date.parse again
    const d3 = new Date(raw);
    if (!isNaN(d3)) return d3;
    return null;
  }

  function daysBetween(d1, d2) {
    if (!d1 || !d2) return 0;
    return Math.max(0, Math.round((d2 - d1) / MS_PER_DAY));
  }

  // ----- CSV -> sequences conversion -----
  // rows: array of objects (header keys), case-insensitive header normalization will be applied
  function rowsToSequences(rows) {
    if (!rows || rows.length === 0) return [];

    // normalize keys: lower-case trimmed
    const normalized = rows.map(r => {
      const o = {};
      Object.keys(r || {}).forEach(k => {
        const key = ('' + k).trim().toLowerCase();
        o[key] = r[k];
      });
      return o;
    });

    // detect column names
    const first = normalized[0] || {};
    const keys = Object.keys(first);
    const pidCandidates = ['num_enq', 'numenq', 'patient', 'id', 'patient_id', 'num', 'numenq'];
    const pidKey = pidCandidates.find(k => keys.includes(k));
    if (!pidKey) throw new Error('Colonna patient id non trovata (cercati: ' + pidCandidates.join(',') + ')');

    const categoryCandidates = ['category', 'event', 'type'];
    const categoryKey = categoryCandidates.find(k => keys.includes(k));
    if (!categoryKey) throw new Error('Colonna category non trovata (category,event,type)');

    const dateCandidates = ['date', 'datetime', 'time', 'event_date'];
    const dateKey = dateCandidates.find(k => keys.includes(k));
    if (!dateKey) throw new Error('Colonna date non trovata (date, datetime, time, event_date)');

    // group rows by pid
    const groups = new Map();
    normalized.forEach(r => {
      const pid = (r[pidKey] !== undefined && r[pidKey] !== null) ? ('' + r[pidKey]).trim() : '';
      if (pid === '') return;
      const cat = (r[categoryKey] !== undefined && r[categoryKey] !== null) ? ('' + r[categoryKey]).trim() : '';
      const rawDate = r[dateKey];
      const d = parseDateSafe(rawDate);
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid).push({ pid, category: cat, date: d, raw: r });
    });

    const sequences = [];
    groups.forEach((events, pid) => {
      // filter invalid dates & sort
      events = events.filter(e => e.date !== null).sort((a, b) => a.date - b.date);
      if (events.length === 0) return;

      // compress consecutive identical categories into segments
      const segments = [];
      let cur = null;
      events.forEach(ev => {
        if (!cur) {
          cur = { category: ev.category, start: ev.date, end: ev.date, records: [ev] };
        } else {
          if (ev.category === cur.category) {
            cur.end = ev.date;
            cur.records.push(ev);
          } else {
            segments.push(cur);
            cur = { category: ev.category, start: ev.date, end: ev.date, records: [ev] };
          }
        }
      });
      if (cur) segments.push(cur);

      // convert to sequence of {type, duration}
      const seq = segments.map(seg => {
        let dur = daysBetween(seg.start, seg.end);
        if (dur <= 0) dur = 7; // assume weekly sample if single observation
        dur = Math.max(1, Math.round(dur));
        return { type: seg.category || 'unknown', duration: dur };
      });

      if (seq.length > 0) sequences.push(seq);
    });

    return sequences;
  }

  // ----- prefix tree building + map->obj -----
  let nodeIdCounter = 0;
  function newNode(name) {
    return { name, children: new Map(), count: 0, totalDuration: 0, avgDuration: 0, id: 'n' + (nodeIdCounter++) };
  }

  function mergeSequence(root, seq) {
    let node = root;
    node.count += 1;
    for (const ev of seq) {
      if (!node.children.has(ev.type)) node.children.set(ev.type, newNode(ev.type));
      node = node.children.get(ev.type);
      node.count += 1;
      node.totalDuration += ev.duration;
      node.avgDuration = node.totalDuration / node.count;
    }
  }

  function mapToObj(node) {
    const children = Array.from(node.children.values()).map(mapToObj);
    return {
      name: node.name,
      id: node.id,
      count: node.count,
      avgDuration: node.avgDuration || 0,
      children: children.length ? children : undefined
    };
  }

  // ----- render pipeline (d3 partition + vega embed) -----
  async function renderIcicleFromSequences(sequences, forceX800 = false) {
    try {
      // build map
      nodeIdCounter = 0;
      const rootMap = newNode('root');
      for (let i = 0; i < sequences.length; i++) mergeSequence(rootMap, sequences[i]);
      const treeObj = mapToObj(rootMap);

      // hierarchy, sum by avgDuration
      const root = d3.hierarchy(treeObj, d => d.children).sum(d => d.avgDuration || 0).sort((a, b) => b.value - a.value);
      const totalDays = root.value || 1;
      const xDomainMax = forceX800 ? 800 : totalDays;

      // partition with x domain in days and y in pixel bands
      const partition = d3.partition().size([xDomainMax, HEIGHT]);
      partition(root);

      // prepare rects
      const nodes = root.descendants().map(d => ({
        id: d.data.id,
        name: d.data.name,
        depth: d.depth,
        count: d.data.count || 0,
        avgDuration: d.data.avgDuration || 0,
        x0days: d.x0,
        x1days: d.x1,
        y0: d.y0,
        y1: d.y1
      }));
      const rects = nodes.filter(n => n.depth > 0);

      const uniqueNames = Array.from(new Set(rects.map(r => r.name || '')));
      const palette = ['#3b82c4', '#f97316', '#10b981', '#a78bfa', '#ef4444', '#f59e0b', '#94a3b8', '#374151'];
      const colorRange = uniqueNames.map((n, i) => palette[i % palette.length]);

      const domainRange = xDomainMax;
      const labelThresholdDays = Math.max(domainRange * 0.05, 20);

      // build VL spec
      const vlSpec = {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        width: WIDTH,
        height: HEIGHT,
        padding: { left: 70, right: 20, top: 10, bottom: 50 },

        // PROVEGA metadata for your custom embed
        provega: {
          progression: {
            chunking: { type: 'data', reading: { method: 'sequential', chunk_size: 200, frequency: 300, seed: 42 } },
            control: { mode: 'exploration', pause: true, stop: true, backward: true, min_frequency: 200 },
            monitoring: { aliveness: true, progressbar: true }
          },
          visualization: { visual_stability: true }
        },

        data: { name: 'rects', values: rects },

        layer: [
          {
            mark: { type: 'rect', stroke: '#e6e6e6', strokeWidth: 1 },
            encoding: {
              x: { field: 'x0days', type: 'quantitative', scale: { domain: [0, xDomainMax], nice: true }, axis: { title: 'Sum of averages of the treatments (days)', orient: 'bottom', tickCount: 8 } },
              x2: { field: 'x1days' },
              y: { field: 'y0', type: 'quantitative', axis: null, scale: { domain: [0, HEIGHT], nice: false } },
              y2: { field: 'y1' },
              color: { field: 'name', type: 'nominal', legend: null, scale: { domain: uniqueNames, range: colorRange } },
              tooltip: [
                { field: 'name', title: 'Node' },
                { field: 'count', title: 'Count' },
                { field: 'avgDuration', title: 'Avg duration (days)' }
              ]
            }
          },
          {
            transform: [
              { calculate: '(datum.x0days + datum.x1days) / 2', as: 'cx' },
              { calculate: '(datum.y0 + datum.y1) / 2', as: 'cy' },
              { calculate: 'datum.x1days - datum.x0days', as: 'widthDays' },
              { filter: `datum.widthDays >= ${labelThresholdDays}` }
            ],
            mark: { type: 'text', align: 'center', baseline: 'middle', fontWeight: 700, fontSize: 12 },
            encoding: {
              x: { field: 'cx', type: 'quantitative', scale: { domain: [0, xDomainMax] } },
              y: { field: 'cy', type: 'quantitative', scale: { domain: [0, HEIGHT], nice: false } },
              text: { field: 'name', type: 'nominal' },
              color: { value: '#ffffff' }
            }
          }
        ],
        config: { background: '#ffffff', view: { stroke: null } }
      };

      // embed
      try {
        await vegaEmbed('#vis-root', vlSpec, { mode: 'vega-lite', actions: false, renderer: 'canvas' });
        window.__PROVEGA__ = { sequences, rects, treeObj, totalDays: xDomainMax };
        setStatus(`Rendered: ${sequences.length} patients — domain days: ${Math.round(xDomainMax)}`);
      } catch (err) {
        console.error('Embed failed', err);
        setStatus('Embed failed: ' + (err && err.message ? err.message : err));
      }
    } catch (err) {
      console.error('renderIcicleFromSequences error', err);
      setStatus('Render pipeline error: ' + (err && err.message ? err.message : err));
    }
  }

  // ----- parsing flow + fallback header reconstruction -----
  function parseTextCsvThenRender(text, force800) {
    try {
      if (typeof Papa === 'undefined') throw new Error('PapaParse non trovato. Includi PapaParse prima di questo script.');
      text = removeBOM('' + text);
      const delim = detectDelimiter(text);
      console.log('[parser] detected delimiter:', JSON.stringify(delim));

      // try header parse first
      const pap = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        delimiter: delim,
        transformHeader: h => (h || '').trim()
      });

      let rows = pap.data;
      // fallback: if no fields detected (pap.meta.fields missing or too few), rebuild header from first row
      if ((!pap.meta || !pap.meta.fields || pap.meta.fields.length <= 1) && pap.data && pap.data.length > 0) {
        console.warn('[parser] header detection failed — attempting fallback reconstruction');
        const raw = Papa.parse(text, { header: false, skipEmptyLines: true, delimiter: delim });
        if (!raw || !raw.data || raw.data.length < 2) {
          throw new Error('CSV non interpretabile (fallback ha prodotto troppo poche righe)');
        }
        const headerRow = raw.data[0].map(h => (h || '').toString().trim());
        const dataRows = raw.data.slice(1);
        rows = dataRows.map(r => {
          const obj = {};
          headerRow.forEach((h, i) => {
            const key = ('' + h).trim();
            obj[key] = (r && r[i] !== undefined) ? r[i] : '';
          });
          return obj;
        });
      }

      if (pap.errors && pap.errors.length) {
        console.warn('PapaParse errors (first 50):', pap.errors.slice(0, 50));
        setStatus(`PapaParse errors: ${pap.errors.length} (vedi console)`);
      }

      const sequences = rowsToSequences(rows);
      if (!sequences || sequences.length === 0) {
        setStatus('Nessuna sequenza valida trovata nel CSV');
        return;
      }
      renderIcicleFromSequences(sequences, force800);
    } catch (err) {
      console.error('parseTextCsvThenRender error', err);
      setStatus('Parsing/processing error: ' + (err && err.message ? err.message : err));
    }
  }

  async function fetchCsvAndRender(url, force800) {
    setStatus(`Fetching CSV: ${url} ...`);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      parseTextCsvThenRender(text, force800);
    } catch (err) {
      console.error('Fetch error', err);
      setStatus('CSV fetch error: ' + (err && err.message ? err.message : err));
    }
  }

  async function fetchJsonSequencesAndRender(url, force800) {
    setStatus(`Fetching JSON sequences: ${url} ...`);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const obj = await resp.json();
      if (!Array.isArray(obj)) throw new Error('sequences.json is not an array of sequences');
      renderIcicleFromSequences(obj, force800);
    } catch (err) {
      console.error('Fetch JSON error', err);
      setStatus('JSON fetch error: ' + (err && err.message ? err.message : err));
    }
  }

  // ----- UI wiring -----
  function init() {
    const fileInput = document.getElementById('file');
    const btnReset = document.getElementById('btn-reset');
    const forceCheckbox = document.getElementById('force800');
    const visRoot = document.getElementById('vis-root');

    if (fileInput) {
      fileInput.addEventListener('change', ev => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        setStatus('Parsing CSV from file...');
        const reader = new FileReader();
        reader.onload = function (e) {
          const text = e.target.result;
          parseTextCsvThenRender(text, forceCheckbox && forceCheckbox.checked);
        };
        reader.onerror = function () {
          setStatus('FileReader error');
        };
        reader.readAsText(f);
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (visRoot) visRoot.innerHTML = '';
        setStatus('Reset. Load a new CSV or set window.PROVEGA_JSON_URL / window.PROVEGA_CSV_URL.');
      });
    }

    // Auto-load: priority JSON -> CSV (global var) -> data-url attribute
    const globalJson = window.PROVEGA_JSON_URL;
    const globalCsv = window.PROVEGA_CSV_URL;
    const dataUrlAttr = visRoot && visRoot.getAttribute ? visRoot.getAttribute('data-url') : null;
    const force800 = (forceCheckbox && forceCheckbox.checked) || false;

    (async function autoLoad() {
      if (globalJson) {
        await fetchJsonSequencesAndRender(globalJson, force800);
        return;
      }
      if (dataUrlAttr) {
        // decide by extension: .json -> json, else try csv
        const lower = dataUrlAttr.toLowerCase();
        if (lower.endsWith('.json')) {
          await fetchJsonSequencesAndRender(dataUrlAttr, force800);
          return;
        } else {
          // try CSV first
          await fetchCsvAndRender(dataUrlAttr, force800);
          return;
        }
      }
      if (globalCsv) {
        await fetchCsvAndRender(globalCsv, force800);
        return;
      }
      setStatus('Waiting for CSV/JSON (load a file or set window.PROVEGA_JSON_URL / window.PROVEGA_CSV_URL).');
    })();

    // expose small API
    window.PROVEGA = window.PROVEGA || {};
    window.PROVEGA.reload = async function () {
      if (globalJson) return fetchJsonSequencesAndRender(globalJson, forceCheckbox && forceCheckbox.checked);
      if (dataUrlAttr) {
        const lower = dataUrlAttr.toLowerCase();
        if (lower.endsWith('.json')) return fetchJsonSequencesAndRender(dataUrlAttr, forceCheckbox && forceCheckbox.checked);
        return fetchCsvAndRender(dataUrlAttr, forceCheckbox && forceCheckbox.checked);
      }
      if (globalCsv) return fetchCsvAndRender(globalCsv, forceCheckbox && forceCheckbox.checked);
      setStatus('Nessuna fonte automatica configurata per reload.');
    };
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(); // IIFE end
