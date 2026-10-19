from app.tools.registry import tools_registry


def test_count_numbers_starting_with():
    lines = ["912, 850, 93", "12 999 450", "9"]
    res1 = tools_registry.execute("count_numbers_starting_with", lines[:1], {"prefix": "9"})
    res2 = tools_registry.execute("count_numbers_starting_with", lines[1:], {"prefix": "9"})
    assert res1 == 2
    assert res2 == 2
    merged = tools_registry.merge("count_numbers_starting_with", [res1, res2])
    assert merged == 4


def test_count_numbers_matching():
    lines = ["10, 15, 20", "25, 30, 35"]
    even_count = tools_registry.execute("count_numbers_matching", lines, {"predicate": "even"})
    assert even_count == 3

    gt_count = tools_registry.execute(
        "count_numbers_matching", lines, {"predicate": "gt", "value": 20}
    )
    assert gt_count == 3


def test_sum_numbers():
    lines1 = ["10 20.5"]
    lines2 = ["30 40"]
    r1 = tools_registry.execute("sum_numbers", lines1, {})
    r2 = tools_registry.execute("sum_numbers", lines2, {})
    merged = tools_registry.merge("sum_numbers", [r1, r2])
    assert merged == 100.5


def test_min_max_numbers():
    lines1 = ["15, 5, 45"]
    lines2 = ["100, -2, 50"]
    r1 = tools_registry.execute("min_max_numbers", lines1, {})
    r2 = tools_registry.execute("min_max_numbers", lines2, {})
    merged = tools_registry.merge("min_max_numbers", [r1, r2])
    assert merged["min"] == -2
    assert merged["max"] == 100


def test_count_rows_where():
    csv_lines = [
        "name,status,age",
        "Alice,active,25",
        "Bob,inactive,30",
        "Charlie,active,35",
    ]
    count = tools_registry.execute(
        "count_rows_where", csv_lines, {"column": "status", "op": "eq", "value": "active"}
    )
    assert count == 2


def test_group_count():
    csv_lines = [
        "city,sales",
        "NY,100",
        "LA,200",
        "NY,150",
    ]
    counts = tools_registry.execute("group_count", csv_lines, {"column": "city"})
    assert counts["NY"] == 2
    assert counts["LA"] == 1


def test_top_n_words_and_word_count():
    lines = ["apple banana apple orange", "banana apple kiwi"]
    words = tools_registry.execute("top_n_words", lines, {"n": 5})
    assert words["apple"] == 3
    assert words["banana"] == 2

    wc = tools_registry.execute("word_count", lines, {})
    assert wc == 7
