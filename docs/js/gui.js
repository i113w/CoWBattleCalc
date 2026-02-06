const GUI = {
    isActive: false,
    
    // UI References
    container: document.getElementById('gui-editor-container'),
    jsonContainer: document.getElementById('json-editor-container'),
    teamA: document.getElementById('gui-team-a').querySelector('.stacks-wrapper'),
    teamB: document.getElementById('gui-team-b').querySelector('.stacks-wrapper'),
    globalSettings: document.querySelector('.gui-global-settings'),
    unitsGrid: document.getElementById('units-grid'),
    buildingsGrid: document.getElementById('buildings-grid'),
    
    // Modal Refs
    modal: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    btnSaveModal: document.getElementById('btn-modal-save'),
    
    // Data cache for dropdowns
    availableUnits: [],
    availableBuildings: [],
    currentEditId: null, // ID of unit being edited in modal
    currentEditType: null, // 'unit' or 'building'
};

// --- Initialization ---

function initGUI() {
    // Tab Switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.gui-tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // Add Stack Buttons
    document.querySelector('#gui-team-a .btn-add-stack').onclick = () => addStackCard(GUI.teamA);
    document.querySelector('#gui-team-b .btn-add-stack').onclick = () => addStackCard(GUI.teamB);

    // Modal Events
    document.querySelectorAll('.close-modal').forEach(b => b.onclick = closeModal);
    GUI.btnSaveModal.onclick = saveModalData;
    const searchInput = document.getElementById('unit-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            // 重新获取当前 JSON 数据
            const allUnits = JSON.parse(document.getElementById('input-units').value || "{}");
            
            if (!query) {
                renderUnitsDB(allUnits); 
                return;
            }

            // 过滤逻辑
            const filtered = {};
            Object.keys(allUnits).forEach(key => {
                const u = allUnits[key];
                // 搜索 ID 或 Name
                if (key.toLowerCase().includes(query) || (u.name && u.name.toLowerCase().includes(query))) {
                    filtered[key] = u;
                }
            });
            renderUnitsDB(filtered);
        });
    }
}

// --- Sync: JSON -> GUI ---

function renderGUI() {
    try {
        // 1. Parse all JSONs
        const config = JSON.parse(document.getElementById('input-config').value || "{}");
        const units = JSON.parse(document.getElementById('input-units').value || "{}");
        const buildings = JSON.parse(document.getElementById('input-buildings').value || "{}");

        // Cache keys for dropdowns
        GUI.availableUnits = Object.keys(units);
        GUI.availableBuildings = Object.keys(buildings);

        // 2. Render Battle Config
        renderGlobalSettings(config);
        
        GUI.teamA.innerHTML = '';
        if (config.team_a && config.team_a.stacks) {
            config.team_a.stacks.forEach(s => addStackCard(GUI.teamA, s));
        }

        GUI.teamB.innerHTML = '';
        if (config.team_b && config.team_b.stacks) {
            config.team_b.stacks.forEach(s => addStackCard(GUI.teamB, s));
        }

        // 3. Render DBs
        renderUnitsDB(units);
        renderBuildingsDB(buildings);

    } catch (e) {
        console.error("Render GUI Error:", e);
        alert("Cannot switch to GUI: JSON format is invalid.\nPlease fix JSON errors first.");
        return false; // Fail to switch
    }
    return true; // Success
}

function renderGlobalSettings(config) {
    const isDetailed = config.detailed_output !== false; 

    GUI.globalSettings.innerHTML = `
        <div class="input-group" style="flex:1; max-width:200px">
            <label>Mode</label>
            <select id="gui-mode">
                <option value="LAND_ATTACK">LAND_ATTACK</option>
                <option value="LAND_MEET">LAND_MEET</option>
                <option value="AIR_STRIKE">AIR_STRIKE</option>
            </select>
        </div>
        <div class="input-group" style="flex:0; min-width:100px">
            <label>Rounds</label>
            <input type="number" id="gui-rounds" value="${config.max_rounds || 50}" style="width:80px">
        </div>
        
        <div style="margin-top:15px; display:flex; gap:15px; align-items:center;">
            <label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
                <input type="checkbox" id="gui-random" ${config.enable_randomness !== false ? 'checked' : ''}> 
                Randomness
            </label>
            
            <label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
                <input type="checkbox" id="gui-detailed" ${isDetailed ? 'checked' : ''}> 
                Detailed Logs
            </label>
        </div>
    `;
    
    if (config.battle_mode) document.getElementById('gui-mode').value = config.battle_mode;
}

// --- Sync: GUI -> JSON ---

