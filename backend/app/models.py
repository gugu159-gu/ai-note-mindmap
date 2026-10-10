"""数据模型：用户、会话、任务历史与复习排程（SQLite）。"""
import os
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

#: 数据库文件位置。默认相对进程工作目录（启动脚本会把工作目录设为 backend/）；
#: 可用环境变量 AI_NOTES_DB 覆盖（测试使用独立库，避免污染真实数据）。
DB_FILE = os.environ.get("AI_NOTES_DB") or "./ai_notes.db"
DATABASE_URL = f"sqlite:///{DB_FILE}"


def resolve_db_path() -> str:
    """当前进程实际使用的数据库绝对路径（启动日志用，便于排查「数据跑哪去了」）。"""
    return os.path.abspath(DB_FILE)


engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


class User(Base):
    """用户账号。"""

    __tablename__ = "users"

    id = Column(String(36), primary_key=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    display_name = Column(String(64), default="")
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    last_login_at = Column(DateTime, nullable=True)


class UserSession(Base):
    """登录会话（服务端保存 token，浏览器 Cookie 只存 token 本身）。"""

    __tablename__ = "sessions"

    token = Column(String(64), primary_key=True)
    user_id = Column(String(36), index=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    expires_at = Column(DateTime, nullable=False)
    last_seen_at = Column(DateTime, default=datetime.now)


class Task(Base):
    """一次 上传→解析→提取 任务记录。"""

    __tablename__ = "tasks"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), index=True, nullable=True)   # 归属用户（历史遗留数据可能为空）
    filename = Column(String(255), nullable=False)
    file_type = Column(String(20), nullable=False)      # pdf / pptx / image / text
    status = Column(String(10), nullable=False, default="done")  # done / error
    error = Column(Text, default="")
    outline = Column(Text, default="")                  # 生成的 Markdown 大纲（导出用）
    knowledge = Column(Text, default="")                # 知识点 JSON 树
    text = Column(Text, default="")                     # 解析/识别出的原文（前端核对识别质量）
    created_at = Column(DateTime, default=datetime.now)


class ReviewItem(Base):
    """知识点复习项（艾宾浩斯遗忘曲线排程）。"""

    __tablename__ = "review_items"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), index=True, nullable=True)
    task_id = Column(String(36), index=True, nullable=False)
    filename = Column(String(255), default="")          # 来源课件名（复习页展示用）
    path = Column(String(255), default="")              # 知识点路径，如 "2.1 OSI / 物理层"
    title = Column(String(120), nullable=False)
    key_points = Column(Text, default="")               # JSON 数组
    stage = Column(Integer, default=0)                  # 已复习次数（0 ~ 间隔表长度）
    status = Column(String(10), default="active")       # active / mastered
    next_review_at = Column(DateTime, default=datetime.now, index=True)
    last_reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.now)


def _existing_columns(conn, table: str) -> set:
    rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
    return {r[1] for r in rows}


def _migrate(conn) -> None:
    """轻量迁移：给已存在的表补新增列（create_all 不会改动已有表结构）。"""
    for table, column, ddl in (
        ("tasks", "user_id", "ALTER TABLE tasks ADD COLUMN user_id VARCHAR(36)"),
        ("tasks", "text", "ALTER TABLE tasks ADD COLUMN text TEXT"),
        ("review_items", "user_id", "ALTER TABLE review_items ADD COLUMN user_id VARCHAR(36)"),
    ):
        cols = _existing_columns(conn, table)
        if cols and column not in cols:
            conn.exec_driver_sql(ddl)


def init_db():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        _migrate(conn)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
