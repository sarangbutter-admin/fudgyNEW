#!/usr/bin/env python3
"""Builds ONE self-contained file (dist/bakebyculture-single.html) from index.html + styles.css + config.js + backend.js + app.js.
Handy for a quick preview. Netlify itself serves the normal files, no build step needed."""
import re, pathlib
repo = pathlib.Path(__file__).resolve().parent.parent
root = repo / "site"
html = (root / "index.html").read_text()
html = re.sub(r'<link rel="stylesheet" href="styles.css">', lambda m: "<style>\n" + (root / "styles.css").read_text() + "\n</style>", html)
def inline(m):
    return "<script>\n" + (root / m.group(1)).read_text().replace("</script", "<\\/script") + "\n</script>"
html = re.sub(r'<script src="([a-z]+\.js)"></script>', inline, html)
out = repo / "dist"; out.mkdir(exist_ok=True)
(out / "bakebyculture-single.html").write_text(html)
print("wrote", out / "bakebyculture-single.html", len(html), "bytes")
