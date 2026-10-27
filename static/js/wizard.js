// ============================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================================
let currentEditorMode = 'editor';
let topicsSaveTimeout = null;
let pendingTopicUpdates = [];
let saveIndicatorTimeout = null;

// История Undo (общая для editor.js и wizard.js)
if (!window.undoHistory) {
    window.undoHistory = [];
}

// ============================================================
// НАВИГАЦИЯ ПО КЛИКУ НА ВКЛАДКИ
// ============================================================
document.addEventListener('click', function(e) {
    const step = e.target.closest('.wizard-step');
    if (step && step.dataset.step) {
        const targetStep = parseInt(step.dataset.step);
        if (targetStep && targetStep !== currentStep) {
            if (canNavigateToStep(targetStep)) {
                goToStep(targetStep);
            } else {
                alert('⚠ Сначала завершите текущий шаг и нажмите "Далее"');
            }
        }
    }
});

function canNavigateToStep(targetStep) {
    if (targetStep < currentStep) return true;
    if (targetStep === currentStep + 1) {
        return isCurrentStepComplete();
    }
    return false;
}

function isCurrentStepComplete() {
    switch(currentStep) {
        case 1:
            return schoolData.name && schoolData.days && schoolData.lessonsPerDay;
        case 2:
            return schoolData.classes.length > 0 && schoolData.teachers.length > 0;
        case 3:
            return schoolData.workloads.length > 0;
        case 4:
            return currentResult !== null;
        case 5:
            return true;
        default:
            return false;
    }
}

// ============================================================
// НАВИГАЦИЯ ПО МАСТЕРУ
// ============================================================
async function goToStep(step) {
    // показываем страницу мастера в новой оболочке
    if (typeof openPage === 'function' && document.getElementById('page-wizard')) {
        openPage('wizard');
    }
    document.querySelectorAll('.wizard-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.wizard-step').forEach((s, i) => {
        s.classList.remove('active');
        if (i + 1 < step) s.classList.add('completed');
        else s.classList.remove('completed');
    });
    document.getElementById('step' + step).classList.add('active');
    const stepElements = document.querySelectorAll('.wizard-step');
    if (stepElements[step - 1]) {
        stepElements[step - 1].classList.add('active');
    }
    currentStep = step;
    console.log(`Переход на шаг ${step}`);

    if (step === 1) {
        restoreStep1Fields();
    }
    if (step === 2) {
        renderClasses();
        renderTeachers();
        renderSubjects();
        renderClassrooms();
    }
    if (step === 3) {
        updateTeacherSelect();
        updateTeacherDatalist();
        const selectedTeacher = document.getElementById('teacherSelect').value;
        renderAvailabilityGrid(selectedTeacher);
        if (selectedTeacher) {
            renderTeacherLoadStats(selectedTeacher);
        }
    }
    if (step === 4) {
        loadSavedTimetables();
        if (currentResult && currentResult.teachers) {
            renderGenerationStats();
        }
    }

    if (step === 5) {
        console.log("🔍 Проверка данных для редактора...");
        if (!currentResult || !currentResult.teachers || !currentTimetableId) {
            console.warn("⚠ Данные или ID отсутствуют. Загружаю последнее расписание...");
            try {
                const res = await fetch('/timetables', {
                    headers: { 'Authorization': 'Bearer ' + getToken() }
                });
                if (res.ok) {
                    const timetables = await res.json();
                    if (timetables && timetables.length > 0) {
                        const latest = timetables[0];
                        console.log(`Загружаю ID: ${latest.id}`);
                        const fullRes = await fetch(`/timetables/${latest.id}`, {
                            headers: { 'Authorization': 'Bearer ' + getToken() }
                        });
                        if (fullRes.ok) {
                            const data = await fullRes.json();
                            if (data && data.data) {
                                currentResult = data.data;
                                currentTimetableId = latest.id;
                                // Очищаем историю Undo при загрузке нового расписания
                                window.undoHistory = [];
                                if (typeof updateUndoButtonState === 'function') updateUndoButtonState();
                                console.log("✅ Данные и ID успешно восстановлены!");
                            }
                        }
                    } else {
                        alert('Сначала сгенерируйте расписание на Шаге 4!');
                        goToStep(4);
                        return;
                    }
                }
            } catch (e) {
                console.error("❌ Ошибка загрузки:", e);
                alert('Не удалось загрузить расписание.');
                return;
            }
        }
        if (currentResult && currentResult.teachers && currentTimetableId) {
            console.log(" Рендеринг таблицы редактора...");
            updateEditorClassFilter();
            if (currentEditorMode === 'topics') {
                await loadFreshTimetableData();
                renderTopicsEditor();
            } else {
                renderGlobalEditor();
            }
        } else {
            document.getElementById('globalEditorContainer').innerHTML =
                '<p style="padding:20px;text-align:center;color:#c33">Ошибка: Нет данных.</p>';
        }
    }
}

const DEFAULT_LESSON_TIMES = [
    "08:30-09:15", "09:25-10:10", "10:20-11:05", "11:25-12:10",
    "12:20-13:05", "13:15-14:00", "14:10-14:55", "15:05-15:50",
    "16:00-16:45", "16:55-17:40"
];

function _splitTimeRange(range) {
    if (typeof range === 'string' && range.indexOf('-') !== -1) {
        const parts = range.split('-');
        return [parts[0].trim(), parts[1].trim()];
    }
    return ['', ''];
}

// Строки времени уроков: для каждого урока — поля «начало» и «окончание»
function renderLessonTimeRows() {
    const container = document.getElementById('lessonTimesContainer');
    if (!container) return;
    const counter = document.getElementById('lessonsPerDay');
    const count = counter ? (parseInt(counter.value) || 7) : 7;
    const saved = (schoolData.lessonTimes && schoolData.lessonTimes.length) ? schoolData.lessonTimes : [];
    let html = '<div class="lesson-time-row lesson-time-head">' +
        '<span class="lesson-time-label"></span>' +
        '<span class="lt-col">Начало</span>' +
        '<span class="lesson-time-dash">–</span>' +
        '<span class="lt-col">Окончание</span>' +
        '</div>';
    for (let i = 0; i < count; i++) {
        const [start, end] = _splitTimeRange(saved[i] || DEFAULT_LESSON_TIMES[i] || '');
        html += `
            <div class="lesson-time-row">
                <span class="lesson-time-label">Урок ${i + 1}</span>
                <input type="time" class="lt-start" value="${start}" aria-label="Урок ${i + 1}: начало">
                <span class="lesson-time-dash">–</span>
                <input type="time" class="lt-end" value="${end}" aria-label="Урок ${i + 1}: окончание">
            </div>`;
    }
    container.innerHTML = html;
}

function collectLessonTimes() {
    const rows = document.querySelectorAll('#lessonTimesContainer .lesson-time-row:not(.lesson-time-head)');
    const times = [];
    rows.forEach(row => {
        const startEl = row.querySelector('.lt-start');
        const endEl = row.querySelector('.lt-end');
        const start = startEl ? startEl.value : '';
        const end = endEl ? endEl.value : '';
        times.push((start && end) ? `${start}-${end}` : '');
    });
    return times;
}

function completeStep(step) {
    if (step === 1) {
        schoolData.name = document.getElementById('schoolName').value;
        schoolData.days = parseInt(document.getElementById('daysPerWeek').value);
        schoolData.lessonsPerDay = parseInt(document.getElementById('lessonsPerDay').value);
        schoolData.lessonTimes = collectLessonTimes();
    }
    saveSchoolData();
    goToStep(step + 1);
}

function restoreStep1Fields() {
    if (!schoolData) return;
    const nameField = document.getElementById('schoolName');
    const daysField = document.getElementById('daysPerWeek');
    const lessonsField = document.getElementById('lessonsPerDay');

    if (nameField && schoolData.name) nameField.value = schoolData.name;
    if (daysField && schoolData.days) daysField.value = schoolData.days;
    if (lessonsField && schoolData.lessonsPerDay) lessonsField.value = schoolData.lessonsPerDay;
    renderLessonTimeRows();
}

