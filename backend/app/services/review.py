"""复习排程服务：艾宾浩斯遗忘曲线（Ebbinghaus Forgetting Curve）。

心理学背景：赫尔曼·艾宾浩斯揭示新学内容若不及时复习会快速遗忘。
本模块据此为每个知识点安排递增的复习间隔，并在每个时间点提示「该复习哪些知识点」。

默认间隔表：1、2、4、7、15、30 天（共 6 次复习，全部完成后标记为已掌握）。
"""
from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timedelta

from ..models import ReviewItem

#: 艾宾浩斯默认复习间隔（天）—— 第 n 次复习距上次的天数
EBBINGHAUS_INTERVALS: tuple[int, ...] = (1, 2, 4, 7, 15, 30)
MAX_STAGE = len(EBBINGHAUS_INTERVALS)


def intervals_label() -> str:
    return "、".join(str(d) for d in EBBINGHAUS_INTERVALS)


# ---------------------------------------------------------------- 知识点摊平

def flatten_knowledge(node: dict, path: str = "", depth: int = 0) -> list[dict]:
    """把知识点树摊平为可复习条目列表。

    规则：除根节点外每个节点都成为复习项；根节点仅在自身带要点时纳入
    （根通常是课件名，其要点往往是整体概括，同样值得复习）。
    """
    if not isinstance(node, dict):
        return []

    title = str(node.get("title") or "知识点").strip()
    cur_path = f"{path} / {title}" if path else title
    points = [str(p).strip() for p in (node.get("key_points") or []) if str(p).strip()]

    items: list[dict] = []
    if depth > 0 or points:
        items.append({"path": cur_path, "title": title, "key_points": points})

    for child in node.get("children") or []:
        items.extend(flatten_knowledge(child, cur_path, depth + 1))
    return items


def create_items(db, task_id: str, filename: str, knowledge: dict, user_id: str | None = None,
                 now: datetime | None = None) -> int:
    """为一次解析结果创建复习项，返回创建数量。首次复习安排在 1 天后。"""
    now = now or datetime.now()
    created = 0
    for item in flatten_knowledge(knowledge or {}):
        db.add(
            ReviewItem(
                id=uuid.uuid4().hex,
                user_id=user_id,
                task_id=task_id,
                filename=filename,
                path=item["path"][:255],
                title=item["title"][:120],
                key_points=json.dumps(item["key_points"], ensure_ascii=False),
                stage=0,
                status="active",
                next_review_at=now + timedelta(days=EBBINGHAUS_INTERVALS[0]),
                created_at=now,
            )
        )
        created += 1
    return created


# ---------------------------------------------------------------- 排程推进

def advance(item: ReviewItem, now: datetime | None = None) -> ReviewItem:
    """完成一次复习：stage +1，并按间隔表安排下次复习；走完全部间隔即掌握。"""
    now = now or datetime.now()
    item.stage = (item.stage or 0) + 1
    item.last_reviewed_at = now
    if item.stage >= MAX_STAGE:
        item.status = "mastered"
        item.next_review_at = now + timedelta(days=EBBINGHAUS_INTERVALS[-1])
    else:
        item.next_review_at = now + timedelta(days=EBBINGHAUS_INTERVALS[item.stage])
    return item


def next_interval_days(item: ReviewItem) -> int:
    """当前 stage 对应的下次间隔天数。"""
    index = min(item.stage or 0, MAX_STAGE - 1)
    return EBBINGHAUS_INTERVALS[index]


def master(item: ReviewItem, now: datetime | None = None) -> ReviewItem:
    """直接完成该知识点的复习计划（跳过剩余间隔，标记为已掌握）。"""
    now = now or datetime.now()
    item.stage = MAX_STAGE
    item.status = "mastered"
    item.last_reviewed_at = now
    item.next_review_at = now + timedelta(days=EBBINGHAUS_INTERVALS[-1])
    return item


def master_all(db, task_id: str | None = None, user_id: str | None = None,
               now: datetime | None = None) -> int:
    """批量完成复习计划：指定课件（task_id）或全部未掌握项。返回完成数量。"""
    now = now or datetime.now()
    query = _scope(db.query(ReviewItem), user_id).filter(ReviewItem.status == "active")
    if task_id:
        query = query.filter(ReviewItem.task_id == task_id)
    rows = query.all()
    for row in rows:
        master(row, now)
    return len(rows)


# ---------------------------------------------------------------- 记忆保持率

def retention_percent(item: ReviewItem, now: datetime | None = None) -> int:
    """按遗忘曲线估算当前记忆保持率（R = e^(-t/S)，S 取当前阶段间隔天数）。

    仅用于界面上的「紧迫度」提示：保持率越低，越应该优先复习。
    """
    now = now or datetime.now()
    base = item.last_reviewed_at or item.created_at or now
    stability = max(next_interval_days(item), 1)
    elapsed_days = max((now - base).total_seconds() / 86400.0, 0.0)
    ratio = math.exp(-elapsed_days / stability)
    return int(max(0, min(100, round(ratio * 100))))


# ---------------------------------------------------------------- 查询与序列化

