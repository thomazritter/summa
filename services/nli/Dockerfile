FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies (CPU-only torch)
COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# Download model at build time so it's baked into the image
RUN python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification; \
    AutoTokenizer.from_pretrained('cross-encoder/nli-deberta-v3-base'); \
    AutoModelForSequenceClassification.from_pretrained('cross-encoder/nli-deberta-v3-base')"

COPY app.py .

ENV PORT=5050

EXPOSE 5050

CMD gunicorn --bind 0.0.0.0:${PORT:-5050} --workers 1 --threads 1 --timeout 300 --keep-alive 75 --preload app:app
