from flask import Flask, render_template, request, Response, jsonify, redirect, url_for
import os, sys, uuid, subprocess, signal
from werkzeug.utils import secure_filename
import glob 
import json

app = Flask(__name__)

# Handling of shutdown
def graceful_shutdown(signum, frame):
    print("Cleaning up...")
    stop_server()
    sys.exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)  # docker stop
signal.signal(signal.SIGINT, graceful_shutdown)   # Ctrl+C



node_process = None

# IMPORTANT: mapping of visualization files
CHARTS_DIR = os.path.join(app.static_folder, "charts")
REFERENCE_DIR = os.path.join(app.static_folder, "reference")
if REFERENCE_DIR not in sys.path:
    sys.path.insert(0, REFERENCE_DIR)

# Folders for default examples and user uploaded specs
EXAMPLES_DIR = os.path.join(CHARTS_DIR, "examples")
if EXAMPLES_DIR not in sys.path:
    sys.path.insert(0, EXAMPLES_DIR)

UPLOADS_DIR = os.path.join(CHARTS_DIR, "uploads")
DATA_DIR = os.path.join(app.static_folder, 'data')


# Default charts only (inspector mode)
def discover_charts():
    charts = {}
    def analysis(filepath):
        filename = os.path.basename(filepath)
        key = os.path.splitext(filename)[0]  # 'barchart.py' => 'barchart'
        charts[key] = {
            "path": filepath,
            "title": key.replace("-", " ").title(),  # Optional: make it human-readable
            "filename": filename
        }

    for filepath in glob.glob(os.path.join(EXAMPLES_DIR, "*.py")):
        analysis(filepath)
    
    for filepath in glob.glob(os.path.join(EXAMPLES_DIR, "*.js")):
        analysis(filepath)

    return charts

CHART_FILES = discover_charts()

EXPECTED_BOOLEANS = [
    "provega.progression.chunking.reading.ascending", # DATA

    "provega.progression.monitoring.aliveness",

    "provega.progression.monitoring.change.area",
    "provega.progression.monitoring.change.area.active",
    "provega.progression.monitoring.change.area.blink",

    "provega.progression.monitoring.change.mark",
    "provega.progression.monitoring.change.mark.active",
    "provega.progression.monitoring.change.mark.blink",
    
    "provega.progression.monitoring.change.noise_reduction",

    "provega.progression.monitoring.quality.absolute_progress.on_data_input",
    "provega.progression.monitoring.quality.absolute_progress.on_result_output",
    "provega.progression.monitoring.quality.absolute_progress.on_visual_output",
    "provega.progression.monitoring.quality.relative_progress.on_data_input",
    "provega.progression.monitoring.quality.relative_progress.on_result_output",
    "provega.progression.monitoring.quality.relative_progress.on_visual_output",
    "provega.progression.monitoring.quality.relative_stability.on_data_input",
    "provega.progression.monitoring.quality.relative_stability.on_result_output",
    "provega.progression.monitoring.quality.relative_stability.on_visual_output",
    "provega.progression.monitoring.quality.absolute_certainty.on_result_output",
]


@app.route('/')
def index():
    dropdown_items = []
    for key, data in sorted(CHART_FILES.items(), key=lambda item: item[1]['title']):
        if os.path.isfile(data["path"]):
            dropdown_items.append({"value": key, "text": data["title"]})
    return render_template('index.html', dropdown_items=dropdown_items, active_page="index")

@app.route("/browser")
def browser():
    charts = load_charts()
    return render_template('browser.html', charts=charts, active_page="browser")

@app.route("/provega-documentation")
def documentation():
    return render_template('provega-documentation.html', active_page = 'documentation')


@app.route("/upload", methods=["POST"])
def upload_chart():
    charts = []
    # Retrieve data from the form
    title = request.form.get('title', '').strip()
    description = request.form.get('description', '').strip()
    doi = request.form.get('doi', '').strip()
    keywords = request.form.get('keywords', '').strip()
    chart_type = request.form.get('chart_type', '').strip()
    image = request.files.get('image')
    spec = request.files.get('spec')

    # Basic check
    if not all([title, description, keywords, chart_type, image, spec]):
        return "Missing required fields", 400

    # Generate base unique name
    base_name = uuid.uuid4().hex
    folder_path = os.path.join(UPLOADS_DIR, base_name)
    os.makedirs(folder_path, exist_ok=True)

    # Get image extension (.png, .jpg, etc.)
    image_ext = os.path.splitext(secure_filename(image.filename))[1]
    image_filename = f"{base_name}{image_ext}"
    image_path = os.path.join(folder_path, image_filename)
    image.save(image_path)

    # Save spec
    spec_filename = f"{base_name}_spec.json"
    spec_path = os.path.join(folder_path, spec_filename)
    spec.save(spec_path)

    # Save metadata
    metadata_filename = f"{base_name}_metadata.json"
    metadata_path = os.path.join(folder_path, metadata_filename)

    # Parse keywords into list
    keyword_list = [kw.strip() for kw in keywords.split(",") if kw.strip()]

    # Save metadata (used for the chart gallery)
    new_chart = {
        "title": title,
        "description": description,
        "doi": doi,
        "keywords": keyword_list,
        "chart_type": chart_type,
        "folder": "uploads"
    }

    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(new_chart, f, indent=2, ensure_ascii=False)

    charts.append(new_chart)

    return redirect(url_for('browser'))


@app.route("/upload_data", methods = ["POST"])
def upload_data():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    path = os.path.join(DATA_DIR, 'upload')
    
    filename = file.filename
    filepath = os.path.join(path, filename)
    file.save(filepath)

    file_url = f'/static/data/upload/{filename}'
    return jsonify({'url': file_url})


