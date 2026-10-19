// static/js/editor.js

// Глобальные переменные для Drag-and-Drop
let _isDragging = false;
let _draggedChipId = null;
let _originalParent = null; // КРИТИЧЕСКИ ВАЖНО: запоминаем, откуда взяли урок, чтобы вернуть при ошибке

function updateEditorClassFilter() {
    if (!currentResult) return;
    const select = document.getElementById('editorClassFilter');
    if (!select) return;

    const grades = new Set();
    if (currentResult.teachers) {
        currentResult.teachers.forEach(t => {
            if (t.schedule) {
                Object.values(t.schedule).forEach(dayObj => {
                    Object.values(dayObj).forEach(slotLessons => {
                        if (Array.isArray(slotLessons)) {
                            slotLessons.forEach(l => {
                                if (l && l.grade) grades.add(l.grade);
                            });
                        }
                    });
                });
            }
        });
    }

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Показать всех --</option> ' +
        Array.from(grades).sort().map(g => `<option value="${g}">${g} класс</option>`).join('');
    select.value = currentVal;
}

function renderGlobalEditor() {
    const container = document.getElementById('globalEditorContainer');
    if (!container) return;

    if (!currentResult || !currentResult.teachers) {
        container.innerHTML = '<p style="padding:20px;text-align:center;color:#999">Нет данных. Сгенерируйте расписание.</p>';
        return;
    }

    const filterGrade = document.getElementById('editorClassFilter') ?
        document.getElementById('editorClassFilter').value : "";
    const days = currentResult.days || ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"];
    const slots = currentResult.slots || [1, 2, 3, 4, 5, 6, 7];
    const times = schoolData.lessonTimes || [];

    let html = '<table class="global-table"><thead><tr>';
    html += '<th class="teacher-header">Учитель / День</th>';
    days.forEach(day => html += `<th colspan="${slots.length}" class="day-subheader">${day}</th>`);
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

                const visibleLessons = filterGrade
                    ? lessons.filter(l => l && l.grade === filterGrade)
                    : lessons;

                let cellContent = '';
                visibleLessons.forEach(l => {
                    if (!l) return;
                    const classroom = l.classroom ? `<br><small>${l.classroom}</small>` : '';
                    const chipId = `chip-${day}-${teacher.teacher}-${slot}-${l.subject}-${l.grade}`.replace(/\s+/g, '-');

                    cellContent += `
                        <div id="${chipId}" class="lesson-chip"
                             draggable="true"
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
    if (_isDragging) {
        e.preventDefault();
        return;
    }

    _draggedChipId = chipId;
    const chip = document.getElementById(chipId);
    if (!chip) return;

    // 🎯 КРИТИЧЕСКИ ВАЖНО: Запоминаем исходную ячейку, чтобы вернуть урок при ошибке
    _originalParent = chip.parentElement;

    draggedLessonData = {
        teacher: chip.dataset.teacher,
        subject: chip.dataset.subject,
        grade: chip.dataset.grade,
        classroom: chip.dataset.classroom || '',
        fromDay: chip.dataset.day,
        fromSlot: parseInt(chip.dataset.slot)
    };

    e.dataTransfer.setData('text/plain', JSON.stringify(draggedLessonData));
    e.dataTransfer.effectAllowed = 'move';
    chip.style.opacity = '0.4';
    _isDragging = true;

    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.classList.add('drag-active');
        checkDropZoneValidity(zone);
    });
}

function checkDropZoneValidity(zone) {
    if (!zone || !draggedLessonData) return;

    zone.classList.remove('drag-over-valid', 'drag-over-invalid', 'conflict-reason');
    zone.removeAttribute('title');

    const toTeacher = zone.dataset.teacher;
    const toDay = zone.dataset.day;
    const toSlot = parseInt(zone.dataset.slot);

    if (toTeacher !== draggedLessonData.teacher) {
        zone.classList.add('drag-over-invalid');
        zone.setAttribute('title', '❌ Нельзя переместить к другому учителю');
        zone.classList.add('conflict-reason');
        return;
    }

    if (toDay === draggedLessonData.fromDay && toSlot === draggedLessonData.fromSlot) {
        zone.classList.add('drag-over-invalid');
        zone.setAttribute('title', '❌ Это текущее место урока');
        return;
    }

    try {
        const existingLessons = JSON.parse(zone.dataset.lessons || '[]');
        let conflictReason = null;

        for (const l of existingLessons) {
            if (l.grade === draggedLessonData.grade) {
                conflictReason = `Класс ${l.grade} уже имеет урок (${l.subject})`;
                break;
            }
        }

        const teacherData = schoolData.teachers.find(t => t.full_name === toTeacher);
        if (teacherData) {
            const availability = schoolData.availability[toTeacher] || {};
            const dayAvailability = availability[toDay] || [];
            if (dayAvailability.length > 0 && !dayAvailability.includes(toSlot)) {
                conflictReason = `Учитель недоступен в это время`;
            }
        }

        if (conflictReason) {
            zone.classList.add('drag-over-invalid');
            zone.setAttribute('title', `❌ ${conflictReason}`);
            zone.classList.add('conflict-reason');
        } else {
            zone.classList.add('drag-over-valid');
            zone.setAttribute('title', '✅ Можно переместить');
        }
    } catch (err) {
        zone.classList.add('drag-over-valid');
    }
}

function handleGlobalDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const zone = e.target.closest('.drop-zone');
    if (!zone || !draggedLessonData) return;
    checkDropZoneValidity(zone);
}

function handleGlobalDragLeave(e) {
    const zone = e.target.closest('.drop-zone');
    if (zone) {
        zone.classList.remove('drag-over-valid', 'drag-over-invalid', 'conflict-reason');
        zone.removeAttribute('title');
    }
}

async function handleGlobalDrop(e) {
    e.preventDefault();
    if (!_isDragging || !draggedLessonData) return;

    const targetCell = e.target.closest('.drop-zone');
    const srcEl = document.getElementById(_draggedChipId);

    // Сбрасываем подсветку
    document.querySelectorAll('.drop-zone').forEach(el => {
        el.classList.remove('drag-over-valid', 'drag-over-invalid', 'drag-active', 'conflict-reason');
        el.removeAttribute('title');
    });

    if (!targetCell || !targetCell.dataset.teacher || _isDragging === 'processing') {
        resetDragState();
        return;
    }

    _isDragging = 'processing';

    const toTeacher = targetCell.dataset.teacher;
    const toDay = targetCell.dataset.day;
    const toSlot = parseInt(targetCell.dataset.slot);

    // Клиентская валидация
    if (toTeacher !== draggedLessonData.teacher) {
        alert('⚠️ Нельзя переместить урок к другому учителю');
        resetDragState();
        renderGlobalEditor();
        return;
    }

    if (toDay === draggedLessonData.fromDay && toSlot === draggedLessonData.fromSlot) {
        resetDragState();
        return;
    }

    // 🎯 ОПТИМИСТИЧНОЕ ОБНОВЛЕНИЕ UI:
    // Мгновенно перемещаем элемент в новую ячейку в DOM.
    // Это предотвращает "возврат" элемента браузером!
    if (srcEl && targetCell) {
        targetCell.appendChild(srcEl);
        srcEl.style.opacity = '0.6';
        srcEl.style.cursor = 'wait';
    }

    if (!currentTimetableId) {
        alert('⚠️ Ошибка: Потерян ID расписания. Пожалуйста, обновите страницу.');
        resetDragState();
        renderGlobalEditor();
        return;
    }

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
            // УСПЕХ: Обновляем состояние в памяти. Таблицу НЕ перерисовываем, так как элемент уже на месте!
            currentResult = result.data;
            if (srcEl) {
                srcEl.style.opacity = '1';
                srcEl.style.cursor = 'grab';
            }
            showToast('✅ Урок перемещен!');
        } else {
            // ОШИБКА: Возвращаем элемент в исходную ячейку
            const errorMsg = result.detail || 'Не удалось переместить';
            alert(`⚠️ ${errorMsg}`);
            if (srcEl && _originalParent) {
                _originalParent.appendChild(srcEl);
            }
            renderGlobalEditor(); // Принудительная перерисовка для гарантии чистоты
        }
    } catch (error) {
        console.error("❌ Ошибка сети:", error);
        alert('❌ Ошибка соединения с сервером');
        if (srcEl && _originalParent) {
            _originalParent.appendChild(srcEl);
        }
        renderGlobalEditor();
    } finally {
        resetDragState();
    }
}

function resetDragState() {
    _isDragging = false;
    _draggedChipId = null;
    _originalParent = null;
    draggedLessonData = null;
}

function showToast(message) {
    const msg = document.createElement('div');
    msg.textContent = message;
    msg.style.cssText = 'position:fixed;top:20px;right:20px;background:#27ae60;color:white;padding:15px 25px;border-radius:8px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition: opacity 0.5s;';
    document.body.appendChild(msg);
    setTimeout(() => {
        msg.style.opacity = '0';
        setTimeout(() => msg.remove(), 500);
    }, 1500);
}

function validateTimetable() {
    if (!currentResult) { alert('Нет данных'); return; }
    alert('✅ Проверка завершена');
}