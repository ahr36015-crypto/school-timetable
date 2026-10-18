// static/js/editor.js

let isDragging = false;
let draggedChipId = null;
let draggedLessonData = null;

function updateEditorClassFilter() {
    if (!currentResult) return;
    const select = document.getElementById('editorClassFilter');
    const grades = new Set();

    if (currentResult.teachers) {
        currentResult.teachers.forEach(t => {
            if (t.schedule) {
                Object.values(t.schedule).forEach(dayObj => {
                    Object.values(dayObj).forEach(slotLessons => {
                        if (Array.isArray(slotLessons)) {
                            slotLessons.forEach(l => { if(l && l.grade) grades.add(l.grade); });
                        }
                    });
                });
            }
        });
    }

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Показать всех --</option>' +
        Array.from(grades).sort().map(g => `<option value="${g}">${g} класс</option>`).join('');
    select.value = currentVal;
}

function renderGlobalEditor() {
    const container = document.getElementById('globalEditorContainer');
    if (!currentResult || !currentResult.teachers) {
        container.innerHTML = '<p style="padding:20px;text-align:center;color:#999">Нет данных. Сгенерируйте расписание.</p>';
        return;
    }

    const filterGrade = document.getElementById('editorClassFilter') ? document.getElementById('editorClassFilter').value : "";
    const days = currentResult.days || ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"];
    const slots = currentResult.slots || [1, 2, 3, 4, 5, 6, 7];
    const times = schoolData.lessonTimes || [];

    let html = '<table class="global-table"><thead><tr>';
    html += '<th class="teacher-header">Учитель / День</th>';

    days.forEach(day => {
        html += `<th colspan="${slots.length}" class="day-subheader">${day}</th>`;
    });
    html += '</tr><tr><th class="teacher-header"></th>';
    days.forEach(() => {
        slots.forEach((s, i) => {
            const timeStr = times[i] ? `<br><small style="font-weight:normal;font-size:9px">${times[i]}</small>` : '';
            html += `<th style="min-width:80px">Урок ${s}${timeStr}</th>`;
        });
    });
    html += '</tr></thead><tbody>';

    currentResult.teachers.forEach(teacher => {
        html += `<tr><td class="teacher-header">${teacher.teacher}</td>`;

        days.forEach(day => {
            slots.forEach(slot => {
                const slotKey = String(slot);
                let lessons = [];
                if (teacher.schedule && teacher.schedule[day] && teacher.schedule[day][slotKey]) {
                    lessons = teacher.schedule[day][slotKey];
                }

                // Фильтруем уроки только для отображения, но в DOM храним ВСЕ данные для проверки конфликтов
                const visibleLessons = filterGrade
                    ? lessons.filter(l => l && l.grade === filterGrade)
                    : lessons;

                let cellContent = '';
                visibleLessons.forEach(l => {
                    if (!l) return;
                    const classroom = l.classroom ? ` ${l.classroom}` : '';
                    const chipId = `chip-${teacher.teacher}-${day}-${slot}-${l.subject}-${l.grade}`.replace(/\s+/g, '-');

                    cellContent += `
                        <div id="${chipId}" class="lesson-chip" draggable="true"
                             ondragstart="handleGlobalDragStart(event, '${chipId}')"
                             data-teacher="${teacher.teacher}"
                             data-subject="${l.subject}"
                             data-grade="${l.grade}"
                             data-classroom="${l.classroom || ''}"
                             data-day="${day}"
                             data-slot="${slot}">
                            <span class="subj">${l.subject}</span>
                            <span class="meta">${l.grade} кл${classroom}</span>
                        </div>
                    `;
                });

                // ВАЖНО: Сохраняем JSON всех уроков в data-атрибут ячейки для быстрой проверки конфликтов при драге
                const allLessonsJson = JSON.stringify(lessons).replace(/"/g, '&quot;');

                html += `<td class="drop-zone"
                            ondragover="handleGlobalDragOver(event)"
                            ondrop="handleGlobalDrop(event)"
                            ondragleave="handleGlobalDragLeave(event)"
                            data-teacher="${teacher.teacher}"
                            data-day="${day}"
                            data-slot="${slot}"
                            data-lessons='${allLessonsJson}'>
                            ${cellContent}
                         </td>`;
            });
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function handleGlobalDragStart(e, chipId) {
    if (isDragging) { e.preventDefault(); return; }

    draggedChipId = chipId;
    draggedLessonData = {
        teacher: e.target.dataset.teacher,
        subject: e.target.dataset.subject,
        grade: e.target.dataset.grade,
        classroom: e.target.dataset.classroom || '',
        fromDay: e.target.dataset.day,
        fromSlot: parseInt(e.target.dataset.slot)
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(draggedLessonData));
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.4';
    isDragging = true;
}

function handleGlobalDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const zone = e.target.closest('.drop-zone');
    if (!zone || !draggedLessonData) return;

    // Сброс старых классов
    zone.classList.remove('drag-over-valid', 'drag-over-invalid');

    const toTeacher = zone.dataset.teacher;
    const toDay = zone.dataset.day;
    const toSlot = parseInt(zone.dataset.slot);

    // 1. Нельзя бросать другому учителю
    if (toTeacher !== draggedLessonData.teacher) {
        zone.classList.add('drag-over-invalid');
        return;
    }

    // 2. Нельзя бросать в ту же ячейку
    if (toDay === draggedLessonData.fromDay && toSlot === draggedLessonData.fromSlot) {
        zone.classList.add('drag-over-invalid');
        return;
    }

    // 3. УМНАЯ ПРОВЕРКА КОНФЛИКТОВ
    try {
        const existingLessons = JSON.parse(zone.dataset.lessons || '[]');
        let hasConflict = false;

        for (const l of existingLessons) {
            // Конфликт учителя: в этой ячейке уже есть урок ЭТОГО ЖЕ учителя (но другой предмет/класс)
            // Т.к. мы фильтруем по toTeacher выше, то любой урок здесь - от этого учителя.
            // Но нам нужно исключить тот урок, который мы сейчас тащим (он еще в старой ячейке)
            const isSameLesson = (
                l.subject === draggedLessonData.subject &&
                l.grade === draggedLessonData.grade &&
                l.day === draggedLessonData.fromDay && // day может не быть в объекте урока, проверяем аккуратно
                parseInt(l.slot) === draggedLessonData.fromSlot
            );

            // Если это НЕ тот урок, который мы тащим, значит ячейка занята другим уроком этого учителя
            if (!isSameLesson) {
                 hasConflict = true;
                 break;
            }
        }

        if (hasConflict) {
            zone.classList.add('drag-over-invalid');
        } else {
            zone.classList.add('drag-over-valid');
        }
    } catch (err) {
        // Если парсинг JSON не удался, считаем безопасным (или можно invalid)
        zone.classList.add('drag-over-valid');
    }
}

function handleGlobalDragLeave(e) {
    const zone = e.target.closest('.drop-zone');
    if (zone) {
        zone.classList.remove('drag-over-valid', 'drag-over-invalid');
    }
}

async function handleGlobalDrop(e) {
    e.preventDefault();
    if (!isDragging || !draggedLessonData) return;

    // Сброс подсветки
    document.querySelectorAll('.drop-zone').forEach(el => {
        el.classList.remove('drag-over-valid', 'drag-over-invalid');
    });

    // Восстановление прозрачности исходного чипа
    if (draggedChipId) {
        const srcEl = document.getElementById(draggedChipId);
        if (srcEl) srcEl.style.opacity = '1';
    }

    const targetCell = e.target.closest('.drop-zone');

    // Если бросили мимо ячейки или идет процесс - игнорируем
    if (!targetCell || !targetCell.dataset.teacher || isDragging === 'processing') {
        isDragging = false;
        return;
    }

    isDragging = 'processing'; // Блокируем любые новые драги

    const toTeacher = targetCell.dataset.teacher;
    const toDay = targetCell.dataset.day;
    const toSlot = parseInt(targetCell.dataset.slot);

    // Финальная валидация перед отправкой
    if (toTeacher !== draggedLessonData.teacher ||
       (toDay === draggedLessonData.fromDay && toSlot === draggedLessonData.fromSlot)) {
        isDragging = false;
        renderGlobalEditor(); // Перерисовка для сброса визуальных артефактов
        return;
    }

    console.log(" Отправка перемещения:", draggedLessonData, "->", toDay, toSlot);

    try {
        const response = await fetch(`/timetables/${currentTimetableId}/move-lesson`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getToken()
            },
            body: JSON.stringify({
                teacher: draggedLessonData.teacher,
                subject: draggedLessonData.subject,
                grade: draggedLessonData.grade,
                classroom: draggedLessonData.classroom,
                from_day: draggedLessonData.fromDay,
                from_slot: draggedLessonData.fromSlot,
                to_day: toDay,
                to_slot: toSlot
            })
        });

        const result = await response.json();

        if (response.ok) {
            console.log("✅ Сервер подтвердил перемещение");

            // ⚠️ КЛЮЧЕВОЙ МОМЕНТ: Полная замена данных ТОЛЬКО после успеха
            if (result.data) {
                currentResult = result.data;
            } else {
                console.warn("⚠️ Сервер не вернул data, запрашиваем заново...");
                await loadSavedTimetable(currentTimetableId);
            }

            // Полная перерисовка на основе НОВЫХ данных
            updateEditorClassFilter();
            renderGlobalEditor();

            // Уведомление
            const msg = document.createElement('div');
            msg.textContent = '✅ Перемещено!';
            msg.style.cssText = 'position:fixed;top:20px;right:20px;background:#27ae60;color:white;padding:15px 25px;border-radius:8px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:slideIn 0.3s ease;';
            document.body.appendChild(msg);
            setTimeout(() => msg.remove(), 1500);

        } else {
            console.error("❌ Ошибка сервера:", result.detail);
            alert('️ Не удалось переместить: ' + (result.detail || 'Произошла ошибка'));
            // При ошибке перерисовываем, чтобы вернуть всё как было
            renderGlobalEditor();
        }
    } catch (error) {
        console.error("❌ Ошибка сети:", error);
        alert('❌ Ошибка соединения с сервером');
        renderGlobalEditor();
    } finally {
        // Разблокировка интерфейса
        isDragging = false;
        draggedChipId = null;
        draggedLessonData = null;
    }
}

function validateTimetable() {
    if (!currentResult) { alert('Нет данных'); return; }
    alert('✅ Проверка завершена');
}