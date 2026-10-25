# excel_generator.py
import io
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill


def generate_class_template_excel(data):
    """
    Генерирует Excel строго по шаблону:
    Колонки: Параметр | Урок X | Классы...
    Строки: Предмет, Учитель, Кабинет, Тема, Вычитано(время)
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Расписание занятий"

    # Стили
    header_font = Font(bold=True, size=11, color="FFFFFF")
    param_font = Font(bold=True, size=10, color="800080")  # Фиолетовый для параметров
    center_align = Alignment(horizontal='center', vertical='center', wrap_text=True)

    purple_fill = PatternFill(start_color="9B59B6", end_color="9B59B6", fill_type="solid")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )

    # 1. Собираем все уникальные классы
    all_grades = set()
    for teacher in data.get('teachers', []):
        for day_schedule in teacher.get('schedule', {}).values():
            for slot_lessons in day_schedule.values():
                for lesson in slot_lessons:
                    if 'grade' in lesson:
                        all_grades.add(str(lesson['grade']))

    sorted_grades = sorted(list(all_grades))
    if not sorted_grades:
        ws.append(["Нет данных о классах"])
        return wb

    days = data.get('days', ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'])
    slots = data.get('slots', [1, 2, 3, 4, 5, 6, 7])
    times = data.get('lessonTimes', [])

    current_row = 1

    # --- ЗАГОЛОВОК ТАБЛИЦЫ ---
    # Колонка 1: Пустая (для параметров)
    ws.cell(row=current_row, column=1).value = ""
    # Колонка 2: Пустая (для названия урока/времени)
    ws.cell(row=current_row, column=2).value = ""

    # Заголовки классов (начинаются с 3-й колонки)
    for col_idx, grade in enumerate(sorted_grades, start=3):
        cell = ws.cell(row=current_row, column=col_idx, value=f"{grade} класс")
        cell.font = header_font
        cell.fill = purple_fill
        cell.alignment = center_align
        cell.border = thin_border

    current_row += 1

    # --- ЦИКЛ ПО ДНЯМ И УРОКАМ ---
    for day in days:
        for slot_idx, slot in enumerate(slots):
            time_str = times[slot_idx] if slot_idx < len(times) else f"Урок {slot}"
            lesson_label = f"Урок {slot}"

            params = [
                ("Предмет", "subject"),
                ("Преподаватель", "teacher"),
                ("Кабинет", "classroom"),
                ("Тема", "topic"),
            ]

            # Строки параметров (4 строки)
            for p_idx, (param_name, param_key) in enumerate(params):
                # Колонка 1: Название параметра
                cell_param = ws.cell(row=current_row + p_idx, column=1, value=param_name)
                cell_param.font = param_font
                cell_param.alignment = center_align
                cell_param.border = thin_border

                # Колонка 2: "Урок X" (объединяем 4 строки)
                if p_idx == 0:
                    cell_lesson = ws.cell(row=current_row + p_idx, column=2, value=lesson_label)
                    cell_lesson.alignment = center_align
                    cell_lesson.border = thin_border
                    cell_lesson.font = Font(bold=True)
                    # Объединяем ячейки для "Урок X" на 4 строки вниз
                    ws.merge_cells(start_row=current_row + p_idx, start_column=2,
                                   end_row=current_row + p_idx + 3, end_column=2)

                # Колонки 3+: Значения для каждого класса
                for col_idx, grade in enumerate(sorted_grades, start=3):
                    val = "-"
                    for t in data.get('teachers', []):
                        sched = t.get('schedule', {})
                        if day in sched and str(slot) in sched[day]:
                            for l in sched[day][str(slot)]:
                                if str(l.get('grade')) == grade:
                                    val = l.get(param_key, "-")
                                    break
                        if val != "-": break

                    cell_val = ws.cell(row=current_row + p_idx, column=col_idx, value=val)
                    cell_val.alignment = center_align
                    cell_val.border = thin_border

            current_row += 4  # Пропускаем 4 строки параметров

            # Строка "Вычитано" (Время) - 5-я строка блока
            cell_time_label = ws.cell(row=current_row, column=1, value="Вычитано")
            cell_time_label.font = param_font
            cell_time_label.alignment = center_align
            cell_time_label.border = thin_border

            # Во второй колонке ставим время
            cell_time_val = ws.cell(row=current_row, column=2, value=time_str)
            cell_time_val.alignment = center_align
            cell_time_val.border = thin_border
            cell_time_val.font = Font(bold=True)

            # Для классов ставим прочерки
            for col_idx in range(3, len(sorted_grades) + 3):
                cell_val = ws.cell(row=current_row, column=col_idx, value="-")
                cell_val.alignment = center_align
                cell_val.border = thin_border

            current_row += 1

        # Пустая строка между днями
        current_row += 1

    # Автоширина
    for col in ws.columns:
        max_length = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        ws.column_dimensions[col_letter].width = max(min(max_length + 2, 50), 10)

    return wb