function syncGuiToJson() {
    if (!GUI.isActive) return;

    // 1. Config
    const config = {
        battle_mode: document.getElementById('gui-mode').value,
        max_rounds: parseInt(document.getElementById('gui-rounds').value) || 50,
        enable_randomness: document.getElementById('gui-random').checked,
        
        detailed_output: document.getElementById('gui-detailed').checked,
        
        team_a: scrapeTeam('Team A', GUI.teamA),
        team_b: scrapeTeam('Team B', GUI.teamB)
    };
    
    document.getElementById('input-config').value = JSON.stringify(config, null, 2);

}

function scrapeTeam(name, container) {
    const stacks = [];
    
    // 遍历每一个 Stack Card
    container.querySelectorAll('.stack-card').forEach(card => {
        const units = [];
        
        // 遍历 Stack 下的每一个 Unit Wrapper
        card.querySelectorAll('.unit-wrapper').forEach(wrapper => {
            // 从 Main Row 读取
            const id = wrapper.querySelector('.u-id').value;
            const count = parseInt(wrapper.querySelector('.u-cnt').value) || 0;
            const hpInput = wrapper.querySelector('.u-hp').value.trim();

            // HP 智能解析逻辑
            let hpObj = {}; 
            if (hpInput.endsWith('%')) {
                // 模式 A: 百分比 (hp_ratio)
                let ratio = parseFloat(hpInput.replace('%', '')) / 100.0;
                if (isNaN(ratio)) ratio = 1.0;
                hpObj.hp_ratio = ratio;
            } else {
                // 模式 B: 尝试解析为绝对数值
                let val = parseFloat(hpInput);
                if (isNaN(val)) {
                    // 解析失败，回退到默认 100%
                    hpObj.hp_ratio = 1.0; 
                } else {
                    // 策略: 只要不带%，就是 current_hp
                    hpObj.current_hp = val;
                }
            }

            // 从 Details Row 读取
            const terrain = parseFloat(wrapper.querySelector('.u-ter').value) || 0.0;
            const isRanged = wrapper.querySelector('.u-ranged').checked;
            const isUltra = wrapper.querySelector('.u-ultra').checked;

            // 组装 Unit 对象
            const unitData = {
                id: id,
                count: count,
                terrain_bonus: terrain,
                ...hpObj // 展开 hp_ratio 或 current_hp
            };

            // 只有为 true 时才写入 JSON，保持整洁
            if (isRanged) unitData.ranged = true;
            if (isUltra) unitData.ultra_ranged = true;

            units.push(unitData);
        });

        // 读取 Stack 属性
        const stackObj = {
            name: card.querySelector('.stack-title-input').value || "Stack",
            core: card.querySelector('.is-core').checked,
            split: card.querySelector('.is-split').checked,
            is_airplane: card.querySelector('.is-air').checked,
            patrol: card.querySelector('.is-patrol').checked,
            units: units
        };
        const targetVal = card.querySelector('.stack-target').value.trim();
        if (targetVal) {
            stackObj.target = targetVal;
        }
        const bId = card.querySelector('.b-id').value;
        if (bId) {
            stackObj.building = {
                id: bId,
                level: parseInt(card.querySelector('.b-lvl').value) || 1
            };
        }
        stacks.push(stackObj);
    });

    return { name: name, stacks: stacks };
}

// ============================================================================
// Component Builders (The "Blocks")
// ============================================================================

