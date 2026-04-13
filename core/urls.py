from django.urls import path

from . import views

urlpatterns = [
    path("parse/", views.parse_schedule, name="parse_schedule"),
    path("parse-image/", views.parse_image, name="parse_image"),
    path("export-ics/", views.export_ics, name="export_ics"),
]
