"""URL configuration for category_service."""
from django.http import JsonResponse
from django.urls import include, path


def healthz(_request):
    return JsonResponse({"status": "ok", "service": "category-service"})


urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("api/categories/", include("categories.urls")),
]
