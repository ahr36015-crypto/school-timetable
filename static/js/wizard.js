// static/js/wizard.js

// --- Навигация по мастеру ---
function goToStep(step) {
    document.querySelectorAll('.wizard-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.wizard-step').forEach((s,i) => { s.classList.remove('active'); if (i+1 < step) s.classList.add('completed'); });
    document.getElementById('step'+step).classList.add('active');
    document.querySelectorAll('.wizard-step')[step-1].classList.add('active');
    currentStep = step;

    if (step === 2) { renderClasses(); renderTeachers(); renderSubjects(); renderClassrooms(); }
    if (step === 3) { updateTeacherSelect(); updateTeacherDatalist(); renderAvailabilityGrid(document.getElementById('teacherSelect').value); }
    if (step === 4) loadSavedTimetables();
}

function completeStep(step) {
    if (step === 1) {
        schoolData.name = document.getElementById('schoolName').value;
        schoolData.days = parseInt(document.getElementById('daysPerWeek').value);
        schoolData.lessonsPerDay = parseInt(document.getElementById('lessonsPerDay').value);
        schoolData.lessonTimes = document.getElementById('lessonTimes').value.split(',').map(t => t.trim());
    }
    saveSchoolData(); goToStep(step + 1);
}

// --- Справочники (Шаг 2) ---
function showRefTab(tab) {
    document.querySelectorAll('.reference-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.reference-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('ref-'+tab).classList.add('active');
    event.target.classList.add('active');
    if (tab === 'classes') renderClasses();
    if (tab === 'teachers') renderTeachers();
    if (tab === 'subjects') renderSubjects();
    if (tab === 'classrooms') renderClassrooms();
}

function addClass() {
    const name = document.getElementById('newClassName').value.trim(); const warning = document.getElementById('classDuplicateWarning');
    if (!name) { alert('Введите название класса'); return; }
    const exists = schoolData.classes.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) { warning.classList.add('show'); setTimeout(() => warning.classList.remove('show'), 3000); return; }
    const match = name.match(/(\d+)([А-Яа-я]?)/);
    schoolData.classes.push({name, grade: match?parseInt(match[1]):0, letter: match?match[2]:''});
    renderClasses(); saveSchoolData(); document.getElementById('newClassName').value = '';
}
function renderClasses() { document.getElementById('classesTable').innerHTML = schoolData.classes.map((c,i) => `<tr><td>${c.name}</td><td>${c.grade}</td><td><button class="small danger" onclick="removeClass(${i})">️ Удалить</button></td></tr>`).join(''); }
function removeClass(i) { schoolData.classes.splice(i,1); renderClasses(); saveSchoolData(); }

function addTeacher() {
    const name = document.getElementById('newTeacherName').value.trim(); const email = document.getElementById('newTeacherEmail').value.trim(); const warning = document.getElementById('teacherDuplicateWarning');
    if (!name) { alert('Введите ФИО учителя'); return; }
    const exists = schoolData.teachers.some(t => t.full_name.toLowerCase() === name.toLowerCase());
    if (exists) { warning.classList.add('show'); setTimeout(() => warning.classList.remove('show'), 3000); return; }
    schoolData.teachers.push({full_name: name, email}); renderTeachers(); saveSchoolData();
    document.getElementById('newTeacherName').value = ''; document.getElementById('newTeacherEmail').value = '';
    updateTeacherDatalist();
}
function renderTeachers() { document.getElementById('teachersTable').innerHTML = schoolData.teachers.map((t,i) => `<tr><td>${t.full_name}</td><td>${t.email||'-'}</td><td><button class="small danger" onclick="removeTeacher(${i})">️ Удалить</button></td></tr>`).join(''); }
function removeTeacher(i) { schoolData.teachers.splice(i,1); renderTeachers(); saveSchoolData(); updateTeacherDatalist(); }

