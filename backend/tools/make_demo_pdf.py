# -*- coding: utf-8 -*-
"""生成演示用 PDF 课件（含中文字体，文本层可正常提取）。

用途：项目中 demo_*.pdf 演示素材的再生成工具。
执行： backend\\.venv\\Scripts\\python.exe backend\\tools\\make_demo_pdf.py
输出： <项目根>/demo_计算机网络.pdf

说明：使用 PyMuPDF 嵌入系统中文字体并做字体子集化（避免整包字体导致文件过大），
      生成的 PDF 文本层带 Unicode 映射，可被解析层直接提取（无需 OCR）。
"""
import os
import shutil
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_DIR = os.path.dirname(BACKEND_DIR)

sys.path.insert(0, BACKEND_DIR)

import pymupdf as fitz  # noqa: E402

OUT_PDF = os.path.join(PROJECT_DIR, "demo_计算机网络.pdf")
BACKUP_PDF = os.path.join(PROJECT_DIR, "demo_计算机网络.old-broken.pdf")

#: 优先使用黑体，缺失时回退到其他常见中文字体
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simsun.ttc",
    r"C:\Windows\Fonts\Deng.ttf",
]

CONTENT = [
    ("h1", "计算机网络 第二章 网络体系结构"),
    ("h2", "2.1 OSI 七层模型"),
    ("li", "物理层：比特流传输，定义接口与电气特性"),
    ("li", "数据链路层：成帧、差错控制、流量控制"),
    ("li", "网络层：路由选择与分组转发（IP）"),
    ("li", "传输层：端到端可靠传输（TCP/UDP）"),
    ("li", "会话层：建立、管理、终止会话"),
    ("li", "表示层：数据格式转换与加密"),
    ("li", "应用层：HTTP、FTP、SMTP 等协议"),
    ("h2", "2.2 TCP/IP 四层模型"),
    ("li", "网络接口层：对应 OSI 物理层与数据链路层"),
    ("li", "网际层：IP 协议，无连接、尽力而为"),
    ("li", "传输层：TCP 面向连接，UDP 无连接"),
    ("li", "应用层：合并 OSI 高三层，协议丰富"),
    ("h2", "2.3 两种模型对比"),
    ("li", "OSI 为理论参考模型，共七层"),
    ("li", "TCP/IP 为事实标准，共四层"),
    ("li", "对应关系：应用层对应 OSI 上三层"),
]

PAGE2 = [
    ("h2", "2.4 小结"),
    ("li", "网络体系结构是分层思想的体现"),
    ("li", "分层降低了系统的复杂度，便于标准化"),
]


def pick_font() -> str:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("未找到可用的中文字体，请安装黑体/微软雅黑后重试")


def build(font_path: str) -> None:
    if os.path.exists(OUT_PDF) and not os.path.exists(BACKUP_PDF):
        shutil.copy2(OUT_PDF, BACKUP_PDF)
        print("已备份原文件 ->", BACKUP_PDF)

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="cjk", fontfile=font_path)

    y = 70.0
    for kind, text in CONTENT:
        if kind == "h1":
            size, step, indent = 20, 34, 0
        elif kind == "h2":
            size, step, indent = 15, 28, 0
        else:
            size, step, indent = 12, 22, 18
        page.insert_text((60 + indent, y), text, fontname="cjk", fontsize=size)
        y += step

    page2 = doc.new_page(width=595, height=842)
    page2.insert_font(fontname="cjk", fontfile=font_path)
    y2 = 70.0
    for kind, text in PAGE2:
        if kind == "h2":
            size, step, indent = 15, 28, 0
        else:
            size, step, indent = 12, 22, 18
        page2.insert_text((60 + indent, y2), text, fontname="cjk", fontsize=size)
        y2 += step

    doc.subset_fonts()  # 字体子集化：只嵌入用到的字形
    doc.save(OUT_PDF, garbage=3, deflate=True)
    doc.close()
    print("已生成:", OUT_PDF, os.path.getsize(OUT_PDF), "bytes")


def verify() -> None:
    from app.services.parser import _meaningful_ratio, _text_is_usable, parse_pdf

    text = parse_pdf(OUT_PDF)
    print(
        f"文本层校验: usable={_text_is_usable(text)} "
        f"ratio={round(_meaningful_ratio(text), 3)} chars={len(text)}"
    )
    print(text.strip()[:200])


if __name__ == "__main__":
    font = pick_font()
    print("使用字体:", font)
    build(font)
    verify()
