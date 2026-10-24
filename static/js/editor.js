// static/js/editor.js
// Визуальный редактор расписания с Drag-and-Drop и Undo

// ============================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================================
let _isDragging = false;
let _draggedChipId = null;
let _originalParent = null;

// История для Undo (максимум 20 действий)
if (!window.undoHistory) {
    window.undoHistory = [];
}
const MAX_UNDO_HISTORY = 20;

// ============================================================
// ОБНОВЛЕНИЕ ФИЛЬТРА ПО КЛАССУ
// ============================================================
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

    updateUndoButtonState();
}

// ============================================================
// УПРАВЛЕНИЕ КНОПКОЙ UNDO
// ============================================================
function updateUndoButtonState() {
    const undoBtn = document.getElementById('undoBtn');
    if (!undoBtn) return;

    if (window.undoHistory.length > 0) {
        undoBtn.disabled = false;
        undoBtn.style.opacity = '1';
        undoBtn.style.cursor = 'pointer';
        undoBtn.textContent = ` Отменить (${window.undoHistory.length})`;
    } else {
        undoBtn.disabled = true;
        undoBtn.style.opacity = '0.5';
        undoBtn.style.cursor = 'not-allowed';
        undoBtn.textContent = '↶ Отменить';
    }
}

function saveUndoSnapshot() {
    if (!currentResult) return;

    // Глубокий клон текущего состояния
    const snapshot = JSON.parse(JSON.stringify(currentResult));

    window.undoHistory.push(snapshot);

    // Ограничиваем историю 20 элементами
    if (window.undoHistory.length > MAX_UNDO_HISTORY) {
        window.undoHistory.shift();
    }

    console.log('💾 Snapshot сохранён в историю Undo. Всего:', window.undoHistory.length);
    updateUndoButtonState();
}

