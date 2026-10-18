// static/js/main.js

document.addEventListener('DOMContentLoaded', () => {
    // Загрузка сохраненных данных при старте
    const savedData = localStorage.getItem('schoolData');
    if (savedData) {
        try {
            schoolData = JSON.parse(savedData);
            renderClasses();
            renderTeachers();
            renderSubjects();
            renderClassrooms();
            updateTeacherDatalist();
        } catch (e) {
            console.error("Ошибка парсинга schoolData:", e);
        }
    }

    // Если пользователь авторизован, показываем приложение
    if (getToken()) {
        showMainApp();
        loadSavedTimetables();
    }

    // Глобальный обработчик кликов для закрытия автодополнения
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.autocomplete-wrapper')) {
            document.querySelectorAll('.autocomplete-list').forEach(list => { list.style.display = 'none'; });
        }
    });
});

// ✅ ИСПРАВЛЕННАЯ ФУНКЦИЯ НАВИГАЦИИ С АВТОЗАГРУЗКОЙ ДЛЯ РЕДАКТОРА
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

    // Логика инициализации для каждого шага
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
        if(selectedTeacher) renderAvailabilityGrid(selectedTeacher);
    }
    if (step === 4) {
        loadSavedTimetables();
    }

    // ✅ ИСПРАВЛЕНИЕ ДЛЯ ШАГА 5 (РЕДАКТОР)
    if (step === 5) {
        console.log(" Проверка данных для редактора...");

        // Если данных нет, пытаемся загрузить последнее сохраненное расписание
        if (!currentResult || !currentResult.teachers) {
            console.warn("⚠️ currentResult пуст. Пытаемся загрузить последнее расписание...");

            try {
                // Загружаем список расписаний
                const res = await fetch('/timetables', {
                    headers: {'Authorization': 'Bearer ' + getToken()}
                });

                if (res.ok) {
                    const timetables = await res.json();
                    if (timetables && timetables.length > 0) {
                        // Берем самое свежее (первое в списке)
                        const latestId = timetables[0].id;
                        console.log(`📥 Загружаю расписание ID: ${latestId}`);

                        // Загружаем полные данные
                        const fullRes = await fetch(`/timetables/${latestId}`, {
                            headers: {'Authorization': 'Bearer ' + getToken()}
                        });

                        if (fullRes.ok) {
                            const data = await fullRes.json();
                            if (data.data) {
                                currentResult = data.data;
                                currentTimetableId = latestId;
                                console.log("✅ Данные успешно загружены!");
                            }
                        }
                    } else {
                        console.error("❌ Нет сохраненных расписаний");
                        alert('Сначала сгенерируйте расписание на Шаге 4!');
                        goToStep(4); // Возвращаем пользователя назад
                        return;
                    }
                }
            } catch (e) {
                console.error("❌ Ошибка загрузки данных:", e);
                alert('Не удалось загрузить расписание. Попробуйте обновить страницу.');
                return;
            }
        }

        // Теперь, когда данные точно есть (или мы вышли выше), рендерим таблицу
        if (currentResult && currentResult.teachers) {
            console.log(" Рендеринг таблицы редактора...");
            updateEditorClassFilter();
            renderGlobalEditor();
        } else {
            console.error("❌ Данные все еще отсутствуют после попытки загрузки");
            document.getElementById('globalEditorContainer').innerHTML =
                '<p style="padding:20px;text-align:center;color:#c33">Ошибка: Не удалось загрузить данные расписания.</p>';
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

// Экспорт функций в глобальную область для onclick в HTML
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
window.sendToTeachers = function() { alert(' Отправлено в Telegram'); };
window.sendToEmail = function() { alert(' Отправлено на почту'); };

// Функции редактора
window.renderGlobalEditor = renderGlobalEditor;
window.handleGlobalDragStart = handleGlobalDragStart;
window.handleGlobalDragOver = handleGlobalDragOver;
window.handleGlobalDragLeave = handleGlobalDragLeave;
window.handleGlobalDrop = handleGlobalDrop;
window.validateTimetable = validateTimetable;