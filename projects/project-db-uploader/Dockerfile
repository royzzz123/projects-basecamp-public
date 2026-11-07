FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir minio
COPY complaint_doc_urls.json download.py upload.py ./
CMD ["sleep", "infinity"]