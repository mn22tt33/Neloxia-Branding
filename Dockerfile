FROM mcr.microsoft.com/playwright/python:v1.64.1-noble

WORKDIR /app

COPY backend/requirements.txt ./backend/
RUN python -m pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

ENV PYTHONUNBUFFERED=1 \
    QUIZORA_REQUIRE_DATABASE=1

CMD ["python", "backend/server.py"]
