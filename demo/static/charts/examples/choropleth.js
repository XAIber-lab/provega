async function getChoro(){
// 1) Load TopoJSON states + counties
  const [usStates, usCounties] = await Promise.all([
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json').then(r=>r.json()),
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json').then(r=>r.json())
  ]);
  const states   = topojson.feature(usStates,  usStates.objects.states).features;
  const counties = topojson.feature(usCounties, usCounties.objects.counties).features;

  // 2) Prepare county data (static)
  const dataCounties = counties.map(d => ({ geometry: d }));

  // 3) Prepare state data (progressive)
  const stateValues = {
    "California":250, "Texas":230, "New York":185, "Florida":170, "Illinois":165, "Ohio":90, "Michigan":80, 
    "Georgia":80, "North Carolina":50, "Pennsylvania":135, "Tennessee":25
  };
  const dataStates = states.map(d => ({
    geometry: d,
    value: stateValues[d.properties.name] !== undefined ? stateValues[d.properties.name] : 10,
    name: d.properties.name
  }));

  // 4) Combined spec
  const spec = {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        width: 800,
        height: 500,
        projection: { type: 'albersUsa' },

        // -- Provega extension (NEW grammar) --
        provega: {
          progression: {
            // from data.chunking
            chunking: {
              type: 'data',
              reading: {
                method: 'sequential',
                ascending: true,
                chunk_size: 1,
                frequency: 300
              }
            },

            // from progressive.execution
            control: {
              mode: 'exploration',
              pause: true,
              stop: true,
              backward: true,
              min_frequency: 300,
              min_rendering_frequency: null
            },

            // da process + change + quality + visual_representation.noise_reduction
            monitoring: {
              aliveness: true,
              etc: 'eta_ms',
              progressbar: true,
              change: {
                mark: {
                  active: true,
                  blink: true,
                  blinkInterval: 200,
                  blinkDuration: 800,
                  style: { color: '#d62728' }
                },
                noise_reduction: false
              },
              quality: {
                absolute_progress: {
                  on_data_input: true,
                  on_result_output: true,
                  on_visual_output: true
                },
                relative_progress: {
                  on_data_input: true,
                  on_result_output: true,
                  on_visual_output: true
                }
              }
            }
          },
        },

        // ── Data ora solo raw values ──
        data: {
          format: { type: 'json' },
          values: dataStates
        },

        layer: [
          // 1) Stati (progressivi)
          {
            mark: { type: 'geoshape', stroke: 'white', strokeWidth: 0.8 },
            encoding: {
              shape: { field: 'geometry', type: 'geojson' },
              color: {
                field: 'value', type: 'quantitative',
                scale: {
                  domain: [0, 127.5, 255],
                  range: ['#C8D7F8', '#738AB5', '#001331']
                },
                legend: { title: 'Value' }
              },
              tooltip: [
                { field: 'name', type: 'nominal', title: 'State' },
                { field: 'value', type: 'quantitative', title: 'Value' }
              ]
            }
          },
          // 2) Contee (sempre on top, contorno grigio)
          {
            data: { values: dataCounties, format: { type: 'json' } },
            mark: { type: 'geoshape', fill: 'none', stroke: '#ffffff', strokeWidth: 0.3 },
            encoding: {
              shape: { field: 'geometry', type: 'geojson' }
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

window.getChoro = getChoro;

if (!window.expectedBooleans){
    window.expectedBooleans = [
        "provega.progression.chunking.reading.ascending",

        "provega.progression.monitoring.aliveness",

        "provega.progression.monitoring.change.mark",
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
