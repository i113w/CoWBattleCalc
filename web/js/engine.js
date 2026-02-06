/**
 * cow_core.js - DEBUG VERSION
 * 包含详细的调试日志，用于排查 Split/Target 失效问题
 */

// ============================================================================
// 1. Constants & Enums
// ============================================================================

const CASUALTY_THRESHOLD = 0.50;
const RANDOM_MIN = 0.8;
const RANDOM_MAX = 1.2;
const CORE_DMG_MULTI = 1.15;
const CORE_MITIGATION_ADD = 0.15;

const ArmorType = { 
    UNARMORED: "Unarmored", 
    LIGHT_ARMOR: "Light Armor", 
    HEAVY_ARMOR: "Heavy Armor", 
    AIR: "Air", 
    SHIP: "Ship", 
    SUBMARINE: "Submarine", 
    BUILDING: "Building" 
};

const DamageType = { ATTACK: "Attack", DEFENSE: "Defense" };
const BattleMode = { LAND_ATTACK: "LAND_ATTACK", LAND_MEET: "LAND_MEET", AIR_STRIKE: "AIR_STRIKE" };

// ============================================================================
// 2. Logger Helpers
// ============================================================================

let CURRENT_LANG = 'en';
let LOG_CALLBACK = null;
let IS_DEBUG = false; 

function setEngineConfig(lang, logCallback) {
    CURRENT_LANG = lang;
    LOG_CALLBACK = logCallback;
}

function getLogString(key, params = {}) {
    if (!I18N || !I18N[CURRENT_LANG]) return key;
    let template = I18N[CURRENT_LANG].logs[key] || key;
    return template.replace(/{(\w+)}/g, (_, k) => params[k] !== undefined ? params[k] : `{${k}}`);
}

function log(key, params = {}) {
    let msg = getLogString(key, params);
    if (LOG_CALLBACK) LOG_CALLBACK(msg);
    return msg;
}

function logRaw(msg) {
    if (LOG_CALLBACK) LOG_CALLBACK(msg);
}

// ★★★ DEBUG LOGGER ★★★
function debug(msg) {
    // 既输出到控制台 F12，也输出到页面日志
    if (!IS_DEBUG) return; 
    
    console.log(`[DEBUG] ${msg}`); 
    if (LOG_CALLBACK) LOG_CALLBACK(`[DEBUG] ${msg}`);
}

// ============================================================================
// 3. Math Helpers
// ============================================================================

function randomGauss(mu, sigma) {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); 
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    return num * sigma + mu;
}

// ============================================================================
// 4. Classes
// ============================================================================

class Building {
    constructor(name, levels_config, current_hp) {
        this.name = name;
        this.levels_config = levels_config;
        this.current_hp = current_hp;
        this.initial_hp = current_hp;
    }
    get max_hp() { return this.levels_config.reduce((s, c) => s + c.hp_add, 0); }
    
    get_current_mitigation() {
        if (!this.levels_config.length) return 0.0;
        if (this.current_hp < this.levels_config[0].hp_add - 1e-9) return 0.0;
        let total = 0.0, temp = this.current_hp;
        for (let cfg of this.levels_config) {
            let l_max = cfg.hp_add;
            if (temp >= l_max) { total += cfg.mitigation_add; temp -= l_max; }
            else {
                if (cfg.level > 1) total += (0.2 + 0.8 * (temp / l_max)) * cfg.mitigation_add;
                break;
            }
        }
        return total;
    }
    take_damage(d) { this.current_hp = Math.max(0.0, this.current_hp - d); }
}

class UnitGroup {
    constructor(name, stats, count, current_hp, terrain_bonus, is_core, is_ranged, is_ultra) {
        this.name = name; this.stats = stats; this.count = count;
        this.max_hp_per_unit = stats.hp; this.terrain_bonus = terrain_bonus || 0;
        this.is_core = is_core; this.is_ranged = is_ranged; this.is_ultra_ranged = is_ultra;
        this.current_hp = current_hp !== null ? current_hp : count * stats.hp;
        this.initial_count = count; this.initial_hp = this.current_hp;
        this.last_round_dead = 0; this.last_round_loss = 0;
    }
    
