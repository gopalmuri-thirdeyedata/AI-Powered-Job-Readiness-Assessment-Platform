FROM eclipse-temurin:17-jdk

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 g++ \
    && rm -rf /var/lib/apt/lists/*

# Precompiled <bits/stdc++.h>: the hidden C++ prelude includes it, and without this every compile spends seconds parsing it.
# The flags MUST match server.py's g++ command exactly (-O2 -std=gnu++17), or GCC silently ignores the .gch and parses the header again.
# Compiles use -I/opt/pch, so bits/stdc++.h.gch there is found before the real header.
RUN mkdir -p /opt/pch/bits \
    && HEADER="$(find /usr/include -path '*/bits/stdc++.h' | head -n 1)" \
    && test -n "$HEADER" \
    && g++ -O2 -std=gnu++17 -x c++-header "$HEADER" -o /opt/pch/bits/stdc++.h.gch \
    && chmod -R a+rX /opt/pch

WORKDIR /srv
COPY server.py .

# The server starts as root only to switch to a throwaway numeric uid per run and to clean up; the container drops every other
# capability (docker-compose.prod.yml). Candidate code never runs as root.
EXPOSE 2358
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:2358/health')"]
CMD ["python3", "server.py"]
