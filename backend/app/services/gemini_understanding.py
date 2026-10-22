"""Gemini forensic pattern analysis for the Understanding page."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from google import genai
from google.genai import types

from app.core.config import get_settings
from app.i18n.report_strings import ai_language_instruction, normalize_locale
from app.services.gemini_retry import model_candidates, with_gemini_retries

logger = logging.getLogger(__name__)

SYSTEM = """You are a forensic Type 1 diabetes pattern analyst with MedGemma-style medical
science rigor: diabetes physiology, endocrinology, and lifestyle interactions. You receive
deterministic SIGNAL digests covering ALL logged domains: meals/carbs, bolus timing, CGM
(mean + GMI), stress, sports/activity, caffeine, mood/ADHD check-ins, injuries/pain, care
visits, weight, coverage gaps — plus linkedPatterns the system already flagged.

Your job:
1) Explain what looks off in THIS person's data across every domain that has signal (findings).
2) For each linkedPattern, judge whether the claimed association is known / established
   medical or behavioral diabetes knowledge (medicalChecks) — not a personal diagnosis.
3) For each medicalCheck, teach the SCIENCE: a short physiology paragraph + reputable
   reading links (ADA Standards, NIDDK/NIH, CDC, PubMed reviews, Endocrine Society, etc.).

Rules:
- Never give insulin dosing advice, regimen changes, or a clinical diagnosis of the user.
- Use sports, steps, caffeine, mood, pain, care visits when present — do not ignore them.
- Only use facts from the JSON for personal findings; do not invent events.
- medicalChecks: evaluate GENERAL validity (established / plausible / weak / not_supported).
- scienceBrief: 2–4 sentences of plain-language physiology (mechanisms, hormones, timing).
  Educational only — not personalized advice.
- sources: 1–3 real https links from reputable orgs. Prefer official pages you know exist
  (diabetes.org, niddk.nih.gov, cdc.gov, pubmed.ncbi.nlm.nih.gov, diabetesjournals.org).
  Never invent fake DOIs or URLs. If unsure of a specific URL, omit that source.
- Respond with JSON only:
{
  "headline": string,
  "executiveSummary": string,
  "findings": [
    {
      "id": string,
      "severity": "high"|"medium"|"low",
      "category": "estimation"|"timing"|"stress"|"logging"|"glucose"|"lifestyle",
      "title": string,
      "detail": string,
      "evidence": string[],
      "exampleIds": string[]
    }
  ],
  "medicalChecks": [
    {
      "patternId": string,
      "status": "established"|"plausible"|"weak"|"not_supported",
      "confidence": "high"|"medium"|"low",
      "title": string,
      "explanation": string,
      "scienceBrief": string,
      "sources": [{"title": string, "url": string, "publisher": string}],
      "caveat": string
    }
  ],
  "correlations": string[],
  "whatToWatch": string[],
  "dataGaps": string[]
}

executiveSummary: 2–3 short paragraphs, second person — mention glucose big picture (mean/GMI/TIR)
and at least one lifestyle domain when data exists.
findings: 4–10 items across domains. medicalChecks: one per linkedPatterns[].id.
correlations: 2–6 cross-domain statements. whatToWatch: behavior/logging only (no dosing).
dataGaps: what weakens conclusions."""

# Curated physiology briefs + real article links (merged with Gemini output).
# Prefer these URLs over model-suggested ones when the pattern id matches.
_SCIENCE_LIBRARY: dict[str, dict[str, Any]] = {
    "est-peak-per-carb": {
        "scienceBrief": (
            "Postprandial glucose rises when carbohydrate absorption outpaces available insulin. "
            "If logged carbs understate actual intake (or the meal is high-GI), the bolus is often "
            "too small relative to the true load, so the peak climbs higher than expected."
        ),
        "sources": [
            {
                "title": "Postprandial blood glucose — ADA Standards overview",
                "url": "https://diabetesjournals.org/care/article/48/Supplement_1/S27/157566/4-Glycemic-Goals-and-Hypoglycemia-Standards-of",
                "publisher": "American Diabetes Association",
            },
            {
                "title": "Carbohydrate counting and meal insulin",
                "url": "https://www.niddk.nih.gov/health-information/diabetes/overview/diet-eating-physical-activity",
                "publisher": "NIDDK / NIH",
            },
        ],
    },
    "timing-late-bolus-higher-peak": {
        "scienceBrief": (
            "Rapid-acting insulin typically needs ~15–20 minutes to start lowering glucose. "
            "When carbohydrates begin digesting before insulin action, portal glucose rises first — "
            "a classic driver of higher post-meal peaks."
        ),
        "sources": [
            {
                "title": "Insulin therapy and mealtime timing (ADA Standards)",
                "url": "https://diabetesjournals.org/care/article/48/Supplement_1/S181/157567/9-Pharmacologic-Approaches-to-Glycemic-Treatment",
                "publisher": "American Diabetes Association",
            },
            {
                "title": "Insulin basics — how mealtime insulin works",
                "url": "https://www.cdc.gov/diabetes/about/insulin-and-medications.html",
                "publisher": "CDC",
            },
        ],
    },
    "timing-late-bolus-frequency": {
        "scienceBrief": (
            "Delayed bolusing is repeatedly linked to postprandial hyperglycemia in T1D education: "
            "insulin-on-board lags carbohydrate absorption, so glucose climbs before the bolus "
            "catches up."
        ),
        "sources": [
            {
                "title": "Pharmacologic approaches to glycemic treatment",
                "url": "https://diabetesjournals.org/care/article/48/Supplement_1/S181/157567/9-Pharmacologic-Approaches-to-Glycemic-Treatment",
                "publisher": "American Diabetes Association",
            },
        ],
    },
    "stress-follow-hyperglycemia": {
        "scienceBrief": (
            "Acute psychological stress raises catecholamines and cortisol. Those hormones increase "
            "hepatic glucose output and can reduce insulin sensitivity — a documented pathway for "
            "stress-related hyperglycemia even without extra carbs."
        ),
        "sources": [
            {
                "title": "Stress and blood sugar",
                "url": "https://www.cdc.gov/diabetes/caring/managing-stress.html",
                "publisher": "CDC",
            },
            {
                "title": "Diabetes and mental health",
                "url": "https://www.niddk.nih.gov/health-information/diabetes/overview/preventing-problems/mental-health",
                "publisher": "NIDDK / NIH",
            },
        ],
    },
    "stress-near-hypo": {
        "scienceBrief": (
            "Hypoglycemia itself triggers an adrenergic stress response (sweating, tremor, anxiety). "
            "Stress logs near hypos may therefore reflect the hypo — or recovery behaviors — rather "
            "than stress causing the low."
        ),
        "sources": [
            {
                "title": "Hypoglycemia — symptoms and causes",
                "url": "https://www.niddk.nih.gov/health-information/diabetes/overview/preventing-problems/low-blood-glucose-hypoglycemia",
                "publisher": "NIDDK / NIH",
            },
            {
                "title": "Glycemic goals and hypoglycemia (ADA)",
                "url": "https://diabetesjournals.org/care/article/48/Supplement_1/S27/157566/4-Glycemic-Goals-and-Hypoglycemia-Standards-of",
                "publisher": "American Diabetes Association",
            },
        ],
    },
    "logging-gap-volatile": {
        "scienceBrief": (
            "Missing meal or bolus context does not change physiology — it weakens causal inference. "
            "Volatile CGM days without food logs cannot separate under-bolusing, delayed eating, "
            "illness, or activity effects."
        ),
        "sources": [
            {
                "title": "Using continuous glucose monitoring",
                "url": "https://www.cdc.gov/diabetes/managing/managing-blood-sugar.html",
                "publisher": "CDC",
            },
        ],
    },
    "sport-hypo": {
        "scienceBrief": (
            "Exercise increases muscle glucose uptake and can raise insulin sensitivity for hours "
            "afterward. With circulating insulin present, that combination classically raises "
            "hypoglycemia risk during and after sport."
        ),
        "sources": [
            {
                "title": "Physical activity / exercise and diabetes (ADA)",
                "url": "https://diabetesjournals.org/care/article/48/Supplement_1/S70/157570/5-Facilitating-Positive-Health-Behaviors-and-Well",
                "publisher": "American Diabetes Association",
            },
            {
                "title": "Diabetes and physical activity",
                "url": "https://www.niddk.nih.gov/health-information/diabetes/overview/diet-eating-physical-activity",
                "publisher": "NIDDK / NIH",
            },
        ],
    },
    "sedentary-volatile": {
        "scienceBrief": (
            "Sitting reduces skeletal-muscle glucose disposal. Over a day, fewer contractions can "
            "mean higher ambient glucose for the same insulin — one reason sedentary stretches "
            "often coincide with more time above range."
        ),
        "sources": [
            {
                "title": "Physical activity and diabetes",
                "url": "https://www.cdc.gov/diabetes/prevention/staying-active.html",
                "publisher": "CDC",
            },
        ],
    },
    "caffeine-tir": {
        "scienceBrief": (
            "Caffeine can stimulate catecholamine release and modestly affect insulin sensitivity. "
            "Some people see higher glucose after coffee; others do not — responses are highly "
            "individual and dose-dependent."
        ),
        "sources": [
            {
                "title": "Caffeine and glucose metabolism (review)",
                "url": "https://pubmed.ncbi.nlm.nih.gov/17884936/",
                "publisher": "PubMed",
            },
            {
                "title": "Food and blood sugar basics",
                "url": "https://www.cdc.gov/diabetes/healthy-eating/index.html",
                "publisher": "CDC",
            },
        ],
    },
    "mood-tir": {
        "scienceBrief": (
            "Mood, sleep, and self-care form a bidirectional loop with glucose: hyperglycemia and "
            "hypos can worsen mood, while low mood can reduce logging accuracy, activity, and "
            "meal timing — all of which can lower TIR."
        ),
        "sources": [
            {
                "title": "Diabetes, distress, and depression",
                "url": "https://www.niddk.nih.gov/health-information/diabetes/overview/preventing-problems/mental-health",
                "publisher": "NIDDK / NIH",
            },
            {
                "title": "Psychosocial care for people with diabetes (ADA)",
                "url": "https://diabetesjournals.org/care/article/48/Supplement_1/S70/157570/5-Facilitating-Positive-Health-Behaviors-and-Well",
                "publisher": "American Diabetes Association",
            },
        ],
    },
    "pain-stress-glucose": {
        "scienceBrief": (
            "Pain and inflammation activate stress pathways (sympathetic tone, cortisol) and often "
            "disrupt sleep and activity. Those indirect effects can increase glucose variability "
            "even when meal insulin is unchanged."
        ),
        "sources": [
            {
                "title": "Stress and blood sugar",
                "url": "https://www.cdc.gov/diabetes/caring/managing-stress.html",
                "publisher": "CDC",
            },
            {
                "title": "Chronic pain and diabetes comorbidity context",
                "url": "https://www.niddk.nih.gov/health-information/diabetes/overview/preventing-problems",
                "publisher": "NIDDK / NIH",
            },
        ],
    },
}

_SOURCE_HOST_ALLOW = (
    "diabetes.org",
    "diabetesjournals.org",
    "niddk.nih.gov",
    "nih.gov",
    "cdc.gov",
    "pubmed.ncbi.nlm.nih.gov",
    "ncbi.nlm.nih.gov",
    "who.int",
    "endocrine.org",
    "jdrf.org",
    "beyondtype1.org",
)


def generate_understanding_analysis(
    signals: dict[str, Any],
    *,
    locale: str | None = "en",
) -> dict[str, Any]:
    loc = normalize_locale(locale)
    settings = get_settings()
    payload = {
        "periodStats": signals.get("periodStats"),
        "mealGlucose": signals.get("mealGlucose"),
        "mealExamples": _examples_for_prompt(signals.get("mealExamples") or []),
        "bolusTiming": {
            **{k: v for k, v in (signals.get("bolusTiming") or {}).items() if k != "examples"},
            "examples": _examples_for_prompt((signals.get("bolusTiming") or {}).get("examples") or []),
        },
        "stressGlucose": {
            **{k: v for k, v in (signals.get("stressGlucose") or {}).items() if k != "examples"},
            "examples": _examples_for_prompt((signals.get("stressGlucose") or {}).get("examples") or []),
        },
        "coverageGaps": signals.get("coverageGaps"),
        "lifestyle": signals.get("lifestyle"),
        "linkedPatterns": signals.get("linkedPatterns") or [],
        "weeklyInsights": signals.get("weeklyInsights"),
        "plotTwists": signals.get("plotTwists"),
        "sportMatches": signals.get("sportMatches") or [],
        "careVisits": signals.get("careVisits") or [],
        "workouts": signals.get("workouts") or [],
        "dayCheckIns": signals.get("dayCheckIns") or [],
        "caffeineLogs": (signals.get("caffeineLogs") or [])[:20],
        "hypoEvents": (signals.get("hypoEvents") or [])[:10],
        "stressLogs": (signals.get("stressLogs") or [])[:10],
        # Only a few recent days — full window already summarized in periodStats/lifestyle
        "daysSlim": _slim_days(signals.get("daysSlim") or [])[-3:],
    }

    if not settings.gemini_configured:
        return _fallback(signals, reason="Gemini is not configured", locale=loc)

    client = genai.Client(api_key=settings.gemini_api_key)
    prompt = (
        SYSTEM
        + "\n\n"
        + ai_language_instruction(loc)
        + "\n\nUnderstanding signals (JSON):\n"
        + json.dumps(payload, ensure_ascii=False, default=str)
    )
    contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
    config = types.GenerateContentConfig(
        temperature=0.3,
        response_mime_type="application/json",
    )

    last_err: BaseException | None = None
    response = None
    # Prefer speed: one primary + one fallback model, few retries
    for model in list(model_candidates(settings.gemini_model))[:2]:
        try:
            response = with_gemini_retries(
                f"understanding:{model}",
                lambda m=model: client.models.generate_content(
                    model=m,
                    contents=contents,
                    config=config,
                ),
                attempts=2,
                base_delay_s=1.0,
            )
            if model != settings.gemini_model:
                logger.info("Understanding analysis succeeded with fallback model %s", model)
            break
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            logger.warning("Understanding analysis failed on %s: %s", model, exc)
    if response is None:
        return _fallback(signals, reason=str(last_err or "Gemini unavailable"), locale=loc)

    parsed = _parse_json((response.text or "{}").strip())
    normalized = _normalize(parsed, signals, locale=loc)
    try:
        from app.services.medgemma_client import enrich_medical_checks_with_medgemma

        normalized["medicalChecks"] = enrich_medical_checks_with_medgemma(
            normalized.get("medicalChecks") or [],
            locale=loc,
        )
        if get_settings().medgemma_configured:
            normalized["scienceSource"] = "medgemma"
    except Exception as exc:  # noqa: BLE001
        logger.warning("MedGemma enrichment skipped: %s", exc)
    return normalized


def _examples_for_prompt(examples: list[Any]) -> list[dict[str, Any]]:
    """Drop heavy chartSeries from Gemini payload; keep markers."""
    out: list[dict[str, Any]] = []
    for ex in examples[:6]:
        if not isinstance(ex, dict):
            continue
        row = {k: v for k, v in ex.items() if k != "chartSeries"}
        series = ex.get("chartSeries") or []
        if series:
            row["chartPointCount"] = len(series)
            row["chartPeakMgDl"] = max((p.get("mgDl") or 0) for p in series)
        out.append(row)
    return out


def _slim_days(days: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for d in days:
        g = dict(d.get("glucose") or {})
        if "readings" in g:
            g = {k: v for k, v in g.items() if k != "readings"}
            g["readingsOmitted"] = True
        out.append({**d, "glucose": g})
    return out


def _normalize(parsed: dict[str, Any], signals: dict[str, Any], *, locale: str) -> dict[str, Any]:
    stats = signals.get("periodStats") or {}
    period = f"{stats.get('periodStart')} → {stats.get('periodEnd')}"
    headline = (
        str(parsed.get("headline") or "").strip()
        or f"Understanding · last {stats.get('dayCount', '?')} days · {period}"
    )
    summary = str(parsed.get("executiveSummary") or "").strip()
    if not summary:
        summary = _fallback_summary(signals)

    findings = _normalize_findings(parsed.get("findings") or [])
    if not findings:
        findings = _fallback_findings(signals)

    medical = _normalize_medical_checks(
        parsed.get("medicalChecks") or [], signals.get("linkedPatterns") or []
    )
    if not medical:
        medical = _fallback_medical_checks(signals.get("linkedPatterns") or [])

    def _strs(key: str, limit: int = 8) -> list[str]:
        return [str(x).strip() for x in (parsed.get(key) or []) if str(x).strip()][:limit]

    return {
        "headline": headline,
        "executiveSummary": summary,
        "findings": findings,
        "medicalChecks": medical,
        "correlations": _strs("correlations"),
        "whatToWatch": _strs("whatToWatch", 6),
        "dataGaps": _strs("dataGaps", 6) or _fallback_gaps(signals),
        "source": "gemini",
        "locale": locale,
    }


def _normalize_findings(raw: list[Any]) -> list[dict[str, Any]]:
    allowed_sev = {"high", "medium", "low"}
    allowed_cat = {"estimation", "timing", "stress", "logging", "glucose", "lifestyle"}
    out: list[dict[str, Any]] = []
    for i, item in enumerate(raw[:12]):
        if not isinstance(item, dict):
            continue
        sev = str(item.get("severity") or "medium").lower()
        if sev not in allowed_sev:
            sev = "medium"
        cat = str(item.get("category") or "glucose").lower()
        if cat not in allowed_cat:
            cat = "glucose"
        title = str(item.get("title") or "").strip()
        detail = str(item.get("detail") or "").strip()
        if not title:
            continue
        evidence = [str(x).strip() for x in (item.get("evidence") or []) if str(x).strip()][:4]
        example_ids = [str(x).strip() for x in (item.get("exampleIds") or []) if str(x).strip()][:6]
        out.append(
            {
                "id": str(item.get("id") or f"f{i+1}"),
                "severity": sev,
                "category": cat,
                "title": title,
                "detail": detail,
                "evidence": evidence,
                "exampleIds": example_ids,
            }
        )
    order = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda f: order.get(f["severity"], 9))
    return out


def _normalize_medical_checks(raw: list[Any], linked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed_status = {"established", "plausible", "weak", "not_supported"}
    allowed_conf = {"high", "medium", "low"}
    by_id = {str(x.get("patternId") or ""): x for x in raw if isinstance(x, dict)}
    out: list[dict[str, Any]] = []
    for link in linked:
        pid = str(link.get("id") or "")
        item = by_id.get(pid) or next(
            (x for x in raw if isinstance(x, dict) and str(x.get("patternId") or "") == pid),
            None,
        )
        if not isinstance(item, dict):
            # Try fuzzy: any check mentioning this id
            item = next(
                (x for x in raw if isinstance(x, dict) and pid and pid in str(x.get("patternId") or "")),
                {},
            )
        status = str(item.get("status") or "plausible").lower()
        if status not in allowed_status:
            status = "plausible"
        conf = str(item.get("confidence") or "medium").lower()
        if conf not in allowed_conf:
            conf = "medium"
        science_brief, sources = _science_for_pattern(
            pid,
            gemini_brief=str(item.get("scienceBrief") or "").strip(),
            gemini_sources=item.get("sources") or [],
        )
        out.append(
            {
                "patternId": pid,
                "claim": link.get("claim"),
                "category": link.get("category"),
                "observed": link.get("observed"),
                "status": status,
                "confidence": conf,
                "title": str(item.get("title") or "").strip() or pid,
                "explanation": str(item.get("explanation") or "").strip(),
                "scienceBrief": science_brief,
                "sources": sources,
                "caveat": str(item.get("caveat") or "").strip(),
            }
        )
    return out


def _science_for_pattern(
    pattern_id: str,
    *,
    gemini_brief: str = "",
    gemini_sources: Any = None,
) -> tuple[str, list[dict[str, str]]]:
    """Prefer curated briefs/links; keep Gemini text when curated missing; filter URLs."""
    lib = _SCIENCE_LIBRARY.get(pattern_id) or {}
    # Curated physiology first (instant); Gemini/MedGemma can override later.
    brief = str(lib.get("scienceBrief") or "").strip() or gemini_brief
    curated = _normalize_sources(lib.get("sources") or [])
    from_model = _normalize_sources(gemini_sources or [])
    # Curated first, then allowlisted Gemini extras (dedupe by URL)
    seen: set[str] = set()
    sources: list[dict[str, str]] = []
    for s in [*curated, *from_model]:
        url = s["url"].rstrip("/")
        if url in seen:
            continue
        seen.add(url)
        sources.append(s)
        if len(sources) >= 3:
            break
    return brief, sources


def _normalize_sources(raw: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        title = str(item.get("title") or "").strip()
        if not url or not title:
            continue
        if not _allowed_source_url(url):
            continue
        row: dict[str, str] = {"title": title[:160], "url": url}
        pub = str(item.get("publisher") or "").strip()
        if pub:
            row["publisher"] = pub[:80]
        out.append(row)
    return out[:3]


def _allowed_source_url(url: str) -> bool:
    if not url.startswith("https://"):
        return False
    # Block obviously fake placeholders
    low = url.lower()
    if any(x in low for x in ("example.com", "localhost", "127.0.0.1")):
        return False
    try:
        host = re.sub(r"^https://", "", url).split("/")[0].lower()
        host = host.split("@")[-1]  # strip userinfo if any
        if ":" in host:
            host = host.split(":")[0]
    except Exception:  # noqa: BLE001
        return False
    return any(host == h or host.endswith("." + h) for h in _SOURCE_HOST_ALLOW)


def _fallback_medical_checks(linked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Conservative offline judgements for known T1D associations."""
    defaults: dict[str, tuple[str, str, str, str]] = {
        "est-peak-per-carb": (
            "established",
            "high",
            "Carb underestimation raises postprandial peaks",
            "When logged carbs understate actual intake (or absorption is faster), "
            "postprandial glucose rises more than expected — a well-known T1D teaching point.",
        ),
        "timing-late-bolus-higher-peak": (
            "established",
            "high",
            "Late meal boluses worsen postprandial highs",
            "Rapid-acting insulin needs time to act; bolusing well after carbs start "
            "is classically linked to higher post-meal peaks.",
        ),
        "timing-late-bolus-frequency": (
            "established",
            "high",
            "Delayed bolusing is a known postprandial risk",
            "Guidelines and diabetes education routinely stress pre-bolus / mealtime timing "
            "to limit postprandial hyperglycemia.",
        ),
        "stress-follow-hyperglycemia": (
            "established",
            "high",
            "Stress can raise glucose via counter-regulation",
            "Acute psychological stress increases catecholamines/cortisol, which can raise "
            "hepatic glucose output — a documented stress-hyperglycemia pathway.",
        ),
        "stress-near-hypo": (
            "plausible",
            "medium",
            "Stress near hypos is plausible but bidirectional",
            "Hypoglycemia itself is stressful, and stress may coexist with recovery eating "
            "or altered awareness — association ≠ one-way causation.",
        ),
        "logging-gap-volatile": (
            "plausible",
            "medium",
            "Missing meal logs confound interpretation",
            "Incomplete behavioral context is a methodological limitation, not a disease mechanism.",
        ),
        "sport-hypo": (
            "established",
            "high",
            "Exercise raises hypo risk",
            "Physical activity increases glucose uptake and insulin sensitivity; hypos during/after "
            "sport are a classic T1D concern.",
        ),
        "sedentary-volatile": (
            "plausible",
            "medium",
            "Low activity can worsen highs",
            "Sedentary periods reduce muscle glucose uptake; associations with higher glucose are "
            "plausible but multifactorial.",
        ),
        "caffeine-tir": (
            "plausible",
            "medium",
            "Caffeine may raise glucose in some people",
            "Caffeine can increase catecholamines and affect insulin sensitivity; individual "
            "responses vary — not universal.",
        ),
        "mood-tir": (
            "plausible",
            "medium",
            "Mood and glucose often travel together",
            "Low mood, sleep disruption, and reduced self-care commonly coexist with worse TIR; "
            "directionality is bidirectional.",
        ),
        "pain-stress-glucose": (
            "plausible",
            "medium",
            "Pain can stress glucose control",
            "Pain and inflammation can elevate stress hormones and disrupt sleep/activity, "
            "indirectly affecting glucose variability.",
        ),
    }
    out: list[dict[str, Any]] = []
    for link in linked:
        pid = str(link.get("id") or "")
        status, conf, title, explanation = defaults.get(
            pid,
            (
                "plausible",
                "low",
                "Needs clinical context",
                "This association may be plausible but should be interpreted cautiously without more context.",
            ),
        )
        science_brief, sources = _science_for_pattern(pid)
        out.append(
            {
                "patternId": pid,
                "claim": link.get("claim"),
                "category": link.get("category"),
                "observed": link.get("observed"),
                "status": status,
                "confidence": conf,
                "title": title,
                "explanation": explanation,
                "scienceBrief": science_brief,
                "sources": sources,
                "caveat": "Educational physiology note — not a personal diagnosis.",
            }
        )
    return out


