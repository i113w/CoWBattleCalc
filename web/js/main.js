/**
 * main.js - UI Logic
 */

// Key for localStorage
const STORAGE_KEYS = {
    UNITS: "cow_units_json",
    BUILDINGS: "cow_buildings_json",
    CONFIG: "cow_config_json"
};

let currentLang = 'en'; // Default English

// DOM Elements
const el = {
    selScenario: document.getElementById('sel-scenario'),
    units: document.getElementById('input-units'),
    buildings: document.getElementById('input-buildings'),
    config: document.getElementById('input-config'),
    log: document.getElementById('output-log'),
    btnRun: document.getElementById('btn-run'),
    btnClear: document.getElementById('btn-clear'),
    btnLoad: document.getElementById('btn-load'),
    btnReset: document.getElementById('btn-reset'),
    btnLang: document.getElementById('btn-lang'),
    labels: document.querySelectorAll('[data-i18n]')
};

// --- Initialization ---
el.btnModeJson = document.getElementById('btn-mode-json');
el.btnModeGui = document.getElementById('btn-mode-gui');
el.jsonContainer = document.getElementById('json-editor-container');
el.guiContainer = document.getElementById('gui-editor-container');

function init() {
    loadFromStorage();
    initScenarioDropdown();
    updateUIText();

    // Init GUI Logic
    if (window.initGUI) window.initGUI();

    // Mode Switching
    el.btnModeJson.onclick = () => switchMode('json');
    el.btnModeGui.onclick = () => switchMode('gui');

    // Auto-save listeners (Existing)
    ['input', 'change'].forEach(evt => {
        el.units.addEventListener(evt, () => saveToStorage());
        el.buildings.addEventListener(evt, () => saveToStorage());
        el.config.addEventListener(evt, () => saveToStorage());
    });

    window.currentLang = currentLang;
}

function switchMode(mode) {
    if (mode === 'gui') {
        // JSON -> GUI
        if (renderGUI()) {
            el.jsonContainer.style.display = 'none';
            el.guiContainer.style.display = 'block';
            
            el.btnModeJson.classList.remove('active');
            el.btnModeGui.classList.add('active');
            GUI.isActive = true;
        }
    } else {
        // GUI -> JSON
        syncGuiToJson();
        
        el.guiContainer.style.display = 'none';
        el.jsonContainer.style.display = 'block'; 
        
        el.btnModeGui.classList.remove('active');
        el.btnModeJson.classList.add('active');
        GUI.isActive = false;
        
        void el.jsonContainer.offsetHeight;

        requestAnimationFrame(() => {
            const textareas = el.jsonContainer.querySelectorAll('textarea');
            textareas.forEach(ta => {
                ta.style.display = 'none';
                void ta.offsetHeight; 
                ta.style.display = 'block'; 
            });
            
            window.dispatchEvent(new Event('resize'));
            
            requestAnimationFrame(() => {
                 void el.jsonContainer.offsetHeight;
            });
        });

        saveToStorage();
    }
}
const originalRunHandler = runSimulationHandler;
runSimulationHandler = function () {
    if (GUI.isActive) {
        syncGuiToJson(); // Force sync before running
    }
    originalRunHandler();
}

el.btnRun.onclick = runSimulationHandler;

function updateUIText() {
    // Buttons and Labels
    el.labels.forEach(dom => {
        const key = dom.getAttribute('data-i18n');
        if (I18N[currentLang][key]) {
            dom.textContent = I18N[currentLang][key];
        }
    });
    el.btnLang.textContent = currentLang === 'en' ? "中文" : "English";
}

function toggleLang() {
    currentLang = currentLang === 'en' ? 'zh' : 'en';
    window.currentLang = currentLang; 
    updateUIText();
}

// --- Storage & Data ---

function saveToStorage() {
    localStorage.setItem(STORAGE_KEYS.UNITS, el.units.value);
    localStorage.setItem(STORAGE_KEYS.BUILDINGS, el.buildings.value);
    localStorage.setItem(STORAGE_KEYS.CONFIG, el.config.value);
}

