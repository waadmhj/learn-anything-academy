"""Show a resource inside the platform instead of sending the learner away.

`view(resource)` decides how each resource is displayed:
  * video   — YouTube / Vimeo / Internet Archive players
  * iframe  — the original page, when the site allows embedding (checked live: X-Frame-Options and CSP frame-ancestors)
  * reader  — a clean reading view: Wikipedia articles (CC BY-SA), GitHub READMEs, Hacker News threads, and the main
              text of pages that refuse embedding. Always sanitised and always credited with a link to the original.
  * link    — nothing displayable (e.g. a page that needs JavaScript or a login); the learner gets the link.

Pages are fetched only from public internet addresses, each redirect re-checked, with a size cap. Results are cached in
memory for an hour; nothing is stored in the database.
"""
from __future__ import annotations

import html as htmlmod
import logging
import re
import threading
import time
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse

import httpx
import nh3
from lxml import html as lhtml

from .. import models as m
from . import sources

log = logging.getLogger("academy.viewer")

MAX_BYTES = 3_000_000
TTL = 3600
_cache: dict[tuple[str, bool], tuple[float, dict]] = {}
_lock = threading.Lock()

_TAGS = {
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "section", "small",
    "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
}
# MathML Core (Wikipedia sends formulas as MathML; every current browser renders it).
_MATH_TAGS = {
    "math", "semantics", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msub", "msup", "msubsup", "mfrac", "msqrt", "mroot",
    "mstyle", "mtable", "mtr", "mtd", "munder", "mover", "munderover", "mpadded", "mphantom", "menclose", "mmultiscripts",
    "mprescripts", "none",
}
_MATH_ATTRS = {
    "display", "mathvariant", "displaystyle", "scriptlevel", "stretchy", "fence", "separator", "lspace", "rspace", "columnalign",
    "rowalign", "columnspacing", "rowspacing", "accent", "accentunder", "linethickness", "width", "height", "depth", "minsize",
    "maxsize", "movablelimits", "symmetric", "largeop", "form", "notation", "columnspan", "rowspan",
}
_TAGS |= _MATH_TAGS
_ATTRS = {
    **{t: _MATH_ATTRS for t in _MATH_TAGS},
    "a": {"href", "title"}, "img": {"src", "alt", "title", "width", "height", "style"}, "span": {"style"},
    "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan", "scope"}, "ol": {"start"}, "code": {"class"}, "pre": {"class"},
}


def sanitize(fragment: str) -> str:
    return nh3.clean(
        fragment, tags=_TAGS, attributes=_ATTRS, url_schemes={"http", "https"}, link_rel="noopener noreferrer nofollow",
        set_tag_attribute_values={"a": {"target": "_blank"}}, strip_comments=True,
        filter_style_properties={"vertical-align", "width", "height", "max-width"},
    )


def _absolutize(doc, base: str) -> None:
    for el in doc.iter("a"):
        href = el.get("href")
        if href and not href.startswith("#"):
            el.set("href", urljoin(base, href))
    for el in doc.iter("img"):
        src = el.get("src") or el.get("data-src") or ""
        if src.startswith("//"):
            src = "https:" + src
        src = urljoin(base, src)
        el.set("src", src.replace("http://", "https://", 1))
        el.attrib.pop("srcset", None)


def _drop(doc, xpath: str) -> None:
    for el in doc.xpath(xpath):
        el.getparent().remove(el) if el.getparent() is not None else None


# ───────────────────────────── fetching ─────────────────────────────
def fetch(url: str) -> tuple[str, dict[str, str], bytes] | None:
    """GET a public page: (final_url, headers, body). Re-checks every redirect hop; caps the size."""
    for _ in range(5):
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname or not sources._public_host(u.hostname):
            return None
        try:
            with httpx.Client(timeout=12.0, headers={"User-Agent": sources.user_agent(), "Accept-Language": "en"}, follow_redirects=False) as c, \
                    c.stream("GET", url) as r:
                if r.is_redirect and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code != 200:
                    return None
                buf = bytearray()
                for chunk in r.iter_bytes():
                    buf += chunk
                    if len(buf) > MAX_BYTES:
                        break
                return url, {k.lower(): v for k, v in r.headers.items()}, bytes(buf)
        except httpx.HTTPError as e:
            log.info("fetch %s failed: %s", url, e)
            return None
    return None


def frameable(headers: dict[str, str]) -> bool:
    xfo = headers.get("x-frame-options", "").strip().lower()
    if xfo in ("deny", "sameorigin"):
        return False
    csp = headers.get("content-security-policy", "")
    m_ = re.search(r"frame-ancestors([^;]*)", csp, re.I)
    if m_:
        allowed = m_.group(1).split()
        return "*" in allowed or "https:" in allowed
    return True


