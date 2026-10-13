#!/bin/sh
set -e

# ==============================================================================
# HIRINGAI / ROLEREADY UNIFIED CONTAINER ENTRYPOINT
# ==============================================================================

# Support custom port for cloud environments (Cloud Run, Render, Heroku)
PORT="${PORT:-80}"
if [ "$PORT" != "80" ]; then
    echo "[Entrypoint] Configuring Nginx to listen on port $PORT..."
    sed -i "s/listen 80;/listen $PORT;/g" /etc/nginx/conf.d/default.conf
fi

# Ensure storage directories exist
mkdir -p /app/media/resumes /app/media/student_resumes /app/media/roleready

# Optional: Run database migrations if flag is enabled
if [ "$RUN_MIGRATIONS" = "true" ]; then
    echo "[Entrypoint] Running database migrations..."
    python migrate_multitenant_schema.py || true
    python migrate_roleready_schema.py || true
    python migrate_student_schema.py || true
fi

# Trap SIGTERM and SIGINT to cleanly shut down child processes
cleanup() {
    echo "[Entrypoint] Received termination signal. Shutting down gracefully..."
    kill -TERM "$GUNICORN_PID" 2>/dev/null || true
    nginx -s quit 2>/dev/null || true
    wait "$GUNICORN_PID" 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

echo "[Entrypoint] Starting Gunicorn ASGI server on 127.0.0.1:8000..."
gunicorn -w "${WORKERS:-2}" \
         -k uvicorn.workers.UvicornWorker \
         main:app \
         --bind 127.0.0.1:8000 \
         --access-logfile - \
         --error-logfile - &
GUNICORN_PID=$!

# Wait for backend to initialize
echo "[Entrypoint] Waiting for backend liveness probe..."
for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:8000/health/live > /dev/null 2>&1; then
        echo "[Entrypoint] Backend is live!"
        break
    fi
    sleep 1
done

echo "[Entrypoint] Starting Nginx on port $PORT..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Wait for either process to exit
wait -n "$GUNICORN_PID" "$NGINX_PID"
cleanup
