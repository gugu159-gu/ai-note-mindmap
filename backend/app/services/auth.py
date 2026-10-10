"""账号与会话服务：注册、登录、登出、当前用户。

设计要点：
- 口令使用 PBKDF2-HMAC-SHA256（随机盐 + 20 万次迭代）哈希后入库，明文不落盘；
- 登录成功后由服务端生成随机 token 并写入 sessions 表，浏览器只保存 HttpOnly Cookie；
- 所有业务数据（tasks / review_items）按 user_id 归属，接口层统一过滤。
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta

from fastapi import Cookie, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session as DBSession

from ..models import ReviewItem, Task, User, UserSession, get_db

#: 会话有效期（天）与 Cookie 名
SESSION_DAYS = 30
COOKIE_NAME = "ainotes_sid"

_PBKDF2_ITERATIONS = 200_000
_USERNAME_MIN = 3
_USERNAME_MAX = 32
_PASSWORD_MIN = 6


# ---------------------------------------------------------------- 口令

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


# ---------------------------------------------------------------- 校验

def validate_credentials(username: str, password: str) -> None:
    """注册时的基本校验，不合法抛 ValueError（由路由转成 400）。"""
    username = (username or "").strip()
    if not (_USERNAME_MIN <= len(username) <= _USERNAME_MAX):
        raise ValueError(f"用户名长度需为 {_USERNAME_MIN}-{_USERNAME_MAX} 个字符")
    if not all(c.isalnum() or c in "_-." for c in username):
        raise ValueError("用户名只能包含字母、数字、下划线、连字符和点")
    if len(password or "") < _PASSWORD_MIN:
        raise ValueError(f"密码至少 {_PASSWORD_MIN} 位")


# ---------------------------------------------------------------- 用户

def get_user_by_name(db: DBSession, username: str) -> User | None:
    return db.query(User).filter(User.username == username.strip()).first()


def create_user(db: DBSession, username: str, password: str, display_name: str = "") -> User:
    username = username.strip()
    validate_credentials(username, password)
    if get_user_by_name(db, username):
        raise ValueError("该用户名已被注册")
    user = User(
        id=uuid.uuid4().hex,
        username=username,
        display_name=(display_name or "").strip() or username,
        password_hash=hash_password(password),
        created_at=datetime.now(),
    )
    db.add(user)
    db.flush()
    return user


def authenticate(db: DBSession, username: str, password: str) -> User | None:
    user = get_user_by_name(db, username)
    if not user or not verify_password(password, user.password_hash):
        return None
    user.last_login_at = datetime.now()
    return user


def user_count(db: DBSession) -> int:
    return db.query(User).count()


def claim_orphan_data(db: DBSession, user_id: str) -> int:
    """把没有归属的历史数据（user_id 为空）认领给当前用户。

    仅在该用户是系统里唯一账号时执行一次，避免多人环境下误占他人数据。
    """
    if user_count(db) != 1:
        return 0
    claimed = db.query(Task).filter(Task.user_id.is_(None)).update({"user_id": user_id})
    claimed += db.query(ReviewItem).filter(ReviewItem.user_id.is_(None)).update({"user_id": user_id})
    return claimed


# ---------------------------------------------------------------- 会话

def create_session(db: DBSession, user_id: str) -> UserSession:
    now = datetime.now()
    session = UserSession(
        token=secrets.token_urlsafe(32),
        user_id=user_id,
        created_at=now,
        expires_at=now + timedelta(days=SESSION_DAYS),
        last_seen_at=now,
    )
    db.add(session)
    return session


def get_active_session(db: DBSession, token: str | None) -> UserSession | None:
    if not token:
        return None
    session = db.get(UserSession, token)
    if not session:
        return None
    if session.expires_at and session.expires_at < datetime.now():
        db.delete(session)
        db.commit()
        return None
    return session


def destroy_session(db: DBSession, token: str | None) -> bool:
    if not token:
        return False
    session = db.get(UserSession, token)
    if not session:
        return False
    db.delete(session)
    return True


def purge_expired_sessions(db: DBSession) -> int:
    removed = (
        db.query(UserSession)
        .filter(UserSession.expires_at < datetime.now())
        .delete(synchronize_session=False)
    )
    return removed


# ---------------------------------------------------------------- 依赖

def make_current_user_dependency(get_db):
    """构造 FastAPI 依赖：解析当前登录用户，未登录返回 401。

    同时支持两种凭据：
    - 浏览器：HttpOnly Cookie（同源访问，最安全）
    - 手机 App / 第三方客户端：`Authorization: Bearer <token>`
    """

    def dependency(
        request: Request,
        db: DBSession = Depends(get_db),
        token: str | None = Cookie(default=None, alias=COOKIE_NAME),
        authorization: str | None = Header(default=None),
    ) -> User:
        raw = extract_token(token, authorization)
        session = get_active_session(db, raw)
        if not session:
            raise HTTPException(401, "未登录或登录已过期")
        user = db.get(User, session.user_id)
        if not user:
            destroy_session(db, raw)
            db.commit()
            raise HTTPException(401, "账号不存在")
        session.last_seen_at = datetime.now()
        db.commit()
        return user

    return dependency


def extract_token(cookie_token: str | None, authorization: str | None) -> str | None:
    """从 Authorization: Bearer 或 Cookie 中取出会话 token（优先 Bearer）。"""
    if authorization:
        value = authorization.strip()
        if value.lower().startswith("bearer "):
            bearer = value[7:].strip()
            if bearer:
                return bearer
    return cookie_token


#: 现成可用的「当前登录用户」依赖（未登录 → 401），供各业务路由复用
require_user = make_current_user_dependency(get_db)
