"""Preprocess emergency telemetry into Laksha protocol payloads.

The generated JSONL records use the field names and ranges expected by
`lib/protocol/frame.ts` before they are serialized into 16-byte frames.

Examples:
    python src/preprocess.py reports.csv payloads.jsonl
    python src/preprocess.py reports.jsonl payloads.jsonl --rejects invalid.jsonl
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

TRIAGE_TYPES = {
    "UNSET": 0,
    "MEDICAL": 1,
    "LOST": 2,
    "AVALANCHE": 3,
    "TRAPPED": 4,
}
MAX_NODE_ID = 0xFFFFFFFF
MAX_TTL = 7


class ValidationError(ValueError):
    """Raised when an input record cannot be represented by the protocol."""


@dataclass(frozen=True)
class PreprocessSummary:
    """Counts produced by :func:`preprocess`."""

    accepted: int
    rejected: int


def _first_value(record: Mapping[str, Any], *names: str) -> Any:
    normalized = {str(key).strip().lower(): value for key, value in record.items()}
    for name in names:
        value = normalized.get(name.lower())
        if value not in (None, ""):
            return value
    return None


def _as_int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise ValidationError(f"{field} must be an integer, not a boolean")
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be an integer") from exc
    return number


def _as_float(value: Any, field: str) -> float:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field} must be a number") from exc
    if not math.isfinite(number):
        raise ValidationError(f"{field} must be finite")
    return number


def _as_bool(value: Any, field: str, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)

    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    raise ValidationError(f"{field} must be a boolean")


def _as_triage(value: Any) -> int:
    if value in (None, ""):
        return TRIAGE_TYPES["UNSET"]

    if isinstance(value, str):
        named_type = TRIAGE_TYPES.get(value.strip().upper())
        if named_type is not None:
            return named_type

    triage = _as_int(value, "triageType")
    if triage not in TRIAGE_TYPES.values():
        raise ValidationError("triageType must be UNSET, MEDICAL, LOST, AVALANCHE, TRAPPED, or 0-4")
    return triage


def normalize_record(record: Mapping[str, Any], default_node_id: int | None = None) -> dict[str, Any]:
    """Validate and normalize one source record into a FramePayload-compatible mapping.

    Accepted aliases include `node_id`, `lat`, `lng`, `battery`,
    `triage`, `conscious`, and `is_group`. Coordinates are rounded to
    the protocol's micro-degree precision; all other invalid values reject the
    row instead of being silently coerced.
    """
    node_raw = _first_value(record, "nodeId", "node_id", "deviceId", "device_id")
    if node_raw in (None, ""):
        node_raw = default_node_id
    if node_raw is None:
        raise ValidationError("nodeId is required (or supply --default-node-id)")

    node_id = _as_int(node_raw, "nodeId")
    latitude = _as_float(_first_value(record, "latitude", "lat"), "latitude")
    longitude = _as_float(_first_value(record, "longitude", "lng", "lon"), "longitude")
    battery_percent = _as_float(
        _first_value(record, "batteryPercent", "battery_percent", "battery"),
        "batteryPercent",
    )
    ttl = _as_int(_first_value(record, "ttl", "hopLimit", "hop_limit"), "ttl")

    if not 0 <= node_id <= MAX_NODE_ID:
        raise ValidationError(f"nodeId must be in 0..{MAX_NODE_ID}")
    if not -90 <= latitude <= 90:
        raise ValidationError("latitude must be in -90..90")
    if not -180 <= longitude <= 180:
        raise ValidationError("longitude must be in -180..180")
    if not 0 <= battery_percent <= 100:
        raise ValidationError("batteryPercent must be in 0..100")
    if not 0 <= ttl <= MAX_TTL:
        raise ValidationError(f"ttl must be in 0..{MAX_TTL}")

    return {
        "nodeId": node_id,
        "latitude": round(latitude, 6),
        "longitude": round(longitude, 6),
        "triageType": _as_triage(_first_value(record, "triageType", "triage", "emergencyType")),
        "isConscious": _as_bool(_first_value(record, "isConscious", "is_conscious", "conscious"), "isConscious"),
        "groupCount": _as_bool(_first_value(record, "groupCount", "group_count", "isGroup", "is_group"), "groupCount"),
        "batteryPercent": battery_percent,
        "ttl": ttl,
    }


def _input_records(source: TextIO, input_format: str) -> Iterator[tuple[int, Mapping[str, Any]]]:
    if input_format == "csv":
        for line_number, row in enumerate(csv.DictReader(source), start=2):
            yield line_number, row
        return

    for line_number, line in enumerate(source, start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"line {line_number}: invalid JSON: {exc.msg}") from exc
        if not isinstance(record, Mapping):
            raise ValidationError(f"line {line_number}: JSON record must be an object")
        yield line_number, record


def preprocess(
    source: TextIO,
    destination: TextIO,
    *,
    input_format: str,
    rejects: TextIO | None = None,
    default_node_id: int | None = None,
) -> PreprocessSummary:
    """Transform source records, writing accepted payloads and optional rejections as JSONL."""
    accepted = rejected = 0
    for line_number, record in _input_records(source, input_format):
        try:
            payload = normalize_record(record, default_node_id)
        except ValidationError as exc:
            rejected += 1
            if rejects is not None:
                json.dump({"line": line_number, "error": str(exc), "record": record}, rejects, sort_keys=True)
                rejects.write("\n")
            continue

        json.dump(payload, destination, sort_keys=True, separators=(",", ":"))
        destination.write("\n")
        accepted += 1
    return PreprocessSummary(accepted=accepted, rejected=rejected)


def _detect_format(path: Path) -> str:
    if path.suffix.lower() == ".csv":
        return "csv"
    if path.suffix.lower() in {".jsonl", ".ndjson"}:
        return "jsonl"
    raise ValueError("cannot infer input format; use --format csv or jsonl")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="source CSV or JSONL telemetry file")
    parser.add_argument("output", type=Path, help="destination JSONL payload file")
    parser.add_argument("--format", choices=("csv", "jsonl"), dest="input_format")
    parser.add_argument("--rejects", type=Path, help="optional JSONL file for invalid rows")
    parser.add_argument("--default-node-id", type=int, help="node ID used when a source row omits it")
    args = parser.parse_args(argv)

    try:
        input_format = args.input_format or _detect_format(args.input)
        if args.default_node_id is not None and not 0 <= args.default_node_id <= MAX_NODE_ID:
            parser.error(f"--default-node-id must be in 0..{MAX_NODE_ID}")
        with args.input.open("r", encoding="utf-8", newline="") as source, args.output.open(
            "w", encoding="utf-8", newline=""
        ) as destination:
            if args.rejects:
                with args.rejects.open("w", encoding="utf-8", newline="") as rejects:
                    summary = preprocess(
                        source, destination, input_format=input_format, rejects=rejects,
                        default_node_id=args.default_node_id,
                    )
            else:
                summary = preprocess(
                    source, destination, input_format=input_format, default_node_id=args.default_node_id
                )
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    print(f"accepted={summary.accepted} rejected={summary.rejected}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
