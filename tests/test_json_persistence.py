"""Регрессия: изменения JSON-поля должны сохраняться в БД.

Баг был в том, что мутация ORM-объекта in-place + присваивание deepcopy
воспринимались SQLAlchemy как "без изменений", и UPDATE не выполнялся.
"""
import copy
import uuid


def test_json_reassignment_is_persisted():
    from database import SavedTimetable, SessionLocal, User, init_db

    init_db()
    db = SessionLocal()
    try:
        user = User(email=f"{uuid.uuid4().hex}@persist.ru", hashed_password="x", full_name="A")
        db.add(user)
        db.commit()

        row = SavedTimetable(user_id=user.id, name="t", data={"x": [1]})
        db.add(row)
        db.commit()
        row_id = row.id

        db.expire_all()
        row = db.query(SavedTimetable).filter(SavedTimetable.id == row_id).first()

        # правильный паттерн: работаем с копией и присваиваем её
        data = copy.deepcopy(row.data)
        data["x"].append(2)
        row.data = data
        db.commit()

        db.expire_all()
        fresh = db.query(SavedTimetable).filter(SavedTimetable.id == row_id).first()
        assert fresh.data == {"x": [1, 2]}
    finally:
        db.close()