def _fallback(signals: dict[str, Any], *, reason: str, locale: str) -> dict[str, Any]:
    stats = signals.get("periodStats") or {}
    period = f"{stats.get('periodStart')} → {stats.get('periodEnd')}"
    medical = _fallback_medical_checks(signals.get("linkedPatterns") or [])
    try:
        from app.services.medgemma_client import enrich_medical_checks_with_medgemma

        medical = enrich_medical_checks_with_medgemma(medical, locale=locale)
    except Exception as exc:  # noqa: BLE001
        logger.warning("MedGemma fallback enrichment skipped: %s", exc)
    return {
        "headline": f"Understanding · last {stats.get('dayCount', '?')} days · {period}",
        "executiveSummary": _fallback_summary(signals),
        "findings": _fallback_findings(signals),
        "medicalChecks": medical,
        "correlations": _fallback_correlations(signals),
        "whatToWatch": [
            "Log meals more consistently on volatile glucose days",
            "Note bolus timing relative to first bites when you can",
            "Tag stress when it spikes — it helps spot glucose links",
        ],
        "dataGaps": _fallback_gaps(signals),
        "source": "fallback",
        "locale": locale,
        "note": reason,
        "scienceSource": "medgemma" if get_settings().medgemma_configured else None,
    }


def _fallback_summary(signals: dict[str, Any]) -> str:
    stats = signals.get("periodStats") or {}
    mg = signals.get("mealGlucose") or {}
    bt = signals.get("bolusTiming") or {}
    parts = [
        f"Across {stats.get('dayCount')} days, avg TIR was {stats.get('avgTimeInRangePct')}% "
        f"with {stats.get('mealCount')} meals logged."
    ]
    if stats.get("meanGlucoseMgDl") is not None:
        parts.append(
            f"Mean glucose {stats.get('meanGlucoseMgDl')} mg/dL "
            f"(~{stats.get('meanGlucoseMmol')} mmol/L) → estimated A1c/GMI "
            f"{stats.get('estimatedA1cPct')}%."
        )
    if mg.get("flaggedMeals"):
        parts.append(
            f"{mg.get('flaggedMeals')} meals looked noisy (steep rise, high peak-per-carb, or slow return)."
        )
    if bt.get("lateCount"):
        parts.append(
            f"{bt.get('lateCount')} meals had insulin_delivered more than 15 minutes after eating."
        )
    sg = signals.get("stressGlucose") or {}
    if sg.get("elevatedStressLogs"):
        parts.append(
            f"{sg.get('elevatedStressLogs')} elevated stress logs; "
            f"{sg.get('followUpHighCount') or 0} followed by highs in the next few hours."
        )
    return " ".join(parts)


