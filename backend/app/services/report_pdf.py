from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    Image as RLImage,
)
from app.core.config import get_settings

TEAL = colors.HexColor("#0d9488")
INK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#64748b")
CARD = colors.HexColor("#f1f5f9")
WARN = colors.HexColor("#b45309")
ROSE = colors.HexColor("#be123c")


def build_daily_pdf(
    *,
    daily: dict[str, Any],
    ai: dict[str, Any],
    share_url: str | None = None,
) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"Health Companion · {daily.get('date')}",
        author="Health Companion",
    )
    styles = _styles()
    story: list[Any] = []

    story.append(Paragraph("Health Companion", styles["brand"]))
    story.append(Paragraph(f"Daily report · {daily.get('date')}", styles["subtitle"]))
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph(ai.get("headline") or "Day overview", styles["h1"]))
    story.append(Paragraph(ai.get("summary") or "", styles["body"]))
    story.append(Spacer(1, 4 * mm))

    story.append(_stats_table(daily))
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("AI insights", styles["h2"]))
    if ai.get("note"):
        story.append(Paragraph(str(ai["note"]), styles["note"]))

    if ai.get("highlights"):
        story.append(Paragraph("Highlights", styles["h3"]))
        story.append(_bullets(ai["highlights"], styles))

    if ai.get("watchouts"):
        story.append(Paragraph("Watch-outs", styles["h3"]))
        story.append(_bullets(ai["watchouts"], styles, warn=True))

    if ai.get("tomorrowTips"):
        story.append(Paragraph("Tips for tomorrow", styles["h3"]))
        story.append(_bullets(ai["tomorrowTips"], styles))

    story.append(Spacer(1, 5 * mm))

    agent_prompt = (daily.get("agentPrompt") or "").strip()
    if agent_prompt:
        story.append(Paragraph("AI agent briefing prompt", styles["h2"]))
        story.append(
            Paragraph(
                "Copy into your AI agent for a day activity debrief:",
                styles["note"],
            )
        )
        # Escape HTML-ish chars for ReportLab Paragraph
        safe = (
            agent_prompt.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\n", "<br/>")
        )
        story.append(Paragraph(safe, styles["body"]))
        story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Day details", styles["h2"]))

    nutrition = daily.get("nutrition") or {}
    macros = nutrition.get("macros") or {}
    story.append(
        Paragraph(
            f"<b>Nutrition:</b> {nutrition.get('mealCount', 0)} meal(s) · "
            f"{int(macros.get('caloriesKcal') or 0)} kcal · "
            f"Carbs {macros.get('carbsG', 0)}g · Protein {macros.get('proteinG', 0)}g · "
            f"Fat {macros.get('fatG', 0)}g",
            styles["body"],
        )
    )

    targets = daily.get("calorieTargets") or {}
    balance = daily.get("calorieBalance") or {}
    if targets:
        story.append(
            Paragraph(
                f"<b>Calorie plan:</b> maintenance {targets.get('maintenanceKcal')} kcal · "
                f"deficit target {targets.get('targetKcal')} kcal "
                f"(−{int(targets.get('deficitKcal') or 0)}) · "
                f"BMI {targets.get('bmi')} · weight {targets.get('weightKg')} kg",
                styles["body"],
            )
        )
    if balance:
        rem = balance.get("remainingToTarget")
        story.append(
            Paragraph(
                f"<b>Today vs target:</b> intake {balance.get('intakeKcal')} kcal · "
                f"{'under' if (rem or 0) >= 0 else 'over'} by {abs(int(rem or 0))} kcal",
                styles["body"],
            )
        )

    weight = daily.get("weight") or {}
    if weight:
        story.append(
            Paragraph(
                f"<b>Weight:</b> {weight.get('weightKg')} kg ({weight.get('date')})",
                styles["body"],
            )
        )

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("Meals", styles["h2"]))
    meals = daily.get("meals") or []
    if not meals:
        story.append(Paragraph("No meals logged this day.", styles["body"]))
    else:
        story.append(_meals_table(meals, styles))

    glucose = daily.get("glucose") or {}
    tir = glucose.get("timeInRangePct")
    story.append(Paragraph("Glucose & activity", styles["h2"]))
    story.append(
        Paragraph(
            f"<b>Glucose:</b> avg {glucose.get('avgMgDl') or '—'} mg/dL · "
            f"TIR {tir if tir is not None else '—'}% · "
            f"Low {glucose.get('lowCount', 0)} · High {glucose.get('highCount', 0)} · "
            f"Hypo episodes {glucose.get('hypoEventCount', 0)}",
            styles["body"],
        )
    )
    hypo_events = glucose.get("hypoEvents") or []
    if hypo_events:
        bits = []
        for h in hypo_events[:6]:
            try:
                clock = datetime.fromtimestamp(int(h.get("startedAt") or 0) / 1000).strftime("%H:%M")
            except (OSError, ValueError, OverflowError, TypeError):
                clock = "—"
            bits.append(f"{clock} min {h.get('minMgDl')} mg/dL ({h.get('durationMin', 0)} min)")
        story.append(Paragraph(f"<b>Hypoglycemia:</b> " + " · ".join(bits), styles["body"]))


    activity = daily.get("activity") or {}
    if activity:
        energy = activity.get("energyScore")
        story.append(
            Paragraph(
                f"<b>Activity:</b> {activity.get('steps', 0):,} steps"
                + (f" · Energy score {int(round(energy))}" if energy is not None else "")
                + (f" · via {activity.get('source')}" if activity.get("source") else ""),
                styles["body"],
            )
        )
    else:
        story.append(Paragraph("<b>Activity:</b> No activity synced.", styles["body"]))

    workouts = (activity or {}).get("workouts") or []
    if workouts:
        story.append(Paragraph("Workouts", styles["h3"]))
        story.append(
            _bullets(
                [
                    f"{w.get('name') or 'Workout'} · {w.get('durationMin') or 0} min"
                    + (f" · {w.get('calories')} kcal" if w.get("calories") is not None else "")
                    for w in workouts
                ],
                styles,
            )
        )

    for label, key in (
        ("Care visits", "careVisits"),
        ("Sport matches", "sportMatches"),
        ("Injuries & pain", "injuries"),
    ):
        rows = daily.get(key) or []
        if not rows:
            continue
        story.append(Paragraph(label, styles["h3"]))
        lines = []
        for row in rows:
            if key == "careVisits":
                lines.append(
                    f"{row.get('kindLabel') or row.get('kind')}"
                    + (f" · {row.get('label')}" if row.get("label") else "")
                    + (f" — {row.get('notes')}" if row.get("notes") else "")
                )
            elif key == "injuries":
                title = row.get("title") or row.get("injuryTypeLabel") or "Injury"
                area = row.get("bodyAreaLabel") or row.get("bodyArea") or ""
                bit = f"{title} · {area} · since {row.get('startedOn')} · {row.get('status')}"
                today_p = row.get("todayPain")
                if today_p and today_p.get("painScore") is not None:
                    bit += f" · pain {today_p['painScore']}/10"
                if row.get("exerciseNotes"):
                    bit += f" — exercises: {row['exerciseNotes']}"
                lines.append(bit)
            else:
                lines.append(
                    f"{(row.get('sport') or 'match').title()} · {row.get('result')}"
                    + (f" · {row.get('score')}" if row.get("score") else "")
                    + (f" · intensity {row.get('intensity')}" if row.get("intensity") else "")
                    + (f" · {row.get('durationMin')} min" if row.get("durationMin") is not None else "")
                )
        story.append(_bullets(lines, styles))

    pump_events = daily.get("pumpEvents") or []
    if pump_events:
        story.append(Paragraph("Pump log events", styles["h3"]))
        lines = []
        for ev in pump_events[:20]:
            clock = ev.get("time") or "—"
            label = ev.get("kindLabel") or ev.get("kind") or "Event"
            detail = ev.get("title") or ev.get("message") or ""
            units = ev.get("units")
            bit = f"{clock} · {label}"
            if units is not None:
                bit += f" · {units} U"
            if detail and detail != label:
                bit += f" — {detail}"
            lines.append(bit)
        story.append(_bullets(lines, styles))

    story.append(Spacer(1, 8 * mm))
    if share_url:
        story.append(_share_qr_block(share_url, styles))
        story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            "Not medical advice. Insights are generated to support self-tracking and lifestyle reflection.",
            styles["footer"],
        )
    )

    doc.build(story)
    return buffer.getvalue()


