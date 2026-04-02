```javascript
{ 
  "provega": {
    "progression":{
      "chunking": {
        "type": "data | process | mixed", 
        "reading": { // Reading options. [RC8]
          "method": "sequential | random", // Reading method (sampling). Optional, default sequential. 
          "ascending": true, // Set to true to read in ascending order. Optional, default false.
          "chunk_size": 10, // Size of the chunk. Optional, default 10
          "frequency": 1000, // Frequency of reading in millisecond. Optional, default 1000.
          "seed": 0, // Seed for random sampling. Optional, default 0.
        }
      },
      "control": {
        "mode": "monitoring | exploration", // Shorthand property. If defined, when 'monitoring' all the rest is false by default (pause, stop, backward). If 'exploaration' all the rest is true. Optional, default 'monitoring'. [RB43]
        "pause": false, // Set to true allow pausing. Optional, default false. [RH3, RH6, RS19, RT36]
        "stop": false, // Set to true to allow stopping. Optional, default false. [RH6, RM28, RT36]
        "backward": false, // Set to true to allow backward execution. Optional, default false. [RH6, RT36]
        "min_frequency": 1000, // Min Frequency of result in millisecond. Optional. [RT32]
        "min_rendering_frequency": null, // Frequency of rendering in millisecond. Optional. By default the rendering update occurs when a new partial result arrives. If min_rendering_frequency is defined, the rendering occurs after min_rendering_frequency millisecond from the previous partial result. If multiple results arrived in the meanwhile, the rendering considers the last partial result. [RS17]
      }
      "monitoring": {
        "aliveness": true, // Set to true to show process aliveness with a spinner. Optional, default true. [RM21]
        "etc": "", // Variable name for the estimated time of completion. Optional, default null. It is possible to use a bool value: in that case the default variable to consider is 'metadata.etc'. [RT40]
        "progressbar": true, // Set to true to show the progress bar. Optional, default true. [RM22, RM23]
        "change": {
          "area": false, // If true, highlights the zone of change. Optional, default false. [RS18]
          "area": { //Alternativally, the zone of change can be defined as an object, specifying the style.
            "active": true, // Set to true to allow zone of change. Optional, default false.
            "blink": false, // Set to true to allow blinking.
            "style": { // Custom style.
              "color": "#FF0000", // Color of the zone of change. Optional, default #FF0000.
              "opacity": 0.5, // Opacity of the zone of change. Optional, default 0.5. 
            }
          },
          "mark": false, // If true, highlights the marks that changed. Optional, default false. [RH2]
          "mark": { //Alternativally, the mark of change can be defined as an object, specifying the style.
            "active": true, // Set to true to allow mark of change. Optional, default false.
            "blink": false, // Set to true to allow blinking.
            "style": { // Custom style.
              "color": "#FF0000", // Color of the mark of change. Optional, default #FF0000.
              ... // All possible style properties of the mark.
            }
          }
          "noise_reduction": true, // Set to true to allow noise reduction of change. Optional, default true. [RF12]
        }
        "quality": {
          "absolute_progress": { // [RM22, RT40, RA46]
            "on_data_input": "", // Variable name for the absolute progress. Optional, default null. It is possible to use a bool value: in that case the default variable to consider is 'metadata.quality.absolute_progress.on_data_input'. 
            "on_result_output": "",
            "on_visual_output": ""
          },
          "relative_progress": { // [RM23, RT40, RA47]
            "on_data_input": "", // Variable name for the absolute progress. Optional, default null. It is possible to use a bool value: in that case the default variable to consider is 'metadata.quality.relative_progress.on_data_input'. 
            "on_result_output": "",
            "on_visual_output": ""
          },
          "relative_stability": { // [RA48]
            "on_data_input": "", // Variable name for the absolute progress. Optional, default null. It is possible to use a bool value: in that case the default variable to consider is 'metadata.quality.relative_stability.on_data_input'. 
            "on_result_output": "",
            "on_visual_output": ""
          },
          "absolute_certainty": { // [RA49]
            "on_result_output": "", // Variable name for the absolute progress. Optional, default null. It is possible to use a bool value: in that case the default variable to consider is 'metadata.quality.absolute_certainty.on_result_output'. 
          }
        }
      },
    },
    "visualization": {
      "visual_stability": false, // Set to true to allow visual stability. Optional, default false. [RF11] -- NON IMPLEMENTIAMO NIENTE
      "similarity_anchors": false, // Set to true to allow similarity anchors. Optional, default false. [RB44] -- NON IMPLEMENTIAMO NIENTE
    }
  }
}
```