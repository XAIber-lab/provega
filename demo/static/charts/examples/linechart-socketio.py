spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "width": 1200,

    "datasets": {
        "progressiveData": []
    },

    "data": {
        "url": "ws://localhost:3000",
        "format": {"type": "json"}
    },

    "provega": {
        "progression": {
            "chunking": {
                "type": "data",
                "reading": {
                    "method": "sequential",
                    "ascending": True,
                    "chunk_size": 1,
                    "frequency": 500,
                    "seed": 0
                }
            },
            "control": {
                "mode": "exploration",
                "pause": True,
                "stop": True,
                "backward": True,
                "min_frequency": 500,
                "min_rendering_frequency": None
            },
            "monitoring": {
                "progressbar": True,
                "change": {
                    "mark": False,
                    "noise_reduction": False
                },
            }
        },
    },

    "layer": [
        {
            "mark": {"type": "line", "point": False, "strokeWidth": 2, "opacity": 0.8},
            "encoding": {
                "x": {"field": "x", "type": "quantitative", "title": "Time"},
                "y": {"field": "y", "type": "quantitative", "title": "Value"},
                "color": {
                    "field": "clusterID", "type": "nominal",
                    "scale": {
                        "domain": ["Cluster-0", "Cluster-1", "Cluster-2"],
                        "range": ["green", "orange", "darkmagenta"]
                    },
                    "legend": {"orient": "top"}
                },
                "detail": {"field": "category", "type": "nominal"}
            }
        },
        {
            "transform": [
                {"calculate": "indexof([2,5,7], datum.x) !== -1", "as": "isChange"}
            ],
            "mark": {"type": "rule", "color": "teal", "strokeDash": [4, 2]},
            "encoding": {
                "x": {"field": "x", "type": "quantitative"},
                "opacity": {
                    "condition": {"test": "datum.isChange", "value": 1},
                    "value": 0
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

def get_spec():
    return spec