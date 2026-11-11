import asyncio
import hashlib
import io
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from pgvector.sqlalchemy import Vector
from pydantic import BaseModel
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    delete,
    func,
    select,
    text,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base, relationship

logging.basicConfig(level=logging.INFO, format="[rag-api] %(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger("rag-api")

# ---------------------------------------------------------------------------
# 1. Configuration & Database Setup (SQLAlchemy + asyncpg + pgvector)
# ---------------------------------------------------------------------------
RAW_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://dsh_rag_user:dsh_rag_pass_2026@postgres-db:5432/dsh_rag_db",
)
if RAW_DATABASE_URL.startswith("postgresql://"):
    ASYNC_DATABASE_URL = RAW_DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
elif RAW_DATABASE_URL.startswith("postgres://"):
    ASYNC_DATABASE_URL = RAW_DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
else:
    ASYNC_DATABASE_URL = RAW_DATABASE_URL

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://embedding-service:11434").rstrip("/")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "bge-m3")
KB_DIR = Path(os.getenv("KB_DIR", "/data/kb_ro"))
RECONCILE_INTERVAL_SECONDS = int(os.getenv("RECONCILE_INTERVAL_SECONDS", "60"))
DEFAULT_SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.55"))

engine = create_async_engine(ASYNC_DATABASE_URL, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
Base = declarative_base()


class KbFile(Base):
    __tablename__ = "kb_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_path = Column(String, unique=True, nullable=False, index=True)
    file_hash = Column(String(64), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    chunks = relationship("KbChunk", back_populates="kb_file", cascade="all, delete-orphan", passive_deletes=True)


class KbChunk(Base):
    __tablename__ = "kb_chunks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_id = Column(Integer, ForeignKey("kb_files.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    content_text = Column(Text, nullable=False)
    embedding = Column(Vector(1024), nullable=False)

    kb_file = relationship("KbFile", back_populates="chunks")


# ---------------------------------------------------------------------------
# 2. Text Sanitization, Extraction & Chunking (350 - 500 tokens)
# ---------------------------------------------------------------------------
def sanitize_extracted_text(raw_text: str) -> str:
    """
    Sanitize document text against Indirect Prompt Injection:
    1. Strip invisible zero-width and bidirectional override Unicode characters.
    2. Neutralize fake XML/HTML system/instruction/prompt/role tags.
    3. Normalize excessive whitespace.
    """
    if not raw_text:
        return ""
    # 1. Remove zero-width & bidi override characters
    cleaned = re.sub(r"[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]", "", raw_text)
    # 2. Neutralize dangerous instruction/role tags and HTML/XML tags that mimic prompt delimiters
    cleaned = re.sub(
        r"(?i)<\s*/?\s*(system|instruction|instructions|prompt|assistant|user|developer|tool_call|untrusted_document_content|script|style|iframe)[^>]*>",
        "[TAG_REMOVED]",
        cleaned,
    )
    # 3. Normalize null bytes and control characters (preserve newlines and tabs)
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", cleaned)
    return cleaned.strip()


def extract_text_from_bytes(filename: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages)
    elif ext == ".docx":
        import docx

        doc = docx.Document(io.BytesIO(data))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paragraphs)
    else:
        return data.decode("utf-8", errors="replace")


def chunk_text_by_tokens(text_content: str, target_tokens: int = 400, min_tokens: int = 350, max_tokens: int = 500, overlap_tokens: int = 50) -> List[str]:
    """
    Splits sanitized text into chunks of ~350-500 tokens (approximated as ~0.75 words/token or whitespace tokens)
    with overlapping context to preserve semantic continuity.
    """
    cleaned = sanitize_extracted_text(text_content)
    if not cleaned:
        return []

    words = cleaned.split()
    if not words:
        return []

    # Approximate 1 word ~ 1.3 tokens -> 350-500 tokens corresponds to ~270-385 words
    # Also support direct word-token window up to max_tokens if text is short
    chunk_size = max(100, min(max_tokens, target_tokens))
    overlap = max(10, min(overlap_tokens, chunk_size // 4))

    if len(words) <= max_tokens:
        return [" ".join(words)]

    chunks: List[str] = []
    start = 0
    step = chunk_size - overlap
    while start < len(words):
        end = min(len(words), start + chunk_size)
        chunk_words = words[start:end]
        if chunk_words:
            chunks.append(" ".join(chunk_words))
        if end >= len(words):
            break
        start += step

    return chunks


# ---------------------------------------------------------------------------
# 3. Ollama Embedding Client (BGE-M3 -> 1024 dimensions)
# ---------------------------------------------------------------------------
async def get_embeddings(texts: List[str]) -> List[List[float]]:
    if not texts:
        return []
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Try Ollama /api/embed batch endpoint first
        resp = await client.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBEDDING_MODEL, "input": texts},
        )
        if resp.status_code == 200:
            data = resp.json()
            embeddings = data.get("embeddings")
            if embeddings and len(embeddings) == len(texts):
                return embeddings

        # Fallback to single /api/embeddings endpoint
        results: List[List[float]] = []
        for t in texts:
            r = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": EMBEDDING_MODEL, "prompt": t},
            )
            r.raise_for_status()
            vec = r.json().get("embedding")
            if not vec or len(vec) != 1024:
                raise RuntimeError(f"Invalid embedding vector returned from Ollama (len={len(vec) if vec else 0})")
            results.append(vec)
        return results


