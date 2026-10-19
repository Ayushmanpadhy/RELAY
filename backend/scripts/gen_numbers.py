import os
import random
from pathlib import Path


def generate_numbers(count: int = 100_000, output_path: str = "data/numbers_100k.txt") -> tuple[int, int]:
    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    # Use a fixed seed for reproducible ground truth
    random.seed(42)

    count_starting_with_9 = 0
    with open(out_file, "w", encoding="utf-8") as f:
        for _ in range(count):
            num = random.randint(1, 999_999)
            num_str = str(num)
            if num_str.startswith("9"):
                count_starting_with_9 += 1
            f.write(f"{num_str}\n")

    print(f"Generated {count:,} numbers saved to {out_file.resolve()}")
    print(f"GROUND TRUTH: Exactly {count_starting_with_9:,} numbers start with '9'.")
    return count, count_starting_with_9


if __name__ == "__main__":
    generate_numbers()
