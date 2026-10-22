"""/health-data API: activity, care, sport, mental health, body, injuries, workouts."""

from __future__ import annotations

from fastapi import APIRouter

from app.routers.health_data import activity, body, care_sports, injuries, mental, workouts

router = APIRouter(prefix="/health-data", tags=["health-data"])
for _module in (activity, care_sports, mental, body, injuries, workouts):
    router.include_router(_module.router)
