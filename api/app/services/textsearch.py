"""Small text utilities: chunking and BM25 ranking (for material excerpts and the tutor)."""
from __future__ import annotations

import math
import re
from collections import Counter

STOP = set(
    "a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those "
    "you your we our they their he she his her i me my not no do does did can could should would will shall may might "
    "what which who whom how why when where than then so such into about over under also just more most other some any".split()
)


def tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOP and len(t) > 1]


def chunk(text: str, size: int = 1400, overlap: int = 200) -> list[str]:
    """Split on paragraph boundaries into ~size-character chunks with a little overlap."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out: list[str] = []
    cur = ""
    for p in paras:
        while len(p) > size:  # very long paragraph: hard split
            head, p = p[:size], p[size - overlap:]
            if cur:
                out.append(cur)
                cur = ""
            out.append(head)
        if len(cur) + len(p) + 2 > size and cur:
            out.append(cur)
            cur = cur[-overlap:] + "\n\n" + p if overlap else p
        else:
            cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        out.append(cur)
    return out


class BM25:
    def __init__(self, docs: list[str], k1: float = 1.5, b: float = 0.75):
        self.docs = [tokens(d) for d in docs]
        self.k1, self.b = k1, b
        self.avg = sum(len(d) for d in self.docs) / (len(self.docs) or 1)
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(set(d))
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.tf = [Counter(d) for d in self.docs]

    def scores(self, query: str) -> list[float]:
        q = tokens(query)
        out = []
        for d, tf in zip(self.docs, self.tf):
            s = 0.0
            for t in q:
                if t in tf:
                    f = tf[t]
                    s += self.idf.get(t, 0) * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * len(d) / (self.avg or 1)))
            out.append(s)
        return out

    def top(self, query: str, k: int = 5) -> list[tuple[int, float]]:
        ranked = sorted(enumerate(self.scores(query)), key=lambda x: x[1], reverse=True)
        return [(i, s) for i, s in ranked[:k] if s > 0]


def excerpt(text: str, query: str, budget: int = 9000) -> str:
    """The parts of `text` most relevant to `query`, in original order, within `budget` characters."""
    if len(text) <= budget:
        return text
    chunks = chunk(text)
    picked = sorted(i for i, _ in BM25(chunks).top(query, k=max(1, budget // 1400)))
    out, used = [], 0
    for i in picked:
        if used + len(chunks[i]) > budget:
            break
        out.append(chunks[i])
        used += len(chunks[i])
    return "\n\n[…]\n\n".join(out)
