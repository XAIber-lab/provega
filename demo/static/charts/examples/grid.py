def get_spec():
    # 1) Initial matrix
    initial = [
        [250, 200, 100, 0,   250, 150,  50,   0, 200, 100],
        [100, 150, 205, 50,    0, 150,   0, 150, 205, 150],
        [150, 100, 100, 150,  50,  25, 150, 100,   0,  50],
        [0,   100, 150,  50,   0,  50, 205,   0,  50, 225],
        [15,  225, 100,   0, 250,  20, 100, 250,  50, 100],
        [250,   0, 250,  50, 100, 150,   0, 100, 150,   0],
        [50,  150,  50, 100, 100,  50, 250, 100, 200, 250],
        [150,  50, 200,   0, 150,   0, 200, 150,  40, 150],
        [50,   25,  50, 220,  50, 150,  50, 200,   0,  50],
        [0,   100,   0,  35, 100,  50,  35,  50, 250, 150],
        [36,  205,   0,  50, 205,   0, 100,   0, 220, 100],
        [200, 150,  50, 205,   0,  50, 150, 100,   0, 200]
    ]

    # 2) Flatten into a list of dicts
    data = []
    for r, row in enumerate(initial):
        for c, val in enumerate(row):
            data.append({
                "row": r,
                "col": c,
                "value": val
            })

    # 3) Define the Vega-Lite spec
    spec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "width": 600,
        "height": 600,

        # -- Provega extension (NEW grammar) --
        "provega": {
            "progression": {
                # from data.chunking
                "chunking": {
                    "type": "data",
                    "reading": {
                        "method": "sequential",
                        "ascending": True,
                        "chunk_size": 1,
                        "frequency": 100
                    }
                },

                # from progressive.execution
                "control": {
                    "mode": "exploration",
                    "pause": True,
                    "stop": True,
                    "backward": True,
                    "min_frequency": 500,
                    "min_rendering_frequency": None
                },

                # from process + quality + visual_representation.noise_reduction
                "monitoring": {
                    "aliveness": True,
                    "etc": "eta_ms",
                    "progressbar": True,
                    "change": {
                        # nessun change specificato → default inactive
                        "noise_reduction": False
                    },
                    "uncertainty": {
                        "active": True,
                        "variable": "uncertainty",
                        "domain": [0, 1],
                        "percentage": True,
                        "show_label": True,
                        "show_max": True,
                        "label": "Process Uncertainty",
                        "style": {
                            "label": {
                                "color": "#333",
                                "fontSize": 12,
                                "fontFamily": "Arial",
                                "fontWeight": "bold"
                            },
                            "value": {
                                "color": "#d62728",
                                "fontSize": 14,
                                "fontFamily": "Arial"
                            }
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

        # ── Data block solo raw values ──
        "data": {
            "format": { "type": "json" },
            "values": data
        },

        "mark": {
            "type": "rect",
            "stroke": "black",
            "strokeWidth": 2
        },

        "encoding": {
            "x": {
                "field": "col",
                "type": "ordinal",
                "axis": {
                    "title": None,
                    "domain": False,
                    "ticks": False,
                    "labels": False
                }
            },
            "y": {
                "field": "row",
                "type": "ordinal",
                "axis": {
                    "title": None,
                    "domain": False,
                    "ticks": False,
                    "labels": False
                }
            },
            "color": {
                "field": "value",
                "type": "quantitative",
                "scale": {
                    "domain": [0, 50, 100, 150, 200, 250],
                    "range": ["#C3E3FE", "#5AB0FE", "#00B4F5", "#004FEE", "#0071C0", "#001727"]
                },
                "legend": { "title": "Value" }
            }
        },

        "config": {
            "view": { "stroke": "transparent" },
            "background": "#f5f5f5",
            "axis": {
                "labelFont": "Arial",
                "labelFontSize": 12
            }
        }
    }

    return spec
