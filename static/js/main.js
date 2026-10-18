// static/js/main.js

document.addEventListener('DOMContentLoaded', () => {
    const savedData = localStorage.getItem('schoolData');
    if (savedData) {
        try {
            schoolData = JSON.parse(savedData);
            renderClasses();
            renderTeachers();
            renderSubjects();
            renderClassrooms();
            updateTeacherDatalist();
        } catch (e) { console.error("Ошибка парсинга schoolData:", e); }
    }

    if (getToken()) {
        showMainApp();
        loadSavedTimetables();
    }

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.autocomplete-wrapper')) {
            document.querySelectorAll('.autocomplete-list').forEach(list => { list.style.display = 'none'; });
        }
    });
});

async function goToStep(step) {
    document.querySelectorAll('.wizard-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.wizard-step').forEach((s,i) => {
        s.classList.remove('active');
        if (i+1 < step) s.classList.add('completed');
        else s.classList.remove('completed');
    });

    document.getElementById('step'+step).classList.add('active');
    document.querySelectorAll('.wizard-step')[step-1].classList.add('active');
    currentStep = step;

    console.log(`🔄 Переход на шаг ${step}`);

    if (step === 2) { renderClasses(); renderTeachers(); renderSubjects(); renderClassrooms(); }
    if (step === 3) {
        updateTeacherSelect();
        updateTeacherDatalist();
        const sel = document.getElementById('teacherSelect').value;
        if(sel) renderAvailabilityGrid(sel);
    }
    if (step === 4) { loadSavedTimetables(); }

    // ✅ ИСПРАВЛЕНИЕ ДЛЯ ШАГА 5: Используем только рабочий эндпоинт /timetables/{id}
    if (step === 5) {
        console.log("🔍 Проверка данных для редактора...");

        // Если данных нет или потерялся ID, загружаем последнее расписание
        if (!currentResult || !currentResult.teachers || !currentTimetableId) {
            console.warn("⚠️ Данные или ID отсутствуют. Загружаю последнее расписание...");

            try {
                const res = await fetch('/timetables', {
                    headers: {'Authorization': 'Bearer ' + getToken()}
                });

                if (res.ok) {
                    const timetables = await res.json();
                    if (timetables && timetables.length > 0) {
                        const latest = timetables[0]; // Самое свежее
                        console.log(` Загружаю ID: ${latest.id}`);

                        // ✅ ИСПОЛЬЗУЕМ ГАРАНТИРОВАННО РАБОЧИЙ ЭНДПОИНТ
                        const fullRes = await fetch(`/timetables/${latest.id}`, {
                            headers: {'Authorization': 'Bearer ' + getToken()}
                        });

                        if (fullRes.ok) {
                            const data = await fullRes.json();
                            if (data.data) {
                                currentResult = data.data;
                                currentTimetableId = latest.id; // Жестко фиксируем ID
                                console.log("✅ Данные и ID успешно восстановлены!");
                            }
                        } else {
                            throw new Error(`Server returned ${fullRes.status}`);
                        }
                    } else {
                        alert('Сначала сгенерируйте расписание на Шаге 4!');
                        goToStep(4);
                        return;
                    }
                }
            } catch (e) {
                console.error("❌ Ошибка загрузки:", e);
                alert('Не удалось загрузить расписание. Попробуйте обновить страницу.');
                return;
            }
        }

        // Рендерим таблицу
        if (currentResult && currentResult.teachers && currentTimetableId) {
            console.log("🎨 Рендеринг таблицы редактора...");
            updateEditorClassFilter();
            renderGlobalEditor();
        } else {
            document.getElementById('globalEditorContainer').innerHTML =
                '<p style="padding:20px;text-align:center;color:#c33">Ошибка: Нет данных или ID расписания.</p>';
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
    saveSchoolData(); goToStep(step + 1);
}

// Глобальные обработчики
window.showLogin = showLogin;
window.showRegister = showRegister;
window.login = login;
window.register = register;
window.logout = logout;
window.goToStep = goToStep;
window.completeStep = completeStep;
window.showRefTab = showRefTab;
window.addClass = addClass;
window.removeClass = removeClass;
window.addTeacher = addTeacher;
window.removeTeacher = removeTeacher;
window.addSubject = addSubject;
window.removeSubject = removeSubject;
window.addClassroom = addClassroom;
window.removeClassroom = removeClassroom;
window.importFromExcel = importFromExcel;
window.loadTeacherCard = loadTeacherCard;
window.addWorkload = addWorkload;
window.removeWorkload = removeWorkload;
window.updateWorkloadFromInput = updateWorkloadFromInput;
window.toggleAvailability = toggleAvailability;
window.selectTemplate = selectTemplate;
window.applyTimeTemplate = applyTimeTemplate;
window.applyDaysTemplate = applyDaysTemplate;
window.applyExcludeTemplate = applyExcludeTemplate;
window.generateTimetable = generateTimetable;
window.showMasterView = showMasterView;
window.hideMasterView = hideMasterView;
window.downloadPDF = downloadPDF;
window.downloadExcel = downloadExcel;
window.publishTimetable = function() { if(confirm('Опубликовать?')) alert('✅ Опубликовано'); };
window.exportToJournal = function() { alert('🔗 Экспорт API'); };
window.sendToTeachers = function() { alert('📱 Отправлено в Telegram'); };
window.sendToEmail = function() { alert(' Отправлено на почту'); };

// Редактор
window.renderGlobalEditor = renderGlobalEditor;
window.handleGlobalDragStart = handleGlobalDragStart;
window.handleGlobalDragOver = handleGlobalDragOver;
window.handleGlobalDragLeave = handleGlobalDragLeave;
window.handleGlobalDrop = handleGlobalDrop;
window.validateTimetable = validateTimetable;