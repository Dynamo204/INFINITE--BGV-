const crypto = require("crypto");
const axios = require("axios");
const config = require("../config/config");

// Client-wise checklist kept in the RAP app (S/4HANA, OData V4 entity
// InfiniteClient). One RAP record has one client and one or more checks:
//   { RecordUUID, InfiniteClientList: "Verizon CAD IND",
//     CheckList: "Highest Education/ 5 years Employment Check/ GDC" }
// (several checks in one record are separated by "/", as in the client master Excel).
// The portal shows them grouped by client and can add and delete them in RAP.

const CACHE_MS = 5 * 60 * 1000;
const CHECK_SEPARATOR = "/ ";
let cache = { at: 0, data: null, rows: [] };

function getRapAuth() {
    const { username, password } = config.rap;
    if (!username || !password) {
        const error = new Error(
            "RAP login is missing in Backend/.env. Set RAP_USERNAME and RAP_PASSWORD."
        );
        error.status = 500;
        throw error;
    }
    return { username, password };
}

function rapError(action, error) {
    const status = error.response?.status;
    const data = error.response?.data;
    const detail = data?.error?.message?.value || data?.error?.message ||
        error.response?.statusText || error.message;
    const failure = new Error(
        `${action}${status ? ` (HTTP ${status})` : ""}: ${detail}`,
        { cause: error }
    );
    failure.status = status && status < 500 && status !== 401 && status !== 403 ? 400 : 502;
    return failure;
}

function splitChecks(text) {
    return String(text || "")
        .split("/")
        .map(check => check.replace(/\s+/g, " ").trim())
        .filter(Boolean);
}

// Reads every record, following OData V4 paging (@odata.nextLink)
async function fetchAllRows() {
    const auth = getRapAuth();
    const rows = [];
    let url = config.rap.clientChecklistUrl;
    for (let page = 0; url && page < 100; page += 1) {
        let response;
        try {
            response = await axios.get(url, {
                auth,
                headers: { Accept: "application/json" },
                timeout: 30000
            });
        } catch (error) {
            throw rapError("Client checklist could not be loaded from RAP", error);
        }
        const data = response.data || {};
        rows.push(...(Array.isArray(data.value) ? data.value : []));
        const next = data["@odata.nextLink"];
        url = next ? new URL(next, url).toString() : "";
    }
    return rows;
}

// [{ client, checks: [{ id, name, recordId }] }], clients A–Z,
// checks in the order RAP has them, without repeats
function groupByClient(rows) {
    const clients = new Map();
    for (const row of rows) {
        const client = String(row.InfiniteClientList || "").trim();
        if (!client) continue;
        const recordId = String(row.RecordUUID || "");
        if (!clients.has(client)) clients.set(client, { client, checks: [] });
        const entry = clients.get(client);
        splitChecks(row.CheckList).forEach((check, index) => {
            if (!entry.checks.some(item => item.name.toLowerCase() === check.toLowerCase())) {
                entry.checks.push({
                    id: `${recordId || client}-${index}`,
                    name: check,
                    recordId
                });
            }
        });
    }
    return [...clients.values()].sort((a, b) => a.client.localeCompare(b.client));
}

async function getClientChecklists({ refresh = false } = {}) {
    if (!refresh && cache.data && Date.now() - cache.at < CACHE_MS) {
        return cache.data;
    }
    const rows = await fetchAllRows();
    const clients = groupByClient(rows);
    cache = {
        at: Date.now(),
        rows,
        data: {
            clients,
            totalChecks: clients.reduce((sum, item) => sum + item.checks.length, 0),
            fetchedAt: new Date().toISOString()
        }
    };
    return cache.data;
}

function resetCache() {
    cache = { at: 0, data: null, rows: [] };
}

// ---------------------------------------------------------------------------
// Changes in RAP (OData V4). S/4HANA needs a CSRF token and its session
// cookie for every change; both are fetched with a GET first.
// ---------------------------------------------------------------------------
async function getCsrfSession() {
    const auth = getRapAuth();
    let response;
    try {
        response = await axios.get(config.rap.clientChecklistUrl, {
            auth,
            params: { $top: 0 },
            headers: { Accept: "application/json", "x-csrf-token": "Fetch" },
            timeout: 30000
        });
    } catch (error) {
        throw rapError("RAP did not return a CSRF token", error);
    }
    const token = response.headers?.["x-csrf-token"];
    const cookies = [].concat(response.headers?.["set-cookie"] || [])
        .map(cookie => String(cookie).split(";")[0])
        .join("; ");
    return {
        auth,
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(token ? { "x-csrf-token": token } : {}),
            ...(cookies ? { Cookie: cookies } : {})
        }
    };
}

function getRecordUrl(recordId) {
    return `${config.rap.clientChecklistUrl.replace(/\/+$/, "")}(RecordUUID=${recordId})`;
}

