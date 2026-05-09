"""
Summary Metrics Service.

Computes quality and personalization metrics for generated summaries:
- ROUGE-1/2/L (n-gram overlap with reference)
- BERTScore (semantic similarity)
- P-Accuracy (personalization sensitivity — do different profiles produce different summaries?)

Runs on port 5052 (configurable via PORT env var).
"""

from flask import Flask, request, jsonify
import logging
import numpy as np

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

# Lazy-loaded BERTScorer
_bert_scorer = None


def get_bert_scorer():
    global _bert_scorer
    if _bert_scorer is None:
        from bert_score import BERTScorer
        logging.info("Carregando BERTScorer (modelo multilingual)...")
        _bert_scorer = BERTScorer(lang="pt", rescale_with_baseline=False)
        logging.info("BERTScorer carregado.")
    return _bert_scorer


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "metrics", "available": ["rouge", "bert_score", "p_accuracy"]})


# ─── ROUGE + BERTScore ──────────────────────────────────────────────

@app.route("/quality", methods=["POST"])
def compute_quality_metrics():
    """
    Compute ROUGE and BERTScore for a summary against a reference.

    Input:
    {
        "summary": "generated summary text",
        "reference": "reference text (e.g., article abstract)",
        "compute_bert_score": true/false (default: false, slower)
    }

    Returns:
    {
        "rouge": { "rouge1": {p, r, f1}, "rouge2": {p, r, f1}, "rougeL": {p, r, f1} },
        "bert_score": { "precision": float, "recall": float, "f1": float }
    }
    """
    data = request.json
    summary = data.get("summary", "")
    reference = data.get("reference", "")
    compute_bert = data.get("compute_bert_score", False)

    if not summary or not reference:
        return jsonify({"error": "summary and reference are required"}), 400

    result = {}

    # ROUGE
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

    # BERTScore
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
    """
    Compute metrics for multiple summaries.

    Input:
    {
        "items": [
            { "id": 1, "summary": "...", "reference": "..." },
            ...
        ],
        "compute_bert_score": true/false
    }
    """
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

    # BERTScore in batch
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


# ─── P-Accuracy (Personalization Sensitivity) ──────────────────────

@app.route("/p-accuracy", methods=["POST"])
def compute_p_accuracy():
    """
    Measure if the system produces meaningfully different summaries
    for different profiles (same article).

    Based on Bhandari et al. (2023): a system that ignores personalization
    signals will score low on P-Accuracy.
    """
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
        logging.warning(f"BERTScore failed for P-Accuracy: {e}")

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
    import os
    port = int(os.environ.get("PORT", 5052))
    logging.info(f"Metrics Service starting on port {port}")
    app.run(host="0.0.0.0", port=port)
