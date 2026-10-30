from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from PIL import Image, ImageOps

from app.core.config import get_settings
from app.services.upload_urls import verify_upload_signature

router = APIRouter(prefix="/uploads", tags=["uploads"])


# Fixed thumbnail widths, so the on-disk cache stays bounded.
THUMB_WIDTHS = (160, 320, 640)


def _thumbnail(root: Path, path: Path, width: int) -> Path:
    """Resized JPEG of an uploaded photo, created once and cached under .thumbs/<width>/."""
    out = root / ".thumbs" / str(width) / f"{path.stem}.jpg"
    if out.is_file() and out.stat().st_mtime >= path.stat().st_mtime:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((width, width * 4))
        tmp = out.with_suffix(f".{uuid.uuid4().hex}.tmp")
        img.save(tmp, "JPEG", quality=78, optimize=True)
    tmp.replace(out)  # atomic: concurrent requests never see a half-written file
    return out


@router.get("/{filename}")
def get_upload(
    filename: str,
    exp: int = Query(...),
    sig: str = Query(...),
    w: int | None = Query(None, description="Thumbnail width: 160, 320 or 640"),
) -> FileResponse:
    if not verify_upload_signature(filename, exp, sig):
        raise HTTPException(status_code=403, detail="Invalid or expired link")
    root = Path(get_settings().upload_dir).resolve()
    path = (root / filename).resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    if w is not None:
        if w not in THUMB_WIDTHS:
            raise HTTPException(status_code=400, detail=f"w must be one of {list(THUMB_WIDTHS)}")
        try:
            path = _thumbnail(root, path, w)
        except (OSError, ValueError):
            pass  # not an image Pillow can read: serve the original
    return FileResponse(
        path,
        headers={
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )
