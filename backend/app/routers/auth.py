"""账号接口：注册 / 登录 / 登出 / 当前用户。"""
from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from ..models import User, get_db
from ..schemas import AuthIn, RegisterIn, UserOut
from ..services import auth
from ..services.auth import require_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _to_out(user: User, claimed: int = 0, token: str = "") -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name or user.username,
        created_at=user.created_at.strftime("%Y-%m-%d %H:%M") if user.created_at else "",
        last_login_at=user.last_login_at.strftime("%Y-%m-%d %H:%M") if user.last_login_at else "",
        claimed_items=claimed,
        token=token,
    )


def _set_session_cookie(response: Response, token: str) -> None:
    """写入会话 Cookie：HttpOnly 防脚本读取，SameSite=Lax 防跨站携带。"""
    response.set_cookie(
        key=auth.COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=auth.SESSION_DAYS * 24 * 3600,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=auth.COOKIE_NAME, path="/")


@router.get("/status")
def status(db: Session = Depends(get_db)):
    """登录页用：是否已有账号（首次使用引导注册）。"""
    return {"has_users": auth.user_count(db) > 0}


@router.post("/register", response_model=UserOut)
def register(payload: RegisterIn, response: Response, db: Session = Depends(get_db)):
    """注册并直接登录。"""
    try:
        user = auth.create_user(db, payload.username, payload.password, payload.display_name or "")
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    claimed = auth.claim_orphan_data(db, user.id)
    session = auth.create_session(db, user.id)
    db.commit()
    db.refresh(user)
    _set_session_cookie(response, session.token)
    return _to_out(user, claimed, session.token)


@router.post("/login", response_model=UserOut)
def login(payload: AuthIn, response: Response, db: Session = Depends(get_db)):
    """校验口令并建立会话。"""
    user = auth.authenticate(db, payload.username, payload.password or "")
    if not user:
        raise HTTPException(401, "用户名或密码不正确")

    claimed = auth.claim_orphan_data(db, user.id)
    auth.purge_expired_sessions(db)
    session = auth.create_session(db, user.id)
    db.commit()
    db.refresh(user)
    _set_session_cookie(response, session.token)
    return _to_out(user, claimed, session.token)


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    token: str | None = Cookie(default=None, alias=auth.COOKIE_NAME),
    authorization: str | None = Header(default=None),
):
    """注销当前会话并清除 Cookie（Bearer 客户端则直接让 token 失效）。"""
    removed = auth.destroy_session(db, auth.extract_token(token, authorization))
    db.commit()
    _clear_session_cookie(response)
    return {"ok": True, "logged_out": removed}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(require_user)):
    """当前登录用户（前端启动时用它判断是否需要跳登录页）。"""
    return _to_out(user)
