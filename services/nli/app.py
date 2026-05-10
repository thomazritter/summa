"""
ML microservice combining factuality verification (NLI) and quality metrics
(ROUGE, BERTScore, P-Accuracy).

NLI runs through ONNX Runtime to avoid pulling PyTorch for the entailment path.
BERTScore is lazy-loaded on first request because it brings torch into memory.
"""

import logging
import os

import numpy as np
from flask import Flask, jsonify, request
from transformers import AutoTokenizer
from onnxruntime import InferenceSession
from huggingface_hub import hf_hub_download

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

MODEL_NAME = "MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7"
ONNX_MODEL = "xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7"

LABEL_MAP = {0: "supported", 1: "neutral", 2: "contradicted"}

app = Flask(__name__)

logger.info("Loading tokenizer: %s", MODEL_NAME)
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

logger.info("Loading ONNX model: %s", ONNX_MODEL)
model_path = hf_hub_download(repo_id=ONNX_MODEL, filename="onnx/model.onnx")
session = InferenceSession(model_path, providers=["CPUExecutionProvider"])
logger.info("NLI model loaded successfully")

_bert_scorer = None


def get_bert_scorer():
    global _bert_scorer
    if _bert_scorer is None:
        from bert_score import BERTScorer
        logger.info("Loading BERTScorer (multilingual)...")
        _bert_scorer = BERTScorer(lang="pt", rescale_with_baseline=False)
        logger.info("BERTScorer loaded.")
    return _bert_scorer


def softmax(logits):
    exp = np.exp(logits - np.max(logits))
    return exp / exp.sum()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model": MODEL_NAME,
        "endpoints": ["/classify", "/quality", "/quality/batch", "/p-accuracy"],
    })


# ─── NLI ────────────────────────────────────────────────────────────

@app.route("/classify", methods=["POST"])
def classify():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    premise = data.get("premise", "").strip()
    hypothesis = data.get("hypothesis", "").strip()

    if not premise or not hypothesis:
        return jsonify({"error": "Both 'premise' and 'hypothesis' are required"}), 400

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

        model_input_names = {i.name for i in session.get_inputs()}
        ort_inputs = {k: v for k, v in dict(inputs).items() if k in model_input_names}

        outputs = session.run(None, ort_inputs)
        logits = outputs[0][0]
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


# ─── ROUGE + BERTScore ──────────────────────────────────────────────

@app.route("/quality", methods=["POST"])
def compute_quality_metrics():
    data = request.json
    summary = data.get("summary", "")
    reference = data.get("reference", "")
    compute_bert = data.get("compute_bert_score", False)

    if not summary or not reference:
        return jsonify({"error": "summary and reference are required"}), 400

    result = {}

    from rouge_score import rouge_scorer
    scorer = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=False)
    rouge = scorer.score(reference, summary)
    result["rouge"] = {
        key: {
            "precision": round(rouge[key].precision, 4),
            "recall": round(rouge[key].recall, 4),
            "f1": round(rouge[key].fmeasure, 4),
        }
        for key in ["rouge1", "rouge2", "rougeL"]
    }

    if compute_bert:
        bert_scorer = get_bert_scorer()
        P, R, F1 = bert_scorer.score([summary], [reference])
        result["bert_score"] = {
            "precision": round(float(P[0]), 4),
            "recall": round(float(R[0]), 4),
            "f1": round(float(F1[0]), 4),
        }

    return jsonify(result)


