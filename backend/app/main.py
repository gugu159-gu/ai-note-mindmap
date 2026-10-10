"""FastAPI 应用入口。"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models import init_db, resolve_db_path
from .routers import auth, reviews, settings, tasks, upload

init_db()
# 启动时打印实际数据库路径，便于排查「数据存到哪了 / 换目录启动后空库」
print(f"[startup] SQLite database: {resolve_db_path()}", flush=True)
print("[startup] upload dir: backend/uploads", flush=True)

app = FastAPI(
    title="AI 笔记工具",
    description="上传课件/拍照 → 自动提取知识点 → 生成思维导图（软件工程课程设计）",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(upload.router)
app.include_router(tasks.router)
app.include_router(settings.router)
app.include_router(reviews.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
