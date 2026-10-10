"""上传接口：接收文件 → 运行处理管线 → 存入任务历史。"""
from __future__ import annotations

import json
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..models import Task, User, get_db
from ..schemas import TaskOut
from ..services.auth import require_user
from ..services.parser import SUPPORTED_EXTS
from ..services.pipeline import run_pipeline
from ..services.review import create_items as create_review_items

router = APIRouter(prefix="/api", tags=["upload"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

#: 单文件大小上限（对应需求规格说明书 FR-1：≤50MB）
MAX_UPLOAD_MB = 50
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


def task_to_out(t: Task, review_items: int = 0) -> TaskOut:
    try:
        knowledge = json.loads(t.knowledge or "{}")
    except json.JSONDecodeError:
        knowledge = {}
    return TaskOut(
        id=t.id,
        filename=t.filename,
        file_type=t.file_type,
        status=t.status,
        error=t.error,
        outline=t.outline,
        knowledge=knowledge,
        created_at=t.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        review_items=review_items,
        text=t.text or "",
    )


@router.post("/upload", response_model=TaskOut)
async def upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    filename = file.filename or "unnamed"
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(400, f"不支持的文件类型 .{ext}（支持 {sorted(SUPPORTED_EXTS)}）")

    task_id = uuid.uuid4().hex
    save_path = os.path.join(UPLOAD_DIR, task_id + os.path.splitext(filename)[1])

    # 分块落盘并限制大小，避免超大文件占满磁盘
    size = 0
    too_large = False
    with open(save_path, "wb") as f:
        while True:
            chunk = await file.read(CHUNK_SIZE)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                too_large = True
                break
            f.write(chunk)

    if too_large:
        os.remove(save_path)
        raise HTTPException(413, f"文件超过 {MAX_UPLOAD_MB}MB 上限，请压缩或拆分后重试")
    if size == 0:
        os.remove(save_path)
        raise HTTPException(400, "上传文件为空，请重新选择文件")

    task = Task(id=task_id, user_id=user.id, filename=filename, file_type=ext, status="done")
    review_count = 0
    try:
        knowledge, outline, text = run_pipeline(save_path, filename)
        task.knowledge = json.dumps(knowledge, ensure_ascii=False)
        task.outline = outline
        task.text = text
        # 生成艾宾浩斯复习计划：每个知识点一条，首次复习在 1 天后
        review_count = create_review_items(db, task_id, filename, knowledge, user_id=user.id)
    except ValueError as exc:
        task.status = "error"
        task.error = str(exc)

    db.add(task)
    db.commit()
    db.refresh(task)
    return task_to_out(task, review_items=review_count)


@router.get("/tasks/{task_id}/file")
def download_task_file(
    task_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    """返回该任务上传的原文件（前端用于显示「原图」对照）。"""
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user.id).first()
    if not task:
        raise HTTPException(404, "任务不存在")
    for candidate in os.listdir(UPLOAD_DIR):
        if candidate.startswith(task_id + "."):
            path = os.path.join(UPLOAD_DIR, candidate)
            return FileResponse(path, filename=task.filename)
    raise HTTPException(404, "原文件已不存在（可能已被清理）")
