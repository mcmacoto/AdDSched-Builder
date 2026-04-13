# AdDSched Builder

AdDSched Builder is a stateless schedule-to-wallpaper web app built for students. It parses raw schedule text (or schedule screenshots via Gemini), renders a customizable weekly wallpaper on Canvas, and exports recurring calendar events as ICS.

## Stack

- Backend: Django (no models, no auth, no database persistence)
- Frontend: Django template + Tailwind CDN + Alpine.js + HTMX
- Rendering: HTML5 Canvas
- Calendar export: icalendar
- Image extraction: google-generativeai (Gemini)

## Features

- Parse SIS text into structured class slots
- Parse uploaded schedule image with Gemini (`/parse-image/`)
- Customize subject colors and wallpaper background
- Download generated wallpaper PNG
- Export 18-week recurring ICS schedule

## Requirements

- Python 3.13
- pip

## Local Setup (Windows PowerShell)

```powershell
# From project root
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create your local environment file from `.env.example` and set values as needed.

```powershell
Copy-Item .env.example .env
```

Set required environment variables for the current terminal (minimum):

```powershell
$env:GEMINI_API_KEY = "your-gemini-key"
$env:SECRET_KEY = "your-local-secret"
$env:DEBUG = "True"
$env:ALLOWED_HOSTS = "127.0.0.1,localhost"
```

Run checks and start server:

```powershell
python manage.py check
python manage.py runserver
```

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `SECRET_KEY` | Yes (production) | Django secret key |
| `DEBUG` | Yes | `True` for local dev, `False` for production |
| `ALLOWED_HOSTS` | Yes | Comma-separated allowed hostnames |
| `CSRF_TRUSTED_ORIGINS` | Optional | Comma-separated trusted origins |
| `GEMINI_API_KEY` | Yes for `/parse-image/` | Gemini API key |
| `MAX_PARSE_IMAGE_BYTES` | Optional | Max image upload size in bytes (default 5 MB) |
| `SECURE_SSL_REDIRECT` | Optional | Enforce HTTPS when `DEBUG=False` |
| `SECURE_HSTS_SECONDS` | Optional | HSTS max-age when `DEBUG=False` |

## Endpoints

- `POST /parse/` - Parse manual subject rows
- `POST /parse-image/` - Parse uploaded schedule image
- `POST /export-ics/` - Export schedule as ICS

## CI

GitHub Actions workflow is included at `.github/workflows/ci.yml` and runs:

- dependency install
- Django system checks
- static collection smoke check
- Python bytecode compile check

## Security Notes

- Never commit `.env` or real API keys
- For public deployments, set `DEBUG=False` and configure `ALLOWED_HOSTS`
- Rotate `SECRET_KEY` before production deployment

## License

MIT License. See `LICENSE`.
