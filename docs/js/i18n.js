const I18N = {
    en: {
        title: "CoW Battle Simulator",
        subtitle: "Web Port based on Python Core",
        lbl_units: "Units Database (JSON)",
        lbl_buildings: "Buildings Database (JSON)",
        lbl_config: "Battle Config (JSON)",
        btn_run: "Run Simulation",
        btn_clear: "Clear Log",
        btn_load_ex: "Load Example Scenario", 
        btn_reset: "Reset to Empty",
        lbl_scenario_select: "Select Scenario:", 
        err_json: "JSON Error in {field}: {msg}",
        logs: {
            start: "=== Battle Start: {a} vs {b} ===",
            mode: "Mode: {mode} | Random: {rnd}",
            round: "\nRound {r}:",
            details: "  > {name} Details:",
            no_loss: "    (No Casualties)",
            summary: "  Summary {name}: HP {hp} (Cnt: {count}){bld}",
            final_header: "Final Results",
            final_stats: "[{name}] Final Statistics:",
            tbl_header: "  UNIT (STACK)                   | START (HP/CNT)       | END (HP/CNT)         | LOSS",
            total_loss: "  TOTAL: {dead} units died, {hp} HP lost.",
            loss_str: "Lost {loss} {dead}"
        },
        btn_docs: "Help & Docs"
    },
    zh: {
        title: "CoW 战斗模拟器",
        subtitle: "基于 Python 核心逻辑移植",
        lbl_units: "单位数据库 (Units JSON)",
        lbl_buildings: "建筑数据库 (Buildings JSON)",
        lbl_config: "战斗配置 (Battle Config JSON)",
        btn_run: "开始战斗模拟",
        btn_clear: "清空日志",
        btn_load_ex: "导入选中场景", 
        btn_reset: "重置为空",
        lbl_scenario_select: "选择场景:", 
        err_json: "{field} JSON 格式错误: {msg}",
        logs: {
            start: "=== 战斗开始: {a} vs {b} ===",
            mode: "模式: {mode} | 随机: {rnd}",
            round: "\n第 {r} 回合:",
            details: "  > {name} 详情:",
            no_loss: "    (无战损)",
            summary: "  汇总 {name}: HP {hp} (数量: {count}){bld}",
            final_header: "最终结果统计",
            final_stats: "[{name}] 最终结算:",
            tbl_header: "  单位 (堆叠)                    | 初始 (HP/数量)       | 结束 (HP/数量)       | 损失",
            total_loss: "  总计: 阵亡 {dead} 单位, 损失 {hp} HP.",
            loss_str: "损失 {loss} {dead}"
        },
        btn_docs: "帮助文档"
    }
};