// ============================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================================
let currentEditorMode = 'editor';
let topicsSaveTimeout = null;
let pendingTopicUpdates = [];
let saveIndicatorTimeout = null;

// ============================================================
// НАВИГАЦИЯ ПО МАСТЕРУ
// ============================================================
async function goToStep(step) {
    document.querySelectorAll('.wizard-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.wizard-step').forEach((s, i) => {
        s.classList.remove('active');
        if (i + 1 < step) s.classList.add('completed');
        else s.classList.remove('completed');
    });
    document.getElementById('step' + step).classList.add('active');
    document.querySelectorAll('.wizard-step')[step - 1].classList.add('active');
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
        renderAvailabilityGrid(document.getElementById('teacherSelect').value);
    }
    if (step === 4) loadSavedTimetables();

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
            console.log("🎨 Рендеринг таблицы редактора...");
            updateEditorClassFilter();
            if (currentEditorMode === 'topics') {
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

function completeStep(step) {
    if (step === 1) {
        schoolData.name = document.getElementById('schoolName').value;
        schoolData.days = parseInt(document.getElementById('daysPerWeek').value);
        schoolData.lessonsPerDay = parseInt(document.getElementById('lessonsPerDay').value);
        schoolData.lessonTimes = document.getElementById('lessonTimes').value.split(',').map(t => t.trim());
    }
    saveSchoolData();
    goToStep(step + 1);
}

function restoreStep1Fields() {
    if (!schoolData) return;
    const nameField = document.getElementById('schoolName');
    const daysField = document.getElementById('daysPerWeek');
    const lessonsField = document.getElementById('lessonsPerDay');
    const timesField = document.getElementById('lessonTimes');

    if (nameField && schoolData.name) nameField.value = schoolData.name;
    if (daysField && schoolData.days) daysField.value = schoolData.days;
    if (lessonsField && schoolData.lessonsPerDay) lessonsField.value = schoolData.lessonsPerDay;
    if (timesField && schoolData.lessonTimes && schoolData.lessonTimes.length > 0) {
        timesField.value = schoolData.lessonTimes.join(', ');
    }
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
            <td class="subjects-cell">${subjectsButtonHtml(t, i)}</td>
            <td>
                <button class="small danger" onclick="removeTeacher(${i})" title="Удалить учителя"></button>
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

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-subjects-toggle]');
    if (!btn) return;
    const teacherIndex = parseInt(btn.dataset.teacherId, 10);
    const teacher = (schoolData.teachers || [])[teacherIndex];
    if (!teacher) return;
    SubjectsDropdown.open(btn, {
        teacherId: teacherIndex,
        items: getSubjectCatalog(),
        selected: (teacher.subjects || []).map(sdSubjectName).filter(Boolean),
        onChange: (values) => updateTeacherSubjects(teacherIndex, values)
    });
});

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
            <td><button class="small danger" onclick="removeSubject(${i})"> Удалить</button></td>
        </tr>`
    ).join('');
}

function removeSubject(i) {
    const subjectName = schoolData.subjects[i].name;
    schoolData.teachers.forEach(t => {
        t.subjects = t.subjects.filter(s => s !== subjectName);
    });
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
    alert('📥 Функция импорта из Excel:\n\nВ реальной версии здесь откроется диалог выбора файла.\nСейчас добавлены демонстрационные данные для теста.');
    if (schoolData.teachers.length === 0) {
        schoolData.teachers.push({ full_name: "Иванова М.П.", email: "", subjects: [] });
        schoolData.teachers.push({ full_name: "Петров С.С.", email: "", subjects: [] });
        renderTeachers();
        updateTeacherDatalist();
    }
    if (schoolData.subjects.length === 0) {
        schoolData.subjects.push({ name: "Математика", category: "Основной" });
        schoolData.subjects.push({ name: "Русский язык", category: "Основной" });
        renderSubjects();
    }
    saveSchoolData();
}

function updateTeacherSelect() {
    const select = document.getElementById('teacherSelect');
    select.innerHTML = '<option value="">-- Выберите учителя --</option>' +
        schoolData.teachers.map(t => `<option value="${t.full_name}">${t.full_name}</option>`).join('');
}

function updateTeacherDatalist() {
    const datalist = document.getElementById('teacherDatalist');
    if (datalist) datalist.innerHTML = schoolData.teachers.map(t => `<option value="${t.full_name}">`).join('');
}

function loadTeacherCard() {
    const teacher = document.getElementById('teacherSelect').value;
    if (!teacher) {
        document.getElementById('teacherCard').style.display = 'none';
        return;
    }
    document.getElementById('teacherCard').style.display = 'block';
    document.getElementById('currentTeacherName').textContent = teacher;
    renderWorkloads(teacher);
    renderAvailabilityGrid(teacher);
}

function renderWorkloads(teacher) {
    const workloads = schoolData.workloads.filter(w => w.teacher === teacher);
    document.getElementById('workloadList').innerHTML = workloads.map((w, i) => `
        <div class="workload-row">
            <div class="form-group autocomplete-wrapper">
                <label for="subject-${i}">Предмет</label>
                <input type="text" id="subject-${i}" class="workload-subject" value="${w.subject}"
                       placeholder="Например: Математика" data-idx="${i}" data-field="subject"
                       oninput="filterAutocomplete(this)" onfocus="showAutocomplete(this, 'subjects')">
                <div class="autocomplete-list" style="display:none"></div>
            </div>
            <div class="form-group autocomplete-wrapper">
                <label for="grade-${i}">Класс</label>
                <input type="text" id="grade-${i}" class="workload-grade" value="${w.grade}"
                       placeholder="Например: 5А" data-idx="${i}" data-field="grade"
                       oninput="filterAutocomplete(this)" onfocus="showAutocomplete(this, 'classes')">
                <div class="autocomplete-list" style="display:none"></div>
            </div>
            <div class="form-group hours-group">
                <label for="hours-${i}">Часы</label>
                <input type="number" id="hours-${i}" class="workload-hours" value="${w.hours}"
                       data-idx="${i}" data-field="hours" min="1" max="20"
                       onchange="updateWorkloadFromInput(this)">
            </div>
            <button class="small danger" onclick="removeWorkload(${i})">🗑 Удалить</button>
        </div>
    `).join('');
}

function showAutocomplete(input, type) {
    const list = input.nextElementSibling;
    const items = type === 'subjects'
        ? schoolData.subjects.map(s => s.name)
        : schoolData.classes.map(c => c.name);
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
    }
}

function addWorkload() {
    const teacher = document.getElementById('teacherSelect').value;
    if (!teacher) { alert('Сначала выберите учителя'); return; }
    schoolData.workloads.push({ teacher, subject: '', grade: '', hours: 1 });
    renderWorkloads(teacher);
    saveSchoolData();
}

function updateWorkload(idx, field, value) {
    const teacher = document.getElementById('teacherSelect').value;
    const workloads = schoolData.workloads.filter(w => w.teacher === teacher);
    if (workloads[idx]) {
        workloads[idx][field] = field === 'hours' ? parseInt(value) : value;
        saveSchoolData();
    }
}

function removeWorkload(idx) {
    const teacher = document.getElementById('teacherSelect').value;
    const workloads = schoolData.workloads.filter(w => w.teacher === teacher);
    const globalIdx = schoolData.workloads.indexOf(workloads[idx]);
    schoolData.workloads.splice(globalIdx, 1);
    renderWorkloads(teacher);
    saveSchoolData();
}

function renderAvailabilityGrid(teacher) {
    if (!teacher) return;
    const days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"];
    const slots = Array.from({ length: schoolData.lessonsPerDay }, (_, i) => i + 1);
    const times = schoolData.lessonTimes;
    if (!schoolData.availability[teacher]) {
        schoolData.availability[teacher] = {};
        days.forEach(d => schoolData.availability[teacher][d] = [...slots]);
    }
    let html = '<div class="availability-cell header"></div>';
    slots.forEach((s, index) => {
        const timeStr = times[index] ? `<div class="time-label">${times[index]}</div>` : '';
        html += `<div class="availability-cell header">Урок ${s}${timeStr}</div>`;
    });
    days.forEach(day => {
        html += `<div class="availability-cell header">${day}</div>`;
        slots.forEach((slot, index) => {
            const isAvailable = schoolData.availability[teacher][day].includes(slot);
            html += `<div class="availability-cell ${isAvailable ? 'available' : 'unavailable'}"
                          onclick="toggleAvailability('${teacher}', '${day}', ${slot})">
                        <span>${slot}</span>
                     </div>`;
        });
    });
    document.getElementById('availabilityGrid').innerHTML = html;
}

function toggleAvailability(teacher, day, slot) {
    const idx = schoolData.availability[teacher][day].indexOf(slot);
    if (idx > -1) schoolData.availability[teacher][day].splice(idx, 1);
    else schoolData.availability[teacher][day].push(slot);
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
            lessons: workloads.map(w => ({ subject: w.subject, grade: w.grade, hours: w.hours })),
            availability: schoolData.availability[t.full_name] || {},
            max_days_per_week: 5
        };
    });

    if (Object.keys(teachers).length === 0) {
        err.textContent = 'Добавьте учителей с предметами';
        err.classList.add('show');
        return;
    }

    const days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"].slice(0, schoolData.days);
    const slots = Array.from({ length: schoolData.lessonsPerDay }, (_, i) => i + 1);
    const requestData = { days, slots, teachers };

    err.classList.remove('show');
    succ.classList.remove('show');
    btn.disabled = true;
    btn.textContent = '⏳ Генерация...';
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
    const times = schoolData.lessonTimes || [];

    let html = '<div style="overflow-x:auto;"><table class="master-table" style="min-width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr><th style="background:#f8f9fa;width:120px;"></th><th style="background:#f8f9fa;width:80px;"></th>';
    sortedGrades.forEach(g => html += `<th style="background:#9b59b6;color:white;padding:8px;">${g} кл</th>`);
    html += '</tr></thead><tbody>';

    days.forEach(day => {
        html += `<tr><td colspan="${sortedGrades.length + 2}" style="background:#eee;font-weight:bold;text-align:center;">${day}</td></tr>`;
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
                html += `<td style="font-weight:bold;color:#800080;text-align:center;border:1px solid #ddd;">${p.label}</td>`;
                if (idx === 0) {
                    html += `<td rowspan="4" style="font-weight:bold;text-align:center;vertical-align:middle;border:1px solid #ddd;background:#fafafa;">${lessonLabel}</td>`;
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
                    html += `<td style="border:1px solid #ddd;text-align:center;">${val}</td>`;
                });
                html += `</tr>`;
            });
            html += `<tr>`;
            html += `<td style="font-weight:bold;color:#800080;text-align:center;border:1px solid #ddd;">Вычитано</td>`;
            html += `<td style="font-weight:bold;text-align:center;border:1px solid #ddd;background:#f0f0f0;">${timeStr}</td>`;
            sortedGrades.forEach(() => html += `<td style="border:1px solid #ddd;text-align:center;">-</td>`);
            html += `</tr>`;
            html += `<tr><td colspan="${sortedGrades.length + 2}" style="height:8px;border:none;"></td></tr>`;
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
                        <button class="small primary" onclick="window.loadSavedTimetable(${t.id})">👁 Открыть</button>
                        <button class="small outline" onclick="window.downloadSavedPDF(${t.id},'teachers')">PDF (уч.)</button>
                        <button class="small outline" onclick="window.downloadSavedPDF(${t.id},'classes')">PDF (кл.)</button>
                        <button class="small danger" onclick="window.deleteSavedTimetable(${t.id})"></button>
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
            document.getElementById('statTeachers').textContent = currentResult.teachers.length;
            document.getElementById('statLessons').textContent =
                currentResult.teachers.reduce((s, t) => s + t.total_lessons, 0);
            document.getElementById('statTime').textContent = currentResult.solution_time.toFixed(2) + ' с';
            document.getElementById('statStatus').textContent = currentResult.status;
            document.getElementById('resultsSection').classList.add('active');
            renderSchedule();
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
// РЕДАКТОР ТЕМ (ИСПРАВЛЕННАЯ ВЕРСИЯ)
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
        renderTopicsEditor();
    }
}

function onEditorFilterChange() {
    if (currentEditorMode === 'editor') {
        renderGlobalEditor();
    } else {
        renderTopicsEditor();
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
    const times = schoolData.lessonTimes || [];
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
                html += `
                    <div class="topic-lesson-info">
                        <div class="topic-subject">${escapeHtml(lesson.subject)}</div>
                        <div class="topic-teacher">${escapeHtml(lesson.teacherShort)}</div>
                        <div class="topic-classroom">${lesson.classroom ? ' ' + escapeHtml(lesson.classroom) : ''}</div>
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
}

