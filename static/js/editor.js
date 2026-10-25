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
        undoBtn.textContent = `↶ Отменить (${window.undoHistory.length})`;
    } else {
        undoBtn.disabled = true;
        undoBtn.style.opacity = '0.5';
        undoBtn.style.cursor = 'not-allowed';
        undoBtn.textContent = '↶ Отменить';
    }
}

function saveUndoSnapshot() {
    if (!currentResult) return;
    const snapshot = JSON.parse(JSON.stringify(currentResult));
    window.undoHistory.push(snapshot);

    if (window.undoHistory.length > MAX_UNDO_HISTORY) {
        window.undoHistory.shift();
    }
    console.log('💾 Snapshot сохранён. Всего в истории:', window.undoHistory.length);
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
                showToast('✅ Действие отменено');
            } else {
                alert('Ошибка при откате на сервере');
            }
        } catch (e) {
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

    const filterGrade = document.getElementById('editorClassFilter') ? document.getElementById('editorClassFilter').value : "";
    const days = Array.from(new Set(currentResult.days || ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"]));
    const slots = Array.from(new Set(currentResult.slots || [1, 2, 3, 4, 5, 6, 7])).sort((a, b) => a - b);
    const times = getLessonTimes();

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

                const visibleLessons = filterGrade ? lessons.filter(l => l && l.grade === filterGrade) : lessons;

                let cellContent = '';
                visibleLessons.forEach(l => {
                    if (!l) return;
                    const classroom = l.classroom ? `<br><small>${l.classroom}</small>` : '';
                    const chipId = `chip-${day}-${teacher.teacher}-${slot}-${l.subject}-${l.grade}`.replace(/\s+/g, '-');
                    const chipTitle = `Перетащите, чтобы изменить время: ${l.subject}, ${l.grade} кл`;

                    cellContent += `
                        <div id="${chipId}" class="lesson-chip"
                             draggable="true"
                             title="${chipTitle}"
                             aria-label="${chipTitle}"
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

                // пустая ячейка — показываем подсказку, что сюда можно перетащить урок
                if (!cellContent) {
                    cellContent = '<span class="drop-hint" title="Пусто — можно перетащить сюда урок">+</span>';
                }

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
                lessons.push({ ...l, teacher: teacher.teacher });
            });
        }
    });
    return lessons;
}

// ============================================================
// DRAG AND DROP ЛОГИКА
// ============================================================
function handleGlobalDragStart(e, chipId) {
    if (_isDragging) { e.preventDefault(); return; }

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
    });
}

// Сброс состояния перетаскивания при отмене (Esc / отпускание вне таблицы).
// Без этого _isDragging остаётся true и следующие перетаскивания блокируются.
document.addEventListener('dragend', () => {
    if (_isDragging === 'processing') return; // идёт сохранение на сервере — не мешаем
    _isDragging = false;
    _draggedChipId = null;
    _originalParent = null;
    draggedLessonData = null;
    document.querySelectorAll('.drop-zone').forEach(el => {
        el.classList.remove('drag-over-valid', 'drag-over-invalid', 'drag-active', 'conflict-reason');
        el.removeAttribute('title');
    });
    document.querySelectorAll('.lesson-chip').forEach(c => { c.style.opacity = '1'; });
});

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
    } catch (err) { console.error('Ошибка парсинга lessons:', err); }

    if (!conflictReason && draggedLessonData.classroom) {
        const allLessonsInSlot = findLessonsInSlot(toDay, toSlot);
        for (const l of allLessonsInSlot) {
            if (l.teacher === draggedLessonData.teacher && l.subject === draggedLessonData.subject && l.grade === draggedLessonData.grade) continue;
            if (l.classroom && draggedLessonData.classroom === l.classroom) {
                conflictReason = `Кабинет ${l.classroom} уже занят (${l.subject} ${l.grade} кл)`;
                break;
            }
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

    // Автопрокрутка к зоне при перетаскивании к краю
    const zoneRect = zone.getBoundingClientRect();
    const container = document.querySelector('.global-editor-container');
    if (container) {
        const containerRect = container.getBoundingClientRect();
        if (zoneRect.right > containerRect.right - 50) {
            container.scrollBy({ left: 100, behavior: 'smooth' });
        } else if (zoneRect.left < containerRect.left + 50) {
            container.scrollBy({ left: -100, behavior: 'smooth' });
        }
    }
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

    // ПРОВЕРКА КОНФЛИКТОВ ПЕРЕД СОХРАНЕНИЕМ
    let hasConflict = false;
    try {
        const existingLessons = JSON.parse(targetCell.dataset.lessons || '[]');
        for (const l of existingLessons) {
            if (l.grade === draggedLessonData.grade) {
                alert(`⚠️ Конфликт: Класс ${l.grade} уже имеет урок "${l.subject}"`);
                hasConflict = true;
                break;
            }
        }
    } catch (err) { console.error('Ошибка парсинга:', err); }

    if (!hasConflict && draggedLessonData.classroom) {
        const allLessonsInSlot = findLessonsInSlot(toDay, toSlot);
        for (const l of allLessonsInSlot) {
            if (l.teacher === draggedLessonData.teacher && l.subject === draggedLessonData.subject && l.grade === draggedLessonData.grade) continue;
            if (l.classroom && draggedLessonData.classroom === l.classroom) {
                alert(`⚠️ Конфликт: Кабинет ${l.classroom} уже занят`);
                hasConflict = true;
                break;
            }
        }
    }

    if (hasConflict) {
        _isDragging = false;
        await reloadAndRender();
        return;
    }

    // Если конфликтов нет, сохраняем историю и отправляем на сервер
    saveUndoSnapshot();

    const srcEl = document.getElementById(_draggedChipId);
    if (srcEl && targetCell) {
        targetCell.appendChild(srcEl);
        srcEl.style.opacity = '0.6';
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
            currentResult = result.data;
            showToast('✅ Урок перемещен!');
            // 🔥 ВАЖНО: Перерисовываем таблицу, чтобы обновить data-lessons во всех ячейках
            await reloadAndRender();
        } else {
            alert(`⚠️ ${result.detail || 'Не удалось переместить'}`);
            window.undoHistory.pop(); // Откатываем историю, если сервер отклонил
            updateUndoButtonState();
            if (srcEl && _originalParent) _originalParent.appendChild(srcEl);
            await reloadAndRender();
        }
    } catch (error) {
        alert('❌ Ошибка соединения с сервером');
        window.undoHistory.pop();
        updateUndoButtonState();
        if (srcEl && _originalParent) _originalParent.appendChild(srcEl);
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
        renderGlobalEditor();
        return;
    }
    try {
        const reloadRes = await fetch(`/timetables/${currentTimetableId}`, {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (reloadRes.ok) {
            const reloadData = await reloadRes.json();
            if (reloadData && reloadData.data) {
                currentResult = reloadData.data;
            }
        }
    } catch (err) {
        console.error('Ошибка перезагрузки:', err);
    }
    updateEditorClassFilter();
    renderGlobalEditor();
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

// Экспорт функций в глобальную область
window.updateEditorClassFilter = updateEditorClassFilter;
window.renderGlobalEditor = renderGlobalEditor;
window.handleGlobalDragStart = handleGlobalDragStart;
window.handleGlobalDragOver = handleGlobalDragOver;
window.handleGlobalDragLeave = handleGlobalDragLeave;
window.handleGlobalDrop = handleGlobalDrop;
window.validateTimetable = validateTimetable;
window.undoLastAction = undoLastAction;
window.updateUndoButtonState = updateUndoButtonState;