# ───────────────────────────── renderers ─────────────────────────────
_YT_PLAYLIST = re.compile(r"[?&]list=([A-Za-z0-9_-]+)")
_VIMEO = re.compile(r"vimeo\.com/(?:video/)?(\d+)")


def _video(r: m.Resource) -> dict | None:
    embed = r.embed or {}
    if embed.get("youtube"):
        return {"mode": "video", "player": f"https://www.youtube-nocookie.com/embed/{embed['youtube']}?rel=0&modestbranding=1"}
    if embed.get("archive"):
        return {"mode": "video", "player": f"https://archive.org/embed/{quote(embed['archive'])}"}
    url = r.url or ""
    if "youtube.com" in url and (pl := _YT_PLAYLIST.search(url)):
        return {"mode": "video", "player": f"https://www.youtube-nocookie.com/embed/videoseries?list={pl.group(1)}"}
    if v := _VIMEO.search(url):
        return {"mode": "video", "player": f"https://player.vimeo.com/video/{v.group(1)}"}
    if "archive.org/details/" in url:
        ident = urlparse(url).path.split("/details/", 1)[1].split("/")[0]
        return {"mode": "video", "player": f"https://archive.org/embed/{quote(ident)}"}
    return None


_CHANNEL = re.compile(r"(?:youtube\.com/channel/|\"channelId\":\"|<link rel=\"canonical\" href=\"https://www\.youtube\.com/channel/)(UC[\w-]{22})")


def _youtube_channel(url: str) -> str | None:
    if m_ := _CHANNEL.search(url):
        return m_.group(1)
    res = fetch(url)
    if res and (m_ := _CHANNEL.search(res[2][:1_500_000].decode("utf-8", "ignore"))):
        return m_.group(1)
    return None


def _wikipedia(url: str) -> dict | None:
    u = urlparse(url)
    if not u.path.startswith("/wiki/"):
        return None
    lang = (u.hostname or "en.wikipedia.org").split(".")[0]
    title = unquote(u.path[len("/wiki/"):])
    res = fetch(f"https://{lang}.wikipedia.org/api/rest_v1/page/html/{quote(title, safe='')}")
    if not res:
        return None
    doc = lhtml.fromstring(res[2])
    # Drop page furniture and the reference/link sections.
    _drop(doc, "//*[contains(concat(' ', normalize-space(@class), ' '), ' navbox ') or contains(@class, 'reflist') or "
               "contains(@class, 'mw-references-wrap') or contains(@class, 'hatnote') or contains(@class, 'ambox') or "
               "contains(@class, 'metadata') or contains(@class, 'mw-editsection') or self::annotation or "
               "contains(@class, 'sistersitebox') or contains(@class, 'side-box') or contains(@class, 'noprint') or "
               "contains(@class, 'mw-ref') or @role='navigation' or self::style or self::link or self::script]")
    for sec in doc.xpath("//section"):
        h = sec.xpath("./h2")
        if h and re.search(r"references|external links|see also|notes|further reading|bibliography|sources|citations", h[0].text_content(), re.I):
            sec.getparent().remove(sec)
    for el in doc.xpath("//math[contains(@class, 'mwe-math-element-block')]"):
        el.set("display", "block")
    body = doc.find("body") if doc.find("body") is not None else doc
    _absolutize(body, f"https://{lang}.wikipedia.org/wiki/")
    return {
        "mode": "reader", "html": sanitize(lhtml.tostring(body, encoding="unicode")),
        "credit": f"From Wikipedia, “{title.replace('_', ' ')}”. Text available under CC BY-SA 4.0.",
    }


def _github(url: str) -> dict | None:
    parts = [p for p in urlparse(url).path.split("/") if p]
    if len(parts) < 2:
        return None
    owner, repo = parts[0], parts[1].removesuffix(".git")
    try:
        r = httpx.get(f"https://api.github.com/repos/{owner}/{repo}/readme", timeout=12.0,
                      headers={"Accept": "application/vnd.github.html+json", "User-Agent": sources.user_agent()})
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    doc = lhtml.fromstring(r.text)
    for el in doc.iter("img"):
        src = el.get("data-canonical-src") or el.get("src") or ""
        if src and not src.startswith(("http://", "https://", "//")):
            el.set("src", f"https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{src.lstrip('./')}")
    _absolutize(doc, f"https://github.com/{owner}/{repo}/blob/HEAD/")
    return {"mode": "reader", "html": sanitize(lhtml.tostring(doc, encoding="unicode")), "credit": f"README of {owner}/{repo} on GitHub."}