function addStackCard(container, data = null) {
    const targetVal = data ? (data.target || data.manual_target_id || "") : "";
    const div = document.createElement('div');
    div.className = 'stack-card';
    
    // 1. 定义所有变量
    const sName = data ? data.name : `Stack ${container.children.length + 1}`;
    const isCore = data ? data.core : false;
    const isSplit = data ? data.split : false;
    const isAir = data ? data.is_airplane : false;
    const isPatrol = data ? data.patrol : false; 
    
    const bId = data && data.building ? data.building.id : "";
    const bLvl = data && data.building ? data.building.level : 1;

    // Build Building Options
    let bOptions = '<option value="">(No Building)</option>';
    GUI.availableBuildings.forEach(b => {
        bOptions += `<option value="${b}" ${b === bId ? 'selected' : ''}>${b}</option>`;
    });

    // 2. 生成 HTML
    div.innerHTML = `
        <div class="stack-header">
            <input type="text" class="stack-title-input" value="${sName}">
            <div class="stack-tags">
                <label class="tag-check ${isCore?'checked':''}"><input type="checkbox" class="is-core" ${isCore?'checked':''}>Core</label>
                <label class="tag-check ${isSplit?'checked':''}"><input type="checkbox" class="is-split" ${isSplit?'checked':''}>Split</label>
                <label class="tag-check ${isAir?'checked':''}"><input type="checkbox" class="is-air" ${isAir?'checked':''}>Air</label>
                <label class="tag-check patrol-tag ${isPatrol?'checked':''}" style="${(isAir || isPatrol) ? '' : 'display:none'}">
                    <input type="checkbox" class="is-patrol" ${isPatrol?'checked':''}>Patrol
                </label>
            </div>
            <button class="btn-del-stack" title="Remove Stack"><i class="fas fa-trash-alt"></i> &times;</button>
        </div>
        
        <div class="stack-meta-row">
            <!-- Building Group -->
            <div class="meta-group">
                <i class="fas fa-home" title="Building"></i>
                <select class="b-id">${bOptions}</select>
                <span style="font-size:0.8rem">Lv</span>
                <input type="number" class="b-lvl" value="${bLvl}" min="1" max="5" style="width:40px">
            </div>
            
            <!-- Target Group -->
            <div class="meta-group">
                <i class="fas fa-crosshairs" style="color:#cc5555" title="Manual Target (Enemy Stack Name)"></i>
                <input type="text" class="stack-target" value="${targetVal}" placeholder="Target Stack Name...">
            </div>
        </div>

        <!-- 原先这里有个 .stack-building-row 导致重复，现已删除 -->

        <div class="unit-list"></div>
        <button class="dashed btn-add-unit">+ Add Unit</button>
    `;

    // 3. 事件绑定
    // Checkbox toggles
    div.querySelectorAll('input[type=checkbox]').forEach(chk => {
        chk.addEventListener('change', (e) => {
            e.target.parentElement.classList.toggle('checked', e.target.checked);
        });
    });

    // Air / Patrol Linkage
    const airChk = div.querySelector('.is-air');
    const patrolLabel = div.querySelector('.patrol-tag');
    const patrolChk = div.querySelector('.is-patrol');

    airChk.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
            patrolLabel.style.display = 'flex';
        } else {
            patrolLabel.style.display = 'none';
            patrolLabel.classList.remove('checked');
            patrolChk.checked = false;
        }
    });

    // Delete Stack
    div.querySelector('.btn-del-stack').onclick = () => div.remove();

    // Add Unit
    const unitList = div.querySelector('.unit-list');
    div.querySelector('.btn-add-unit').onclick = () => addUnitRow(unitList);

    // Initial Units
    if (data && data.units) {
        data.units.forEach(u => addUnitRow(unitList, u));
    }

    container.appendChild(div);
}



function addUnitRow(container, data = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'unit-wrapper';
    
    // --- 1. 数据准备 ---
    let uOptions = '';
    const currentId = data ? data.id : (GUI.availableUnits.length ? GUI.availableUnits[0] : "");
    GUI.availableUnits.forEach(u => {
        uOptions += `<option value="${u}" ${u === currentId ? 'selected' : ''}>${u}</option>`;
    });

    const cnt = data ? data.count : 10;
    
    // HP 智能处理: 优先显示百分比，如果有绝对数值则显示数值
    let hpDisplay = "100%"; // 默认
    if (data) {
        if (data.current_hp !== undefined && data.current_hp !== null) {
            hpDisplay = data.current_hp; // 绝对数值
        } else if (data.hp_ratio !== undefined) {
            hpDisplay = (data.hp_ratio * 100).toFixed(0) + "%"; // 百分比
        }
    }

    const ter = data ? (data.terrain_bonus || 0) : 0;
    const isRanged = data ? (data.ranged || false) : false;
    const isUltra = data ? (data.ultra_ranged || false) : false;

    // --- 2. 生成 HTML ---
    wrapper.innerHTML = `
        <!-- 主行: 核心数据 -->
        <div class="unit-main-row">
            <button class="del-unit" title="Remove Unit">&times;</button>
            <select class="u-id" title="Unit Type">${uOptions}</select>
            <input type="number" class="u-cnt" value="${cnt}" title="Count">
            <input type="text" class="u-hp" value="${hpDisplay}" title="HP (e.g. '100%' or '150')">
            <button class="btn-expand" title="More Options"><i class="fas fa-chevron-down"></i></button>
        </div>

        <!-- 详情行: 扩展数据 -->
        <div class="unit-details-row">
            <div class="terrain-input-group">
                <label>Terrain:</label>
                <input type="number" class="u-ter" value="${ter}" step="0.1" title="Terrain Bonus (e.g. 0.5 for +50%)">
            </div>
            <label class="detail-check-group">
                <input type="checkbox" class="u-ranged" ${isRanged ? 'checked' : ''}> Ranged
            </label>
            <label class="detail-check-group">
                <input type="checkbox" class="u-ultra" ${isUltra ? 'checked' : ''}> Ultra
            </label>
        </div>
    `;

    // --- 3. 事件绑定 ---

    // 删除
    wrapper.querySelector('.del-unit').onclick = () => wrapper.remove();

    // 展开/折叠
    const btnExpand = wrapper.querySelector('.btn-expand');
    const detailsRow = wrapper.querySelector('.unit-details-row');
    btnExpand.onclick = () => {
        detailsRow.classList.toggle('expanded');
        btnExpand.classList.toggle('open');
        // 切换图标方向 (如果用了 FontAwesome 的 class，也可以这里切换 class)
    };

    container.appendChild(wrapper);
}


