# Build from repo root:
#   docker build -f backend/Dockerfile .
FROM python:3.12-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /app app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/alembic.ini ./alembic.ini
COPY backend/migrations ./migrations
COPY media/reb3i /app/media/reb3i
RUN mkdir -p /app/uploads && chown app:app /app/uploads

ENV UPLOAD_DIR=/app/uploads
USER 10001
EXPOSE 8000
# Only reachable through Traefik / nginx: take the client IP from X-Forwarded-For
# (used by the failed-login throttle).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
