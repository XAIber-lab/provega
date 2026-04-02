import random
import math

def get_spec():
    N = 15
    E = 25
    MIN_DIST = 40
    matched_index = random.randint(0, N - 1)

    labels = [
        "SEA‑LAND SERVICE, INC., Appellant",
        "COLUMBIA STEAMSHIP COMPANY",
        "Robert LEONARD et al., Plaintiffs‑",
        "THE UNITED STATES, APPELLANTS",
        "Thomas Wayne JOYCE, Appellant",
        "John FARLEY, Appellant, v. UNITED",
        "TEXAS, Petitioner v. Gregory Lee",
        "GRACE LINE, INC., Petitioner, v. F",
        "UNITED STATES of America",
        "Diane MONROE, Petitioner‑Appellant"
    ]

    # 1) Genera nodi
    nodes = []
    for i in range(N):
        cat = "Supreme Court" if random.random() < 0.4 else "Lower Federal Court"
        node = {
            "id": i,
            "x": random.uniform(50, 650),
            "y": random.uniform(50, 450),
            "doi": random.uniform(20, 100),
            "focus": i == 7,
            "matched": i == matched_index,
            "category": cat,
            "label": random.choice(labels)
        }
        nodes.append(node)

    # 2) Repulsione per evitare sovrapposizioni
    for _ in range(200):
        moved = False
        for i in range(N):
            for j in range(i + 1, N):
                a = nodes[i]
                b = nodes[j]
                dx = b["x"] - a["x"]
                dy = b["y"] - a["y"]
                dist = math.hypot(dx, dy)
                if dist < MIN_DIST:
                    shift = (MIN_DIST - dist) / 2
                    ux = dx / (dist or 1)
                    uy = dy / (dist or 1)
                    a["x"] -= ux * shift
                    a["y"] -= uy * shift
                    b["x"] += ux * shift
                    b["y"] += uy * shift
                    moved = True
        if not moved:
            break

    # 3) Genera link
    links = []
    for _ in range(E):
        a, b = random.sample(range(N), 2)
        links.append({
            "type": "link",
            "x1": nodes[a]["x"],
            "y1": nodes[a]["y"],
            "x2": nodes[b]["x"],
            "y2": nodes[b]["y"]
        })

    # 4) Unisce nodi e link
    data = [dict(n, type="node") for n in nodes] + links

    # 5) Spec Vega-Lite
    spec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "width": 800,
        "height": 500,
        "padding": {"top": 10, "right": 200},
        "title": {
            "text": "Context Graph (replica Fig. 3c) – Distanziato",
            "orient": "top",
            "fontSize": 16,
            "fontWeight": "normal",
            "anchor": "start",
            "dx": 10,
            "dy": -10,
            "color": "#555"
        },
        "provega": {
            "progression": {
                "chunking": {
                    "type": "data",
                    "reading": {
                        "method": "sequential",
                        "ascending": True,
                        "chunk_size": 5,
                        "frequency": 1000
                    }
                },
                "control": {
                    "mode": "exploration",
                    "pause": True,
                    "stop": True,
                    "backward": True,
                    "min_frequency": 1000,
                    "min_rendering_frequency": None
                },
                "monitoring": {
                    "aliveness": True,
                    "etc": "eta_ms",
                    "progressbar": True,
                    "change": {
                        "mark": {
                            "active": True,
                            "blink": False,
                            "style": {"color": "#d62728"}
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
                    },
                    "uncertainty": {
                        "active": True,
                        "variable": "uncertainty",
                        "domain": [0, 1],
                        "percentage": False,
                        "show_label": False,
                        "show_max": False
                    }
                }
            },
        },
        "data": {
            "values": data,
            "format": {"type": "json"}
        },
        "layer": [
            {
                "transform": [{"filter": "datum.type==='link'"}],
                "mark": {"type": "rule", "stroke": "#ccc", "strokeWidth": 1},
                "encoding": {
                    "x": {"field": "x1", "type": "quantitative", "axis": None},
                    "y": {"field": "y1", "type": "quantitative", "axis": None},
                    "x2": {"field": "x2"},
                    "y2": {"field": "y2"}
                }
            },
            {
                "transform": [{"filter": "datum.type==='node'"}],
                "mark": {"type": "point", "filled": True},
                "encoding": {
                    "x": {"field": "x", "type": "quantitative", "axis": None},
                    "y": {"field": "y", "type": "quantitative", "axis": None},
                    "size": {
                        "field": "doi",
                        "type": "quantitative",
                        "scale": {"range": [80, 400]},
                        "legend": None
                    },
                    "color": {
                        "field": "category",
                        "type": "nominal",
                        "scale": {
                            "domain": ["Supreme Court", "Lower Federal Court"],
                            "range": ["#747F6F", "#B9C192"]
                        },
                        "legend": {
                            "title": "Court",
                            "orient": "bottom-left",
                            "symbolType": "square",
                            "symbolSize": 200
                        }
                    },
                    "stroke": {
                        "condition": {"test": "datum.matched", "value": "steelblue"},
                        "value": None
                    },
                    "strokeWidth": {
                        "condition": {"test": "datum.matched", "value": 3},
                        "value": 0
                    }
                }
            },
            {
                "transform": [{"filter": "datum.type==='node'"}],
                "mark": {
                    "type": "text",
                    "align": "left",
                    "baseline": "middle",
                    "dx": 6,
                    "dy": -6,
                    "fontSize": 10,
                    "color": "#555"
                },
                "encoding": {
                    "x": {"field": "x", "type": "quantitative"},
                    "y": {"field": "y", "type": "quantitative"},
                    "text": {"field": "label", "type": "nominal"}
                }
            },
            {
                "transform": [
                    {"filter": "datum.type==='node'"},
                    {"filter": "datum.focus"}
                ],
                "mark": {
                    "type": "text",
                    "align": "left",
                    "baseline": "middle",
                    "dx": 8,
                    "dy": -18,
                    "fontSize": 12,
                    "fontWeight": "bold",
                    "color": "#555"
                },
                "encoding": {
                    "x": {"field": "x", "type": "quantitative"},
                    "y": {"field": "y", "type": "quantitative"},
                    "text": {"value": "Focus"}
                }
            }
        ],
        "config": {
            "background": "#f5f5f5"
        }
    }
    return spec