function addSubject() {
    const name = document.getElementById('newSubjectName').value.trim(); const warning = document.getElementById('subjectDuplicateWarning');
    if (!name) { alert('Введите название предмета'); return; }
    const exists = schoolData.subjects.some(s => s.name.toLowerCase() === name.toLowerCase());
    if (exists) { warning.classList.add('show'); setTimeout(() => warning.classList.remove('show'), 3000); return; }
    schoolData.subjects.push({name}); renderSubjects(); saveSchoolData(); document.getElementById('newSubjectName').value = '';
}
function renderSubjects() { document.getElementById('subjectsTable').innerHTML = schoolData.subjects.map((s,i) => `<tr><td>${s.name}</td><td><button class="small danger" onclick="removeSubject(${i})">️ Удалить</button></td></tr>`).join(''); }
function removeSubject(i) { schoolData.subjects.splice(i,1); renderSubjects(); saveSchoolData(); }

function addClassroom() {
    const number = document.getElementById('newClassroomNumber').value.trim(); const capacity = document.getElementById('newClassroomCapacity').value; const warning = document.getElementById('classroomDuplicateWarning');
    if (!number) { alert('Введите номер кабинета'); return; }
    const exists = schoolData.classrooms.some(c => c.number.toLowerCase() === number.toLowerCase());
    if (exists) { warning.classList.add('show'); setTimeout(() => warning.classList.remove('show'), 3000); return; }
    schoolData.classrooms.push({number, capacity: capacity?parseInt(capacity):null}); renderClassrooms(); saveSchoolData();
    document.getElementById('newClassroomNumber').value = ''; document.getElementById('newClassroomCapacity').value = '';
}
function renderClassrooms() { document.getElementById('classroomsTable').innerHTML = schoolData.classrooms.map((c,i) => `<tr><td>${c.number}</td><td>${c.capacity||'-'}</td><td><button class="small danger" onclick="removeClassroom(${i})">🗑️ Удалить</button></td></tr>`).join(''); }
function removeClassroom(i) { schoolData.classrooms.splice(i,1); renderClassrooms(); saveSchoolData(); }

function importFromExcel() {
    alert(' Функция импорта из Excel:\n\nВ реальной версии здесь откроется диалог выбора файла.\nСейчас добавлены демонстрационные данные для теста.');
    if(schoolData.teachers.length === 0) {
        schoolData.teachers.push({full_name: "Иванова М.П.", email: ""});
        schoolData.teachers.push({full_name: "Петров С.С.", email: ""});
        renderTeachers(); updateTeacherDatalist();
    }
    if(schoolData.subjects.length === 0) {
        schoolData.subjects.push({name: "Математика"});
        schoolData.subjects.push({name: "Русский язык"});
        renderSubjects();
    }
    saveSchoolData();
}

// --- Нагрузки и AI Шаблоны (Шаг 3) ---
function updateTeacherSelect() {
    const select = document.getElementById('teacherSelect');
    select.innerHTML = '<option value="">-- Выберите учителя --</option>' + schoolData.teachers.map(t => `<option value="${t.full_name}">${t.full_name}</option>`).join('');
}

function updateTeacherDatalist() {
    const datalist = document.getElementById('teacherDatalist');
    if (datalist) datalist.innerHTML = schoolData.teachers.map(t => `<option value="${t.full_name}">`).join('');
}

function loadTeacherCard() {
    const teacher = document.getElementById('teacherSelect').value;
    if (!teacher) { document.getElementById('teacherCard').style.display = 'none'; return; }
    document.getElementById('teacherCard').style.display = 'block';
    document.getElementById('currentTeacherName').textContent = teacher;
    renderWorkloads(teacher); renderAvailabilityGrid(teacher);
}

function renderWorkloads(teacher) {
    const workloads = schoolData.workloads.filter(w => w.teacher === teacher);
    document.getElementById('workloadList').innerHTML = workloads.map((w,i) => `
        <div class="workload-row">
            <div class="form-group autocomplete-wrapper">
                <label for="subject-${i}">Предмет</label>
                <input type="text" id="subject-${i}" class="workload-subject" value="${w.subject}" placeholder="Например: Математика" data-idx="${i}" data-field="subject" oninput="filterAutocomplete(this)" onfocus="showAutocomplete(this, 'subjects')">
                <div class="autocomplete-list" style="display:none"></div>
            </div>
            <div class="form-group autocomplete-wrapper">
                <label for="grade-${i}">Класс</label>
                <input type="text" id="grade-${i}" class="workload-grade" value="${w.grade}" placeholder="Например: 5А" data-idx="${i}" data-field="grade" oninput="filterAutocomplete(this)" onfocus="showAutocomplete(this, 'classes')">
                <div class="autocomplete-list" style="display:none"></div>
            </div>
            <div class="form-group hours-group">
                <label for="hours-${i}">Часы</label>
                <input type="number" id="hours-${i}" class="workload-hours" value="${w.hours}" data-idx="${i}" data-field="hours" min="1" max="20" onchange="updateWorkloadFromInput(this)">
            </div>
            <button class="small danger" onclick="removeWorkload(${i})">️ Удалить</button>
        </div>
    `).join('');
}

function showAutocomplete(input, type) {
    const list = input.nextElementSibling;
    const items = type === 'subjects' ? schoolData.subjects.map(s => s.name) : schoolData.classes.map(c => c.name);
    const value = input.value.toLowerCase();
    list.innerHTML = '';
    items.filter(item => item.toLowerCase().includes(value)).forEach(item => {
        const div = document.createElement('div'); div.className = 'autocomplete-item'; div.textContent = item;
        div.onclick = () => { input.value = item; list.style.display = 'none'; updateWorkloadFromInput(input); };
        list.appendChild(div);
    });
    if (list.children.length > 0) list.style.display = 'block';
}
function filterAutocomplete(input) { const list = input.nextElementSibling; if (list.style.display === 'block') showAutocomplete(input, input.classList.contains('workload-subject') ? 'subjects' : 'classes'); }
function updateWorkloadFromInput(input) {
    const idx = parseInt(input.dataset.idx); const field = input.dataset.field; const teacher = document.getElementById('teacherSelect').value;
    const workloads = schoolData.workloads.filter(w => w.teacher === teacher);
    if (workloads[idx]) { workloads[idx][field] = field === 'hours' ? parseInt(input.value) : input.value; saveSchoolData(); }
}
function addWorkload() { const teacher = document.getElementById('teacherSelect').value; if (!teacher) { alert('Сначала выберите учителя'); return; } schoolData.workloads.push({teacher, subject:'', grade:'', hours:1}); renderWorkloads(teacher); saveSchoolData(); }
function updateWorkload(idx, field, value) { const teacher = document.getElementById('teacherSelect').value; const workloads = schoolData.workloads.filter(w => w.teacher === teacher); if (workloads[idx]) { workloads[idx][field] = field === 'hours' ? parseInt(value) : value; saveSchoolData(); } }
function removeWorkload(idx) { const teacher = document.getElementById('teacherSelect').value; const workloads = schoolData.workloads.filter(w => w.teacher === teacher); const globalIdx = schoolData.workloads.indexOf(workloads[idx]); schoolData.workloads.splice(globalIdx, 1); renderWorkloads(teacher); saveSchoolData(); }

function renderAvailabilityGrid(teacher) {
    if(!teacher) return;
    const days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"];
    const slots = Array.from({length: schoolData.lessonsPerDay}, (_, i) => i+1);
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
            html += `<div class="availability-cell ${isAvailable?'available':'unavailable'}" onclick="toggleAvailability('${teacher}','${day}',${slot})">
                        <span>${slot}</span>
                     </div>`;
        });
    });
    document.getElementById('availabilityGrid').innerHTML = html;
}

