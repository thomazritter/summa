from flask import Flask, request, jsonify
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

MODEL_NAME = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"

logging.info(f"Carregando modelo NLI: {MODEL_NAME}...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
model.eval()
logging.info("Modelo NLI carregado com sucesso.")

# DeBERTa-MNLI label mapping: 0=entailment, 1=neutral, 2=contradiction
LABELS = ["entailment", "neutral", "contradiction"]
LABEL_MAP = {"entailment": "supported", "contradiction": "contradicted", "neutral": "neutral"}


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL_NAME})


@app.route("/classify", methods=["POST"])
def classify():
    data = request.json
    premise = data.get("premise", "")
    hypothesis = data.get("hypothesis", "")

    if not premise or not hypothesis:
        return jsonify({"error": "premise and hypothesis are required"}), 400

    inputs = tokenizer(premise, hypothesis, return_tensors="pt", truncation=True, max_length=512)

    with torch.no_grad():
        outputs = model(**inputs)

    probs = torch.softmax(outputs.logits, dim=1)[0]
    scores = {LABELS[i]: float(probs[i]) for i in range(len(LABELS))}

    best_label = max(scores, key=scores.get)

    return jsonify({
        "label": LABEL_MAP[best_label],
        "confidence": scores[best_label],
        "scores": {LABEL_MAP[k]: v for k, v in scores.items()},
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)
