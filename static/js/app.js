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
    if (!Array.isArray(schoolData.holidays)) schoolData.holidays = [];
    if (!Array.isArray(schoolData.transfers)) schoolData.transfers = [];
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
    if (pageId === 'schedule') {
        renderSchedulePage();
        renderCalendarLists();
        if (typeof loadSubstitutions === 'function') {
            loadSubstitutions().then(() => renderSchedulePage());
        }
    }
    if (pageId === 'plans') renderPlans();
    if (pageId === 'substitutions') renderSubstitutions();
    if (pageId === 'hours') renderHours();
}

// «Справочники» — это шаг 2 мастера настройки
function openDirectories() {
    openPage('wizard', document.querySelector('.nav-item[data-page="wizard"]'));
    if (typeof goToStep === 'function') goToStep(2);
}

// ---------- Текущая неделя (двухнедельный цикл) ----------
function _normWeek(v) {
    return (v === 0 || v === 1) ? v : null;
}

function weekLabelText(wi) {
    if (wi === 0) return 'Синяя неделя';
    if (wi === 1) return 'Красная неделя';
    return 'Каждую неделю';
}

function weekShortText(wi) {
    if (wi === 0) return 'синяя';
    if (wi === 1) return 'красная';
    return 'каждую';
}

function getWeekConfig() {
    const cfg = schoolData.weekConfig || {};
    let anchor = cfg.anchorDate;
    if (!anchor) {
        const now = new Date();
        const d = new Date(now.getFullYear(), 8, 1); // 1 сентября
        const dow = (d.getDay() + 6) % 7; // Пн=0
        d.setDate(d.getDate() + ((7 - dow) % 7));
        anchor = d.toISOString().slice(0, 10);
    }
    return { anchorDate: anchor, anchorIsBlue: cfg.anchorIsBlue !== false };
}

function _mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dow = (d.getDay() + 6) % 7; // Пн=0
    d.setDate(d.getDate() - dow);
    return d;
}

function _isoLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _currentWeekDates() {
    const names = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    const mon = _mondayOf(new Date());
    const map = {};
    names.forEach((n, i) => {
        const d = new Date(mon.getTime());
        d.setDate(mon.getDate() + i);
        map[n] = _isoLocal(d);
    });
    return map;
}

