import re
from typing import Any

TIME_RANGE_PATTERN = re.compile(
    r"(?P<start>\d{1,2}:\d{2}\s*[AaPp](?:[Mm])?)\s*-\s*(?P<end>\d{1,2}:\d{2}\s*[AaPp](?:[Mm])?)"
)
TIME_PATTERN = re.compile(r"^(?P<hour>\d{1,2}):(?P<minute>\d{2})\s*(?P<meridiem>[AaPp])(?:[Mm])?$")


def parse_time_label(time_label: str) -> str:
    cleaned = time_label.strip()
    match = TIME_PATTERN.match(cleaned)
    if not match:
        raise ValueError(f"Invalid time format: '{time_label}'. Expected H:MMA or H:MMP.")

    hour = int(match.group("hour"))
    minute = int(match.group("minute"))
    meridiem = match.group("meridiem").upper()

    if hour < 1 or hour > 12:
        raise ValueError(f"Hour out of range in '{time_label}'.")
    if minute < 0 or minute > 59:
        raise ValueError(f"Minute out of range in '{time_label}'.")

    if meridiem == "A":
        hour_24 = 0 if hour == 12 else hour
    else:
        hour_24 = hour if hour == 12 else hour + 12

    return f"{hour_24:02d}:{minute:02d}"


def time_to_minutes(time_24: str) -> int:
    hour_text, minute_text = time_24.split(":", 1)
    return int(hour_text) * 60 + int(minute_text)


def parse_day_string(day_string: str) -> list[str]:
    compact = re.sub(r"[\s,;/]+", "", day_string or "")
    if not compact:
        raise ValueError("Missing day code in schedule segment.")

    days: list[str] = []
    seen: set[str] = set()
    index = 0

    while index < len(compact):
        two_char = compact[index : index + 2].lower()
        if two_char == "th":
            day_name = "Thursday"
            index += 2
        elif two_char == "sa":
            day_name = "Saturday"
            index += 2
        else:
            token = compact[index].upper()
            index += 1
            if token == "M":
                day_name = "Monday"
            elif token == "T":
                day_name = "Tuesday"
            elif token == "W":
                day_name = "Wednesday"
            elif token == "F":
                day_name = "Friday"
            elif token == "S":
                day_name = "Saturday"
            else:
                raise ValueError(
                    f"Invalid day code near '{compact[max(0, index - 2):index + 1]}'."
                )

        if day_name not in seen:
            seen.add(day_name)
            days.append(day_name)

    return days


def parse_schedule_segment(segment: str) -> dict[str, Any]:
    match = TIME_RANGE_PATTERN.search(segment)
    if not match:
        raise ValueError(
            f"Could not find time range in segment '{segment}'. Expected H:MMA-H:MMP."
        )

    start_24 = parse_time_label(match.group("start"))
    end_24 = parse_time_label(match.group("end"))

    if time_to_minutes(end_24) <= time_to_minutes(start_24):
        raise ValueError(f"End time must be later than start time in segment '{segment}'.")

    remainder = f"{segment[:match.start()]} {segment[match.end():]}".strip()
    tokens = remainder.split()

    if len(tokens) < 2:
        raise ValueError(
            f"Segment '{segment}' must include room and day string after the time range."
        )

    day_string = tokens[-1]
    room = " ".join(tokens[:-1]).strip()
    if not room:
        raise ValueError(f"Missing room code in segment '{segment}'.")

    days = parse_day_string(day_string)

    return {
        "days": days,
        "start": start_24,
        "end": end_24,
        "room": room,
    }


def parse_schedule_string(raw_schedule: str) -> list[dict[str, Any]]:
    segments = [segment.strip() for segment in raw_schedule.split("*") if segment.strip()]
    if not segments:
        raise ValueError("No schedule segments found. Use '*' to separate segments.")

    return [parse_schedule_segment(segment) for segment in segments]


def parse_schedule_text(raw_schedule: str) -> list[dict[str, Any]]:
    return parse_schedule_string(raw_schedule)


def parse_subject_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    parsed_subjects: list[dict[str, Any]] = []
    errors: list[str] = []

    for row_index, row in enumerate(rows, start=1):
        subject_no = str(row.get("subject_no", "")).strip()
        title = str(row.get("title", "")).strip()
        raw_schedule = str(row.get("raw_schedule", "")).strip()

        if not any([subject_no, title, raw_schedule]):
            continue

        if not subject_no or not title or not raw_schedule:
            errors.append(
                f"Row {row_index}: subject_no, title, and raw_schedule are all required."
            )
            continue

        try:
            slots = parse_schedule_string(raw_schedule)
        except ValueError as exc:
            errors.append(f"Row {row_index} ({subject_no}): {exc}")
            continue

        parsed_subjects.append(
            {
                "subject_no": subject_no,
                "title": title,
                "slots": slots,
            }
        )

    return parsed_subjects, errors
