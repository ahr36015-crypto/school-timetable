// ============================================================
// УПРАВЛЕНИЕ СОВМЕЩЁННЫМИ ЗАНЯТИЯМИ
// Вкладка мастера настройки «Совмещённые занятия»
// API: /api/combined-lessons (GET/POST/PUT/DELETE)
// ============================================================

// ---------- ПЕРЕМЕННЫЕ СОСТОЯНИЯ ----------

/** @type {Array<{id?: number, name: string, subject: string, teacher: string, classroom: string, classes: string[], hours: number, weekIndex: number|null}>} Список правил совмещённых занятий */
let combinedLessons = [];

/** ID правила, которое сейчас редактируется (null = режим добавления) */
let editingCombinedLessonId = null;

// ---------- ХЕЛПЕРЫ ----------

// Текстовое представление выбора недели
function weekSelectLabel(wi) {
    if (wi === 0) return 'Красная неделя';
    if (wi === 1) return 'Синяя неделя';
    return 'Каждую неделю';
}

// Получить выбранные классы из чекбоксов в форме
function getSelectedClasses() {
    const checks = document.querySelectorAll('#combinedClassChecks input[type="checkbox"]:checked');
    return Array.from(checks).map(c => c.value);
}

// ---------- РЕНДЕРИНГ КЛАССОВ В ФОРМЕ ----------

/** Заполняет чекбоксы классов в форме совмещённых занятий списком из schoolData.classes */
function renderCombinedLessonClassCheckboxes() {
    const container = document.getElementById('combinedClassChecks');
    if (!container) { console.warn('[combined-lessons] renderCombinedLessonClassCheckboxes: container not found'); return; }
    const classes = schoolData.classes || [];
    console.log('[combined-lessons] renderCombinedLessonClassCheckboxes: schoolData.classes:', classes.length, classes.map(c => c.name));
    // Сохраняем текущее выбранное значение при перерисовке
    const currentlySelected = getSelectedClasses();

    if (classes.length === 0) {
        container.innerHTML = '<p style="color:#999;font-size:13px">Нет добавленных классов — сначала добавьте их в «Справочники».</p>';
        return;
    }

    container.innerHTML = classes
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map(c => {
            const isChecked = currentlySelected.includes(c.name) ? ' checked' : '';
            return `
                <label>
                    <input type="checkbox" value="${c.name}"${isChecked}>
                    ${sdEscapeAttr(c.name)}
                </label>
            `;
        }).join('');
}

// ---------- РЕНДЕРИНГ DROPDOWN ПРЕДМЕТОВ И УЧИТЕЛЕЙ ----------

/** Заполняет dropdown предметов из schoolData.subjects */
function populateSubjectDropdown() {
    const select = document.getElementById('combinedSubject');
    if (!select) { console.warn('[combined-lessons] populateSubjectDropdown: select not found'); return; }
    const catalogSubjects = (schoolData.subjects || []).map(s => s.name);
    const allTeachers = (schoolData.teachers || []);
    const subjectsFromTeachers = [];
    allTeachers.forEach(t => { (t.subjects || []).forEach(s => { const n = sdSubjectName(s); if (n && !subjectsFromTeachers.includes(n)) subjectsFromTeachers.push(n); }); });
    console.log('[combined-lessons] populateSubjectDropdown: schoolData.subjects:', catalogSubjects.length, 'catalogSubjects:', catalogSubjects, '| teachers with subjects:', subjectsFromTeachers.length, 'subjectsFromTeachers:', subjectsFromTeachers);
    const subjects = getSubjectCatalog();
    console.log('[combined-lessons] populateSubjectDropdown: result catalog length:', subjects.length, 'subjects:', subjects);
    select.innerHTML = '<option value="">-- Выберите предмет --</option>' +
        subjects.map(s => `<option value="${sdEscapeAttr(s)}">${sdEscapeAttr(s)}</option>`).join('');
}

/** Заполняет dropdown учителей из schoolData.teachers */
function populateTeacherDropdown() {
    const select = document.getElementById('combinedTeacher');
    if (!select) { console.warn('[combined-lessons] populateTeacherDropdown: select not found'); return; }
    console.log('[combined-lessons] populateTeacherDropdown: schoolData.teachers:', schoolData.teachers.length, schoolData.teachers.map(t => t.full_name));
    // Отладка: выводим структуру каждого учителя
    schoolData.teachers.forEach(t => console.log('[combined-lessons] Teacher object:', t));
    select.innerHTML = '<option value="">-- Выберите учителя --</option>' +
        schoolData.teachers
            .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'))
            .map(t => `<option value="${sdEscapeAttr(t.full_name)}">${sdEscapeAttr(t.full_name)}</option>`).join('');
    console.log('[combined-lessons] populateTeacherDropdown: rendered', schoolData.teachers.length, 'teachers, select options:', select.options.length);
}