def _share_qr_block(share_url: str, styles: dict[str, ParagraphStyle]) -> Table:
    """QR + short copy so anyone can open the live report from the PDF."""
    try:
        from app.services.report_share import build_qr_png

        png = build_qr_png(share_url, box_size=5, border=1)
        side = 28 * mm
        qr_img = RLImage(io.BytesIO(png), width=side, height=side)
    except Exception:
        qr_img = Paragraph("—", styles["tableMuted"])

    copy = Paragraph(
        "<b>Share this report</b><br/>"
        "Scan the QR code to open the live daily PDF on any phone.<br/>"
        f'<font size="7" color="#64748b">{_esc(share_url)}</font>',
        styles["body"],
    )
    table = Table([[qr_img, copy]], colWidths=[34 * mm, 140 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("BACKGROUND", (0, 0), (-1, -1), CARD),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ]
        )
    )
    return table


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "brand": ParagraphStyle(
            "brand",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            textColor=TEAL,
            spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            textColor=MUTED,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            textColor=INK,
            spaceAfter=6,
            leading=22,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            textColor=TEAL,
            spaceBefore=8,
            spaceAfter=4,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11,
            textColor=INK,
            spaceBefore=6,
            spaceAfter=2,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            textColor=INK,
            leading=14,
            spaceAfter=4,
            alignment=TA_LEFT,
        ),
        "note": ParagraphStyle(
            "note",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9,
            textColor=MUTED,
            spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            textColor=INK,
            leading=13,
        ),
        "bulletWarn": ParagraphStyle(
            "bulletWarn",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            textColor=WARN,
            leading=13,
        ),
        "footer": ParagraphStyle(
            "footer",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "statLabel": ParagraphStyle(
            "statLabel",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "statValue": ParagraphStyle(
            "statValue",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=12,
            textColor=INK,
            alignment=TA_CENTER,
        ),
        "tableHead": ParagraphStyle(
            "tableHead",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            textColor=MUTED,
        ),
        "tableCell": ParagraphStyle(
            "tableCell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=INK,
            leading=11,
        ),
        "tableMuted": ParagraphStyle(
            "tableMuted",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=7.5,
            textColor=MUTED,
            leading=10,
        ),
    }


def _meal_type_label(meal_type: str | None) -> str:
    labels = {
        "breakfast": "Breakfast",
        "lunch": "Lunch",
        "dinner": "Dinner",
        "snack": "Snack",
        "resucrage": "Resucrage",
        "other": "Other",
    }
    key = (meal_type or "other").lower()
    return labels.get(key, (meal_type or "Other").capitalize())


def _meal_thumb(photo_path: str | None, max_side: float = 26 * mm) -> Any:
    """Return a reportlab Image thumbnail or a dash placeholder."""
    styles = _styles()
    if not photo_path:
        return Paragraph("—", styles["tableMuted"])
    try:
        from PIL import Image as PILImage

        root = Path(get_settings().upload_dir).resolve()
        full = (root / photo_path).resolve()
        if not full.is_relative_to(root) or not full.is_file():
            return Paragraph("—", styles["tableMuted"])

        with PILImage.open(full) as im:
            im = im.convert("RGB")
            im.thumbnail((220, 220))
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=72)
            buf.seek(0)
            w, h = im.size
            scale = min(max_side / max(w, 1), max_side / max(h, 1))
            return RLImage(buf, width=w * scale, height=h * scale)
    except Exception:
        return Paragraph("—", styles["tableMuted"])


