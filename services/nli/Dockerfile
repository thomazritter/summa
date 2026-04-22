FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies (ONNX Runtime only - no PyTorch)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download pre-converted ONNX model and tokenizer at build time
RUN python -c "from transformers import AutoTokenizer; \
    from huggingface_hub import hf_hub_download; \
    AutoTokenizer.from_pretrained('MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7'); \
    hf_hub_download(repo_id='xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7', filename='onnx/model.onnx')"

COPY app.py .

ENV PORT=5050

EXPOSE 5050

CMD gunicorn --bind 0.0.0.0:${PORT:-5050} --workers 1 --threads 1 --timeout 300 --keep-alive 75 --preload app:app
