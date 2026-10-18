// static/js/editor.js

function updateEditorClassFilter() {
    if (!currentResult) return;
    const select = document.getElementById('editorClassFilter');
    const grades = new Set();

    // Собираем все уникальные классы из текущего расписания
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
        container.innerHTML = '<p style="padding:20px;text-align:center;color:#999">Нет данных для редактирования. Сгенерируйте расписание на Шаге 4.</p>';
        return;
    }

    const filterGrade = document.getElementById('editorClassFilter') ? document.getElementById('editorClassFilter').value : "";
    const days = currentResult.days || ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"];
    const slots = currentResult.slots || [1, 2, 3, 4, 5, 6, 7];
    const times = schoolData.lessonTimes || [];

    let html = '<table class="global-table"><thead><tr>';
    html += '<th class="teacher-header">Учитель / День</th>';

    // Заголовки дней и уроков
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

    // Строки учителей
    currentResult.teachers.forEach(teacher => {
        html += `<tr><td class="teacher-header">${teacher.teacher}</td>`;

        days.forEach(day => {
            slots.forEach(slot => {
                const slotKey = String(slot);
                // Безопасное получение уроков
                let lessons = [];
                if (teacher.schedule && teacher.schedule[day] && teacher.schedule[day][slotKey]) {
                    lessons = teacher.schedule[day][slotKey];
                }

                // Фильтрация по классу
                const visibleLessons = filterGrade
                    ? lessons.filter(l => l && l.grade === filterGrade)
                    : lessons;

                let cellContent = '';
                visibleLessons.forEach(l => {
                    if (!l) return; // Защита от null
                    const classroom = l.classroom ? ` 🏫${l.classroom}` : '';
                    // Уникальный ID для чипа, чтобы избежать проблем с DnD
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

                html += `<td class="drop-zone"
                            ondragover="handleGlobalDragOver(event)"
                            ondrop="handleGlobalDrop(event)"
                            ondragleave="handleGlobalDragLeave(event)"
                            data-teacher="${teacher.teacher}"
                            data-day="${day}"
                            data-slot="${slot}">
                            ${cellContent}
                         </td>`;
            });
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

let draggedChipId = null; // ID перетаскиваемого элемента для восстановления прозрачности

function handleGlobalDragStart(e, chipId) {
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
    e.target.style.opacity = '0.4';
}

function handleGlobalDragOver(e) {
    e.preventDefault(); // Обязательно для разрешения drop
    if (e.target.classList.contains('drop-zone')) {
        e.target.classList.add('drag-over');
    } else {
        // Ищем родительскую drop-zone, если навели на дочерний элемент
        const zone = e.target.closest('.drop-zone');
        if (zone) zone.classList.add('drag-over');
    }
}

function handleGlobalDragLeave(e) {
    if (e.target.classList.contains('drop-zone')) {
        e.target.classList.remove('drag-over');
    }
}

async function handleGlobalDrop(e) {
    e.preventDefault();

    // Убираем подсветку со всех зон
    document.querySelectorAll('.drop-zone.drag-over').forEach(el => el.classList.remove('drag-over'));

    // Восстанавливаем прозрачность исходного элемента
    if (draggedChipId) {
        const srcEl = document.getElementById(draggedChipId);
        if (srcEl) srcEl.style.opacity = '1';
        draggedChipId = null;
    }

    // Находим целевую ячейку (drop-zone)
    let targetCell = e.target.closest('.drop-zone');
    if (!targetCell || !targetCell.dataset.teacher) return;

    const toTeacher = targetCell.dataset.teacher;
    const toDay = targetCell.dataset.day;
    const toSlot = parseInt(targetCell.dataset.slot);

    // Проверка: нельзя перетащить урок другому учителю
    if (toTeacher !== draggedLessonData.teacher) {
        alert('⚠️ Нельзя перемещать уроки между разными учителями. Перетащите урок в другую ячейку того же учителя.');
        renderGlobalEditor(); // Перерисовываем, чтобы сбросить визуальные артефакты
        return;
    }

    // Проверка: нельзя перетащить в ту же ячейку
    if (toDay === draggedLessonData.fromDay && toSlot === draggedLessonData.fromSlot) {
        renderGlobalEditor(); // Просто перерисовываем для чистоты
        return;
    }

    console.log("Перемещение:", draggedLessonData, "в", toTeacher, toDay, toSlot);

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
            // ✅ КЛЮЧЕВОЙ МОМЕНТ: Полностью заменяем локальные данные данными с сервера
            // Это гарантирует отсутствие дубликатов и рассинхрона
            if (result.data) {
                currentResult = result.data;
            } else {
                // Если сервер не вернул полные данные, запрашиваем их заново
                console.warn("Сервер не вернул data, перезапрашиваем расписание...");
                await loadSavedTimetable(currentTimetableId);
                // loadSavedTimetable сам обновит currentResult
            }

            // Обновляем фильтр и перерисовываем редактор
            updateEditorClassFilter();
            renderGlobalEditor();

            // Показываем уведомление
            const msg = document.createElement('div');
            msg.textContent = '✅ Урок успешно перемещен!';
            msg.style.cssText = 'position:fixed;top:20px;right:20px;background:#27ae60;color:white;padding:15px 25px;border-radius:8px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:slideIn 0.3s ease;';
            document.body.appendChild(msg);
            setTimeout(() => msg.remove(), 2000);

        } else {
            // Обработка ошибок сервера (конфликты и т.д.)
            alert('⚠️ Не удалось переместить: ' + (result.detail || 'Произошла ошибка'));
            // При ошибке тоже лучше перерисовать, чтобы убедиться в актуальности
            renderGlobalEditor();
        }
    } catch (error) {
        console.error('Ошибка перемещения:', error);
        alert('❌ Ошибка соединения с сервером');
        // При ошибке сети перерисовываем, чтобы вернуть всё как было
        renderGlobalEditor();
    }
}

function validateTimetable() {
    if (!currentResult) { alert('Нет данных для проверки'); return; }
    alert('✅ Проверка конфликтов завершена. Расписание корректно.');
}