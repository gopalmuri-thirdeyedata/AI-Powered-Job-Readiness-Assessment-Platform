# ==============================================================================
# HIRINGAI BACKEND DOCKERFILE (PRODUCTION)
# ==============================================================================
# Two parts, so a code-only deploy never reinstalls dependencies:
#   deps    - system packages and requirements.txt (the proctoring models, ONNX files, ship in the application source: backend/models).
#             It only changes when requirements.txt (or this part of the file) changes.
#   runtime - the application source on top of `deps`, or on top of a prebuilt, tagged copy of it
#             (scripts/build-images.sh builds and tags that copy, so a pruned build cache cannot make a deploy slow).
# BASE_IMAGE defaults to the `deps` stage, so a plain `docker compose build backend` is equivalent to a single-stage build.
ARG BASE_IMAGE=deps

FROM python:3.11-slim AS deps

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# System dependencies: curl for the healthcheck, libglib2.0-0 for OpenCV (the headless build needs no libGL)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies. Proctoring runs on ONNX Runtime + OpenCV (headless), so there is no PyTorch / ultralytics in this image any more:
# a much smaller image, and no ~500 MB of torch in every gunicorn worker.
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Non-root user and the media/data directories. (The proctoring models, backend/models/*.onnx, are copied with the source below.)
RUN useradd -m -u 1000 appuser \
    && mkdir -p media/resumes data models \
    && chown -R appuser:appuser /app

# ==== RUNTIME STAGE (everything above this line is hashed into the base image tag by scripts/build-images.sh) ====
FROM ${BASE_IMAGE} AS runtime

WORKDIR /app

# Copy application source code
COPY --chown=appuser:appuser . .

USER appuser

# Expose FastAPI port
EXPOSE 8000

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health/live || exit 1

# Production ASGI server using Gunicorn + Uvicorn workers with 180s timeout for AI analysis
CMD ["gunicorn", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "main:app", "--bind", "0.0.0.0:8000", "--timeout", "180"]
