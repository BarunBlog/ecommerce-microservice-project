from django.urls import path

from .views import CategoryDetailView, CategoryListView

urlpatterns = [
    path("", CategoryListView.as_view(), name="category-list"),
    path("<uuid:id>/", CategoryDetailView.as_view(), name="category-detail"),
]
