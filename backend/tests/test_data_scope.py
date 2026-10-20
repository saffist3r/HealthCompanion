from __future__ import annotations

import uuid

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.deps import ensure_device, household_device_ids
from app.models import User


def _user(db, email: str) -> User:
    user = User(id=str(uuid.uuid4()), email=email, password_hash="x", role="member", active=True)
    db.add(user)
    db.commit()
    return user


def test_household_and_owner_scopes(client, monkeypatch) -> None:
    db = SessionLocal()
    try:
        alice = _user(db, f"alice-{uuid.uuid4().hex[:6]}@example.com")
        bob = _user(db, f"bob-{uuid.uuid4().hex[:6]}@example.com")
        a_dev = ensure_device(db, f"dev-a-{uuid.uuid4().hex}", owner_user_id=alice.id).id
        b_dev = ensure_device(db, f"dev-b-{uuid.uuid4().hex}", owner_user_id=bob.id).id

        monkeypatch.setattr(get_settings(), "data_scope", "household")
        assert {a_dev, b_dev} <= set(household_device_ids(db, alice))

        monkeypatch.setattr(get_settings(), "data_scope", "owner")
        assert household_device_ids(db, alice) == [a_dev]
        assert household_device_ids(db, bob) == [b_dev]
        # Jobs without a user keep the household view.
        assert {a_dev, b_dev} <= set(household_device_ids(db))
    finally:
        db.close()