// ============================================================
// СПРАВОЧНИКИ (ШАГ 2)
// ============================================================
function showRefTab(tab) {
    document.querySelectorAll('.reference-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.reference-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('ref-' + tab).classList.add('active');
    event.target.classList.add('active');
    if (tab === 'classes') renderClasses();
    if (tab === 'teachers') renderTeachers();
    if (tab === 'subjects') renderSubjects();
    if (tab === 'classrooms') renderClassrooms();
}

function addClass() {
    const name = document.getElementById('newClassName').value.trim();
    const warning = document.getElementById('classDuplicateWarning');
    if (!name) { alert('Введите название класса'); return; }
    const exists = schoolData.classes.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) {
        if (warning) {
            warning.classList.add('show');
            setTimeout(() => warning.classList.remove('show'), 3000);
        }
        return;
    }
    const match = name.match(/(\d+)([А-Яа-я]?)/);
    schoolData.classes.push({
        name,
        grade: match ? parseInt(match[1]) : 0,
        letter: match ? match[2] : ''
    });
    renderClasses();
    saveSchoolData();
    document.getElementById('newClassName').value = '';
}

function renderClasses() {
    document.getElementById('classesTable').innerHTML = schoolData.classes.map((c, i) =>
        `<tr><td>${c.name}</td><td>${c.grade}</td><td><button class="small danger" onclick="removeClass(${i})">🗑 Удалить</button></td></tr>`
    ).join('');
}

function removeClass(i) {
    schoolData.classes.splice(i, 1);
    renderClasses();
    saveSchoolData();
}

function addTeacher() {
    const name = document.getElementById('newTeacherName').value.trim();
    const warning = document.getElementById('teacherDuplicateWarning');
    if (!name) { alert('Введите ФИО учителя'); return; }
    const exists = schoolData.teachers.some(t => t.full_name.toLowerCase() === name.toLowerCase());
    if (exists) {
        if (warning) {
            warning.classList.add('show');
            setTimeout(() => warning.classList.remove('show'), 3000);
        } else {
            alert('Такой учитель уже существует!');
        }
        return;
    }
    schoolData.teachers.push({
        full_name: name,
        email: '',
        subjects: []
    });
    renderTeachers();
    saveSchoolData();
    document.getElementById('newTeacherName').value = '';
    updateTeacherDatalist();
}

function sdEscapeAttr(value) {
    return String(value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function sdSubjectName(s) {
    return typeof s === 'string' ? s : (s?.name || s?.title || '');
}

function getSubjectCatalog() {
    const names = new Set();
    const catalog = schoolData.subjects || [];
    catalog.forEach(s => {
        const name = sdSubjectName(s);
        if (name) names.add(name);
    });
    (schoolData.teachers || []).forEach(t => {
        (t.subjects || []).forEach(s => {
            const name = sdSubjectName(s);
            if (name) names.add(name);
        });
    });
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}

function subjectsButtonHtml(teacher, teacherIndex) {
    const chosen = (teacher.subjects || []).map(sdSubjectName).filter(Boolean);
    const title = chosen.join(', ') || 'Предметы не выбраны';
    let inner = 'Не выбраны';
    if (chosen.length) {
        inner = sdEscapeAttr(chosen[0]);
        if (chosen.length > 1) {
            inner += ` <span class="subjects-more">+${chosen.length - 1}</span>`;
        }
    }
    return `
        <button type="button"
                class="subjects-toggle ${chosen.length ? 'has-subjects' : ''}"
                data-subjects-toggle
                data-teacher-id="${sdEscapeAttr(teacherIndex)}"
                aria-haspopup="true"
                aria-expanded="false"
                title="${sdEscapeAttr(title)}">
            <span class="subjects-toggle-text">${inner}</span>
            <span class="subjects-caret" aria-hidden="true">▾</span>
        </button>
    `;
}

function renderTeachers() {
    const tbody = document.getElementById('teachersTable');
    if (!tbody) return;
    tbody.innerHTML = schoolData.teachers.map((t, i) => {
        return `<tr>
            <td style="font-weight:500;">${t.full_name}</td>
            <td>
                <input type="email" value="${t.email || ''}"
                       onchange="updateTeacherEmail(${i}, this.value)"
                       placeholder="email@school.ru"
                       style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;">
            </td>
            <td>
                <button class="small danger" onclick="removeTeacher(${i})" title="Удалить учителя" aria-label="Удалить учителя">🗑</button>
            </td>
        </tr>`;
    }).join('');
}

function updateTeacherSubjects(teacherIndex, subjectsArray) {
    const teacher = schoolData.teachers[teacherIndex];
    if (!teacher) return;
    teacher.subjects = subjectsArray;
    saveSchoolData();
}

function updateTeacherEmail(teacherIndex, newEmail) {
    schoolData.teachers[teacherIndex].email = newEmail;
    saveSchoolData();
}

function removeTeacher(i) {
    if (confirm('Удалить учителя?')) {
        schoolData.teachers.splice(i, 1);
        renderTeachers();
        saveSchoolData();
        updateTeacherDatalist();
    }
}

function addSubject() {
    const name = document.getElementById('newSubjectName').value.trim();
    const category = document.getElementById('newSubjectCategory').value;
    const warning = document.getElementById('subjectDuplicateWarning');
    if (!name) { alert('Введите название предмета'); return; }
    const exists = schoolData.subjects.some(s => s.name.toLowerCase() === name.toLowerCase());
    if (exists) {
        if (warning) {
            warning.classList.add('show');
            setTimeout(() => warning.classList.remove('show'), 3000);
        }
        return;
    }
    schoolData.subjects.push({ name, category });
    renderSubjects();
    renderTeachers();
    saveSchoolData();
    document.getElementById('newSubjectName').value = '';
}

function renderSubjects() {
    document.getElementById('subjectsTable').innerHTML = schoolData.subjects.map((s, i) =>
        `<tr>
            <td>${s.name}</td>
            <td><span style="background:#eef;padding:2px 6px;border-radius:4px;font-size:12px;">${s.category || 'Основной'}</span></td>
            <td><button class="small danger" onclick="removeSubject(${i})">🗑 Удалить</button></td>
        </tr>`
    ).join('');
}

function removeSubject(i) {
    const subjectName = schoolData.subjects[i].name;
    schoolData.teachers.forEach(t => {
        t.subjects = (t.subjects || []).filter(s => {
            const sName = typeof s === 'string' ? s : (s?.name || '');
            return sName !== subjectName;
        });
    });
    // убираем предмет из назначений «учитель → класс → предметы»
    if (schoolData.teacherAssignments) {
        Object.values(schoolData.teacherAssignments).forEach(items => {
            items.forEach(it => {
                it.subjects = (it.subjects || []).filter(s => s !== subjectName);
            });
        });
    }
    schoolData.subjects.splice(i, 1);
    renderSubjects();
    renderTeachers();
    saveSchoolData();
}

function addClassroom() {
    const number = document.getElementById('newClassroomNumber').value.trim();
    const capacity = document.getElementById('newClassroomCapacity').value;
    const warning = document.getElementById('classroomDuplicateWarning');
    if (!number) { alert('Введите номер кабинета'); return; }
    const exists = schoolData.classrooms.some(c => c.number.toLowerCase() === number.toLowerCase());
    if (exists) {
        if (warning) {
            warning.classList.add('show');
            setTimeout(() => warning.classList.remove('show'), 3000);
        }
        return;
    }
    schoolData.classrooms.push({ number, capacity: capacity ? parseInt(capacity) : null });
    renderClassrooms();
    saveSchoolData();
    document.getElementById('newClassroomNumber').value = '';
    document.getElementById('newClassroomCapacity').value = '';
}

function renderClassrooms() {
    document.getElementById('classroomsTable').innerHTML = schoolData.classrooms.map((c, i) =>
        `<tr><td>${c.number}</td><td>${c.capacity || '-'}</td><td><button class="small danger" onclick="removeClassroom(${i})">🗑 Удалить</button></td></tr>`
    ).join('');
}

function removeClassroom(i) {
    schoolData.classrooms.splice(i, 1);
    renderClassrooms();
    saveSchoolData();
}

function importFromExcel() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.style.display = 'none';
    input.onchange = () => {
        const file = input.files && input.files[0];
        if (file) uploadExcel(file);
        document.body.removeChild(input);
    };
    document.body.appendChild(input);
    input.click();
}

async function uploadExcel(file) {
    const form = new FormData();
    form.append('file', file);
    try {
        const res = await fetch('/api/import-excel', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + getToken() },
            body: form
        });
        if (!res.ok) {
            let msg = 'Ошибка ' + res.status;
            try {
                const err = await res.json();
                if (err && err.detail) msg = err.detail;
            } catch (_) { /* ignore */ }
            throw new Error(msg);
        }
        const data = await res.json();
        applyImportedReferences(data);
    } catch (e) {
        alert('Не удалось импортировать: ' + e.message);
    }
}

