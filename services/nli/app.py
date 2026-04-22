"""
NLI (Natural Language Inference) microservice for factuality verification.

Uses cross-encoder/nli-deberta-v3-base to classify premise-hypothesis pairs
as supported (entailment), contradicted (contradiction), or neutral.
"""

import logging
import os

from flask import Flask, jsonify, request
from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

MODEL_NAME = "cross-encoder/nli-deberta-v3-base"

# NLI label mapping: the cross-encoder model outputs [contradiction, entailment, neutral]
LABEL_MAP = {0: "contradicted", 1: "supported", 2: "neutral"}

app = Flask(__name__)

# Load model and tokenizer at startup
logger.info("Loading model: %s", MODEL_NAME)
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, torch_dtype=torch.float32)
model.eval()
torch.set_num_threads(1)
logger.info("Model loaded successfully")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL_NAME})


@app.route("/classify", methods=["POST"])
def classify():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    premise = data.get("premise", "").strip()
    hypothesis = data.get("hypothesis", "").strip()

    if not premise or not hypothesis:
        return jsonify({"error": "Both 'premise' and 'hypothesis' are required"}), 400

    # Truncate inputs to avoid exceeding model max length (512 tokens)
    # Leave room for special tokens by truncating text conservatively
    max_chars = 1500
    premise = premise[:max_chars]
    hypothesis = hypothesis[:max_chars]

    try:
        inputs = tokenizer(
            premise,
            hypothesis,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        )

        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits
            probabilities = torch.softmax(logits, dim=1).squeeze()

        scores = {
            LABEL_MAP[i]: round(probabilities[i].item(), 4)
            for i in range(len(LABEL_MAP))
        }

        predicted_idx = torch.argmax(probabilities).item()
        label = LABEL_MAP[predicted_idx]
        confidence = scores[label]

        return jsonify({
            "label": label,
            "confidence": confidence,
            "scores": scores,
        })

    except Exception:
        logger.exception("Error during classification")
        return jsonify({"error": "Classification failed"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port)
