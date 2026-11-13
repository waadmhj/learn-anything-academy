"""Sanitise AI-generated SVG diagrams before they are rendered with innerHTML.

Only basic drawing elements and presentation attributes survive. Scripts, event handlers, links, foreign objects,
external references, styles and entities are removed, so a diagram can't run code or load anything.
"""
from __future__ import annotations

import re
from xml.etree.ElementTree import Element, tostring

from defusedxml import ElementTree as SafeET

TAGS = {"svg", "g", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "defs", "marker", "title", "desc"}
ATTRS = {
    "viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "dx", "dy",
    "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity",
    "stroke-opacity", "transform", "text-anchor", "dominant-baseline", "font-size", "font-weight", "font-family", "font-style",
    "id", "marker-end", "marker-start", "markerwidth", "markerheight", "refx", "refy", "orient", "markerunits", "preserveaspectratio",
}
SAFE_VALUE = re.compile(r"^[\w\s#.,%()\-+:/'\"]*$")  # no angle brackets, semicolons, backslashes or "javascript:"
MAX_LEN = 60_000


def _local(name: str) -> str:
    return name.rsplit("}", 1)[-1]


def _clean(el: Element) -> Element | None:
    tag = _local(el.tag).lower()
    if tag not in TAGS:
        return None
    out = Element(tag)
    for k, v in el.attrib.items():
        key = _local(k).lower()
        if key not in ATTRS or len(v) > 4000 or not SAFE_VALUE.match(v) or "javascript" in v.lower():
            continue
        if "url(" in v and not re.fullmatch(r"url\(#[\w-]+\)", v.strip()):
            continue  # only local references (markers)
        out.set(_local(k), v)
    out.text = el.text
    for child in el:
        c = _clean(child)
        if c is not None:
            c.tail = child.tail
            out.append(c)
    return out


def sanitize(svg: str) -> str | None:
    svg = (svg or "").strip()
    if not svg.startswith("<svg") or len(svg) > MAX_LEN:
        return None
    try:
        root = SafeET.fromstring(svg)
    except Exception:
        return None
    clean = _clean(root)
    if clean is None or clean.tag != "svg":
        return None
    clean.set("xmlns", "http://www.w3.org/2000/svg")
    clean.set("role", "img")
    return tostring(clean, encoding="unicode")