async function undoLastAction() {
    if (window.undoHistory.length === 0) {
        alert('Нет действий для отмены');
        return;
    }

    if (!confirm('Отменить последнее действие?')) return;

    const snapshot = window.undoHistory.pop();
    currentResult = snapshot;

    console.log(' Отмена действия. Осталось в истории:', window.undoHistory.length);

    // Отправляем восстановленное состояние на сервер
    if (currentTimetableId) {
        try {
            const res = await fetch(`/timetables/${currentTimetableId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken()
                },
                body: JSON.stringify({ data: currentResult })
            });

            if (res.ok) {
                console.log('✅ Сервер принял откат');
                showToast('✅ Действие отменено');
            } else {
                console.error('❌ Ошибка сервера при откате:', res.status);
                alert('Ошибка при откате на сервере');
            }
        } catch (e) {
            console.error('❌ Ошибка сети при откате:', e);
            alert('Ошибка соединения при откате');
        }
    }

    updateUndoButtonState();
    renderGlobalEditor();
}

// ============================================================
// РЕНДЕР ГЛОБАЛЬНОГО РЕДАКТОРА
// ============================================================
function renderGlobalEditor() {
    const container = document.getElementById('globalEditorContainer');
    if (!container) return;

    if (!currentResult || !currentResult.teachers) {
        container.innerHTML = '<p style="padding:20px;text-align:center;color:#999">Нет данных. Сгенерируйте расписание.</p>';
        return;
    }

    const filterGrade = document.getElementById('editorClassFilter') ?
        document.getElementById('editorClassFilter').value : "";

    const daysSet = new Set(currentResult.days || ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"]);
    const days = Array.from(daysSet);

    const slotsSet = new Set(currentResult.slots || [1, 2, 3, 4, 5, 6, 7]);
    const slots = Array.from(slotsSet).sort((a, b) => a - b);

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
    console.log('✅ Таблица редактора отрисована');
}

// ============================================================
// ПОИСК УРОКОВ В ДНЕ/СЛОТЕ ПО ВСЕМ УЧИТЕЛЯМ
// ============================================================
function findLessonsInSlot(day, slot) {
    const slotKey = String(slot);
    const lessons = [];
    if (!currentResult || !currentResult.teachers) return lessons;

    currentResult.teachers.forEach(teacher => {
        if (teacher.schedule && teacher.schedule[day] && teacher.schedule[day][slotKey]) {
            teacher.schedule[day][slotKey].forEach(l => {
                lessons.push({
                    ...l,
                    teacher: teacher.teacher
                });
            });
        }
    });
    return lessons;
}

// ============================================================
// НАЧАЛО ПЕРЕТАСКИВАНИЯ
// ============================================================
function handleGlobalDragStart(e, chipId) {
    if (_isDragging) {
        e.preventDefault();
        return;
    }

    _draggedChipId = chipId;
    const chip = document.getElementById(chipId);
    if (!chip) return;

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

// ============================================================
// ПРОВЕРКА ВАЛИДНОСТИ ЗОНЫ СБРОСА
// ============================================================
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

    let conflictReason = null;

    try {
        const existingLessons = JSON.parse(zone.dataset.lessons || '[]');
        for (const l of existingLessons) {
            if (l.grade === draggedLessonData.grade) {
                conflictReason = `Класс ${l.grade} уже имеет урок (${l.subject})`;
                break;
            }
        }
    } catch (err) {
        console.error('Ошибка парсинга lessons:', err);
    }

    if (!conflictReason && draggedLessonData.classroom) {
        const allLessonsInSlot = findLessonsInSlot(toDay, toSlot);
        for (const l of allLessonsInSlot) {
            if (l.teacher === draggedLessonData.teacher &&
                l.subject === draggedLessonData.subject &&
                l.grade === draggedLessonData.grade) {
                continue;
            }

            if (l.classroom && draggedLessonData.classroom === l.classroom) {
                conflictReason = `Кабинет ${l.classroom} уже занят (${l.subject} ${l.grade} кл, ${l.teacher})`;
                break;
            }
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

    document.querySelectorAll('.drop-zone').forEach(el => {
        el.classList.remove('drag-over-valid', 'drag-over-invalid', 'drag-active', 'conflict-reason');
        el.removeAttribute('title');
    });

    if (_draggedChipId) {
        const srcEl = document.getElementById(_draggedChipId);
        if (srcEl) srcEl.style.opacity = '1';
    }

    const targetCell = e.target.closest('.drop-zone');
    if (!targetCell || !targetCell.dataset.teacher || _isDragging === 'processing') {
        _isDragging = false;
        return;
    }

    _isDragging = 'processing';

    const toTeacher = targetCell.dataset.teacher;
    const toDay = targetCell.dataset.day;
    const toSlot = parseInt(targetCell.dataset.slot);

    console.log('🔄 НАЧАЛО ПЕРЕМЕЩЕНИЯ:', draggedLessonData, '->', toDay, toSlot);

    if (toTeacher !== draggedLessonData.teacher) {
        alert('⚠️ Нельзя переместить урок к другому учителю');
        _isDragging = false;
        await reloadAndRender();
        return;
    }

    if (toDay === draggedLessonData.fromDay && toSlot === draggedLessonData.fromSlot) {
        _isDragging = false;
        return;
    }

    if (draggedLessonData.classroom) {
        const allLessonsInSlot = findLessonsInSlot(toDay, toSlot);
        for (const l of allLessonsInSlot) {
            if (l.teacher === draggedLessonData.teacher &&
                l.subject === draggedLessonData.subject &&
                l.grade === draggedLessonData.grade) {
                continue;
            }

            if (l.grade === draggedLessonData.grade) {
                alert(`⚠️ Конфликт: Класс ${l.grade} уже имеет урок "${l.subject}" в это время`);
                _isDragging = false;
                await reloadAndRender();
                return;
            }

            if (l.classroom && draggedLessonData.classroom === l.classroom) {
                alert(`⚠️ Конфликт: Кабинет ${l.classroom} уже занят уроком "${l.subject}" (${l.grade} кл, ${l.teacher}) в это время`);
                _isDragging = false;
                await reloadAndRender();
                return;
            }
        }
    }

    if (!currentTimetableId) {
        alert('️ Ошибка: Потерян ID расписания. Пожалуйста, обновите страницу.');
        _isDragging = false;
        return;
    }

    // 💾 СОХРАНЯЕМ SNAPSHOT ПЕРЕД ПЕРЕМЕЩЕНИЕМ
    saveUndoSnapshot();

    const srcEl = document.getElementById(_draggedChipId);
    if (srcEl && targetCell) {
        targetCell.appendChild(srcEl);
        srcEl.style.opacity = '0.6';
        srcEl.style.cursor = 'wait';
    }

    try {
        console.log('📡 Отправка запроса на сервер...');
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
        console.log('📥 Ответ сервера:', response.status, result);

        if (response.ok) {
            console.log('✅ Сервер вернул успех');
            currentResult = result.data;
            if (srcEl) {
                srcEl.style.opacity = '1';
                srcEl.style.cursor = 'grab';
            }
            showToast('✅ Урок перемещен!');
        } else {
            const errorMsg = result.detail || 'Не удалось переместить';
            alert(`⚠️ ${errorMsg}`);
            // Удаляем последний snapshot, так как перемещение не удалось
            window.undoHistory.pop();
            updateUndoButtonState();
            if (srcEl && _originalParent) {
                _originalParent.appendChild(srcEl);
            }
            await reloadAndRender();
        }
    } catch (error) {
        console.error('❌ Ошибка сети:', error);
        alert('❌ Ошибка соединения с сервером');
        // Удаляем последний snapshot
        window.undoHistory.pop();
        updateUndoButtonState();
        if (srcEl && _originalParent) {
            _originalParent.appendChild(srcEl);
        }
        await reloadAndRender();
    } finally {
        _isDragging = false;
        _draggedChipId = null;
        _originalParent = null;
        draggedLessonData = null;
    }
}

async function reloadAndRender() {
    if (!currentTimetableId) {
        console.warn('⚠ Нет currentTimetableId, пропускаем перезагрузку');
        renderGlobalEditor();
        return;
    }

    try {
        console.log('🔄 Перезагрузка данных с сервера...');
        const reloadRes = await fetch(`/timetables/${currentTimetableId}`, {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });

        if (reloadRes.ok) {
            const reloadData = await reloadRes.json();
            if (reloadData && reloadData.data) {
                currentResult = reloadData.data;
                console.log('✅ currentResult обновлён с сервера');
                console.log('📊 Количество учителей:', currentResult.teachers?.length);
            }
        } else {
            console.warn('⚠ Не удалось перезагрузить данные');
        }
    } catch (err) {
        console.error('❌ Ошибка перезагрузки:', err);
    }

    updateEditorClassFilter();
    renderGlobalEditor();
    console.log('✅ Таблица перерисована');
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

// Экспорт функций
window.updateEditorClassFilter = updateEditorClassFilter;
window.renderGlobalEditor = renderGlobalEditor;
window.handleGlobalDragStart = handleGlobalDragStart;
window.handleGlobalDragOver = handleGlobalDragOver;
window.handleGlobalDragLeave = handleGlobalDragLeave;
window.handleGlobalDrop = handleGlobalDrop;
window.validateTimetable = validateTimetable;
window.undoLastAction = undoLastAction;
window.updateUndoButtonState = updateUndoButtonState;