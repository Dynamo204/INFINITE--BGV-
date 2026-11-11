const fs = require("fs");
const path = require("path");
const config = require("../config/config");

// Remembers each employee's vendor case (vendor, case ID, Ref ID and the last
// status read from the vendor), because SuccessFactors has no writable field
// for the case ID. Kept in one JSON file: Backend/data/vendor-cases.json
// (or VENDOR_CASE_STORE_PATH).
//
// Note for SAP BTP Cloud Foundry: the app's disk is reset when the app is
// restaged or redeployed. Set VENDOR_CASE_STORE_PATH to persistent storage there,
// or move this store to a database later; the functions below stay the same.

let cases = null;

function getStorePath() {
    return config.caseStore.path;
}

function load() {
    if (cases) return cases;
    try {
        const text = fs.readFileSync(getStorePath(), "utf8");
        const parsed = JSON.parse(text);
        cases = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.warn(`Vendor case store ${getStorePath()} could not be read: ${error.message}`);
        }
        cases = {};
    }
    return cases;
}

function persist() {
    const file = getStorePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write to a temp file first, then rename, so a crash never leaves half a file
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(cases, null, 2));
    fs.renameSync(temp, file);
}

// The stored case of an employee, or null
function getCase(employeeId) {
    const key = String(employeeId || "").trim();
    if (!key) return null;
    return load()[key] || null;
}

// Saves fields for an employee's case. A different case ID than the stored one
// starts a new entry (a new case replaces the old one).
function saveCase(employeeId, fields) {
    const key = String(employeeId || "").trim();
    if (!key || !fields?.caseId) return null;
    const all = load();
    const previous = all[key];
    const base = previous && String(previous.caseId) === String(fields.caseId) ? previous : {};
    const clean = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined)
    );
    all[key] = { ...base, ...clean, employeeId: key, caseId: String(fields.caseId), updatedAt: new Date().toISOString() };
    try {
        persist();
    } catch (error) {
        console.error(`Vendor case store ${getStorePath()} could not be written: ${error.message}`);
    }
    return all[key];
}

function listCases() {
    return Object.values(load());
}

// For tests: forget what is loaded so the next call reads the file again
function resetCache() {
    cases = null;
}

module.exports = {
    getCase,
    saveCase,
    listCases,
    resetCache
};