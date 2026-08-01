from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Device, User
from app.services.auth_tokens import decode_access_token

_bearer = HTTPBearer(auto_error=False)


def require_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing Authorization Bearer token")
    try:
        payload = decode_access_token(creds.credentials)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    user_id = str(payload.get("sub") or "")
    user = db.get(User, user_id) if user_id else None
    if not user or not user.active:
        raise HTTPException(status_code=401, detail="User not found or disabled")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def optional_device_id(
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
) -> str | None:
    device_id = (x_device_id or "").strip()
    if not device_id:
        return None
    if len(device_id) < 8:
        raise HTTPException(status_code=400, detail="Invalid X-Device-Id header")
    return device_id


def require_device_id(
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
) -> str:
    """Required for phone write paths (glucose sync, meal capture, activity)."""
    device_id = (x_device_id or "").strip()
    if len(device_id) < 8:
        raise HTTPException(status_code=400, detail="Invalid or missing X-Device-Id header")
    return device_id


def ensure_device(db: Session, device_id: str, owner_user_id: str | None = None) -> Device:
    device = db.get(Device, device_id)
    if device:
        if owner_user_id and not device.owner_user_id:
            device.owner_user_id = owner_user_id
            db.commit()
            db.refresh(device)
        return device
    device = Device(id=device_id, owner_user_id=owner_user_id)
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def household_device_ids(db: Session) -> list[str]:
    """Single-household deploy: all authenticated users share all device data."""
    ids = [row[0] for row in db.query(Device.id).all()]
    return ids
