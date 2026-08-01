"""CLI / CronJob entry: python -m app.jobs.send_daily_report [YYYY-MM-DD]

With no date argument, emails yesterday (Europe/Paris) — the completed day.
"""

from __future__ import annotations

import logging
import sys

from app.core.bootstrap import init_db
from app.core.database import SessionLocal
from app.services.daily_report_mail import send_daily_report_email

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    date = args[0] if args else None
    init_db()
    db = SessionLocal()
    try:
        result = send_daily_report_email(db, date=date)
        logger.info("Sent daily report: %s", result)
        return 0
    except Exception:
        logger.exception("Failed to send daily report email")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