function applyImportedReferences(data) {
    let added = 0;

    (data.classes || []).forEach(raw => {
        const name = String(raw).trim();
        if (!name) return;
        if (schoolData.classes.some(c => c.name.toLowerCase() === name.toLowerCase())) return;
        const match = name.match(/(\d+)([А-Яа-яA-Za-z]?)/);
        schoolData.classes.push({ name: name, grade: match ? parseInt(match[1]) : 0, letter: match ? match[2] : '' });
        added++;
    });

    (data.teachers || []).forEach(raw => {
        const name = String(raw).trim();
        if (!name) return;
        if (schoolData.teachers.some(t => t.full_name.toLowerCase() === name.toLowerCase())) return;
        schoolData.teachers.push({ full_name: name, email: '', subjects: [] });
        added++;
    });

    (data.subjects || []).forEach(raw => {
        const name = (typeof raw === 'string') ? raw.trim() : ((raw && raw.name) ? String(raw.name).trim() : '');
        if (!name) return;
        if (schoolData.subjects.some(s => s.name.toLowerCase() === name.toLowerCase())) return;
        schoolData.subjects.push({ name: name, category: (raw && raw.category) || 'Основной' });
        added++;
    });

    (data.classrooms || []).forEach(raw => {
        const number = (typeof raw === 'string') ? raw.trim() : ((raw && raw.number) ? String(raw.number).trim() : '');
        if (!number) return;
        if (schoolData.classrooms.some(c => c.number.toLowerCase() === number.toLowerCase())) return;
        schoolData.classrooms.push({ number: number, capacity: (raw && raw.capacity) || null });
        added++;
    });

    saveSchoolData();
    renderClasses();
    renderTeachers();
    renderSubjects();
    renderClassrooms();
    updateTeacherDatalist();
    updateTeacherSelect();

    if (typeof logActivity === 'function') {
        logActivity('Импорт из Excel: добавлено ' + added + ' записей');
    }

    const summary =
        'Классы: ' + (data.classes || []).length +
        ', учителя: ' + (data.teachers || []).length +
        ', предметы: ' + (data.subjects || []).length +
        ', кабинеты: ' + (data.classrooms || []).length;
    alert('✅ Импорт завершён.\n' + summary + (added ? '' : '\nНовых записей нет — всё уже было.'));
}

function downloadImportTemplate() {
    fetch('/api/import-template', { headers: { 'Authorization': 'Bearer ' + getToken() } })
        .then(res => {
            if (!res.ok) throw new Error('Ошибка ' + res.status);
            return res.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'shablon_importa.xlsx';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        })
        .catch(e => alert('Не удалось скачать шаблон: ' + e.message));
}

function updateTeacherSelect() {
    const select = document.getElementById('teacherSelect');
    select.innerHTML = '<option value="">-- Выберите учителя --</option>' +
        schoolData.teachers.map(t => `<option value="${t.full_name}">${t.full_name}</option>`).join('');
}

function updateTeacherDatalist() {
    const datalist = document.getElementById('teacherDatalist');
    if (datalist) datalist.innerHTML = schoolData.teachers.map(t => `<option value="${t.full_name}">`).join('');
    const classDatalist = document.getElementById('classDatalist');
    if (classDatalist) classDatalist.innerHTML = (schoolData.classes || []).map(c => `<option value="${c.name}">`).join('');
}

// ============================================================
// НАЗНАЧЕНИЯ «УЧИТЕЛЬ → КЛАССЫ → ПРЕДМЕТЫ» (ВКЛАДКА «ПРЕДМЕТЫ»)
// ============================================================
function ensureTeacherExistsSilent(name) {
    if (!name) return;
    if (!schoolData.teachers.find(t => t.full_name.toLowerCase() === name.toLowerCase())) {
        schoolData.teachers.push({ full_name: name, email: '', subjects: [] });
        renderTeachers();
        updateTeacherSelect();
        updateTeacherDatalist();
        saveSchoolData();
    }
}

function getTeacherAssignments(teacher) {
    if (!schoolData.teacherAssignments) schoolData.teacherAssignments = {};
    if (!schoolData.teacherAssignments[teacher]) schoolData.teacherAssignments[teacher] = [];
    return schoolData.teacherAssignments[teacher];
}

function loadAssignmentCard() {
    const input = document.getElementById('assignTeacher');
    const teacher = input ? input.value.trim() : '';
    const card = document.getElementById('assignmentCard');
    if (!card) return;
    if (!teacher) { card.style.display = 'none'; return; }
    ensureTeacherExistsSilent(teacher);
    getTeacherAssignments(teacher);
    card.style.display = 'block';
    renderAssignmentList(teacher);
}

function renderAssignmentList(teacher) {
    const container = document.getElementById('assignmentList');
    if (!container) return;
    const items = getTeacherAssignments(teacher);
    if (!items.length) {
        container.innerHTML = '<p style="color:#999;padding:8px">Классы не добавлены. Нажмите «+ Добавить класс».</p>';
        return;
    }
    const subjects = (schoolData.subjects || []).map(s => s.name);
    container.innerHTML = items.map((it, i) => `
        <div class="assignment-block">
            <div class="assignment-head">
                <div class="form-group" style="margin:0;">
                    <label>Класс</label>
                    <input type="text" value="${sdEscapeAttr(it.grade || '')}" list="classDatalist"
                           placeholder="5А" onchange="updateAssignmentGrade(${i}, this.value)"
                           aria-label="Класс ${i + 1}">
                </div>
                <button class="small danger" onclick="removeAssignmentClass(${i})" title="Удалить класс" aria-label="Удалить класс">🗑</button>
            </div>
            <div class="form-group">
                <label>Предметы в этом классе</label>
                <div class="checkbox-group">
                    ${subjects.length
                        ? subjects.map(s => `<label><input type="checkbox" ${(it.subjects || []).includes(s) ? 'checked' : ''} onchange="toggleAssignmentSubject(${i}, '${sdEscapeAttr(s)}', this.checked)"> ${sdEscapeAttr(s)}</label>`).join('')
                        : '<span style="color:#999;font-size:13px">Сначала добавьте предметы выше</span>'}
                </div>
            </div>
        </div>
    `).join('');
}

function addAssignmentClass() {
    const teacher = document.getElementById('assignTeacher').value.trim();
    if (!teacher) { alert('Сначала введите учителя'); return; }
    getTeacherAssignments(teacher).push({ grade: '', subjects: [] });
    renderAssignmentList(teacher);
    saveSchoolData();
}

function removeAssignmentClass(i) {
    const teacher = document.getElementById('assignTeacher').value.trim();
    getTeacherAssignments(teacher).splice(i, 1);
    renderAssignmentList(teacher);
    saveSchoolData();
}

function updateAssignmentGrade(i, value) {
    const teacher = document.getElementById('assignTeacher').value.trim();
    const items = getTeacherAssignments(teacher);
    if (items[i]) { items[i].grade = value; saveSchoolData(); }
}

function toggleAssignmentSubject(i, subject, checked) {
    const teacher = document.getElementById('assignTeacher').value.trim();
    const items = getTeacherAssignments(teacher);
    if (!items[i]) return;
    items[i].subjects = items[i].subjects || [];
    const pos = items[i].subjects.indexOf(subject);
    if (checked && pos === -1) items[i].subjects.push(subject);
    if (!checked && pos !== -1) items[i].subjects.splice(pos, 1);
    saveSchoolData();
}

// ============================================================
// КОНТРОЛЬ НАГРУЗКИ УЧИТЕЛЯ (ШАГ 3)
// ============================================================
function getPlannedHours(teacherName) {
    const workloads = schoolData.workloads.filter(w => w.teacher === teacherName);
    return workloads.reduce((sum, w) => sum + (parseInt(w.hours) || 0), 0);
}

function getActualHours(teacherName) {
    if (!currentResult || !currentResult.teachers) return null;
    const teacher = currentResult.teachers.find(t => t.teacher === teacherName);
    if (!teacher) return 0;
    return teacher.total_lessons || 0;
}

function getLoadStatus(planned, actual) {
    if (actual === null) return { text: 'Нет данных', class: 'load-unknown', icon: '⏳' };
    if (actual === 0 && planned > 0) return { text: 'Не назначено', class: 'load-under', icon: '⚠️' };
    if (actual < planned) return { text: 'Недогруз', class: 'load-under', icon: '⚠️' };
    if (actual > planned) return { text: 'Перегруз', class: 'load-over', icon: '❌' };
    return { text: 'Норма', class: 'load-ok', icon: '✅' };
}

function renderTeacherLoadStats(teacherName) {
    const container = document.getElementById('teacherLoadStats');
    if (!container) return;

    if (!teacherName) {
        container.innerHTML = '<p style="color:#999;text-align:center;padding:10px">Выберите учителя для просмотра нагрузки</p>';
        return;
    }

    const plannedHours = getPlannedHours(teacherName);
    const actualHours = getActualHours(teacherName);
    const status = getLoadStatus(plannedHours, actualHours);

    const workloads = schoolData.workloads.filter(w => w.teacher === teacherName);
    let detailsHtml = '';

    if (workloads.length > 0) {
        detailsHtml = '<div class="load-details">';
        workloads.forEach(w => {
            const planned = parseInt(w.hours) || 0;
            let actual = 0;
            if (currentResult && currentResult.teachers) {
                const teacher = currentResult.teachers.find(t => t.teacher === teacherName);
                if (teacher && teacher.schedule) {
                    Object.values(teacher.schedule).forEach(dayObj => {
                        Object.values(dayObj).forEach(lessons => {
                            if (Array.isArray(lessons)) {
                                lessons.forEach(l => {
                                    if (l.subject === w.subject && l.grade === w.grade) {
                                        actual++;
                                    }
                                });
                            }
                        });
                    });
                }
            }
            const detailStatus = getLoadStatus(planned, actual);
            detailsHtml += `
                <div class="load-detail-row">
                    <span class="load-detail-subject">${w.subject} (${w.grade} кл)</span>
                    <span class="load-detail-hours">
                        План: <strong>${planned}</strong> ч
                        ${actual !== null ? `| Факт: <strong>${actual}</strong> ч` : '| Факт: —'}
                    </span>
                    <span class="load-detail-status ${detailStatus.class}">${detailStatus.icon} ${detailStatus.text}</span>
                </div>
            `;
        });
        detailsHtml += '</div>';
    } else {
        detailsHtml = '<p style="color:#999;font-size:13px;padding:10px">Нагрузки не назначены</p>';
    }

    container.innerHTML = `
        <div class="teacher-load-card">
            <div class="load-header">
                <div class="load-summary">
                    <div class="load-item">
                        <div class="load-label">План</div>
                        <div class="load-value">${plannedHours} ч</div>
                    </div>
                    <div class="load-item">
                        <div class="load-label">Факт</div>
                        <div class="load-value">${actualHours !== null ? actualHours + ' ч' : '—'}</div>
                    </div>
                    <div class="load-item">
                        <div class="load-label">Статус</div>
                        <div class="load-value ${status.class}">${status.icon} ${status.text}</div>
                    </div>
                </div>
            </div>
            ${detailsHtml}
        </div>
    `;
}

function loadTeacherCard() {
    const teacher = document.getElementById('teacherSelect').value;
    if (!teacher) {
        document.getElementById('teacherCard').style.display = 'none';
        return;
    }
    document.getElementById('teacherCard').style.display = 'block';
    document.getElementById('currentTeacherName').textContent = teacher;
    autoFillWorkloadsFromAssignments(teacher);
    renderWorkloads(teacher);
    renderAvailabilityGrid(teacher);
    renderTeacherLoadStats(teacher);
}

// Автоподстановка нагрузок из назначений (вкладка «Предметы»), если их ещё нет
function autoFillWorkloadsFromAssignments(teacher) {
    if (schoolData.workloads.some(w => w.teacher === teacher)) return;
    const items = (schoolData.teacherAssignments && schoolData.teacherAssignments[teacher]) || [];
    let added = false;
    items.forEach(it => {
        (it.subjects || []).forEach(subj => {
            schoolData.workloads.push({ teacher, subject: subj, grade: it.grade || '', classroom: '', hours: 1 });
            added = true;
        });
    });
    if (added) saveSchoolData();
}

function renderWorkloads(teacher) {
    const workloads = schoolData.workloads.filter(w => w.teacher === teacher);

    document.getElementById('workloadList').innerHTML = workloads.map((w, i) => `
        <div class="workload-row">
            <div class="form-group autocomplete-wrapper">
                <label>Предмет</label>
                <input type="text" class="workload-subject" value="${w.subject}"
                       placeholder="Например: Математика" data-idx="${i}" data-field="subject"
                       oninput="filterAutocomplete(this)" onfocus="showAutocomplete(this, 'subjects')">
                <div class="autocomplete-list" style="display:none"></div>
            </div>
            <div class="form-group autocomplete-wrapper">
                <label>Класс</label>
                <input type="text" class="workload-grade" value="${w.grade}"
                       placeholder="Например: 5А" data-idx="${i}" data-field="grade"
                       oninput="filterAutocomplete(this)" onfocus="showAutocomplete(this, 'classes')">
                <div class="autocomplete-list" style="display:none"></div>
            </div>
            <div class="form-group">
                <label>Кабинет</label>
                <select class="workload-classroom" data-idx="${i}" data-field="classroom" onchange="updateWorkloadFromInput(this)">
                    <option value="">-- Не указан --</option>
                    ${schoolData.classrooms.map(c => `<option value="${c.number}" ${w.classroom === c.number ? 'selected' : ''}>${c.number} (вм. ${c.capacity || '?'})</option>`).join('')}
                </select>
            </div>
            <div class="form-group hours-group">
                <label>Часы</label>
                <input type="number" class="workload-hours" value="${w.hours}"
                       data-idx="${i}" data-field="hours" min="1" max="40"
                       onchange="updateWorkloadFromInput(this)">
            </div>
            <button class="small danger" onclick="removeWorkload(${i})" style="margin-top: 24px;" title="Удалить нагрузку" aria-label="Удалить нагрузку">🗑</button>
        </div>
    `).join('');
}

function showAutocomplete(input, type) {
    const list = input.nextElementSibling;
    const names = new Set(type === 'subjects'
        ? schoolData.subjects.map(s => s.name)
        : schoolData.classes.map(c => c.name));
    // добавляем классы/предметы из назначений выбранного учителя
    const teacherSelect = document.getElementById('teacherSelect');
    const teacher = teacherSelect ? teacherSelect.value : '';
    const assigns = (schoolData.teacherAssignments && schoolData.teacherAssignments[teacher]) || [];
    assigns.forEach(a => {
        if (type === 'classes' && a.grade) names.add(a.grade);
        if (type === 'subjects') (a.subjects || []).forEach(s => names.add(s));
    });
    const items = [...names];
    const value = input.value.toLowerCase();
    list.innerHTML = '';
    items.filter(item => item.toLowerCase().includes(value)).forEach(item => {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.textContent = item;
        div.onclick = () => {
            input.value = item;
            list.style.display = 'none';
            updateWorkloadFromInput(input);
        };
        list.appendChild(div);
    });
    if (list.children.length > 0) list.style.display = 'block';
}

