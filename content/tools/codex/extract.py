# Extracts the page texts of the owner's French Codex PDFs (never committed) into content/tools/out/codex/<book>/
# (git-ignored), only for curation. The PDFs are scans with an OCR layer: the text is noisy, so the agents also read
# the page images.
# Run: <venv with pypdf>/bin/python -I content/tools/codex/extract.py <book> <pdf>
# Books: aventureux (Complete Adventurer), martial (Complete Warrior), divin (Complete Divine), profane (Complete Arcane).
import json, sys
from pathlib import Path
import pypdf

OUT = Path(__file__).resolve().parents[1] / 'out' / 'codex'


def main(book, pdf):
    texts = [p.extract_text() or '' for p in pypdf.PdfReader(pdf).pages]
    out = OUT / book
    out.mkdir(parents=True, exist_ok=True)
    (out / 'pages.json').write_text(json.dumps(texts, ensure_ascii=False))
    print(out / 'pages.json', len(texts), 'pages')


if __name__ == '__main__':
    main(*sys.argv[1:])
