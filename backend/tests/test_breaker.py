import time

from app.nodes.breaker import CircuitBreaker


def test_circuit_breaker_transitions():
    cb = CircuitBreaker(failure_threshold=3, cooldown_seconds=0.1)
    assert cb.state == "healthy"
    assert cb.can_attempt() is True

    # 1 failure -> degraded
    cb.record_failure()
    assert cb.state == "degraded"
    assert cb.can_attempt() is True

    # 2nd failure
    cb.record_failure()
    assert cb.state == "degraded"

    # 3rd failure -> crashed (open)
    cb.record_failure()
    assert cb.state == "crashed"
    assert cb.can_attempt() is False

    # Wait for cooldown
    time.sleep(0.12)
    # Next attempt half-opens to recovering
    assert cb.can_attempt() is True
    assert cb.state == "recovering"

    # Success in recovering resets to healthy
    cb.record_success()
    assert cb.state == "healthy"
    assert cb.consecutive_failures == 0


def test_circuit_breaker_fatal_failure():
    cb = CircuitBreaker()
    cb.record_failure(is_fatal=True)
    assert cb.state == "unavailable"
    assert cb.can_attempt() is False
