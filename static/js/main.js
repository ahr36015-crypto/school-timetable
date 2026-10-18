// static/js/main.js

function goToStep(step) {
    document.querySelectorAll('.wizard-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.wizard-step').forEach((s,i) => {
        s.classList.remove('active');
        if (i+1 < step) s.classList.add('completed');
        else s.classList.remove('completed');
    });

    document.getElementById('step'+step).classList.add('active');
    document.querySelectorAll('.wizard-step')[step-1].classList.add('active');
    currentStep = step;

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
        // Рендерим сетку доступности для выбранного учителя, если он есть
        const selectedTeacher = document.getElementById('teacherSelect').value;
        if(selectedTeacher) renderAvailabilityGrid(selectedTeacher);
    }
    if (step === 4) {
        loadSavedTimetables();
    }

    // ✅ ИСПРАВЛЕНИЕ ДЛЯ ШАГА 5 (РЕДАКТОР)
    if (step === 5) {
        console.log(" Переход на шаг 5. currentResult:", currentResult ? "Есть" : "Нет");

        // Сначала обновляем фильтр классов
        updateEditorClassFilter();

        // Затем рендерим таблицу
        renderGlobalEditor();

        // Если таблица все еще пуста, возможно данные не загрузились
        const container = document.getElementById('globalEditorContainer');
        if (container && !container.innerHTML.includes('global-table')) {
             console.warn("⚠️ Таблица не отрисовалась, пробуем повторно через 500мс...");
             setTimeout(() => {
                 updateEditorClassFilter();
                 renderGlobalEditor();
             }, 500);
        }
    }
}