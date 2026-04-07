# ProVega

ProVega is an enhanced version of Vega-Embed, a library for publishing Vega visualizations as embedded web components. This fork adds progressive visualization capabilities, enabling incremental data loading, progress bars, and interactive controls for better user experience with large datasets.

- Demonstrative video: [Video](https://github.com/user-attachments/assets/314ce19d-fce2-410c-89c3-027348b216a7)
- Grammar documentation: [Documentation](https://XAIber-lab.github.io/provega)


## The Pro-Ex Environment

To run the Pro-Ex Environment, follow these steps:

1. Navigate to the `demo` folder: `cd demo`
2. Install Python dependencies if needed (check for `requirements.txt` or similar)
3. Run the demo server: `python demo.py`
4. Open your browser and go to the provided URL (usually `http://localhost:5000` or similar) to interact with the progressive examples.

This will start a Flask server showcasing various progressive Vega visualizations with interactive controls.

### Progressive Examples

You can find all the progressive visualizations created with ProVega in the progressive-tests folder.
The 11 reimplemented exemplars from the PDAV literature in progressive-tests can be found in this folder, together with the process and mixed chunking examples.
You can try the ProgressiVis example in the progressivis-test folder.
The generative-ai folder contains the experiment mentioned in the paper with Codex 5.2.


---

## Installation

Run these commands in a Unix terminal (use Git Bash on Windows):

- `npm install` - Installs dependencies
- `npm run build` - Rebuilds the entire project (REQUIRED if there are changes in vega-embed to include)
- `npm run start` - Starts a local server for testing

## Styling

Always include `<link rel="stylesheet" href="progress.css">` to enable the styles for the new progressive functionalities: progress bar and control buttons for progressivity.


## Additional Notes

- CORS issues? No problem, launch the HTML file from VS Code by right-clicking and selecting "Open with Live Server" (Make sure to install the "Live Server" extension from VS Code or your IDE)





