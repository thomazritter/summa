FROM python:3.11-slim

WORKDIR /app

# gcc for native deps; git is required by some bert-score install paths
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc git && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download both models at build time so cold starts don't pay the download cost:
# - mDeBERTa NLI (ONNX, ~280MB) for /classify
# - bert-base-multilingual-cased (~700MB) for BERTScore at /quality and /p-accuracy
RUN python -c "from transformers import AutoTokenizer, AutoModel; \
    from huggingface_hub import hf_hub_download; \
    AutoTokenizer.from_pretrained('MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7'); \
    hf_hub_download(repo_id='xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7', filename='onnx/model.onnx'); \
    AutoTokenizer.from_pretrained('bert-base-multilingual-cased'); \
    AutoModel.from_pretrained('bert-base-multilingual-cased')"

COPY app.py .

ENV PORT=5050

EXPOSE 5050

CMD gunicorn --bind 0.0.0.0:${PORT:-5050} --workers 1 --threads 1 --timeout 300 --keep-alive 75 --preload app:app
