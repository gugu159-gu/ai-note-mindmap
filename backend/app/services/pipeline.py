"""处理管线：解析 → 提取(LLM/兜底) → Markdown 大纲。"""
from __future__ import annotations

import os

from ..config import load_config
from .extractor import llm_extract
from .fallback import fallback_extract
from .knowledge import knowledge_to_markdown
from .parser import parse_file

#: 保存的原文上限（前端「识别原文」展示用）
MAX_STORED_TEXT = 20000


def run_pipeline(path: str, filename: str) -> tuple[dict, str, str]:
    """返回 (knowledge 树, Markdown 大纲, 解析出的原文)。解析失败抛 ValueError。"""
    text = parse_file(path, filename)
    cfg = load_config()
    knowledge = llm_extract(text, cfg)
    if knowledge is None:
        stem = os.path.splitext(filename)[0] or "知识点"
        knowledge = fallback_extract(text, stem)
    outline = knowledge_to_markdown(knowledge)
    return knowledge, outline, text[:MAX_STORED_TEXT]
