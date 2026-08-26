"""CLI: refresh archived debrief facts (e.g. add glucose readings) without re-calling Gemini.

  python -m app.jobs.rearchive_debriefs [limit]

Default limit=200 (newest debriefs first).
"""

from __future__ import annotations

import json
import logging
import sys

from app.core.bootstrap import init_db
from app.core.database import SessionLocal
from app.core.deps import household_device_ids
from app.routers.reports import _load_daily
from app.services.day_debriefs import list_day_debriefs, refresh_debrief_facts

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    limit = 200
    if args:
        try:
            limit = max(1, min(int(args[0]), 500))
        except ValueError:
            logger.error("limit must be an integer")
            return 2

    init_db()
    db = SessionLocal()
    try:
        rows = list_day_debriefs(db, limit=limit)
        ids = household_device_ids(db)
        updated = 0
        for row in rows:
            daily = _load_daily(db, ids, row.date)
            refreshed = refresh_debrief_facts(db, daily)
            if not refreshed:
                logger.warning("No debrief row for %s — skipped", row.date)
                continue
            try:
                g = json.loads(refreshed.facts_json or "{}").get("glucose") or {}
            except json.JSONDecodeError:
                g = {}
            n = len(g.get("readings") or [])
            logger.info("%s: %d glucose readings in facts", row.date, n)
            updated += 1
        logger.info("Re-archive complete: %d day(s) refreshed", updated)
        return 0
    except Exception:
        logger.exception("Re-archive failed")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
