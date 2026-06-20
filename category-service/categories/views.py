"""
Category API views — read-only.

Endpoints:
  GET /api/categories/         -> ListAPIView (list, active only by default)
  GET /api/categories/{id}/    -> RetrieveAPIView (fetch one)

Query params:
  ?all=true on the list endpoint includes inactive categories.

No create / update / delete endpoints. category-service is read-only —
categories are managed out-of-band (e.g. via fixtures or a management
command). No events are published.
"""
from rest_framework import generics

from .models import Category
from .serializers import CategorySerializer


class CategoryListView(generics.ListAPIView):
    serializer_class = CategorySerializer

    def get_queryset(self):
        qs = Category.objects.all().order_by("name")
        include_inactive = self.request.query_params.get("all", "").lower() == "true"
        if not include_inactive:
            qs = qs.filter(is_active=True)
        return qs


class CategoryDetailView(generics.RetrieveAPIView):
    serializer_class = CategorySerializer
    queryset = Category.objects.all()
    lookup_field = "id"
