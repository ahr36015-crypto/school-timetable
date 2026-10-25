from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from datetime import datetime
import os
import io

print("🚀 ЗАГРУЗКА МОДУЛЯ pdf_generator.py...")


def register_fonts():
    """Регистрирует шрифты с поддержкой кириллицы"""
    print("🔍 НАЧИНАЕМ ПОИСК ШРИФТОВ ДЛЯ КИРИЛЛИЦЫ...")

    current_dir = os.path.dirname(os.path.abspath(__file__))
    fonts_dir = os.path.join(current_dir, 'fonts')
    print(f"📁 Проверяем папку: {fonts_dir}")

    if os.path.exists(fonts_dir):
        print(f"📂 Файлы в папке: {os.listdir(fonts_dir)}")
    else:
        print("❌ Папка fonts НЕ НАЙДЕНА!")

    registered = {'normal': False, 'bold': False}

    font_paths = {
        'normal': [
            os.path.join(fonts_dir, 'DejaVuSans.ttf'),
            '/app/fonts/DejaVuSans.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/dejavu/DejaVuSans.ttf',
        ],
        'bold': [
            os.path.join(fonts_dir, 'DejaVuSans-Bold.ttf'),
            '/app/fonts/DejaVuSans-Bold.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
            '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
        ]
    }

    for path in font_paths['normal']:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont('Custom', path))
                registered['normal'] = True
                print(f"✅✅ УСПЕХ! Зарегистрирован обычный шрифт: {path}")
                break
            except Exception as e:
                print(f"⚠️ Ошибка обычного шрифта {path}: {e}")

    for path in font_paths['bold']:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont('CustomBold', path))
                registered['bold'] = True
                print(f"✅✅ УСПЕХ! Зарегистрирован жирный шрифт: {path}")
                break
            except Exception as e:
                print(f"⚠️ Ошибка жирного шрифта {path}: {e}")

    if not registered['normal']:
        print("❌❌ КРИТИЧЕСКАЯ ОШИБКА: Шрифт с кириллицей НЕ НАЙДЕН! PDF будет с квадратиками.")

    return registered


FONTS_REGISTERED = register_fonts()


def get_font_name(bold=False):
    if bold:
        return 'CustomBold' if FONTS_REGISTERED['bold'] else 'Custom'
    return 'Custom' if FONTS_REGISTERED['normal'] else 'Helvetica'


def generate_teachers_pdf(result_dict, days, slots):
    """Генерация PDF по учителям"""
    print(f"📄 Генерируем PDF по учителям: {len(result_dict.get('teachers', []))} учителей")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Title'],
        fontName=get_font_name(True),
        fontSize=16,
        alignment=TA_CENTER,
        spaceAfter=5 * mm
    )

    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Normal'],
        fontName=get_font_name(),
        fontSize=10,
        alignment=TA_CENTER,
        spaceAfter=8 * mm
    )

    header_style = ParagraphStyle(
        'Header',
        parent=styles['Normal'],
        fontName=get_font_name(True),
        fontSize=14,
        spaceAfter=5 * mm
    )

    cell_style = ParagraphStyle(
        'Cell',
        parent=styles['Normal'],
        fontName=get_font_name(),
        fontSize=8,
        leading=10,
        alignment=TA_CENTER
    )

    day_style = ParagraphStyle(
        'Day',
        parent=styles['Normal'],
        fontName=get_font_name(True),
        fontSize=9,
        alignment=TA_CENTER
    )

    elements = []

    elements.append(Paragraph('Расписание уроков', title_style))
    elements.append(Paragraph(
        f'По учителям • Сгенерировано: {datetime.now().strftime("%d.%m.%Y %H:%M")}',
        subtitle_style
    ))
    elements.append(Spacer(1, 10 * mm))

    for teacher in result_dict['teachers']:
        elements.append(Paragraph(
            f'Учитель: {teacher["teacher"]} ({teacher["total_lessons"]} уроков)',
            header_style
        ))

        col_width = (A4[1] - 30 * mm) / (len(slots) + 1)

        header_data = [Paragraph('День', day_style)]
        for slot in slots:
            header_data.append(Paragraph(f'Урок {slot}', day_style))

        table_data = [header_data]

        for day in days:
            row = [Paragraph(day, day_style)]
            for slot in slots:
                slot_str = str(slot)
                cell_text = ''
                if day in teacher['schedule'] and slot_str in teacher['schedule'][day]:
                    lessons = teacher['schedule'][day][slot_str]
                    parts = []
                    for lesson in lessons:
                        parts.append(f"<b>{lesson['subject']}</b><br/>({lesson['grade']} кл)")
                    cell_text = '<br/>'.join(parts)
                row.append(Paragraph(cell_text, cell_style))
            table_data.append(row)

        table = Table(table_data, colWidths=[col_width] * (len(slots) + 1))
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#667eea')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f0f4ff')]),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))

        elements.append(table)
        elements.append(Spacer(1, 10 * mm))
        elements.append(PageBreak())

    # Убираем завершающий разрыв страницы, чтобы не было пустого листа
    while elements and isinstance(elements[-1], PageBreak):
        elements.pop()

    doc.build(elements)

    return buffer.getvalue()


