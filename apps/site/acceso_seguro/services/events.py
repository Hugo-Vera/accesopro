import asyncio
import logging
from typing import Any

logger = logging.getLogger("events")

class EventDispatcher:
    def __init__(self):
        self._queues: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._queues:
            self._queues.remove(q)

    def dispatch(self, event_type: str, payload: dict[str, Any]) -> None:
        message = {"type": event_type, "payload": payload}
        logger.debug(f"Disparando evento {event_type} a {len(self._queues)} clientes")
        for q in self._queues:
            # Poner en la cola sin bloquear (usando put_nowait)
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                pass

dispatcher = EventDispatcher()
