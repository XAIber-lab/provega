import random
import math

def get_spec():
    N = 60  # punti nel tempo

    # Definisce due segmenti di spike estesi per Cluster 2
    green_spikes = []
    while len(green_spikes) < 2:
        start = random.randint(0, N - 6)
        green_spikes.append({ "start": start, "end": start + 5 })

    # 1) Serie madri per ogni cluster
    mother_series = {
        "Cluster 1": [],
        "Cluster 2": [],
        "Cluster 3": []
    }

    for x in range(N):
        # Cluster 1: rumore basso 0–5
        mother_series["Cluster 1"].append(round(random.uniform(0, 2), 1))

        # Cluster 2: spike estesi, altrimenti rumore 0–60
        y2 = round(random.uniform(0, 60), 1)
        for seg in green_spikes:
            if seg["start"] <= x < seg["end"]:
                y2 = round(50 + random.uniform(0, 100), 1)
                break
        mother_series["Cluster 2"].append(y2)

        # Cluster 3: spike iniziale (x<3), poi stabile tra 20–60
        y3 = round(random.uniform(60, 100), 1) if x < 3 else round(random.uniform(20, 60), 1)
        mother_series["Cluster 3"].append(y3)

    # 2) Genera varianti
    values = []
    for x in range(N):
        for cluster in ["Cluster 1", "Cluster 2", "Cluster 3"]:
            base_y = mother_series[cluster][x]
            count = 30 if cluster == "Cluster 1" else 20

            for v in range(1, count + 1):
                # Rumore gaussiano tramite Box-Muller modificato
                u1 = random.random()
                u2 = random.random()
                z = math.sqrt(-3 * math.log(u1)) * math.cos(8 * math.pi * u2)
                sd = 2 if cluster == "Cluster 1" else 10
                y_var = round(base_y + z * sd, 1)
                if y_var < 0:
                    y_var = 0
                values.append({
                    "x": x,
                    "y": y_var,
                    "series": f"{cluster} Variant {v}",
                    "cluster": cluster
                })

    # 3) Create Vega-Lite spec
    spec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "width": 1000,
        "height": 300,
        "padding": { "left": 50 },

        # -- Provega extension (NEW version) --
        "provega": {
            "progression": {
                "chunking": {
                    "type": "data",
                    "reading": {
                        "method": "sequential",
                        "ascending": True,
                        "chunk_size": 50,
                        "frequency": 300
                        # seed omitted (default 0)
                    }
                },
                "control": {
                    "mode": "exploration",
                    "pause": True,
                    "stop": True,
                    "backward": True,
                    "min_frequency": 300,
                    "min_rendering_frequency": None
                },
                "monitoring": {
                    "aliveness": True,
                    "etc": "eta_ms",
                    "progressbar": True,
                    "change": {
                        "mark": {
                            "active": False,
                            "blink": False
                        },
                        "noise_reduction": False
                    },
                    "quality": {
                        "absolute_progress": {
                            "on_data_input": True,
                            "on_result_output": True,
                            "on_visual_output": True
                        },
                        "relative_progress": {
                            "on_data_input": True,
                            "on_result_output": True,
                            "on_visual_output": True
                        },
                        "relative_stability": {
                            "on_data_input": False,
                            "on_result_output": False,
                            "on_visual_output": False
                        },
                        "absolute_certainty": {
                            "on_result_output": False
                        }
                    }
                }
            },
        },

        # ── Data ora solo raw values ──
        "data": {
            "values": values,
            "format": { "type": "json" }
        },

        "layer": [
            {
                "mark": {
                    "type": "line",
                    "point": False,
                    "strokeWidth": 0.9
                },
                "encoding": {
                    "x": {
                        "field": "x",
                        "type": "quantitative",
                        "title": "Time"
                    },
                    "y": {
                        "field": "y",
                        "type": "quantitative",
                        "title": "Value"
                    },
                    "detail": { "field": "series" },
                    "color": {
                        "field": "cluster",
                        "type": "nominal",
                        "scale": {
                            "domain": ["Cluster 1", "Cluster 2", "Cluster 3"],
                            "range": ["#AA769E", "green", "darkorange"]
                        },
                        "legend": { "orient": "top" }
                    },
                    "opacity": {
                        "condition": {
                            "test": "datum.cluster === 'Cluster 2'",
                            "value": 0.2
                        },
                        "value": 0.6
                    }
                }
            }
        ],

        "config": {
            "background": "#ffffff",
            "axis": {
                "labelFont": "Arial",
                "labelFontSize": 12,
                "titleFontSize": 14
            }
        }
    }

    return spec
