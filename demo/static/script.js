let currentSpec = null;
let currentMenu = null;
let selectedSnap = null;
let selectedThumb = null;
let result = null;

// linesocket IO
let server = false;

let timer = null; // useful for timed screenshot

const snapshots = []; // Keeps all snapshots

document.addEventListener('DOMContentLoaded', function() {
    // Definition of all required elements
    const contentSelector = document.getElementById('content-selector');
    const visContainer = document.getElementById('vis'); // Get the target div
    const cameraButton = document.querySelector('.camera-button');
    const tooltip = document.getElementById("globalTooltip"); // camera tooltip
    const copyButton = document.querySelector('.copy-spec-button');
    const downloadButton = document.querySelector('.download-button');

    function updateCameraButtonState() {
        if (selectedSnap) {
            cameraButton.disabled = false;
        } else {
            cameraButton.disabled = true;
        }
    }

    const figureImage = document.getElementById("figure-image");
    const figureTxt = document.getElementById("figure");
    const figureDesc = document.getElementById("desc");
    
    // Elements to enable/disable (same as before)
    const runVizButton = document.getElementById('run-visualization');
    const frequencyTextarea = document.getElementById('frequency');
    const sizeTextarea = document.getElementById('size');
    const seedTextarea = document.getElementById('seed');

    window.editor;
    editor = ace.edit("advanced-spec-editor");
    editor.session.setMode("ace/mode/json");
    editor.setOptions({
            showPrintMargin: false,
            highlightActiveLine: true
    });
    editor.setFontSize(10);

    // Params containers
    const basicParamsDiv = document.getElementById('basic-params');
    const advancedEditorDiv = document.getElementById('advanced-editor-container');

    let selectedValue;
    
    const menuContent = document.getElementById('hierarchy');

    const advancedViewToggle = document.getElementById('advanced-view-toggle');
    const togglesViewToggle = document.getElementById('toggle-view-toggle');
    const toggleSlider = document.getElementById('toggle-slider');

    // Saved editings
    const snapshotRow = document.getElementById("snapshot-row");
    
    const grammarParamElements = [runVizButton, frequencyTextarea, sizeTextarea, seedTextarea, advancedViewToggle, togglesViewToggle, copyButton, downloadButton]; 


    // First of all render any eventual snapshot from Local Storage
    loadSnapshotsFromLocalStorage();

    // Cleaning function
    function cleanVis(){
        visContainer.innerHTML = '';

        figureImage.src = '';
        figureImage.classList.toggle("hidden", true);

        figureTxt.innerText = '';
        figureDesc.innerText = '';

        editor.setValue('');
    }

    // Function to execute the edited script
    async function updateSpec() {
        const advancedMode = advancedViewToggle.checked;

        // If retrieving params from advanced mode 
        if (advancedMode) {
            try {
                if(!updateAdvanced()){
                    return false;
                }
            } catch (e) {
                alert("Spec non valida: " + e.message);
                setValues();
                return
            }

        // Else -> basic params
        } else{
            if(!changeValues()){return false;}
        }

        await addSnapshot();

        // Clear old vis and script
        visContainer.innerHTML = '';
        menuContent.innerHTML = '';
        const progressContainer = document.getElementById("progress-container");
        if(progressContainer){
            progressContainer.innerHTML = '';
        }

        try{
            setValues();
            await run();
            buildFlatHierarchy(currentMenu, menuContent);
            setupToggleVisibility();
        }
        catch{
            clearParams();
            window.alert("Spec not valid!");
            setValues();
            run();
            buildFlatHierarchy(currentMenu, menuContent);
            setupToggleVisibility();
        } 
    }


    // Spec loader
    async function loadSpec(name) {

        if(name == "tpflow"){
            const tpf = await getTpFlow();
            currentSpec = tpf;
            currentMenu = extractBooleanValues(tpf);
        }

        else if(name == "choropleth"){
            const choro = await getChoro();
            await new Promise(resolve => setTimeout(resolve, 1000));
            currentSpec=choro;
            currentMenu = extractBooleanValues(choro);
            //setTimeout(() => {visContainer.innerHTML = `<p style="color:orange;">Choropleth is too heavy.</p>`;}, 3000);
        }

        else if(name == "density-map"){
            const dens = await getDens();
            await new Promise(resolve => setTimeout(resolve, 1000));
            currentSpec=dens;
            currentMenu = extractBooleanValues(dens);
        }

        else{
            if(name == "linechart-socketio"){
                alert("Socket server started at localhost:3000");
                await startNode();
            }
            // SPEC through flask
            await fetch(`/get_spec?name=${name}`)
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`HTTP error! status: ${res.status}`);
                    }
                    return res.json();
                })
                .then(data => {
                    currentSpec = data.spec;
                    currentMenu = data.active_bools;
                })
                .catch(err => {
                    console.error("Failed to load spec:", err);
                }
            );
        }
        // IMAGE
        if (figureImage) {
            figureImage.src = `/static/reference/${name}.png`
            figureImage.classList.toggle("hidden", false);
        }


        // TEXT
        try {
            const textRes = await fetch(`/get_text?name=${name}`);
            if (!textRes.ok) {
                throw new Error(`HTTP error! status: ${textRes.status} for text`);
            }
            const textData = await textRes.json();
            const figure = textData.figure;
            const desc = textData.desc;

            if (figureTxt && figureDesc){
                figureTxt.innerText = figure;
                figureDesc.innerText = desc
            }
        } catch (err) {
            console.error("Error loading text:", err);
        }


        return true;
    }


    // control toggles
    function setupToggleVisibility(){
        const progressBarToggle = document.getElementById("Controls-ProgressBar");
        const progressControlToggle = document.getElementById("Controls-ProgressControl");
        const progressPanelToggle = document.getElementById("Controls-ProgressPanel");
        const progressQualityToggle = document.getElementById("Controls-ProgressQuality");

        function check(){
            const chartWrappers = document.getElementsByClassName('chart-wrapper');
            const chartWrapper = chartWrappers[0];

            if(!progressQualityToggle.checked){
                chartWrapper.style.gridColumn = "1 / span 2"
                if (!progressBarToggle.checked && !progressControlToggle.checked && !progressPanelToggle.checked){
                    chartWrapper.style.gridRow = "1 / span 2";
                }
                else {
                    chartWrapper.style.gridRow = "1";
                }
            } else {
                chartWrapper.style.gridColumn = "1";
            }
        }

        progressBarToggle.addEventListener('change', function() {
            const bar = document.getElementById("progress-bar");
            bar.classList.toggle("hidden", !progressBarToggle.checked);
            check();
        });

        progressControlToggle.addEventListener('change', function(){
            const controls = document.getElementById("progress-controls");
            const info = document.getElementById("progress-info");
            controls.classList.toggle("hidden", !progressControlToggle.checked);
            info.classList.toggle("hidden", !progressControlToggle.checked);
            check();
        });

        progressPanelToggle.addEventListener('change', function() {
            const panel = document.getElementById("proc-panel");
            panel.classList.toggle("hidden", !progressPanelToggle.checked);
            check();
        });

        progressQualityToggle.addEventListener('change', function() {
            const quality = document.getElementById("quality-panel");
            quality.classList.toggle("hidden", !progressQualityToggle.checked);
            check();
        });
    }

    // Chart choice and chart execution
    contentSelector.addEventListener('change', async function() {
        selectedValue = this.value; // This is the chart!
        resetThumb(); //ofc reset snapshot selection
        renderSnapshots();

        setGrammarParamsDisabled(true);
        // Clear previous visualization and load spec
        clearParams();

        if(server){ stopNode();}

        if(selectedValue === ''){
            cleanVis();
            return;
        }

        const specLoaded = await loadSpec(selectedValue);

        if (selectedValue && specLoaded) {
            setGrammarParamsDisabled(false);
            try{
                setValues();
                await run();
                // Create the menu hierarchy
                buildFlatHierarchy(currentMenu, menuContent);

                // control handles for the toggles
                setupToggleVisibility();

            } catch (e){
                console.warn("Spec is not valid!");
                visContainer.innerHTML = `<p style="color:orange;">Spec is not valid.</p>`;
                setGrammarParamsDisabled(true);
                console.error(e);
            }

            // Calculate space
            const chartWrappers = document.getElementsByClassName('chart-wrapper');
            const qualityPanel = document.getElementById('quality-panel');
            const chartWrapper = chartWrappers[0];

            if(chartWrapper){
                if (!qualityPanel) {
                    chartWrapper.style.gridColumn = 'span 2';
                } else {
                    chartWrapper.style.gridColumn = '1';
                }
            }
        }

        else{
            visContainer.innerHTML = `<p style="color:red;">Error loading chart spec.</p>`;
            clearParams();
        } 
        
    });



    // Run Visualization button action (same as before)
    runVizButton.addEventListener('click', function() { 
        updateSpec();
     });
    

    
    // AUX 
    function setGrammarParamsDisabled(isDisabled) {
        grammarParamElements.forEach(el => { el.disabled = isDisabled; });
        if(!isDisabled){
            if(!advancedViewToggle.checked){
                advancedViewToggle.click();
                editor.setValue(JSON.stringify(currentSpec, null, 2), -1);
            }
        }
    }


    // TOGGLE HANDLING
    advancedViewToggle.addEventListener('change', () => {
        const showAdvanced = advancedViewToggle.checked;
        // Hiding params from the menu
        if(basicParamsDiv && advancedEditorDiv && hierarchy) {
            basicParamsDiv.classList.toggle('hidden', showAdvanced);
            hierarchy.classList.toggle('hidden', true);
            advancedEditorDiv.classList.toggle('hidden', !showAdvanced);

            togglesViewToggle.checked = false;
            togglesViewToggle.disabled = showAdvanced;
            showAdvanced ? toggleSlider.style.cursor = "not-allowed" : toggleSlider.style.cursor = "pointer";
        }
    });

    togglesViewToggle.addEventListener('change', () => {
        const showToggle = togglesViewToggle.checked;
        hierarchy.classList.toggle('hidden', !showToggle);
    })

    // Generic handler for the heirarchy options
    document.querySelectorAll('.collapsible-input').forEach(toggle => {
        toggle.addEventListener('change', () => {
            const group = toggle.closest('.control-group.collapsible-toggle');
            const contents = group.querySelectorAll('.control-item.content');

            // Style of the group
            if(toggle.checked){
                group.style.height = "auto"; 
                group.style.marginBottom = "0px"; 
            }else{
                group.style.height = "24px";
                group.style.marginBottom = "15px";
            }

            contents.forEach(content => {
            if (toggle.checked) {
                content.style.maxHeight = "24px";
                content.style.marginBottom = "15px";
            } else {
                content.style.maxHeight = "0";
                content.style.marginBottom = "0";
            }
            });
        });
    });


    // Menu for the hierarchy options
    function buildFlatHierarchy(data, container) {
        const hierarchy = {};

        const formatName = str =>
            str
                .replace(/[_\.]/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());

        const controlTogglesConfig = [
            { name: "Progress Bar", id: "progress-bar" },
            { name: "Progress Control", id: "progress-controls" },
            { name: "Progress Panel", id: "proc-panel" },
            { name: "Progress Quality", id: "quality-panel" }
        ];

        const adHocControlsToggles = [];

        // checks for progress config elements
        controlTogglesConfig.forEach(config => {
            const elementExists = document.getElementById(config.id) !== null;
            adHocControlsToggles.push({
                fullPath: `Controls.${config.name.replace(/\s/g, '')}`, // Percorso logico senza spazi
                label: config.name,
                value: elementExists, // true se l'elemento esiste, false altrimenti
                isDisabled: !elementExists // true se l'elemento NON esiste (quindi deve essere disabilitato)
            });
        });

        const adHocControls = {
            "Controls": {
                "_toggles": adHocControlsToggles
            }
        };

        Object.assign(hierarchy, adHocControls);
        
        for (const item of data) {
            const normalizedPath = item.path.startsWith('provega.') 
                ? item.path.slice('provega.'.length)
                : item.path;

            const parts = normalizedPath.split('.');

            if (parts.length === 0) continue;

            let currentLevel = hierarchy;
            for (let i = 0; i < parts.length; i++) {
                const partRaw = parts[i];
                const partFormatted = formatName(partRaw);

                if (i === parts.length - 1) {
                    if (!currentLevel._toggles) {
                        currentLevel._toggles = [];
                    }

                    const label = formatName(partRaw);

                    currentLevel._toggles.push({
                        fullPath: item.path,
                        label: label,
                        value: item._value,
                        isDisabled: false
                    });
                } else {
                    // Node 
                    if (!currentLevel[partFormatted]) {
                        currentLevel[partFormatted] = {};
                    }
                    currentLevel = currentLevel[partFormatted];
                }
            }
        }

        // Generate HTML
        function generateTreeHtml(nodeData, parentElement){
            let totalTogglesInNode = 0;

            for (const [key, value] of Object.entries(nodeData)) {
                if (key === '_toggles') {
                    continue;
                }
                
                const treeNodeDiv = document.createElement('div');
                treeNodeDiv.className = 'tree-node';

                const treeHeaderDiv = document.createElement('div');
                treeHeaderDiv.className = 'tree-header';

                const toggleIconSpan = document.createElement('span');
                toggleIconSpan.className = 'toggle-icon';
                toggleIconSpan.textContent = '▶';
                treeHeaderDiv.appendChild(toggleIconSpan);

                const nodeNameSpan = document.createElement('span');
                nodeNameSpan.className = 'node-name';
                nodeNameSpan.textContent = key;
                treeHeaderDiv.appendChild(nodeNameSpan);

                const nodeCountSpan = document.createElement('span');
                nodeCountSpan.className = 'node-count';
                treeHeaderDiv.appendChild(nodeCountSpan); // Count is updated later

                treeNodeDiv.appendChild(treeHeaderDiv);

                const treeContentDiv = document.createElement('div');
                treeContentDiv.className = 'tree-content';
                treeContentDiv.style.display = 'none'; // Hide content initially
                treeNodeDiv.appendChild(treeContentDiv);

                // recursion 
                const togglesCountInChildNode = generateTreeHtml(value, treeContentDiv);
                nodeCountSpan.textContent = togglesCountInChildNode; // Update total child count
                totalTogglesInNode += togglesCountInChildNode;

                parentElement.appendChild(treeNodeDiv);
            }

            // Generate toggles (leaves)
            if (nodeData._toggles && nodeData._toggles.length > 0) {
                for (const leaf of nodeData._toggles) {
                    const controlItem = document.createElement('div');
                    controlItem.className = 'control-item'; 

                    const toggleWrapper = document.createElement('label');
                    toggleWrapper.className = 'toggle-switch';

                    const toggleInput = document.createElement('input');
                    toggleInput.type = 'checkbox';
                    toggleInput.checked = Boolean(leaf.value);
                    toggleInput.dataset.path = leaf.fullPath;
                    toggleInput.id = leaf.fullPath.replace(/\./g, '-');

                    const sliderSpan = document.createElement('span');
                    sliderSpan.className = 'slider round';

                    if (leaf.isDisabled) {
                        toggleInput.disabled = true;
                        sliderSpan.style.cursor = 'not-allowed';
                    }

                    toggleWrapper.appendChild(toggleInput);
                    toggleWrapper.appendChild(sliderSpan);

                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'toggle-label';
                    labelSpan.textContent = leaf.label;

                    controlItem.appendChild(toggleWrapper);
                    controlItem.appendChild(labelSpan);

                    parentElement.appendChild(controlItem);
                    totalTogglesInNode++;
                }
            }
            return totalTogglesInNode; 
        }

        container.innerHTML = '';
        // Ensure container has the tree-container class
        if (!container.classList.contains('tree-container')) {
            container.classList.add('tree-container');
        }

        // Start HTML generation
        generateTreeHtml(hierarchy, container);

        // Add JS logic for expand/collapse toggles
        const toggleHeaders = container.querySelectorAll(".tree-header");
        toggleHeaders.forEach(header => {
            header.addEventListener("click", function() {
                const toggleIcon = this.querySelector('.toggle-icon');
                const treeContent = this.nextElementSibling; // div.tree-content is the next sibling

                if (treeContent && treeContent.classList.contains('tree-content')) {
                    this.classList.toggle("expanded");
                    const isOpen = treeContent.style.display === 'block';
                    treeContent.style.display = isOpen ? 'none' : 'block';
                }
            });
        });
    }



    // Snapshot handlings for the editing
    async function addSnapshot() {
        const spec = JSON.parse(editor.getValue());
        const imageDataUrl = null;
        
        const id = Date.now();
        const label = `Edit ${snapshots.length + 1}`

        const snapshot = { 
            id, 
            label, 
            data: spec, 
            chart: selectedValue,
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

    function renderSnapshots() {
        snapshotRow.innerHTML = ''; // Clear existing snaps

        if (!selectedValue) {
            return;
        }

        const sorted = [...snapshots].sort((a,b) => {
            // Favourites locked on the left
            if (a.favourite !== b.favourite) return b.favourite - a.favourite;
            return a.id - b.id;
        });


        for (const snap of sorted){
            // chart selection filter
            if(snap.chart !== selectedValue){
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
            })

            trash.addEventListener("click", (e) => {
                e.stopPropagation();
                const index = snapshots.findIndex(s => s.id === snap.id);
                if (index > -1) {
                    snapshots.splice(index, 1);
                }

                if(selectedSnap === snap){
                    resetThumb();
                }
                if(saveSnapshotsToLocalStorage()){
                    renderSnapshots();
                }
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
                contentSelector.value = snap.chart;

                if(snap.chart != "linechart-socketio" && server){ stopNode();}
                else if(snap.chart == "linechart-socketio" && !server){await startNode();}

                thumbSelected(snap, thumbnailEl);
                setGrammarParamsDisabled(false);
                setValues();
                await run();
                setupToggleVisibility();

                const showAdvanced = advancedViewToggle.checked;
                togglesViewToggle.disabled = showAdvanced;
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


    // header buttons
    cameraButton.addEventListener("click", () => {
        generateSnapshotImage();
    });

    // camera tooltip
    cameraButton.addEventListener("mouseenter", () => {
        const rect = cameraButton.getBoundingClientRect();
        const tooltipHeight = 40;

        tooltip.style.top = `${rect.top - tooltipHeight}px`;
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.transform = "translateX(-50%) translateY(0)";
        tooltip.style.opacity = "1";
        tooltip.style.visibility = "visible";
    });

    cameraButton.addEventListener("mouseleave", () => {
        tooltip.style.opacity = "0";
        tooltip.style.visibility = "hidden";
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

    downloadButton.addEventListener('click', () => {
        try {
            const content = editor.getValue();
            const json = JSON.parse(content);

            const blob = new Blob([JSON.stringify(json, null, 2)], {type: "application/json"});
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `${selectedValue}.json`;

            document.body.appendChild(link);
            link.click();

            // Cleaning
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (e){
            alert("Error creating the JSON file", e);
        }
        
    });



    // Values in the menu
    function setValues(){
        const reading = currentSpec?.provega?.progression?.chunking?.reading || {};

        sizeTextarea.value = reading.size ?? reading.chunk_size ?? '';
        frequencyTextarea.value = reading.frequency ?? reading.freq ?? '';
        seedTextarea.value = reading.seed ?? '';
        
        const showAdvanced = advancedViewToggle.checked;
        if(!showAdvanced){
            editor.setValue(JSON.stringify(currentSpec, null, 2), -1);
        }
    }


    function updateAdvanced() {
        try {
            const spec = JSON.parse(editor.getValue());
            // Check if spec has changed
            if(JSON.stringify(spec) === JSON.stringify(currentSpec)){
                return false;
            }
            else{
                currentSpec = spec;
                return true;
            }
        } catch (e) {
            console.error("Spec not valid", e);
        }
    }

    function changeValues(){
        const size = parseInt(sizeTextarea.value);
        const freq = parseInt(frequencyTextarea.value);
        const seed = parseInt(seedTextarea.value);

        if (!currentSpec?.provega?.progression?.chunking?.reading) return;
        const reading = currentSpec?.provega?.progression?.chunking?.reading;


        reading.size ? reading.size = size || 0 : reading.chunk_size = size || 0;
        reading.frequency ? reading.frequency = (freq < 250) ? 250 : freq ?? '' : reading.freq = (freq < 250) ? 250 : freq ?? '';
        reading.seed = seed || 0;

        const toggles = document.querySelectorAll('input[type="checkbox"][data-path]');
        toggles.forEach(toggle => {
            const path = toggle.dataset.path.split('.');
            let obj = currentSpec;
            for (let i = 0; i < path.length - 1; i++) {
                if (!(path[i] in obj)) return;
                obj = obj[path[i]];
            }
            const key = path[path.length - 1];
            obj[key] = toggle.checked;

            // currentMenu update
            const fullPath = toggle.dataset.path;
            const matchingItem = currentMenu.find(item => item.path === fullPath);
            if (matchingItem) {
                matchingItem._value = toggle.checked;
            }
        });

        const spec = JSON.parse(editor.getValue());
        // Check if spec has changed
        if(JSON.stringify(spec) == JSON.stringify(currentSpec)){
            return false;
        }
        editor.setValue(JSON.stringify(currentSpec, null, 2), -1);
        return true;
    }


    // Clear the params and the vis 
    function clearParams(){
        if (visContainer) {
            visContainer.innerHTML = ''; 
        }
        frequencyTextarea.value = '';
        seedTextarea.value = '';
        sizeTextarea.value = '';
        editor.setValue("");

        if(advancedViewToggle.checked){
            advancedViewToggle.checked = !advancedViewToggle.checked;
            advancedViewToggle.dispatchEvent(new Event("change"));
        }

        let progress = document.getElementById('progress-container');
        if (progress) {
            progress.innerHTML = '';
        }
    }


    // Run function
    async function run(){
        // Copy in order not to edit the spec
        spec = structuredClone(currentSpec);

        // rendering options
        let rend;
        if (selectedValue == "density-map" || selectedValue == "parallel-coordinates"){
            rend = "canvas"
        } else {
            rend = "svg";
        }

        try{
            result = await vegaEmbed("#vis", spec, {
                tooltip: true,
                renderer: rend
            });

            const detailsToRemove = document.querySelector('details[title="Click to view actions"]');
            if (detailsToRemove) {
                detailsToRemove.remove();
            }

        } catch (e){
            console.error(e);
            throw new Error("Spec not valid:", e)
        }
    }


    // Quality panel handler
    function scaleQualityList() {
        const panel = document.getElementById('quality-panel');
        const list = document.getElementById('quality-list');
        if (!panel || !list) return;

        const panelHeight = panel.clientHeight;
        const contentHeight = list.scrollHeight;

        const scale = Math.min(panelHeight / contentHeight, 1);

        list.style.transform = `scale(${scale})`;
    }

    async function startNode() {
        fetch('/start_server', { method: 'POST' })
            .then(res => res.json())
            .then(console.log);

        if(!server){server = true;}
    }

    function stopNode() {
        fetch('/stop_server', { method: 'POST' })
            .then(res => res.json())
            .then(console.log);
        
        if(server){server = false;}
    }

    window.addEventListener('load', scaleQualityList);
    window.addEventListener('resize', scaleQualityList);



    setGrammarParamsDisabled(true); // Initial state

    // Add .hidden class to your CSS
    const style = document.createElement('style');
    style.innerHTML = `.hidden { display: none !important; }`;
    document.head.appendChild(style);

});
