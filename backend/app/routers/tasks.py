"""任务历史接口。"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import ReviewItem, Task, User, get_db
from ..services.auth import require_user
from .upload import task_to_out

router = APIRouter(prefix="/api", tags=["tasks"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "uploads")


def _own_task(db: Session, task_id: str, user: User) -> Task:
    """取当前用户的指定任务，越权或不存在一律 404。"""
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user.id).first()
    if not task:
        raise HTTPException(404, "任务不存在")
    return task


@router.get("/tasks")
def list_tasks(db: Session = Depends(get_db), user: User = Depends(require_user)):
    tasks = (
        db.query(Task)
        .filter(Task.user_id == user.id)
        .order_by(Task.created_at.desc())
        .all()
    )
    counts = dict(
        db.query(ReviewItem.task_id, func.count(ReviewItem.id))
        .filter(ReviewItem.user_id == user.id)
        .group_by(ReviewItem.task_id)
        .all()
    )
    return [task_to_out(t, review_items=counts.get(t.id, 0)) for t in tasks]


@router.get("/tasks/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db), user: User = Depends(require_user)):
    task = _own_task(db, task_id, user)
    return task_to_out(task)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, db: Session = Depends(get_db), user: User = Depends(require_user)):
    task = _own_task(db, task_id, user)
    for ext in (".pdf", ".pptx", ".txt", ".md", ".png", ".jpg", ".jpeg"):
        p = os.path.join(UPLOAD_DIR, task_id + ext)
        if os.path.exists(p):
            os.remove(p)
    # 联动清理该任务生成的复习项，避免复习页出现「无源」条目
    removed = (
        db.query(ReviewItem)
        .filter(ReviewItem.task_id == task_id, ReviewItem.user_id == user.id)
        .delete()
    )
    db.delete(task)
    db.commit()
    return {"ok": True, "removed_review_items": removed}