# ---------------------------------------------------------------------------
# 4. Core Ingest & Reconciliation Logic
# ---------------------------------------------------------------------------
def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def ingest_file_bytes(session: AsyncSession, canonical_path: str, raw_bytes: bytes) -> dict:
    file_hash = compute_sha256(raw_bytes)
    extracted = extract_text_from_bytes(canonical_path, raw_bytes)
    chunks = chunk_text_by_tokens(extracted)
    if not chunks:
        raise ValueError("File contains no extractable text after sanitization.")

    embeddings = await get_embeddings(chunks)

    # Check if file already exists in kb_files; delete old record to trigger ON DELETE CASCADE
    existing_stmt = select(KbFile).where(KbFile.file_path == canonical_path)
    existing_res = await session.execute(existing_stmt)
    existing_file = existing_res.scalar_one_or_none()
    if existing_file is not None:
        await session.execute(delete(KbFile).where(KbFile.id == existing_file.id))
        await session.flush()

    kb_file = KbFile(file_path=canonical_path, file_hash=file_hash)
    session.add(kb_file)
    await session.flush()

    for idx, (chunk_str, vec) in enumerate(zip(chunks, embeddings)):
        session.add(
            KbChunk(
                file_id=kb_file.id,
                chunk_index=idx,
                content_text=chunk_str,
                embedding=vec,
            )
        )

    await session.commit()
    return {
        "file_id": kb_file.id,
        "file_path": canonical_path,
        "file_hash": file_hash,
        "chunks_count": len(chunks),
    }


async def reconcile_kb_directory() -> dict:
    """
    Scans /data/kb_ro, compares SHA-256 hashes with kb_files:
    1. If a file in DB no longer exists on disk -> DELETE FROM kb_files (ON DELETE CASCADE removes kb_chunks).
    2. If a file on disk is missing in DB or has a changed SHA-256 -> Ingest/Update automatically.
    """
    KB_DIR.mkdir(parents=True, exist_ok=True)
    disk_files = {}
    for p in KB_DIR.rglob("*"):
        if p.is_file() and not p.name.startswith("."):
            canonical = f"/data/kb_ro/{p.relative_to(KB_DIR).as_posix()}"
            try:
                raw = p.read_bytes()
                disk_files[canonical] = (p, compute_sha256(raw), raw)
            except Exception as e:
                logger.warning(f"Failed reading {p}: {e}")

    deleted_files: List[str] = []
    synced_files: List[str] = []

    async with AsyncSessionLocal() as session:
        res = await session.execute(select(KbFile))
        db_files = {f.file_path: f for f in res.scalars().all()}

        # 1. Garbage collect deleted files from DB (ON DELETE CASCADE removes chunks)
        for db_path, db_obj in list(db_files.items()):
            if db_path not in disk_files:
                logger.info(f"[GC] File removed from disk, deleting from DB (CASCADE): {db_path}")
                await session.execute(delete(KbFile).where(KbFile.id == db_obj.id))
                deleted_files.append(db_path)

        if deleted_files:
            await session.commit()

        # 2. Ingest new or modified files on disk
        for disk_path, (_p, disk_hash, raw_bytes) in disk_files.items():
            db_obj = db_files.get(disk_path)
            if db_obj is None or db_obj.file_hash != disk_hash:
                try:
                    logger.info(f"[Sync] Ingesting new/modified file on disk: {disk_path}")
                    await ingest_file_bytes(session, disk_path, raw_bytes)
                    synced_files.append(disk_path)
                except Exception as e:
                    logger.error(f"[Sync] Failed to ingest {disk_path}: {e}")

    return {"deleted_files": deleted_files, "synced_files": synced_files}


async def background_reconciler_loop(stop_event: asyncio.Event):
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=RECONCILE_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            try:
                await reconcile_kb_directory()
            except Exception as e:
                logger.error(f"Background reconciler error: {e}")


# ---------------------------------------------------------------------------
# 5. FastAPI Application & Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    KB_DIR.mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        # Ensure foreign key constraint on kb_chunks.file_id has ON DELETE CASCADE
    logger.info("Database schema (kb_files, kb_chunks with ON DELETE CASCADE) initialized.")

    stop_event = asyncio.Event()
    task = asyncio.create_task(background_reconciler_loop(stop_event))
    yield
    stop_event.set()
    task.cancel()
    await engine.dispose()


