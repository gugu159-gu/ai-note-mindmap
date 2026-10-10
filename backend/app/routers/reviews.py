"""复习排程接口：按艾宾浩斯遗忘曲线提示该复习哪些知识点。

所有接口都要求登录，并且只操作当前用户自己的复习项。
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..models import ReviewItem, User, get_db
from ..services import review
from ..services.auth import require_user

router = APIRouter(prefix="/api", tags=["review"])


def _own_item(db: Session, item_id: str, user: User) -> ReviewItem:
    """取当前用户的复习项，越权或不存在一律 404。"""
    item = (
        db.query(ReviewItem)
        .filter(ReviewItem.id == item_id, ReviewItem.user_id == user.id)
        .first()
    )
    if not item:
        raise HTTPException(404, "复习项不存在")
    return item


@router.get("/reviews/summary")
def get_summary(db: Session = Depends(get_db), user: User = Depends(require_user)):
    """复习总览：待复习 / 学习中 / 已掌握 / 未来 7 天。"""
    return review.summary(db, user.id)


@router.get("/reviews/due")
def get_due(
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    """今天（或已逾期）该复习的知识点，按逾期时间升序。"""
    now = datetime.now()
    return [review.item_to_dict(i, now) for i in review.due_items(db, user.id, now, limit)]


@router.get("/reviews/upcoming")
def get_upcoming(
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    """未来 N 天的复习安排（按日期分组）。"""
    return review.upcoming_groups(db, days, user.id)


@router.get("/reviews/progress")
def get_progress(db: Session = Depends(get_db), user: User = Depends(require_user)):
    """按课件汇总复习完成进度（进度条数据源）。"""
    return review.progress_by_task(db, user.id)


@router.post("/reviews/complete-all")
def complete_all(
    task_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    """一键完成复习计划：指定课件，或不传 task_id 时完成全部未掌握项。"""
    now = datetime.now()
    count = review.master_all(db, task_id, user.id, now)
    db.commit()
    return {
        "ok": True,
        "completed": count,
        "message": f"已完成 {count} 个知识点的复习计划" if count else "没有待完成的复习项",
        "summary": review.summary(db, user.id, now),
    }


@router.get("/reviews")
def list_items(
    task_id: str | None = None,
    status: str | None = None,
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    """列出当前用户的复习项（可按课件任务或状态过滤）。"""
    query = db.query(ReviewItem).filter(ReviewItem.user_id == user.id)
    if task_id:
        query = query.filter(ReviewItem.task_id == task_id)
    if status:
        query = query.filter(ReviewItem.status == status)
    rows = query.order_by(ReviewItem.next_review_at.asc()).limit(limit).all()
    now = datetime.now()
    return [review.item_to_dict(r, now) for r in rows]


@router.post("/reviews/{item_id}/complete")
def complete(
    item_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    """标记为「已复习」：按间隔表推进到下一次复习。"""
    item = _own_item(db, item_id, user)
    review.advance(item)
    db.commit()
    db.refresh(item)
    now = datetime.now()
    data = review.item_to_dict(item, now)
    data["message"] = (
        f"已记录第 {item.stage} 次复习，下次复习：{data['next_review_date']}"
        if item.status == "active"
        else f"已完成全部 {review.MAX_STAGE} 次复习，标记为已掌握"
    )
    return data


@router.post("/reviews/{item_id}/master")
def master_item(
    item_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    """直接完成该知识点的复习计划（跳过剩余间隔）。"""
    item = _own_item(db, item_id, user)
    review.master(item)
    db.commit()
    db.refresh(item)
    data = review.item_to_dict(item)
    data["message"] = f"{item.title}：复习计划已完成"
    return data


@router.post("/reviews/{item_id}/reset")
def reset(
    item_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    """重置复习进度（重新从第 1 天开始）。"""
    item = _own_item(db, item_id, user)
    now = datetime.now()
    item.stage = 0
    item.status = "active"
    item.last_reviewed_at = None
    item.next_review_at = now
    db.commit()
    db.refresh(item)
    return review.item_to_dict(item, now)


@router.delete("/reviews/{item_id}")
def delete_item(
    item_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    item = _own_item(db, item_id, user)
    db.delete(item)
    db.commit()
    return {"ok": True}
