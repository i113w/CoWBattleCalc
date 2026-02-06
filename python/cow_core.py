import json
import random
import math
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Any, Set

# ============================================================================
# 1. 全局配置
# ============================================================================

CASUALTY_THRESHOLD = 0.50 
RANDOM_MU = 1.0
RANDOM_SIGMA = 0.1
RANDOM_MIN = 0.8
RANDOM_MAX = 1.2
CORE_DMG_MULTI = 1.15       # 核心领土伤害倍率
CORE_MITIGATION_ADD = 0.15  # 核心领土减伤数值

# ============================================================================
# 2. 枚举与基础类
# ============================================================================

class ArmorType(str, Enum):
    UNARMORED = "Unarmored"
    LIGHT_ARMOR = "Light Armor"
    HEAVY_ARMOR = "Heavy Armor"
    AIR = "Air"
    SHIP = "Ship"
    SUBMARINE = "Submarine"
    BUILDING = "Building"

class DamageType(str, Enum):
    ATTACK = "Attack"
    DEFENSE = "Defense"

class BattleMode(str, Enum):
    LAND_ATTACK = "LAND_ATTACK"
    LAND_MEET = "LAND_MEET"
    AIR_STRIKE = "AIR_STRIKE"

@dataclass
class BuildingLevelConfig:
    level: int
    hp_add: float
    mitigation_add: float

@dataclass
class Building:
    name: str
    levels_config: List[BuildingLevelConfig]
    current_hp: float
    initial_hp: float = 0.0 

    def __post_init__(self):
        self.initial_hp = self.current_hp

    @property
    def max_hp(self) -> float:
        return sum(cfg.hp_add for cfg in self.levels_config)

    def get_current_mitigation(self) -> float:
        if not self.levels_config: return 0.0
        lv1_hp = self.levels_config[0].hp_add
        if self.current_hp < lv1_hp - 1e-9: return 0.0
        
        total = 0.0
        temp_hp = self.current_hp
        for cfg in self.levels_config:
            l_max = cfg.hp_add
            if temp_hp >= l_max:
                total += cfg.mitigation_add
                temp_hp -= l_max
            else:
                if cfg.level > 1:
                    ratio = temp_hp / l_max
                    total += (0.2 + 0.8 * ratio) * cfg.mitigation_add
                temp_hp = 0
                break
        return total

    def take_damage(self, damage: float):
        self.current_hp = max(0.0, self.current_hp - damage)

# ============================================================================
# 3. UnitGroup
# ============================================================================

@dataclass
class UnitStats:
    name: str
    hp: float
    armor_type: ArmorType
    attack_values: Dict[ArmorType, float]
    defense_values: Dict[ArmorType, float]

