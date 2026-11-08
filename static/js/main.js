document.addEventListener('DOMContentLoaded', async () => {
    const savedData = localStorage.getItem('schoolData');
    if (savedData) {
        try {
            schoolData = JSON.parse(savedData);
            // Мигрируем старый формат teacherAssignments в массив
            if (typeof _migrateTeacherAssignments === 'function') _migrateTeacherAssignments();
            if (!schoolData.teacherAssignments) schoolData.teacherAssignments = [];
        } catch (e) {
            console.error("Ошибка парсинга schoolData:", e);
        }
    }
    
    // Загружаем справочники с сервера (общие для всей школы)
    if (getToken()) {
        console.log('[init] Loading school data from server...');
        const loaded = await loadSchoolDataFromServer();
        console.log('[init] School data loaded:', loaded);
    }
    
    // Рендерим справочники (после загрузки с сервера или из localStorage)
    restoreStep1Fields();
    renderClasses();
    renderTeachers();
    renderSubjects();
    renderClassrooms();
    updateTeacherDatalist();
    renderLessonTimeRows();
    
    if (getToken()) {
        showMainApp();
        loadSavedTimetables();
        if (typeof loadSubstitutions === 'function') loadSubstitutions();
    }
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.autocomplete-wrapper')) {
            document.querySelectorAll('.autocomplete-list').forEach(list => {
                list.style.display = 'none';
            });
        }
    });
});

window.renderLessonTimeRows = renderLessonTimeRows;
window.saveTeacherAssignment = saveTeacherAssignment;
window.deleteAssignment = deleteAssignment;
window.onTeacherAssignmentSelect = onTeacherAssignmentSelect;
window.loadAssignmentCard = loadAssignmentCard;
window.addAssignmentClass = addAssignmentClass;
window.removeAssignmentClass = removeAssignmentClass;
window.updateAssignmentGrade = updateAssignmentGrade;
window.toggleAssignmentSubject = toggleAssignmentSubject;
window.showLogin = showLogin;
window.completeStep = completeStep;
window.goToStep = goToStep;
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
window.downloadPDF = downloadPDF;
window.downloadExcel = downloadExcel;
window.publishTimetable = function () {
    if (confirm('Опубликовать?')) alert('✅ Опубликовано');
};
window.exportToJournal = function () { alert('Экспорт API'); };
window.sendToTeachers = function () { alert('📱 Отправлено в Telegram'); };
window.sendToEmail = function () { alert('📧 Отправлено на почту'); };
window.renderGlobalEditor = renderGlobalEditor;
window.handleGlobalDragStart = handleGlobalDragStart;
window.handleGlobalDragOver = handleGlobalDragOver;
window.handleGlobalDragLeave = handleGlobalDragLeave;
window.handleGlobalDrop = handleGlobalDrop;
window.validateTimetable = validateTimetable;