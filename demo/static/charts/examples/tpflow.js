async function getTpFlow(){
    const geoDE = "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/2_bundeslaender/3_mittel.geo.json";
        const topoDE = await fetch(geoDE).then(r => r.json());
        const centroidsDE = {};
        topoDE.features.forEach(f => {
            const region = f.properties.NAME_1 || f.properties.name;
            centroidsDE[region] = d3.geoCentroid(f);
        });
        const regions = Object.keys(centroidsDE);

        const fillMap = {
            "Schleswig-Holstein": "#fae6f5", "Hamburg": "#fae6f5",
            "Bremen": "#fae6f5", "Saarland": "#fae6f5",
            "Berlin": "#fae6f5", "Brandenburg": "#fae6f5",
            "Mecklenburg-Vorpommern": "#fae6f5", "Sachsen": "#fae6f5",
            "Sachsen-Anhalt": "#fae6f5",
            "Niedersachsen": "#e6e7fb",
            "Nordrhein-Westfalen": "#f8e7c7",
            "Hessen": "#eaf7ee", "Rheinland-Pfalz": "#eaf7ee",
            "Baden-Württemberg": "#eaf7ee", "Bayern": "#eaf7ee",
            "Thüringen": "#fae6f5"
        };
        const strokeMap = {
            "Schleswig-Holstein": "#DB90BA", "Hamburg": "#DB90BA",
            "Bremen": "#DB90BA", "Saarland": "#DB90BA",
            "Berlin": "#DB90BA", "Brandenburg": "#DB90BA",
            "Mecklenburg-Vorpommern": "#DB90BA", "Sachsen": "#DB90BA",
            "Sachsen-Anhalt": "#DB90BA",
            "Niedersachsen": "#8E9BBA",
            "Nordrhein-Westfalen": "#F58866",
            "Hessen": "#68B09B", "Rheinland-Pfalz": "#68B09B",
            "Baden-Württemberg": "#68B09B", "Bayern": "#68B09B",
            "Thüringen": "#DB90BA"
        };

        const bubData = regions.map(region => {
            const [lon, lat] = centroidsDE[region];
            return {
                region,
                lon,
                lat,
                value: Math.random() * 500 + 50,
                fillColor: fillMap[region],
                strokeColor: strokeMap[region]
            };
        });
        const maxValue = Math.max(...bubData.map(d => d.value));
        const minValue = Math.min(...bubData.map(d => d.value));

        const geoEU = "https://raw.githubusercontent.com/leakyMirror/map-of-europe/master/GeoJSON/europe.geojson";
        const geoSubEU = "static/data/nuts.geojson";
        const topoEU = await fetch(geoEU).then(r => r.json());
        const labelData = topoEU.features.map(f => {
            const country = f.properties.NAME || f.properties.name || f.properties.NAME_0;
            const [lon, lat] = d3.geoCentroid(f);
        return { country, lon, lat };
    });

    const cities = [
        { city: "Amsterdam", lon: 4.9041, lat: 52.3676 },
        { city: "Brussels", lon: 4.3517, lat: 50.8503 },
        { city: "Strasbourg", lon: 7.7521, lat: 48.5734 },
        { city: "Wroclaw", lon: 17.0385, lat: 51.1079 },
        { city: "Prague", lon: 14.4378, lat: 50.0755 },
        { city: "Vienna", lon: 16.3738, lat: 48.2082 },
        { city: "Munich", lon: 11.5820, lat: 48.1351 },
        { city: "Luxembourg", lon: 6.1296, lat: 49.6116 }
    ];

    const spec = {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        width: 800,
        height: 600,
        projection: { type: "mercator", center: [10.5, 51.3], scale: 2000 },

        // ── New Provega extension ──
        provega: {
          progression: {
            // from data.chunking
            chunking: {
              type: "data",
              reading: {
                method: "sequential",
                ascending: true,
                chunk_size: 1,
                frequency: 500
              }
            },
            // from progressive.execution + progressive.rendering
            control: {
              mode: "exploration",
              pause: true,
              stop: true,
              backward: true,
              min_frequency: 500,
              min_rendering_frequency: null
            },
            // from progressive.process + progressive.visual_representation + progressive.change + progressive.quality
            monitoring: {
              aliveness: true,
              etc: "eta_ms",
              progressbar: true,          
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

        // ── Data block now only carries raw values ──
        data: {
          values: bubData,
          format: { type: "json" }
        },

        layer: [
          {
            data: { url: geoEU, format: { type: "json" } },
            mark: { type: "geoshape", fill: "#F2F2F2", stroke: "#A5A5A5", strokeWidth: 2 }
          },
          {
            data: { url: geoSubEU, format: { type: "json" } },
            mark: { type: "geoshape", fill: null, stroke: "#888888", strokeWidth: 0.15, opacity: 1 }
          },
          {
            data: { values: topoDE.features },
            transform: [
              {
                calculate: "datum.properties.NAME_1 || datum.properties.name",
                as: "region"
              }
            ],
            mark: { type: "geoshape", strokeWidth: 2, opacity: 0.6 },
            encoding: {
              fill: {
                field: "region",
                type: "nominal",
                scale: { domain: regions, range: regions.map(r => fillMap[r]) }
              },
              stroke: {
                field: "region",
                type: "nominal",
                scale: { domain: regions, range: regions.map(r => strokeMap[r]) }
              }
            }
          },
          {
            data: { values: labelData },
            mark: {
              type: "text",
              align: "center",
              baseline: "middle",
              fontSize: 10,
              fontWeight: "bold",
              dy: -5,
              color: "#888888",
              opacity: 1
            },
            encoding: {
              longitude: { field: "lon", type: "quantitative" },
              latitude: { field: "lat", type: "quantitative" },
              text: { field: "country", type: "nominal" }
            }
          },
          {
            data: { values: cities },
            mark: {
              type: "text",
              align: "left",
              baseline: "bottom",
              fontSize: 12,
              fontWeight: "bold",
              dx: 4,
              dy: -2,
              color: "#888888",
              opacity: 1
            },
            encoding: {
              longitude: { field: "lon", type: "quantitative" },
              latitude: { field: "lat", type: "quantitative" },
              text: { field: "city", type: "nominal" }
            }
          },
          {
            // progressiveData is now implicit—your loader will bind to this first data block
            mark: { type: "circle", opacity: 1, strokeWidth: 3 },
            encoding: {
              longitude: { field: "lon", type: "quantitative" },
              latitude: { field: "lat", type: "quantitative" },
              size: {
                field: "value",
                type: "quantitative",
                scale: { domain: [minValue, maxValue], range: [300, 1500] }
              },
              color: {
                field: "region",
                type: "nominal",
                scale: { domain: regions, range: regions.map(r => fillMap[r]) },
                legend: { title: "Regione" }
              },
              stroke: { field: "strokeColor", type: "nominal", scale: null },
              fill: { field: "strokeColor", type: "nominal", scale: null }
            }
          },
          {
            transform: [{ calculate: "datum.value * 0.6", as: "innerValue" }],
            mark: { type: "circle", fill: "#BEB5BA", opacity: 1, stroke: "#000000", strokeWidth: 0.15 },
            encoding: {
              longitude: { field: "lon", type: "quantitative" },
              latitude: { field: "lat", type: "quantitative" },
              size: {
                field: "innerValue",
                type: "quantitative",
                scale: { domain: [minValue * 0.6, maxValue * 0.6], range: [300, 1500] }
              }
            }
          }
        ],

        config: { view: { stroke: "transparent" }, background: "#D0D0D0" }
      };


        return spec;
    }

window.getTpFlow = getTpFlow;