class UnitGroup:
    def __init__(self, name: str, unit_stats: UnitStats, count: int, 
                 current_hp: float = None, terrain_bonus: float = 0.0, is_core: bool = False):
        self.name = name
        self.stats = unit_stats
        self.count = count
        self.max_hp_per_unit = unit_stats.hp
        self.terrain_bonus = terrain_bonus
        self.is_core = is_core  # 新增: 核心状态
        
        if current_hp is None:
            self.current_hp = count * self.max_hp_per_unit
        else:
            self.current_hp = current_hp

        self.initial_count = count
        self.initial_hp = self.current_hp

        self.last_round_dead = 0.0
        self.last_round_loss = 0.000

    @property
    def total_max_hp(self):
        return self.count * self.max_hp_per_unit

    @property
    def hp_ratio(self):
        if self.count <= 0: return 0.0
        c_max = self.count * self.max_hp_per_unit
        if c_max <= 0: return 0.0
        return self.current_hp / c_max

    def get_unit_damage(self, dmg_type: DamageType, target_armor: ArmorType) -> float:
        if self.count <= 0: return 0.0
        table = self.stats.attack_values if dmg_type == DamageType.ATTACK else self.stats.defense_values
        base = table.get(target_armor, 0.0)
        eff = 0.2 + 0.8 * self.hp_ratio
        
        # === 核心逻辑修改 ===
        # Terrain Bonus (加法基数): (1.0 + terrain)
        # Core Bonus (独立乘区): * 1.15
        terrain_mult = 1.0 + self.terrain_bonus
        core_mult = CORE_DMG_MULTI if self.is_core else 1.0
        
        return base * eff * terrain_mult * core_mult

    def apply_damage(self, amount: float):
        if amount <= 0 or self.count <= 0: 
            self.last_round_loss += 0.0
            return

        dead = 0
        if self.hp_ratio < CASUALTY_THRESHOLD:
            avg_hp = self.current_hp / self.count
            if avg_hp > 0:
                dead = min(int(amount // avg_hp), self.count)
        
        real_dmg = min(self.current_hp, amount)
        self.current_hp -= real_dmg
        self.last_round_loss += real_dmg

        if dead > 0:
            self.count -= dead
            self.last_round_dead += dead
        
        if self.current_hp <= 1e-5:
            self.current_hp = 0.0
            self.count = 0
        elif self.count == 0:
            self.current_hp = 0.0

    def reset_round_stats(self):
        self.last_round_dead = 0
        self.last_round_loss = 0.000

# ============================================================================
# 4. Stack
# ============================================================================

class Stack:
    def __init__(self, name: str, groups: List[UnitGroup], building: Optional[Building] = None, is_core: bool = False):
        self.name = name
        self.groups = groups
        self.building = building  # Building 现在归 Stack 管
        self.is_core = is_core    # Core 现在归 Stack 管

    @property
    def total_hp(self):
        return sum(g.current_hp for g in self.groups)
    
    @property
    def total_count(self):
        return sum(g.count for g in self.groups)

    @property
    def is_alive(self):
        return self.total_hp > 0 and any(g.count > 0 for g in self.groups)

    def get_present_armor_types(self) -> Set[ArmorType]:
        types = set()
        for g in self.groups:
            if g.count > 0 and g.current_hp > 0:
                types.add(g.stats.armor_type)
        return types
    
    # 新增: 获取当前 Stack 的总减伤
    def get_total_mitigation(self) -> float:
        mit = 0.0
        # 1. 建筑减伤 (受损会衰减)
        if self.building:
            mit += self.building.get_current_mitigation()
        # 2. 核心减伤 (固定值，叠加)
        if self.is_core:
            mit += CORE_MITIGATION_ADD
        
        return min(mit, 1.0) # 上限 100%

    def calculate_output(self, dmg_type: DamageType, target_armor: ArmorType, limit: int = 10) -> float:
        candidates = []
        for g in self.groups:
            dmg = g.get_unit_damage(dmg_type, target_armor)
            if dmg > 0 and g.count > 0:
                candidates.append((dmg, g.count))
        candidates.sort(key=lambda x: x[0], reverse=True)
        total = 0.0
        left = limit
        for u_dmg, cnt in candidates:
            if left <= 0: break
            take = min(left, cnt)
            total += take * u_dmg
            left -= take
        return total

    def receive_damage_distribution(self, potential_damages: Dict[ArmorType, float], total_army_count: int):
        """
        接收伤害分布。
        注意: 这里不再传入 mitigation 参数，因为 mitigation 是 Stack 自身的属性。
        """
        if total_army_count <= 0: return
        
        # 获取当前 Stack 的减伤
        my_mitigation = self.get_total_mitigation()
        
        for g in self.groups:
            if g.current_hp > 0 and g.count > 0:
                my_armor = g.stats.armor_type
                pot_dmg = potential_damages.get(my_armor, 0.0)
                weight = g.count / total_army_count
                raw = pot_dmg * weight
                
                # 应用减伤
                final = raw * (1.0 - my_mitigation)
                g.apply_damage(final)

# ============================================================================
# 5. Army
# ============================================================================

class Army:
    def __init__(self, name: str, stacks: List[Stack]):
        self.name = name
        self.stacks = stacks
        # Building 移除

    @property
    def total_hp(self):
        return sum(s.total_hp for s in self.stacks)
    
    @property
    def total_count(self):
        return sum(s.total_count for s in self.stacks)
    
    @property
    def is_alive(self):
        return any(s.is_alive for s in self.stacks)

    def reset_round_stats(self):
        for s in self.stacks:
            for g in s.groups:
                g.reset_round_stats()

    def get_all_armor_types(self) -> Set[ArmorType]:
        types = set()
        for s in self.stacks:
            types.update(s.get_present_armor_types())
        return types

    def compute_army_output(self, enemy: 'Army', dmg_type: DamageType, use_random: bool) -> Tuple[Dict[ArmorType, float], float]:
        if not self.is_alive: return {}, 0.0
        all_groups = []
        for s in self.stacks:
            all_groups.extend(s.groups)
        # 这里合并了所有 Group。
        # 由于 Group 对象本身携带 is_core 属性 (在 get_unit_damage 中使用)，
        # 所以即使合并，伤害计算依然会根据每个 Group 自己的 Core 状态进行加成。逻辑正确。
        temp_stack = Stack("Temp_Merged", all_groups)
        
        target_armors = enemy.get_all_armor_types()
        pot_dmg = {}
        factor = 1.0
        if use_random:
            val = random.gauss(RANDOM_MU, RANDOM_SIGMA)
            factor = max(RANDOM_MIN, min(RANDOM_MAX, val))
        for armor in target_armors:
            base = temp_stack.calculate_output(dmg_type, armor, limit=10)
            pot_dmg[armor] = base * factor
            
        b_dmg = 0.0
        # 只要 Enemy 有任意一个 Stack 有建筑，我们就算对建筑伤害（简化）
        # 或者更精确地：如果 enemy.has_any_building?
        # 实际上这个 b_dmg 是攻击方输出的"攻城值"。
        base_b = temp_stack.calculate_output(dmg_type, ArmorType.BUILDING, limit=10)
        b_dmg = base_b * factor
        return pot_dmg, b_dmg

    def receive_damage(self, potential_damages: Dict[ArmorType, float], building_damage: float):
        total_cnt = self.total_count
        if total_cnt <= 0: return
        
        # 分发给每个 Stack
        for s in self.stacks:
            # 1. 兵力承受伤害 (Stack 内部自己计算减伤)
            s.receive_damage_distribution(potential_damages, total_cnt)
            
            # 2. 建筑承受伤害 (如果有)
            if s.building:
                # 建筑受到的伤害是否受减伤影响？通常 CoW 中攻城值是直接扣建筑血量的。
                s.building.take_damage(building_damage)

# ============================================================================
# 6. JSON Helpers & Utility
# ============================================================================

def load_building_from_json(json_data: dict, current_hp: float = None) -> Building:
    levels = []
    for lvl in json_data["levels"]:
        levels.append(BuildingLevelConfig(lvl["level"], lvl["hp"], lvl["mitigation"]))
    levels.sort(key=lambda x: x.level)
    max_hp = sum(l.hp_add for l in levels)
    hp = current_hp if current_hp is not None else max_hp
    b = Building(name=json_data["name"], levels_config=levels, current_hp=hp)
    b.initial_hp = hp
    return b

def create_unit_group_from_json(name: str, unit_data: dict, count: int, 
                                terrain_bonus: float = 0.0, is_core: bool = False) -> UnitGroup:
    atk_map = {ArmorType(k): float(v) for k, v in unit_data.get("attack", {}).items() if k in ArmorType._value2member_map_}
    def_map = {ArmorType(k): float(v) for k, v in unit_data.get("defense", {}).items() if k in ArmorType._value2member_map_}
    stats = UnitStats(name, unit_data["hp"], ArmorType(unit_data["armor_type"]), atk_map, def_map)
    return UnitGroup(name, stats, count, terrain_bonus=terrain_bonus, is_core=is_core)

def merge_damage_dicts(d1, d2):
    res = d1.copy()
    for k, v in d2.items():
        res[k] = res.get(k, 0.0) + v
    return res

# ============================================================================
# 7. 核心逻辑
# ============================================================================

def resolve_atomic_clash(active_stack: Stack, 
                         target_army: Army, 
                         active_army_ref: Army, 
                         atk_factor: float, 
                         def_factor: float):
    if not active_stack.is_alive or not target_army.is_alive:
        return

    # === Step 1: Attack ===
    atk_map = {}
    target_armors = target_army.get_all_armor_types()
    for armor in target_armors:
        base = active_stack.calculate_output(DamageType.ATTACK, armor, limit=10)
        atk_map[armor] = base * atk_factor
        
    atk_b_dmg = 0.0
    # 检查 Target 任意 Stack 是否有建筑，有则计算攻城伤害
    if any(s.building for s in target_army.stacks):
        base_b = active_stack.calculate_output(DamageType.ATTACK, ArmorType.BUILDING, limit=10)
        atk_b_dmg = base_b * atk_factor

    # === Step 2: Defense ===
    def_map = {}
    active_armors = active_stack.get_present_armor_types()
    
    # 防守方 Blob 计算
    all_def_groups = []
    for s in target_army.stacks:
        all_def_groups.extend(s.groups)
    temp_def_stack = Stack("Def_Temp", all_def_groups)
    
    for armor in active_armors:
        base = temp_def_stack.calculate_output(DamageType.DEFENSE, armor, limit=10)
        def_map[armor] = base * def_factor

    # === Step 3: Application ===
    target_army.receive_damage(atk_map, atk_b_dmg)
    
    # Active Stack 承受反击 (Stack 独立承受)
    # Active Stack 自己的 get_total_mitigation 会处理 Core 和 Building
    active_stack.receive_damage_distribution(def_map, active_stack.total_count)


def get_interleaved_turn_order(army_a: Army, army_b: Army) -> List[Tuple[Stack, Army, Army]]:
    queue = []
    stacks_a = army_a.stacks
    stacks_b = army_b.stacks
    max_len = max(len(stacks_a), len(stacks_b))
    for i in range(max_len):
        if i < len(stacks_a):
            queue.append((stacks_a[i], army_b, army_a))
        if i < len(stacks_b):
            queue.append((stacks_b[i], army_a, army_b))
    return queue

def print_round_details(army: Army, detailed: bool):
    print(f"  > {army.name} 详情:")
    has_output = False
    for s in army.stacks:
        for g in s.groups:
            loss = g.last_round_loss
            dead = g.last_round_dead
            if detailed or (loss > 0.001 or dead > 0):
                has_output = True
                prev_hp = g.current_hp + loss
                loss_pct = 0.0
                if prev_hp > 0: loss_pct = (loss / prev_hp) * 100
                eff_pct = g.hp_ratio * 100
                dead_str = f" ☠️ {dead}" if dead > 0 else ""
                full_name = f"[{s.name}] {g.name}"
                status_str = f"HP {g.current_hp:.2f}/{g.total_max_hp:.1f} ({eff_pct:.2f}%)"
                loss_str = f"Lost {loss:.2f} ({loss_pct:.2f}%)"
                print(f"    * {full_name:<28} | {status_str:<22} | {loss_str:<18}{dead_str}")
    if not has_output and not detailed:
        print("    (无战损)")

def print_final_detailed_stats(army: Army):
    print(f"[{army.name}] 最终结算详细报告:")
    print(f"  {'UNIT (STACK)':<30} | {'START (HP/CNT)':<20} | {'END (HP/CNT)':<20} | {'LOSS (HP/CNT)':<20}")
    print("  " + "-"*96)
    total_loss_hp = 0.0
    total_dead = 0
    for s in army.stacks:
        for g in s.groups:
            start_h = g.initial_hp
            start_c = g.initial_count
            end_h = g.current_hp
            end_c = g.count
            loss_h = start_h - end_h
            loss_c = start_c - end_c
            total_loss_hp += loss_h
            total_dead += loss_c
            loss_pct = 0.00
            if start_h > 0: loss_pct = (loss_h / start_h) * 100
            name_str = f"[{s.name}] {g.name}"
            start_str = f"{start_h:.1f} / {start_c}"
            end_str = f"{end_h:.2f} / {end_c}"
            loss_str = f"-{loss_h:.2f} ({loss_pct:.2f}%) / -{loss_c}"
            print(f"  {name_str:<30} | {start_str:<20} | {end_str:<20} | {loss_str:<20}")
    print("  " + "-"*96)
    print(f"  TOTAL CASUALTIES: {total_dead} Units died, {total_loss_hp:.2f} HP lost.")
    
    # Building 统计 (现在在 Stack 里)
    for s in army.stacks:
        if s.building:
            b = s.building
            loss = b.initial_hp - b.current_hp
            print(f"  [Stack {s.name}] BUILDING: {b.name} | Start: {b.initial_hp:.2f} -> End: {b.current_hp:.2f} | Lost: {loss:.2f}")


def run_simulation(army_a: Army, army_b: Army, mode: BattleMode, max_rounds=50, use_random=True, detailed_output=False):
    print(f"=== 战斗开始: {army_a.name} vs {army_b.name} ===")
    print(f"模式: {mode.value} | 随机: {use_random} | 详细日志: {detailed_output}")
    
    for r in range(1, max_rounds + 1):
        if not army_a.is_alive or not army_b.is_alive: break
        
        army_a.reset_round_stats()
        army_b.reset_round_stats()
        
        factor_atk = 1.0
        factor_def = 1.0
        if use_random:
            factor_atk = max(RANDOM_MIN, min(RANDOM_MAX, random.gauss(RANDOM_MU, RANDOM_SIGMA)))
            factor_def = max(RANDOM_MIN, min(RANDOM_MAX, random.gauss(RANDOM_MU, RANDOM_SIGMA)))
        
        print(f"\nRound {r}:")

        if mode == BattleMode.LAND_ATTACK:
            for stack_a in army_a.stacks:
                if stack_a.is_alive and army_b.is_alive:
                    resolve_atomic_clash(stack_a, army_b, army_a, factor_atk, factor_def)
        
        elif mode == BattleMode.LAND_MEET:
            turn_order = get_interleaved_turn_order(army_a, army_b)
            for active_stack, target_army, active_ref in turn_order:
                if active_stack.is_alive and target_army.is_alive:
                    resolve_atomic_clash(active_stack, target_army, active_ref, factor_atk, factor_def)

        elif mode == BattleMode.AIR_STRIKE:
            for stack_a in army_a.stacks:
                if not stack_a.is_alive or not army_b.is_alive: continue
                
                # 1. B 防空
                b_def_map, b_def_b = army_b.compute_army_output(army_a, DamageType.DEFENSE, use_random)
                # 飞机承受防空，Stack 自带 mitigation (通常为 0，除非配置了Core/Building? 通常飞机没有)
                stack_a.receive_damage_distribution(b_def_map, stack_a.total_count)
                
                # 2. 轰炸
                if stack_a.is_alive:
                    a_atk_map = {}
                    target_armors = army_b.get_all_armor_types()
                    for armor in target_armors:
                        a_atk_map[armor] = stack_a.calculate_output(DamageType.ATTACK, armor, limit=10) * factor_atk
                    
                    b_dmg = stack_a.calculate_output(DamageType.ATTACK, ArmorType.BUILDING, limit=10) * factor_atk
                    
                    army_b.receive_damage(a_atk_map, b_dmg)


        print_round_details(army_a, detailed_output)
        print_round_details(army_b, detailed_output)
        
        for army in [army_a, army_b]:
             b_info = []
             for s in army.stacks:
                 if s.building:
                    mit = s.building.get_current_mitigation()
                    b_info.append(f"{s.name}:{s.building.name}({mit*100:.2f}%)")
             b_str = " | Bld: " + ", ".join(b_info) if b_info else ""
             print(f"  Summary {army.name}: HP {army.total_hp:.2f} (Cnt: {army.total_count}){b_str}")

    print("\n" + "="*60)
    print("最终结果统计")
    print("="*60)
    print_final_detailed_stats(army_a)
    print("-" * 60)
    print_final_detailed_stats(army_b)
    print("="*60)