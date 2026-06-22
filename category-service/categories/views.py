"""
Category API views.

Endpoints:
  GET    /api/categories/         -> ListCreateAPIView (list, active only by default)
  POST   /api/categories/         -> ListCreateAPIView (create)
  GET    /api/categories/{id}/    -> RetrieveUpdateDestroyAPIView (retrieve)
  PUT    /api/categories/{id}/    -> RetrieveUpdateDestroyAPIView (full update)
  PATCH  /api/categories/{id}/    -> RetrieveUpdateDestroyAPIView (partial update)
  DELETE /api/categories/{id}/    -> soft-delete (is_active=False) by default
                                    pass ?hard=true to actually delete the row

Query params:
  ?all=true on the list endpoint includes inactive categories.

No events are published from this view. category-service is pure CRUD.
"""
from rest_framework import generics, status
from rest_framework.response import Response

from .models import Category
from .serializers import CategorySerializer


class CategoryListCreateView(generics.ListCreateAPIView):
    serializer_class = CategorySerializer

    def get_queryset(self):
        qs = Category.objects.all().order_by("name")
        include_inactive = self.request.query_params.get("all", "").lower() == "true"
        if not include_inactive:
            qs = qs.filter(is_active=True)
        return qs


class CategoryDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CategorySerializer
    lookup_field = "id"

    def get_queryset(self):
        # If the user is just looking at data via GET, respect the active filter boundary
        if self.request.method == "GET":
            qs = Category.objects.all()
            include_inactive = self.request.query_params.get("all", "").lower() == "true"
            if not include_inactive:
                return qs.filter(is_active=True)
            return qs
        
        # If writing data (PUT, PATCH, DELETE), expose all rows so we can safely modify or purge them
        return Category.objects.all()

    def destroy(self, request, *args, **kwargs):
        hard = request.query_params.get("hard", "").lower() == "true"
        
        # Now get_object() will successfully find soft-deleted items during a hard-delete run!
        instance = self.get_object()
        
        if hard:
            self.perform_destroy(instance)
            return Response(status=status.HTTP_204_NO_CONTENT)
            
        # Soft delete logic
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        return Response(
            {"detail": "Category soft-deleted (is_active=False).", "id": str(instance.id)},
            status=status.HTTP_200_OK,
        )
