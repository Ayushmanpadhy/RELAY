import pytest
from app.tools.registry import tools_registry
from app.pipeline.planner import create_plan
from app.models import Manifest, FileManifest
from app.providers.registry import registry


# ==========================================
# Category 1: Counting and Arithmetic (Exact Tools)
# ==========================================
def test_golden_counting_starts_with():
    numbers = [str(i) for i in range(1, 10001)]
    # Count how many start with '7'
    expected = sum(1 for n in numbers if n.startswith("7"))
    out = tools_registry.execute("count_numbers_starting_with", numbers, {"prefix": "7"})
    assert out == expected, f"Expected {expected}, got {out}"


def test_golden_counting_divisible_by():
    numbers = [str(i) for i in range(1, 10001)]
    # Count how many are divisible by 17
    expected = sum(1 for n in numbers if int(n) % 17 == 0)
    out = tools_registry.execute("count_numbers_matching", numbers, {"predicate": "divisible_by", "value": 17})
    assert out == expected, f"Expected {expected}, got {out}"


def test_golden_sum():
    numbers = [str(i) for i in range(1, 1001)]
    expected = float(sum(range(1, 1001)))
    out = tools_registry.execute("sum_numbers", numbers, {})
    assert out == expected, f"Expected {expected}, got {out}"


def test_golden_min_max():
    numbers = ["42", "-199", "10050", "0", "99", "-4000", "50000"]
    out = tools_registry.execute("min_max_numbers", numbers, {})
    assert out["min"] == -4000.0
    assert out["max"] == 50000.0


# ==========================================
# Category 2: Text Statistics (Exact Tools)
# ==========================================
def test_golden_word_count():
    text_lines = [
        "The quick brown fox jumps over the lazy dog.",
        "A journey of a thousand miles begins with a single step.",
        "Relay distributed task scheduler execution verification.",
    ]
    total_words = sum(len(line.split()) for line in text_lines)
    out = tools_registry.execute("word_count", text_lines, {})
    assert out == total_words


def test_golden_top_n_words():
    text_lines = [
        "apple banana apple orange apple",
        "banana kiwi apple orange",
        "apple pear banana apple",
    ]
    expected_apple = 6
    expected_banana = 3
    out = tools_registry.execute("top_n_words", text_lines, {"n": 5})
    assert out.get("apple") == expected_apple
    assert out.get("banana") == expected_banana


# ==========================================
# Category 3: CSV & Tabular Operations
# ==========================================
def test_golden_csv_count_where():
    rows = [
        "id,country,amount",
        "1,IN,500",
        "2,US,1200",
        "3,IN,750",
        "4,DE,300",
        "5,IN,150",
    ]
    out = tools_registry.execute("count_rows_where", rows, {"column": "country", "op": "eq", "value": "IN"})
    assert out == 3


def test_golden_csv_group_count():
    rows = [
        "id,status,score",
        "101,active,95",
        "102,pending,40",
        "103,active,88",
        "104,disabled,20",
        "105,active,91",
    ]
    out = tools_registry.execute("group_count", rows, {"column": "status"})
    assert out.get("active") == 3
    assert out.get("pending") == 1
    assert out.get("disabled") == 1


def test_golden_csv_dedupe():
    rows = [
        "alice@relay.test",
        "bob@relay.test",
        "alice@relay.test",
        "charlie@relay.test",
        "bob@relay.test",
    ]
    out = tools_registry.execute("dedupe_rows", rows, {})
    assert len(out) == 3
    assert set(out) == {"alice@relay.test", "bob@relay.test", "charlie@relay.test"}


def test_golden_csv_to_json():
    rows = [
        "id,city",
        "1,Tokyo",
        "2,Berlin",
    ]
    out = tools_registry.execute("csv_to_json", rows, {})
    assert len(out) == 2
    assert out[0] == {"id": "1", "city": "Tokyo"}
    assert out[1] == {"id": "2", "city": "Berlin"}


# ==========================================
# Category 4: Planner Invariants & Intent
# ==========================================
@pytest.mark.asyncio
async def test_golden_planner_exact_mode_intent():
    manifest = Manifest(
        files=[FileManifest(name="numbers.txt", type="txt", bytes=5000, units=1000, unitKind="numbers", preview="1\n2\n3")],
        totalUnits=1000,
        unitKind="numbers",
        summary="1 file, 1,000 numbers",
    )
    plan = await create_plan("How many numbers in this file start with 9?", manifest)
    assert plan.mode == "exact"
    assert plan.tool in ("count_numbers_starting_with", "count_numbers_matching")


@pytest.mark.asyncio
async def test_golden_planner_sum_intent():
    manifest = Manifest(
        files=[FileManifest(name="amounts.txt", type="txt", bytes=5000, units=500, unitKind="numbers", preview="10\n20\n30")],
        totalUnits=500,
        unitKind="numbers",
        summary="1 file, 500 numbers",
    )
    plan = await create_plan("Calculate the total sum of all numbers in the list", manifest)
    assert plan.mode == "exact"
    assert plan.tool == "sum_numbers"


@pytest.mark.asyncio
async def test_golden_planner_ambiguous_prompt():
    manifest = Manifest(
        files=[FileManifest(name="data.txt", type="txt", bytes=1000, units=50, unitKind="lines", preview="Sample text")],
        totalUnits=50,
        unitKind="lines",
        summary="1 file, 50 lines",
    )
    plan = await create_plan("fix it please", manifest)
    assert len(plan.clarifyingQuestions) > 0, "Ambiguous prompt must produce clarifying questions"


@pytest.mark.asyncio
async def test_golden_planner_indivisible_task():
    manifest = Manifest(
        files=[FileManifest(name="small.txt", type="txt", bytes=100, units=3, unitKind="lines", preview="A\nB\nC")],
        totalUnits=3,
        unitKind="lines",
        summary="1 file, 3 lines",
    )
    plan = await create_plan("Summarize this tiny note", manifest)
    assert plan.partCount <= 3, "Indivisible task (<10 units) must have partCount <= totalUnits"
    assert "smaller than minimum batch" in plan.partCountReason
