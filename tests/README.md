# Тесты

Запуск:

```bash
.venv/bin/python -m pytest
```

Только быстрые (без браузера):

```bash
.venv/bin/python -m pytest -m "not integration"
```

## Что покрыто

| Файл | Проверяет |
|------|-----------|
| `test_solver.py` | решатель строит расписание без конфликтов (учитель/класс/кабинет) |
| `test_generators.py` | генерация Excel и PDF (в т.ч. пустые данные) |
| `test_json_persistence.py` | регрессия: изменения JSON-поля сохраняются в БД |
| `test_move_lesson.py` | сквозной перенос урока через HTTP + реальная БД (SQLite) |
| `test_topics.py` | сквозное сохранение тем уроков |
| `test_substitutions.py` | журнал замен: CRUD + общий доступ для всех пользователей |
| `test_import_excel.py` | импорт справочников из Excel (листы и один лист с колонками) |
| `test_drag_and_drop.py` | реальный HTML5 drag-and-drop в headless Chrome (Playwright) |

## Требования

Из `requirements-dev.txt`: `pytest`, `httpx` (для `TestClient`), `playwright`
(использует уже установленный Chrome, браузер не скачивается).

Тесты используют временную SQLite-БД — боевая база не затрагивается.
