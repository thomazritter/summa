FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed by torch/transformers
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc git && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies (bert-score pulls in torch + transformers)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the multilingual BERT model used by BERTScore for lang="pt"
# (bert-base-multilingual-cased — ~700MB). Avoids cold-start downloads on first request.
RUN python -c "from transformers import AutoTokenizer, AutoModel; \
    AutoTokenizer.from_pretrained('bert-base-multilingual-cased'); \
    AutoModel.from_pretrained('bert-base-multilingual-cased')"

COPY app.py .

ENV PORT=5052

EXPOSE 5052

CMD gunicorn --bind 0.0.0.0:${PORT:-5052} --workers 1 --threads 1 --timeout 300 --keep-alive 75 --preload app:app