function toggleAvailability(teacher, day, slot) {
    const idx = schoolData.availability[teacher][day].indexOf(slot);
    if (idx > -1) schoolData.availability[teacher][day].splice(idx, 1); else schoolData.availability[teacher][day].push(slot);
    renderAvailabilityGrid(teacher); saveSchoolData();
}

// Логика шаблонов
function selectTemplate(card, type) {
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
}

function getSelectedDays(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(cb => cb.checked).map(cb => cb.value);
}

function ensureTeacherExists(name) {
    if (!name) { alert('Введите ФИО учителя'); return false; }
    if (!schoolData.teachers.find(t => t.full_name.toLowerCase() === name.toLowerCase())) {
        schoolData.teachers.push({full_name: name, email: ''});
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
    if (days.length === 0) { alert('⚠️ Выберите хотя бы один день недели! \nБез выбранных дней учитель будет полностью недоступен.'); return; }

    const startTime = document.getElementById('tmpl_start').value;
    const endTime = document.getElementById('tmpl_end').value;

    const lessonTimes = schoolData.lessonTimes;
    if (!lessonTimes || lessonTimes.length === 0) { alert('❗ Сначала заполните сетку времени на Шаге 1!'); return; }

    const startParts = startTime.split(':');
    const endParts = endTime.split(':');
    const startMin = parseInt(startParts[0])*60 + parseInt(startParts[1]);
    const endMin = parseInt(endParts[0])*60 + parseInt(endParts[1]);

    const slots = [];
    lessonTimes.forEach((timeRange, i) => {
        const parts = timeRange.split('-');
        if (parts.length !== 2) return;
        const ls = parts[0].split(':'); const le = parts[1].split(':');
        const lStart = parseInt(ls[0])*60 + parseInt(ls[1]);
        const lEnd = parseInt(le[0])*60 + parseInt(le[1]);
        if (lStart >= startMin && lEnd <= endMin) slots.push(i+1);
    });

    if (slots.length === 0) { alert(`❌ В диапазоне ${startTime} - ${endTime} не найдено уроков.`); return; }

    if (schoolData.availability[name] && Object.keys(schoolData.availability[name]).length > 0) {
        if (!confirm(`⚠️ У учителя "${name}" уже есть настройки. Новые значения ПОЛНОСТЬЮ ЗАМЕНЯТ старые. Продолжить?`)) return;
    }

    schoolData.availability[name] = {};
    const allDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
    days.forEach(day => { schoolData.availability[name][day] = [...slots]; });
    allDays.forEach(day => { if (!days.includes(day)) schoolData.availability[name][day] = []; });

    saveSchoolData(); refreshTeacherCard(name);
    alert(`✅ Доступность применена для ${name}: ${days.join(', ')} — уроки ${slots.join(', ')}`);
}

function applyDaysTemplate() {
    const name = document.getElementById('tmpl_name2').value.trim();
    if (!ensureTeacherExists(name)) return;
    const days = getSelectedDays('.tmpl-day2');
    if (days.length === 0) { alert('⚠️ Выберите хотя бы один день!'); return; }

    const allSlots = Array.from({length: schoolData.lessonsPerDay}, (_, i) => i+1);
    const allDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

    if (schoolData.availability[name] && Object.keys(schoolData.availability[name]).length > 0) {
        if (!confirm(`⚠️ У учителя "${name}" уже есть настройки. Заменить?`)) return;
    }

    schoolData.availability[name] = {};
    days.forEach(day => { schoolData.availability[name][day] = [...allSlots]; });
    allDays.forEach(day => { if (!days.includes(day)) schoolData.availability[name][day] = []; });

    saveSchoolData(); refreshTeacherCard(name);
    alert(`✅ Дни применены для ${name}`);
}

function applyExcludeTemplate() {
    const name = document.getElementById('tmpl_name3').value.trim();
    if (!ensureTeacherExists(name)) return;
    const excludedDays = getSelectedDays('.tmpl-day3');
    if (excludedDays.length === 0) { alert('⚠️ Выберите дни для исключения!'); return; }

    const allDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
    const workingDays = allDays.filter(d => !excludedDays.includes(d));
    const allSlots = Array.from({length: schoolData.lessonsPerDay}, (_, i) => i+1);

    if (schoolData.availability[name] && Object.keys(schoolData.availability[name]).length > 0) {
        if (!confirm(`⚠️ У учителя "${name}" уже есть настройки. Заменить?`)) return;
    }

    schoolData.availability[name] = {};
    workingDays.forEach(day => { schoolData.availability[name][day] = [...allSlots]; });
    excludedDays.forEach(day => { schoolData.availability[name][day] = []; });

    saveSchoolData(); refreshTeacherCard(name);
    alert(`✅ Исключения применены для ${name}`);
}

// --- Генерация (Шаг 4) ---
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
            lessons: workloads.map(w => ({subject: w.subject, grade: w.grade, hours: w.hours})),
            availability: schoolData.availability[t.full_name] || {},
            max_days_per_week: 5
        };
    });

    if (Object.keys(teachers).length === 0) { err.textContent = 'Добавьте учителей с предметами'; err.classList.add('show'); return; }

    const days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"].slice(0, schoolData.days);
    const slots = Array.from({length: schoolData.lessonsPerDay}, (_, i) => i+1);
    const requestData = { days, slots, teachers };

    err.classList.remove('show'); succ.classList.remove('show');
    btn.disabled = true; btn.textContent = '⏳ Генерация...';
    document.getElementById('progressOverlay').classList.add('active');

    try {
        let attempts = 0; let success = false; let data;
        while (attempts < 3 && !success) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);
                const res = await fetch('/generate', {
                    method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken()},
                    body: JSON.stringify(requestData), signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`Ошибка ${res.status}`);
                data = await res.json(); success = true;
            } catch (e) {
                attempts++;
                if (attempts >= 3) throw e;
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        document.getElementById('progressOverlay').classList.remove('active');
        if (data.status === 'INVALID' || (data.validation_errors && data.validation_errors.length > 0)) {
            err.textContent = data.errors ? data.errors.join('; ') : data.validation_errors.join('; ');
            err.classList.add('show'); return;
        }

        // Загрузка полного расписания
        attempts = 0; let fullData;
        while (attempts < 3) {
            try {
                const fullRes = await fetch('/timetables/' + data.id, { headers: {'Authorization': 'Bearer ' + getToken()} });
                if (!fullRes.ok) throw new Error('Ошибка загрузки');
                fullData = await fullRes.json(); break;
            } catch (e) { attempts++; if (attempts >= 3) throw e; await new Promise(r => setTimeout(r, 2000)); }
        }

        if (!fullData || !fullData.data) throw new Error('Нет данных');

        currentResult = fullData.data; currentTimetableId = data.id;
        document.getElementById('statTeachers').textContent = currentResult.teachers.length;
        const totalLessons = currentResult.teachers.reduce((sum, t) => sum + t.total_lessons, 0);
        document.getElementById('statLessons').textContent = totalLessons;
        document.getElementById('statTime').textContent = currentResult.solution_time.toFixed(2) + 'с';
        document.getElementById('statStatus').textContent = currentResult.status;

        document.getElementById('resultsSection').classList.add('active');
        succ.textContent = '✅ Расписание составлено!'; succ.classList.add('show');
        renderSchedule(); loadSavedTimetables();

    } catch(e) {
        document.getElementById('progressOverlay').classList.remove('active');
        err.textContent = 'Ошибка: ' + e.message; err.classList.add('show');
    } finally { btn.disabled = false; btn.textContent = '🎯 Сгенерировать расписание'; }
}

