FROM python:3.11-slim

LABEL maintainer="dsh-enterprise"
LABEL description="DSH Enterprise Agentic RAG API (FastAPI + SQLAlchemy + pgvector + Ollama BGE-M3)"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py test_stage2_rag.py ./

RUN mkdir -p /data/kb_ro

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