// ============================================================================
// Database & Modals (Units / Buildings)
// ============================================================================

function renderUnitsDB(unitsData) {
    GUI.unitsGrid.innerHTML = '';
    Object.keys(unitsData).forEach(key => {
        const u = unitsData[key];
        const card = document.createElement('div');
        card.className = 'db-card';
        card.innerHTML = `
            <h4>${u.name}</h4>
            <p>HP: ${u.hp}</p>
            <span class="armor-badge">${u.armor_type}</span>
        `;
        card.onclick = () => openUnitModal(key, u);
        GUI.unitsGrid.appendChild(card);
    });
}

function renderBuildingsDB(buildingsData) {
    GUI.buildingsGrid.innerHTML = '';
    Object.keys(buildingsData).forEach(key => {
        const b = buildingsData[key];
        const card = document.createElement('div');
        card.className = 'db-card';
        card.innerHTML = `
            <h4>${key}</h4>
            <p>Levels: ${b.levels.length}</p>
        `;
        card.onclick = () => openBuildingModal(key, b); // Simplified for now
        GUI.buildingsGrid.appendChild(card);
    });
}
function openBuildingModal(id, data) {
    GUI.currentEditId = id;
    GUI.currentEditType = 'building';
    GUI.modalTitle.textContent = `Edit Building: ${id}`;
    GUI.modal.classList.remove('hidden');

    // 辅助函数: 生成等级行
    const renderLevels = (levels) => {
        return levels.map((l, idx) => {
            const hp = l.hp !== undefined ? l.hp : (l.hp_add || 0);
            const mit = l.mitigation !== undefined ? l.mitigation : (l.mitigation_add || 0);
            
            return `
            <div class="form-row level-row" style="display:flex; align-items:center; gap:8px;">
                <span class="lvl-idx" style="min-width: 35px; font-weight:bold;">Lv ${l.level || (idx + 1)}</span>
                
                <div style="display:flex; gap:10px; flex:1;">
                    <label style="display:flex; align-items:center; gap:5px; flex:1;">
                        HP: <input type="number" class="l-hp" value="${hp}" style="width:100%">
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; flex:1;">
                        Mit%: <input type="number" class="l-mit" step="0.01" max="1" value="${mit}" style="width:100%">
                    </label>
                </div>
                
                <button class="btn-icon del-lvl" onclick="this.parentElement.remove()" style="color:#d00; font-size:1.2rem;">&times;</button>
            </div>
            `;
        }).join('');
    };

    const levelsData = data.levels || data.levels_config || [];

    GUI.modalBody.innerHTML = `
        <div class="form-row">
            <label>Display Name</label>
            <input type="text" id="m-b-name" value="${data.name}">
        </div>
        <h4>Levels Configuration</h4>
        <div id="m-levels-container" style="display:flex; flex-direction:column; gap:8px; margin-bottom:15px">
            ${renderLevels(levelsData)}
        </div>
        <button class="dashed" id="btn-add-level">+ Add Level</button>
    `;

    // 绑定添加等级按钮事件
    document.getElementById('btn-add-level').onclick = () => {
        const container = document.getElementById('m-levels-container');
        const nextLv = container.querySelectorAll('.level-row').length + 1;
        const div = document.createElement('div');
        div.className = 'form-row level-row';
        
        div.style.cssText = "display:flex; align-items:center; gap:8px;";
        
        div.innerHTML = `
            <span class="lvl-idx" style="min-width: 35px; font-weight:bold;">Lv ${nextLv}</span>
            <div style="display:flex; gap:10px; flex:1;">
                <label style="display:flex; align-items:center; gap:5px; flex:1;">
                    HP: <input type="number" class="l-hp" value="0" style="width:100%">
                </label>
                <label style="display:flex; align-items:center; gap:5px; flex:1;">
                    Mit%: <input type="number" class="l-mit" step="0.01" max="1" value="0.0" style="width:100%">
                </label>
            </div>
            <button class="btn-icon del-lvl" onclick="this.parentElement.remove()" style="color:#d00; font-size:1.2rem;">&times;</button>
        `;
        container.appendChild(div);
    };
}

