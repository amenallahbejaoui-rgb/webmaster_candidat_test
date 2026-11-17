const SPREADSHEET_ID = "1JQAH3ckbNTudEqBTncZjqsSmIeWs8UZPToPhATaaQEAI-3wxBiWvjgf6";
const SHEET_NAME = "Responses";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getResponsesSheet_();

    sheet.appendRow([
      new Date(),
      data.intro.name || "",
      data.intro.email || "",
      data.intro.study || "",
      data.intro.level || "",
      data.intro.hoursPerWeek || "",
      (data.intro.tools || []).join(", "),
      data.intro.portfolio || "",
      data.job.mcqScore || 0,
      data.job.mcqTotal || 0,
      JSON.stringify(data.job.short || []),
      data.coding.explanation || "",
      JSON.stringify(data.coding.autoChecks || []),
      JSON.stringify(data.situations || []),
      JSON.stringify(data.coding.code || ""),
      JSON.stringify(data.proctoring || {}),
      data.submittedAt || ""
    ]);

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
    sheet.appendRow([
      "Received at",
      "Name",
      "Email",
      "Study / position",
      "Level",
      "Hours per week",
      "Tools",
      "Portfolio",
      "MCQ score",
      "MCQ total",
      "Short answers (JSON)",
      "Coding explanation",
      "Coding checks (JSON)",
      "Situation answers (JSON)",
      "Submitted code (JSON string)",
      "Proctoring (JSON)",
      "Candidate submission time"
    ]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}
