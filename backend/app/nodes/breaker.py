import time
from typing import Literal

CircuitState = Literal["healthy", "degraded", "crashed", "recovering", "unavailable"]


class CircuitBreaker:
    def __init__(self, failure_threshold: int = 3, cooldown_seconds: float = 30.0) -> None:
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self.state: CircuitState = "healthy"
        self.consecutive_failures = 0
        self.last_failure_time: float = 0.0
        self.probe_in_flight = False

    def can_attempt(self) -> bool:
        now = time.time()
        if self.state in ("healthy", "degraded"):
            return True
        if self.state == "crashed":
            if now - self.last_failure_time >= self.cooldown_seconds:
                # Transition to recovering (half-open)
                self.state = "recovering"
                self.probe_in_flight = True
                return True
            return False
        if self.state == "recovering":
            if not self.probe_in_flight:
                self.probe_in_flight = True
                return True
            return False
        # unavailable
        return False

    def record_success(self) -> None:
        self.consecutive_failures = 0
        self.probe_in_flight = False
        if self.state in ("crashed", "recovering", "degraded"):
            self.state = "healthy"

    def record_failure(self, is_fatal: bool = False) -> None:
        self.probe_in_flight = False
        self.last_failure_time = time.time()
        if is_fatal:
            self.state = "unavailable"
            return

        self.consecutive_failures += 1
        if self.consecutive_failures >= self.failure_threshold or self.state == "recovering":
            self.state = "crashed"
        else:
            self.state = "degraded"

    def reset(self) -> None:
        self.state = "healthy"
        self.consecutive_failures = 0
        self.probe_in_flight = False
