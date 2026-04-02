import random

def get_spec():
    values = []
    for i in range(500):
        sl = round(3 + random.random() * 12, 2)
        sw = round(4 + random.random() * 12, 2)
        pl = round(2 + random.random() * 18, 2)
        pw = round(4 + random.random() * 14, 2)
        sepal_area = round(0.1 * (sl * sw), 2)

        values.append({
            "id": i,
            "sepalLength": sl,
            "sepalWidth": sw,
            "petalLength": pl,
            "petalWidth": pw,
            "sepalArea": sepal_area
        })

    spec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "width": 1000,
        "height": 450,
        "padding": {"left": 60, "bottom": 60},

        "provega": {
            "progression": {
                "chunking": {
                    "type": "data",
                    "reading": {
                        "method": "sequential",
                        "ascending": False,
                        "chunk_size": 50,
                        "frequency": 1000
                    }
                },
                "control": {
                    "mode": "monitoring",
                    "pause": False,
                    "stop": False,
                    "backward": False,
                    "min_rendering_frequency": None
                },
                "monitoring": {
                    "aliveness": False,
                    "etc": "",
                    "progressbar": True,
                    "change": {
                        "noise_reduction": False
                    },
                    "quality": {
                        "absolute_progress": {
                            "on_data_input": False,
                            "on_result_output": False,
                            "on_visual_output": False
                        },
                        "relative_progress": {
                            "on_data_input": False,
                            "on_result_output": False,
                            "on_visual_output": False
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

        "data": {
            "format": {"type": "json"},
            "values": values
        },

        "transform": [
            {
                "fold": ["sepalLength", "sepalWidth", "petalLength", "petalWidth", "sepalArea"],
                "as": ["key", "value"]
            }
        ],

        "layer": [
            {
                "mark": {
                    "type": "line",
                    "strokeWidth": 1,
                    "color": "#4E5A89",
                    "opacity": 0.5
                },
                "encoding": {
                    "x": {"field": "key", "type": "ordinal", "axis": None},
                    "y": {
                        "field": "value",
                        "type": "quantitative",
                        "axis": {
                            "title": None,
                            "grid": False,
                            "domain": True,
                            "ticks": True,
                            "labels": True
                        }
                    },
                    "detail": {"field": "id"}
                }
            },
            {
                "mark": {
                    "type": "rule",
                    "color": "black",
                    "strokeWidth": 1
                },
                "encoding": {
                    "x": {
                        "field": "key",
                        "type": "ordinal",
                        "axis": {
                            "title": None,
                            "domain": True,
                            "ticks": False,
                            "labels": True,
                            "grid": False,
                            "labelAngle": 0,
                            "labelPadding": 10
                        }
                    },
                    "y": {"value": 0},
                    "y2": {"value": 450}
                }
            }
        ],

        "config": {
            "background": "#f5f5f5",
            "view": {"stroke": "transparent"}
        }
    }

    return spec
