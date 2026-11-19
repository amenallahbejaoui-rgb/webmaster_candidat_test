const SPREADSHEET_ID = "1JQAH3ckbNTudEqBTncZjqsSmIeWs8UZPToPhATaaQEAI-3wxBiWvjgf6";
const SHEET_NAME = "Responses";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getResponsesSheet_();
    const mcq = data.job.mcqDetail || [];
    const shortAnswers = data.job.short || [];
    const checks = data.coding.autoChecks || [];
    const situations = data.situations || [];
    const row = [
      new Date(), data.test || "", data.submittedAt || "", data.durationMin || 0,
      data.autoSubmitted ? "Yes" : "No", data.rulesAcknowledged ? "Yes" : "No",
      data.intro.name || "", data.intro.email || "", data.intro.ieeeId || "",
      data.intro.study || "", data.intro.level || "", (data.intro.tools || []).join(", "),
      data.intro.hoursPerWeek || "", data.intro.introduction || "", data.intro.why || "",
      data.intro.portfolio || "", data.job.mcqScore || 0, data.job.mcqTotal || 0
    ];
    for (let i = 0; i < 12; i++) {
      const answer = mcq[i] || {};
      row.push(answer.q || "", answer.chosen || "", answer.correct === true ? "Yes" : answer.correct === false ? "No" : "");
    }
    for (let i = 0; i < 3; i++) {
      const answer = shortAnswers[i] || {};
      row.push(answer.q || "", answer.a || "");
    }
    row.push(data.coding.code || "", data.coding.explanation || "");
    for (let i = 0; i < 7; i++) {
      const check = checks[i] || {};
      row.push(check.name || "", check.pass === true ? "Passed" : check.pass === false ? "Not passed" : "");
    }
    for (let i = 0; i < 5; i++) {
      const answer = situations[i] || {};
      row.push(answer.q || "", answer.a || "");
    }
    row.push(
      data.proctoring.tabSwitches || 0,
      data.proctoring.pastesInEditor || 0,
      data.proctoring.cameraEnabled === true ? "Yes" : ""
    );
    sheet.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getResponsesSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    const headers = [
      "Received at", "Test title", "Candidate submission time", "Duration (minutes)",
      "Automatically submitted", "Rules acknowledged", "Full name", "Email",
      "IEEE membership number", "Field of study / current position", "Web experience level",
      "Tools used", "Hours per week", "Self-introduction",
      "Why do you want to be the IEEE webmaster?", "Project or website",
      "MCQ score", "MCQ total"
    ];
    for (let i = 1; i <= 12; i++) headers.push(`Technical question ${i}`, `Technical question ${i} — selected answer`, `Technical question ${i} — correct`);
    for (let i = 1; i <= 3; i++) headers.push(`Short answer ${i} — question`, `Short answer ${i}`);
    headers.push("Submitted code", "Coding approach / improvements");
    for (let i = 1; i <= 7; i++) headers.push(`Coding requirement ${i}`, `Coding requirement ${i} — result`);
    for (let i = 1; i <= 5; i++) headers.push(`Situation ${i} — question`, `Situation ${i}`);
    headers.push("Tab switches", "Pastes in code editor", "Camera enabled (legacy submissions)");
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }

  return sheet;
}
