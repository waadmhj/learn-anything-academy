"""Resource discovery: find well-rated, real material for a subject.

Quality signals ("best evaluated"):
  * Hacker News: story points and comment counts, plus links recommended by several commenters in
    "Ask HN: how do I learn X / best resources for X" threads.
  * Open Library: reader ratings and how many people want to read the book.
  * Semantic Scholar: citation counts (arXiv as a fallback when Semantic Scholar is unavailable).
  * Wikipedia: a neutral overview for each lesson.
  * YouTube (optional, needs YOUTUBE_API_KEY): like and view counts.

Nothing here is generated: every resource is a real URL returned by one of these services.
Tests replace the backend with `set_backend(...)`.
"""
from __future__ import annotations

import html
import ipaddress
import logging
import math
import re
import socket
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from urllib.parse import quote, urljoin, urlparse

import httpx
from defusedxml import ElementTree as SafeET

from ..config import get_settings

log = logging.getLogger("academy.sources")


def user_agent() -> str:
    return f"LearnAnythingAcademy/0.1 ({get_settings().public_url}) httpx/{httpx.__version__}"


@dataclass
class Candidate:
    title: str
    url: str
    type: str  # article | video | book | paper | docs | course | interactive | discussion
    source: str  # hackernews | wikipedia | openlibrary | semanticscholar | arxiv | youtube
    provider: str
    summary: str = ""
    score: int | None = None
    comments: int | None = None
    discussion_url: str | None = None
    rating: float | None = None
    authors: str | None = None
    year: int | None = None
    isbn: str | None = None
    youtube_id: str | None = None
    duration: str = ""
    recommended_by: int = 0
    queries: set[str] = field(default_factory=set)

    @property
    def key(self) -> str:
        return normalize_url(self.url)

    def quality(self) -> float:
        """Comparable 0..~3 quality signal across sources."""
        if self.source == "hackernews" and self.recommended_by:
            return 1.2 + 0.5 * self.recommended_by
        if self.source == "hackernews":
            return math.log10(max(self.score or 1, 1)) / 1.5 + math.log10(max(self.comments or 1, 1)) / 4
        if self.source == "openlibrary":
            return math.log10(max(self.score or 1, 1)) / 1.5 + (self.rating or 0) / 5
        if self.source in ("semanticscholar", "arxiv"):
            return math.log10(max(self.score or 1, 1)) / 2
        if self.source == "youtube":
            return math.log10(max(self.score or 1, 1)) / 2.5
        if self.source == "wikipedia":
            return 1.0
        return 0.5

    def signal(self) -> str:
        """Human-readable evidence of quality."""
        if self.source == "hackernews" and self.recommended_by:
            return f"Recommended by {self.recommended_by} commenters on Hacker News"
        if self.source == "hackernews":
            return f"▲ {self.score or 0:,} points · {self.comments or 0:,} comments on Hacker News"
        if self.source == "openlibrary":
            bits = []
            if self.rating:
                bits.append(f"rated {self.rating:.1f}/5")
            if self.score:
                bits.append(f"{self.score:,} readers")
            return "Open Library: " + ", ".join(bits) if bits else "Open Library"
        if self.source == "semanticscholar":
            return f"Cited by {self.score or 0:,} papers"
        if self.source == "youtube":
            return f"{self.score or 0:,} likes on YouTube"
        if self.source == "wikipedia":
            return "Wikipedia overview"
        return self.provider