function onTopicBlur(input) {
    console.log('💾 onTopicBlur вызван:', input.dataset);
    const day = input.dataset.day;
    const slot = parseInt(input.dataset.slot);
    const teacher = input.dataset.teacher;
    const subject = input.dataset.subject;
    const grade = input.dataset.grade;
    const topic = input.value.trim();
    pendingTopicUpdates.push({
        teacher, subject, grade, day, slot, topic
    });
    console.log('📝 Добавлено в очередь:', pendingTopicUpdates);
    showTopicsSaveIndicator('⏳ Сохранение...', 'saving');
    clearTimeout(topicsSaveTimeout);
    topicsSaveTimeout = setTimeout(() => {
        flushTopicUpdates();
    }, 500);
}

function onTopicKeydown(event, input) {
    if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
        const allInputs = [...document.querySelectorAll('.topic-input')];
        const currentIndex = allInputs.indexOf(input);
        if (currentIndex < allInputs.length - 1) {
            allInputs[currentIndex + 1].focus();
        }
    }
}

async function flushTopicUpdates() {
    console.log('📤 flushTopicUpdates вызван, очередь:', pendingTopicUpdates);
    if (pendingTopicUpdates.length === 0) return;
    const updatesToSend = [...pendingTopicUpdates];
    pendingTopicUpdates = [];
    if (!currentTimetableId) {
        showTopicsSaveIndicator('❌ Ошибка: нет ID расписания', 'error');
        return;
    }
    try {
        console.log('📡 Отправка запроса на сервер...');
        const response = await fetch(`/timetables/${currentTimetableId}/update-topics`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getToken()
            },
            body: JSON.stringify({ updates: updatesToSend })
        });
        console.log('📥 Ответ сервера:', response.status);
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Результат:', result);
            if (result.data) {
                currentResult = result.data;
            }
            showTopicsSaveIndicator(`✅ Сохранено (${result.updated_count} тем)`, 'success');
            // ✅ КРИТИЧЕСКИ ВАЖНО: Перерисовываем таблицу тем после сохранения
            setTimeout(() => {
                renderTopicsEditor();
            }, 300);
        } else {
            const error = await response.json();
            console.error('❌ Ошибка сервера:', error);
            showTopicsSaveIndicator('❌ Ошибка: ' + (error.detail || 'неизвестно'), 'error');
        }
    } catch (error) {
        console.error('❌ Ошибка сети:', error);
        showTopicsSaveIndicator('❌ Ошибка сети', 'error');
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
window.flushTopicUpdates = flushTopicUpdates;
window.showTopicsSaveIndicator = showTopicsSaveIndicator;
window.exportTopicsToExcel = exportTopicsToExcel;