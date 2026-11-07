# Extracts the owner's French Monster Manual PDF (never committed) into content/tools/out/creatures/ (git-ignored),
# only for curation: the page texts (a noisy OCR layer) and PNG images of the pages the creature batches use, which
# the agents read (the OCR scrambles the multi-column stat blocks).
# Run: <venv with pymupdf>/bin/python -I content/tools/creatures/extract.py <pdf>
import json, sys
from pathlib import Path
import pymupdf

OUT = Path(__file__).resolve().parents[1] / 'out' / 'creatures'

# PDF pages (1-based) of the creatures the batches cover: dire animals, dinosaurs, elementals, plants, animals appendix.
PAGES = [*range(15, 22), *range(68, 72), *range(94, 102), 168, 169, *range(234, 243), *range(268, 286)]


def main(pdf):
    doc = pymupdf.open(pdf)
    OUT.mkdir(parents=True, exist_ok=True)
    texts = [page.get_text() for page in doc]
    (OUT / 'pages.json').write_text(json.dumps(texts, ensure_ascii=False))
    images = OUT / 'pages'
    images.mkdir(exist_ok=True)
    for n in PAGES:
        doc[n - 1].get_pixmap(dpi=110).save(images / f'p{n}.png')
    print(OUT, len(texts), 'pages,', len(PAGES), 'images')


if __name__ == '__main__':
    main(*sys.argv[1:])