@app.route("/quality/batch", methods=["POST"])
def compute_quality_batch():
    data = request.json
    items = data.get("items", [])
    compute_bert = data.get("compute_bert_score", False)

    if not items:
        return jsonify({"error": "items array is required"}), 400

    from rouge_score import rouge_scorer
    scorer = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=False)

    results = []
    summaries_for_bert = []
    references_for_bert = []

    for item in items:
        summary = item.get("summary", "")
        reference = item.get("reference", "")

        rouge = scorer.score(reference, summary)
        entry = {
            "id": item.get("id"),
            "rouge": {
                key: {
                    "precision": round(rouge[key].precision, 4),
                    "recall": round(rouge[key].recall, 4),
                    "f1": round(rouge[key].fmeasure, 4),
                }
                for key in ["rouge1", "rouge2", "rougeL"]
            },
        }
        results.append(entry)

        if compute_bert:
            summaries_for_bert.append(summary)
            references_for_bert.append(reference)

    if compute_bert and summaries_for_bert:
        bert_scorer = get_bert_scorer()
        P, R, F1 = bert_scorer.score(summaries_for_bert, references_for_bert)
        for i, entry in enumerate(results):
            entry["bert_score"] = {
                "precision": round(float(P[i]), 4),
                "recall": round(float(R[i]), 4),
                "f1": round(float(F1[i]), 4),
            }

    return jsonify({"results": results})


# ─── P-Accuracy ─────────────────────────────────────────────────────

@app.route("/p-accuracy", methods=["POST"])
def compute_p_accuracy():
    data = request.json
    article_id = data.get("article_id")
    summaries = data.get("summaries", [])

    if len(summaries) < 2:
        return jsonify({"error": "Need at least 2 summaries to compare"}), 400

    from rouge_score import rouge_scorer
    scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=False)

    pairwise_rouge = []
    rouge_scores_list = []

    for i in range(len(summaries)):
        for j in range(i + 1, len(summaries)):
            s1 = summaries[i]
            s2 = summaries[j]
            rouge = scorer.score(s1["content"], s2["content"])
            rouge_l_f1 = round(rouge["rougeL"].fmeasure, 4)
            pairwise_rouge.append({
                "pair": [s1["profile"], s2["profile"]],
                "rouge_l_f1": rouge_l_f1,
            })
            rouge_scores_list.append(rouge_l_f1)

    pairwise_bert = []
    bert_scores_list = []

    try:
        bert_scorer = get_bert_scorer()
        for i in range(len(summaries)):
            for j in range(i + 1, len(summaries)):
                s1 = summaries[i]
                s2 = summaries[j]
                P, R, F1 = bert_scorer.score([s1["content"]], [s2["content"]])
                bert_f1 = round(float(F1[0]), 4)
                pairwise_bert.append({
                    "pair": [s1["profile"], s2["profile"]],
                    "bert_f1": bert_f1,
                })
                bert_scores_list.append(bert_f1)
    except Exception as e:
        logger.warning(f"BERTScore failed for P-Accuracy: {e}")

    avg_rouge_sim = float(np.mean(rouge_scores_list)) if rouge_scores_list else 0
    avg_bert_sim = float(np.mean(bert_scores_list)) if bert_scores_list else 0

    p_accuracy_rouge = round(1 - avg_rouge_sim, 4)
    p_accuracy_bert = round(1 - avg_bert_sim, 4) if bert_scores_list else None

    if p_accuracy_rouge > 0.5:
        interp = "Alta diferenciacao entre perfis. O sistema responde bem aos sinais de personalizacao."
    elif p_accuracy_rouge > 0.25:
        interp = "Diferenciacao moderada entre perfis. O sistema mostra alguma sensibilidade a personalizacao."
    else:
        interp = "Baixa diferenciacao entre perfis. O sistema pode estar ignorando os sinais de personalizacao."

    return jsonify({
        "article_id": article_id,
        "p_accuracy_rouge": p_accuracy_rouge,
        "p_accuracy_bert": p_accuracy_bert,
        "avg_pairwise_rouge_l": round(avg_rouge_sim, 4),
        "avg_pairwise_bert_f1": round(avg_bert_sim, 4) if bert_scores_list else None,
        "pairwise_rouge": pairwise_rouge,
        "pairwise_bert": pairwise_bert,
        "interpretation": interp,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port)
