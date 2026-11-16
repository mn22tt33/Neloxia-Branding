FROM mcr.microsoft.com/playwright/python:v1.64.1-noble

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1 \
    QUIZORA_REQUIRE_DATABASE=1

CMD ["python", "server.py"]
