"""
NLI (Natural Language Inference) microservice for factuality verification.

Uses cross-encoder/nli-deberta-v3-base via ONNX Runtime for low memory usage.
Classifies premise-hypothesis pairs as supported, contradicted, or neutral.
"""

import logging
import os

import numpy as np
from flask import Flask, jsonify, request
from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import AutoTokenizer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

MODEL_NAME = "cross-encoder/nli-deberta-v3-base"

# NLI label mapping: the cross-encoder model outputs [contradiction, entailment, neutral]
LABEL_MAP = {0: "contradicted", 1: "supported", 2: "neutral"}

app = Flask(__name__)

# Load model and tokenizer at startup using ONNX Runtime (much less memory than PyTorch)
logger.info("Loading model: %s (ONNX)", MODEL_NAME)
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = ORTModelForSequenceClassification.from_pretrained(MODEL_NAME, export=True)
logger.info("Model loaded successfully")


def softmax(logits):
    exp = np.exp(logits - np.max(logits))
    return exp / exp.sum()


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

    # Truncate inputs to avoid exceeding model max length
    max_chars = 1500
    premise = premise[:max_chars]
    hypothesis = hypothesis[:max_chars]

    try:
        inputs = tokenizer(
            premise,
            hypothesis,
            return_tensors="np",
            truncation=True,
            max_length=512,
            padding=True,
        )

        outputs = model(**inputs)
        logits = outputs.logits[0]
        probabilities = softmax(logits)

        scores = {
            LABEL_MAP[i]: round(float(probabilities[i]), 4)
            for i in range(len(LABEL_MAP))
        }

        predicted_idx = int(np.argmax(probabilities))
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
