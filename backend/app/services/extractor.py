"""LLM 知识点提取（OpenAI 兼容接口，默认 DeepSeek）。

失败（未配置/网络/格式错误）一律返回 None，由上层降级到本地规则兜底。
"""
from __future__ import annotations

import json
import re

import httpx

#: 送入 LLM 的文本上限（控成本）
MAX_TEXT_CHARS = 8000
#: 知识点树最大层级（与提示词要求一致：层级 ≤3 层）
MAX_DEPTH = 3


def llm_extract(text: str, cfg: dict) -> dict | None:
    if not cfg.get("enabled") or not cfg.get("api_key"):
        return None

    template = cfg.get("prompt_template") or "{text}"
    user_text = template.replace("{{text}}", text[:MAX_TEXT_CHARS])

    payload = {
        "model": cfg.get("model", "deepseek-chat"),
        "messages": [
            {"role": "system", "content": "你只输出 JSON，不输出任何其他内容。"},
            {"role": "user", "content": user_text},
        ],
        "temperature": 0.3,
        "max_tokens": cfg.get("max_tokens", 4096),
        "response_format": {"type": "json_object"},
    }

    base = (cfg.get("base_url") or "https://api.deepseek.com").rstrip("/")
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }

    try:
        resp = httpx.post(f"{base}/chat/completions", json=payload, headers=headers, timeout=120)
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        data = _parse_json_content(content)
        return normalize_knowledge(data) if data else None
    except Exception:
        return None


def _parse_json_content(content: str) -> dict | None:
    """容忍 ```json ... ``` 包裹与前后噪声。"""
    if not content:
        return None
    content = content.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", content)
    if m:
        content = m.group(1).strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # 取第一个 { 到最后一个 } 再试
        start, end = content.find("{"), content.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(content[start : end + 1])
            except json.JSONDecodeError:
                return None
        return None


def normalize_knowledge(data, depth: int = 0) -> dict:
    """把任意 JSON 归一化为标准知识点树 {title, key_points, children}。

    depth 为当前层级（根节点为 0）；达到 MAX_DEPTH 后不再下钻，
    保证模型输出与提示词约定（层级 ≤3 层）一致。
    """
    if not isinstance(data, dict):
        return {"title": "知识点", "key_points": [], "children": []}
    node = {
        "title": str(data.get("title") or "知识点")[:60],
        "key_points": _norm_points(data.get("key_points")),
        "children": [],
    }
    children = data.get("children") or []
    if isinstance(children, list) and depth + 1 < MAX_DEPTH:
        for c in children[:20]:
            if isinstance(c, dict):
                node["children"].append(normalize_knowledge(c, depth + 1))
    return node


def _norm_points(points) -> list[str]:
    if not isinstance(points, list):
        return []
    out = []
    for p in points:
        s = str(p).strip()
        if s and s not in out:
            out.append(s[:60])
    return out[:5]
