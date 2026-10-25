"""Тесты генераторов Excel и PDF."""
from excel_generator import generate_class_template_excel
from pdf_generator import generate_classes_pdf, generate_teachers_pdf

DATA = {
    "status": "OPTIMAL",
    "solution_time": 0.1,
    "days": ["Понедельник", "Вторник"],
    "slots": [1, 2],
    "lessonTimes": ["08:30-09:15", "09:25-10:10"],
    "teachers": [
        {
            "teacher": "Иванова",
            "total_lessons": 2,
            "schedule": {
                "Понедельник": {
                    "1": [{"subject": "Математика", "grade": "5A", "teacher": "Иванова", "classroom": "101", "topic": "Дроби"}],
                    "2": [{"subject": "Математика", "grade": "5B", "teacher": "Иванова", "classroom": "101", "topic": ""}],
                },
                "Вторник": {
                    "1": [{"subject": "Математика", "grade": "5A", "teacher": "Иванова", "classroom": "101", "topic": "Уравнения"}],
                },
            },
        }
    ],
}


def test_excel_generator_returns_workbook():
    wb = generate_class_template_excel(DATA)
    assert "Расписание занятий" in wb.sheetnames


def test_excel_generator_handles_empty_data():
    wb = generate_class_template_excel({"teachers": []})
    assert wb.active is not None


def test_teachers_pdf_is_valid():
    pdf = generate_teachers_pdf(DATA, DATA["days"], DATA["slots"])
    assert pdf[:4] == b"%PDF"


def test_classes_pdf_is_valid():
    pdf = generate_classes_pdf(DATA, DATA["days"], DATA["slots"])
    assert pdf[:4] == b"%PDF"