async function createRecord(session, client, checks) {
    const body = { InfiniteClientList: client, CheckList: checks.join(CHECK_SEPARATOR) };
    try {
        const response = await axios.post(config.rap.clientChecklistUrl, body, {
            auth: session.auth,
            headers: session.headers,
            timeout: 30000
        });
        return response.data;
    } catch (error) {
        // If RAP expects the key from the caller, send a new one
        const text = JSON.stringify(error.response?.data || "");
        if (error.response?.status === 400 && /RecordUUID|key/i.test(text)) {
            try {
                const response = await axios.post(
                    config.rap.clientChecklistUrl,
                    { RecordUUID: crypto.randomUUID(), ...body },
                    { auth: session.auth, headers: session.headers, timeout: 30000 }
                );
                return response.data;
            } catch (retryError) {
                throw rapError("RAP did not save the client checklist", retryError);
            }
        }
        throw rapError("RAP did not save the client checklist", error);
    }
}

async function deleteRecord(session, row) {
    const etag = row["@odata.etag"];
    try {
        await axios.delete(getRecordUrl(row.RecordUUID), {
            auth: session.auth,
            headers: { ...session.headers, "If-Match": etag || "*" },
            timeout: 30000
        });
    } catch (error) {
        throw rapError("RAP did not delete the record", error);
    }
}

function cleanText(value, label, max = 1000) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) {
        const error = new Error(`${label} is required`);
        error.status = 400;
        throw error;
    }
    if (text.length > max) {
        const error = new Error(`${label} is too long (${max} characters at most)`);
        error.status = 400;
        throw error;
    }
    return text;
}

// Adds a client with its checks, or adds checks to an existing client.
// Checks the client already has are skipped. All new checks go into one record.
async function addClientChecks(clientName, checkNames) {
    const client = cleanText(clientName, "Client name", 200);
    const wanted = [...new Set(
        (Array.isArray(checkNames) ? checkNames : [checkNames])
            .flatMap(splitChecks)
            .map(check => check.replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .map(check => check.toLowerCase())
    )];
    const names = (Array.isArray(checkNames) ? checkNames : [checkNames])
        .flatMap(splitChecks)
        .filter((check, index, all) =>
            all.findIndex(other => other.toLowerCase() === check.toLowerCase()) === index);
    if (wanted.length === 0) {
        const error = new Error("Add at least one check");
        error.status = 400;
        throw error;
    }

    const current = await getClientChecklists({ refresh: true });
    const existing = current.clients.find(item => item.client.toLowerCase() === client.toLowerCase());
    const clientLabel = existing ? existing.client : client;
    const newChecks = names.filter(name =>
        !existing?.checks.some(check => check.name.toLowerCase() === name.toLowerCase()));
    if (newChecks.length === 0) {
        const error = new Error(`${clientLabel} already has ${names.length === 1 ? "this check" : "these checks"}`);
        error.status = 400;
        throw error;
    }

    const session = await getCsrfSession();
    await createRecord(session, clientLabel, newChecks);
    resetCache();
    return { client: clientLabel, added: newChecks, created: !existing };
}

// Deletes one check of a client, or the whole client when no check is given.
// A record holding several checks is replaced by one with the remaining checks
// (RAP is only asked to create and delete, never to update).
async function deleteClientChecks(clientName, checkName) {
    const client = cleanText(clientName, "Client name", 200);
    await getClientChecklists({ refresh: true });
    const rows = cache.rows.filter(row =>
        String(row.InfiniteClientList || "").trim().toLowerCase() === client.toLowerCase());
    if (rows.length === 0) {
        const error = new Error(`Client ${client} was not found in RAP`);
        error.status = 404;
        throw error;
    }

    const session = await getCsrfSession();
    if (!checkName) {
        for (const row of rows) await deleteRecord(session, row);
        resetCache();
        return { client, deletedClient: true, removed: rows.length };
    }

    const check = cleanText(checkName, "Check name");
    const affected = rows.filter(row =>
        splitChecks(row.CheckList).some(name => name.toLowerCase() === check.toLowerCase()));
    if (affected.length === 0) {
        const error = new Error(`${client} has no check "${check}"`);
        error.status = 404;
        throw error;
    }
    for (const row of affected) {
        const remaining = splitChecks(row.CheckList)
            .filter(name => name.toLowerCase() !== check.toLowerCase());
        // Save the remaining checks first, so nothing is lost if the delete fails
        if (remaining.length > 0) {
            await createRecord(session, String(row.InfiniteClientList).trim(), remaining);
        }
        await deleteRecord(session, row);
    }
    resetCache();
    return { client, deletedCheck: check };
}

module.exports = {
    getClientChecklists,
    addClientChecks,
    deleteClientChecks,
    groupByClient,
    splitChecks,
    resetCache
};