def _meals_table(meals: list[dict[str, Any]], styles: dict[str, ParagraphStyle]) -> Table:
    header = [
        Paragraph("Photo", styles["tableHead"]),
        Paragraph("When", styles["tableHead"]),
        Paragraph("Type", styles["tableHead"]),
        Paragraph("Details", styles["tableHead"]),
    ]
    rows: list[list[Any]] = [header]

    for meal in meals:
        macros = meal.get("macros") or {}
        kcal = int(round(float(macros.get("caloriesKcal") or 0)))
        carbs = macros.get("carbsG") or 0
        protein = macros.get("proteinG") or 0
        fat = macros.get("fatG") or 0
        items = meal.get("items") or []
        item_names = []
        for it in items[:5]:
            if isinstance(it, dict) and it.get("name"):
                item_names.append(str(it["name"]))
        summary = (meal.get("aiSummary") or meal.get("notes") or "").strip()
        if len(summary) > 160:
            summary = summary[:157] + "…"

        detail_bits = [
            f"<b>{kcal} kcal</b> · C {carbs}g · P {protein}g · F {fat}g",
        ]
        if item_names:
            detail_bits.append(_esc(", ".join(item_names)))
        if summary:
            detail_bits.append(_esc(summary))
        if (meal.get("mealType") or "").lower() == "resucrage":
            detail_bits.append("<font color='#be123c'>Hypo treatment</font>")

        when = meal.get("time") or "—"
        rows.append(
            [
                _meal_thumb(meal.get("photoPath")),
                Paragraph(_esc(str(when)), styles["tableCell"]),
                Paragraph(_esc(_meal_type_label(meal.get("mealType"))), styles["tableCell"]),
                Paragraph("<br/>".join(detail_bits), styles["tableCell"]),
            ]
        )

    # A4 usable ~174mm with 18mm margins
    table = Table(rows, colWidths=[30 * mm, 18 * mm, 24 * mm, 102 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), CARD),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ]
        )
    )
    return table