    get total_max_hp() { return this.count * this.max_hp_per_unit; }
    get hp_ratio() { return this.count > 0 ? this.current_hp / (this.count * this.max_hp_per_unit) : 0; }
    
    get_unit_damage(type, armor) {
        if (this.count <= 0) return 0;
        let table = (type === DamageType.ATTACK) ? this.stats.attack : this.stats.defense;
        let base = table[armor] || 0;
        let eff = 0.2 + 0.8 * this.hp_ratio;
        return base * eff * (1 + this.terrain_bonus) * (this.is_core ? CORE_DMG_MULTI : 1.0);
    }
    
    apply_damage(amt) {
        if (amt <= 0 || this.count <= 0) return;
        let dead = 0;
        if (this.hp_ratio < CASUALTY_THRESHOLD) {
            let avg = this.current_hp / this.count;
            if (avg > 0) dead = Math.min(Math.floor(amt / avg), this.count);
        }
        let real = Math.min(this.current_hp, amt);
        this.current_hp -= real; this.last_round_loss += real;
        if (dead > 0) { this.count -= dead; this.last_round_dead += dead; }
        if (this.current_hp <= 1e-5) { this.current_hp = 0; this.count = 0; }
        else if (this.count === 0) this.current_hp = 0;
    }
    
    reset_round_stats() { this.last_round_dead = 0; this.last_round_loss = 0; }
}

class Stack {
    constructor(name, groups, b, core, split, air, target, patrol) {
        this.name = name; this.groups = groups; this.building = b;
        this.is_core = core; this.is_split = split; this.is_air = air; 
        this.manual_target_id = target;
        this.is_patrol = patrol || false; 
    }
    get total_hp() { return this.groups.reduce((s, g) => s + g.current_hp, 0); }
    get total_count() { return this.groups.reduce((s, g) => s + g.count, 0); }
    get is_alive() { return this.total_hp > 0 && this.groups.some(g => g.count > 0); }
    
    // ★ Debug Info here
    get has_ultra() { return this.groups.some(g => g.is_ultra_ranged && g.count > 0); }
    get has_ranged() { 
        // 打印每个单位的 ranged 状态
        // this.groups.forEach(g => console.log(`Group ${g.name}: ranged=${g.is_ranged}`));
        return this.groups.some(g => g.is_ranged && g.count > 0); 
    }
    
    get_present_armor_types() {
        let t = new Set();
        this.groups.forEach(g => { if(g.count>0 && g.current_hp>0) t.add(g.stats.armor_type); });
        return t;
    }
    
    calculate_output(type, armor, limit, only_ranged) {
        let cands = [];
        for (let g of this.groups) {
            if (only_ranged && !(g.is_ranged || g.is_ultra_ranged)) continue;
            let d = g.get_unit_damage(type, armor);
            if (d > 0 && g.count > 0) cands.push({d, c: g.count});
        }
        cands.sort((a,b) => b.d - a.d);
        let total = 0, left = limit;
        for (let i of cands) {
            if (left<=0) break;
            let take = Math.min(left, i.c);
            total += take * i.d; left -= take;
        }
        return total;
    }
    
    receive_damage_distribution(pots, total_cnt) {
        if (total_cnt <= 0) return;
        let mit = this.building ? this.building.get_current_mitigation() : 0;
        if (this.is_core) mit += CORE_MITIGATION_ADD;
        mit = Math.min(mit, 1.0);
        for (let g of this.groups) {
            if (g.count > 0 && g.current_hp > 0) {
                let p = pots[g.stats.armor_type] || 0;
                g.apply_damage((p * (g.count / total_cnt)) * (1.0 - mit));
            }
        }
    }
}

