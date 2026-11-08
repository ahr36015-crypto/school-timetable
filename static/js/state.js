// static/js/state.js

// Глогальное состояние приложения
let schoolData = {
    name: '', days: 5, lessonsPerDay: 7, lessonTimes: [],
    classes: [], teachers: [], subjects: [], classrooms: [],
    workloads: [], availability: {},
    teacherAssignments: [],
    planItems: [], substitutions: [], activityLog: [],
    holidays: [], transfers: [],
    weekConfig: { anchorDate: '', anchorIsBlue: true },
    combined_lessons: [], // правила совмещённых занятий
    quartersCount: 4 // количество четвертей (4 или 5)
};
let currentResult = null;
let currentTimetableId = null;
let currentStep = 1;
let draggedLessonData = null;
let masterViewData = null;

// Утилиты авторизации
function getToken() { return localStorage.getItem('access_token'); }

function checkAuth() {
    const token = getToken();
    if (!token) { alert('Сессия истекла. Пожалуйста, войдите снова.'); logout(); return false; }
    return true;
}

function saveSchoolData() {
    localStorage.setItem('schoolData', JSON.stringify(schoolData));
    // Синхронизация с сервером (async, не блокирует)
    saveSchoolDataToServer();
}

// Дебаунс для сохранения на сервер (избегаем слишком частых запросов)
let _saveSchoolDataTimeout = null;
function saveSchoolDataToServer() {
    if (!getToken()) return;
    clearTimeout(_saveSchoolDataTimeout);
    _saveSchoolDataTimeout = setTimeout(async () => {
        try {
            // Сохраняем справочники И настройки (workloads, planItems, availability, etc.)
            const dataToSave = {
                subjects: schoolData.subjects || [],
                classes: schoolData.classes || [],
                teachers: (schoolData.teachers || []).map(t => ({
                    full_name: t.full_name,
                    email: t.email || '',
                    subjects: t.subjects || []
                })),
                classrooms: schoolData.classrooms || [],
                // НОВОЕ: сохраняем нагрузки, планы, доступность и другие настройки
                workloads: schoolData.workloads || [],
                planItems: schoolData.planItems || [],
                availability: schoolData.availability || {},
                teacherAssignments: schoolData.teacherAssignments || [],
                holidays: schoolData.holidays || [],
                transfers: schoolData.transfers || [],
                weekConfig: schoolData.weekConfig || { anchorDate: '', anchorIsBlue: true },
                quartersCount: schoolData.quartersCount || 4
            };
            console.log('[schoolData] Saving to server:', dataToSave);
            console.log('Filtered by school_id: (server resolves from user token)');
            const res = await fetch('/api/school-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken()
                },
                body: JSON.stringify({ data: dataToSave })
            });
            if (!res.ok) {
                console.error('[schoolData] Failed to save:', res.status);
            } else {
                console.log('[schoolData] Saved successfully');
            }
        } catch (e) {
            console.error('[schoolData] Save error:', e);
        }
    }, 1000); // Дебаунс 1 секунда
}