function renderSchedule() {
    if (!currentResult || !currentResult.teachers) { document.getElementById('scheduleView').innerHTML = '<p>Нет данных</p>'; return; }
    const container = document.getElementById('scheduleView');
    let html = '<h3>📋 Расписание по учителям</h3>';
    currentResult.teachers.forEach(teacher => {
        html += '<div style="background:#f8f9fa;padding:20px;border-radius:10px;margin-bottom:20px">';
        html += '<h4 style="color:#667eea;margin-bottom:15px">👨‍🏫 ' + teacher.teacher + ' (' + teacher.total_lessons + ' уроков)</h4>';
        const days = Object.keys(teacher.schedule).sort();
        days.forEach(day => {
            html += '<div style="margin-bottom:10px"><strong>📅 ' + day + ':</strong><br>';
            const slots = Object.keys(teacher.schedule[day]).map(s => parseInt(s)).sort((a,b) => a-b);
            slots.forEach(slot => {
                const lessons = teacher.schedule[day][String(slot)];
                lessons.forEach(lesson => {
                    const classroom = lesson.classroom ? ` | 🏫 ${lesson.classroom}` : '';
                    const timeStr = schoolData.lessonTimes[slot-1] ? ` (${schoolData.lessonTimes[slot-1]})` : '';
                    html += '<div style="background:#f0f4ff;padding:8px;margin:5px 0;border-left:3px solid #667eea;border-radius:4px"><strong>Урок ' + slot + timeStr + ':</strong> ' + lesson.subject + ' <span style="color:#666">(' + lesson.grade + ' класс' + classroom + ')</span></div>';
                });
            });
            html += '</div>';
        });
        html += '</div>';
    });
    container.innerHTML = html;
}

