# excel_generator.py
import re
from collections import defaultdict

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


def _grade_number(name):
    m = re.match(r"\s*(\d+)", str(name))
    return int(m.group(1)) if m else 99


def _time_label(minutes):
    minutes = int(minutes)
    return f"{minutes // 60}:{minutes % 60:02d}"


def _parse_range(value):
    try:
        a, b = str(value).split("-")
        h1, m1 = [int(x) for x in a.strip().replace(".", ":").split(":")]
        h2, m2 = [int(x) for x in b.strip().replace(".", ":").split(":")]
        return h1 * 60 + m1, h2 * 60 + m2
    except Exception:
        return None


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
    """Excel в формате образца: 5-минутный столбец времени, объединённые блоки
    уроков и строки перемен. Один лист на день.

    Слева: Время (каждые 5 минут), Начало и конец, Урок.
    Дальше — классы, сгруппированные в «Начальная школа» (1-4) и «Средняя школа» (5-11).
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
    ncols = 3 + len(ordered)
    first_class_col = 4

    header_fill = PatternFill("solid", start_color="4F46E5", end_color="4F46E5")
    section_fill = PatternFill("solid", start_color="E0E7FF", end_color="E0E7FF")
    break_fill = PatternFill("solid", start_color="F1F5F9", end_color="F1F5F9")
    thin = Side(style="thin", color="CBD5E1")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center", wrap_text=True)

    def box(r1, c1, r2, c2, fill=None, bold=False):
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                cell = ws.cell(row=r, column=c)
                cell.border = border
                cell.alignment = center
                if fill is not None:
                    cell.fill = fill
                if bold:
                    cell.font = Font(bold=True)

    # Интервалы уроков (минуты от полуночи)
    intervals = []
    default_start = 9 * 60
    prev_end = None
    for i, slot in enumerate(slots):
        parsed = _parse_range(times[i]) if i < len(times) else None
        if parsed:
            start, end = parsed
        else:
            start = (default_start + i * 55) if prev_end is None else (prev_end + 10)
            end = start + 45
        intervals.append((slot, start, end))
        prev_end = end

    for day in days:
        title = str(day)[:31] or "День"
        ws = wb.create_sheet(title=title)

        # Строка 1 — заголовок
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
        tc = ws.cell(row=1, column=1, value=f"Расписание · {day}")
        tc.font = Font(bold=True, size=14)
        tc.alignment = center

        # Строка 2 — секции
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=3)
        for c in (1, 2, 3):
            ws.cell(row=2, column=c).border = border
            ws.cell(row=2, column=c).fill = section_fill

        col = first_class_col
        for section_name, group in (("Начальная школа", primary), ("Средняя школа", secondary)):
            if not group:
                continue
            end = col + len(group) - 1
            ws.merge_cells(start_row=2, start_column=col, end_row=2, end_column=end)
            sc = ws.cell(row=2, column=col, value=section_name)
            sc.font = Font(bold=True)
            sc.alignment = center
            for c in range(col, end + 1):
                ws.cell(row=2, column=c).border = border
                ws.cell(row=2, column=c).fill = section_fill
            col = end + 1

        # Строка 3 — заголовки колонок
        headers = ["Время", "Начало и конец", "Урок"] + [f"{g} класс" for g in ordered]
        for ci, value in enumerate(headers, start=1):
            c = ws.cell(row=3, column=ci, value=value)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = header_fill
            c.alignment = center
            c.border = border

        row = 4
        for lesson_idx, (slot, start, end) in enumerate(intervals):
            n = max(1, (end - start) // 5)

            # Время по 5 минут
            for k in range(n):
                ws.cell(row=row + k, column=1, value=_time_label(start + 5 * k))

            # Начало и конец + Урок (объединяем на весь блок)
            ws.merge_cells(start_row=row, start_column=2, end_row=row + n - 1, end_column=2)
            ws.merge_cells(start_row=row, start_column=3, end_row=row + n - 1, end_column=3)
            ws.cell(row=row, column=2, value=f"{_time_label(start)}–{_time_label(end)}")
            ws.cell(row=row, column=3, value=f"Урок {slot}")
            box(row, 1, row + n - 1, 3, bold=False)

            # Классы
            for ci, g in enumerate(ordered, start=first_class_col):
                ws.merge_cells(start_row=row, start_column=ci, end_row=row + n - 1, end_column=ci)
                lessons = lesson_map.get((g, day, slot), [])
                cell = ws.cell(row=row, column=ci, value=_format_cell(lessons) if lessons else "")
                cell.alignment = left
            for ci in range(first_class_col, ncols + 1):
                for r in range(row, row + n):
                    ws.cell(row=r, column=ci).border = border

            row += n

            # Перемена до следующего урока
            next_start = intervals[lesson_idx + 1][1] if lesson_idx + 1 < len(intervals) else None
            if next_start is not None and next_start > end:
                break_rows = max(1, (next_start - end) // 5)
                for k in range(break_rows):
                    ws.cell(row=row + k, column=1, value=_time_label(end + 5 * k))
                ws.merge_cells(start_row=row, start_column=2, end_row=row + break_rows - 1, end_column=ncols)
                bc = ws.cell(row=row, column=2, value="Перемена")
                bc.alignment = center
                for r in range(row, row + break_rows):
                    for c in range(2, ncols + 1):
                        cell = ws.cell(row=r, column=c)
                        cell.border = border
                        cell.fill = break_fill
                box(row, 1, row + break_rows - 1, 1)
                row += break_rows

        # Финальная строка
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncols)
        fc = ws.cell(row=row, column=1, value="Сборы домой")
        fc.alignment = center
        fc.font = Font(bold=True)
        box(row, 1, row, ncols)

        ws.column_dimensions["A"].width = 8
        ws.column_dimensions["B"].width = 16
        ws.column_dimensions["C"].width = 9
        for ci in range(first_class_col, ncols + 1):
            ws.column_dimensions[get_column_letter(ci)].width = 22
        ws.row_dimensions[1].height = 22
        ws.row_dimensions[3].height = 20
        ws.freeze_panes = "D4"

    return wb
