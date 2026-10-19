# excel_generator.py
import io
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill


def generate_class_view_excel(data):
    """
    Генерирует Excel в формате "Сводная таблица по классам" (как на скриншоте).
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Расписание занятий"

    # Стили
    header_font = Font(bold=True, size=11, color="FFFFFF")
    param_font = Font(bold=True, size=10, color="800080")  # Фиолетовый для параметров
    center_align = Alignment(horizontal='center', vertical='center', wrap_text=True)
    left_align = Alignment(horizontal='left', vertical='center')

    purple_fill = PatternFill(start_color="9B59B6", end_color="9B59B6", fill_type="solid")
    white_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")

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
    # Пустая ячейка左上角
    ws.cell(row=current_row, column=1).value = ""

    # Заголовки классов (1 класс, 2 класс...)
    for col_idx, grade in enumerate(sorted_grades, start=2):
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

            # Блок параметров (строки)
            params = [
                ("Предмет", "subject"),
                ("Преподаватель", "teacher"),
                ("Кабинет", "classroom"),
                ("Тема", "topic"),  # Если темы нет в данных, будет пусто
            ]

            for p_idx, (param_name, param_key) in enumerate(params):
                # Первая колонка: Название параметра (Предмет, Учитель...)
                cell_param = ws.cell(row=current_row + p_idx, column=1, value=param_name)
                cell_param.font = param_font
                cell_param.alignment = center_align
                cell_param.border = thin_border

                # Остальные колонки: Значения для каждого класса
                for col_idx, grade in enumerate(sorted_grades, start=2):
                    val = "-"
                    # Ищем урок
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

            current_row += len(params)

            # Строка "Вычитано" (Время)
            cell_time_label = ws.cell(row=current_row, column=1, value="Вычитано")
            cell_time_label.font = param_font
            cell_time_label.alignment = center_align
            cell_time_label.border = thin_border

            # Объединяем ячейки времени или ставим в каждую? На скрине время одно на блок.
            # Но обычно в таких таблицах время пишут в первой ячейке или объединяют.
            # Сделаем объединение для красоты, как "9:00-9:40" на весь ряд.
            ws.merge_cells(start_row=current_row, start_column=2, end_row=current_row,
                           end_column=len(sorted_grades) + 1)
            cell_time_val = ws.cell(row=current_row, column=2, value=time_str)
            cell_time_val.alignment = center_align
            cell_time_val.border = thin_border

            current_row += 1

            # Разделитель (Перемена/Завтрак) - опционально, можно добавить логику
            # Если это последний урок дня или нужен разрыв
            # ws.cell(row=current_row, column=1, value="Перемена").font = param_font
            # current_row += 1

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