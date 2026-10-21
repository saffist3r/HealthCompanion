from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.services.upload_urls import verify_upload_signature

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.get("/{filename}")
def get_upload(
    filename: str,
    exp: int = Query(...),
    sig: str = Query(...),
) -> FileResponse:
    if not verify_upload_signature(filename, exp, sig):
        raise HTTPException(status_code=403, detail="Invalid or expired link")
    root = Path(get_settings().upload_dir).resolve()
    path = (root / filename).resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        path,
        headers={
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )
