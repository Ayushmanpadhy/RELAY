import csv
import re
from typing import Any, Callable

from pydantic import BaseModel


class ToolDefinition(BaseModel):
    name: str
    description: str
    args_schema: dict[str, Any]


class ToolsRegistry:
    def __init__(self) -> None:
        self.definitions: dict[str, ToolDefinition] = {}
        self.executors: dict[str, Callable[[list[str], dict[str, Any]], Any]] = {}
        self.mergers: dict[str, Callable[[list[Any]], Any]] = {}
        self._register_default_tools()

    def register(
        self,
        name: str,
        description: str,
        args_schema: dict[str, Any],
        executor: Callable[[list[str], dict[str, Any]], Any],
        merger: Callable[[list[Any]], Any],
    ) -> None:
        self.definitions[name] = ToolDefinition(
            name=name,
            description=description,
            args_schema=args_schema,
        )
        self.executors[name] = executor
        self.mergers[name] = merger

    def get_tool_descriptions(self) -> list[dict[str, Any]]:
        return [
            {
                "name": t.name,
                "description": t.description,
                "args_schema": t.args_schema,
            }
            for t in self.definitions.values()
        ]

    def execute(self, tool_name: str, data_lines: list[str], args: dict[str, Any]) -> Any:
        if tool_name not in self.executors:
            raise ValueError(f"Unknown exact tool: {tool_name}")
        return self.executors[tool_name](data_lines, args)

    def merge(self, tool_name: str, part_results: list[Any]) -> Any:
        if tool_name not in self.mergers:
            raise ValueError(f"Unknown merge function for tool: {tool_name}")
        return self.mergers[tool_name](part_results)

    def _register_default_tools(self) -> None:
        # 1. count_numbers_starting_with
        def exec_count_prefix(lines: list[str], args: dict[str, Any]) -> int:
            prefix = str(args.get("prefix", "9")).strip()
            count = 0
            for line in lines:
                for token in line.replace(",", " ").split():
                    clean = token.strip()
                    if clean and clean.lstrip("+-").startswith(prefix):
                        count += 1
            return count

        def merge_sum(results: list[Any]) -> int:
            return sum(int(r) for r in results if r is not None)

        self.register(
            name="count_numbers_starting_with",
            description="Count how many numbers start with a given digit or prefix (e.g. '9')",
            args_schema={
                "type": "object",
                "properties": {"prefix": {"type": "string"}},
                "required": ["prefix"],
            },
            executor=exec_count_prefix,
            merger=merge_sum,
        )

        # 2. count_numbers_matching
        def exec_count_matching(lines: list[str], args: dict[str, Any]) -> int:
            predicate = args.get("predicate", "even")
            target_val = float(args.get("value", 0)) if "value" in args else 0.0
            count = 0
            for line in lines:
                for token in line.replace(",", " ").split():
                    try:
                        num = float(token.strip())
                        if predicate == "gt" and num > target_val:
                            count += 1
                        elif predicate == "lt" and num < target_val:
                            count += 1
                        elif predicate == "eq" and num == target_val:
                            count += 1
                        elif predicate == "even" and num.is_integer() and int(num) % 2 == 0:
                            count += 1
                        elif predicate == "odd" and num.is_integer() and int(num) % 2 != 0:
                            count += 1
                        elif (
                            predicate == "divisible_by"
                            and target_val != 0
                            and num.is_integer()
                            and int(num) % int(target_val) == 0
                        ):
                            count += 1
                    except (ValueError, TypeError):
                        pass
            return count

        self.register(
            name="count_numbers_matching",
            description="Count numbers matching a predicate: gt, lt, eq, even, odd, divisible_by",
            args_schema={
                "type": "object",
                "properties": {
                    "predicate": {
                        "type": "string",
                        "enum": ["gt", "lt", "eq", "even", "odd", "divisible_by"],
                    },
                    "value": {"type": "number"},
                },
                "required": ["predicate"],
            },
            executor=exec_count_matching,
            merger=merge_sum,
        )

        # 3. sum_numbers
        def exec_sum_numbers(lines: list[str], args: dict[str, Any]) -> float:
            total = 0.0
            for line in lines:
                for token in line.replace(",", " ").split():
                    try:
                        total += float(token.strip())
                    except ValueError:
                        pass
            return total

        def merge_float_sum(results: list[Any]) -> float:
            return round(sum(float(r) for r in results if r is not None), 6)

        self.register(
            name="sum_numbers",
            description="Calculate the exact sum of all numbers in the input",
            args_schema={"type": "object", "properties": {}},
            executor=exec_sum_numbers,
            merger=merge_float_sum,
        )

        # 4. min_max_numbers
        def exec_min_max(lines: list[str], args: dict[str, Any]) -> dict[str, float | None]:
            min_val: float | None = None
            max_val: float | None = None
            for line in lines:
                for token in line.replace(",", " ").split():
                    try:
                        num = float(token.strip())
                        if min_val is None or num < min_val:
                            min_val = num
                        if max_val is None or num > max_val:
                            max_val = num
                    except ValueError:
                        pass
            return {"min": min_val, "max": max_val}

        def merge_min_max(results: list[Any]) -> dict[str, float | None]:
            overall_min: float | None = None
            overall_max: float | None = None
            for r in results:
                if not r or not isinstance(r, dict):
                    continue
                rmin = r.get("min")
                rmax = r.get("max")
                if rmin is not None and (overall_min is None or rmin < overall_min):
                    overall_min = rmin
                if rmax is not None and (overall_max is None or rmax > overall_max):
                    overall_max = rmax
            return {"min": overall_min, "max": overall_max}

        self.register(
            name="min_max_numbers",
            description="Find minimum and maximum numbers",
            args_schema={"type": "object", "properties": {}},
            executor=exec_min_max,
            merger=merge_min_max,
        )

        # 5. count_rows_where
        def exec_count_rows_where(lines: list[str], args: dict[str, Any]) -> int:
            col = args.get("column", "")
            op = args.get("op", "eq")
            val = str(args.get("value", "")).lower()
            count = 0
            if not lines:
                return 0
            reader = csv.DictReader(lines)
            for row in reader:
                cell = str(row.get(col, "")).lower()
                if op == "eq" and cell == val:
                    count += 1
                elif op == "contains" and val in cell:
                    count += 1
                elif op == "gt":
                    try:
                        if float(cell) > float(val):
                            count += 1
                    except ValueError:
                        pass
                elif op == "lt":
                    try:
                        if float(cell) < float(val):
                            count += 1
                    except ValueError:
                        pass
                elif op == "not_empty" and bool(cell.strip()):
                    count += 1
                elif op == "empty" and not bool(cell.strip()):
                    count += 1
            return count

        self.register(
            name="count_rows_where",
            description="Count tabular CSV rows where column matches operator and value",
            args_schema={
                "type": "object",
                "properties": {
                    "column": {"type": "string"},
                    "op": {
                        "type": "string",
                        "enum": ["eq", "contains", "gt", "lt", "not_empty", "empty"],
                    },
                    "value": {"type": "string"},
                },
                "required": ["column", "op"],
            },
            executor=exec_count_rows_where,
            merger=merge_sum,
        )

        # 6. group_count
        def exec_group_count(lines: list[str], args: dict[str, Any]) -> dict[str, int]:
            col = args.get("column", "")
            counts: dict[str, int] = {}
            if not lines:
                return counts
            reader = csv.DictReader(lines)
            for row in reader:
                cell = str(row.get(col, "")).strip()
                if cell:
                    counts[cell] = counts.get(cell, 0) + 1
            return counts

        def merge_group_count(results: list[Any]) -> dict[str, int]:
            total: dict[str, int] = {}
            for r in results:
                if isinstance(r, dict):
                    for k, v in r.items():
                        total[k] = total.get(k, 0) + int(v)
            return dict(sorted(total.items(), key=lambda x: x[1], reverse=True))

        self.register(
            name="group_count",
            description="Count frequencies of values in a specific CSV column",
            args_schema={
                "type": "object",
                "properties": {"column": {"type": "string"}},
                "required": ["column"],
            },
            executor=exec_group_count,
            merger=merge_group_count,
        )

        # 7. top_n_words
        def exec_top_n_words(lines: list[str], args: dict[str, Any]) -> dict[str, int]:
            counts: dict[str, int] = {}
            for line in lines:
                words = re.findall(r"\b[a-zA-Z]{3,}\b", line.lower())
                for w in words:
                    counts[w] = counts.get(w, 0) + 1
            return counts

        def merge_top_n(results: list[Any]) -> dict[str, int]:
            total: dict[str, int] = {}
            for r in results:
                if isinstance(r, dict):
                    for k, v in r.items():
                        total[k] = total.get(k, 0) + int(v)
            sorted_items = sorted(total.items(), key=lambda x: x[1], reverse=True)
            return dict(sorted_items[:50])

        self.register(
            name="top_n_words",
            description="Find most frequent words across documents",
            args_schema={"type": "object", "properties": {"n": {"type": "integer", "default": 10}}},
            executor=exec_top_n_words,
            merger=merge_top_n,
        )

        # 8. word_count
        def exec_word_count(lines: list[str], args: dict[str, Any]) -> int:
            count = 0
            for line in lines:
                count += len(line.split())
            return count

        self.register(
            name="word_count",
            description="Count total words in text files",
            args_schema={"type": "object", "properties": {}},
            executor=exec_word_count,
            merger=merge_sum,
        )

        # 9. dedupe_rows
        def exec_dedupe_rows(lines: list[str], args: dict[str, Any]) -> list[str]:
            seen: set[str] = set()
            out: list[str] = []
            for line in lines:
                s = line.strip()
                if s and s not in seen:
                    seen.add(s)
                    out.append(s)
            return out

        def merge_dedupe(results: list[Any]) -> list[str]:
            seen: set[str] = set()
            out: list[str] = []
            for r in results:
                if isinstance(r, list):
                    for item in r:
                        if item not in seen:
                            seen.add(item)
                            out.append(item)
            return out

        self.register(
            name="dedupe_rows",
            description="Remove duplicate rows or items",
            args_schema={"type": "object", "properties": {}},
            executor=exec_dedupe_rows,
            merger=merge_dedupe,
        )

        # 10. csv_to_json
        def exec_csv_to_json(lines: list[str], args: dict[str, Any]) -> list[dict[str, Any]]:
            if not lines:
                return []
            reader = csv.DictReader(lines)
            return list(reader)

        def merge_concat_lists(results: list[Any]) -> list[Any]:
            out: list[Any] = []
            for r in results:
                if isinstance(r, list):
                    out.extend(r)
            return out

        self.register(
            name="csv_to_json",
            description="Convert CSV rows to structured JSON array",
            args_schema={"type": "object", "properties": {}},
            executor=exec_csv_to_json,
            merger=merge_concat_lists,
        )


tools_registry = ToolsRegistry()
