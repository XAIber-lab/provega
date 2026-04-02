import random
import math

# helper: circular random
def rand_circle(r):
    """
    Generate random coordinates inside a circle of radius r.
    """
    theta = random.random() * 2 * math.pi
    # Math.sqrt(Math.random()) for a more uniform distribution inside the circle
    return [math.cos(theta) * math.sqrt(random.random()) * r,
            math.sin(theta) * math.sqrt(random.random()) * r]

# generate two clusters of points
points = []
cluster_ids = ['Cluster-0', 'Cluster-1']

for i, cluster_id in enumerate(cluster_ids):
    cx = 89 + 20 * i  # cluster x center
    cy = 50           # cluster y center
    for _ in range(800):
        dx, dy = rand_circle(30)
        points.append({
            'x': cx + dx + (random.random() - 0.5) * 5,
            'y': cy + dy + (random.random() - 0.5) * 5,
            'cluster': cluster_id
        })

spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "width": 800,
    "height": 600,
    "padding": { "left": 60, "top": 30, "bottom": 30 },

    # ── Estensione Provega ──
    "provega": {
        "progression": {
            # da data.chunking
            "chunking": {
                "type": "data",
                "reading": {
                    "method": "sequential",
                    "ascending": True,
                    "chunk_size": 20,
                    "frequency": 100,
                    "seed": 42
                }
            },
            # da progressive.execution + progressive.rendering
            "control": {
                "mode": "exploration",
                "pause": True,
                "stop": True,
                "backward": True,
                "min_frequency": 200,
                "min_rendering_frequency": None
            },
            # da progressive.process + progressive.change + progressive.quality + visual_representation.noise_reduction
            "monitoring": {
                "aliveness": True,
                "etc": 'eta_ms',
                "progressbar": True,
                "change": {
                    "mark": {
                        "active": False,
                        "blink": False,
                        "style": { "color": "#f00" }
                    }
                },
                "quality": {
                    "absolute_progress": {
                        "on_data_input": 'abs_in',
                        "on_result_output": 'abs_out',
                        "on_visual_output": 'abs_vis'
                    },
                    "relative_progress": {
                        "on_data_input": 'rel_in',
                        "on_result_output": 'rel_out',
                        "on_visual_output": 'rel_vis'
                    },
                    "relative_stability": {
                        "on_data_input": 'stab_in',
                        "on_result_output": 'stab_out',
                        "on_visual_output": 'stab_vis'
                    },
                    "absolute_certainty": {
                        "on_result_output": 'cert_out'
                    }
                }
            }
        },
    },

    # -- Data block now contains only raw values --
    "data": {
        "values": points,
        "format": { "type": "json" }
    },

    "layer": [
        {
            "mark": { "type": "point", "filled": True, "size": 40, "opacity": 0.6 },
            "encoding": {
                "x": { "field": "x", "type": "quantitative", "title": "X", "nice": False },
                "y": { "field": "y", "type": "quantitative", "title": "Y", "nice": False },
                "color": {
                    "field": "cluster",
                    "type": "nominal",
                    "title": "Cluster",
                    "scale": {
                        "domain": ["Cluster-0", "Cluster-1"],
                        "range": ["#5F796C", "#928192"]
                    }
                }
            }
        }
    ],

    "config": {
        "background": "#f5f5f5",
        "axis": { "labelFont": "Arial", "labelFontSize": 14 }
    }
}

def get_spec():
    return spec
