document.addEventListener('DOMContentLoaded', () => {
    const savedData = localStorage.getItem('schoolData');
    if (savedData) {
        try {
            schoolData = JSON.parse(savedData);
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
    if (getToken()) {
        showMainApp();
        loadSavedTimetables();
    }
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.autocomplete-wrapper')) {
            document.querySelectorAll('.autocomplete-list').forEach(list => {
                list.style.display = 'none';
            });
        }
    });
});

function completeStep(step) {
    if (step === 1) {
        schoolData.name = document.getElementById('schoolName').value;
        schoolData.days = parseInt(document.getElementById('daysPerWeek').value);
        schoolData.lessonsPerDay = parseInt(document.getElementById('lessonsPerDay').value);
        schoolData.lessonTimes = document.getElementById('lessonTimes').value.split(',').map(t => t.trim());
    }
    saveSchoolData();
    goToStep(step + 1);
}

function restoreStep1Fields() {
    if (!schoolData) return;
    const nameField = document.getElementById('schoolName');
    const daysField = document.getElementById('daysPerWeek');
    const lessonsField = document.getElementById('lessonsPerDay');
    const timesField = document.getElementById('lessonTimes');

    if (nameField && schoolData.name) nameField.value = schoolData.name;
    if (daysField && schoolData.days) daysField.value = schoolData.days;
    if (lessonsField && schoolData.lessonsPerDay) lessonsField.value = schoolData.lessonsPerDay;
    if (timesField && schoolData.lessonTimes && schoolData.lessonTimes.length > 0) {
        timesField.value = schoolData.lessonTimes.join(', ');
    }
}

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