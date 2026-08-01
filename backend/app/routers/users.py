from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_admin
from app.models import User
from app.routers.auth import serialize_user
from app.services.auth_tokens import hash_password

router = APIRouter(prefix="/users", tags=["users"])


class CreateUserIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    displayName: str = Field(default="", max_length=120)
    role: str = Field(default="member")


class UpdateUserIn(BaseModel):
    displayName: str | None = None
    role: str | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=6, max_length=128)


@router.get("")
def list_users(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    users = db.query(User).order_by(User.created_at.asc()).all()
    return {"users": [serialize_user(u) for u in users]}


@router.post("", status_code=201)
def create_user(
    body: CreateUserIn,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    email = body.email.strip().lower()
    if "@" not in email or " " in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    role = body.role if body.role in ("admin", "member") else "member"
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        id=str(uuid.uuid4()),
        email=email,
        password_hash=hash_password(body.password),
        display_name=(body.displayName or "").strip() or email.split("@")[0],
        role=role,
        active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"user": serialize_user(user)}


@router.patch("/{user_id}")
def update_user(
    user_id: str,
    body: UpdateUserIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.displayName is not None:
        user.display_name = body.displayName.strip()
    if body.role is not None:
        if body.role not in ("admin", "member"):
            raise HTTPException(status_code=400, detail="role must be admin or member")
        if user.id == admin.id and body.role != "admin":
            raise HTTPException(status_code=400, detail="Cannot demote yourself")
        user.role = body.role
    if body.active is not None:
        if user.id == admin.id and body.active is False:
            raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
        user.active = body.active
    if body.password:
        user.password_hash = hash_password(body.password)

    db.commit()
    db.refresh(user)
    return {"user": serialize_user(user)}


@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"ok": True}
