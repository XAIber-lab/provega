let currentSpec = null;
let selectedSnap = null;
let selectedThumb = null;
const snapshots = []; // Keeps all snapshots

let timer = null; // useful for timed screenshot

document.addEventListener('DOMContentLoaded', function() {
    fetchUploadedFiles();
    const hamburgerIcon = document.getElementById('hamburger-icon');

    const copyButton = document.querySelector('.copy-spec-button');
    const cameraButton = document.querySelector('.camera-button');
    const downloadButton = document.querySelector('.download-button');
    const uploadButton = document.getElementById('upload-json');
    const uploadInput = document.getElementById('jsonUpload');
    const dropdownButton = document.getElementById('dropdown-toggle');

    // Saved editings
    const snapshotRow = document.getElementById("snapshot-row");

    const leftPanel = document.getElementById('left-panel');
    const runVizButton = document.getElementById('run-visualization');

    // custom script data
    const modal = document.getElementById("editorModal");
    const openBtn = document.getElementById("openEditorBtn");
    const closeBtn = document.getElementById("closeEditorBtn");
    const saveBtn = document.getElementById("saveScriptBtn");

    // Spec editor
    const editor = ace.edit("advanced-spec-editor");
    editor.session.setMode("ace/mode/json");
    editor.setOptions({
            showPrintMargin: false,
            highlightActiveLine: true
    });
    editor.setFontSize(14);
    window.editor = editor;

    // script editor
    const editor2 = ace.edit("editorModalEditor");
    editor2.session.setMode("ace/mode/javascript");
    editor2.setOptions({
      tabSize: 2
    });


    const specContainer = document.getElementById("spec-container");
    check();

    async function check() {
        if (specContainer) {
            // socket server
            if(specContainer.dataset.name == "linechart-socketio"){
                await startNode();
            }

            // SPEC
            if(specContainer.dataset.folder == "examples"){
                await fetch(`/get_spec?name=${specContainer.dataset.name}`)
                    .then(res => {
                    if (!res.ok) {
                        throw new Error(`HTTP error! status: ${res.status}`);
                    }
                    return res.json();
                })
                .then(data => {
                    currentSpec = data.spec;
                })
                .catch(err => {
                    console.error("Failed to load spec:", err);
                });
        
                editor.setValue(JSON.stringify(currentSpec, null, 2), -1);
                run();
            }

            // user-uploaded logic
            else {}
        }
    }


    // First of all render any eventual snapshot from Local Storage
    loadSnapshotsFromLocalStorage();

    function update(){
        try {
            const spec = JSON.parse(editor.getValue());

            if(JSON.stringify(spec) === JSON.stringify(currentSpec)){
                return false;
            } else {
                currentSpec = spec;
                return true
            }
        } catch (e) {
            alert("Error! Spec not valid", e);
        }
    }

    runVizButton.addEventListener("click", async () => {
        if(update()){
            await run();
            addSnapshot();
        }
    })

    // Run function
    async function run(){
        // Copy in order not to edit the spec
        spec = structuredClone(currentSpec);

        try{
            result = await vegaEmbed("#vis", spec, {
                tooltip: true,
                renderer: "canvas"
            });

            const detailsToRemove = document.querySelector('details[title="Click to view actions"]');
            if (detailsToRemove) {
                detailsToRemove.remove();
            }

            uploadButton.disabled = false;
            openBtn.disabled = false;
            dropdownButton.disabled = false;

        } catch (e){
            uploadButton.disabled = true;
            openBtn.disabled = true;
            dropdownButton.disabled = true;
            throw new Error("Spec not valid:", e)
        }
    }


    hamburgerIcon.addEventListener('click', () => {
        leftPanel.classList.toggle('collapsed');
    });

    copyButton.addEventListener('click', async () => {
        const textToCopy = editor.getValue();
        
        try {
            await navigator.clipboard.writeText(textToCopy);

            // Mostra il feedback
            copyButton.classList.add('copied');

            // Nascondi il feedback dopo un breve periodo (es. 2 secondi)
            setTimeout(() => {
                copyButton.classList.remove('copied');
            }, 2000); 

        } catch (err) {
            console.error('Error during copy', err);
        }
    });

    cameraButton.addEventListener("click", () => {
        generateSnapshotImage();
    });

    downloadButton.addEventListener('click', () => {
        try {
            const content = editor.getValue();
            const json = JSON.parse(content);

            const blob = new Blob([JSON.stringify(json, null, 2)], {type: "application/json"});
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "my_own_spec.json";

            document.body.appendChild(link);
            link.click();

            // Cleaning
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (e){
            alert("Spec is not valid");
            console.error(e);
        }
        
    });


    // UPLOAD JSON / CSV VALUES
    uploadButton.addEventListener('click', () => {
        uploadInput.click();
    });

    uploadInput.addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;

        let fileType = null;
        const extension = file.name.split('.').pop().toLowerCase();

        switch (extension) {
        case 'csv':
            fileType = 'csv';
            break;
        case 'json':
            fileType = 'json';
            break;
        default:
            fileType = null;
        }

        if (!fileType) {
            alert("Only .json and .csv files are supported.");
            return;
        }

        // UI: show spinner
        const overlay = document.getElementById('uploadOverlay');
        const tooltip = document.getElementById('uploadTooltip');
        const tooltipContent = document.getElementById('uploadTooltipContent');

        const buttonRect = uploadButton.getBoundingClientRect();
        tooltip.style.left = `${buttonRect.left + buttonRect.width / 2 - 60}px`;
        tooltip.style.top = `${buttonRect.top - 40}px`;

        tooltipContent.innerHTML = `<i class="fa fa-spinner fa-spin"></i> Uploading...`;
        tooltip.style.display = 'block';
        overlay.style.display = 'block';

        document.body.style.pointerEvents = 'none';
        tooltip.style.pointerEvents = 'auto'; 


        // send to flask
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload_data', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error("File upload failed");
            }

            const data = await response.json();
            const fileURL = data.url;

            // Set currentSpec.data
            const tmp = JSON.parse(editor.getValue());
            if(tmp == ""){ return;}
            else {currentSpec = tmp;}
            

            currentSpec.data = {
                url: fileURL,
                format: {
                    type: fileType
                }
            };

            editor.setValue(JSON.stringify(currentSpec, null, 2), -1);
            console.log("Updated currentSpec:", currentSpec);

            await run();
            addSnapshot();

            // Hide spinner
            tooltipContent.innerHTML = `<i class="fa fa-check" style="color: green;"></i> Success!`;
            setTimeout(() => {
                tooltip.style.display = 'none';
                overlay.style.display = 'none';
                document.body.style.pointerEvents = 'auto';
            }, 2500);

            await fetchUploadedFiles();

        } catch (err) {
            alert("Error uploading file.");
            console.error(err);
        }
    });




    // Uploaded files logic
    async function fetchUploadedFiles() {
    try {
        const response = await fetch('/list_uploaded_files'); // Flask endpoint
        if (!response.ok) throw new Error('Error loading files');

        const files = await response.json();

        if (files.length > 0) {
            dropdownButton.style.display = 'inline';
            uploadButton.style.borderTopRightRadius = '0px';
            uploadButton.style.BorderBottomRightRadius = '0px';
            populateDropdown(files);
        }
        else {
            dropdownButton.style.display = 'none';
        }

    } catch (error) {
        console.error('Error fetching existing uploaded files:', error);
    }
    }

    function populateDropdown(files) {
        const dropdown = document.getElementById('uploadedFilesDropdown');
        dropdown.innerHTML = ''; // reset

        files.forEach(file => {
            const li = document.createElement('li');
            li.textContent = file;
            li.title = file; // Tooltip completo
            li.addEventListener('click', () => {
                const fileType = file.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
                const fileURL = `/static/data/upload/${file}`;

                const tmp = JSON.parse(editor.getValue());
                if(tmp == "") return;
                else currentSpec = tmp;

                currentSpec.data = {
                    url: fileURL,
                    format: { type: fileType }
                };

                editor.setValue(JSON.stringify(currentSpec, null, 2), -1);
                run();
                addSnapshot();

                // Chiudi dropdown dopo selezione
                dropdown.style.display = 'none';
            });

        dropdown.appendChild(li);
        });
    }

    // Toggle dropdown 
    dropdownButton.addEventListener('click', (e) => {
        const dropdown = document.getElementById('uploadedFilesDropdown');
        dropdown.style.display = (dropdown.style.display === 'block') ? 'none' : 'block';
        e.stopPropagation();
    });

    // Close dropdown
    window.addEventListener('click', () => {
    const dropdown = document.getElementById('uploadedFilesDropdown');
    dropdown.style.display = 'none';
    });




    // === Snapshot logic ===
    // Camera button
    function updateCameraButtonState() {
        if (selectedSnap) {
            cameraButton.disabled = false;
        } else {
            cameraButton.disabled = true;
        }
    }

    // Snapshot object creation and saving
    async function addSnapshot() {
        const spec = JSON.parse(editor.getValue());
        const imageDataUrl = null;
        
        const id = Date.now();
        const label = `Edit ${snapshots.length + 1}`

        const snapshot = { 
            id, 
            label, 
            data: spec, 
            chart: "editor",
            favourite: false,
            timestamp: new Date().toLocaleString(),
            imageDataUrl
         };
        snapshots.push(snapshot);
        if(saveSnapshotsToLocalStorage()){
            selectedSnap = snapshot;
            renderSnapshots();
        }
        else {
            snapshots.pop();
        }

        setTimeout(() => {}, 500);
    }

    
    // Rendering function
    function renderSnapshots() {
        snapshotRow.innerHTML = ''; // Clear existing snaps

        const sorted = [...snapshots].sort((a,b) => {
            // Favourites locked on the left
            if (a.favourite !== b.favourite) return b.favourite - a.favourite;
            return a.id - b.id;
        });


        for (const snap of sorted){
            // editor mode filter
            if(snap.chart !== "editor"){
                continue;
            }

            const snapshotEl = document.createElement("div");
            snapshotEl.className = "snapshot";
            snapshotEl.textContent = snap.label;
            snapshotEl.dataset.snapshotID = snap.id;
            snapshotEl.innerHTML = `
                <div class="snapshot-thumbnail"></div>
                <div class="snapshot-label" contenteditable="false">${snap.label}</div>
            `;

            // Star favourite
            const star = document.createElement("span");
            star.className = "snapshot-star";
            star.innerHTML = snap.favourite ? "★" : "☆";
            star.title = "Toggle favourite";

            // Star CSS
            Object.assign(star.style, {
                position : "absolute",
                top: "-1em",
                right: "-1em",
                width: "1.8em",
                height: "1.8em",
                borderRadius: "50%",
                border: "1px solid #aaa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1em",
                color: snap.favourite ? "goldenrod" : "#aaa",
                backgroundColor: "#f2f2f2",
                cursor: "pointer",
                zIndex: "1",
            });    

            // Edit label
            const labelEl = snapshotEl.querySelector(".snapshot-label");
            labelEl.addEventListener("click", (e) => {
                e.stopPropagation();
                labelEl.contentEditable = true;
                labelEl.focus();
            });

            labelEl.addEventListener("blur", () => {
                let text = labelEl.textContent.trim();
                if (text.length === 0){
                    text = `Edit ${snap.id + 1}`;
                    labelEl.textContent = text;
                }
                snap.label = text;
                labelEl.contentEditable = false;
                saveSnapshotsToLocalStorage();
            });

            labelEl.addEventListener("input", (e) => {
                const maxChars = 15;
                const el = e.currentTarget;
                const text = el.textContent;

                if (text.length > maxChars) {
                    el.textContent = text.slice(0, maxChars);

                    // Cursor drop
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(el);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            });

            labelEl.addEventListener('keydown', (e) => {
                if(e.key === 'Enter') {
                    e.preventDefault();
                }
            });

            // Star event + check
            star.addEventListener("click", (e) => {
                e.stopPropagation();

                const maxFavourites = 5;
                const currentFavourites = snapshots.filter(s => s.favourite && s.chart === snap.chart).length;
                
                if (!snap.favourite && currentFavourites >= maxFavourites) {
                    let tooltip = star.querySelector('.fav-tooltip');
                    if (!tooltip) {
                    tooltip = document.createElement('div');
                    tooltip.className = 'fav-tooltip';
                    tooltip.textContent = "You can only have 5 favourites";
                    Object.assign(tooltip.style, {
                        position: 'absolute',
                        top: '100%',
                        right: '0',
                        backgroundColor: 'rgba(0,0,0,0.75)',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.8em',
                        whiteSpace: 'nowrap',
                        zIndex: '10',
                        marginTop: '0.25em',
                        pointerEvents: 'none',
                        opacity: '1',
                        transition: 'opacity 0.3s ease',
                    });
                    star.appendChild(tooltip);

                    // Rimuovi tooltip dopo 2 secondi
                    setTimeout(() => {
                        tooltip.style.opacity = '0';
                        setTimeout(() => tooltip.remove(), 300);
                    }, 2000);
                    }
                    return; // blocca toggle
                }
                snap.favourite = !snap.favourite;
                renderSnapshots();
                saveSnapshotsToLocalStorage();
                
            });

            const trash = document.createElement("div");
            trash.className = "snapshot-trash";
            trash.title = "Delete snapshot";
            trash.innerHTML = "×";

            Object.assign(trash.style, {
                position : "absolute",
                top: "4.2em",
                right: "-1em",
                width: "1.8em",
                height: "1.8em",
                borderRadius: "50%",
                border: "1px solid #aaa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1em",
                color: "red",
                backgroundColor: "#f2f2f2",
                zIndex: "1",
            });

            trash.addEventListener("click", (e) => {
                e.stopPropagation();
                const index = snapshots.findIndex(s => s.id === snap.id);
                if (index > -1) {
                    snapshots.splice(index, 1);
                }

                if(selectedSnap === snap){
                    resetThumb();
                }
                saveSnapshotsToLocalStorage();
                renderSnapshots();
                
            });


            const thumbnailEl = snapshotEl.querySelector(".snapshot-thumbnail");
            if (snap.imageDataUrl) {
                const img = document.createElement("img");
                img.src = snap.imageDataUrl;
                img.className = "snapshot-image-thumb";
                img.style.width = "100%";
                img.style.height = "100%";
                img.style.borderRadius = "4px";
                img.style.display = "block";
                thumbnailEl.prepend(img);
            }

            if(snap === selectedSnap){
                thumbSelected(snap, thumbnailEl);
            }

            thumbnailEl.addEventListener("click", async function() {
                currentSpec = snap.data;
                editor.setValue(JSON.stringify(currentSpec, null, 2), -1);
                thumbSelected(snap, thumbnailEl);
                await run();
            });
            thumbnailEl.appendChild(star);
            thumbnailEl.appendChild(trash);

            snapshotRow.appendChild(snapshotEl);
        }
    }


    // border of the snapshot (selection and unselection)
    function thumbSelected(snap, thumb){
        resetThumb();
        selectedThumb = thumb;
        selectedSnap = snap;
        thumb.classList.add("selectedThumb");
        updateCameraButtonState();

        if(!snap.imageDataUrl){
            // automatic screenshot after 10 seconds
            automaticScreenshot();
        }
    }

    function resetThumb(){
        if(selectedThumb && selectedSnap){
            selectedThumb.classList.remove("selectedThumb");
            selectedThumb = null;
            selectedSnap = null;
            updateCameraButtonState();
            if(timer) {
                clearTimeout(timer);
                timer = null;
            }
        };
    }


    function saveSnapshotsToLocalStorage(){
        console.log("\n\nFUNCTION CALLED, snaps:", snapshots);
        const plainSnapshots = snapshots.map(s => ({
            id: s.id,
            label: s.label,
            data: s.data,
            chart: s.chart,
            favourite: s.favourite,
            timestamp: s.timestamp,
            imageDataUrl: s.imageDataUrl
        }));
        try{
            localStorage.setItem("snapshots", JSON.stringify(plainSnapshots));
            return true;
        } catch (e) {
            if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') && localStorage.length !== 0) {
                alert("Snapshot limit reached. Please delete some snapshots to free up space")
            }
            return false;
        }
    }

    function loadSnapshotsFromLocalStorage() {
        const saved = localStorage.getItem("snapshots");
        if (saved) {
            try{
                const loaded = JSON.parse(saved);
                snapshots.length = 0;
                snapshots.push(...loaded);
                renderSnapshots();
            }
            catch (e) {
                console.error("Error parsing saved snapshots", e);
            }
        }
    }

    async function generateSnapshotImage() {
        try {
            const view = result.view;
            const url = await view.toImageURL("png");
            result.view.finalize();

            selectedSnap.imageDataUrl = url;
            if(!saveSnapshotsToLocalStorage()){
                selectedSnap.imageDataUrl = null;
            }

            renderSnapshots();

        }catch (err) {
            console.error("Failed to generate snapshot:", err);
            return null;
        }
    }

    async function automaticScreenshot() {
        timer = setTimeout(generateSnapshotImage, 10000);
    }


    // script editor

    // open editor
    openBtn.addEventListener("click", () => {
      modal.style.display = "block";
    });

    // close editor
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });

    window.onclick = function(event) {
      if (event.target === modal) {
        modal.style.display = "none";
      }
    };

    // execute script
    saveBtn.addEventListener("click", async () => {
        const scriptCode = editor2.getValue();

        // 1. Verify currentSpec 
        if (!currentSpec) {
            const tmp = JSON.parse(editor.getValue());
            if(tmp == ""){ 
                alert("Error: no spec has been defined yet!");
                return;}
            else {currentSpec = tmp;}
        }

        // 2. Verify data.values exist!
        if (
            !currentSpec.data ||
            !("values" in currentSpec.data)
        ) {
            delete currentSpec.data.url;
            delete currentSpec.data.format;
            currentSpec.data.values = null;
        }

        let generatedData;
        try {
            // 3. Try executing user's code
            const fn = new Function(scriptCode); // must include a return statement
            generatedData = fn();

            // 4. Verify it is valid
            if (
            typeof generatedData !== "object" ||
            generatedData === null
            ) {
            alert("Error: wrong return!");
            return;
            }

            // 5. Save the result in data.values
            currentSpec.data.values = generatedData;
            editor.setValue(JSON.stringify(currentSpec, null, 2), -1);

            console.log(currentSpec.data.values);
            alert("Success!");
            modal.style.display = "none";
            await run();
            addSnapshot();

        } catch (err) {
            alert("Error " + err.message);
            console.error(err);
        }
    });


    // socket example
    async function startNode() {
        fetch('/start_server', { method: 'POST' })
            .then(res => res.json())
            .then(console.log);
    }

    function stopNode() {
        fetch('/stop_server', { method: 'POST' })
            .then(res => res.json())
            .then(console.log);
    }


    window.addEventListener('beforeunload', function () {
        stopNode();
    });
});