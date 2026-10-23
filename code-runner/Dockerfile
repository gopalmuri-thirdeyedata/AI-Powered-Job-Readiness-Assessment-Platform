FROM eclipse-temurin:17-jdk

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home runner

WORKDIR /srv
COPY server.py .

# Compile/run candidate code as an unprivileged user
USER runner
EXPOSE 2358
CMD ["python3", "server.py"]