async function showMasterView() {
    if (!currentTimetableId) { alert('Сначала сгенерируйте расписание'); return; }
    try {
        const res = await fetch(`/timetables/${currentTimetableId}/master-view`, { headers: {'Authorization': 'Bearer ' + getToken()} });
        const data = await res.json();
        if (res.ok) {
            masterViewData = data; renderMasterView();
            document.getElementById('scheduleView').style.display = 'none';
            document.getElementById('masterViewContainer').style.display = 'block';
        } else alert('Ошибка: ' + data.detail);
    } catch(e) { alert('Ошибка соединения'); }
}

function renderMasterView() {
    if (!masterViewData) return;
    const container = document.getElementById('masterViewContainer');
    const { days, slots, schedule } = masterViewData;
    const times = schoolData.lessonTimes || [];

    const allGrades = new Set();
    Object.values(schedule).forEach(dayObj => Object.values(dayObj).forEach(slotObj => Object.keys(slotObj).forEach(g => allGrades.add(g))));
    const sortedGrades = Array.from(allGrades).sort((a,b) => parseInt(a) - parseInt(b));

    let html = `<div class="master-table-container"><h3>📋 Общее расписание</h3><table class="master-table"><thead><tr><th style="width:120px">Время</th>${sortedGrades.map(g=>`<th>${g} кл</th>`).join('')}</tr></thead><tbody>`;

    days.forEach(day => {
        html += `<tr><td colspan="${sortedGrades.length+1}" class="day-header">${day}</td></tr>`;
        slots.forEach((slot, idx) => {
            const timeLabel = times[idx] || '';
            html += `<tr><td style="font-weight:bold;text-align:center;background:#fafafa"><div>Урок ${slot}</div><div style="font-size:11px;color:#666">${timeLabel}</div></td>`;
            sortedGrades.forEach(grade => {
                const lesson = schedule[day][String(slot)]?.[grade];
                if (lesson) html += `<td class="lesson-cell"><span class="lesson-subject">${lesson.subject}</span><span class="lesson-details">👨🏫 ${lesson.teacher}</span><span class="lesson-details">🏫 ${lesson.classroom||'-'}</span></td>`;
                else html += `<td class="empty-cell"></td>`;
            });
            html += `</tr>`;
            if (idx < slots.length - 1) {
                const nextT = times[idx+1]?.split('-')[0]; const currE = timeLabel?.split('-')[1];
                const brk = (currE && nextT) ? `${currE}-${nextT}` : '';
                html += `<tr class="break-row"><td>Перемена ${brk?`(${brk})`:''}</td><td colspan="${sortedGrades.length}" style="background:#fff3cd"></td></tr>`;
            }
        });
    });
    html += `</tbody></table></div><button class="outline" style="margin-top:15px" onclick="hideMasterView()">⬅️ Назад</button>`;
    container.innerHTML = html;
}

