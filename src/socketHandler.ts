import vegaImport from 'vega';
import vegaLiteImport from 'vega-lite';
import pkg from '../package.json';
export const version = pkg.version;
export * from './types.js';

export const vega = vegaImport;
export let vegaLite = vegaLiteImport;
declare var io: any;

/**
 * Initializes the SocketIO connection and links the data stream to the dataset.
 * Instead of updating the view directly, received data is accumulated in _auxBuffer.
 * @param {string} url - The SocketIO server URL.
 * @param {string} datasetName - The dataset name in the view.
 * @param {any} view - The Vega view instance.
 * @param {any} dataSpec - The dataSpec object from the spec (which holds _auxBuffer and will store the socket).
 */
export function initSocketConnection(url: string, datasetName: string, view: any, dataSpec: any): void {
    console.log("[SocketIO] Connecting to:", url);
    const socket = io(url);
    // Save the socket in dataSpec so that it can be disconnected later
    dataSpec._socket = socket;
    socket.on("connect", () => {
        console.log("[SocketIO] Connected to the server.");
    });
    socket.on("data", (newData: any) => {
        console.log("[SocketIO] Received new data:", newData);
        const dataToInsert = Array.isArray(newData) ? newData : [newData];
        if (!dataSpec._auxBuffer) {
            dataSpec._auxBuffer = [];
        }
        // Append new data to the auxiliary buffer
        dataSpec._auxBuffer.push(...dataToInsert);

        // — Appena arriva un dato, se siamo in PLAYING, processalo subito —
        if (dataSpec._progressState?.() === "playing" && typeof dataSpec._insertNextChunk === "function") {
            dataSpec._insertNextChunk();
        }
    });
    socket.on("disconnect", () => {
        console.log("[SocketIO] Disconnected from the server.");
    });
    socket.on("error", (error: any) => {
        console.error("[SocketIO] Error:", error);
    });
}
