FROM python:3.11-slim

WORKDIR /app

# gcc for native deps; git is required by some bert-score install paths
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc git && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download models at build time so cold starts don't pay the download cost:
# - mDeBERTa NLI (ONNX, ~280MB) for the /classify endpoint (legacy, retained
#   defensively in case any external caller still hits it)
# - XLM-RoBERTa-Large (~2.2GB) for BERTScore at /quality. We pin to this
#   model rather than the bert-score `lang="pt"` default (mBERT, 2018)
#   because XLM-RoBERTa-Large is the stronger multilingual encoder routinely
#   adopted by recent cross-lingual evaluation work and is more reliable for
#   the EN article / PT summary setting of the Summa.
RUN python -c "from transformers import AutoTokenizer, AutoModel; \
    from huggingface_hub import hf_hub_download; \
    AutoTokenizer.from_pretrained('MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7'); \
    hf_hub_download(repo_id='xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7', filename='onnx/model.onnx'); \
    AutoTokenizer.from_pretrained('xlm-roberta-large'); \
    AutoModel.from_pretrained('xlm-roberta-large')"

COPY app.py .

ENV PORT=5050

EXPOSE 5050

CMD gunicorn --bind 0.0.0.0:${PORT:-5050} --workers 1 --threads 1 --timeout 300 --keep-alive 75 --preload app:app