@app.route('/list_uploaded_files')
def list_uploaded_files():
    upload_folder = os.path.join(DATA_DIR, 'upload')
    try:
        files = [f for f in os.listdir(upload_folder) if f.lower().endswith(('.json', '.csv'))]
        return jsonify(files)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route("/editor", methods=["GET", "POST"])
def editor():
    if request.method == "POST":
        filename = request.form.get("filename")
        folder = request.form.get("folder")
        name = os.path.basename(filename).split(".")[0]

        return render_template("editor.html", folder=folder, name = name, active_page="editor")
    return render_template('editor.html', active_page="editor")

@app.route('/get_spec')
def get_spec():
    name = request.args.get('name')

    # USER-UPLOADED LOGIC!! TO-DO
    if not name or name not in CHART_FILES:
        return "Invalid name", 400

    response = spec_load(name)
    # Return the spec and the list of toggles
    return Response(response, content_type='application/json')
    


def spec_load(name):
    try:
        module = __import__(name)
        spec = module.get_spec()
        hierarchy = extract_boolean_values(spec)

        if(name == "density-map"):
            csv_path = url_for('static', filename=spec['data']['url'])
            spec['data']['url'] = csv_path

        result = {
            "spec": spec,
            "active_bools": hierarchy,
        }
        
        # jsonify internally use json.dumps sorting the keys alphabetically
        return json.dumps(result, sort_keys=False)
    
    except Exception as e:
        print("Error:", e)
        return f"Error loading spec", 500


@app.route('/get_text')
def get_text():
    file_name = request.args.get('name')
    if not file_name.lower().endswith('.txt'):
        file_name += '.txt'

    try:
        file_path = os.path.join(REFERENCE_DIR, file_name)
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            parts = content.split(';', 1)
            text_part1 = parts[0].strip() if parts else ""
            text_part2 = parts[1].strip() if len(parts) > 1 else ""
            
            return jsonify({
                "figure": text_part1,
                "desc": text_part2
            })
    except FileNotFoundError:
        return jsonify({"error": f"Text file '{file_name}' not found"}), 404
    except Exception as e:
        return jsonify({"error": f"Error parsing the text file: {str(e)}"}), 500


@app.route('/start_server', methods=['POST'])
def start_server():
    global node_process

    if node_process is not None and node_process.poll() is None:
        return jsonify({"status": "Node process already running"})
    
    path = os.path.join(os.path.dirname(__file__), "static", "data", "socket-server-linechart.py")

    try:
        node_process = subprocess.Popen(
            [sys.executable, path],  # usa lo stesso interprete Python
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            preexec_fn=os.setsid,
            bufsize=1,
            universal_newlines=True,
            text=True
        )
    except Exception as e:
        print("Error in subprocess:", e)
        
        output, _ = node_process.communicate()
        print("Captured output:", output.strip())
        print("Process already running or another error")

    
    return jsonify({"status": "Node process started", "pid": node_process.pid})


@app.route('/stop_server', methods=['POST'])
def stop_server():
    global node_process

    if node_process is not None and node_process.poll() is None:
        try:
            os.killpg(os.getpgid(node_process.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass 

        node_process = None
        return jsonify({"status": "Node process terminated"})
    else:
        return jsonify({"status": "No process running"})



# AUX functions
def extract_boolean_values(spec):
    def get_value_from_path(d, path):
        parts = path.split('.')
        current = d
        for p in parts:
            if isinstance(current, dict) and p in current:
                current = current[p]
            else:
                return None  # path non trovato
        if isinstance(current, bool):
            return current
        return None  # valore non booleano

    result = []
    for path in EXPECTED_BOOLEANS:
        val = get_value_from_path(spec, path)
        if val is not None:
            result.append({"path": path, "_value": val})

    return result


def get_title(filename):
    name_without_ext = os.path.splitext(filename)[0]
    name_with_spaces = name_without_ext.replace('-', ' ')
    return name_with_spaces.capitalize()


# All charts (browser gallery)
def load_charts():
    charts = []
    def cycler(filename, folder=None):
        if(folder): 
            dir = os.path.join(UPLOADS_DIR, folder)
            types = "uploads/"
        else: 
            dir = EXAMPLES_DIR
            folder = "examples"
            types = ""

        if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.svg')):
            # JSON metadata
            # also avoid using 'dir' as a variable name, since it shadows the built-in os.dir
            meta_file = os.path.join(dir, f"{filename.split('.')[0]}_metadata.json")

            if os.path.exists(meta_file):
                with open(meta_file, encoding='utf-8') as f:
                    meta = json.load(f)
            else:
                meta = {}

            charts.append({
                'filename': f'charts/{types}{folder}/{filename}',
                'title': meta.get('title', get_title(filename)),
                'description': meta.get('description', ''),
                'doi': meta.get('doi', ''),
                'keywords': meta.get('keywords', []),
                'chart_type': meta.get('chart_type', ''),
                'folder': meta.get('folder', 'examples')
            })


    # EXAMPLES
    if os.path.isdir(EXAMPLES_DIR):
        for filename in os.listdir(EXAMPLES_DIR):
            cycler(filename)
    
    # UPLOADS
    if os.path.isdir(UPLOADS_DIR):
        for _, fold, _ in os.walk(UPLOADS_DIR):
            for folder in fold:
                for filename in os.listdir(os.path.join(UPLOADS_DIR, folder)):
                    cycler(filename, folder)


    return charts



if __name__ == '__main__':
    # Make sure debug=False in a production environment
    app.run(host="0.0.0.0", port=8000, debug=True)
