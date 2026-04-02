import random
import math

categories = ['A', 'B', 'C', 'D']
history_length = 10

data = [{"category": c, "values": [], "history": []} for c in categories]

def get_mean(arr):
    return sum(arr) / len(arr)

def get_ci(arr):
    if len(arr) < 2:
        return 0
    m = get_mean(arr)
    sd = math.sqrt(sum((x - m) ** 2 for x in arr) / len(arr))
    return 1.96 * (sd / math.sqrt(len(arr)))

def update_data_for_category(cat):
    if cat == 'A':
        base, sd = 75, 7
    else:
        base, sd = 57.5, 10

    u1, u2 = random.random(), random.random()
    val = base + math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2) * sd

    min0 = 70 if cat == 'A' else 50
    max0 = 80 if cat == 'A' else 65

    d = next(d for d in data if d['category'] == cat)
    if len(d["values"]) == 0:
        val = min0 + random.random() * (max0 - min0)

    d["values"].append(val)
    ci = get_ci(d["values"])
    if len(d["values"]) == 1:
        ci = 5  # minimo visibile
    ci *= 4.5  # amplifica

    d["history"].append({
        "mean": get_mean(d["values"]),
        "ci": ci
    })

    if len(d["history"]) > history_length:
        d["history"].pop(0)

def get_history_data():
    history_data = []
    for d in data:
        for i, h in enumerate(d["history"]):
            half_width = max(0.01 * h["mean"], 1) if h["ci"] == 0 else h["ci"] / 2
            history_data.append({
                "category": d["category"],
                "mean": h["mean"],
                "ci_lower": h["mean"] - half_width,
                "ci_upper": h["mean"] + half_width,
                "step": i
            })
    return history_data

# Generate data
for cat in categories:
    for _ in range(history_length):
        update_data_for_category(cat)

raw = get_history_data()
raw.sort(key=lambda d: (d["step"], categories.index(d["category"])))

# Vega-Lite spec
def get_spec(): 
    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "width": 800,
        "height": 300,
        "padding": { "top": 20, "left": 60, "right": 20, "bottom": 20 },

        # -- Provega extension (NEW version) --
        "provega": {
            "progression": {
                # from data.chunking
                "chunking": {
                    "type": "data",
                    "reading": {
                        "method": "sequential",
                        "chunk_size": 1,
                        "frequency": 500
                        # ascending: default true
                        # seed: default 0
                    }
                },

                # from progressive.execution + rendering.min_frequency
                "control": {
                    "mode": "exploration",
                    "pause": True,
                    "stop": True,
                    "backward": True,
                    "min_frequency": 200,
                    "min_rendering_frequency": None
                },

                # da process + change + quality + visual_representation.noise_reduction
                "monitoring": {
                    "aliveness": True,
                    "etc": "eta_ms",
                    "progressbar": True,  # default true
                    "change": {
                        # mark di cambio
                        "mark": {
                            "active": True,
                            "blink": False,
                            "style": {
                                "color": "#f00"
                            }
                        },
                        "noise_reduction": False
                    },
                    "quality": {
                        "absolute_progress": {
                            "on_data_input": "abs_in",
                            "on_result_output": "abs_out",
                            "on_visual_output": "abs_vis"
                        },
                        "relative_progress": {
                            "on_data_input": "rel_in",
                            "on_result_output": "rel_out",
                            "on_visual_output": "rel_vis"
                        },
                        "relative_stability": {
                            "on_data_input": "stab_in",
                            "on_result_output": "stab_out",
                            "on_visual_output": "stab_vis"
                        },
                        "absolute_certainty": {
                            "on_result_output": "cert_out"
                        }
                    }
                }
            },
        },

        # ── Data: ora solo raw values ──
        "data": {
            "values": raw,
            "format": { "type": "json" }
        },

        "title": "History + CI",

        "layer": [
            {
                "mark": {
                    "type": "bar",
                    "stroke": "black",
                    "strokeWidth": 0.2
                },
                "encoding": {
                    "x": { "field": "category", "type": "ordinal" },
                    "xOffset": { "field": "step", "type": "ordinal" },
                    "y": { "field": "mean", "type": "quantitative", "title": "Mean Value" },
                    "color": {
                        "field": "category",
                        "type": "nominal",
                        "scale": {
                            "domain": categories,
                            "range": ["#8F80FF", "#57BA2A", "#FFB850", "#006092"]
                        }
                    },
                    "opacity": {
                        "field": "step",
                        "type": "quantitative",
                        "scale": {
                            "domain": [0, history_length - 1],
                            "range": [0.3, 1]
                        }
                    }
                }
            },
            {
                "mark": {
                    "type": "rule",
                    "color": "red",
                    "strokeWidth": 6
                },
                "encoding": {
                    "x": { "field": "category", "type": "ordinal" },
                    "xOffset": { "field": "step", "type": "ordinal" },
                    "y": { "field": "ci_lower", "type": "quantitative" },
                    "y2": { "field": "ci_upper" }
                }
            }
        ],

        "config": {
            "background": "#f5f5f5",
            "axis": {
                "labelFont": "Arial",
                "labelFontSize": 14
            }
        }
    }
