"""Общие фикстуры для тестов.

Важно: DATABASE_URL и SECRET_KEY задаются ДО импорта database/api,
иначе движок БД создастся с боевыми настройками.
"""
import os
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# api.py монтирует StaticFiles(directory="static") — нужен cwd = корень проекта
os.chdir(ROOT)

os.environ["DATABASE_URL"] = "sqlite:///" + tempfile.mktemp(suffix=".db")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("ALGORITHM", "HS256")


@pytest.fixture(scope="session")
def client():
    """HTTP-клиент приложения на тестовой БД (SQLite)."""
    import api
    from fastapi.testclient import TestClient

    with TestClient(api.app) as c:  # context manager запускает startup -> init_db()
        yield c


@pytest.fixture()
def auth_headers(client):
    email = f"user_{uuid.uuid4().hex}@test.ru"
    r = client.post("/register", json={
        "email": email,
        "password": "secret123",
        "full_name": "Test User",
        "school_name": "Test School",
    })
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


@pytest.fixture()
def sample_payload():
    return {
        "days": ["Понедельник", "Вторник"],
        "slots": [1, 2, 3],
        "lessonTimes": ["08:30-09:15", "09:25-10:10", "10:20-11:05"],
        "teachers": {
            "Иванова": {
                "lessons": [
                    {"subject": "Математика", "grade": "5A", "hours": 2, "classroom": "101"},
                ],
                "availability": {"Понедельник": [1, 2, 3], "Вторник": [1, 2, 3]},
            }
        },
    }
