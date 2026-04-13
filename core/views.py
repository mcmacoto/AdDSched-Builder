import base64
import json
from typing import Any

import google.generativeai as genai
from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.http import require_POST

from .ical import build_ics_bytes
from .parser import parse_schedule_string, parse_subject_rows

DEFAULT_COLORS = [
    "#1D4ED8",
    "#0F766E",
    "#B45309",
    "#BE123C",
    "#166534",
    "#334155",
    "#7C2D12",
    "#0E7490",
]

IMAGE_PROMPT = (
    "Extract class schedule entries from the image and return ONLY raw JSON. "
    "The output must be a JSON array of objects. "
    "Each object must contain exactly these keys: subject_no, title, raw_schedule. "
    "Do not include markdown, explanations, or code fences. "
    "If no classes are visible, return an empty JSON array []."
)


def schedule_response(subjects: list[dict[str, Any]], errors: list[str], status: int = 200) -> JsonResponse:
    colored_subjects: list[dict[str, Any]] = []
    for index, subject in enumerate(subjects):
        normalized_subject = dict(subject)
        normalized_subject["color"] = subject.get("color") or DEFAULT_COLORS[index % len(DEFAULT_COLORS)]
        colored_subjects.append(normalized_subject)

    payload = {
        "subjects": colored_subjects,
        "errors": errors,
    }
    response = JsonResponse(payload, status=status)
    response["HX-Trigger"] = json.dumps({"schedule-loaded": payload})
    return response


def parse_json_text(value: str) -> Any:
    cleaned = value.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start_index = min(
            [index for index in [cleaned.find("["), cleaned.find("{")] if index != -1],
            default=-1,
        )
        end_index = max(cleaned.rfind("]"), cleaned.rfind("}"))
        if start_index != -1 and end_index != -1 and end_index > start_index:
            return json.loads(cleaned[start_index : end_index + 1])
        raise


