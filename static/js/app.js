// static/js/app.js
// Навигация и рендер страниц нового интерфейса «АРМ Завуча»

const PAGE_TITLES = {
    dashboard: ['Дашборд', 'Главная / Сводка'],
    schedule: ['Расписание', 'Главное / Расписание'],
    wizard: ['Мастер настройки', 'Главное / Пошаговая настройка'],
    plans: ['Учебные планы', 'Управление / Планы'],
    substitutions: ['Замены', 'Управление / Замены'],
    hours: ['Учёт часов', 'Управление / Часы'],
    reports: ['Отчёты', 'Управление / Отчёты'],
};

// ---------- Общие утилиты ----------
function _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _ensureData() {
    if (!Array.isArray(schoolData.planItems)) schoolData.planItems = [];
    if (!Array.isArray(schoolData.substitutions)) schoolData.substitutions = [];
    if (!Array.isArray(schoolData.activityLog)) schoolData.activityLog = [];
}

function _subjects() { return (schoolData.subjects || []).map(s => s.name); }
function _classes() { return (schoolData.classes || []).map(c => c.name); }
function _teachers() { return (schoolData.teachers || []).map(t => t.full_name); }

function _esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function _fillSelect(id, values, placeholder) {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    const head = (placeholder !== undefined) ? `<option value="">${_esc(placeholder)}</option>` : '';
    el.innerHTML = head + values.map(v => `<option value="${_esc(v)}">${_esc(v)}</option>`).join('');
    if (values.includes(cur)) el.value = cur;
}

function logActivity(action) {
    _ensureData();
    const now = new Date();
    schoolData.activityLog.unshift({
        t: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        user: localStorage.getItem('full_name') || 'Пользователь',
        action: action,
    });
    schoolData.activityLog = schoolData.activityLog.slice(0, 20);
    saveSchoolData();
}

// ---------- Навигация ----------
function openPage(pageId, navElement) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const target = navElement || document.querySelector('.nav-item[data-page="' + pageId + '"]');
    if (target) target.classList.add('active');

    const meta = PAGE_TITLES[pageId] || ['', ''];
    const titleEl = document.getElementById('page-title');
    const crumbsEl = document.getElementById('page-crumbs');
    if (titleEl) titleEl.textContent = meta[0];
    if (crumbsEl) crumbsEl.textContent = meta[1];

    if (pageId === 'dashboard') renderDashboard();
    if (pageId === 'schedule') renderSchedulePage();
    if (pageId === 'plans') renderPlans();
    if (pageId === 'substitutions') renderSubstitutions();
    if (pageId === 'hours') renderHours();
}

// «Справочники» — это шаг 2 мастера настройки
function openDirectories() {
    openPage('wizard', document.querySelector('.nav-item[data-page="wizard"]'));
    if (typeof goToStep === 'function') goToStep(2);
}

// ---------- Текущая неделя ----------
function getCurrentWeekInfo() {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    const blue = week % 2 === 1;
    return { week: week, blue: blue, label: blue ? 'Синяя (нечётная)' : 'Красная (чётная)' };
}

// ---------- Дашборд ----------
function updateDashboardCounts() {
    _ensureData();

    let totalLessons = 0;
    const usedRooms = new Set();
    if (currentResult && currentResult.teachers) {
        currentResult.teachers.forEach(t => {
            totalLessons += t.total_lessons || 0;
            Object.values(t.schedule || {}).forEach(bySlot => {
                Object.values(bySlot).forEach(arr => (arr || []).forEach(l => {
                    if (l.classroom) usedRooms.add(l.classroom);
                }));
            });
        });
    }
    const plannedHours = (schoolData.workloads || []).reduce((s, w) => s + (parseInt(w.hours) || 0), 0);
    const pending = _substitutionsCache.filter(s => !s.substitute).length;
    const freeRooms = Math.max(0, (schoolData.classrooms || []).length - usedRooms.size);

    _setText('dashLessons', totalLessons);
    _setText('dashHours', plannedHours);
    _setText('dashSubs', pending);
    _setText('dashRooms', freeRooms);

    const badge = document.getElementById('subsBadge');
    if (badge) {
        badge.textContent = pending;
        badge.style.display = pending ? 'inline-block' : 'none';
    }

    const weekEl = document.getElementById('dashWeek');
    if (weekEl) {
        const wi = getCurrentWeekInfo();
        weekEl.textContent = wi.label;
        weekEl.classList.toggle('week-blue', wi.blue);
        weekEl.classList.toggle('week-red', !wi.blue);
    }
    const hintEl = document.getElementById('dashWeekHint');
    if (hintEl) {
        const wi = getCurrentWeekInfo();
        hintEl.textContent = 'На этой неделе действуют уроки с маркировкой «Каждую» и «' + (wi.blue ? 'Синяя' : 'Красная') + '».';
    }
}