def _esc(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _stats_table(daily: dict[str, Any]) -> Table:
    styles = _styles()
    nutrition = daily.get("nutrition") or {}
    macros = nutrition.get("macros") or {}
    glucose = daily.get("glucose") or {}
    activity = daily.get("activity") or {}
    energy = activity.get("energyScore") if activity else None
    tir = glucose.get("timeInRangePct")

    cells = [
        [
            _stat_cell("Calories", f"{int(macros.get('caloriesKcal') or 0)}", styles),
            _stat_cell(
                "Target",
                (
                    str(int((daily.get("calorieTargets") or {}).get("targetKcal")))
                    if (daily.get("calorieTargets") or {}).get("targetKcal") is not None
                    else "—"
                ),
                styles,
            ),
            _stat_cell("Carbs", f"{macros.get('carbsG', 0)}g", styles),
            _stat_cell("Steps", f"{(activity or {}).get('steps', 0):,}", styles),
            _stat_cell(
                "Energy",
                str(int(round(energy))) if energy is not None else "—",
                styles,
            ),
            _stat_cell("TIR", f"{tir}%" if tir is not None else "—", styles),
        ]
    ]
    table = Table(cells, colWidths=[27 * mm] * 6)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CARD),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def _stat_cell(label: str, value: str, styles: dict[str, ParagraphStyle]) -> Paragraph:
    return Paragraph(
        f"<font size='8' color='#64748b'>{label}</font><br/><b>{value}</b>",
        styles["statValue"],
    )


def _bullets(items: list[str], styles: dict[str, ParagraphStyle], *, warn: bool = False) -> ListFlowable:
    style = styles["bulletWarn"] if warn else styles["bullet"]
    return ListFlowable(
        [
            ListItem(Paragraph(item, style), leftIndent=4, bulletColor=TEAL if not warn else WARN)
            for item in items
        ],
        bulletType="bullet",
        leftIndent=12,
        spaceBefore=2,
        spaceAfter=4,
    )
