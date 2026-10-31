# excel_generator.py
import re
from collections import defaultdict

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


def _grade_number(name):
    m = re.match(r"\s*(\d+)", str(name))
    return int(m.group(1)) if m else 99


def _format_cell(lessons):
    """Текст ячейки: предмет (+метки), затем учитель и кабинет мелкой строкой."""
    parts = []
    for l in lessons:
        subject = str(l.get("subject") or "").strip()
        marks = []
        if l.get("half"):
            marks.append("0,5 ч")
        wi = l.get("week_index")
        if wi == 0:
            marks.append("син.")
        elif wi == 1:
            marks.append("кр.")
        if marks:
            subject = f"{subject} ({', '.join(marks)})"

        extra = []
        if l.get("teacher"):
            extra.append(str(l["teacher"]).strip())
        if l.get("classroom"):
            extra.append("каб. " + str(l["classroom"]).strip())
        if extra:
            subject = subject + "\n" + " · ".join(extra)
        parts.append(subject)

    return "\n—\n".join(parts) if parts else ""


def generate_class_template_excel(data):
    """Excel в формате образца: строки — уроки/время, столбцы — классы.

    Один лист на день. Классы сгруппированы в секции «Начальная школа» (1-4)
    и «Средняя школа» (5-11). В ячейке — предмет, ниже учитель и кабинет.
    """
    days = list(data.get("days") or ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"])
    slots = list(data.get("slots") or [1, 2, 3, 4, 5, 6, 7])
    times = list(data.get("lessonTimes") or [])

    lesson_map = defaultdict(list)
    grades = set()
    for teacher in data.get("teachers", []):
        for day, by_slot in (teacher.get("schedule") or {}).items():
            for slot_str, lessons in (by_slot or {}).items():
                try:
                    slot = int(slot_str)
                except (TypeError, ValueError):
                    continue
                for lesson in (lessons or []):
                    g = str(lesson.get("grade") or "").strip()
                    if not g:
                        continue
                    grades.add(g)
                    lesson_map[(g, day, slot)].append(lesson)

    wb = Workbook()
    wb.remove(wb.active)

    if not grades:
        ws = wb.create_sheet("Расписание")
        ws.cell(row=1, column=1, value="Нет данных о классах")
        return wb

    sorted_grades = sorted(grades, key=lambda g: (_grade_number(g), str(g)))
    primary = [g for g in sorted_grades if _grade_number(g) <= 4]
    secondary = [g for g in sorted_grades if _grade_number(g) > 4]
    ordered = primary + secondary
    ncols = 2 + len(ordered)

    header_fill = PatternFill("solid", start_color="4F46E5", end_color="4F46E5")
    section_fill = PatternFill("solid", start_color="E0E7FF", end_color="E0E7FF")
    thin = Side(style="thin", color="CBD5E1")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center", wrap_text=True)

    for day in days:
        title = str(day)[:31] or "День"
        ws = wb.create_sheet(title=title)

        # Строка 1 — заголовок
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
        tc = ws.cell(row=1, column=1, value=f"Расписание · {day}")
        tc.font = Font(bold=True, size=14)
        tc.alignment = center

        # Строка 2 — секции «Начальная / Средняя школа»
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=2)
        for cc in (1, 2):
            ws.cell(row=2, column=cc).border = border
            ws.cell(row=2, column=cc).fill = section_fill

        col = 3
        if primary:
            end = col + len(primary) - 1
            ws.merge_cells(start_row=2, start_column=col, end_row=2, end_column=end)
            sc = ws.cell(row=2, column=col, value="Начальная школа")
            sc.font = Font(bold=True)
            sc.alignment = center
            for cc in range(col, end + 1):
                ws.cell(row=2, column=cc).border = border
                ws.cell(row=2, column=cc).fill = section_fill
            col = end + 1

        if secondary:
            end = col + len(secondary) - 1
            ws.merge_cells(start_row=2, start_column=col, end_row=2, end_column=end)
            sc = ws.cell(row=2, column=col, value="Средняя школа")
            sc.font = Font(bold=True)
            sc.alignment = center
            for cc in range(col, end + 1):
                ws.cell(row=2, column=cc).border = border
                ws.cell(row=2, column=cc).fill = section_fill

        # Строка 3 — заголовки колонок
        headers = ["Урок", "Время"] + [f"{g} класс" for g in ordered]
        for ci, value in enumerate(headers, start=1):
            c = ws.cell(row=3, column=ci, value=value)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = header_fill
            c.alignment = center
            c.border = border

        # Данные по урокам
        for idx, slot in enumerate(slots):
            r = 4 + idx
            time_str = str(times[idx]) if idx < len(times) else ""

            c1 = ws.cell(row=r, column=1, value=f"Урок {slot}")
            c1.font = Font(bold=True)
            c1.alignment = center
            c1.border = border

            c2 = ws.cell(row=r, column=2, value=time_str)
            c2.alignment = center
            c2.border = border

            for ci, g in enumerate(ordered, start=3):
                lessons = lesson_map.get((g, day, slot), [])
                cell = ws.cell(row=r, column=ci, value=_format_cell(lessons) if lessons else "")
                cell.alignment = left
                cell.border = border

        ws.column_dimensions["A"].width = 10
        ws.column_dimensions["B"].width = 15
        for ci in range(3, ncols + 1):
            ws.column_dimensions[get_column_letter(ci)].width = 22
        ws.row_dimensions[1].height = 22
        ws.row_dimensions[3].height = 20
        ws.freeze_panes = "C4"

    return wb
