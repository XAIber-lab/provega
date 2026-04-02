declare module 'node_modules/vega-typings/types/spec/data.d.ts' {
    interface BaseData {
        url?: string;
        format?: object;
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
}