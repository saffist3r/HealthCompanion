"""Plain-text day summary handed to AI agents (copy-paste prompt)."""

from __future__ import annotations

from datetime import datetime
from typing import Any


def build_day_activity_prompt(daily: dict[str, Any]) -> str:
    """Copy-paste briefing for an external AI agent covering the full day."""
    date = daily.get("date") or "unknown date"
    lines: list[str] = [
        f"You are my health companion AI agent. Below is a structured summary of my day ({date}).",
        "Please give me a concise debrief: what went well, risks to watch (especially glucose and insulin),",
        "and 2–3 practical adjustments for tomorrow. Keep it actionable and brief.",
        "",
        "## Glucose",
    ]
    g = daily.get("glucose") or {}
    gt = daily.get("glucoseTargets") or {}
    tir_low = float(gt.get("tirLowMgDl") or 70)
    tir_high = float(gt.get("tirHighMgDl") or 180)
    range_label = f"{tir_low:g}–{tir_high:g}"
    if g.get("readingCount"):
        lines.append(
            f"- Readings: {g.get('readingCount')} · avg {g.get('avgMgDl')} mg/dL · "
            f"min {g.get('minMgDl')} · max {g.get('maxMgDl')}"
        )
        if g.get("timeInRangePct") is not None:
            lines.append(f"- Time in range ({range_label}): {g.get('timeInRangePct')}%")
        hypo = int(g.get("hypoEventCount") or 0)
        if hypo:
            lines.append(f"- Hypoglycemia episodes (<{tir_low:g}): {hypo}")
        if g.get("lowCount"):
            lines.append(f"- Low readings: {g.get('lowCount')} · high readings: {g.get('highCount') or 0}")
        readings = g.get("readings") or []
        if readings:
            lines.append(f"- CGM timeline ({len(readings)} samples):")
            for r in readings[:48]:
                if not isinstance(r, dict):
                    continue
                ts = int(r.get("timestamp") or 0)
                mg = r.get("mgDl")
                try:
                    clock = datetime.fromtimestamp(ts / 1000).strftime("%H:%M")
                except (OSError, ValueError, OverflowError):
                    clock = "—"
                lines.append(f"  · {clock}: {mg} mg/dL")
            if len(readings) > 48:
                lines.append(f"  · … +{len(readings) - 48} more readings in archive")
    else:
        lines.append("- No glucose samples synced.")

    lines.append("")
    lines.append("## Nutrition")
    nut = daily.get("nutrition") or {}
    macros = nut.get("macros") or {}
    lines.append(
        f"- Meals: {nut.get('mealCount') or 0} · ~{int(macros.get('caloriesKcal') or 0)} kcal · "
        f"carbs {macros.get('carbsG') or 0}g · protein {macros.get('proteinG') or 0}g · "
        f"fat {macros.get('fatG') or 0}g"
    )
    targets = daily.get("calorieTargets") or {}
    balance = daily.get("calorieBalance") or {}
    if targets:
        lines.append(
            f"- Calorie targets: maintenance {targets.get('maintenanceKcal')} · "
            f"deficit goal {targets.get('targetKcal')}"
        )
    if balance:
        rem = balance.get("remainingToTarget")
        if rem is not None:
            if rem >= 0:
                lines.append(f"- Remaining to deficit target: {rem} kcal")
            else:
                lines.append(f"- Over deficit target by {abs(rem)} kcal")
    for meal in daily.get("meals") or []:
        clock = meal.get("time") or "—"
        mtype = meal.get("mealType") or "meal"
        mm = meal.get("macros") or {}
        summary = meal.get("aiSummary") or meal.get("notes") or ""
        bit = (
            f"- {clock} {mtype}: {int(mm.get('caloriesKcal') or 0)} kcal, "
            f"{mm.get('carbsG') or 0}g carbs"
        )
        if summary:
            bit += f" — {str(summary).strip()[:160]}"
        lines.append(bit)

    lines.append("")
    lines.append("## Activity & sport")
    act = daily.get("activity")
    if act:
        lines.append(f"- Steps: {act.get('steps') or 0:,}")
        if act.get("energyScore") is not None:
            lines.append(f"- Energy score: {int(round(act['energyScore']))}")
        if act.get("caloriesBurned"):
            lines.append(f"- Active kcal: ~{int(act['caloriesBurned'])}")
        for w in act.get("workouts") or []:
            if isinstance(w, dict):
                lines.append(
                    f"- Workout: {w.get('name') or 'Workout'} · {w.get('durationMin') or 0} min"
                    + (f" · {w.get('calories')} kcal" if w.get("calories") is not None else "")
                )
    else:
        lines.append("- No phone activity synced.")
    matches = daily.get("sportMatches") or []
    if matches:
        for m in matches:
            sport = m.get("sport") or "sport"
            bits = [str(sport), str(m.get("result") or "")]
            if m.get("score"):
                bits.append(str(m["score"]))
            if m.get("intensity"):
                bits.append(f"intensity {m['intensity']}")
            if m.get("durationMin") is not None:
                bits.append(f"{m['durationMin']} min")
            if m.get("time"):
                bits.append(str(m["time"]))
            if m.get("notes"):
                bits.append(str(m["notes"]))
            lines.append("- Sport: " + " · ".join(b for b in bits if b))
    else:
        lines.append("- No logged sport sessions.")

    plans = daily.get("workoutPlans") or []
    if plans:
        lines.append("")
        lines.append("## Suggested workout plans")
        for p in plans:
            if not isinstance(p, dict):
                continue
            title = p.get("title") or "Workout"
            focus = p.get("focus") or ""
            dur = p.get("durationMin")
            head = f"- {title}"
            if focus:
                head += f" ({focus})"
            if dur:
                head += f" · ~{dur} min"
            lines.append(head)
            for ex in (p.get("exercises") or [])[:8]:
                if not isinstance(ex, dict):
                    continue
                name = ex.get("name") or "Exercise"
                detail = []
                if ex.get("sets"):
                    detail.append(f"{ex['sets']} sets")
                if ex.get("reps"):
                    detail.append(str(ex["reps"]))
                if ex.get("durationMin"):
                    detail.append(f"{ex['durationMin']} min")
                lines.append(f"  · {name}" + (f" — {', '.join(detail)}" if detail else ""))

    lines.append("")
    lines.append("## Care visits")
    care = daily.get("careVisits") or []
    if care:
        for v in care:
            label = v.get("label") or v.get("kindLabel") or v.get("kind") or "Care"
            note = f" — {v['notes']}" if v.get("notes") else ""
            lines.append(f"- Care: {label}{note}")
    else:
        lines.append("- No care visits.")

    lines.append("")
    lines.append("## Mental health")
    stress = daily.get("stressLogs") or []
    if stress:
        for s in stress:
            label = s.get("levelLabel") or s.get("level") or "stress"
            score = f" ({s['score']})" if s.get("score") is not None else ""
            src = f" [{s.get('sourceLabel') or s.get('source')}]" if s.get("source") else ""
            note = f" — {s['notes']}" if s.get("notes") else ""
            lines.append(f"- Stress: {label}{score}{src}{note}")
    else:
        lines.append("- No stress / Energy Score entries.")
    check_in = daily.get("dayCheckIn")
    if check_in:
        lines.append(
            f"- Mood: {check_in.get('moodLabel') or check_in.get('mood')} · "
            f"wake: {check_in.get('wakeQualityLabel') or check_in.get('wakeQuality')}"
        )
        lines.append(
            f"- ADHD: focus {check_in.get('focusLabel') or check_in.get('focus')} · "
            f"restlessness {check_in.get('restlessnessLabel') or check_in.get('restlessness')} · "
            f"overwhelm {check_in.get('overwhelmLabel') or check_in.get('overwhelm')} · "
            f"task start {check_in.get('taskInitiationLabel') or check_in.get('taskInitiation')} · "
            f"impulsivity {check_in.get('impulsivityLabel') or check_in.get('impulsivity')}"
        )
        flags = []
        if check_in.get("medicationTaken"):
            flags.append("medication taken")
        if check_in.get("hyperfocus"):
            flags.append("hyperfocus episode")
        if check_in.get("sleepHours") is not None:
            flags.append(f"sleep {check_in['sleepHours']}h")
        if check_in.get("notes"):
            flags.append(str(check_in["notes"]))
        if flags:
            lines.append("- " + " · ".join(flags))
    else:
        lines.append("- No mood / ADHD check-in.")
    caffeine = daily.get("caffeineLogs") or []
    if caffeine:
        total_mg = sum(int(c.get("caffeineMg") or 0) for c in caffeine)
        lines.append(f"- Caffeine total: {total_mg} mg ({len(caffeine)} drink(s))")
        for c in caffeine:
            when = f" @ {c['time']}" if c.get("time") else ""
            note = f" — {c['notes']}" if c.get("notes") else ""
            lines.append(
                f"  - {c.get('drinkLabel') or c.get('drink')}{when} · {c.get('caffeineMg')} mg{note}"
            )
    else:
        lines.append("- No caffeine logged.")

    lines.append("")
    lines.append("## Injuries & pain")
    injuries = daily.get("injuries") or []
    if injuries:
        for inj in injuries:
            title = inj.get("title") or inj.get("injuryTypeLabel") or "Injury"
            area = inj.get("bodyAreaLabel") or inj.get("bodyArea") or "?"
            status = inj.get("status") or "active"
            bits = [f"{title}", f"area {area}", f"since {inj.get('startedOn')}", f"status {status}"]
            tags = inj.get("relatedActivityLabels") or inj.get("relatedActivityKinds") or []
            if tags:
                bits.append("related to " + ", ".join(str(t) for t in tags))
            today_p = inj.get("todayPain")
            if today_p and today_p.get("painScore") is not None:
                bits.append(f"today pain {today_p['painScore']}/10")
                if today_p.get("relatedActivityLabel") or today_p.get("relatedActivityKind"):
                    bits.append(
                        f"after {today_p.get('relatedActivityLabel') or today_p.get('relatedActivityKind')}"
                    )
                if today_p.get("notes"):
                    bits.append(str(today_p["notes"]))
            lines.append("- " + " · ".join(str(b) for b in bits if b))
            if inj.get("exerciseNotes"):
                lines.append(f"  Exercises: {inj['exerciseNotes']}")
            if inj.get("notes"):
                lines.append(f"  Notes: {inj['notes']}")
    else:
        lines.append("- No open injuries or pain logs today.")

    lines.append("")
    lines.append("## Pump / insulin")
    pump = daily.get("pumpEvents") or []
    if pump:
        insulin = sum(float(p.get("units") or 0) for p in pump if p.get("kind") == "insulin_delivered")
        lines.append(f"- Events: {len(pump)}" + (f" · insulin delivered {round(insulin, 2)} U" if insulin else ""))
        for p in pump[:12]:
            clock = p.get("time") or "—"
            label = p.get("kindLabel") or p.get("kind") or "event"
            msg = p.get("message") or ""
            units = p.get("units")
            bit = f"- {clock} {label}"
            if units is not None:
                bit += f" · {units} U"
            elif msg and msg != label:
                bit += f" — {msg[:120]}"
            lines.append(bit)
    else:
        lines.append("- No pump events.")

    weight = daily.get("weight")
    if weight and weight.get("weightKg") is not None:
        lines.append("")
        lines.append("## Weight")
        lines.append(f"- {weight.get('weightKg')} kg" + (f" ({weight.get('date')})" if weight.get("date") else ""))

    warns = daily.get("warnings") or []
    if warns:
        lines.append("")
        lines.append("## Warnings")
        for w in warns:
            lines.append(f"- [{w.get('severity')}] {w.get('title')}: {w.get('message')}")

    return "\n".join(lines).strip() + "\n"