function saveModalData() {
    // === Case A: Unit ===
    if (GUI.currentEditType === 'unit') {
        const id = GUI.currentEditId;
        const newUnit = {
            name: document.getElementById('m-u-name').value,
            hp: parseFloat(document.getElementById('m-u-hp').value),
            armor_type: document.getElementById('m-u-armor').value,
            attack: {},
            defense: {}
        };
        
        document.querySelectorAll('#m-atk-col input').forEach(inp => {
            if (parseFloat(inp.value) > 0) newUnit.attack[inp.dataset.armor] = parseFloat(inp.value);
        });
        document.querySelectorAll('#m-def-col input').forEach(inp => {
            if (parseFloat(inp.value) > 0) newUnit.defense[inp.dataset.armor] = parseFloat(inp.value);
        });

        const units = JSON.parse(document.getElementById('input-units').value);
        units[id] = newUnit;
        document.getElementById('input-units').value = JSON.stringify(units, null, 2);
        renderUnitsDB(units);
    } 
    // === Case B: Building ===
    else if (GUI.currentEditType === 'building') {
        const id = GUI.currentEditId;
        const newLevels = [];
        
        const rows = document.querySelectorAll('#m-levels-container .level-row');
        rows.forEach((row, idx) => {
            newLevels.push({
                level: idx + 1,
                hp: parseFloat(row.querySelector('.l-hp').value) || 0,
                mitigation: parseFloat(row.querySelector('.l-mit').value) || 0
            });
        });

        const newBuilding = {
            name: document.getElementById('m-b-name').value,
            levels: newLevels
        };

        const buildings = JSON.parse(document.getElementById('input-buildings').value);
        buildings[id] = newBuilding;
        document.getElementById('input-buildings').value = JSON.stringify(buildings, null, 2);
        renderBuildingsDB(buildings);
    }
    
    closeModal();
}



// --- Modal Logic ---

function closeModal() {
    GUI.modal.classList.add('hidden');
}

function openUnitModal(id, data) {
    GUI.currentEditId = id;
    GUI.currentEditType = 'unit';
    GUI.modalTitle.textContent = `Edit Unit: ${id}`;
    GUI.modal.classList.remove('hidden');
    
    // Armor Types for dropdown
    const armors = ["Unarmored", "Light Armor", "Heavy Armor", "Air", "Ship", "Submarine", "Building"];
    let armorOpts = armors.map(a => `<option value="${a}" ${a === data.armor_type ? 'selected' : ''}>${a}</option>`).join('');

    // Helper to generate damage rows
    const renderDmgRows = (values) => {
        return armors.map(a => `
            <div class="dmg-row">
                <span>${a}</span>
                <input type="number" step="0.1" data-armor="${a}" value="${values[a] || 0}">
            </div>
        `).join('');
    };

    GUI.modalBody.innerHTML = `
        <div class="form-grid">
            <div class="form-row">
                <label>Display Name</label>
                <input type="text" id="m-u-name" value="${data.name}">
            </div>
            <div class="form-row">
                <label>HP per Unit</label>
                <input type="number" id="m-u-hp" value="${data.hp}">
            </div>
            <div class="form-row">
                <label>Armor Type</label>
                <select id="m-u-armor">${armorOpts}</select>
            </div>
        </div>
        <div class="damage-table">
            <div class="dmg-col" id="m-atk-col">
                <h4>Attack</h4>
                ${renderDmgRows(data.attack)}
            </div>
            <div class="dmg-col" id="m-def-col">
                <h4>Defense</h4>
                ${renderDmgRows(data.defense)}
            </div>
        </div>
    `;
}




function addNewUnit() {
    const id = prompt("Enter new Unit ID (e.g. Heavy_Tank_Lvl1):");
    if (!id) return;
    openUnitModal(id, { name: id, hp: 10, armor_type: "Unarmored", attack: {}, defense: {} });
}
function addNewBuilding() {
    const id = prompt("Enter new Building ID (e.g. Supply_Depot):");
    if (!id) return;
    const defaultBuilding = {
        name: id,
        levels: [
            { level: 1, hp: 100, mitigation: 0.0 }
        ]
    };
    openBuildingModal(id, defaultBuilding);
}
window.addNewBuilding = addNewBuilding;

// Global Export
window.initGUI = initGUI;
window.renderGUI = renderGUI;
window.syncGuiToJson = syncGuiToJson;