def _hn_thread(url: str) -> dict | None:
    item_id = (parse_qs(urlparse(url).query).get("id") or [""])[0]
    if not item_id.isdigit():
        return None
    data = sources.get_json(f"https://hn.algolia.com/api/v1/items/{item_id}")
    if not data:
        return None
    out = []
    if data.get("url"):
        out.append(f'<p><a href="{htmlmod.escape(data["url"])}">{htmlmod.escape(data["url"])}</a></p>')
    if data.get("text"):
        out.append(f"<div>{data['text']}</div>")

    def walk(children, depth):
        kids = [c for c in children if c.get("text")]
        kids.sort(key=lambda c: len(c.get("children") or []), reverse=True)  # the most-discussed replies first
        for c in kids[: (25 if depth == 0 else 3)]:
            out.append(f"<blockquote><p><small><strong>{htmlmod.escape(c.get('author') or 'anon')}</strong></small></p>{c['text']}")
            if depth < 2:
                walk(c.get("children") or [], depth + 1)
            out.append("</blockquote>")

    out.append(f"<h2>Discussion ({data.get('points') or 0} points)</h2>")
    walk(data.get("children") or [], 0)
    return {"mode": "reader", "html": sanitize("".join(out)), "credit": "Hacker News discussion (most-replied comments first)."}


def _extract(final_url: str, body: bytes, headers: dict[str, str]) -> dict | None:
    from readability import Document  # imported lazily: only needed for pages that refuse embedding

    charset = re.search(r"charset=([\w-]+)", headers.get("content-type", ""))
    text = body.decode(charset.group(1) if charset else "utf-8", "replace")
    try:
        doc = Document(text)
        summary = doc.summary(html_partial=True)
        title = doc.short_title()
    except Exception:
        log.info("readability failed for %s", final_url)
        return None
    tree = lhtml.fromstring(summary)
    _absolutize(tree, final_url)
    clean = sanitize(lhtml.tostring(tree, encoding="unicode"))
    if len(re.sub(r"<[^>]+>|\s+", "", clean)) < 1200:  # an app shell, a landing page or a login wall: not worth reading here
        return None
    return {"mode": "reader", "html": clean, "title": title,
            "credit": f"Reading view of {sources.domain(final_url)}. Images and interactive parts may be missing; open the original for the full page."}


def _page(url: str, prefer_reader: bool) -> dict:
    res = fetch(url)
    if not res:
        return {"mode": "link", "reason": "This site couldn't be reached from here."}
    final_url, headers, body = res
    ctype = headers.get("content-type", "")
    can_frame = final_url.startswith("https://") and frameable(headers)
    if "pdf" in ctype:
        return {"mode": "iframe", "src": final_url} if can_frame else {"mode": "link", "reason": "This PDF can only be opened on its own site."}
    if "html" not in ctype:
        return {"mode": "link", "reason": "This file type can't be shown here."}
    if can_frame and not prefer_reader:
        return {"mode": "iframe", "src": final_url, "reader": True}
    reader = _extract(final_url, body, headers)
    if reader:
        reader["iframe"] = final_url if can_frame else None
        return reader
    if can_frame:
        return {"mode": "iframe", "src": final_url}
    return {"mode": "link", "reason": "This site doesn't allow being shown inside other sites, and it has no readable text without its own app."}


def _compute(r: m.Resource, prefer_reader: bool) -> dict:
    url = r.url or ""
    host = sources.domain(url)
    if r.type == "video" or (r.embed or {}).get("youtube") or (r.embed or {}).get("archive"):
        if v := _video(r):
            return v
    if host.endswith("wikipedia.org") and (w := _wikipedia(url)):
        return w
    if host == "arxiv.org":
        m_ = re.search(r"arxiv\.org/(?:abs|pdf)/([^?#]+?)(?:\.pdf)?$", url)
        if m_:
            return {"mode": "iframe", "src": f"https://arxiv.org/pdf/{m_.group(1)}"}
    if host == "github.com" and (g := _github(url)):
        return g
    if host == "news.ycombinator.com" and (t := _hn_thread(url)):
        return t
    if "youtube.com" in host:
        if channel := _youtube_channel(url):  # play the channel's uploads as a playlist
            return {"mode": "video", "player": f"https://www.youtube-nocookie.com/embed/videoseries?list=UU{channel[2:]}"}
        return {"mode": "link", "reason": "This YouTube page can't be shown here; individual videos and playlists can."}
    return _page(url, prefer_reader)


def view(r: m.Resource, prefer_reader: bool = False) -> dict:
    key = (r.url or "", prefer_reader)
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < TTL:
            return hit[1]
    try:
        out = _compute(r, prefer_reader)
    except Exception:
        log.exception("viewer failed for %s", r.url)
        out = {"mode": "link", "reason": "Something went wrong while preparing this resource."}
    out.setdefault("url", r.url)
    with _lock:
        if len(_cache) > 300:
            _cache.clear()
        _cache[key] = (now, out)
    return out
