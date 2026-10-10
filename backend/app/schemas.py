"""请求 / 响应模型（Pydantic v2）。"""
from pydantic import BaseModel


class AuthIn(BaseModel):
    username: str
    password: str


class RegisterIn(BaseModel):
    username: str
    password: str
    display_name: str = ""


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    created_at: str = ""
    last_login_at: str = ""
    claimed_items: int = 0          # 首次登录时认领的历史数据条数
    token: str = ""                 # 会话 token：手机 App / 第三方客户端用它做 Bearer 鉴权


class SettingsIn(BaseModel):
    enabled: bool = False
    base_url: str = "https://api.deepseek.com"
    api_key: str = ""
    model: str = "deepseek-chat"
    max_tokens: int = 4096
    prompt_template: str = ""


class SettingsOut(BaseModel):
    enabled: bool
    base_url: str
    api_key_masked: str
    model: str
    max_tokens: int
    prompt_template: str


class TaskOut(BaseModel):
    id: str
    filename: str
    file_type: str
    status: str
    error: str
    outline: str
    knowledge: dict
    created_at: str
    review_items: int = 0
    text: str = ""              # 解析/识别出的原文（便于核对识别质量）
