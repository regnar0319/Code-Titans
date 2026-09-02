"""Stateful WebSocket telemetry gateway for Laksha dispatch consoles."""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

TOPICS = {"mesh:hops", "mesh:incidents", "mesh:nodes"}
HEARTBEAT_SECONDS = 5
PONG_TIMEOUT_SECONDS = 10
QUEUE_SIZE = 256


@dataclass(slots=True)
class ClientSession:
    """Mutable state associated with one connected dispatcher console."""

    websocket: WebSocket
    session_id: str
    subscriptions: set[str] = field(default_factory=set)
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=lambda: asyncio.Queue(QUEUE_SIZE))
    last_pong: float = field(default_factory=time.monotonic)


class WebSocketChannelManager:
    """Async in-memory pub/sub broker with replayable monotonic event sequencing."""

    def __init__(self) -> None:
        self._sessions: dict[str, ClientSession] = {}
        self._history: deque[dict[str, Any]] = deque(maxlen=100)
        self._sequence = 0
        self._lock = asyncio.Lock()
        self._heartbeat_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the manager heartbeat loop; safe to call more than once."""
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self) -> None:
        """Stop background heartbeats and close tracked sessions."""
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._heartbeat_task
            self._heartbeat_task = None
        async with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            with contextlib.suppress(Exception):
                await session.websocket.close(code=1001)

    async def connect(
        self,
        websocket: WebSocket,
        session_id: str | None = None,
        last_received_seq: int = 0,
        subscriptions: list[str] | None = None,
    ) -> ClientSession:
        """Replay retained events, then attach an already-accepted socket to live topics."""
        requested = set(subscriptions or TOPICS) & TOPICS
        session = ClientSession(websocket, session_id or uuid.uuid4().hex, requested)
        async with self._lock:
            self._sessions[session.session_id] = session
            replay = [
                event for event in self._history
                if event["sequence"] > last_received_seq and event["topic"] in requested
            ]
            for event in replay:
                self._enqueue(session, event)
        return session

    async def disconnect(self, session_id: str) -> None:
        """Remove a session without affecting other dispatch consoles."""
        async with self._lock:
            self._sessions.pop(session_id, None)

    async def subscribe(self, session_id: str, topic: str) -> None:
        if topic not in TOPICS:
            return
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.subscriptions.add(topic)

    async def unsubscribe(self, session_id: str, topic: str) -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.subscriptions.discard(topic)

    async def publish(self, topic: str, event_type: str, data: dict[str, Any]) -> dict[str, Any]:
        """Sequence, retain, and fan out one topic event to subscribed clients."""
        if topic not in TOPICS:
            raise ValueError(f"unsupported telemetry topic: {topic}")
        async with self._lock:
            self._sequence += 1
            event = {
                "topic": topic,
                "type": event_type,
                "sequence": self._sequence,
                **data,
            }
            self._history.append(event)
            stale: list[str] = []
            for session_id, session in self._sessions.items():
                if topic in session.subscriptions and not self._enqueue(session, event):
                    # Critical incident/node events are never silently discarded.
                    if self._is_critical(event):
                        stale.append(session_id)
            for session_id in stale:
                self._sessions.pop(session_id, None)
            return event

    def _enqueue(self, session: ClientSession, event: dict[str, Any]) -> bool:
        try:
            session.queue.put_nowait(event)
            return True
        except asyncio.QueueFull:
            if event["topic"] == "mesh:hops" and self._drop_oldest_hop(session):
                session.queue.put_nowait(event)
                return True
            return False

    @staticmethod
    def _drop_oldest_hop(session: ClientSession) -> bool:
        items: list[dict[str, Any]] = []
        removed = False
        while not session.queue.empty():
            item = session.queue.get_nowait()
            if not removed and item.get("topic") == "mesh:hops":
                removed = True
                continue
            items.append(item)
        for item in items:
            session.queue.put_nowait(item)
        return removed

    @staticmethod
    def _is_critical(event: dict[str, Any]) -> bool:
        return event["topic"] == "mesh:incidents" or event["topic"] == "mesh:nodes"

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            now = time.monotonic()
            async with self._lock:
                sessions = list(self._sessions.values())
                for session in sessions:
                    if now - session.last_pong > PONG_TIMEOUT_SECONDS:
                        self._sessions.pop(session.session_id, None)
                        with contextlib.suppress(Exception):
                            await session.websocket.close(code=1001)
                        continue
                    heartbeat = {
                        "type": "HEARTBEAT",
                        "server_time": int(time.time() * 1000),
                        "active_connections": len(self._sessions),
                    }
                    with contextlib.suppress(asyncio.QueueFull):
                        session.queue.put_nowait(heartbeat)

    async def serve(self, session: ClientSession) -> None:
        """Drain one session's queue to the socket until the client disconnects."""
        while True:
            await session.websocket.send_json(await session.queue.get())


manager = WebSocketChannelManager()


@router.websocket("/ws/telemetry")
async def telemetry_socket(websocket: WebSocket) -> None:
    """Handle RESUME handshake, client commands, and ordered event delivery."""
    await manager.start()
    session: ClientSession | None = None
    sender: asyncio.Task[None] | None = None
    try:
        await websocket.accept()
        handshake = await websocket.receive_json()
        if handshake.get("action") != "RESUME":
            await websocket.close(code=1008, reason="RESUME handshake required")
            return
        session = await manager.connect(
            websocket,
            handshake.get("session_id"),
            max(0, int(handshake.get("last_seq", 0))),
            handshake.get("subscriptions"),
        )
        await websocket.send_json({"type": "SESSION_READY", "session_id": session.session_id})
        sender = asyncio.create_task(manager.serve(session))
        while True:
            message = await websocket.receive_json()
            action = message.get("action")
            if action == "PONG":
                session.last_pong = time.monotonic()
            elif action == "SUBSCRIBE":
                await manager.subscribe(session.session_id, str(message.get("topic", "")))
            elif action == "UNSUBSCRIBE":
                await manager.unsubscribe(session.session_id, str(message.get("topic", "")))
    except (WebSocketDisconnect, ValueError, TypeError):
        pass
    finally:
        if sender:
            sender.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sender
        if session:
            await manager.disconnect(session.session_id)


async def broadcast_telemetry(topic: str, event_type: str, data: dict[str, Any]) -> dict[str, Any]:
    """Publish telemetry from RF simulation or any other background task."""
    return await manager.publish(topic, event_type, data)
