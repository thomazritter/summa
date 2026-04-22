FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies (ONNX Runtime - much lighter than PyTorch)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download and convert model to ONNX at build time
RUN python -c "from transformers import AutoTokenizer; \
    from optimum.onnxruntime import ORTModelForSequenceClassification; \
    AutoTokenizer.from_pretrained('cross-encoder/nli-deberta-v3-base'); \
    ORTModelForSequenceClassification.from_pretrained('cross-encoder/nli-deberta-v3-base', export=True)"

COPY app.py .

ENV PORT=5050

EXPOSE 5050

CMD gunicorn --bind 0.0.0.0:${PORT:-5050} --workers 1 --threads 1 --timeout 300 --keep-alive 75 --preload app:app