function loadFromStorage() {
    const u = localStorage.getItem(STORAGE_KEYS.UNITS);
    const b = localStorage.getItem(STORAGE_KEYS.BUILDINGS);
    const c = localStorage.getItem(STORAGE_KEYS.CONFIG);

    // If completely empty, set empty string (or empty object string)
    el.units.value = u || "";
    el.buildings.value = b || "";
    el.config.value = c || "";
}
function initScenarioDropdown() {
    if (!window.COW_EXAMPLES || !window.COW_EXAMPLES.scenarios) return;

    el.selScenario.innerHTML = "";
    window.COW_EXAMPLES.scenarios.forEach((sc, index) => {
        let opt = document.createElement("option");
        opt.value = index;
        opt.textContent = sc.name;
        opt.title = sc.description; // 鼠标悬停显示描述
        el.selScenario.appendChild(opt);
    });
}
function loadExamples() {
    if (!window.COW_EXAMPLES) {
        alert("Example data not found!");
        return;
    }

    const ex = window.COW_EXAMPLES;
    // 获取当前选中的场景索引
    const idx = el.selScenario.value || 0;
    const selectedScenario = ex.scenarios[idx];

    if (confirm(`Load scenario: "${selectedScenario.name}"?\nThis will overwrite current data.`)) {
        // 1. 总是加载 Units 和 Buildings (因为它们是通用的)
        el.units.value = JSON.stringify(ex.units, null, 2);
        el.buildings.value = JSON.stringify(ex.buildings, null, 2);

        // 2. 加载选中的 Config
        el.config.value = JSON.stringify(selectedScenario.data, null, 2);

        saveToStorage();
    }
}

function resetToEmpty() {
    if (confirm("Clear all inputs?")) {
        el.units.value = "{}";
        el.buildings.value = "{}";
        el.config.value = "{}";
        saveToStorage();
    }
}

// --- Validation & Running ---

function safeParse(jsonStr, fieldName) {
    try {
        return jsonStr.trim() === "" ? {} : JSON.parse(jsonStr);
    } catch (e) {
        alert(I18N[currentLang].err_json.replace("{field}", fieldName).replace("{msg}", e.message));
        return null;
    }
}

function runSimulationHandler() {
    if (window.GUI && GUI.isActive) {
        syncGuiToJson(); 
    }

    el.log.textContent = "Running simulation...";

    const uData = safeParse(el.units.value, I18N[currentLang].lbl_units);
    const bData = safeParse(el.buildings.value, I18N[currentLang].lbl_buildings);
    const cData = safeParse(el.config.value, I18N[currentLang].lbl_config);

    if (!uData || !bData || !cData) return;

    const logBuffer = [];

    setEngineConfig(currentLang, (msg) => {
        logBuffer.push(msg);
    });

    setTimeout(() => {
        try {
            if (!cData.team_a || !cData.team_b) {
                throw new Error("Config must contain 'team_a' and 'team_b'");
            }

            const startTime = performance.now();

            runEngine(uData, bData, cData.team_a, cData.team_b, cData);

            const endTime = performance.now();
            const duration = (endTime - startTime).toFixed(2);

            el.log.textContent = logBuffer.join("\n");
            console.log(`Simulation finished in ${duration}ms`);

        } catch (e) {
            console.error(e);
            el.log.textContent = `\n[SIMULATION ERROR]\n${e.message}\n\nStack Trace:\n${e.stack}`;
        }

        el.log.scrollTop = el.log.scrollHeight;

    }, 10);
}




// --- Event Binding ---
el.btnRun.onclick = runSimulationHandler;
el.btnLoad.onclick = loadExamples;
el.btnReset.onclick = resetToEmpty;
el.btnClear.onclick = () => el.log.textContent = "";
el.btnLang.onclick = toggleLang;

// Start
init();