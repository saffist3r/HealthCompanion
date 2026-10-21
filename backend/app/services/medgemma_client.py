"""Call self-hosted MedGemma (Ollama) for Understanding science briefs."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_SYSTEM = (
    "You are MedGemma, a medical science educator for Type 1 diabetes. "
    "For each pattern, write a short plain-language physiology explanation "
    "(2–3 sentences). Educational only — not a personal diagnosis or dosing advice. "
    "Respond with JSON only: {\"briefs\":[{\"patternId\":\"...\",\"scienceBrief\":\"...\"}]}"
)


def medgemma_configured() -> bool:
    settings = get_settings()
    return bool((settings.medgemma_base_url or "").strip())


def enrich_medical_checks_with_medgemma(
    medical_checks: list[dict[str, Any]],
    *,
    locale: str = "en",
) -> list[dict[str, Any]]:
    """Enrich scienceBrief via one batched MedGemma call (CPU-friendly).

    Keeps curated briefs when MedGemma is slow/unavailable. Caps how many
    patterns we send so Understanding stays under the client timeout.
    """
    if not medical_checks or not medgemma_configured():
        return medical_checks

    settings = get_settings()
    max_n = max(1, int(settings.medgemma_max_checks or 4))
    # Always one batch on the highest-signal patterns (CPU cannot afford N calls).
    order = {"established": 0, "plausible": 1, "weak": 2, "not_supported": 3}
    targets = sorted(
        medical_checks,
        key=lambda c: order.get(str(c.get("status") or ""), 9),
    )[:max_n]
    if not targets:
        return medical_checks

    try:
        briefs = _batch_science_briefs(targets, locale=locale)
    except Exception as exc:  # noqa: BLE001
        logger.warning("MedGemma batch science briefs failed: %s", exc)
        return medical_checks

    if not briefs:
        return medical_checks

    out: list[dict[str, Any]] = []
    for check in medical_checks:
        enriched = dict(check)
        pid = str(check.get("patternId") or "")
        text = (briefs.get(pid) or "").strip()
        if text:
            enriched["scienceBrief"] = text[:1200]
        out.append(enriched)
    return out


def generate_science_brief(
    *,
    title: str,
    claim: str,
    status: str = "",
    locale: str = "en",
) -> str:
    """Single-pattern helper (tests / fallback). Prefer batch enrichment in prod."""
    rows = _batch_science_briefs(
        [
            {
                "patternId": "single",
                "title": title,
                "claim": claim,
                "status": status,
            }
        ],
        locale=locale,
    )
    return (rows.get("single") or "").strip()[:1200]


def _batch_science_briefs(
    checks: list[dict[str, Any]],
    *,
    locale: str,
) -> dict[str, str]:
    settings = get_settings()
    base = (settings.medgemma_base_url or "").rstrip("/")
    model = (settings.medgemma_model or "medgemma:4b").strip()
    if not base or not checks:
        return {}

    lang = "French" if (locale or "").lower().startswith("fr") else "English"
    patterns = []
    for c in checks:
        patterns.append(
            {
                "patternId": str(c.get("patternId") or ""),
                "title": str(c.get("title") or "").strip(),
                "claim": str(c.get("claim") or c.get("title") or "").strip(),
                "status": str(c.get("status") or ""),
            }
        )

    user = (
        f"Language: {lang}.\n"
        "Write one scienceBrief per pattern (2–3 sentences of physiology).\n"
        f"Patterns JSON:\n{json.dumps(patterns, ensure_ascii=False)}\n"
        'Return JSON: {"briefs":[{"patternId":"...","scienceBrief":"..."}]}'
    )
    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user},
        ],
        "options": {
            "temperature": 0.2,
            # Keep generation short — CPU MedGemma is slow
            "num_predict": min(120 * len(patterns), 480),
        },
    }
    timeout = max(20, int(settings.medgemma_timeout_s or 90))
    started = time.monotonic()
    url = f"{base}/api/chat"
    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=timeout) as resp:  # noqa: S310 — admin-configured URL
            body = json.loads(resp.read().decode("utf-8"))
    except (TimeoutError, URLError, OSError) as exc:
        logger.warning("MedGemma request failed after %.1fs: %s", time.monotonic() - started, exc)
        return {}

    text = str((body.get("message") or {}).get("content") or "").strip()
    parsed = _parse_briefs_json(text)
    logger.info(
        "MedGemma batch enriched %s/%s checks in %.1fs",
        len(parsed),
        len(checks),
        time.monotonic() - started,
    )
    return parsed


def _parse_briefs_json(text: str) -> dict[str, str]:
    if not text:
        return {}
    raw: Any = None
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                raw = json.loads(m.group(0))
            except json.JSONDecodeError:
                return {}
    if not isinstance(raw, dict):
        return {}
    items = raw.get("briefs") or raw.get("items") or []
    out: dict[str, str] = {}
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            pid = str(item.get("patternId") or "").strip()
            brief = str(item.get("scienceBrief") or item.get("brief") or "").strip()
            if pid and brief:
                out[pid] = brief
    return out