/** При изменении предмета автоматически фильтрует учителей по предмету.
 * Если учитель имеет указанный предмет в списке subjects — он показывается.
 * Если у учителя НЕТ subjects (пустой массив или undefined) — он показывается всегда. */
function onCombinedSubjectChange() {
    const subject = document.getElementById('combinedSubject').value;
    const teacherSelect = document.getElementById('combinedTeacher');
    if (!teacherSelect) return;

    if (!subject) {
        // Предмет очищен — восстановить полный список учителей
        populateTeacherDropdown();
        validateCombinedForm();
        return;
    }

    // Фильтруем учителей, которые преподают выбранный предмет
    // Если у учителя нет subjects (пусто/undefined) — показываем его всегда
    const filtered = schoolData.teachers.filter(t => {
        const tSubjects = (t.subjects || []).map(sdSubjectName).filter(Boolean);
        // Если subjects пустой/undefined — показываем учителя (не фильтруем)
        if (tSubjects.length === 0) {
            console.log('[combined-lessons] Teacher', t.full_name, 'has no subjects, showing always');
            return true;
        }
        // Если subjects есть — фильтруем по выбранному предмету
        const match = tSubjects.includes(subject);
        console.log('[combined-lessons] Teacher', t.full_name, 'subjects:', tSubjects, 'match:', match);
        return match;
    });

    console.log('[combined-lessons] onCombinedSubjectChange: filtered teachers:', filtered.length, 'of', schoolData.teachers.length, 'for subject:', subject);

    teacherSelect.innerHTML = '<option value="">-- Выберите учителя --</option>' +
        filtered
            .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'))
            .map(t => `<option value="${sdEscapeAttr(t.full_name)}">${sdEscapeAttr(t.full_name)}</option>`).join('');
    
    // Обновить состояние валидации после изменения списка учителей
    validateCombinedForm();
}

/** Сброс фильтра учителей при очистке предмета */
function onCombinedSubjectClear() {
    const teacherSelect = document.getElementById('combinedTeacher');
    if (!teacherSelect) return;
    // Восстанавливаем полный список учителей
    populateTeacherDropdown();
    validateCombinedForm();
}

// ---------- ЗАГРУЗКА СУЩЕСТВУЮЩИХ ПРАВИЛ ИЗ API ----------

async function loadCombinedLessonsFromAPI() {
    try {
        const res = await fetch('/api/combined-lessons', {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (!res.ok) throw new Error(`Ошибка ${res.status}`);
        combinedLessons = await res.json();
        renderCombinedLessonsTable();
        console.log('✅ Загружено совмещённых правил:', combinedLessons.length);
    } catch (e) {
        console.error('❌ Ошибка загрузки совмещённых занятий:', e);
        showToast('⚠ Не удалось загрузить правила совмещённых занятий');
        // Используем локальные данные как fallback
        combinedLessons = schoolData.combined_lessons || [];
        renderCombinedLessonsTable();
    }
}

// ---------- ДОБАВЛЕНИЕ / ОБНОВЛЕНИЕ ПРАВИЛА ----------

/** Превращаем текстовое поле кабинета в dropdown
 * ВЫЗЫВАЕТСЯ при инициализации и при каждом переходе на шаг 4 */
function initClassroomDropdown() {
    const el = document.getElementById('combinedClassroom');
    if (!el) {
        console.warn('[combined-lessons] initClassroomDropdown: element #combinedClassroom not found');
        return;
    }

    const classrooms = schoolData.classrooms || [];
    console.log('[combined-lessons] initClassroomDropdown: found element, tag:', el.tagName, 'classrooms:', classrooms.length, classrooms);

    const isSelect = el.tagName === 'SELECT';
    const currentVal = isSelect ? el.value : el.value;

    // Если это INPUT — заменяем на SELECT (один раз)
    if (!isSelect) {
        console.log('[combined-lessons] initClassroomDropdown: replacing INPUT with SELECT');
        const parent = el.parentElement;
        if (!parent) {
            console.error('[combined-lessons] initClassroomDropdown: no parent element');
            return;
        }
        
        const select = document.createElement('select');
        select.id = 'combinedClassroom';
        select.className = el.className || '';
        select.innerHTML = '<option value="">-- Выберите кабинет --</option>' +
            classrooms.map(c => `<option value="${sdEscapeAttr(c.number)}"${currentVal === c.number ? ' selected' : ''}>${sdEscapeAttr(c.number)}${c.capacity ? ' (вм. ' + c.capacity + ')' : ''}</option>`).join('');
        
        parent.replaceChild(select, el);
        console.log('[combined-lessons] initClassroomDropdown: replaced input with select,', classrooms.length, 'options');
        return;
    }

    // Если это уже SELECT — обновляем опции
    el.innerHTML = '<option value="">-- Выберите кабинет --</option>' +
        classrooms.map(c => `<option value="${sdEscapeAttr(c.number)}"${currentVal === c.number ? ' selected' : ''}>${sdEscapeAttr(c.number)}${c.capacity ? ' (вм. ' + c.capacity + ')' : ''}</option>`).join('');
    console.log('[combined-lessons] initClassroomDropdown: updated select with', classrooms.length, 'options');
}

// Запускаем однужды при загрузке страницы (для первичной инициализации)
(function _initClassroomDropdownOnLoad() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initClassroomDropdown);
    } else {
        initClassroomDropdown();
    }
})();

