# syntax=docker/dockerfile:1.4
FROM python:3.12-slim-bookworm AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies into virtualenv
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# ==========================================
# Runtime Stage: Small, secure, non-root
# ==========================================
FROM python:3.12-slim-bookworm AS runner

# Install runtime dependencies including curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Security: create non-root user and group
RUN groupadd -g 10001 relaygroup && \
    useradd -u 10001 -g relaygroup -s /bin/bash -m relayuser

WORKDIR /app

# Copy virtualenv from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_ENV=production \
    PORT=8000

# Copy application source code
COPY --chown=relayuser:relaygroup backend/app/ /app/app/
COPY --chown=relayuser:relaygroup backend/pyproject.toml /app/

# Setup persistent data and secret directories
RUN mkdir -p /app/data/uploads /app/secrets && \
    chown -R relayuser:relaygroup /app

USER relayuser:relaygroup

VOLUME ["/app/data"]

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/api/health/ready || exit 1

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
