document.addEventListener('DOMContentLoaded', () => {
    const savedData = localStorage.getItem('schoolData');
    if (savedData) {
        try {
            schoolData = JSON.parse(savedData);
            if (!schoolData.teacherAssignments) schoolData.teacherAssignments = {};
            restoreStep1Fields();
            renderClasses();
            renderTeachers();
            renderSubjects();
            renderClassrooms();
            updateTeacherDatalist();
        } catch (e) {
            console.error("Ошибка парсинга schoolData:", e);
        }
    }
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