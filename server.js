const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "submissions.json");
const QUIZ_FILE = path.join(ROOT, "webmaster-test-full.html");
const RECORDINGS_DIR = path.join(ROOT, "recordings");

if (!ADMIN_PASSWORD) {
  console.error("Set ADMIN_PASSWORD before starting the server.");
  process.exit(1);
}

function readSubmissions() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function writeSubmissions(submissions) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(submissions, null, 2), "utf8");
}

function safeFilePart(value) {
  return String(value || "candidate").replace(/[^\w-]+/g, "_").slice(0, 60) || "candidate";
}

function send(response, status, body, contentType) {
  response.writeHead(status, {"Content-Type": contentType, "Cache-Control": "no-store"});
  response.end(body);
}

function isAdmin(request) {
  const header = request.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return decoded === `admin:${ADMIN_PASSWORD}`;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

const answerAt = (submission, group, index) => {
  const answers = group === "short"
    ? ((submission.job || {}).short || [])
    : (submission[group] || []);
  return answers[index]?.a;
};

const mcqAnswerAt = (submission, index) => {
  const answer = ((submission.job || {}).mcqDetail || [])[index];
  return answer ? answer.chosen : "";
};

const checkResultAt = (submission, index) => {
  const check = ((submission.coding || {}).autoChecks || [])[index];
  return check ? (check.pass ? "Passed" : "Not passed") : "";
};

const CSV_COLUMNS = [
  ["Test title", submission => submission.test],
  ["Submitted at", submission => submission.submittedAt],
  ["Duration (minutes)", submission => submission.durationMin],
  ["Full name", submission => (submission.intro || {}).name],
  ["Email", submission => (submission.intro || {}).email],
  ["IEEE membership number", submission => (submission.intro || {}).ieeeId],
  ["Field of study / current position", submission => (submission.intro || {}).study],
  ["Web experience level", submission => (submission.intro || {}).level],
  ["Tools used", submission => ((submission.intro || {}).tools || []).join(", ")],
  ["Hours per week", submission => (submission.intro || {}).hoursPerWeek],
  ["Introduction", submission => (submission.intro || {}).introduction],
  ["Why do you want to be the IEEE webmaster?", submission => (submission.intro || {}).why],
  ["Project or website", submission => (submission.intro || {}).portfolio],
  ["MCQ score", submission => (submission.job || {}).mcqScore],
  ["MCQ total", submission => (submission.job || {}).mcqTotal],
  ["Submitted code", submission => (submission.coding || {}).code],
  ["Coding explanation", submission => (submission.coding || {}).explanation],
  ["Tab switches", submission => (submission.proctoring || {}).tabSwitches],
  ["Pastes in code editor", submission => (submission.proctoring || {}).pastesInEditor],
  ["Received at", submission => submission.receivedAt]
];

CSV_COLUMNS.splice(15, 0,
  ...Array.from({length: 12}, (_, index) => [
    `Technical question ${index + 1}`,
    submission => mcqAnswerAt(submission, index)
  ]),
  ...Array.from({length: 3}, (_, index) => [
    `Short answer ${index + 1}`,
    submission => answerAt(submission, "short", index)
  ]),
  ...Array.from({length: 7}, (_, index) => [
    `Coding requirement ${index + 1}`,
    submission => checkResultAt(submission, index)
  ]),
  ...Array.from({length: 5}, (_, index) => [
    `Situation ${index + 1}`,
    submission => answerAt(submission, "situations", index)
  ])
);

function rowValues(submission) {
  return CSV_COLUMNS.map(([, getValue]) => getValue(submission));
}

function csvRow(submission) {
  return rowValues(submission).map(csvCell).join(",");
}

function htmlCell(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function handleSubmission(request, response) {
  let body = "";
  request.on("data", chunk => { body += chunk; });
  request.on("end", () => {
    try {
      const submission = JSON.parse(body);
      if (!submission.intro || !submission.job || !submission.coding) {
        send(response, 400, JSON.stringify({ok: false, error: "Invalid submission"}), "application/json");
        return;
      }
      let recording = null;
      if (submission.video && submission.video.base64) {
        fs.mkdirSync(RECORDINGS_DIR, {recursive: true});
        const filename = `${Date.now()}_${safeFilePart(submission.intro.name)}.webm`;
        fs.writeFileSync(path.join(RECORDINGS_DIR, filename), Buffer.from(submission.video.base64, "base64"));
        recording = filename;
      }
      delete submission.video;
      const submissions = readSubmissions();
      submissions.push({...submission, recording, receivedAt: new Date().toISOString()});
      writeSubmissions(submissions);
      send(response, 201, JSON.stringify({ok: true}), "application/json");
    } catch (error) {
      send(response, 400, JSON.stringify({ok: false, error: error.message}), "application/json");
    }
  });
}

function handleAdmin(request, response) {
  if (!isAdmin(request)) {
    response.writeHead(401, {"WWW-Authenticate": 'Basic realm="Webmaster results"'});
    response.end("Admin login required");
    return;
  }
  const submissions = readSubmissions();
  const headers = CSV_COLUMNS.map(([header]) => header);
  const rows = submissions.map(csvRow);
  const csv = [headers.map(csvCell).join(","), ...rows].join("\r\n");
  send(response, 200, `<!doctype html><meta charset="utf-8"><title>Webmaster results</title>
<style>body{font:16px system-ui;margin:2rem;color:#17202a}a{display:inline-block;margin-bottom:1rem;padding:.6rem 1rem;background:#00629b;color:#fff;text-decoration:none;border-radius:6px}table{border-collapse:collapse;font-size:14px}th,td{border:1px solid #ccd3db;padding:8px;text-align:left;vertical-align:top}th{background:#eef3f7}</style>
<h1>Webmaster results (${submissions.length})</h1>
<a download="webmaster-results.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(csv)}">Download CSV</a>
<table><thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>
${submissions.map(submission => `<tr>${rowValues(submission).map(value => `<td>${htmlCell(value)}</td>`).join("")}</tr>`).join("")}
</tbody></table>`, "text/html; charset=utf-8");
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === "POST" && url.pathname === "/api/submissions") return handleSubmission(request, response);
  if (request.method === "GET" && url.pathname === "/admin") return handleAdmin(request, response);
  if (request.method === "GET" && url.pathname.startsWith("/recordings/")) {
    if (!isAdmin(request)) {
      response.writeHead(401, {"WWW-Authenticate": 'Basic realm="Webmaster results"'});
      response.end("Admin login required");
      return;
    }
    const filename = path.basename(decodeURIComponent(url.pathname.slice("/recordings/".length)));
    const recordingPath = path.join(RECORDINGS_DIR, filename);
    if (!fs.existsSync(recordingPath)) return send(response, 404, "Recording not found", "text/plain");
    send(response, 200, fs.readFileSync(recordingPath), "video/webm");
    return;
  }
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/webmaster-test-full.html")) {
    send(response, 200, fs.readFileSync(QUIZ_FILE), "text/html; charset=utf-8");
    return;
  }
  send(response, 404, "Not found", "text/plain");
});

server.listen(PORT, () => {
  console.log(`Quiz:  http://localhost:${PORT}/`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
