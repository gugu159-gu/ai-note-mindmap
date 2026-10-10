"""本地规则兜底提取：不依赖任何外部 API，答辩断网也能演示。

规则：
- PPTX 解析输出的 "## 标题" 行 → 建章节节点
- 编号标题（1. / 1.1 / （一）等）→ 建节点
- 其余行 → 作为当前节点 key_points（去重、每条限长、每节点最多 5 条）
- 层级上限 3 层、子节点上限 20 个；无标题时退化为"根节点 + 要点列表"
"""
from __future__ import annotations

import re

MAX_DEPTH = 3
MAX_CHILDREN = 20
MAX_POINTS = 5
POINT_MAX_LEN = 60


def fallback_extract(text: str, title: str = "知识点") -> dict:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return {"title": title[:60], "key_points": [], "children": []}

    root = {"title": title[:60], "key_points": [], "children": []}
    stack = [(0, root)]  # (depth, node)

    def current() -> dict:
        return stack[-1][1]

    for line in lines:
        level, heading = _match_heading(line)
        if heading is not None:
            node = {"title": heading[:60], "key_points": [], "children": []}
            while len(stack) > 1 and stack[-1][0] >= level:
                stack.pop()
            parent = current()
            if len(parent["children"]) < MAX_CHILDREN:
                parent["children"].append(node)
                stack.append((min(level, MAX_DEPTH), node))
            else:
                # 子节点溢出：降级为当前节点要点
                _add_point(current(), heading)
            continue
        _add_point(current(), _strip_bullet(line))

    # 无任何标题 → 退化为根节点要点列表
    if not root["children"] and not root["key_points"]:
        for ln in lines[:20]:
            _add_point(root, _strip_bullet(ln))
    return root


def _match_heading(line: str) -> tuple[int, str | None]:
    """返回 (层级, 标题文本)；非标题行返回 (0, None)。"""
    m = re.match(r"^(#{1,3})\s+(.+)$", line)
    if m:
        return len(m.group(1)), m.group(2).strip()
    # 中文编号：1、 / 1.1、 / 1.1.1、（一）
    m = re.match(r"^(\d+(?:[\.．]\d+){0,2})[、．]\s*(.+)$", line)
    if m:
        return min(m.group(1).count(".") + 1, MAX_DEPTH), m.group(2).strip()
    # ASCII 编号：1. 标题 / 1.1 标题（点号组后跟空白；限制位数避免误判年份等）
    m = re.match(r"^(\d{1,2}(?:\.\d{1,2}){0,2})\s+(.+)$", line)
    if m:
        return min(m.group(1).count(".") + 1, MAX_DEPTH), m.group(2).strip()
    m = re.match(r"^[（(]?[一二三四五六七八九十]+[）)][、.．]\s*(.+)$", line)
    if m:
        return 1, m.group(1).strip()
    return 0, None


def _strip_bullet(line: str) -> str:
    return re.sub(r"^[-•*▪]\s*", "", line).strip()


def _add_point(node: dict, point: str) -> None:
    point = point.strip()
    if not point or len(point) < 2:
        return
    if point in node["key_points"]:
        return
    if len(node["key_points"]) >= MAX_POINTS:
        return
    node["key_points"].append(point[:POINT_MAX_LEN])
