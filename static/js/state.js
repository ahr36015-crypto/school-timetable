// static/js/state.js

// Глобальное состояние приложения
let schoolData = {
    name: '', days: 5, lessonsPerDay: 7, lessonTimes: [],
    classes: [], teachers: [], subjects: [], classrooms: [],
    workloads: [], availability: {},
    teacherAssignments: {}
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

function saveSchoolData() { localStorage.setItem('schoolData', JSON.stringify(schoolData)); }

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
    document.getElementById('userInfo').textContent = 'Пользователь: ' + (localStorage.getItem('full_name') || 'Гость');
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
            showMainApp(); loadSavedTimetables();
        } else { err.textContent = data.detail; err.classList.add('show'); }
    } catch(e) { err.textContent = 'Ошибка соединения: ' + e.message; err.classList.add('show'); }
}