def generate_classes_pdf(result_dict, days, slots):
    """Генерация PDF по классам"""
    print(f"📄 Генерируем PDF по классам")

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

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Title'],
        fontName=get_font_name(True),
        fontSize=16,
        alignment=TA_CENTER,
        spaceAfter=5 * mm
    )

    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Normal'],
        fontName=get_font_name(),
        fontSize=10,
        alignment=TA_CENTER,
        spaceAfter=8 * mm
    )

    header_style = ParagraphStyle(
        'Header',
        parent=styles['Normal'],
        fontName=get_font_name(True),
        fontSize=14,
        spaceAfter=5 * mm
    )

    cell_style = ParagraphStyle(
        'Cell',
        parent=styles['Normal'],
        fontName=get_font_name(),
        fontSize=8,
        leading=10,
        alignment=TA_CENTER
    )

    day_style = ParagraphStyle(
        'Day',
        parent=styles['Normal'],
        fontName=get_font_name(True),
        fontSize=9,
        alignment=TA_CENTER
    )

    elements = []

    elements.append(Paragraph('Расписание уроков', title_style))
    elements.append(Paragraph(
        f'По классам • Сгенерировано: {datetime.now().strftime("%d.%m.%Y %H:%M")}',
        subtitle_style
    ))
    elements.append(Spacer(1, 10 * mm))

    grades = sorted(class_schedule.keys())

    for grade in grades:
        elements.append(Paragraph(f'Класс: {grade}', header_style))

        col_width = (A4[1] - 30 * mm) / (len(slots) + 1)

        header_data = [Paragraph('День', day_style)]
        for slot in slots:
            header_data.append(Paragraph(f'Урок {slot}', day_style))

        table_data = [header_data]

        for day in days:
            row = [Paragraph(day, day_style)]
            for slot in slots:
                cell_text = ''
                if day in class_schedule[grade] and slot in class_schedule[grade][day]:
                    lessons = class_schedule[grade][day][slot]
                    parts = []
                    for lesson in lessons:
                        parts.append(f"<b>{lesson['subject']}</b><br/>({lesson['teacher']})")
                    cell_text = '<br/>'.join(parts)
                row.append(Paragraph(cell_text, cell_style))
            table_data.append(row)

        table = Table(table_data, colWidths=[col_width] * (len(slots) + 1))
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#667eea')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f0f4ff')]),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))

        elements.append(table)
        elements.append(Spacer(1, 10 * mm))
        elements.append(PageBreak())

    # Убираем завершающий разрыв страницы, чтобы не было пустого листа
    while elements and isinstance(elements[-1], PageBreak):
        elements.pop()

    doc.build(elements)

    return buffer.getvalue()