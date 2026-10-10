"""知识点树 ↔ Markdown 大纲 转换（导出与渲染共用）。"""
from __future__ import annotations


def knowledge_to_markdown(node: dict) -> str:
    """知识点 JSON 树 → Markdown 大纲（markmap 可直接渲染）。"""
    lines: list[str] = []

    def walk(n: dict, depth: int) -> None:
        title = n.get("title") or ""
        lines.append(f"{'#' * min(depth + 1, 6)} {title}" if title else "")
        for kp in n.get("key_points") or []:
            lines.append(f"- {kp}")
        for child in n.get("children") or []:
            walk(child, depth + 1)

    walk(node, 0)
    return "\n".join(l for l in lines if l)


def markdown_to_knowledge(md: str, root_title: str = "知识点") -> dict:
    """Markdown 大纲 → 知识点树（兜底解析用，简单实现）。"""
    root = {"title": root_title, "key_points": [], "children": []}
    stack: list[tuple[int, dict]] = [(0, root)]
    for line in md.splitlines():
        m = __import__("re").match(r"^(#{1,6})\s+(.*)$", line.strip())
        if m:
            level = min(len(m.group(1)), 3)
            node = {"title": m.group(2).strip(), "key_points": [], "children": []}
            while stack and stack[-1][0] >= level:
                stack.pop()
            parent = stack[-1][1] if stack else root
            parent["children"].append(node)
            stack.append((level, node))
        elif line.strip().startswith("- "):
            point = line.strip()[2:].strip()
            node = stack[-1][1] if stack else root
            if point and point not in node["key_points"]:
                node["key_points"].append(point)
    return root
