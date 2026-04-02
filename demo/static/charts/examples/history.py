import random
from datetime import datetime, timedelta

def generate_synthetic_data(start_time: str, end_time: str, interval_minutes: int = 5):
    data = []
    confidences = [1, 2, 3, 4, 5]

    start = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
    end = datetime.fromisoformat(end_time.replace('Z', '+00:00'))

    current = start
    while current <= end:
        iso_time = current.isoformat()
        count = random.randint(5, 14)
        for _ in range(count):
            conf = random.choice(confidences)
            data.append({
                "time": iso_time,
                "confidence": conf
            })
        current += timedelta(minutes=interval_minutes)

    return data


def get_spec():
    synthetic_data = generate_synthetic_data(
        "2025-04-29T06:00:00Z", "2025-04-29T08:20:00Z"
    )

    spec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "description": "Live timeline with stacked bar segments representing classifier confidence",
        "width": 650,
        "height": 300,
        "padding": { "bottom": 60, "left": 20 },

        "provega": {
            "progression": {
                "chunking": {
                    "type": "data",
                    "reading": {
                        "method": "sequential",
                        "ascending": True,
                        "chunk_size": 2,
                        "frequency": 500
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
                    "aliveness": True,
                    "etc": "eta_ms",
                    "progressbar": True,
                    "change": {
                        "mark": {
                            "active": True,
                            "blink": True
                        }
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

        "data": {
            "values": generate_synthetic_data("2025-04-29T06:00:00Z", "2025-04-29T08:20:00Z"),
            "format": { "type": "json" }
        },

        "transform": [
            { "calculate": "datum.confidence === 1 ? 0.1 : 1", "as": "wt" }
        ],

        "mark": {
            "type": "bar",
            "tooltip": True,
            "width": 15
        },

        "encoding": {
            "x": {
                "field": "time",
                "type": "temporal",
                "title": "Time",
                "axis": {
                    "format": "%H:%M",
                    "labelAngle": -45,
                    "grid": False
                }
            },
            "y": {
                "aggregate": "sum",
                "field": "wt",
                "type": "quantitative",
                "title": "counts",
                "stack": "zero"
            },
            "color": {
                "field": "confidence",
                "type": "ordinal",
                "scale": {
                    "domain": [1, 2, 3, 4, 5, 6, 7, 8, 9],
                    "range": [
                        "#8B0000", "#FDB061", "#FEE18C", "#FFFFC0",
                        "#DAF08D", "#A8DA6A", "#66BE63", "#12994F", "#006834"
                    ]
                },
                "sort": "descending",
                "legend": {
                    "title": "Confidence",
                    "orient": "top"
                }
            }
        },

        "config": {
            "background": "#f7f7f7",
            "view": { "stroke": None },
            "axis": {
                "labelFont": "Arial",
                "labelFontSize": 12,
                "titleFontSize": 14,
                "gridColor": "#dddddd"
            }
        }
    }

    return spec