class Army {
    constructor(name, stacks) { this.name = name; this.stacks = stacks; }
    get total_hp() { return this.stacks.reduce((s,st)=>s+st.total_hp, 0); }
    get total_count() { return this.stacks.reduce((s,st)=>s+st.total_count, 0); }
    get is_alive() { return this.stacks.some(s=>s.is_alive); }
    
    reset_round_stats() { this.stacks.forEach(s=>s.groups.forEach(g=>g.reset_round_stats())); }
    
    get_all_armor_types() {
        let t = new Set();
        this.stacks.forEach(s=>s.get_present_armor_types().forEach(x=>t.add(x)));
        return t;
    }

    compute_army_blob_output(type, armor, limit = 10) {
        if (!this.is_alive) return 0;
        let all = []; 
        this.stacks.forEach(s => { if(s.is_alive) all.push(...s.groups); });
        return new Stack("Temp", all, null, false, false, false, null, false).calculate_output(type, armor, limit, false);
    }

    receive_damage(pots, b_dmg, primary_target = null) {
        // 1. 定义三个池子
        let pool_air = [];
        let pool_frontline = []; // 非 Split 的地面单位 (肉盾)
        let pool_backline = [];  // Split 的地面单位 (炮兵/防空等)

        this.stacks.forEach(s => {
            if (!s.is_alive) return;
            if (s.is_air) {
                pool_air.push(s);
            } else if (s.is_split) {
                pool_backline.push(s);
            } else {
                pool_frontline.push(s);
            }
        });

        // 2. 确定地面伤害由哪个池子承担
        // 逻辑: 
        // - 如果目标是空军 -> 不处理地面 (由下面空军逻辑处理)
        // - 如果目标是后排(Split) -> 说明是"狙击"或"前排已死" -> 伤害给后排池
        // - 如果目标是前排(!Split) -> 伤害给前排池
        // - 默认情况(兜底) -> 有前排打前排，没前排打后排
        
        let target_ground_pool = [];

        if (primary_target && primary_target.is_air) {
            target_ground_pool = []; 
        } else if (primary_target && primary_target.is_split) {
            // 显式锁定了后排 (通过 Manual Target 或 索敌机制)
            // 伤害绕过前排，直接打后排
            target_ground_pool = pool_backline;
        } else {
            // 普通情况 (目标是前排，或者无明确目标)
            // 只有当前排死光了，才轮到后排吃伤害
            if (pool_frontline.length > 0) {
                target_ground_pool = pool_frontline;
            } else {
                target_ground_pool = pool_backline;
            }
        }

        // 3. 执行伤害分发 (地面)
        if (target_ground_pool.length > 0) {
            let total_c = target_ground_pool.reduce((sum, s) => sum + s.total_count, 0);
            target_ground_pool.forEach(s => {
                s.receive_damage_distribution(pots, total_c);
                if (s.building) s.building.take_damage(b_dmg);
            });
        }

        // 4. 执行伤害分发 (空军 - 独立池)
        if (pool_air.length > 0) {
            let total_c = pool_air.reduce((sum, s) => sum + s.total_count, 0);
            pool_air.forEach(s => s.receive_damage_distribution(pots, total_c));
        }
    }
}

// ============================================================================
// 5. Core Logic Functions (V2)
// ============================================================================

function isStackGroundedPlane(stack, is_passive_defender) {
    if (!stack.is_air) return false;
    if (is_passive_defender && stack.manual_target_id === "") return true; // Fix: check empty string too
    if (is_passive_defender && stack.manual_target_id === null) return true;
    return false;
}