function filterAutocomplete(input) {
    const list = input.nextElementSibling;
    if (list.style.display === 'block')
        showAutocomplete(input, input.classList.contains('workload-subject') ? 'subjects' : 'classes');
}

function updateWorkloadFromInput(input) {
    const idx = parseInt(input.dataset.idx);
    const field = input.dataset.field;
    const teacher = document.getElementById('teacherSelect').value;
    const workloads = schoolData.workloads.filter(w => w.teacher === teacher);
    if (workloads[idx]) {
        workloads[idx][field] = field === 'hours' ? parseInt(input.value) : input.value;
        saveSchoolData();
        renderTeacherLoadStats(teacher);
    }
}

function addWorkload() {
    const teacher = document.getElementById('teacherSelect').value;
    if (!teacher) { alert('Сначала выберите учителя'); return; }
    schoolData.workloads.push({ teacher, subject: '', grade: '', classroom: '', hours: 1 });
    renderWorkloads(teacher);
    saveSchoolData();
    renderTeacherLoadStats(teacher);
}

function updateWorkload(idx, field, value) {
    const teacher = document.getElementById('teacherSelect').value;
    const workloads = schoolData.workloads.filter(w => w.teacher === teacher);
    if (workloads[idx]) {
        workloads[idx][field] = field === 'hours' ? parseInt(value) : value;
        saveSchoolData();
        renderTeacherLoadStats(teacher);
    }
}

function removeWorkload(idx) {
    const teacher = document.getElementById('teacherSelect').value;
    const workloads = schoolData.workloads.filter(w => w.teacher === teacher);
    const workloadToRemove = workloads[idx];
    if (!workloadToRemove) return;

    // Находим индекс в глобальном массиве по всем признакам
    const globalIdx = schoolData.workloads.findIndex(
        w => w.teacher === workloadToRemove.teacher &&
             w.subject === workloadToRemove.subject &&
             w.grade === workloadToRemove.grade &&
             w.hours === workloadToRemove.hours
    );
    if (globalIdx !== -1) {
        schoolData.workloads.splice(globalIdx, 1);
    }
    renderWorkloads(teacher);
    saveSchoolData();
    renderTeacherLoadStats(teacher);
}

function renderAvailabilityGrid(teacher) {
    if (!teacher) return;
    const allDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
    const days = allDays.slice(0, schoolData.days || 5);
    const slots = Array.from({ length: schoolData.lessonsPerDay }, (_, i) => i + 1);
    const times = getLessonTimes();
    if (!schoolData.availability[teacher]) {
        schoolData.availability[teacher] = {};
    }
    days.forEach(d => {
        if (!Array.isArray(schoolData.availability[teacher][d])) {
            schoolData.availability[teacher][d] = [...slots];
        }
    });
    const grid = document.getElementById('availabilityGrid');
    grid.style.gridTemplateColumns = `100px repeat(${slots.length}, 1fr)`;
    let html = '<div class="availability-cell header"></div>';
    slots.forEach((s, index) => {
        const timeStr = times[index] ? `<div class="time-label">${times[index]}</div>` : '';
        html += `<div class="availability-cell header">Урок ${s}${timeStr}</div>`;
    });
    days.forEach(day => {
        html += `<div class="availability-cell header">${day}</div>`;
        slots.forEach((slot) => {
            const isAvailable = (schoolData.availability[teacher][day] || []).includes(slot);
            html += `<div class="availability-cell ${isAvailable ? 'available' : 'unavailable'}"
                          onclick="toggleAvailability('${teacher}', '${day}', ${slot})">
                        <span>${slot}</span>
                     </div>`;
        });
    });
    grid.innerHTML = html;
}

function toggleAvailability(teacher, day, slot) {
    if (!schoolData.availability[teacher]) schoolData.availability[teacher] = {};
    if (!Array.isArray(schoolData.availability[teacher][day])) schoolData.availability[teacher][day] = [];
    const arr = schoolData.availability[teacher][day];
    const idx = arr.indexOf(slot);
    if (idx > -1) arr.splice(idx, 1);
    else arr.push(slot);
    renderAvailabilityGrid(teacher);
    saveSchoolData();
}

function selectTemplate(card, type) {
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
}

function getSelectedDays(selector) {
    return Array.from(document.querySelectorAll(selector))
        .filter(cb => cb.checked)
        .map(cb => cb.value);
}

function ensureTeacherExists(name) {
    if (!name) { alert('Введите ФИО учителя'); return false; }
    if (!schoolData.teachers.find(t => t.full_name.toLowerCase() === name.toLowerCase())) {
        schoolData.teachers.push({ full_name: name, email: '', subjects: [] });
        renderTeachers();
        updateTeacherSelect();
        updateTeacherDatalist();
    }
    return true;
}

function refreshTeacherCard(name) {
    const select = document.getElementById('teacherSelect');
    select.value = name;
    loadTeacherCard();
}

function applyTimeTemplate() {
    const name = document.getElementById('tmpl_name').value.trim();
    if (!ensureTeacherExists(name)) return;
    const days = getSelectedDays('.tmpl-day');
    if (days.length === 0) {
        alert('⚠ Выберите хотя бы один день недели!\nБез выбранных дней учитель будет полностью недоступен.');
        return;
    }
    const startTime = document.getElementById('tmpl_start').value;
    const endTime = document.getElementById('tmpl_end').value;
    const lessonTimes = schoolData.lessonTimes;
    if (!lessonTimes || lessonTimes.length === 0) {
        alert('❗ Сначала заполните сетку времени на Шаге 1!');
        return;
    }
    const startParts = startTime.split(':');
    const endParts = endTime.split(':');
    const startMin = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
    const endMin = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
    const slots = [];
    lessonTimes.forEach((timeRange, i) => {
        const parts = timeRange.split('-');
        if (parts.length !== 2) return;
        const ls = parts[0].split(':');
        const le = parts[1].split(':');
        const lStart = parseInt(ls[0]) * 60 + parseInt(ls[1]);
        const lEnd = parseInt(le[0]) * 60 + parseInt(le[1]);
        if (lStart >= startMin && lEnd <= endMin) slots.push(i + 1);
    });
    if (slots.length === 0) {
        alert(`❌ В диапазоне ${startTime}-${endTime} не найдено уроков.`);
        return;
    }
    if (schoolData.availability[name] && Object.keys(schoolData.availability[name]).length > 0) {
        if (!confirm(`⚠ У учителя "${name}" уже есть настройки. Новые значения ПОЛНОСТЬЮ ЗАМЕНЯТ старые. Продолжить?`))
            return;
    }
    schoolData.availability[name] = {};
    const allDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
    days.forEach(day => { schoolData.availability[name][day] = [...slots]; });
    allDays.forEach(day => { if (!days.includes(day)) schoolData.availability[name][day] = []; });
    saveSchoolData();
    refreshTeacherCard(name);
    alert(`✅ Доступность применена для ${name}: ${days.join(', ')} — уроки ${slots.join(', ')}`);
}

function applyDaysTemplate() {
    const name = document.getElementById('tmpl_name2').value.trim();
    if (!ensureTeacherExists(name)) return;
    const days = getSelectedDays('.tmpl-day2');
    if (days.length === 0) { alert('⚠ Выберите хотя бы один день!'); return; }
    const allSlots = Array.from({ length: schoolData.lessonsPerDay }, (_, i) => i + 1);
    const allDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
    if (schoolData.availability[name] && Object.keys(schoolData.availability[name]).length > 0) {
        if (!confirm(`⚠ У учителя "${name}" уже есть настройки. Заменить?`)) return;
    }
    schoolData.availability[name] = {};
    days.forEach(day => { schoolData.availability[name][day] = [...allSlots]; });
    allDays.forEach(day => { if (!days.includes(day)) schoolData.availability[name][day] = []; });
    saveSchoolData();
    refreshTeacherCard(name);
    alert(`✅ Дни применены для ${name}`);
}