app = FastAPI(title="DSH Enterprise Agentic RAG API", version="1.0.0", lifespan=lifespan)


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    threshold: float = DEFAULT_SIMILARITY_THRESHOLD
    userId: Optional[str] = None
    role: Optional[str] = None


@app.get("/health")
async def health():
    return {
        "service": "rag-api",
        "status": "healthy",
        "database_url_configured": True,
        "ollama_url": OLLAMA_URL,
        "embedding_model": EMBEDDING_MODEL,
        "kb_mount": str(KB_DIR),
    }


@app.post("/api/v1/ingest")
async def api_ingest(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    filename: Optional[str] = Form(default=None),
    content: Optional[str] = Form(default=None),
    x_dsh_role: Optional[str] = Header(default=None),
):
    """
    Ingests a document into /data/kb_ro, sanitizes against Indirect Prompt Injection,
    chunks into 350-500 token segments, embeds via Ollama BGE-M3, and saves to PostgreSQL.
    Supports both multipart/form-data (UploadFile) and application/json ({filename, content}).
    """
    # Optional RBAC enforcement if X-DSH-Role header is supplied
    if x_dsh_role is not None and x_dsh_role.lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admin role is allowed to ingest documents.")

    raw_bytes: Optional[bytes] = None
    target_name: Optional[str] = None

    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        body = await request.json()
        role_in_body = body.get("role")
        if role_in_body is not None and str(role_in_body).lower() != "admin":
            raise HTTPException(status_code=403, detail="Only admin role is allowed to ingest documents.")
        target_name = body.get("filename")
        text_body = body.get("content", "")
        if not target_name or not text_body:
            raise HTTPException(status_code=400, detail="JSON body must include 'filename' and 'content'.")
        raw_bytes = text_body.encode("utf-8")
    elif file is not None:
        target_name = filename or file.filename
        raw_bytes = await file.read()
    elif filename and content is not None:
        target_name = filename
        raw_bytes = content.encode("utf-8")
    else:
        raise HTTPException(status_code=400, detail="Missing file upload or {filename, content} payload.")

    safe_name = Path(target_name).name
    if not safe_name or safe_name.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    KB_DIR.mkdir(parents=True, exist_ok=True)
    disk_target = KB_DIR / safe_name
    disk_target.write_bytes(raw_bytes)
    canonical_path = f"/data/kb_ro/{safe_name}"

    try:
        async with AsyncSessionLocal() as session:
            result = await ingest_file_bytes(session, canonical_path, raw_bytes)
        return {"ok": True, **result}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("Ingest error:")
        raise HTTPException(status_code=500, detail=f"Ingest failed: {str(e)}")


@app.post("/api/v1/search")
async def api_search(payload: SearchRequest):
    query_str = (payload.query or "").strip()
    if not query_str:
        raise HTTPException(status_code=400, detail="Query must not be empty.")

    vecs = await get_embeddings([query_str])
    query_vec = vecs[0]
    threshold = payload.threshold if payload.threshold is not None else DEFAULT_SIMILARITY_THRESHOLD
    top_k = max(1, min(20, payload.top_k or 5))

    similarity_expr = (1 - KbChunk.embedding.cosine_distance(query_vec)).label("score")
    stmt = (
        select(KbFile.file_path, KbChunk.chunk_index, KbChunk.content_text, similarity_expr)
        .join(KbFile, KbChunk.file_id == KbFile.id)
        .where((1 - KbChunk.embedding.cosine_distance(query_vec)) >= threshold)
        .order_by(KbChunk.embedding.cosine_distance(query_vec))
        .limit(top_k)
    )

    async with AsyncSessionLocal() as session:
        rows = (await session.execute(stmt)).all()

    if not rows:
        empty_msg = (
            "[RAG_STATUS: NO_RELEVANT_DOCUMENTS_FOUND] "
            "Không tìm thấy tài liệu nào trong Kho tri thức khớp với câu hỏi "
            f"(Ngưỡng tương đồng < {threshold:.2f})."
        )
        return {
            "ok": True,
            "found": False,
            "count": 0,
            "markdown": empty_msg,
            "results": [],
        }

    blocks: List[str] = []
    structured: List[dict] = []
    for row in rows:
        score_val = float(row.score)
        safe_content = sanitize_extracted_text(row.content_text)
        block = (
            f'<untrusted_document_content source="{row.file_path}" score="{score_val:.4f}">\n'
            f"{safe_content}\n"
            f"</untrusted_document_content>"
        )
        blocks.append(block)
        structured.append(
            {
                "source": row.file_path,
                "chunk_index": row.chunk_index,
                "score": round(score_val, 4),
                "content": safe_content,
            }
        )

    markdown_output = "\n\n".join(blocks)
    return {
        "ok": True,
        "found": True,
        "count": len(structured),
        "markdown": markdown_output,
        "results": structured,
    }


@app.post("/api/v1/reconcile")
async def api_reconcile():
    """Manual trigger for the background Garbage Collection & Sync task."""
    res = await reconcile_kb_directory()
    return {"ok": True, **res}