function selectTarget(attacker, enemy_army, is_enemy_passive_defender) {
    let can_attack_flying = attacker.is_air;
    
    // 1. Manual
    if (attacker.manual_target_id) {
        debug(`Stack '${attacker.name}' looking for manual target: '${attacker.manual_target_id}'`);
        let s = enemy_army.stacks.find(x => x.name === attacker.manual_target_id && x.is_alive);
        if (s) {
            let target_is_grounded = isStackGroundedPlane(s, is_enemy_passive_defender);
            let target_is_flying = s.is_air && !target_is_grounded;
            if (!(target_is_flying && !can_attack_flying)) {
                debug(`  -> Found valid manual target: ${s.name}`);
                return s;
            } else {
                debug(`  -> Manual target ${s.name} is flying and attacker cannot hit flying. Skipping.`);
            }
        } else {
            debug(`  -> Manual target not found or dead.`);
        }
    }

    // 2. Auto
    let p1=[], p2=[], p3=[], p4=[];
    enemy_army.stacks.forEach(s => {
        if (!s.is_alive) return;
        let is_grounded = isStackGroundedPlane(s, is_enemy_passive_defender);
        if (s.is_air) {
            if (is_grounded) p3.push(s);
            else if (can_attack_flying) p4.push(s);
        } else if (s.is_split) {
            p2.push(s);
        } else {
            p1.push(s);
        }
    });

    if (p1.length) return p1[0];
    if (p2.length) {
        if (attacker.has_ranged && !attacker.has_ultra) {
            let valid = p2.find(s => !s.has_ultra);
            if (valid) return valid;
        } else return p2[0];
    }
    if (p3.length) return p3[0];
    if (p4.length) return p4[0];
    return null;
}

function resolveAtomicClash(active_stack, target_stack, target_army, active_ref, atk_factor, def_factor, is_target_passive) {
    if (!active_stack.is_alive || !target_stack.is_alive) return;

    debug(`CLASH START: ${active_stack.name} vs ${target_stack.name}`);

    // --- Validity Check ---
    let target_is_grounded = isStackGroundedPlane(target_stack, is_target_passive);
    let target_is_flying = target_stack.is_air && !target_is_grounded;
    if (target_is_flying && !active_stack.is_air) {
        debug(`  -> Invalid: Ground attacking Flying. Abort.`);
        return;
    }

    // --- Patrol Parameters ---
    let is_patrol_active = active_stack.is_patrol && active_stack.is_air;
    let iterations = is_patrol_active ? 2 : 1;
    let damage_modifier = is_patrol_active ? 0.5 : 1.0;

    // --- Ranged / Split Logic (Debug) ---
    let is_ranged_free_hit = false;
    if (active_stack.is_split) {
        if (active_stack.has_ranged || active_stack.has_ultra) {
            is_ranged_free_hit = true;
            debug(`  -> Split Active (Ranged Mode): Free Hit!`);
        } else {
            debug(`  -> Split Active (Melee Mode): Normal Clash.`);
        }
    }

    // --- Execution Loop ---
    for (let i = 0; i < iterations; i++) {
        if (!active_stack.is_alive || !target_stack.is_alive) break;

        // Calc Firepower
        let atk_map = {};
        let only_ranged = is_ranged_free_hit; 
        
        let target_armors = target_army.get_all_armor_types();
        target_armors.forEach(armor => {
            let base = active_stack.calculate_output(DamageType.ATTACK, armor, 10, only_ranged);
            atk_map[armor] = base * atk_factor * damage_modifier;
        });
        debug(`  -> Output Dmg: ${JSON.stringify(atk_map)}`);

        // Defense Logic
        let def_map = {};
        let has_defense = false;

        if (is_ranged_free_hit) {
            has_defense = false;
        } else if (target_is_grounded) {
            if (active_stack.is_air && !is_patrol_active) {
                // Free hit vs grounded
            } else {
                has_defense = true;
            }
        } else {
            has_defense = true;
        }

        if (has_defense) {
            let active_armors = active_stack.get_present_armor_types();
            active_armors.forEach(armor => {
                let base = target_army.compute_army_blob_output(DamageType.DEFENSE, armor, 10);
                def_map[armor] = base * def_factor * damage_modifier;
            });
            debug(`  -> Defense Dmg: ${JSON.stringify(def_map)}`);
        }

        // Apply Damage
        let atk_b_dmg = 0.0; // Simplify building dmg for debug
        
        target_army.receive_damage(atk_map, atk_b_dmg);
        if (has_defense) {
            active_stack.receive_damage_distribution(def_map, active_stack.total_count);
        }
    }
}