def _points(item: ReviewItem) -> list[str]:
    try:
        data = json.loads(item.key_points or "[]")
        return [str(p) for p in data] if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def item_to_dict(item: ReviewItem, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    due = item.status == "active" and item.next_review_at is not None and item.next_review_at <= now
    overdue_days = 0
    if due and item.next_review_at:
        overdue_days = max((now - item.next_review_at).days, 0)
    days_until = None
    if item.next_review_at:
        days_until = (item.next_review_at.date() - now.date()).days
    return {
        "id": item.id,
        "task_id": item.task_id,
        "filename": item.filename,
        "path": item.path,
        "title": item.title,
        "key_points": _points(item),
        "stage": item.stage or 0,
        "max_stage": MAX_STAGE,
        "status": item.status,
        "next_review_at": item.next_review_at.strftime("%Y-%m-%d %H:%M") if item.next_review_at else "",
        "next_review_date": item.next_review_at.strftime("%Y-%m-%d") if item.next_review_at else "",
        "last_reviewed_at": item.last_reviewed_at.strftime("%Y-%m-%d %H:%M") if item.last_reviewed_at else "",
        "created_at": item.created_at.strftime("%Y-%m-%d %H:%M") if item.created_at else "",
        "is_due": bool(due),
        "overdue_days": overdue_days,
        "days_until": days_until,
        "retention": retention_percent(item, now),
    }


def _scope(query, user_id: str | None):
    """按归属用户过滤复习项（user_id 为空表示历史遗留数据）。"""
    if user_id is None:
        return query.filter(ReviewItem.user_id.is_(None))
    return query.filter(ReviewItem.user_id == user_id)


def due_items(db, user_id: str | None = None, now: datetime | None = None, limit: int = 200) -> list[ReviewItem]:
    now = now or datetime.now()
    return (
        _scope(db.query(ReviewItem), user_id)
        .filter(ReviewItem.status == "active", ReviewItem.next_review_at <= now)
        .order_by(ReviewItem.next_review_at.asc())
        .limit(limit)
        .all()
    )


def upcoming_groups(db, days: int = 7, user_id: str | None = None,
                    now: datetime | None = None) -> list[dict]:
    """未来 N 天的复习计划，按日期分组（用于「接下来要复习什么」）。"""
    now = now or datetime.now()
    horizon = now + timedelta(days=days)
    rows = (
        _scope(db.query(ReviewItem), user_id)
        .filter(
            ReviewItem.status == "active",
            ReviewItem.next_review_at > now,
            ReviewItem.next_review_at <= horizon,
        )
        .order_by(ReviewItem.next_review_at.asc())
        .all()
    )

    grouped: dict[str, list[dict]] = {}
    for row in rows:
        key = row.next_review_at.strftime("%Y-%m-%d")
        grouped.setdefault(key, []).append(item_to_dict(row, now))

    today = now.date()
    result = []
    for date_str in sorted(grouped.keys()):
        date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
        delta = (date_obj - today).days
        if delta == 0:
            label = "今天"
        elif delta == 1:
            label = "明天"
        else:
            label = f"{delta} 天后"
        result.append({"date": date_str, "label": label, "items": grouped[date_str], "count": len(grouped[date_str])})
    return result


def summary(db, user_id: str | None = None, now: datetime | None = None) -> dict:
    """复习总览：待复习 / 学习中 / 已掌握 / 未来 7 天安排 + 整体完成进度。"""
    now = now or datetime.now()
    rows = _scope(db.query(ReviewItem), user_id).all()
    total = len(rows)
    mastered = sum(1 for r in rows if r.status == "mastered")
    active = total - mastered
    due = sum(
        1
        for r in rows
        if r.status == "active" and r.next_review_at is not None and r.next_review_at <= now
    )
    upcoming_7d = sum(
        1
        for r in rows
        if r.status == "active"
        and r.next_review_at is not None
        and now < r.next_review_at <= now + timedelta(days=7)
    )
    # 完成进度：以「已掌握知识点数」为主，另给出「复习阶段完成度」
    stages_done = sum(min(r.stage or 0, MAX_STAGE) for r in rows)
    stages_total = total * MAX_STAGE
    return {
        "total": total,
        "active": active,
        "due": due,
        "mastered": mastered,
        "upcoming_7d": upcoming_7d,
        "stages_done": stages_done,
        "stages_total": stages_total,
        "progress_percent": round(mastered / total * 100) if total else 0,
        "stage_percent": round(stages_done / stages_total * 100) if stages_total else 0,
        "intervals": list(EBBINGHAUS_INTERVALS),
        "intervals_label": intervals_label(),
    }


def progress_by_task(db, user_id: str | None = None, now: datetime | None = None) -> list[dict]:
    """按课件汇总复习进度（用于「完成进度」展示）。"""
    now = now or datetime.now()
    grouped: dict[str, dict] = {}
    for row in _scope(db.query(ReviewItem), user_id).all():
        g = grouped.setdefault(
            row.task_id,
            {
                "task_id": row.task_id,
                "filename": row.filename or "（未知来源）",
                "total": 0,
                "mastered": 0,
                "due": 0,
                "stages_done": 0,
            },
        )
        g["total"] += 1
        g["stages_done"] += min(row.stage or 0, MAX_STAGE)
        if row.status == "mastered":
            g["mastered"] += 1
        elif row.next_review_at is not None and row.next_review_at <= now:
            g["due"] += 1

    result = []
    for g in grouped.values():
        g["active"] = g["total"] - g["mastered"]
        g["stages_total"] = g["total"] * MAX_STAGE
        g["percent"] = round(g["mastered"] / g["total"] * 100) if g["total"] else 0
        g["stage_percent"] = round(g["stages_done"] / g["stages_total"] * 100) if g["stages_total"] else 0
        result.append(g)
    # 待复习多的排前面，其次按完成度升序（越没做完越靠前）
    result.sort(key=lambda x: (-x["due"], x["percent"], x["filename"]))
    return result
