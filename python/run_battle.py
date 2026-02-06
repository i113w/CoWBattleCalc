import json
import sys
import os
try:
    from cow_core import *
except ImportError:
    sys.exit(1)

def load_json(filename):
    with open(filename, 'r', encoding='utf-8') as f: return json.load(f)

def build_army(team_config, units_db, buildings_db):
    army_name = team_config.get("name", "Unknown Army")
    army_stacks = []
    
    # 兼容旧格式：如果 direct "units" 存在，将其封装为一个 Stack
    if "units" in team_config:
        stack_data = [{
            "name": "Main Stack", 
            "units": team_config["units"],
            "building": team_config.get("building"), # 旧格式 building 在 team 层级
            "core": team_config.get("core", False)
        }]
    else:
        stack_data = team_config.get("stacks", [])

    for s_entry in stack_data:
        s_name = s_entry.get("name", "Stack")
        is_core = s_entry.get("core", False)
        
        # === 1. 构建 Building 对象 ===
        b_obj = None
        if "building" in s_entry and s_entry["building"]:
            b_conf = s_entry["building"]
            b_id = b_conf["id"]
            if b_id in buildings_db:
                raw = buildings_db[b_id]
                valid = [l for l in raw["levels"] if l["level"] <= b_conf["level"]]
                if valid:
                    # 临时创建 Building 对象以计算 Max HP
                    temp_b_data = {"name": f"{b_id} Lv{b_conf['level']}", "levels": valid}
                    # 获取 max hp (通过传入 None)
                    temp_b = load_building_from_json(temp_b_data, None)
                    max_hp = temp_b.max_hp
                    
                    # 确定 Current HP
                    final_hp = max_hp # 默认满血
                    
                    if "current_hp" in b_conf and b_conf["current_hp"] is not None:
                        final_hp = float(b_conf["current_hp"])
                    elif "hp_ratio" in b_conf and b_conf["hp_ratio"] is not None:
                        final_hp = max_hp * float(b_conf["hp_ratio"])
                        
                    # 重新创建带正确血量的 Building
                    b_obj = load_building_from_json(temp_b_data, final_hp)

        # === 2. 构建 Units ===
        groups = []
        for u_entry in s_entry.get("units", []):
            u_id = u_entry["id"]
            if u_id not in units_db: continue
            
            count = u_entry["count"]
            t_bonus = float(u_entry.get("terrain_bonus", 0.0))
            
            # 准备基础数据
            u_data = units_db[u_id]
            max_hp_per_unit = u_data["hp"]
            total_max = count * max_hp_per_unit
            
            # 确定 Current HP
            final_u_hp = total_max # 默认满血
            
            if "current_hp" in u_entry and u_entry["current_hp"] is not None:
                final_u_hp = float(u_entry["current_hp"])
            elif "hp_ratio" in u_entry and u_entry["hp_ratio"] is not None:
                final_u_hp = total_max * float(u_entry["hp_ratio"])
            
            # 创建 Group，注意传入 is_core
            grp = create_unit_group_from_json(u_id, u_data, count, t_bonus, is_core)
            grp.current_hp = final_u_hp
            # 重置初始记录，因为 create 函数里可能用了默认值
            grp.initial_hp = final_u_hp
            
            groups.append(grp)
            
        army_stacks.append(Stack(s_name, groups, b_obj, is_core))

    return Army(army_name, army_stacks)

def main():
    u_db = load_json("units.json")
    b_db = load_json("buildings.json")
    conf = load_json("battle_config.json")
    
    army_a = build_army(conf["team_a"], u_db, b_db)
    army_b = build_army(conf["team_b"], u_db, b_db)
    
    mode = BattleMode(conf.get("battle_mode", "LAND_ATTACK"))
    use_rnd = conf.get("enable_randomness", True)
    detailed = conf.get("detailed_output", False)
    
    run_simulation(army_a, army_b, mode, conf.get("max_rounds", 50), use_rnd, detailed)

if __name__ == "__main__":
    main()