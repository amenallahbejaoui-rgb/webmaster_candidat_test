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
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsvColumns(submissions) {
  const intro = submission => (submission.intro || {});
  const job = submission => (submission.job || {});
  const coding = submission => (submission.coding || {});
  const proctoring = submission => (submission.proctoring || {});

  const columns = [
    ["Test title", submission => submission.test],
    ["Submitted at", submission => submission.submittedAt],
    ["Received at", submission => submission.receivedAt],
    ["Duration (minutes)", submission => submission.durationMin],
    ["Automatically submitted", submission => submission.autoSubmitted ? "Yes" : "No"],
    ["Rules acknowledged", submission => submission.rulesAcknowledged ? "Yes" : "No"],
    ["Full name", submission => intro(submission).name],
    ["Email", submission => intro(submission).email],
    ["IEEE membership number", submission => intro(submission).ieeeId],
    ["Field of study / current position", submission => intro(submission).study],
    ["Web experience level", submission => intro(submission).level],
    ["Tools used", submission => (intro(submission).tools || []).join(", ")],
    ["Hours per week", submission => intro(submission).hoursPerWeek],
    ["Self-introduction", submission => intro(submission).introduction],
    ["Why do you want to be the IEEE webmaster?", submission => intro(submission).why],
    ["Project or website", submission => intro(submission).portfolio],
    ["MCQ score", submission => job(submission).mcqScore],
    ["MCQ total", submission => job(submission).mcqTotal],
  ];

  const mcqCount = submissions.reduce((count, submission) =>
    Math.max(count, ((submission.job || {}).mcqDetail || []).length), 0);
  for (let index = 0; index < mcqCount; index++) {
    const label = submissions.map(submission =>
      ((submission.job || {}).mcqDetail || [])[index]?.q
    ).find(Boolean) || `Technical question ${index + 1}`;
    columns.push(
      [`${label} — Selected answer`, submission =>
        ((submission.job || {}).mcqDetail || [])[index]?.chosen || ""],
      [`${label} — Correct`, submission =>
        ((submission.job || {}).mcqDetail || [])[index]?.correct === true ? "Yes"
          : ((submission.job || {}).mcqDetail || [])[index]?.correct === false ? "No" : ""]
    );
  }

  const shortCount = submissions.reduce((count, submission) =>
    Math.max(count, ((submission.job || {}).short || []).length), 0);
  for (let index = 0; index < shortCount; index++) {
    const label = submissions.map(submission =>
      ((submission.job || {}).short || [])[index]?.q
    ).find(Boolean) || `Short answer ${index + 1}`;
    columns.push([label, submission =>
      ((submission.job || {}).short || [])[index]?.a || ""]);
  }

  columns.push(
    ["Submitted code", submission => coding(submission).code],
    ["Coding approach / improvements", submission => coding(submission).explanation]
  );

  const checkCount = submissions.reduce((count, submission) =>
    Math.max(count, ((submission.coding || {}).autoChecks || []).length), 0);
  for (let index = 0; index < checkCount; index++) {
    const label = submissions.map(submission =>
      ((submission.coding || {}).autoChecks || [])[index]?.name
    ).find(Boolean) || `Coding requirement ${index + 1}`;
    columns.push([label, submission => {
      const result = ((submission.coding || {}).autoChecks || [])[index]?.pass;
      return result === true ? "Passed" : result === false ? "Not passed" : "";
    }]);
  }

  const situationCount = submissions.reduce((count, submission) =>
    Math.max(count, (submission.situations || []).length), 0);
  for (let index = 0; index < situationCount; index++) {
    const label = submissions.map(submission =>
      (submission.situations || [])[index]?.q
    ).find(Boolean) || `Situation ${index + 1}`;
    columns.push([label, submission =>
      (submission.situations || [])[index]?.a || ""]);
  }

  columns.push(
    ["Tab switches", submission => proctoring(submission).tabSwitches],
    ["Pastes in code editor", submission => proctoring(submission).pastesInEditor],
    ["Camera enabled (legacy submissions)", submission => proctoring(submission).cameraEnabled]
  );
  return columns;
}

function rowValues(submission, columns) {
  return columns.map(([, getValue]) => getValue(submission));
}

function csvRow(submission, columns) {
  return rowValues(submission, columns).map(csvCell).join(",");
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
  const csvColumns = buildCsvColumns(submissions);
  const headers = csvColumns.map(([header]) => header);
  const rows = submissions.map(submission => csvRow(submission, csvColumns));
  const csv = [headers.map(csvCell).join(","), ...rows].join("\r\n");
  send(response, 200, `<!doctype html><meta charset="utf-8"><title>Webmaster results</title>
<style>body{font:16px system-ui;margin:2rem;color:#17202a}a{display:inline-block;margin-bottom:1rem;padding:.6rem 1rem;background:#00629b;color:#fff;text-decoration:none;border-radius:6px}table{border-collapse:collapse;font-size:14px}th,td{border:1px solid #ccd3db;padding:8px;text-align:left;vertical-align:top}th{background:#eef3f7}</style>
<h1>Webmaster results (${submissions.length})</h1>
<a download="webmaster-results.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(csv)}">Download CSV</a>
<table><thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>
${submissions.map(submission => `<tr>${rowValues(submission, csvColumns).map(value => `<td>${htmlCell(value)}</td>`).join("")}</tr>`).join("")}
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