function getCurrentWeekInfo() {
    const cfg = getWeekConfig();
    const anchor = _mondayOf(new Date(cfg.anchorDate + 'T00:00:00'));
    const today = _mondayOf(new Date());
    const diffWeeks = Math.round((today - anchor) / (7 * 24 * 3600 * 1000));
    const blue = (diffWeeks % 2 === 0) ? cfg.anchorIsBlue : !cfg.anchorIsBlue;
    return {
        weekNumber: diffWeeks,
        weekIndex: blue ? 0 : 1,
        blue: blue,
        label: (blue ? 'Синяя' : 'Красная') + ' неделя'
    };
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
    const plannedHours = Math.round((schoolData.workloads || []).reduce((s, w) => {
        const h = parseInt(w.hours) || 1;
        const wi = _normWeek(w.weekIndex);
        return s + (wi === null ? h : h / 2);
    }, 0) * 10) / 10;
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
    const weekDates = _currentWeekDates();
    const todayStr = _isoLocal(new Date());
    const holidays = schoolData.holidays || [];
    const transfers = schoolData.transfers || [];
    const subsToday = (_substitutionsCache || []).filter(s => s.date === todayStr);

    const map = {};
    currentResult.teachers.forEach(t => {
        Object.entries(t.schedule || {}).forEach(([day, bySlot]) => {
            Object.entries(bySlot || {}).forEach(([slot, lessons]) => {
                (lessons || []).forEach(l => {
                    if (grade && l.grade !== grade) return;
                    const key = day + '|' + slot;
                    (map[key] = map[key] || []).push({ subject: l.subject, grade: l.grade, classroom: l.classroom, teacher: t.teacher, week_index: _normWeek(l.week_index), half: l.half === true });
                });
            });
        });
    });

    let html = '<table class="timetable"><thead><tr><th>Время</th>';
    days.forEach(d => {
        const date = weekDates[d];
        const isHoliday = date && holidays.includes(date);
        const tr = date ? transfers.find(x => x.date === date) : null;
        let extra = '';
        if (isHoliday) extra = ' <small>(праздник)</small>';
        else if (tr) extra = ' <small>(перенос: ' + _esc(tr.toDay) + ')</small>';
        html += '<th class="' + (d === todayName ? 'today ' : '') + (isHoliday ? 'holiday' : '') + '">' + _esc(d) + extra + '</th>';
    });
    html += '</tr></thead><tbody>';
    slots.forEach((slot, idx) => {
        const parts = (times[idx] || '').split('-');
        html += '<tr><td>' + _esc(parts[0] || '') + '<br>' + _esc(parts[1] || '') + '</td>';
        days.forEach(day => {
            const lessons = map[day + '|' + String(slot)] || [];
            html += '<td>';
            lessons.forEach(l => {
                const wi = _normWeek(l.week_index);
                const wk = wi === 0 ? 'blue' : (wi === 1 ? 'red' : 'every');
                const dot = wk === 'every' ? 'both' : wk;
                const halfTxt = (l.half === true) ? ' <small>(0,5 ч)</small>' : '';

                // учёт замен на сегодня
                let teacherName = l.teacher;
                let wasSub = false;
                let noSub = false;
                if (day === todayName) {
                    const sub = subsToday.find(s => String(s.grade) === String(l.grade) && String(s.slot) === String(slot));
                    if (sub) {
                        if (sub.substitute) { teacherName = sub.substitute; wasSub = true; }
                        else { teacherName = sub.absent || l.teacher; noSub = true; }
                    }
                }

                const cls = 'lesson-card' + (l.half ? ' half' : '') + (wasSub ? ' substituted' : '');
                html += '<div class="' + cls + '" data-week="' + wk + '">' +
                    '<div class="marker"><span class="dot ' + dot + '"></span></div>' +
                    '<div class="title">' + _esc(l.subject) + halfTxt + (wi === null ? '' : ' <small>(' + weekShortText(wi) + ')</small>') + '</div>' +
                    '<div class="meta">' + _esc(l.grade) + ' · ' + _esc(l.classroom || '—') + ' · ' + _esc(teacherName) + '</div>' +
                    (wasSub ? '<div class="sub-note">замена</div>' : (noSub ? '<div class="sub-note">нет замены</div>' : '')) +
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

// ---------- Календарь исключений (праздники и переносы) ----------
function renderCalendarLists() {
    _ensureData();

    const hl = document.getElementById('holidaysList');
    if (hl) {
        const hs = [...schoolData.holidays].sort();
        hl.innerHTML = hs.length
            ? hs.map(d => '<span class="tag">' + _esc(d) + ' <button type="button" onclick="removeHoliday(\'' + d + '\')" title="Удалить" aria-label="Удалить">×</button></span>').join('')
            : '<span class="muted">Праздников нет</span>';
    }

    const tl = document.getElementById('transfersList');
    if (tl) {
        const trs = schoolData.transfers || [];
        tl.innerHTML = trs.length
            ? trs.map((t, i) => '<span class="tag">' + _esc(t.date) + ' → ' + _esc(t.toDay) + ' <button type="button" onclick="removeTransfer(' + i + ')" title="Удалить" aria-label="Удалить">×</button></span>').join('')
            : '<span class="muted">Переносов нет</span>';
    }
}

function addHoliday() {
    _ensureData();
    const el = document.getElementById('holidayDate');
    const date = el ? el.value : '';
    if (!date) { alert('Укажите дату праздника'); return; }
    if (!schoolData.holidays.includes(date)) schoolData.holidays.push(date);
    saveSchoolData();
    renderCalendarLists();
    renderSchedulePage();
    logActivity('Праздник: ' + date);
}

function removeHoliday(date) {
    _ensureData();
    schoolData.holidays = schoolData.holidays.filter(d => d !== date);
    saveSchoolData();
    renderCalendarLists();
    renderSchedulePage();
}

function addTransfer() {
    _ensureData();
    const dateEl = document.getElementById('transferDate');
    const dayEl = document.getElementById('transferToDay');
    const date = dateEl ? dateEl.value : '';
    const toDay = dayEl ? dayEl.value : '';
    if (!date || !toDay) { alert('Укажите дату и день'); return; }
    if (!schoolData.transfers.some(t => t.date === date)) {
        schoolData.transfers.push({ date: date, toDay: toDay });
    }
    saveSchoolData();
    renderCalendarLists();
    renderSchedulePage();
    logActivity('Перенос: ' + date + ' → ' + toDay);
}

function removeTransfer(i) {
    _ensureData();
    schoolData.transfers = schoolData.transfers.filter((_, idx) => idx !== i);
    saveSchoolData();
    renderCalendarLists();
    renderSchedulePage();
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
        ? items.map(it => {
            const wi = _normWeek(it.weekIndex);
            const per = (wi === null) ? (it.hours + ' ч/нед') : (it.hours + ' ч / 2 нед');
            return '<tr>' +
                '<td>' + _esc(it.subject) + '</td>' +
                '<td>' + _esc(it.grade) + '</td>' +
                '<td>' + _esc(per) + '</td>' +
                '<td>' + _esc(weekLabelText(wi)) + '</td>' +
                '<td><button class="small danger" onclick="removePlanItem(\'' + it.id + '\')" title="Удалить из плана" aria-label="Удалить из плана">🗑</button></td>' +
                '</tr>';
        }).join('')
        : '<tr><td colspan="5" class="muted">План пуст</td></tr>';
}

function addPlanItem() {
    _ensureData();
    const subjectEl = document.getElementById('planSubject');
    const gradeEl = document.getElementById('planGrade');
    const hoursEl = document.getElementById('planHours');
    const weekEl = document.getElementById('planWeek');
    const subject = subjectEl ? subjectEl.value : '';
    const grade = gradeEl ? gradeEl.value : '';
    const hours = hoursEl ? (parseInt(hoursEl.value) || 1) : 1;
    const weekIndex = _normWeek(weekEl ? parseInt(weekEl.value, 10) : null);
    if (!subject || !grade) { alert('Выберите предмет и класс'); return; }
    if (schoolData.planItems.some(p => p.subject === subject && p.grade === grade && _normWeek(p.weekIndex) === weekIndex)) {
        alert('Такая позиция уже есть в плане');
        return;
    }
    schoolData.planItems.push({ id: _uid(), subject: subject, grade: grade, hours: hours, weekIndex: weekIndex });
    saveSchoolData();
    renderPlanItems();
    renderPlanAssignments();
    logActivity('В план добавлено: ' + subject + ' · ' + grade + ' · ' + hours + ' ч · ' + weekShortText(weekIndex));
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
        const wi = _normWeek(it.weekIndex);
        const checked = (schoolData.workloads || []).some(w =>
            w.teacher === teacher && w.subject === it.subject && w.grade === it.grade && _normWeek(w.weekIndex) === wi);
        const per = (wi === null) ? (it.hours + ' ч/нед') : (it.hours + ' ч / 2 нед (' + weekShortText(wi) + ')');
        return '<label class="plan-check ' + (checked ? 'checked' : '') + '">' +
            '<input type="checkbox" ' + (checked ? 'checked' : '') +
            ' onchange="togglePlanAssignment(\'' + it.id + '\', this.checked)">' +
            '<span class="pc-subject">' + _esc(it.subject) + '</span>' +
            '<span class="pc-meta">' + _esc(it.grade) + ' · ' + _esc(per) + '</span>' +
            '</label>';
    }).join('');
}

function togglePlanAssignment(itemId, checked) {
    _ensureData();
    const teacherEl = document.getElementById('planTeacher');
    const teacher = teacherEl ? teacherEl.value : '';
    const item = (schoolData.planItems || []).find(p => p.id === itemId);
    if (!teacher || !item) return;

    const wi = _normWeek(item.weekIndex);
    if (checked) {
        const exists = (schoolData.workloads || []).some(w =>
            w.teacher === teacher && w.subject === item.subject && w.grade === item.grade && _normWeek(w.weekIndex) === wi);
        if (!exists) {
            schoolData.workloads.push({ teacher: teacher, subject: item.subject, grade: item.grade, classroom: '', hours: item.hours, weekIndex: wi });
            logActivity('Назначено: ' + teacher + ' — ' + item.subject + ' (' + item.grade + ', ' + weekShortText(wi) + ')');
        }
    } else {
        schoolData.workloads = (schoolData.workloads || []).filter(w =>
            !(w.teacher === teacher && w.subject === item.subject && w.grade === item.grade && _normWeek(w.weekIndex) === wi));
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