// Загрузка справочников и настроек с сервера
async function loadSchoolDataFromServer() {
    if (!getToken()) return false;
    try {
        console.log('[schoolData] Loading from server...');
        console.log('Filtered by school_id: (server resolves from user token)');
        const res = await fetch('/api/school-data', {
            headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        if (!res.ok) {
            console.error('[schoolData] Failed to load:', res.status);
            return false;
        }
        const data = await res.json();
        console.log('[schoolData] Loaded from server:', data);
        
        // Обновляем справочники
        if (data.subjects && Array.isArray(data.subjects)) {
            schoolData.subjects = data.subjects;
        }
        if (data.classes && Array.isArray(data.classes)) {
            schoolData.classes = data.classes;
        }
        if (data.teachers && Array.isArray(data.teachers)) {
            schoolData.teachers = data.teachers;
        }
        if (data.classrooms && Array.isArray(data.classrooms)) {
            schoolData.classrooms = data.classrooms;
        }
        
        // НОВОЕ: Восстанавливаем нагрузки, планы, доступность и другие настройки
        if (data.workloads && Array.isArray(data.workloads)) {
            schoolData.workloads = data.workloads;
        }
        if (data.planItems && Array.isArray(data.planItems)) {
            schoolData.planItems = data.planItems;
        }
        if (data.availability && typeof data.availability === 'object') {
            schoolData.availability = data.availability;
        }
        if (data.teacherAssignments && Array.isArray(data.teacherAssignments)) {
            schoolData.teacherAssignments = data.teacherAssignments;
        }
        if (data.holidays && Array.isArray(data.holidays)) {
            schoolData.holidays = data.holidays;
        }
        if (data.transfers && Array.isArray(data.transfers)) {
            schoolData.transfers = data.transfers;
        }
        if (data.weekConfig && typeof data.weekConfig === 'object') {
            schoolData.weekConfig = data.weekConfig;
        }
        if (data.quartersCount) {
            schoolData.quartersCount = data.quartersCount;
        }
        
        // Сохраняем в localStorage для кеширования
        localStorage.setItem('schoolData', JSON.stringify(schoolData));
        console.log('[schoolData] Synced to localStorage');
        return true;
    } catch (e) {
        console.error('[schoolData] Load error:', e);
        return false;
    }
}

// Время уроков: приоритет у сохранённого расписания, затем — локальные настройки
function getLessonTimes() {
    if (currentResult && Array.isArray(currentResult.lessonTimes) && currentResult.lessonTimes.length) {
        return currentResult.lessonTimes;
    }
    return schoolData.lessonTimes || [];
}

function logout() { localStorage.clear(); location.reload(); }

// Управление вкладками входа/регистрации
function showLogin() {
    document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', i===0));
    document.querySelectorAll('.form-section').forEach((f,i) => f.classList.toggle('active', i===0));
}

function showRegister() {
    document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', i===1));
    document.querySelectorAll('.form-section').forEach((f,i) => f.classList.toggle('active', i===1));
}

function showMainApp() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('mainApp').classList.add('active');
    const name = localStorage.getItem('full_name') || 'Гость';
    const schoolName = localStorage.getItem('school_name') || 'Школа не выбрана';
    const nameEl = document.getElementById('sidebarUserName');
    const avEl = document.getElementById('sidebarAvatar');
    const roleEl = document.getElementById('sidebarUserRole');
    if (nameEl) nameEl.textContent = name;
    if (avEl) avEl.textContent = (name.trim().charAt(0) || 'Г').toUpperCase();
    if (roleEl) roleEl.textContent = schoolName;
    console.log('Current user school:', schoolName);
    if (typeof openPage === 'function') openPage('dashboard');
}

// Async запросы к API
async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const err = document.getElementById('loginError');
    try {
        const res = await fetch('/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password}) });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('user_id', data.user_id);
            localStorage.setItem('full_name', data.full_name);
            if (data.school_name) localStorage.setItem('school_name', data.school_name);
            // Загружаем справочники с сервера после входа
            await loadSchoolDataFromServer();
            showMainApp(); loadSavedTimetables();
        } else { err.textContent = data.detail; err.classList.add('show'); }
    } catch(e) { err.textContent = 'Ошибка соединения: ' + e.message; err.classList.add('show'); }
}

async function register() {
    const full_name = document.getElementById('regFullName').value;
    const email = document.getElementById('regEmail').value;
    const school_name = document.getElementById('regSchool').value;
    const password = document.getElementById('regPassword').value;
    const err = document.getElementById('regError');
    try {
        const res = await fetch('/register', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({full_name, email, password, school_name}) });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('user_id', data.user_id);
            localStorage.setItem('full_name', data.full_name);
            if (data.school_name) localStorage.setItem('school_name', data.school_name);
            else {
                const schoolNameInput = document.getElementById('regSchool');
                if (schoolNameInput && schoolNameInput.value) localStorage.setItem('school_name', schoolNameInput.value);
            }
            // Загружаем справочники с сервера после регистрации
            await loadSchoolDataFromServer();
            showMainApp(); loadSavedTimetables();
        } else { err.textContent = data.detail; err.classList.add('show'); }
    } catch(e) { err.textContent = 'Ошибка соединения: ' + e.message; err.classList.add('show'); }
}