def get_spec():
    return {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "width": 400,
    "height": 400,

    # -- input data --
    "data": {
        "values": [
            {"category": "Arizona", "count": 5.10},
            {"category": "Florida", "count": 8.19},
            {"category": "Georgia", "count": 4.80},
            {"category": "Illinois", "count": 5.93},
            {"category": "Michigan", "count": 5.08},
            {"category": "New York", "count": 4.80},
            {"category": "Ohio", "count": 4.52},
            {"category": "Tennessee", "count": 4.80},
            {"category": "Texas", "count": 12.43},
            {"category": "Other", "count": 44.35}
        ]
    },

    # -- progressive control section (new) --
    "provega": {
        "progression": {
            "chunking": {
                "type": "data",
                "reading": {
                    "method": "sequential",
                    "ascending": True,
                    "chunk_size": 1,
                    "frequency": 800,
                    "seed": 0
                }
            },
            "control": {
                "mode": "exploration",
                "pause": True,
                "stop": True,
                "backward": True,
                "min_frequency": 800,
                "min_rendering_frequency": None
            },
            "monitoring": {
                "aliveness": True,
                "etc": "eta_ms",
                "progressbar": True,
                "change": {
                    "mark": False,
                    "noise_reduction": True
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

    # ── trasformazioni intermedie ──
    "transform": [
        {"window": [{"op": "sum", "field": "count", "as": "total"}]},
        {"calculate": "datum.count / datum.total", "as": "percent"}
    ],

    # ── layers grafici ──
    "layer": [
        {
            "mark": {"type": "arc", "outerRadius": 120},
            "encoding": {
                "theta": {"field": "count", "type": "quantitative"},
                "color": {
                    "field": "category",
                    "type": "nominal",
                    "scale": {
                        "domain": [
                            "Arizona", "Florida", "Georgia", "Illinois", "Michigan",
                            "New York", "Ohio", "Tennessee", "Texas", "Other"
                        ],
                        "range": [
                            "#2A77E1", "#FCC062", "#E46034", "#3E5B81", "#BEBFC2",
                            "#1A3B65", "#FDE383", "#1E98D1", "#CC6C4B", "#005CDB"
                        ]
                    }
                },
                "opacity": {"value": 1}
            }
        }
    ],

    # ── tooltip ──
    "encoding": {
        "tooltip": [
            {"field": "category", "type": "nominal", "title": "State"},
            {"field": "percent", "type": "quantitative", "title": "Percentage", "format": ".1%"}
        ]
    },

    # ── configurazioni grafiche aggiuntive ──
    "config": {
        "background": "#ffffff"
    }
}