function hideMasterView() {
    document.getElementById('masterViewContainer').style.display = 'none';
    document.getElementById('scheduleView').style.display = 'block';
}

// Сохраненные расписания
async function loadSavedTimetables() {
    if (!checkAuth()) return;
    const container = document.getElementById('savedTimetablesList');
    if (!container) return;
    try {
        const res = await fetch('/timetables', { headers: {'Authorization': 'Bearer ' + getToken()} });
        if (!res.ok) throw new Error('Ошибка');
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            container.innerHTML = data.map(t => `
                <div class="saved-timetable-item">
                    <div><h4>${t.name}</h4><p>${new Date(t.created_at).toLocaleString('ru-RU')}</p></div>
                    <div class="saved-timetable-actions">
                        <button class="small primary" onclick="window.loadSavedTimetable(${t.id})">👁️ Открыть</button>
                        <button class="small outline" onclick="window.downloadSavedPDF(${t.id}, 'teachers')">PDF (уч.)</button>
                        <button class="small outline" onclick="window.downloadSavedPDF(${t.id}, 'classes')">PDF (кл.)</button>
                        <button class="small danger" onclick="window.deleteSavedTimetable(${t.id})">🗑️</button>
                    </div>
                </div>
            `).join('');
        } else container.innerHTML = '<p style="color:#999;text-align:center">Нет расписаний</p>';
    } catch(e) { container.innerHTML = '<p style="color:#c33">Ошибка загрузки</p>'; }
}

window.loadSavedTimetable = async function(id) {
    if (!checkAuth()) return;
    try {
        const res = await fetch('/timetables/' + id, { headers: {'Authorization': 'Bearer ' + getToken()} });
        const data = await res.json();
        if (res.ok && data.data) {
            currentResult = data.data; currentTimetableId = id;
            document.getElementById('statTeachers').textContent = currentResult.teachers.length;
            document.getElementById('statLessons').textContent = currentResult.teachers.reduce((s,t)=>s+t.total_lessons,0);
            document.getElementById('statTime').textContent = currentResult.solution_time.toFixed(2)+'с';
            document.getElementById('statStatus').textContent = currentResult.status;
            document.getElementById('resultsSection').classList.add('active'); renderSchedule();
            alert('✅ Расписание загружено');
        } else alert('Ошибка');
    } catch(e) { alert('Ошибка: '+e.message); }
};

window.deleteSavedTimetable = async function(id) {
    if (!checkAuth()) return; if (!confirm('Удалить?')) return;
    try {
        const res = await fetch('/timetables/' + id, { method: 'DELETE', headers: {'Authorization': 'Bearer ' + getToken()} });
        if (res.ok) { loadSavedTimetables(); alert('✅ Удалено'); }
        else alert('Ошибка');
    } catch(e) { alert('Ошибка'); }
};

window.downloadSavedPDF = async function(id, format) {
    if (!checkAuth()) return;
    try {
        const res = await fetch(`/timetables/${id}/export/pdf?format=${format}`, { headers: {'Authorization': 'Bearer ' + getToken()} });
        if (!res.ok) throw new Error('Ошибка');
        const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = `timetable_${id}.pdf`; document.body.appendChild(a); a.click();
        window.URL.revokeObjectURL(url); document.body.removeChild(a);
    } catch(e) { alert('Ошибка скачивания'); }
};

function downloadPDF(format) { if (!currentTimetableId) { alert('Сначала сгенерируйте'); return; } window.downloadSavedPDF(currentTimetableId, format); }
function downloadExcel(format) { /* Аналогично PDF, но для excel */ }