function applyExcludeTemplate() {
    const name = document.getElementById('tmpl_name3').value.trim();
    if (!ensureTeacherExists(name)) return;
    const excludedDays = getSelectedDays('.tmpl-day3');
    if (excludedDays.length === 0) { alert('⚠ Выберите дни для исключения!'); return; }
    const allDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
    const workingDays = allDays.filter(d => !excludedDays.includes(d));
    const allSlots = Array.from({ length: schoolData.lessonsPerDay }, (_, i) => i + 1);
    if (schoolData.availability[name] && Object.keys(schoolData.availability[name]).length > 0) {
        if (!confirm(`⚠ У учителя "${name}" уже есть настройки. Заменить?`)) return;
    }
    schoolData.availability[name] = {};
    workingDays.forEach(day => { schoolData.availability[name][day] = [...allSlots]; });
    excludedDays.forEach(day => { schoolData.availability[name][day] = []; });
    saveSchoolData();
    refreshTeacherCard(name);
    alert(`✅ Исключения применены для ${name}`);
}

// ============================================================
// СТАТИСТИКА ГЕНЕРАЦИИ (ШАГ 4)
// ============================================================
function renderGenerationStats() {
    const container = document.getElementById('generationStats');
    if (!container) return;

    if (!currentResult || !currentResult.teachers || schoolData.teachers.length === 0) {
        container.innerHTML = '';
        return;
    }

    const rows = [];
    let totalPlanned = 0;
    let totalActual = 0;
    let okCount = 0;
    let underCount = 0;
    let overCount = 0;

    schoolData.teachers.forEach(teacher => {
        const planned = getPlannedHours(teacher.full_name);
        const actual = getActualHours(teacher.full_name);
        const status = getLoadStatus(planned, actual);

        totalPlanned += planned;
        if (actual !== null) totalActual += actual;

        if (status.class === 'load-ok') okCount++;
        else if (status.class === 'load-under') underCount++;
        else if (status.class === 'load-over') overCount++;

        rows.push(`
            <tr class="stat-row ${status.class}">
                <td class="stat-teacher">${teacher.full_name}</td>
                <td class="stat-planned">${planned} ч</td>
                <td class="stat-actual">${actual !== null ? actual + ' ч' : '—'}</td>
                <td class="stat-diff">
                    ${actual !== null ? (actual - planned > 0 ? '+' : '') + (actual - planned) : '—'}
                </td>
                <td class="stat-status">${status.icon} ${status.text}</td>
            </tr>
        `);
    });

    container.innerHTML = `
        <div class="generation-stats">
            <h3> Контроль нагрузки учителей</h3>
            <div class="stats-summary">
                <div class="stats-summary-item">
                    <div class="stats-summary-value">${schoolData.teachers.length}</div>
                    <div class="stats-summary-label">Всего учителей</div>
                </div>
                <div class="stats-summary-item stats-ok">
                    <div class="stats-summary-value">${okCount}</div>
                    <div class="stats-summary-label">✅ Норма</div>
                </div>
                <div class="stats-summary-item stats-under">
                    <div class="stats-summary-value">${underCount}</div>
                    <div class="stats-summary-label">⚠️ Недогруз</div>
                </div>
                <div class="stats-summary-item stats-over">
                    <div class="stats-summary-value">${overCount}</div>
                    <div class="stats-summary-label">❌ Перегруз</div>
                </div>
            </div>
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Учитель</th>
                        <th>План</th>
                        <th>Факт</th>
                        <th>Разница</th>
                        <th>Статус</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.join('')}
                </tbody>
                <tfoot>
                    <tr class="stat-total">
                        <td><strong>ИТОГО</strong></td>
                        <td><strong>${totalPlanned} ч</strong></td>
                        <td><strong>${totalActual} ч</strong></td>
                        <td><strong>${totalActual - totalPlanned > 0 ? '+' : ''}${totalActual - totalPlanned}</strong></td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

async function generateTimetable() {
    if (!checkAuth()) return;
    const err = document.getElementById('genError');
    const succ = document.getElementById('genSuccess');
    const btn = document.getElementById('generateBtn');

    const teachers = {};
    schoolData.teachers.forEach(t => {
        const workloads = schoolData.workloads.filter(w => w.teacher === t.full_name);
        if (workloads.length === 0) return;
        teachers[t.full_name] = {
            lessons: workloads.map(w => ({ subject: w.subject, grade: w.grade, hours: w.hours, classroom: w.classroom })),
            availability: schoolData.availability[t.full_name] || {},
            max_days_per_week: 5
        };
    });

    if (Object.keys(teachers).length === 0) {
        err.textContent = 'Добавьте учителей с предметами';
        err.classList.add('show');
        return;
    }

    const days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"].slice(0, schoolData.days);
    const slots = Array.from({ length: schoolData.lessonsPerDay }, (_, i) => i + 1);
    const requestData = { days, slots, teachers, lessonTimes: schoolData.lessonTimes || [] };

    err.classList.remove('show');
    succ.classList.remove('show');
    btn.disabled = true;
    btn.textContent = ' Генерация...';
    document.getElementById('progressOverlay').classList.add('active');

    try {
        let attempts = 0;
        let success = false;
        let data;
        while (attempts < 3 && !success) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);
                const res = await fetch('/generate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + getToken()
                    },
                    body: JSON.stringify(requestData),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`Ошибка ${res.status}`);
                data = await res.json();
                success = true;
            } catch (e) {
                attempts++;
                if (attempts >= 3) throw e;
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        document.getElementById('progressOverlay').classList.remove('active');

        if (data.status === 'INVALID' || (data.validation_errors && data.validation_errors.length > 0)) {
            err.textContent = data.errors ? data.errors.join('; ') : data.validation_errors.join('; ');
            err.classList.add('show');
            return;
        }

        attempts = 0;
        let fullData;
        while (attempts < 3) {
            try {
                const fullRes = await fetch('/timetables/' + data.id, {
                    headers: { 'Authorization': 'Bearer ' + getToken() }
                });
                if (!fullRes.ok) throw new Error('Ошибка загрузки');
                fullData = await fullRes.json();
                break;
            } catch (e) {
                attempts++;
                if (attempts >= 3) throw e;
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!fullData || !fullData.data) throw new Error('Нет данных');

        currentResult = fullData.data;
        currentTimetableId = data.id;

        document.getElementById('statTeachers').textContent = currentResult.teachers.length;
        const totalLessons = currentResult.teachers.reduce((sum, t) => sum + t.total_lessons, 0);
        document.getElementById('statLessons').textContent = totalLessons;
        document.getElementById('statTime').textContent = currentResult.solution_time.toFixed(2) + ' с';
        document.getElementById('statStatus').textContent = currentResult.status;
        document.getElementById('resultsSection').classList.add('active');
        succ.textContent = '✅ Расписание составлено!';
        succ.classList.add('show');
        renderSchedule();
        loadSavedTimetables();
        renderGenerationStats();
        if (typeof logActivity === 'function') logActivity('Сгенерировано расписание (' + currentResult.status + ')');
        if (typeof updateDashboardCounts === 'function') updateDashboardCounts();
    } catch (e) {
        document.getElementById('progressOverlay').classList.remove('active');
        err.textContent = 'Ошибка: ' + e.message;
        err.classList.add('show');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Сгенерировать расписание';
    }
}

function renderSchedule() {
    if (!currentResult || !currentResult.teachers) {
        document.getElementById('scheduleView').innerHTML = '<p>Нет данных</p>';
        return;
    }
    const container = document.getElementById('scheduleView');
    const allGrades = new Set();
    currentResult.teachers.forEach(t => {
        Object.values(t.schedule || {}).forEach(dayObj => {
            Object.values(dayObj).forEach(slotLessons => {
                slotLessons.forEach(l => { if (l.grade) allGrades.add(l.grade); });
            });
        });
    });
    const sortedGrades = Array.from(allGrades).sort();
    if (sortedGrades.length === 0) { container.innerHTML = '<p>Нет классов</p>'; return; }

    const days = currentResult.days || ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"];
    const slots = currentResult.slots || [1, 2, 3, 4, 5, 6, 7];
    const times = getLessonTimes();

    let html = '<div class="schedule-scroll"><table class="schedule-table">';
    html += '<thead><tr><th class="sched-corner" style="width:120px;"></th><th class="sched-corner" style="width:80px;"></th>';
    sortedGrades.forEach(g => html += `<th class="sched-grade">${g} кл</th>`);
    html += '</tr></thead><tbody>';

    days.forEach(day => {
        html += `<tr><td class="sched-day" colspan="${sortedGrades.length + 2}">${day}</td></tr>`;
        slots.forEach((slot, sIdx) => {
            const timeStr = times[sIdx] || `Урок ${slot}`;
            const lessonLabel = `Урок ${slot}`;
            const params = [
                { label: "Предмет", key: "subject" },
                { label: "Преподаватель", key: "teacher" },
                { label: "Кабинет", key: "classroom" },
                { label: "Тема", key: "topic" }
            ];
            params.forEach((p, idx) => {
                html += `<tr>`;
                html += `<td class="sched-param">${p.label}</td>`;
                if (idx === 0) {
                    html += `<td class="sched-lesson" rowspan="4">${lessonLabel}</td>`;
                }
                sortedGrades.forEach(grade => {
                    let val = "-";
                    for (const t of currentResult.teachers) {
                        const s = t.schedule?.[day]?.[String(slot)];
                        if (s) {
                            const found = s.find(l => l.grade === grade);
                            if (found) { val = found[p.key] || "-"; break; }
                        }
                    }
                    html += `<td class="sched-value">${val}</td>`;
                });
                html += `</tr>`;
            });
            html += `<tr>`;
            html += `<td class="sched-param">Вычитано</td>`;
            html += `<td class="sched-lesson">${timeStr}</td>`;
            sortedGrades.forEach(() => html += `<td class="sched-value">—</td>`);
            html += `</tr>`;
            html += `<tr class="schedule-spacer"><td colspan="${sortedGrades.length + 2}"></td></tr>`;
        });
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

async function loadSavedTimetables() {
    if (!checkAuth()) return;
    const container = document.getElementById('savedTimetablesList');
    if (!container) return;
    try {
        const res = await fetch('/timetables', {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (!res.ok) throw new Error('Ошибка');
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            container.innerHTML = data.map(t => `
                <div class="saved-timetable-item">
                    <div><h4>${t.name}</h4><p>${new Date(t.created_at).toLocaleString('ru-RU')}</p></div>
                    <div class="saved-timetable-actions">
                        <button class="small primary" onclick="window.loadSavedTimetable(${t.id})" title="Открыть расписание в редакторе"> Открыть</button>
                        <button class="small outline" onclick="window.downloadSavedPDF(${t.id},'teachers')" title="Скачать PDF по учителям">PDF (уч.)</button>
                        <button class="small outline" onclick="window.downloadSavedPDF(${t.id},'classes')" title="Скачать PDF по классам">PDF (кл.)</button>
                        <button class="small danger" onclick="window.deleteSavedTimetable(${t.id})" title="Удалить расписание" aria-label="Удалить расписание">🗑</button>
                    </div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p style="color:#999;text-align:center">Нет расписаний</p>';
        }
    } catch (e) {
        container.innerHTML = '<p style="color:#c33">Ошибка загрузки</p>';
    }
}

