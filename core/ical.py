from datetime import date, datetime, time, timedelta
from uuid import uuid4

from icalendar import Calendar, Event

DAY_INDEX = {
    "Monday": 0,
    "Tuesday": 1,
    "Wednesday": 2,
    "Thursday": 3,
    "Friday": 4,
    "Saturday": 5,
}

DAY_TO_ICS = {
    "Monday": "MO",
    "Tuesday": "TU",
    "Wednesday": "WE",
    "Thursday": "TH",
    "Friday": "FR",
    "Saturday": "SA",
}


def parse_reference_week_start(reference_week_start: str) -> date:
    try:
        return date.fromisoformat(reference_week_start)
    except ValueError as exc:
        raise ValueError("reference_week_start must be a valid date in YYYY-MM-DD format.") from exc


def parse_time_24h(time_value: str) -> time:
    try:
        hour_text, minute_text = time_value.split(":", 1)
        return time(hour=int(hour_text), minute=int(minute_text))
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid 24-hour time value '{time_value}'.") from exc


def first_occurrence_date(reference_week_start: date, day_name: str) -> date:
    normalized_day = day_name.strip().title()
    if normalized_day not in DAY_INDEX:
        raise ValueError(f"Unsupported day '{day_name}' in slot days.")

    return reference_week_start + timedelta(days=DAY_INDEX[normalized_day])


def build_ics_bytes(
    schedule_data: list[dict],
    reference_week_start: str,
    recurrence_count: int = 18,
) -> bytes:
    if recurrence_count < 1:
        raise ValueError("recurrence_count must be greater than 0.")

    anchor_date = parse_reference_week_start(reference_week_start)

    calendar = Calendar()
    calendar.add("prodid", "-//AdDSched//Schedule Builder//EN")
    calendar.add("version", "2.0")
    calendar.add("calscale", "GREGORIAN")

    for subject in schedule_data:
        subject_no = str(subject.get("subject_no", "")).strip()
        title = str(subject.get("title", "")).strip()
        slots = subject.get("slots") or []

        summary = " - ".join(part for part in [subject_no, title] if part)
        if not summary:
            summary = "AdDSched Subject"

        for slot in slots:
            start_time = parse_time_24h(str(slot.get("start", "")).strip())
            end_time = parse_time_24h(str(slot.get("end", "")).strip())
            room = str(slot.get("room", "")).strip()

            if datetime.combine(anchor_date, end_time) <= datetime.combine(anchor_date, start_time):
                raise ValueError(
                    f"Invalid slot duration for {summary}: end time must be after start time."
                )

            for day_name in slot.get("days") or []:
                normalized_day = str(day_name).strip().title()
                occurrence_date = first_occurrence_date(anchor_date, normalized_day)

                event = Event()
                event.add("uid", f"{uuid4()}@addsched")
                event.add("summary", summary)
                event.add("dtstart", datetime.combine(occurrence_date, start_time))
                event.add("dtend", datetime.combine(occurrence_date, end_time))
                event.add(
                    "rrule",
                    {
                        "freq": "weekly",
                        "count": recurrence_count,
                        "byday": DAY_TO_ICS[normalized_day],
                    },
                )

                if room:
                    event.add("location", room)

                calendar.add_component(event)

    return calendar.to_ical()
