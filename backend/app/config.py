"""AI 配置读写（config.json，本地持久化）。

字段：
- enabled: 是否启用 LLM 提取
- base_url: OpenAI 兼容接口地址（默认 DeepSeek）
- api_key: API Key
- model: 模型名
- max_tokens: 单次提取 token 上限（控成本）
- prompt_template: 提取提示词模板（可配置）
"""
from __future__ import annotations

import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.json")

DEFAULT_CONFIG = {
    "enabled": False,
    "base_url": "https://api.deepseek.com",
    "api_key": "",
    "model": "deepseek-chat",
    "max_tokens": 4096,
    "prompt_template": (
        "你是一名学习笔记助手。请从下面的课件文本中提取结构化知识点，"
        "严格按 JSON 树输出（不要输出任何解释或代码块标记）。\n"
        "结构：{\"title\": 根标题, \"key_points\": [要点1, 要点2], "
        "\"children\": [{\"title\": 子标题, \"key_points\": [...], \"children\": [...]}]}\n"
        "要求：层级不超过 3 层；每个 key_points 2-5 条、每条 20 字以内；"
        "无内容的节点省略 children。\n\n课件文本：\n{{text}}"
    ),
}


def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            merged = dict(DEFAULT_CONFIG)
            merged.update(cfg)
            if not merged.get("prompt_template"):
                merged["prompt_template"] = DEFAULT_CONFIG["prompt_template"]
            return merged
        except (json.JSONDecodeError, OSError):
            pass
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> dict:
    merged = dict(DEFAULT_CONFIG)
    merged.update({k: v for k, v in cfg.items() if k in DEFAULT_CONFIG})
    if not merged.get("prompt_template"):
        merged["prompt_template"] = DEFAULT_CONFIG["prompt_template"]
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    return merged