function renderDashboard() {
    _ensureData();
    updateDashboardCounts();

    const tbody = document.querySelector('#dashActions tbody');
    if (!tbody) return;
    const log = schoolData.activityLog || [];
    tbody.innerHTML = log.length
        ? log.slice(0, 10).map(e => '<tr><td>' + _esc(e.t) + '</td><td>' + _esc(e.user) + '</td><td>' + _esc(e.action) + '</td></tr>').join('')
        : '<tr><td colspan="3" class="muted">Пока нет действий</td></tr>';
}

// ---------- Расписание ----------
function _collectGrades() {
    const grades = new Set();
    if (currentResult && currentResult.teachers) {
        currentResult.teachers.forEach(t => {
            Object.values(t.schedule || {}).forEach(bySlot => {
                Object.values(bySlot).forEach(arr => (arr || []).forEach(l => l && l.grade && grades.add(l.grade)));
            });
        });
    }
    return [...grades].sort((a, b) => a.localeCompare(b, 'ru'));
}

function renderSchedulePage() {
    const wrap = document.getElementById('schedulePageGrid');
    if (!wrap) return;

    const filterEl = document.getElementById('scheduleClassFilter');
    if (filterEl) {
        const cur = filterEl.value;
        filterEl.innerHTML = '<option value="">Все классы</option>' +
            _collectGrades().map(g => '<option value="' + _esc(g) + '">' + _esc(g) + '</option>').join('');
        filterEl.value = cur;
    }
    const grade = filterEl ? filterEl.value : '';

    if (!currentResult || !currentResult.teachers) {
        wrap.innerHTML = '<p class="muted" style="padding:20px">Расписание ещё не сгенерировано. Перейдите в «Мастер настройки» → «Генерация».</p>';
        return;
    }

    const days = currentResult.days || ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
    const slots = currentResult.slots || [1, 2, 3, 4, 5, 6, 7];
    const times = getLessonTimes();
    const todayName = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][new Date().getDay()];

    const map = {};
    currentResult.teachers.forEach(t => {
        Object.entries(t.schedule || {}).forEach(([day, bySlot]) => {
            Object.entries(bySlot || {}).forEach(([slot, lessons]) => {
                (lessons || []).forEach(l => {
                    if (grade && l.grade !== grade) return;
                    const key = day + '|' + slot;
                    (map[key] = map[key] || []).push({ subject: l.subject, grade: l.grade, classroom: l.classroom, teacher: t.teacher });
                });
            });
        });
    });

    let html = '<table class="timetable"><thead><tr><th>Время</th>';
    days.forEach(d => { html += '<th class="' + (d === todayName ? 'today' : '') + '">' + _esc(d) + '</th>'; });
    html += '</tr></thead><tbody>';
    slots.forEach((slot, idx) => {
        const parts = (times[idx] || '').split('-');
        html += '<tr><td>' + _esc(parts[0] || '') + '<br>' + _esc(parts[1] || '') + '</td>';
        days.forEach(day => {
            const lessons = map[day + '|' + String(slot)] || [];
            html += '<td>';
            lessons.forEach(l => {
                html += '<div class="lesson-card" data-week="every">' +
                    '<div class="marker"><span class="dot both"></span></div>' +
                    '<div class="title">' + _esc(l.subject) + '</div>' +
                    '<div class="meta">' + _esc(l.grade) + ' · ' + _esc(l.classroom || '—') + ' · ' + _esc(l.teacher) + '</div>' +
                    '</div>';
            });
            html += '</td>';
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
}

function filterScheduleWeek(type, btn) {
    if (btn) {
        const buttons = btn.parentElement.querySelectorAll('button');
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const wrap = document.getElementById('schedulePageGrid');
    if (!wrap) return;
    wrap.querySelectorAll('.lesson-card').forEach(card => {
        const week = card.getAttribute('data-week') || 'every';
        let show = true;
        if (type === 'blue') show = week !== 'red';
        else if (type === 'red') show = week !== 'blue';
        card.style.display = show ? '' : 'none';
    });
}

// ---------- Учебные планы ----------
function renderPlans() {
    _ensureData();
    _fillSelect('planSubject', _subjects());
    _fillSelect('planGrade', _classes());
    _fillSelect('planTeacher', _teachers(), '-- Выберите учителя --');
    renderPlanItems();
    renderPlanAssignments();
}

function renderPlanItems() {
    const tbody = document.querySelector('#plansTable tbody');
    if (!tbody) return;
    const items = schoolData.planItems || [];
    tbody.innerHTML = items.length
        ? items.map(it => '<tr>' +
            '<td>' + _esc(it.subject) + '</td>' +
            '<td>' + _esc(it.grade) + '</td>' +
            '<td>' + _esc(it.hours) + '</td>' +
            '<td><button class="small danger" onclick="removePlanItem(\'' + it.id + '\')" title="Удалить из плана" aria-label="Удалить из плана">🗑</button></td>' +
            '</tr>').join('')
        : '<tr><td colspan="4" class="muted">План пуст</td></tr>';
}

function addPlanItem() {
    _ensureData();
    const subjectEl = document.getElementById('planSubject');
    const gradeEl = document.getElementById('planGrade');
    const hoursEl = document.getElementById('planHours');
    const subject = subjectEl ? subjectEl.value : '';
    const grade = gradeEl ? gradeEl.value : '';
    const hours = hoursEl ? (parseInt(hoursEl.value) || 1) : 1;
    if (!subject || !grade) { alert('Выберите предмет и класс'); return; }
    if (schoolData.planItems.some(p => p.subject === subject && p.grade === grade)) {
        alert('Такая позиция уже есть в плане');
        return;
    }
    schoolData.planItems.push({ id: _uid(), subject: subject, grade: grade, hours: hours });
    saveSchoolData();
    renderPlanItems();
    renderPlanAssignments();
    logActivity('В план добавлено: ' + subject + ' · ' + grade + ' · ' + hours + ' ч');
}

function removePlanItem(id) {
    schoolData.planItems = (schoolData.planItems || []).filter(p => p.id !== id);
    saveSchoolData();
    renderPlanItems();
    renderPlanAssignments();
}

function renderPlanAssignments() {
    const box = document.getElementById('planAssignments');
    if (!box) return;
    const teacherEl = document.getElementById('planTeacher');
    const teacher = teacherEl ? teacherEl.value : '';
    if (!teacher) {
        box.innerHTML = '<p class="muted">Выберите учителя, чтобы отметить предметы галочками.</p>';
        return;
    }
    const items = schoolData.planItems || [];
    if (!items.length) {
        box.innerHTML = '<p class="muted">Сначала добавьте предметы и часы в план выше.</p>';
        return;
    }
    box.innerHTML = items.map(it => {
        const checked = (schoolData.workloads || []).some(w =>
            w.teacher === teacher && w.subject === it.subject && w.grade === it.grade);
        return '<label class="plan-check ' + (checked ? 'checked' : '') + '">' +
            '<input type="checkbox" ' + (checked ? 'checked' : '') +
            ' onchange="togglePlanAssignment(\'' + it.id + '\', this.checked)">' +
            '<span class="pc-subject">' + _esc(it.subject) + '</span>' +
            '<span class="pc-meta">' + _esc(it.grade) + ' · ' + _esc(it.hours) + ' ч/нед</span>' +
            '</label>';
    }).join('');
}

function togglePlanAssignment(itemId, checked) {
    _ensureData();
    const teacherEl = document.getElementById('planTeacher');
    const teacher = teacherEl ? teacherEl.value : '';
    const item = (schoolData.planItems || []).find(p => p.id === itemId);
    if (!teacher || !item) return;

    if (checked) {
        const exists = (schoolData.workloads || []).some(w =>
            w.teacher === teacher && w.subject === item.subject && w.grade === item.grade);
        if (!exists) {
            schoolData.workloads.push({ teacher: teacher, subject: item.subject, grade: item.grade, classroom: '', hours: item.hours });
            logActivity('Назначено: ' + teacher + ' — ' + item.subject + ' (' + item.grade + ')');
        }
    } else {
        schoolData.workloads = (schoolData.workloads || []).filter(w =>
            !(w.teacher === teacher && w.subject === item.subject && w.grade === item.grade));
    }
    saveSchoolData();
    renderPlanAssignments();
    updateDashboardCounts();
}

// ---------- Замены (общий серверный журнал) ----------
let _substitutionsCache = [];

function _updateSubsBadge() {
    const pending = _substitutionsCache.filter(s => !s.substitute).length;
    const badge = document.getElementById('subsBadge');
    if (badge) {
        badge.textContent = pending;
        badge.style.display = pending ? 'inline-block' : 'none';
    }
    _setText('dashSubs', pending);
}

async function loadSubstitutions() {
    try {
        const res = await fetch('/api/substitutions', {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (res.ok) {
            _substitutionsCache = await res.json();
        } else {
            console.error('Не удалось загрузить замены:', res.status);
        }
    } catch (e) {
        console.error('Ошибка сети при загрузке замен:', e);
    }
    _updateSubsBadge();
    return _substitutionsCache;
}

async function renderSubstitutions() {
    _fillSelect('subGrade', _classes(), 'Все');
    _fillSelect('subAbsent', _teachers(), '-- Выберите --');
    _fillSelect('subSubstitute', _teachers(), '— нет —');
    onSubAbsentChange();

    const dateEl = document.getElementById('subDate');
    if (dateEl && !dateEl.value) {
        const now = new Date();
        dateEl.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }
    await loadSubstitutions();
    renderSubsTable();
}

// В списке «Замена» не должно быть отсутствующего учителя
function onSubAbsentChange() {
    const absentEl = document.getElementById('subAbsent');
    const subEl = document.getElementById('subSubstitute');
    if (!subEl) return;
    const absent = absentEl ? absentEl.value : '';
    const cur = subEl.value;
    const options = _teachers().filter(t => t !== absent);
    subEl.innerHTML = '<option value="">— нет —</option>' +
        options.map(t => '<option value="' + _esc(t) + '">' + _esc(t) + '</option>').join('');
    if (options.includes(cur)) subEl.value = cur;
}

function renderSubsTable() {
    const tbody = document.querySelector('#subsTable tbody');
    if (!tbody) return;
    const subs = _substitutionsCache || [];
    if (!subs.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted">Замен пока нет</td></tr>';
        return;
    }
    tbody.innerHTML = subs.map(s => {
        const replaced = !!s.substitute;
        const status = '<span class="badge-status ' + (replaced ? 'badge-green' : 'badge-red') + '">' +
            (replaced ? 'Заменён' : 'Нет замены') + '</span>';

        let subCell;
        if (replaced) {
            subCell = _esc(s.substitute) +
                ' <button class="small" onclick="clearSubstitute(\'' + s.id + '\')" title="Снять замену">✕</button>';
        } else {
            const options = _teachers().filter(t => t !== s.absent);
            subCell = '<select class="form-control sub-select" onchange="setSubstitute(\'' + s.id + '\', this.value)">' +
                '<option value="">— выбрать —</option>' +
                options.map(t => '<option value="' + _esc(t) + '">' + _esc(t) + '</option>').join('') +
                '</select>';
        }

        return '<tr>' +
            '<td>' + _esc(s.date || '—') + '</td>' +
            '<td>Урок ' + _esc(s.slot) + '</td>' +
            '<td>' + _esc(s.grade || '—') + '</td>' +
            '<td>' + _esc(s.absent || '—') + '</td>' +
            '<td>' + subCell + '</td>' +
            '<td>' + status + '</td>' +
            '<td><button class="small danger" onclick="removeSubstitution(\'' + s.id + '\')" title="Удалить запись" aria-label="Удалить запись">🗑</button></td>' +
            '</tr>';
    }).join('');
}

async function addSubstitution() {
    const date = (document.getElementById('subDate') || {}).value || '';
    const slot = parseInt((document.getElementById('subSlot') || {}).value) || 1;
    const grade = (document.getElementById('subGrade') || {}).value || '';
    const absent = (document.getElementById('subAbsent') || {}).value || '';
    const substitute = (document.getElementById('subSubstitute') || {}).value || '';
    if (!absent) { alert('Выберите отсутствующего учителя'); return; }
    if (substitute && substitute === absent) {
        alert('Замена не может совпадать с отсутствующим учителем');
        return;
    }

    try {
        const res = await fetch('/api/substitutions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
            body: JSON.stringify({ date: date, slot: slot, grade: grade, absent: absent, substitute: substitute })
        });
        if (!res.ok) throw new Error('Ошибка ' + res.status);
        await loadSubstitutions();
        renderSubsTable();
        logActivity('Добавлена замена: ' + (grade || '') + ', урок ' + slot + ', ' + absent + (substitute ? ' → ' + substitute : ''));
    } catch (e) {
        alert('Не удалось добавить замену: ' + e.message);
    }
}

async function setSubstitute(id, value) {
    if (!value) return;
    try {
        const res = await fetch('/api/substitutions/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
            body: JSON.stringify({ substitute: value })
        });
        if (!res.ok) throw new Error('Ошибка ' + res.status);
        await loadSubstitutions();
        renderSubsTable();
        logActivity('Назначена замена → ' + value);
    } catch (e) {
        alert('Не удалось назначить замену: ' + e.message);
    }
}

async function clearSubstitute(id) {
    try {
        const res = await fetch('/api/substitutions/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
            body: JSON.stringify({ substitute: '' })
        });
        if (!res.ok) throw new Error('Ошибка ' + res.status);
        await loadSubstitutions();
        renderSubsTable();
    } catch (e) {
        alert('Не удалось снять замену: ' + e.message);
    }
}

async function removeSubstitution(id) {
    try {
        const res = await fetch('/api/substitutions/' + id, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (!res.ok) throw new Error('Ошибка ' + res.status);
        await loadSubstitutions();
        renderSubsTable();
    } catch (e) {
        alert('Не удалось удалить запись: ' + e.message);
    }
}

// ---------- Учёт часов ----------
function _actualHoursFor(teacher, subject, grade) {
    if (!currentResult || !currentResult.teachers) return 0;
    const t = currentResult.teachers.find(x => x.teacher === teacher);
    if (!t || !t.schedule) return 0;
    let n = 0;
    Object.values(t.schedule).forEach(bySlot => {
        Object.values(bySlot).forEach(arr => (arr || []).forEach(l => {
            if (l.subject === subject && String(l.grade) === String(grade)) n++;
        }));
    });
    return n;
}

function renderHours() {
    const tbody = document.querySelector('#hoursTable tbody');
    if (!tbody) return;
    const rows = schoolData.workloads || [];
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">Нет данных о нагрузках</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(w => {
        const planned = parseInt(w.hours) || 0;
        const actual = _actualHoursFor(w.teacher, w.subject, w.grade);
        const diff = actual - planned;
        const cls = diff === 0 ? 'badge-green' : (diff < 0 ? 'badge-red' : 'badge-yellow');
        return '<tr>' +
            '<td>' + _esc(w.teacher) + '</td>' +
            '<td>' + _esc(w.subject || '—') + '</td>' +
            '<td>' + _esc(w.grade || '—') + '</td>' +
            '<td>' + planned + '</td>' +
            '<td>' + actual + '</td>' +
            '<td><span class="badge-status ' + cls + '">' + (diff > 0 ? '+' : '') + diff + '</span></td>' +
            '</tr>';
    }).join('');
}
