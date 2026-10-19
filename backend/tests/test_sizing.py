from app.models import FileManifest, Manifest
from app.pipeline.planner import calculate_part_count


def test_sizing_tiny_input():
    manifest = Manifest(
        files=[
            FileManifest(
                name="test.txt", type="txt", bytes=100, units=4, unitKind="lines", preview=""
            )
        ],
        totalUnits=4,
        unitKind="lines",
    )
    parts, reason = calculate_part_count(manifest, mode="ai")
    assert parts == 4
    assert "smaller than minimum batch" in reason


def test_sizing_exact_100k_numbers():
    manifest = Manifest(
        files=[
            FileManifest(
                name="numbers.txt",
                type="txt",
                bytes=1000000,
                units=100000,
                unitKind="numbers",
                preview="",
            )
        ],
        totalUnits=100000,
        unitKind="numbers",
    )
    parts, reason = calculate_part_count(manifest, mode="exact")
    # 100,000 / 1,000 = 100 -> clamped to 100
    assert parts == 100


def test_sizing_clamp_10_minimum():
    manifest = Manifest(
        files=[
            FileManifest(
                name="data.csv", type="csv", bytes=5000, units=25, unitKind="rows", preview=""
            )
        ],
        totalUnits=25,
        unitKind="rows",
    )
    parts, reason = calculate_part_count(manifest, mode="exact")
    # 25 / 1000 = 1 -> clamped to min 10
    assert parts == 10


def test_sizing_clamp_100_maximum():
    manifest = Manifest(
        files=[
            FileManifest(
                name="huge.txt",
                type="txt",
                bytes=50000000,
                units=500000,
                unitKind="numbers",
                preview="",
            )
        ],
        totalUnits=500000,
        unitKind="numbers",
    )
    parts, reason = calculate_part_count(manifest, mode="exact")
    # 500,000 / 1000 = 500 -> clamped to max 100
    assert parts == 100
