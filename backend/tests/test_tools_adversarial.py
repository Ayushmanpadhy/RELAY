from app.tools.registry import tools_registry


def test_adversarial_numbers_starting_with():
    adversarial_inputs = [
        "9",
        "900",
        "09",  # starts with 0
        "-90",  # negative
        "9.5",  # decimal
        "9e5",  # scientific notation
        "",  # empty
        "   ",  # spaces
        "nine",  # word
        "90000000000000000000000000000000",  # huge number
    ]

    res = tools_registry.execute("count_numbers_starting_with", adversarial_inputs, {"prefix": "9"})
    # "9", "900", "-90", "9.5", "9e5", and huge number start with 9
    assert res == 6


def test_adversarial_numbers_matching_predicates():
    numbers = ["10", "-5", "0", "15", "100", "abc", "", "20.5"]

    # greater than 10
    gt_res = tools_registry.execute(
        "count_numbers_matching", numbers, {"predicate": "gt", "value": 10}
    )
    assert gt_res == 3  # 15, 100, 20.5

    # even numbers (whole numbers only)
    even_res = tools_registry.execute("count_numbers_matching", numbers, {"predicate": "even"})
    assert even_res == 3  # 10, 0, 100

    # odd numbers (whole numbers only)
    odd_res = tools_registry.execute("count_numbers_matching", numbers, {"predicate": "odd"})
    assert odd_res == 2  # -5, 15


def test_adversarial_sum_numbers():
    numbers = ["10.5", "-5.5", "0", "100", "", "invalid", "25"]
    res = tools_registry.execute("sum_numbers", numbers, {})
    assert res == 130.0

    # Merge sum
    merged = tools_registry.merge("sum_numbers", [130.0, 70.0, -10.0])
    assert merged == 190.0


def test_adversarial_min_max():
    numbers = ["-100", "0", "500", "42.5", "-999.9", "text"]
    res = tools_registry.execute("min_max_numbers", numbers, {})
    assert res["min"] == -999.9
    assert res["max"] == 500.0

    # Empty inputs return None
    empty_res = tools_registry.execute("min_max_numbers", ["", "  ", "text"], {})
    assert empty_res["min"] is None
    assert empty_res["max"] is None


def test_adversarial_csv_empty_rows():
    csv_data = [
        "name,age,city",
        ",,",
        "Alice,30,Bangalore",
        "",
        "Bob,,Mumbai",
    ]
    # Filter non-empty
    count = tools_registry.execute(
        "count_rows_where", csv_data, {"column": "name", "op": "not_empty"}
    )
    assert count == 2  # Alice and Bob
