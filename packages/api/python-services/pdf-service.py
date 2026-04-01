"""
PDF Extraction Service using PyMuPDF.

Extracts structured text from academic PDFs, handling multi-column layouts
and identifying standard sections (abstract, introduction, methodology, etc.).

Usage:
    pip install pymupdf flask
    python pdf-service.py

Runs on port 5051.
"""

from flask import Flask, request, jsonify
import fitz  # PyMuPDF
import re
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

MAX_PDF_SIZE = 10 * 1024 * 1024  # 10MB

# Section number prefixes: "1.", "2.", "I.", "II.", "IV.", or none
NUM_PREFIX = r"(?:(?:\d+|[IVX]+)[\.\s]+)?"

# Section patterns for academic articles (English + Portuguese)
SECTION_PATTERNS = [
    (re.compile(rf"^{NUM_PREFIX}(abstract|resumo)\b", re.IGNORECASE), "abstract"),
    (re.compile(rf"^{NUM_PREFIX}(introduction|introdu[çc][ãa]o)\b", re.IGNORECASE), "introduction"),
    (re.compile(rf"^{NUM_PREFIX}(methodology|methods|materials\s+and\s+methods|metodologia|m[ée]todos|experimental\s+(?:setup|design)|research\s+method|study\s+design|research\s+design)\b", re.IGNORECASE), "methodology"),
    (re.compile(rf"^{NUM_PREFIX}(results|resultados|results\s+and\s+discussion|findings|the\s+outcomes?\s+of)\b", re.IGNORECASE), "results"),
    (re.compile(rf"^{NUM_PREFIX}(discussion|discuss[ãa]o|implications?)\b", re.IGNORECASE), "discussion"),
    (re.compile(rf"^{NUM_PREFIX}(conclusion|conclusions|conclus[ãa]o|conclus[õo]es|summary\s+and\s+conclusions?|summary)\b", re.IGNORECASE), "conclusion"),
]

# Sections that mark end of useful content
STOP_PATTERNS = [
    re.compile(rf"^{NUM_PREFIX}(references|refer[êe]ncias|bibliography|acknowledgements?|agradecimentos)\b", re.IGNORECASE),
]


def extract_text_pymupdf(pdf_bytes: bytes) -> tuple[str, dict]:
    """Extract text from PDF using PyMuPDF with proper column handling."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    full_text_parts = []
    for page in doc:
        # sort=True ensures proper reading order in multi-column layouts
        text = page.get_text("text", sort=True)
        full_text_parts.append(text)

    raw_text = "\n".join(full_text_parts)

    metadata = {}
    if doc.metadata:
        metadata = {
            "title": doc.metadata.get("title", ""),
            "authors": doc.metadata.get("author", ""),
            "subject": doc.metadata.get("subject", ""),
        }

    page_count = len(doc)
    doc.close()

    # Fallback: extract title from first meaningful line
    if not metadata.get("title"):
        lines = [l.strip() for l in raw_text.split("\n") if l.strip()]
        if lines and len(lines[0]) < 200:
            metadata["title"] = lines[0]

    metadata["pageCount"] = page_count
    return raw_text, metadata


def structure_article(text: str) -> dict:
    """Identify and extract standard academic sections from raw text."""
    lines = text.split("\n")
    sections = {}
    current_key = None
    current_lines = []
    stopped = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if current_key:
                current_lines.append("")  # preserve paragraph breaks
            continue

        if stopped:
            continue

        # Check stop patterns (references, acknowledgements)
        for stop_pat in STOP_PATTERNS:
            if stop_pat.match(stripped):
                # Save current section before stopping
                if current_key:
                    content = "\n".join(current_lines).strip()
                    if content:
                        sections[current_key] = content
                stopped = True
                break

        if stopped:
            continue

        # Check section patterns
        matched_key = None
        for pattern, key in SECTION_PATTERNS:
            if pattern.match(stripped):
                matched_key = key
                break

        if matched_key:
            # Save previous section
            if current_key:
                content = "\n".join(current_lines).strip()
                if content:
                    sections[current_key] = content

            current_key = matched_key
            current_lines = []
        elif current_key:
            current_lines.append(stripped)

    # Save last section
    if current_key and not stopped:
        content = "\n".join(current_lines).strip()
        if content:
            sections[current_key] = content

    return {
        "abstract": sections.get("abstract"),
        "introduction": sections.get("introduction"),
        "methodology": sections.get("methodology"),
        "results": sections.get("results"),
        "discussion": sections.get("discussion"),
        "conclusion": sections.get("conclusion"),
        "sections": [
            {"title": k, "content": v[:300] + "..." if len(v) > 300 else v, "level": 1}
            for k, v in sections.items()
        ],
    }


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "pdf-extraction", "engine": "PyMuPDF"})


@app.route("/extract", methods=["POST"])
def extract_pdf():
    """
    Extract structured text from a PDF file.

    Send as multipart/form-data with key 'file'.

    Returns:
    {
        "rawText": "full extracted text...",
        "structuredContent": {
            "abstract": "...", "introduction": "...", ...
        },
        "metadata": { "title": "...", "authors": "...", "pageCount": N }
    }
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided. Send as multipart/form-data with key 'file'."}), 400

    file = request.files["file"]
    pdf_bytes = file.read()

    if len(pdf_bytes) == 0:
        return jsonify({"error": "Empty file"}), 400

    if len(pdf_bytes) > MAX_PDF_SIZE:
        return jsonify({"error": f"File exceeds {MAX_PDF_SIZE // (1024*1024)}MB limit"}), 400

    try:
        raw_text, metadata = extract_text_pymupdf(pdf_bytes)
        structured = structure_article(raw_text)

        # Log extraction quality
        detected = [k for k in ["abstract", "introduction", "methodology", "results", "discussion", "conclusion"] if structured.get(k)]
        logging.info(f"Extracted '{metadata.get('title', 'unknown')}': {len(detected)} sections detected ({', '.join(detected)})")

        return jsonify({
            "rawText": raw_text,
            "structuredContent": structured,
            "metadata": metadata,
        })
    except Exception as e:
        logging.error(f"PDF extraction error: {e}")
        return jsonify({"error": f"Failed to extract PDF: {str(e)}"}), 500


if __name__ == "__main__":
    logging.info("PDF Extraction Service (PyMuPDF)")
    logging.info("Porta: 5051")
    app.run(host="0.0.0.0", port=5051)
