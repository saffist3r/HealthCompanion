from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ensure_device, optional_device_id, require_user
from app.models import User
from app.services import login_throttle
from app.services.auth_tokens import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6)


class TokenOut(BaseModel):
    accessToken: str
    tokenType: str = "bearer"
    user: dict


class MeOut(BaseModel):
    id: str
    email: str
    displayName: str
    role: str


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "displayName": user.display_name or user.email.split("@")[0],
        "role": user.role,
        "active": user.active,
        "createdAt": int(user.created_at.timestamp() * 1000) if user.created_at else None,
    }


@router.post("/login", response_model=TokenOut)
def login(
    body: LoginIn,
    request: Request,
    db: Session = Depends(get_db),
    device_id: str | None = Depends(optional_device_id),
) -> TokenOut:
    email = body.email.strip().lower()
    if "@" not in email or " " in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    client_ip = request.client.host if request.client else None
    wait = login_throttle.retry_after_seconds(email, client_ip)
    if wait is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts. Try again later.",
            headers={"Retry-After": str(wait)},
        )
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.active or not verify_password(body.password, user.password_hash):
        login_throttle.record_failure(email, client_ip)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    login_throttle.record_success(email)

    if device_id:
        ensure_device(db, device_id, owner_user_id=user.id)

    token = create_access_token(user_id=user.id, email=user.email, role=user.role)
    return TokenOut(accessToken=token, user=serialize_user(user))


@router.post("/refresh", response_model=TokenOut)
def refresh(user: User = Depends(require_user)) -> TokenOut:
    """Swap a still-valid token for a fresh one, so an app opened regularly never logs out."""
    token = create_access_token(user_id=user.id, email=user.email, role=user.role)
    return TokenOut(accessToken=token, user=serialize_user(user))


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(require_user)) -> MeOut:
    return MeOut(
        id=user.id,
        email=user.email,
        displayName=user.display_name or user.email.split("@")[0],
        role=user.role,
    )


@router.post("/register-device")
def register_device(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    device_id: str | None = Depends(optional_device_id),
) -> dict:
    if not device_id:
        raise HTTPException(status_code=400, detail="X-Device-Id required")
    ensure_device(db, device_id, owner_user_id=user.id)
    return {"ok": True, "deviceId": device_id}