window.loadSavedTimetable = async function (id) {
    if (!checkAuth()) return;
    try {
        const res = await fetch('/timetables/' + id, {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        const data = await res.json();
        if (res.ok && data.data) {
            currentResult = data.data;
            currentTimetableId = id;
            // Очищаем историю Undo при загрузке расписания
            window.undoHistory = [];
            if (typeof updateUndoButtonState === 'function') updateUndoButtonState();
            document.getElementById('statTeachers').textContent = currentResult.teachers.length;
            document.getElementById('statLessons').textContent =
                currentResult.teachers.reduce((s, t) => s + t.total_lessons, 0);
            document.getElementById('statTime').textContent = currentResult.solution_time.toFixed(2) + ' с';
            document.getElementById('statStatus').textContent = currentResult.status;
            document.getElementById('resultsSection').classList.add('active');
            renderSchedule();
            renderGenerationStats();
            alert('✅ Расписание загружено');
        } else alert('Ошибка');
    } catch (e) { alert('Ошибка: ' + e.message); }
};

window.deleteSavedTimetable = async function (id) {
    if (!checkAuth()) return;
    if (!confirm('Удалить?')) return;
    try {
        const res = await fetch('/timetables/' + id, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (res.ok) { loadSavedTimetables(); alert('✅ Удалено'); }
        else alert('Ошибка');
    } catch (e) { alert('Ошибка'); }
};

window.downloadSavedPDF = async function (id, format) {
    if (!checkAuth()) return;
    try {
        const res = await fetch(`/timetables/${id}/export/pdf?format=${format}`, {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (!res.ok) throw new Error('Ошибка');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timetable_${id}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (e) { alert('Ошибка скачивания'); }
};

function downloadPDF(format) {
    if (!currentTimetableId) { alert('Сначала сгенерируйте'); return; }
    window.downloadSavedPDF(currentTimetableId, format);
}

function downloadExcel(format) {
    if (!currentTimetableId) { alert('Сначала сгенерируйте расписание'); return; }
    const url = `/timetables/${currentTimetableId}/export/excel?format=${format}`;
    fetch(url, {
        headers: { 'Authorization': 'Bearer ' + getToken() }
    }).then(response => {
        if (!response.ok) throw new Error('Ошибка сети');
        return response.blob();
    }).then(blob => {
        const link = document.createElement('a');
        const url = window.URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute('download', `raspisanie_${currentTimetableId}_${format}.xlsx`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }).catch(err => {
        console.error(err);
        alert('Не удалось скачать файл. Проверьте консоль.');
    });
}

// ============================================================
// РЕДАКТОР ТЕМ
// ============================================================

function switchEditorMode(mode) {
    currentEditorMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    const editorContainer = document.getElementById('globalEditorContainer');
    const topicsContainer = document.getElementById('topicsEditorContainer');
    const exportBtn = document.getElementById('exportTopicsBtn');
    if (mode === 'editor') {
        editorContainer.style.display = 'block';
        topicsContainer.style.display = 'none';
        exportBtn.style.display = 'none';
        renderGlobalEditor();
    } else {
        editorContainer.style.display = 'none';
        topicsContainer.style.display = 'block';
        exportBtn.style.display = 'inline-block';
        loadFreshTimetableData().then(() => renderTopicsEditor());
    }
}

async function onEditorFilterChange() {
    if (currentEditorMode === 'editor') {
        renderGlobalEditor();
    } else {
        await loadFreshTimetableData();
        renderTopicsEditor();
    }
}

async function loadFreshTimetableData() {
    if (!currentTimetableId) {
        console.warn('⚠ Нет currentTimetableId');
        return;
    }

    try {
        console.log('🔄 Загрузка свежих данных из БД для timetable ID:', currentTimetableId);
        const res = await fetch(`/timetables/${currentTimetableId}`, {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.data) {
                currentResult = data.data;
                console.log('✅ Свежие данные загружены из БД, учителей:', currentResult.teachers?.length);
            }
        } else {
            console.error('❌ Ошибка загрузки данных:', res.status);
        }
    } catch (e) {
        console.error('❌ Ошибка сети при загрузке:', e);
    }
}

async function saveTopicToDatabase(teacher, subject, grade, day, slot, topic) {
    if (!currentTimetableId) {
        console.error(' Нет currentTimetableId');
        return false;
    }

    try {
        console.log('💾 Сохранение темы через update-topics endpoint...');
        console.log('   Данные:', { teacher, subject, grade, day, slot, topic });

        const res = await fetch(`/timetables/${currentTimetableId}/update-topics`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getToken()
            },
            body: JSON.stringify({
                updates: [{
                    teacher: teacher,
                    subject: subject,
                    grade: grade,
                    day: day,
                    slot: parseInt(slot),
                    topic: topic
                }]
            })
        });

        if (res.ok) {
            const data = await res.json();
            console.log('✅ Тема сохранена в БД, обновлено:', data.updated_count);
            if (data.data) {
                currentResult = data.data;
                console.log('📊 currentResult обновлён, учителей:', currentResult.teachers?.length);
            }
            return true;
        } else {
            const errorData = await res.json();
            console.error('❌ Ошибка сохранения:', res.status, errorData);
            return false;
        }
    } catch (e) {
        console.error('❌ Ошибка сети при сохранении:', e);
        return false;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderTopicsEditor() {
    console.log('🎨 renderTopicsEditor вызван');
    const container = document.getElementById('topicsEditorContent');
    const filterGrade = document.getElementById('editorClassFilter')?.value || '';

    if (!currentResult || !currentResult.teachers) {
        container.innerHTML = '<p style="padding:20px;text-align:center;color:#999">Нет данных. Сгенерируйте расписание.</p>';
        return;
    }

    if (!filterGrade) {
        container.innerHTML = `
            <div style="padding:30px;text-align:center;background:#fff3cd;border-radius:8px;color:#856404">
                <h3>⚠ Выберите класс</h3>
                <p>Для редактирования тем необходимо выбрать конкретный класс в фильтре выше.</p>
            </div>
        `;
        return;
    }

    const days = currentResult.days || ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"];
    const slots = currentResult.slots || [1, 2, 3, 4, 5, 6, 7];
    const times = getLessonTimes();

    const classSchedule = {};
    days.forEach(day => {
        classSchedule[day] = {};
        slots.forEach(slot => {
            classSchedule[day][slot] = null;
        });
    });

    currentResult.teachers.forEach(teacher => {
        if (!teacher.schedule) return;
        Object.keys(teacher.schedule).forEach(day => {
            Object.keys(teacher.schedule[day]).forEach(slotStr => {
                const slot = parseInt(slotStr);
                const lessons = teacher.schedule[day][slotStr];
                if (!Array.isArray(lessons)) return;
                lessons.forEach(lesson => {
                    if (lesson.grade === filterGrade) {
                        classSchedule[day][slot] = {
                            subject: lesson.subject,
                            teacher: lesson.teacher,
                            classroom: lesson.classroom || '',
                            topic: lesson.topic || '',
                            teacherShort: teacher.teacher
                        };
                    }
                });
            });
        });
    });

    console.log(' classSchedule для класса', filterGrade, ':', classSchedule);

    let html = '<div style="overflow-x:auto">';
    html += '<table class="topics-table">';
    html += '<thead><tr>';
    html += '<th class="topics-day-header">День / Урок</th>';
    slots.forEach((slot, idx) => {
        const timeStr = times[idx] || '';
        html += `<th class="topics-slot-header">Урок ${slot}<br><small>${timeStr}</small></th>`;
    });
    html += '</tr></thead><tbody>';

    days.forEach(day => {
        html += `<tr class="topics-day-row">`;
        html += `<td class="topics-day-cell">${day}</td>`;
        slots.forEach(slot => {
            const lesson = classSchedule[day][slot];
            html += `<td class="topics-cell">`;
            if (lesson) {
                const topicDisplay = lesson.topic ? `<div class="topic-display">${escapeHtml(lesson.topic)}</div>` : '';
                html += `
                    <div class="topic-lesson-info">
                        <div class="topic-subject">${escapeHtml(lesson.subject)}</div>
                        <div class="topic-teacher">${escapeHtml(lesson.teacherShort)}</div>
                        <div class="topic-classroom">${lesson.classroom ? '🚪 ' + escapeHtml(lesson.classroom) : ''}</div>
                        ${topicDisplay}
                    </div>
                    <input type="text"
                           class="topic-input"
                           value="${escapeHtml(lesson.topic)}"
                           placeholder="Введите тему урока..."
                           data-day="${escapeAttr(day)}"
                           data-slot="${slot}"
                           data-teacher="${escapeAttr(lesson.teacher)}"
                           data-subject="${escapeAttr(lesson.subject)}"
                           data-grade="${escapeAttr(filterGrade)}"
                           onblur="window.onTopicBlur(this)"
                           onkeydown="window.onTopicKeydown(event, this)">
                `;
            } else {
                html += `<div class="topic-empty">—</div>`;
            }
            html += `</td>`;
        });
        html += `</tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
    console.log('✅ Таблица тем отрисована');
}

async function onTopicBlur(input) {
    console.log('💾 onTopicBlur вызван:', input.dataset);
    const day = input.dataset.day;
    const slot = parseInt(input.dataset.slot);
    const teacher = input.dataset.teacher;
    const subject = input.dataset.subject;
    const grade = input.dataset.grade;
    const topic = input.value.trim();

    showTopicsSaveIndicator(' Сохранение...', 'saving');

    const success = await saveTopicToDatabase(teacher, subject, grade, day, slot, topic);

    if (success) {
        showTopicsSaveIndicator('✅ Сохранено', 'success');
    } else {
        showTopicsSaveIndicator('❌ Ошибка сохранения', 'error');
    }
}

function onTopicKeydown(event, input) {
    if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
    }
}

function showTopicsSaveIndicator(text, type = 'success') {
    const indicator = document.getElementById('topicsSaveIndicator');
    if (!indicator) return;

    if (saveIndicatorTimeout) {
        clearTimeout(saveIndicatorTimeout);
    }

    const iconEl = indicator.querySelector('.save-indicator-icon');
    const textEl = indicator.querySelector('.save-indicator-text');

    if (iconEl) {
        iconEl.textContent = type === 'success' ? '✓' : type === 'saving' ? '⏳' : '✗';
    }
    if (textEl) {
        textEl.textContent = text;
    }

    indicator.className = `save-indicator show ${type}`;

    if (type !== 'error') {
        saveIndicatorTimeout = setTimeout(() => {
            indicator.classList.remove('show');
        }, 2500);
    }
}

async function exportTopicsToExcel() {
    if (!currentTimetableId) {
        alert('Сначала сгенерируйте расписание');
        return;
    }
    const filterGrade = document.getElementById('editorClassFilter')?.value || '';
    if (!filterGrade) {
        alert('Выберите класс для экспорта');
        return;
    }
    try {
        const response = await fetch(`/timetables/${currentTimetableId}/export/topics-excel?grade=${encodeURIComponent(filterGrade)}`, {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (!response.ok) throw new Error('Ошибка сети');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `temy_${filterGrade}_${currentTimetableId}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Ошибка экспорта тем:', error);
        alert('Не удалось экспортировать темы');
    }
}

// ============================================================
// ЭКСПОРТ ФУНКЦИЙ В WINDOW
// ============================================================
window.switchEditorMode = switchEditorMode;
window.onEditorFilterChange = onEditorFilterChange;
window.renderTopicsEditor = renderTopicsEditor;
window.onTopicBlur = onTopicBlur;
window.onTopicKeydown = onTopicKeydown;
window.showTopicsSaveIndicator = showTopicsSaveIndicator;
window.exportTopicsToExcel = exportTopicsToExcel;
window.loadFreshTimetableData = loadFreshTimetableData;
window.saveTopicToDatabase = saveTopicToDatabase;
window.renderTeacherLoadStats = renderTeacherLoadStats;
window.renderGenerationStats = renderGenerationStats;