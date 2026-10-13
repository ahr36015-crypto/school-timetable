from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from datetime import datetime


def generate_teachers_excel(result_dict, days, slots):
    """Генерация Excel по учителям"""
    wb = Workbook()
    wb.remove(wb.active)  # Удаляем пустой лист по умолчанию

    # Стили
    header_font = Font(name='Arial', size=11, bold=True, color='FFFFFF')
    header_fill = PatternFill(start_color='667eea', end_color='667eea', fill_type='solid')
    day_font = Font(name='Arial', size=10, bold=True)
    cell_font = Font(name='Arial', size=9)
    title_font = Font(name='Arial', size=14, bold=True)

    thin_border = Border(
        left=Side(style='thin'),
        right=Side(style='thin'),
        top=Side(style='thin'),
        bottom=Side(style='thin')
    )

    center_alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    left_alignment = Alignment(horizontal='left', vertical='center', wrap_text=True)

    for teacher in result_dict['teachers']:
        ws = wb.create_sheet(title=teacher['teacher'][:31])  # Excel ограничивает имя листа 31 символом

        # Заголовок
        ws.merge_cells('A1:H1')
        title_cell = ws['A1']
        title_cell.value = f'Учитель: {teacher["teacher"]} ({teacher["total_lessons"]} уроков)'
        title_cell.font = title_font
        ws.row_dimensions[1].height = 25

        # Подзаголовок с датой
        ws.merge_cells('A2:H2')
        date_cell = ws['A2']
        date_cell.value = f'Сгенерировано: {datetime.now().strftime("%d.%m.%Y %H:%M")}'
        date_cell.font = Font(name='Arial', size=9, italic=True)
        ws.row_dimensions[2].height = 20

        # Пустая строка
        ws.row_dimensions[3].height = 10

        # Заголовки таблицы
        header_row = 4
        ws.cell(row=header_row, column=1, value='День').font = header_font
        ws.cell(row=header_row, column=1).fill = header_fill
        ws.cell(row=header_row, column=1).alignment = center_alignment
        ws.cell(row=header_row, column=1).border = thin_border

        for col_idx, slot in enumerate(slots, start=2):
            cell = ws.cell(row=header_row, column=col_idx, value=f'Урок {slot}')
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = center_alignment
            cell.border = thin_border

        ws.row_dimensions[header_row].height = 25

        # Данные
        for row_idx, day in enumerate(days, start=header_row + 1):
            # День недели
            day_cell = ws.cell(row=row_idx, column=1, value=day)
            day_cell.font = day_font
            day_cell.alignment = center_alignment
            day_cell.border = thin_border

            # Уроки
            for col_idx, slot in enumerate(slots, start=2):
                slot_str = str(slot)
                cell_text = ''

                if day in teacher['schedule'] and slot_str in teacher['schedule'][day]:
                    lessons = teacher['schedule'][day][slot_str]
                    parts = []
                    for lesson in lessons:
                        parts.append(f"{lesson['subject']}\n({lesson['grade']} кл)")
                    cell_text = '\n'.join(parts)

                cell = ws.cell(row=row_idx, column=col_idx, value=cell_text)
                cell.font = cell_font
                cell.alignment = center_alignment
                cell.border = thin_border

        # Настройка ширины столбцов
        ws.column_dimensions['A'].width = 12
        for col_idx in range(2, len(slots) + 2):
            ws.column_dimensions[get_column_letter(col_idx)].width = 20

        # Настройка высоты строк
        for row_idx in range(header_row + 1, header_row + 1 + len(days)):
            ws.row_dimensions[row_idx].height = 40

    return wb


def generate_classes_excel(result_dict, days, slots):
    """Генерация Excel по классам"""
    # Собираем расписание по классам
    class_schedule = {}
    for teacher in result_dict['teachers']:
        for day, day_data in teacher['schedule'].items():
            for slot_str, lessons in day_data.items():
                for lesson in lessons:
                    grade = lesson['grade']
                    if grade not in class_schedule:
                        class_schedule[grade] = {}
                    if day not in class_schedule[grade]:
                        class_schedule[grade][day] = {}
                    slot = int(slot_str)
                    if slot not in class_schedule[grade][day]:
                        class_schedule[grade][day][slot] = []
                    class_schedule[grade][day][slot].append({
                        'subject': lesson['subject'],
                        'teacher': lesson['teacher']
                    })

    wb = Workbook()
    wb.remove(wb.active)

    # Стили
    header_font = Font(name='Arial', size=11, bold=True, color='FFFFFF')
    header_fill = PatternFill(start_color='667eea', end_color='667eea', fill_type='solid')
    day_font = Font(name='Arial', size=10, bold=True)
    cell_font = Font(name='Arial', size=9)
    title_font = Font(name='Arial', size=14, bold=True)

    thin_border = Border(
        left=Side(style='thin'),
        right=Side(style='thin'),
        top=Side(style='thin'),
        bottom=Side(style='thin')
    )

    center_alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

    grades = sorted(class_schedule.keys())

    for grade in grades:
        # Excel ограничивает имя листа 31 символом
        sheet_name = f'{grade} класс'[:31]
        ws = wb.create_sheet(title=sheet_name)

        # Заголовок
        ws.merge_cells('A1:H1')
        title_cell = ws['A1']
        title_cell.value = f'Класс: {grade}'
        title_cell.font = title_font
        ws.row_dimensions[1].height = 25

        # Подзаголовок
        ws.merge_cells('A2:H2')
        date_cell = ws['A2']
        date_cell.value = f'Сгенерировано: {datetime.now().strftime("%d.%m.%Y %H:%M")}'
        date_cell.font = Font(name='Arial', size=9, italic=True)
        ws.row_dimensions[2].height = 20

        # Пустая строка
        ws.row_dimensions[3].height = 10

        # Заголовки таблицы
        header_row = 4
        ws.cell(row=header_row, column=1, value='День').font = header_font
        ws.cell(row=header_row, column=1).fill = header_fill
        ws.cell(row=header_row, column=1).alignment = center_alignment
        ws.cell(row=header_row, column=1).border = thin_border

        for col_idx, slot in enumerate(slots, start=2):
            cell = ws.cell(row=header_row, column=col_idx, value=f'Урок {slot}')
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = center_alignment
            cell.border = thin_border

        ws.row_dimensions[header_row].height = 25

        # Данные
        for row_idx, day in enumerate(days, start=header_row + 1):
            day_cell = ws.cell(row=row_idx, column=1, value=day)
            day_cell.font = day_font
            day_cell.alignment = center_alignment
            day_cell.border = thin_border

            for col_idx, slot in enumerate(slots, start=2):
                cell_text = ''

                if day in class_schedule[grade] and slot in class_schedule[grade][day]:
                    lessons = class_schedule[grade][day][slot]
                    parts = []
                    for lesson in lessons:
                        parts.append(f"{lesson['subject']}\n({lesson['teacher']})")
                    cell_text = '\n'.join(parts)

                cell = ws.cell(row=row_idx, column=col_idx, value=cell_text)
                cell.font = cell_font
                cell.alignment = center_alignment
                cell.border = thin_border

        # Настройка ширины столбцов
        ws.column_dimensions['A'].width = 12
        for col_idx in range(2, len(slots) + 2):
            ws.column_dimensions[get_column_letter(col_idx)].width = 25

        # Настройка высоты строк
        for row_idx in range(header_row + 1, header_row + 1 + len(days)):
            ws.row_dimensions[row_idx].height = 45

    return wb