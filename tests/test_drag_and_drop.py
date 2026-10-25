"""Фронтенд-тест drag-and-drop: реальный HTML5 DnD в headless Chrome.

Требует Playwright и установленный Chrome. Если их нет — тест пропускается.
"""
import json
import pathlib
import socketserver
import threading
from http.server import BaseHTTPRequestHandler

import pytest

pytestmark = pytest.mark.integration

STATIC_JS = pathlib.Path(__file__).resolve().parents[1] / "static" / "js"

PAGE = """<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<select id="editorClassFilter"><option value=""></option></select>
<div id="globalEditorContainer"></div>
<script src="/state.js"></script>
<script src="/editor.js"></script>
<script>
schoolData.lessonTimes = ["08:30-09:15", "09:25-10:10"];
currentResult = {
  days: ["Понедельник", "Вторник"], slots: [1, 2],
  lessonTimes: ["08:30-09:15", "09:25-10:10"],
  teachers: [{ teacher: "Иванова", total_lessons: 1,
    schedule: { "Понедельник": { "1": [
      { subject: "Математика", grade: "5A", teacher: "Иванова", classroom: "101", topic: "" }
    ] } } }]
};
currentTimetableId = 42;
renderGlobalEditor();
</script>
</body></html>"""

DATA_AFTER = {
    "days": ["Понедельник", "Вторник"], "slots": [1, 2],
    "lessonTimes": ["08:30-09:15", "09:25-10:10"],
    "teachers": [{"teacher": "Иванова", "total_lessons": 1,
                  "schedule": {"Вторник": {"2": [
                      {"subject": "Математика", "grade": "5A", "teacher": "Иванова", "classroom": "101", "topic": ""}
                  ]}}}],
}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body, ctype = PAGE.encode("utf-8"), "text/html; charset=utf-8"
        elif self.path == "/state.js":
            body, ctype = (STATIC_JS / "state.js").read_bytes(), "application/javascript"
        elif self.path == "/editor.js":
            body, ctype = (STATIC_JS / "editor.js").read_bytes(), "application/javascript"
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture()
def http_server():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_address[1]
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_drag_and_drop_sends_move_request(http_server):
    sync_api = pytest.importorskip("playwright.sync_api")

    try:
        pw = sync_api.sync_playwright().start()
    except Exception as e:  # pragma: no cover
        pytest.skip(f"Playwright недоступен: {e}")

    try:
        try:
            browser = pw.chromium.launch(channel="chrome", headless=True)
        except Exception as e:  # pragma: no cover
            pytest.skip(f"Chrome для Playwright недоступен: {e}")

        page = browser.new_page()
        page.add_init_script("localStorage.setItem('access_token', 'test');")
        page.on("dialog", lambda d: d.accept())

        recorded = []

        def route_handler(route):
            request = route.request
            if "move-lesson" in request.url:
                recorded.append(request.post_data_json)
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps({"message": "ok", "data": DATA_AFTER}))
            elif "/timetables/42" in request.url:
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps({"id": 42, "name": "t", "data": DATA_AFTER}))
            else:
                route.continue_()

        page.route("**/timetables/**", route_handler)
        page.goto(f"http://127.0.0.1:{http_server}/")
        page.wait_for_selector(".lesson-chip")

        target = "td.drop-zone[data-day='Вторник'][data-slot='2']"
        assert page.locator(target).count() == 1, "не найдена целевая ячейка"
        page.drag_and_drop(".lesson-chip", target)
        page.wait_for_timeout(500)

        assert recorded, "перетаскивание не вызвало запрос move-lesson"
        payload = recorded[0]
        assert payload["from_day"] == "Понедельник" and payload["from_slot"] == 1
        assert payload["to_day"] == "Вторник" and payload["to_slot"] == 2

        browser.close()
    finally:
        pw.stop()
