FROM eclipse-temurin:17-jdk

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY server.py .

# The server starts as root only to switch to a throwaway numeric uid per run and to clean up; the container drops every other
# capability (docker-compose.prod.yml). Candidate code never runs as root.
EXPOSE 2358
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:2358/health')"]
CMD ["python3", "server.py"]
