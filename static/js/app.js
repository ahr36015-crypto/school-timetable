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
    if (pageId === 'hours') renderHours();
}

// «Справочники» — это шаг 2 мастера настройки
function openDirectories() {
    openPage('wizard', document.querySelector('.nav-item[data-page="wizard"]'));
    if (typeof goToStep === 'function') goToStep(2);
}

function _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// ---------- Дашборд ----------
function renderDashboard() {
    let totalLessons = 0;
    if (currentResult && currentResult.teachers) {
        currentResult.teachers.forEach(t => { totalLessons += t.total_lessons || 0; });
    }
    const plannedHours = (schoolData.workloads || []).reduce((s, w) => s + (parseInt(w.hours) || 0), 0);
    _setText('dashLessons', totalLessons);
    _setText('dashHours', plannedHours);
    _setText('dashSubs', 0);
    _setText('dashRooms', (schoolData.classrooms || []).length);

    const tbody = document.querySelector('#dashActions tbody');
    if (tbody) {
        const rows = [];
        if (currentResult) {
            rows.push(['—', 'Система', 'Сгенерировано расписание (' + (currentResult.status || '') + ')']);
        }
        if ((schoolData.teachers || []).length) {
            rows.push(['—', localStorage.getItem('full_name') || 'Пользователь',
                'В справочниках: ' + schoolData.teachers.length + ' учителей, ' + schoolData.classes.length + ' классов']);
        }
        tbody.innerHTML = rows.length
            ? rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('')
            : '<tr><td colspan="3" class="muted">Пока нет действий</td></tr>';
    }
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
            _collectGrades().map(g => '<option value="' + g + '">' + g + '</option>').join('');
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
    days.forEach(d => { html += '<th>' + d + '</th>'; });
    html += '</tr></thead><tbody>';
    slots.forEach((slot, idx) => {
        const parts = (times[idx] || '').split('-');
        html += '<tr><td>' + (parts[0] || '') + '<br>' + (parts[1] || '') + '</td>';
        days.forEach(day => {
            const lessons = map[day + '|' + String(slot)] || [];
            html += '<td>';
            lessons.forEach(l => {
                html += '<div class="lesson-card" data-week="every">' +
                    '<div class="marker"><span class="dot both"></span></div>' +
                    '<div class="title">' + l.subject + '</div>' +
                    '<div class="meta">' + l.grade + ' · ' + (l.classroom || '—') + ' · ' + l.teacher + '</div>' +
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
    const tbody = document.querySelector('#plansTable tbody');
    if (!tbody) return;
    const rows = schoolData.workloads || [];
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">Нагрузки не заданы</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(w => '<tr>' +
        '<td>' + w.teacher + '</td>' +
        '<td>' + (w.subject || '—') + '</td>' +
        '<td>' + (w.grade || '—') + '</td>' +
        '<td>' + (parseInt(w.hours) || 0) + '</td>' +
        '<td>Каждую неделю</td>' +
        '</tr>').join('');
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
            '<td>' + w.teacher + '</td>' +
            '<td>' + (w.subject || '—') + '</td>' +
            '<td>' + (w.grade || '—') + '</td>' +
            '<td>' + planned + '</td>' +
            '<td>' + actual + '</td>' +
            '<td><span class="badge-status ' + cls + '">' + (diff > 0 ? '+' : '') + diff + '</span></td>' +
            '</tr>';
    }).join('');
}
