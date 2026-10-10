"""AI 配置接口（模型 / Key / 提示词）。

注意：AI 配置目前是**全局共用**（存放在 backend/config.json），登录后即可读写；
如需按用户隔离，可后续迁移到数据库表。
"""
from fastapi import APIRouter, Depends

from ..config import load_config, save_config
from ..models import User
from ..schemas import SettingsIn, SettingsOut
from ..services.auth import require_user

router = APIRouter(prefix="/api", tags=["settings"])


def _mask(key: str) -> str:
    return (key[:4] + "****" + key[-4:]) if len(key) > 8 else ("****" if key else "")


@router.get("/settings", response_model=SettingsOut)
def get_settings(_: User = Depends(require_user)):
    cfg = load_config()
    return SettingsOut(
        enabled=cfg["enabled"],
        base_url=cfg["base_url"],
        api_key_masked=_mask(cfg["api_key"]),
        model=cfg["model"],
        max_tokens=cfg["max_tokens"],
        prompt_template=cfg["prompt_template"],
    )


@router.put("/settings", response_model=SettingsOut)
def put_settings(payload: SettingsIn, _: User = Depends(require_user)):
    # 部分更新：只应用显式传入的字段，避免缺失字段覆盖已有配置
    cfg = load_config()
    data = payload.model_dump(exclude_unset=True)
    if not data.get("api_key"):  # api_key 传空串表示保留原值
        data["api_key"] = cfg.get("api_key", "")
    merged = save_config(data)
    return SettingsOut(
        enabled=merged["enabled"],
        base_url=merged["base_url"],
        api_key_masked=_mask(merged["api_key"]),
        model=merged["model"],
        max_tokens=merged["max_tokens"],
        prompt_template=merged["prompt_template"],
    )
