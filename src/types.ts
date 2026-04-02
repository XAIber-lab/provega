import {Config as VgConfig, Renderers} from 'vega';
import {Config as VlConfig} from 'vega-lite';

export type Mode = 'vega' | 'vega-lite';
export type Config = VlConfig | VgConfig;

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type ExpressionFunction = Record<string, any | {fn: any; visitor?: any}>;

export interface MessageData {
  spec: string;
  file?: unknown;
  config?: Config;
  mode: Mode;
  renderer?: Renderers;
}

export interface Data {
  name?: string;
  url?: string;
  format?: object; 
  values?: any[]; // Can be an array of data or data chunks
  chunking?: {
    type: 'data' | 'process';
    reading?: {
      method?: 'sequential' | 'random';
      asc?: boolean;
      size?: number;
      freq?: number;
      seed?: number;
    };
  };
}
