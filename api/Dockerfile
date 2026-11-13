# Build context: repository root (docker compose and Render set it).
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app/api
COPY api/pyproject.toml ./
COPY api/app ./app
RUN pip install --upgrade pip && pip install ".[postgres]"
RUN useradd --create-home academy && chown -R academy /app
USER academy
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