def normalize_rows_from_model(model_data: Any) -> list[dict[str, str]]:
    if isinstance(model_data, dict):
        if isinstance(model_data.get("rows"), list):
            candidates = model_data["rows"]
        elif isinstance(model_data.get("subjects"), list):
            candidates = model_data["subjects"]
        else:
            candidates = [model_data]
    elif isinstance(model_data, list):
        candidates = model_data
    else:
        raise ValueError("Gemini response must be a JSON array or object.")

    rows: list[dict[str, str]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        row = {
            "subject_no": str(candidate.get("subject_no", "")).strip(),
            "title": str(candidate.get("title", "")).strip(),
            "raw_schedule": str(candidate.get("raw_schedule", "")).strip(),
        }
        if any(row.values()):
            rows.append(row)

    return rows


def extract_model_text(response: Any) -> str:
    text = getattr(response, "text", "")
    if text:
        return str(text)

    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            part_text = getattr(part, "text", "")
            if part_text:
                return str(part_text)

    raise ValueError("Gemini returned an empty response.")


def extract_rows(request: HttpRequest) -> list[dict[str, Any]]:
    content_type = (request.content_type or "").split(";", 1)[0].strip().lower()

    if content_type == "application/json":
        try:
            payload = json.loads(request.body.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON payload.") from exc

        raw_rows = payload.get("rows")
        if raw_rows is None:
            raise ValueError("JSON payload must include a 'rows' array.")
        if not isinstance(raw_rows, list):
            raise ValueError("'rows' must be an array of objects.")

        normalized_rows: list[dict[str, Any]] = []
        for row in raw_rows:
            if not isinstance(row, dict):
                continue
            normalized_rows.append(
                {
                    "subject_no": str(row.get("subject_no", "")),
                    "title": str(row.get("title", "")),
                    "raw_schedule": str(row.get("raw_schedule", "")),
                }
            )
        return normalized_rows

    subject_nos = request.POST.getlist("subject_no[]") or request.POST.getlist("subject_no")
    titles = request.POST.getlist("title[]") or request.POST.getlist("title")
    raw_schedules = request.POST.getlist("raw_schedule[]") or request.POST.getlist("raw_schedule")

    if not subject_nos and not titles and not raw_schedules:
        return []

    max_len = max(len(subject_nos), len(titles), len(raw_schedules))
    rows: list[dict[str, Any]] = []
    for index in range(max_len):
        subject_no = subject_nos[index] if index < len(subject_nos) else ""
        title = titles[index] if index < len(titles) else ""
        raw_schedule = raw_schedules[index] if index < len(raw_schedules) else ""

        if not any([subject_no.strip(), title.strip(), raw_schedule.strip()]):
            continue

        rows.append(
            {
                "subject_no": subject_no,
                "title": title,
                "raw_schedule": raw_schedule,
            }
        )

    return rows


@require_POST
def parse_schedule(request: HttpRequest) -> JsonResponse:
    try:
        rows = extract_rows(request)
    except ValueError as exc:
        return schedule_response([], [str(exc)], status=400)

    subjects, errors = parse_subject_rows(rows)
    return schedule_response(subjects, errors)


@require_POST
def parse_image(request: HttpRequest) -> JsonResponse:
    schedule_image = request.FILES.get("schedule_image")
    if schedule_image is None:
        return schedule_response([], ["Missing file field 'schedule_image'."], status=400)

    content_type = (schedule_image.content_type or "").lower()
    if not content_type.startswith("image/"):
        return schedule_response([], ["Uploaded file must be an image."], status=400)

    image_bytes = schedule_image.read()
    if not image_bytes:
        return schedule_response([], ["Uploaded image file is empty."], status=400)

    max_size = int(getattr(settings, "MAX_PARSE_IMAGE_BYTES", 5 * 1024 * 1024))
    if len(image_bytes) > max_size:
        max_size_mb = max_size / (1024 * 1024)
        return schedule_response(
            [],
            [f"Uploaded image exceeds {max_size_mb:.0f} MB size limit."],
            status=413,
        )

    if not settings.GEMINI_API_KEY:
        return schedule_response([], ["GEMINI_API_KEY is not configured on the server."], status=500)

    try:
        encoded_image = base64.b64encode(image_bytes).decode("utf-8")
        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.5-flash")

        response = model.generate_content(
            [
                {
                    "role": "user",
                    "parts": [
                        {"text": IMAGE_PROMPT},
                        {
                            "inline_data": {
                                "mime_type": content_type,
                                "data": encoded_image,
                            }
                        },
                    ],
                }
            ]
        )

        model_text = extract_model_text(response)
        model_data = parse_json_text(model_text)
        rows = normalize_rows_from_model(model_data)
    except ValueError as exc:
        return schedule_response([], [str(exc)], status=400)
    except Exception as exc:
        return schedule_response([], [f"Failed to process image with Gemini: {exc}"], status=502)

    subjects: list[dict[str, Any]] = []
    errors: list[str] = []
    for row_index, row in enumerate(rows, start=1):
        subject_no = row["subject_no"]
        title = row["title"]
        raw_schedule = row["raw_schedule"]

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

        subjects.append(
            {
                "subject_no": subject_no,
                "title": title,
                "slots": slots,
            }
        )

    return schedule_response(subjects, errors)


@require_POST
def export_ics(request: HttpRequest) -> HttpResponse:
    content_type = (request.content_type or "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        return JsonResponse(
            {"error": "Content-Type must be application/json for this endpoint."},
            status=415,
        )

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    subjects = payload.get("subjects")
    reference_week_start = str(payload.get("reference_week_start", "")).strip()

    if not isinstance(subjects, list):
        return JsonResponse({"error": "'subjects' must be an array."}, status=400)
    if not reference_week_start:
        return JsonResponse(
            {"error": "'reference_week_start' is required in YYYY-MM-DD format."},
            status=400,
        )

    try:
        ics_bytes = build_ics_bytes(subjects, reference_week_start, recurrence_count=18)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    response = HttpResponse(ics_bytes, content_type="text/calendar; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="addsched_schedule.ics"'
    return response