def normalize_url(url: str) -> str:
    u = urlparse(url.strip())
    host = (u.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    path = u.path.rstrip("/")
    query = u.query if host in ("youtube.com", "news.ycombinator.com") else ""
    return f"{host}{path}?{query}" if query else f"{host}{path}"


_YT = re.compile(r"(?:youtube\.com/watch\?(?:.*&)?v=|youtu\.be/|youtube\.com/embed/)([A-Za-z0-9_-]{11})")


def classify(url: str, title: str = "") -> tuple[str, str | None]:
    """(type, youtube_id) from a URL."""
    m = _YT.search(url)
    if m:
        return "video", m.group(1)
    host = (urlparse(url).hostname or "").lower()
    path = urlparse(url).path.lower()
    if "youtube.com" in host:
        return "video", None
    if "arxiv.org" in host or path.endswith(".pdf") or "doi.org" in host:
        return "paper", None
    if any(h in host for h in ("coursera.org", "edx.org", "udemy.com", "khanacademy.org", "ocw.mit.edu", "udacity.com")):
        return "course", None
    if host.startswith("docs.") or "readthedocs" in host or "/docs" in path:
        return "docs", None
    if "github.com" in host:
        return "interactive", None
    if title.lower().startswith(("ask hn", "tell hn")) or "news.ycombinator.com" in host:
        return "discussion", None
    if any(h in host for h in ("amazon.", "goodreads.com", "oreilly.com", "manning.com", "nostarch.com", "pragprog.com")):
        return "book", None
    return "article", None


_STOP = {"the", "and", "for", "with", "how", "what", "why", "into", "from", "your", "about", "this", "that", "are", "use", "using", "introduction", "basics"}


def _terms(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9+#]+", text.lower()) if len(t) > 2 and t not in _STOP}


def domain(url: str) -> str:
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


# ───────────────────────────── HTTP ─────────────────────────────
_client: httpx.Client | None = None


def _http() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=get_settings().http_timeout_seconds, headers={"User-Agent": user_agent()}, follow_redirects=True)
    return _client


def get_json(url: str, params: dict | None = None) -> dict | list | None:
    try:
        r = _http().get(url, params=params)
        if r.status_code != 200:
            log.info("GET %s -> %s", url, r.status_code)
            return None
        return r.json()
    except (httpx.HTTPError, ValueError) as e:
        log.info("GET %s failed: %s", url, e)
        return None


def get_text(url: str, params: dict | None = None) -> str | None:
    try:
        r = _http().get(url, params=params)
        return r.text if r.status_code == 200 else None
    except httpx.HTTPError as e:
        log.info("GET %s failed: %s", url, e)
        return None


def _public_host(host: str) -> bool:
    """Only fetch pages on public internet addresses (no localhost, private networks or cloud metadata)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    return bool(infos) and all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


@lru_cache(maxsize=2048)
def page_title(url: str) -> str | None:
    """Fetch a public page's <title> (first 64 KB, at most 3 redirects, each hop re-checked)."""
    if not get_settings().fetch_titles:
        return None
    for _ in range(4):
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname or not _public_host(u.hostname):
            return None
        try:
            with httpx.Client(timeout=6.0, headers={"User-Agent": user_agent()}, follow_redirects=False) as c, c.stream("GET", url) as r:
                if r.is_redirect and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
                    return None
                buf = b""
                for chunk in r.iter_bytes():
                    buf += chunk
                    if len(buf) > 65_536:
                        break
        except httpx.HTTPError:
            return None
        m = _TITLE.search(buf.decode("utf-8", "ignore"))
        if not m:
            return None
        t = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()
        return t[:200] or None
    return None


def title_from_url(url: str) -> str:
    u = urlparse(url)
    if "youtube.com" in (u.hostname or ""):
        handle = next((p for p in u.path.split("/") if p.startswith("@")), None)
        return f"YouTube channel {handle}" if handle else "YouTube channel"
    tail = [p for p in u.path.split("/") if p][-1:] or [""]
    words = re.sub(r"[-_]+|\.(html?|php|aspx?)$", " ", tail[0]).strip()
    return f"{words.title()} ({domain(url)})" if words else domain(url)


# ───────────────────────────── Backends ─────────────────────────────
class WebBackend:
    def hn_stories(self, query: str, min_points: int = 15, limit: int = 12) -> list[Candidate]:
        data = get_json(
            "https://hn.algolia.com/api/v1/search",
            {"query": query, "tags": "story", "numericFilters": f"points>={min_points}", "hitsPerPage": 40},
        )
        out = []
        for h in (data or {}).get("hits", []):
            title = (h.get("title") or "").strip()
            if not title:
                continue
            item_url = f"https://news.ycombinator.com/item?id={h['objectID']}"
            url = h.get("url") or item_url
            kind, yt = classify(url, title)
            out.append(Candidate(
                title=title, url=url, type=kind, source="hackernews", provider=domain(url) or "news.ycombinator.com",
                score=h.get("points") or 0, comments=h.get("num_comments") or 0, discussion_url=item_url,
                year=int(h["created_at"][:4]) if h.get("created_at") else None, youtube_id=yt, queries={query},
            ))
        out.sort(key=lambda c: c.score or 0, reverse=True)
        return out[:limit]

    def hn_recommendations(self, subject: str, limit: int = 12) -> list[Candidate]:
        """Links that several commenters recommend in highly-voted 'Ask HN' threads about learning the subject."""
        threads: dict[str, dict] = {}
        for q in (f"{subject} resources", f"learn {subject}", f"{subject} books"):
            data = get_json("https://hn.algolia.com/api/v1/search", {"query": q, "tags": "ask_hn", "numericFilters": "points>=20", "hitsPerPage": 10})
            for h in (data or {}).get("hits", []):
                threads.setdefault(h["objectID"], h)
        terms = {t for t in re.findall(r"[a-z0-9+#]+", subject.lower()) if len(t) > 2}
        relevant = [h for h in threads.values() if terms & set(re.findall(r"[a-z0-9+#]+", (h.get("title") or "").lower()))]
        relevant.sort(key=lambda h: h.get("points") or 0, reverse=True)
        mentions: Counter[str] = Counter()
        first: dict[str, tuple[str, dict]] = {}
        for h in relevant[:3]:
            item = get_json(f"https://hn.algolia.com/api/v1/items/{h['objectID']}")
            for comment in (item or {}).get("children", [])[:60]:
                seen_here: set[str] = set()
                for href in re.findall(r'href="([^"]+)"', comment.get("text") or ""):
                    url = html.unescape(href)
                    if not url.startswith(("http://", "https://")) or "ycombinator.com" in url:
                        continue
                    k = normalize_url(url)
                    if k not in seen_here:
                        seen_here.add(k)
                        mentions[k] += 1
                        first.setdefault(k, (url, h))
        out = []
        for k, n in mentions.most_common(limit * 3):
            url, thread = first[k]
            if n < 2:
                break
            title = page_title(url) or title_from_url(url)
            kind, yt = classify(url, title)
            out.append(Candidate(
                title=title, url=url, type=kind, source="hackernews", provider=domain(url), recommended_by=n,
                discussion_url=f"https://news.ycombinator.com/item?id={thread['objectID']}",
                summary=f"Recommended by {n} commenters in “{thread.get('title')}” ({thread.get('points') or 0} points).",
                youtube_id=yt, queries={subject},
            ))
            if len(out) >= limit:
                break
        return out

    def wikipedia(self, query: str, limit: int = 2) -> list[Candidate]:
        data = get_json("https://en.wikipedia.org/w/api.php", {"action": "query", "list": "search", "srsearch": query, "srlimit": limit + 2, "format": "json"})
        out = []
        for hit in (data or {}).get("query", {}).get("search", []):
            s = get_json(f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(hit['title'].replace(' ', '_'), safe='')}")
            if not s or s.get("type") == "disambiguation":
                continue
            url = (s.get("content_urls") or {}).get("desktop", {}).get("page")
            if not url:
                continue
            out.append(Candidate(title=s.get("title") or hit["title"], url=url, type="article", source="wikipedia", provider="Wikipedia",
                                 summary=(s.get("extract") or "")[:600], queries={query}))
            if len(out) >= limit:
                break
        return out

    def books(self, query: str, limit: int = 4) -> list[Candidate]:
        data = get_json("https://openlibrary.org/search.json", {
            "q": query, "limit": 25,
            "fields": "key,title,author_name,first_publish_year,isbn,ratings_average,ratings_count,want_to_read_count,edition_count",
        })
        out = []
        for d in (data or {}).get("docs", []):
            readers = (d.get("ratings_count") or 0) + (d.get("want_to_read_count") or 0)
            if readers < 10 and (d.get("edition_count") or 0) < 5:
                continue
            isbn = next((i for i in d.get("isbn", []) if len(i) == 13), None) or next(iter(d.get("isbn", [])), None)
            out.append(Candidate(
                title=d.get("title", ""), url=f"https://openlibrary.org{d['key']}", type="book", source="openlibrary",
                provider=", ".join(d.get("author_name", [])[:2]) or "Open Library", authors=", ".join(d.get("author_name", [])[:3]) or None,
                year=d.get("first_publish_year"), isbn=isbn, score=readers, rating=round(d["ratings_average"], 2) if d.get("ratings_average") else None,
                queries={query},
            ))
        out.sort(key=lambda c: c.quality(), reverse=True)
        return out[:limit]

    def papers(self, query: str, limit: int = 3) -> list[Candidate]:
        data = get_json("https://api.semanticscholar.org/graph/v1/paper/search", {
            "query": query, "limit": 20, "fields": "title,url,year,authors,citationCount,abstract,tldr,externalIds,openAccessPdf",
        })
        out = []
        terms = _terms(query)
        for p in ((data or {}).get("data", []) or [])[:12]:  # keep to the most relevant hits, then rank by citations
            if (p.get("citationCount") or 0) < 10 or not p.get("title"):
                continue
            if terms and len(terms & _terms(p["title"] + " " + (p.get("abstract") or ""))) < max(1, (len(terms) + 1) // 2):
                continue
            ext = p.get("externalIds") or {}
            url = f"https://arxiv.org/abs/{ext['ArXiv']}" if ext.get("ArXiv") else (p.get("openAccessPdf") or {}).get("url") or p.get("url")
            if not url:
                continue
            tldr = (p.get("tldr") or {}).get("text")
            out.append(Candidate(
                title=p["title"], url=url, type="paper", source="semanticscholar", provider="Semantic Scholar",
                authors=", ".join(a["name"] for a in (p.get("authors") or [])[:4]) or None, year=p.get("year"),
                score=p.get("citationCount"), summary=(tldr or p.get("abstract") or "")[:700], queries={query},
            ))
        if not out and data is None:
            out = self._arxiv(query, limit)
        out.sort(key=lambda c: c.score or 0, reverse=True)
        return out[:limit]

    def _arxiv(self, query: str, limit: int) -> list[Candidate]:
        xml = get_text("https://export.arxiv.org/api/query", {"search_query": f"all:{query}", "max_results": limit, "sortBy": "relevance"})
        if not xml:
            return []
        ns = {"a": "http://www.w3.org/2005/Atom"}
        try:
            root = SafeET.fromstring(xml)
        except Exception:
            return []
        out = []
        for e in root.findall("a:entry", ns):
            title = re.sub(r"\s+", " ", e.findtext("a:title", "", ns)).strip()
            url = e.findtext("a:id", "", ns).strip()
            if title and url:
                out.append(Candidate(
                    title=title, url=url, type="paper", source="arxiv", provider="arXiv",
                    authors=", ".join(a.findtext("a:name", "", ns) for a in e.findall("a:author", ns)[:4]) or None,
                    year=int(e.findtext("a:published", "0000", ns)[:4]) or None,
                    summary=re.sub(r"\s+", " ", e.findtext("a:summary", "", ns)).strip()[:700], queries={query},
                ))
        return out

    def youtube(self, query: str, limit: int = 3) -> list[Candidate]:
        key = get_settings().youtube_api_key
        if not key:
            return []
        s = get_json("https://www.googleapis.com/youtube/v3/search", {
            "part": "snippet", "q": query, "type": "video", "maxResults": 15, "videoEmbeddable": "true", "relevanceLanguage": "en", "key": key,
        })
        ids = [i["id"]["videoId"] for i in (s or {}).get("items", []) if i.get("id", {}).get("videoId")]
        if not ids:
            return []
        v = get_json("https://www.googleapis.com/youtube/v3/videos", {"part": "snippet,statistics,contentDetails", "id": ",".join(ids), "key": key})
        out = []
        for it in (v or {}).get("items", []):
            st = it.get("statistics", {})
            views, likes = int(st.get("viewCount", 0)), int(st.get("likeCount", 0))
            if views < 10_000:
                continue
            sn = it["snippet"]
            out.append(Candidate(
                title=html.unescape(sn["title"]), url=f"https://www.youtube.com/watch?v={it['id']}", type="video", source="youtube",
                provider=sn.get("channelTitle", "YouTube"), summary=(sn.get("description") or "")[:400], score=likes,
                youtube_id=it["id"], duration=_iso_duration(it.get("contentDetails", {}).get("duration", "")),
                year=int(sn["publishedAt"][:4]) if sn.get("publishedAt") else None, queries={query},
            ))
        out.sort(key=lambda c: c.score or 0, reverse=True)
        return out[:limit]

    def wikipedia_outline(self, subject: str) -> list[tuple[str, list[str]]]:
        """[(section, [subsections])] of the subject's main Wikipedia article: a no-AI fallback outline."""
        hits = self.wikipedia(subject, limit=1)
        if not hits:
            return []
        page = hits[0].url.rsplit("/", 1)[-1]
        data = get_json("https://en.wikipedia.org/w/api.php", {"action": "parse", "page": page, "prop": "sections", "format": "json", "redirects": 1})
        skip = re.compile(r"see also|references|notes|further reading|external links|bibliography|sources|citations|footnotes|works cited|gallery|"
                          r"in popular culture|textbooks|study guides|online resources", re.I)
        tree: list[tuple[str, list[str]]] = []
        for sec in (data or {}).get("parse", {}).get("sections", []):
            name = re.sub(r"<[^>]+>", "", sec.get("line", "")).strip()
            if not name or skip.search(name):
                continue
            if sec.get("toclevel") == 1:
                tree.append((name, []))
            elif sec.get("toclevel") == 2 and tree:
                tree[-1][1].append(name)
        return tree


def _iso_duration(d: str) -> str:
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return ""
    h, mi = int(m.group(1) or 0), int(m.group(2) or 0)
    return f"{h} h {mi} min" if h else f"{mi} min"


_backend = WebBackend()


def backend() -> WebBackend:
    return _backend


def set_backend(b) -> None:
    global _backend
    _backend = b