def _fallback_findings(signals: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    mg = signals.get("mealGlucose") or {}
    bt = signals.get("bolusTiming") or {}
    sg = signals.get("stressGlucose") or {}
    cov = signals.get("coverageGaps") or {}

    if mg.get("highPeakPerCarbCount"):
        findings.append(
            {
                "id": "estimation-peak-per-carb",
                "severity": "high" if mg["highPeakPerCarbCount"] >= 3 else "medium",
                "category": "estimation",
                "title": "Some meals rose harder than logged carbs suggest",
                "detail": (
                    f"{mg['highPeakPerCarbCount']} meals had a high peak-per-carb ratio — "
                    "possible under-estimation, unlogged extras, or delayed insulin effect."
                ),
                "evidence": [
                    f"Flagged meals: {mg.get('flaggedMeals')}/{mg.get('analyzedMeals')}",
                    f"Avg post-meal Δ: {mg.get('avgDeltaMgDl')} mg/dL",
                ],
            }
        )
    if bt.get("lateCount"):
        late_detail = f"{bt['lateCount']} meals had insulin_delivered >15 min after eat"
        if bt.get("lateAvgDeltaMgDl") is not None and bt.get("onTimeAvgDeltaMgDl") is not None:
            late_detail += (
                f"; late meals averaged +{bt.get('lateAvgDeltaMgDl')} mg/dL vs "
                f"+{bt.get('onTimeAvgDeltaMgDl')} on-time"
            )
        late_detail += "."
        findings.append(
            {
                "id": "timing-late-bolus",
                "severity": "high" if (bt.get("latePct") or 0) >= 30 else "medium",
                "category": "timing",
                "title": "Late insulin relative to meals shows up often",
                "detail": late_detail,
                "evidence": [
                    f"Late bolus share: {bt.get('latePct')}%",
                    f"Missing nearby bolus: {bt.get('missingCount')}",
                ],
            }
        )
    if sg.get("elevatedStressLogs") and (sg.get("followUpHighCount") or 0) >= 1:
        findings.append(
            {
                "id": "stress-follow-high",
                "severity": "medium",
                "category": "stress",
                "title": "Elevated stress often precedes higher glucose",
                "detail": (
                    f"Of {sg['elevatedStressLogs']} elevated stress logs, "
                    f"{sg.get('followUpHighCount')} had readings above range in the next 3 hours."
                ),
                "evidence": [
                    f"Avg follow-up TIR: {sg.get('avgFollowUpTirPct')}%",
                    f"Stress-linked hypo episodes: {sg.get('stressLinkedHypoEpisodes')}",
                ],
            }
        )
    if cov.get("volatileNoMealsDays"):
        findings.append(
            {
                "id": "logging-volatile-no-meals",
                "severity": "medium",
                "category": "logging",
                "title": "Volatile glucose days without meal logs",
                "detail": (
                    f"{cov['volatileNoMealsDays']} days looked volatile on CGM but had zero meals — "
                    "harder to separate food timing from other causes."
                ),
                "evidence": [f"Gap days listed: {cov.get('gapDays')}"],
            }
        )
    if not findings:
        findings.append(
            {
                "id": "glucose-baseline",
                "severity": "low",
                "category": "glucose",
                "title": "Not enough flagged patterns yet",
                "detail": "Keep logging meals, boluses, and stress — signals get sharper with denser data.",
                "evidence": [
                    f"Meals analyzed: {(mg.get('analyzedMeals') or 0)}",
                    f"Avg TIR: {(signals.get('periodStats') or {}).get('avgTimeInRangePct')}%",
                ],
            }
        )
    return findings


def _fallback_correlations(signals: dict[str, Any]) -> list[str]:
    out: list[str] = []
    bt = signals.get("bolusTiming") or {}
    if (
        bt.get("lateAvgDeltaMgDl") is not None
        and bt.get("onTimeAvgDeltaMgDl") is not None
        and bt["lateAvgDeltaMgDl"] > bt["onTimeAvgDeltaMgDl"] + 15
    ):
        out.append(
            f"Late boluses averaged +{bt['lateAvgDeltaMgDl']} mg/dL peak rise vs "
            f"+{bt['onTimeAvgDeltaMgDl']} when closer to mealtime."
        )
    sg = signals.get("stressGlucose") or {}
    if sg.get("stressLinkedHypoEpisodes"):
        out.append(f"{sg['stressLinkedHypoEpisodes']} hypo episodes had stress logged nearby.")
    return out


def _fallback_gaps(signals: dict[str, Any]) -> list[str]:
    gaps: list[str] = []
    mg = signals.get("mealGlucose") or {}
    bt = signals.get("bolusTiming") or {}
    cov = signals.get("coverageGaps") or {}
    if (mg.get("analyzedMeals") or 0) < 5:
        gaps.append("Few meals with complete post-meal CGM stories in this window.")
    if (bt.get("bolusEventCount") or 0) < 3:
        gaps.append("Sparse insulin_delivered pump events — timing analysis is limited.")
    if cov.get("volatileNoStressDays"):
        gaps.append(
            f"{cov['volatileNoStressDays']} volatile days had no stress log — stress links may be understated."
        )
    return gaps or ["Continue logging to strengthen pattern confidence."]


def _parse_json(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            return {}
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
