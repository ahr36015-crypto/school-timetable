// static/js/main.js

document.addEventListener('DOMContentLoaded', () => {
    // Загрузка сохраненных данных при старте
    const savedData = localStorage.getItem('schoolData');
    if (savedData) {
        schoolData = JSON.parse(savedData);
        // Рендерим справочники, чтобы они были видны сразу
        renderClasses();
        renderTeachers();
        renderSubjects();
        renderClassrooms();
        updateTeacherDatalist();
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