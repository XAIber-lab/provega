async function getDens(){
    // 1) Load USA boundaries
    const topo = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json').then(r => r.json());
    const states = topojson.feature(topo, topo.objects.states).features;

    // 2) Vega-Lite spec without dataset names => uses source_0
    const spec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 800,
    height: 500,
    projection: { type: 'albersUsa' },

    // Provega (new grammar)
    provega: {
        progression: {
        chunking: {
            type: 'data',
            reading: {
            method: 'sequential',
            ascending: true,
            chunk_size: 2000,
            frequency: 200
            }
        },
        control: {
            mode: 'exploration',
            pause: true,
            stop: true,
            backward: true,
            min_frequency: 500,
            min_rendering_frequency: null
        },
        monitoring: {
            aliveness: true,
            etc: 'eta_ms',
            progressbar: true,
            change: { mark: { active: false, blink: false }, noise_reduction: false },
            quality: {
            absolute_progress: { on_data_input: true, on_result_output: true, on_visual_output: true },
            relative_progress: { on_data_input: true, on_result_output: true, on_visual_output: true },
            relative_stability: { on_data_input: false, on_result_output: false, on_visual_output: false },
            absolute_certainty: { on_result_output: false }
            }
        }
        },
    },

    // 3) Data CSV → default source_0
    data: {
        url: 'static/data/fars_all_accidents.csv', //change in fars_sampled_5pct.csv (and 10,20,30,40) to have lighter csv files
        format: { type: 'csv' }
    },

    // 4) Trasformazioni lat/lon
    transform: [
        { calculate: 'datum.latitude', as: 'lat' },
        { calculate: 'datum.longitude', as: 'lon' }
    ],

    // 5) Layers: confini + punti (questi ultimi ereditano source_0)
    layer: [
        {
        data: { values: states },
        mark: { type: 'geoshape', fill: '#f0f0f0', stroke: '#fff', strokeWidth: 0.5 }
        },
        {
        mark: { type: 'circle', size: 2, color: 'green', opacity: 0.6 },
        encoding: {
            longitude: { field: 'lon', type: 'quantitative' },
            latitude: { field: 'lat', type: 'quantitative' }
        }
        }
    ],

    config: {
        background: '#f5f5f5',
        view: { stroke: 'transparent' },
        axis: { labelFont: 'Arial', labelFontSize: 12 }
    }
    };

    return spec;
}

window.getDens = getDens;

if (!window.expectedBooleans){
    window.expectedBooleans = [
        "provega.progression.chunking.reading.ascending",

        "provega.progression.monitoring.aliveness",

        "provega.progression.monitoring.change.mark.active",
        "provega.progression.monitoring.change.mark.blink",

        "provega.progression.monitoring.change.noise_reduction",

        "provega.progression.monitoring.quality.absolute_progress.on_data_input",
        "provega.progression.monitoring.quality.absolute_progress.on_result_output",
        "provega.progression.monitoring.quality.absolute_progress.on_visual_output",
        "provega.progression.monitoring.quality.relative_progress.on_data_input",
        "provega.progression.monitoring.quality.relative_progress.on_result_output",
        "provega.progression.monitoring.quality.relative_progress.on_visual_output",
        "provega.progression.monitoring.quality.relative_stability.on_data_input",
        "provega.progression.monitoring.quality.relative_stability.on_result_output",
        "provega.progression.monitoring.quality.relative_stability.on_visual_output",
        "provega.progression.monitoring.quality.absolute_certainty.on_result_output",
    ];
}


if(!window.extractBooleanValues){
    function extractBooleanValues(spec) {
        function getValueFromPath(obj, path) {
            const parts = path.split('.');
            let current = obj;

            for (const part of parts) {
                if (typeof current === 'object' && current !== null && part in current) {
                    current = current[part];
                } else {
                    return null; // path non trovato
                }
            }

            if (typeof current === 'boolean') {
                return current;
            }
            return null; // valore non booleano
        }

        const result = [];

        for (const path of expectedBooleans) {
            const val = getValueFromPath(spec, path);
            if (val !== null) {
                result.push({ path: path, _value: val });
            }
        }

        return result;
    }

    window.extractBooleanValues = extractBooleanValues;
}

