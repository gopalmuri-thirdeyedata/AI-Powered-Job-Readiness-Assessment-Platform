# ==============================================================================
# HIRINGAI BACKEND DOCKERFILE (PRODUCTION)
# ==============================================================================
# Two parts, so a code-only deploy never reinstalls dependencies:
#   deps    - system packages, CPU-only PyTorch, requirements.txt and the proctoring model.
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

# Install CPU-only PyTorch first (saves 3GB CUDA overhead)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install Python dependencies.
# ultralytics depends on the full `opencv-python` (it needs libGL), while requirements.txt pins `opencv-python-headless`; both
# provide the same `cv2` package and the one installed last wins. Until now the image ran the full build (cv2 5.0.0) next to an unused
# headless 4.10. A server needs only the headless build, so the full one is removed and the headless build of the SAME version
# (5.0.0.93) is restored: identical cv2 behaviour, no libGL, one copy of OpenCV instead of two.
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt \
    && pip uninstall -y opencv-python \
    && pip install --force-reinstall --no-deps opencv-python-headless==5.0.0.93

# Non-root user, media/data directories, and the proctoring model (yolov8n.pt, ~6 MB). The model used to be downloaded from GitHub by
# every gunicorn worker at every container start; with the file in the image the proctor service finds it and downloads nothing.
# A failed download here is not fatal: the service then falls back to downloading it on first use, as before.
RUN useradd -m -u 1000 appuser \
    && mkdir -p media/resumes data models \
    && (python -c "from ultralytics.utils.downloads import attempt_download_asset; attempt_download_asset('models/yolov8n.pt')" \
        || echo "[build] could not pre-download yolov8n.pt; it will be fetched on first use") \
    && rm -rf /tmp/Ultralytics /root/.config/Ultralytics \
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
