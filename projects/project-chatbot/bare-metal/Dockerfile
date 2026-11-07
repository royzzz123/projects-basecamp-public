# syntax=docker/dockerfile:1.7
# Bare-metal Dockerfile for SEBI chatbot service.
# Pins linux/amd64 in both stages so the image is portable to an offline VM
# via `docker save` / `docker load`.

FROM --platform=linux/amd64 python:3.12-slim AS build
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM --platform=linux/amd64 python:3.12-slim
WORKDIR /app

COPY --from=build /install /usr/local
COPY . .

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_PORT=3001

EXPOSE 3001

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${APP_PORT}"]
