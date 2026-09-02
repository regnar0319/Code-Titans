"""Runnable FastAPI application for the Laksha telemetry gateway."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from .websocket_manager import manager, router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Start and stop the shared heartbeat task with the application."""
    await manager.start()
    try:
        yield
    finally:
        await manager.stop()


app = FastAPI(title="Laksha Telemetry Gateway", lifespan=lifespan)
app.include_router(router)