// ============================================================================
// 6. Builders & Main Loop
// ============================================================================

function buildArmy(conf, u_db, b_db) {
    let stacks = [];
    let s_data = conf.units ? [{ name: "Main", units: conf.units, building: conf.building, core: conf.core }] : (conf.stacks || []);
    
    for (let s of s_data) {
        let b_obj = null;
        if (s.building && b_db[s.building.id]) {
            let raw = b_db[s.building.id], valid = raw.levels.filter(l => l.level <= s.building.level);
            valid.sort((a,b)=>a.level-b.level);
            if (valid.length) {
                let cls_lvls = valid.map(l=>({level:l.level, hp_add:l.hp, mitigation_add:l.mitigation}));
                let cur = s.building.current_hp != null ? parseFloat(s.building.current_hp) : cls_lvls.reduce((sum,c)=>sum+c.hp_add,0);
                b_obj = new Building(s.building.id, cls_lvls, cur);
            }
        }
        let grps = [];
        for (let u of s.units || []) {
            if (u_db[u.id]) {
                let d = u_db[u.id];
                let cnt = u.count;
                let hp = (u.current_hp != null) ? parseFloat(u.current_hp) : (u.hp_ratio != null ? cnt * d.hp * u.hp_ratio : cnt * d.hp);
                
                // Debug Check: Ranged property
                let is_u = u.ultra_ranged || false;
                let is_r = u.ranged || is_u;
                // debug(`Building Unit ${d.name}: JSON ranged=${u.ranged}, Final is_r=${is_r}`);

                grps.push(new UnitGroup(d.name, {name:d.name, hp:d.hp, armor_type:d.armor_type, attack:d.attack, defense:d.defense}, cnt, hp, parseFloat(u.terrain_bonus), s.core, is_r, is_u));
            }
        }
        stacks.push(new Stack(s.name || "Stack", grps, b_obj, s.core, s.split, s.is_airplane, s.target, s.patrol));
    }
    return new Army(conf.name || "Army", stacks);
}

function runEngine(u_db, b_db, conf_a, conf_b, battle_config) {
    let army_a = buildArmy(conf_a, u_db, b_db);
    let army_b = buildArmy(conf_b, u_db, b_db);
    let mode = battle_config.battle_mode || "LAND_ATTACK";
    let rounds = battle_config.max_rounds || 50;
    let rnd = battle_config.enable_randomness !== false;
    let det = battle_config.detailed_output || false;
    IS_DEBUG = det; 

    log("start", { a: army_a.name, b: army_b.name });
    log("mode", { mode: mode, rnd: rnd });

    for (let r = 1; r <= rounds; r++) {
        if (!army_a.is_alive || !army_b.is_alive) break;
        army_a.reset_round_stats(); army_b.reset_round_stats();
        
        let fa = 1.0, fd = 1.0;
        if (rnd) {
            fa = Math.max(RANDOM_MIN, Math.min(RANDOM_MAX, randomGauss(1.0, 0.1)));
            fd = Math.max(RANDOM_MIN, Math.min(RANDOM_MAX, randomGauss(1.0, 0.1)));
        }

        log("round", { r: r });
        
        // Queue Logic
        let q = [];
        let aa = army_a.stacks.filter(s=>s.is_alive);
        // Debug: why is defender not added?
        // LAND_ATTACK: Defender adds if split, air, or manual target
        let bb = [];
        if (mode === BattleMode.LAND_MEET) {
            bb = army_b.stacks.filter(s=>s.is_alive);
        } else {
            army_b.stacks.forEach(s => {
                if (s.is_alive) {
                    if (s.is_split || s.is_air || s.manual_target_id) {
                        bb.push(s);
                    } else {
                        // debug(`Skipping defender stack '${s.name}' from active queue (No Split/Air/Target)`);
                    }
                }
            });
        }
        
        let ml = Math.max(aa.length, bb.length);
        for(let i=0; i<ml; i++) {
            if(i<aa.length) q.push({act:aa[i], tgt:army_b, ref:army_a});
            if(i<bb.length) q.push({act:bb[i], tgt:army_a, ref:army_b});
        }

        for (let task of q) {
            // debug(`Processing Task: ${task.act.name} (Split=${task.act.is_split}, Ranged=${task.act.has_ranged}, Target=${task.act.manual_target_id})`);
            
            if (task.act.is_alive && task.tgt.is_alive) {
                let is_pas = (mode === BattleMode.LAND_ATTACK && task.tgt === army_b);
                
                let t_stack = selectTarget(task.act, task.tgt, is_pas);
                
                if (t_stack) {
                    // debug(`  -> Target Selected: ${t_stack.name}`);
                    resolveAtomicClash(task.act, t_stack, task.tgt, task.ref, fa, fd, is_pas);
                } else {
                    debug(`  -> No Valid Target Found for ${task.act.name}`);
                }
            }
        }

        // Print Round
        [army_a, army_b].forEach(a => {
            log("details", {name: a.name});
            let any = false;
            a.stacks.forEach(s => s.groups.forEach(g => {
                if (det || g.last_round_loss > 0.001 || g.last_round_dead > 0) {
                    any = true;
                    let d_str = g.last_round_dead > 0 ? ` ☠️ ${g.last_round_dead}` : "";
                    let stat = `HP ${g.current_hp.toFixed(2)}/${g.total_max_hp.toFixed(2)} (${(g.hp_ratio*100).toFixed(2)}%)`;
                    logRaw(`    * [${s.name}] ${g.name.padEnd(20)} | ${stat.padEnd(25)} | ` + getLogString("loss_str", {loss: g.last_round_loss.toFixed(2), dead: d_str}));
                }
            }));
            if (!any && !det) log("no_loss");
        });

        [army_a, army_b].forEach(a => {
            let bstr = "";
            a.stacks.forEach(s => { if(s.building) bstr += ` | ${s.building.name}(${(s.building.get_current_mitigation()*100).toFixed(2)}%)`; });
            log("summary", {name: a.name, hp: a.total_hp.toFixed(2), count: a.total_count, bld: bstr});
        });
    }

    // Final
    logRaw("\n" + "=".repeat(60));
    log("final_header");
    logRaw("=".repeat(60));
    
    [army_a, army_b].forEach(a => {
        log("final_stats", {name: a.name});
        log("tbl_header");
        logRaw("  " + "-".repeat(96));
        let dead=0, loss=0;
        a.stacks.forEach(s => s.groups.forEach(g => {
            let ld = g.initial_count - g.count, lh = g.initial_hp - g.current_hp;
            dead += ld; loss += lh;
            let nm = `[${s.name}] ${g.name}`;
            let st = `${g.initial_hp.toFixed(2)} / ${g.initial_count}`;
            let ed = `${g.current_hp.toFixed(2)} / ${g.count}`;
            let ls = `-${lh.toFixed(2)} (${(g.initial_hp>0?lh/g.initial_hp*100:0).toFixed(2)}%) / -${ld}`;
            logRaw(`  ${nm.padEnd(30)} | ${st.padEnd(20)} | ${ed.padEnd(20)} | ${ls}`);
        }));
        logRaw("  " + "-".repeat(96));
        log("total_loss", {dead: dead, hp: loss.toFixed(2)});
        a.stacks.forEach(s => {
            if(s.building) {
                let bl = s.building.initial_hp - s.building.current_hp;
                logRaw(`  [Stack ${s.name}] BUILDING: ${s.building.name} | Start: ${s.building.initial_hp.toFixed(2)} -> End: ${s.building.current_hp.toFixed(2)} | Lost: ${bl.toFixed(2)}`);
            }
        });
        logRaw("-".repeat(60));
    });
}