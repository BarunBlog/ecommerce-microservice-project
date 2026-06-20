"""
Category model.

Why UUID primary key:
  Other services (product-service) reference categories by id. A UUID
  prevents id-collision and id-enumeration across services and is safe
  to expose publicly.

Note on signals:
  When this service starts publishing events, post_save / post_delete
  signals will be wired in categories/signals.py to publish
  category.created / category.updated / category.deleted to RabbitMQ.
  For now, no signals are registered.
"""
import uuid

from django.db import models
from django.utils.text import slugify


class Category(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120, unique=True)
    slug = models.SlugField(max_length=120, unique=True, blank=True)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)[:120]
        super().save(*args, **kwargs)