async function saveCombinedLesson() {
    const name = document.getElementById('combinedName').value.trim();
    const subject = document.getElementById('combinedSubject').value;
    const teacher = document.getElementById('combinedTeacher').value;
    const classroom = document.getElementById('combinedClassroom').value.trim();
    const hours = parseFloat(document.getElementById('combinedHours').value) || 1;
    const weekIndexRaw = document.getElementById('combinedWeek').value;
    const weekIndex = weekIndexRaw === '' ? null : parseInt(weekIndexRaw, 10);
    const classes = getSelectedClasses();

    // ---- ВАЛИДАЦИЯ ----
    if (!name) { alert('Введите название правила'); return; }
    if (!subject) { alert('Выберите предмет'); return; }
    if (!teacher) { alert('Выберите учителя'); return; }
    if (classes.length < 2) { alert('Выберите минимум 2 класса для совмещения'); return; }

    // Проверка дубликатов (имя + предмет + неделимые классы)
    const duplicateIdx = combinedLessons.findIndex(
        r => r.name === name && r.subject === subject &&
             JSON.stringify(r.classes.sort()) === JSON.stringify(classes.sort())
    );
    if (duplicateIdx !== -1 && !(editingCombinedLessonId && combinedLessons[duplicateIdx].id === editingCombinedLessonId)) {
        alert('Правило с таким названием и набором классов уже существует!');
        return;
    }

    // Определяем endpoint: PUT для обновления, POST для создания
    let url;
    if (editingCombinedLessonId) {
        url = `/api/combined-lessons/${editingCombinedLessonId}`;
    } else {
        url = '/api/combined-lessons';
    }

    const payload = {
        name,
        subject,
        teacher,
        classroom,
        classes,
        hours,
        weekIndex,
        is_active: true
    };

    try {
        const res = await fetch(url, {
            method: editingCombinedLessonId ? 'PUT' : 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getToken()
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error(`Ошибка ${res.status}`);
        const saved = await res.json();

        // Обновляем локальный список
        if (editingCombinedLessonId) {
            const idx = combinedLessons.findIndex(r => r.id === editingCombinedLessonId);
            if (idx !== -1) combinedLessons[idx] = saved;
            showToast('✅ Правило обновлено');
        } else {
            combinedLessons.push(saved);
            showToast('✅ Правило добавлено');
        }

        // Очищаем форму
        resetCombinedLessonForm();
        renderCombinedLessonsTable();
    } catch (e) {
        console.error('❌ Ошибка сохранения правила:', e);
        alert('Не удалось сохранить: ' + e.message);
    }
}

// ---------- УДАЛЕНИЕ ПРАВИЛА ----------

async function deleteCombinedLesson(id) {
    if (!confirm('Удалить это правило совмещённого занятия?')) return;

    try {
        const res = await fetch(`/api/combined-lessons/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (!res.ok) throw new Error(`Ошибка ${res.status}`);

        combinedLessons = combinedLessons.filter(r => r.id !== id);
        showToast('✅ Правило удалено');
        renderCombinedLessonsTable();
    } catch (e) {
        console.error('❌ Ошибка удаления:', e);
        alert('Не удалось удалить: ' + e.message);
    }
}

// ---------- РЕДАКТИРОВАНИЕ ПРАВИЛА ----------

function editCombinedLesson(id) {
    const rule = combinedLessons.find(r => r.id === id);
    if (!rule) return;

    editingCombinedLessonId = id;

    // Заполняем поля формы
    document.getElementById('combinedName').value = rule.name;
    document.getElementById('combinedSubject').value = rule.subject;
    document.getElementById('combinedTeacher').value = rule.teacher;
    document.getElementById('combinedClassroom').value = rule.classroom || '';
    document.getElementById('combinedHours').value = rule.hours;

    // Неделя
    const weekEl = document.getElementById('combinedWeek');
    weekEl.value = rule.weekIndex != null ? rule.weekIndex : '';

    // Классы — выбираем чекбоксы
    setTimeout(() => {
        document.querySelectorAll('#combinedClassChecks input[type="checkbox"]')
            .forEach(cb => cb.checked = rule.classes.includes(cb.value));
    }, 0);

    // Меняем текст кнопки
    document.getElementById('combinedSaveBtn').textContent = '💾 Сохранить изменения';
    document.getElementById('combinedCancelEditBtn').style.display = 'inline-block';

    // Прокручиваем к форме
    document.getElementById('combinedFormCard').scrollIntoView({ behavior: 'smooth' });
}

/** Сбрасывает форму в режим добавления */
function resetCombinedLessonForm() {
    editingCombinedLessonId = null;
    document.getElementById('combinedName').value = '';
    document.getElementById('combinedSubject').value = '';
    document.getElementById('combinedTeacher').value = '';
    document.getElementById('combinedClassroom').value = '';
    document.getElementById('combinedHours').value = '1';
    document.getElementById('combinedWeek').value = '';
    document.getElementById('combinedClassChecks').querySelectorAll('input[type="checkbox"]')
        .forEach(cb => cb.checked = false);
    document.getElementById('combinedSaveBtn').textContent = '➕ Добавить правило';
    document.getElementById('combinedCancelEditBtn').style.display = 'none';
    // Сброс валидации — показать подсказку
    validateCombinedForm();
}


// ---------- ОБРАБОТЧИКИ СОБЫТИЙ ФОРМЫ ----------

/** Обновление подсказки валидации при изменении чекбоксов */
document.addEventListener('change', function(e) {
    // Валидация при изменении чекбоксов классов
    if (e.target && e.target.type === 'checkbox' && e.target.closest('#combinedClassChecks')) {
        validateCombinedForm();
    }
    // Валидация при изменении учителя
    if (e.target && e.target.id === 'combinedTeacher') {
        validateCombinedForm();
    }
    // Валидация при изменении кабинета
    if (e.target && e.target.id === 'combinedClassroom') {
        validateCombinedForm();
    }
    // Валидация при изменении недели
    if (e.target && e.target.id === 'combinedWeek') {
        validateCombinedForm();
    }
});

/** Подсказка валидации формы совмещённых занятий */
function validateCombinedForm() {
    const subject = document.getElementById('combinedSubject').value;
    const teacher = document.getElementById('combinedTeacher').value;
    const checks = document.querySelectorAll('#combinedClassChecks input[type=\x22checkbox\x22]:checked');
    const classCount = checks.length;
    const saveBtn = document.getElementById('combinedSaveBtn');
    const hintEl = document.getElementById('combinedFormHint');

    const isValid = subject && teacher && classCount >= 2;

    if (saveBtn) {
        saveBtn.disabled = !isValid;
        saveBtn.style.opacity = isValid ? '1' : '0.5';
        saveBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';
    }

    if (hintEl) {
        if (!subject) {
            hintEl.textContent = '\u26a0\ufe0f Выберите предмет';
            hintEl.style.color = '#c33';
        } else if (!teacher) {
            hintEl.textContent = '\u26a0\ufe0f Выберите учителя';
            hintEl.style.color = '#c33';
        } else if (classCount < 2) {
            hintEl.textContent = '\u26a0\ufe0f Выбрано классов: ' + classCount + '. Нужно минимум 2 для совмещения';
            hintEl.style.color = '#c33';
        } else {
            hintEl.textContent = '\u2705 Форма заполнена корректно';
            hintEl.style.color = '#2a9';
        }
    }
}

document.addEventListener('click', function(e) {
    // Кнопка отмены редактирования
    if (e.target.id === 'combinedCancelEditBtn') {
        resetCombinedLessonForm();
    }
});

// ---------- РЕНДЕРИНГ ТАБЛИЦЫ ПРАВИЛ ----------

function renderCombinedLessonsTable() {
    const tbody = document.getElementById('combinedLessonsTableBody');
    if (!tbody) return;

    if (combinedLessons.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted">Правил совмещённых занятий пока нет</td></tr>';
        return;
    }

    tbody.innerHTML = combinedLessons.map(rule => {
        const classesText = (rule.classes || []).join(', ');       
        const weekText = weekSelectLabel(rule.weekIndex);
        return `
            <tr>
                <td><strong>${sdEscapeAttr(rule.name)}</strong></td>
                <td>${sdEscapeAttr(rule.subject)}</td>
                <td>${sdEscapeAttr(rule.teacher)}</td>
                <td>${sdEscapeAttr(classesText)}</td>
                <td>${rule.hours} ч</td>
                <td>${weekText}</td>
                <td>
                    <button class="small" onclick="editCombinedLesson(${rule.id})" title="Редактировать">
                        ✏️ Изменить
                    </button>
                    <button class="small danger" onclick="deleteCombinedLesson(${rule.id})" title="Удалить">
                        🗑 Удалить
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// ---------- ПОЛУЧЕНИЕ СПИСКА ДЛЯ ГЕНЕРАЦИИ ----------

/** Возвращает массив правил для передачи в бэкенд при генерации расписания */
function getCombinedLessonsForGeneration() {
    return combinedLessons.map(r => ({
        id: r.id,
        name: r.name,
        subject: r.subject,
        teacher: r.teacher,
        classroom: r.classroom || '',
        classes: r.classes,
        hours: r.hours,
        week_index: r.weekIndex,
        is_active: r.is_active !== false
    }));
}

// ---------- ТЕСТИРОВЫЕ ДАННЫЕ ----------

/** Создаёт несколько тестовых правил для демонстрации функциональности */
async function seedTestCombinedLessons() {
    // Проверяем, есть ли уже правила
    if (combinedLessons.length > 0) return;

    const testRules = [
        {
            name: 'Музыка: 1-е классы',
            subject: 'Музыка',
            teacher: 'Иванова А.А.',
            classroom: 'муз.зал',
            classes: ['1А', '1Б'],
            hours: 1,
            weekIndex: null
        },
        {
            name: 'Физкультура: 5-е классы',
            subject: 'Физкультура',
            teacher: 'Петров В.В.',
            classroom: 'спортзал',
            classes: ['5А', '5Б'],
            hours: 2,
            weekIndex: null
        },
        {
            name: 'ИЗО: 3-е классы',
            subject: 'ИЗО',
            teacher: 'Сидорова М.М.',
            classroom: 'арт.студия',
            classes: ['3А', '3Б', '3В'],
            hours: 1,
            weekIndex: null
        }
    ];

    for (const rule of testRules) {
        try {
            const res = await fetch('/api/combined-lessons', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken()
                },
                body: JSON.stringify({ ...rule, is_active: true })
            });
            if (res.ok) {
                const saved = await res.json();
                combinedLessons.push(saved);
            }
        } catch (e) {
            console.warn('⚠ Не удалось создать тестовое правило:', rule.name, e);
        }
    }

    // Перезагружаем данные
    await loadCombinedLessonsFromAPI();
}

// ---------- ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ ----------
window.loadCombinedLessonsFromAPI = loadCombinedLessonsFromAPI;
window.saveCombinedLesson = saveCombinedLesson;
window.deleteCombinedLesson = deleteCombinedLesson;
window.editCombinedLesson = editCombinedLesson;
window.resetCombinedLessonForm = resetCombinedLessonForm;
window.renderCombinedLessonsTable = renderCombinedLessonsTable;
window.renderCombinedLessonClassCheckboxes = renderCombinedLessonClassCheckboxes;
window.initClassroomDropdown = initClassroomDropdown;
window.populateSubjectDropdown = populateSubjectDropdown;
window.populateTeacherDropdown = populateTeacherDropdown;
window.onCombinedSubjectClear = onCombinedSubjectClear;
window.validateCombinedForm = validateCombinedForm;
window.onCombinedSubjectChange = onCombinedSubjectChange;
window.getCombinedLessonsForGeneration = getCombinedLessonsForGeneration;
window.seedTestCombinedLessons = seedTestCombinedLessons;
window.combinedLessons = combinedLessons;
window.editingCombinedLessonId = editingCombinedLessonId;

console.log('📦 Module: combined-lessons.js loaded');
