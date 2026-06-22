from django.urls import path

from .views import CategoryDetailView, CategoryListCreateView

urlpatterns = [
    path("", CategoryListCreateView.as_view(), name="category-list"),
    path("<uuid:id>/", CategoryDetailView.as_view(), name="category-detail"),
]
