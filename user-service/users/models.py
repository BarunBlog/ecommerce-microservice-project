from django.contrib.auth.models import AbstractUser
from django.db import models
from phonenumber_field.modelfields import PhoneNumberField


class User(AbstractUser):
    name = models.CharField(max_length=200)
    phone = PhoneNumberField(unique=True, null=False, blank=False)
    email = models.EmailField(unique=True, null=False, blank=False)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['name', 'username', 'phone']

    def __str__(self):
        return self.name
