const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "submissions.json");
const QUIZ_FILE = path.join(ROOT, "webmaster-test-full.html");

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

function csvRow(submission) {
  const intro = submission.intro || {};
  const job = submission.job || {};
  return [
    submission.submittedAt, intro.name, intro.email, intro.study, intro.level,
    intro.hoursPerWeek, (intro.tools || []).join(", "), intro.portfolio,
    job.mcqScore, job.mcqTotal, JSON.stringify(job.short || []),
    (submission.coding || {}).explanation, JSON.stringify((submission.coding || {}).autoChecks || []),
    JSON.stringify(submission.situations || []), (submission.coding || {}).code,
    JSON.stringify(submission.proctoring || {})
  ].map(csvCell).join(",");
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
      const submissions = readSubmissions();
      submissions.push({...submission, receivedAt: new Date().toISOString()});
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
  const headers = [
    "Submitted at", "Name", "Email", "Study / position", "Level", "Hours per week",
    "Tools", "Portfolio", "MCQ score", "MCQ total", "Short answers",
    "Coding explanation", "Coding checks", "Situation answers", "Submitted code", "Proctoring"
  ];
  const rows = submissions.map(csvRow);
  const csv = [headers.map(csvCell).join(","), ...rows].join("\r\n");
  send(response, 200, `<!doctype html><meta charset="utf-8"><title>Webmaster results</title>
<style>body{font:16px system-ui;margin:2rem;color:#17202a}a{display:inline-block;margin-bottom:1rem;padding:.6rem 1rem;background:#00629b;color:#fff;text-decoration:none;border-radius:6px}table{border-collapse:collapse;font-size:14px}th,td{border:1px solid #ccd3db;padding:8px;text-align:left;vertical-align:top}th{background:#eef3f7}</style>
<h1>Webmaster results (${submissions.length})</h1>
<a download="webmaster-results.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(csv)}">Download CSV</a>
<table><thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>
${submissions.map(submission => `<tr>${csvRow(submission).split(",").map(cell => `<td>${cell.replace(/^"|"$/g, "").replace(/""/g, '"')}</td>`).join("")}</tr>`).join("")}
</tbody></table>`, "text/html; charset=utf-8");
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === "POST" && url.pathname === "/api/submissions") return handleSubmission(request, response);
  if (request.method === "GET" && url.pathname === "/admin") return handleAdmin(request, response);
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
