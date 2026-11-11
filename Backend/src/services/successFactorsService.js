const axios = require("axios");
const config = require("../config/config");
const caseStore = require("./caseStore");

function getODataBaseUrl() {
    const baseUrl = config.successFactors.baseUrl;
    const match = baseUrl?.match(/^(.*\/odata\/v2)(?:\/.*)?$/i);

    if (!match) {
        throw new Error(
            "SF_BASE_URL must include the SuccessFactors /odata/v2 service path"
        );
    }

    return match[1];
}

function getConfiguredEntityPath() {
    const match = config.successFactors.baseUrl?.match(
        /\/odata\/v2\/([^?]+)$/i
    );

    if (!match) {
        throw new Error(
            "SF_BASE_URL must include an OData entity after /odata/v2"
        );
    }

    return match[1].replace(/\/+$/, "");
}

async function getSuccessFactorsResource(path, params = {}) {
    try {
        return await axios.get(`${getODataBaseUrl()}/${path}`, {
            auth: {
                username: config.successFactors.username,
                password: config.successFactors.password
            },
            headers: {
                Accept: "application/json"
            },
            params: {
                $format: "json",
                ...params
            },
            timeout: 30000
        });
    } catch (error) {
        const resource = path.split("/")[0].split("(")[0];
        const status = error.response?.status;
        const responseMessage =
            error.response?.data?.error?.message?.value ||
            error.response?.data?.error?.message;

        throw new Error(
            `SuccessFactors ${resource} lookup failed${status ? ` (HTTP ${status})` : ""}${responseMessage ? `: ${responseMessage}` : ""}`,
            { cause: error }
        );
    }
}

function escapeODataString(value) {
    return String(value).replace(/'/g, "''");
}

function getODataObject(data) {
    return data?.d?.results || (data?.d ? [data.d] : []);
}

function getFirstValue(record, fieldNames) {
    for (const fieldName of fieldNames) {
        const value = record?.[fieldName];
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value);
        }
    }
    return "";
}

function isInvalidPropertyFilterError(error) {
    const status = error.cause?.response?.status || error.response?.status;
    if (status !== 400) return false;

    const responseMessage =
        error.cause?.response?.data?.error?.message?.value ||
        error.cause?.response?.data?.error?.message ||
        error.response?.data?.error?.message?.value ||
        error.response?.data?.error?.message ||
        error.message;

    return typeof responseMessage === "string" &&
        /invalid property names/i.test(responseMessage);
}

// cust_BGV keeps one record version per effectiveStartDate. Without asOfDate,
// SuccessFactors picks the version valid "today" in UTC, which until 05:30 IST
// is still yesterday, so the app would read and update an older version than
// the SF screen shows. asOfDate = today in SF_TIMEZONE (default Asia/Kolkata).
function getBgvAsOfDate() {
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: config.successFactors.timeZone || "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(new Date());
    } catch {
        return new Date().toISOString().slice(0, 10);
    }
}

async function findBgvRecordByEmployeeId(employeeId) {
    const response = await getSuccessFactorsResource(getConfiguredEntityPath(), {
        asOfDate: getBgvAsOfDate()
    });
    const records = getODataObject(response.data);

    return records.find(record =>
        String(record.cust_Employee_ID ?? "") === String(employeeId)
    );
}

// ---- Adamma: write case status back to cust_BGV ----
function toODataDateTimeLiteral(value) {
    const match = String(value || "").match(/^\/Date\((-?\d+)/);
    const date = match ? new Date(Number(match[1])) : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `datetime'${date.toISOString().slice(0, 19)}'`;
}

// Key path of a cust_BGV record, e.g.
// cust_BGV(effectiveStartDate=datetime'2026-11-02T00:00:00',externalCode='722')
function getBgvRecordKeyPath(record) {
    const uri = record?.__metadata?.uri;
    if (uri) {
        const match = String(uri).match(/\/odata\/v2\/(.+)$/i);
        if (match) return match[1];
    }
    const entity = getConfiguredEntityPath();
    const effective = toODataDateTimeLiteral(record?.effectiveStartDate);
    const code = `externalCode='${escapeODataString(record?.externalCode)}'`;
    return effective
        ? `${entity}(effectiveStartDate=${effective},${code})`
        : `${entity}(${code})`;
}

// Partial update (OData MERGE) of the employee's cust_BGV record:
// only the fields passed in are changed, everything else is kept.
async function updateBgvRecord(employeeId, fields) {
    const record = await findBgvRecordByEmployeeId(employeeId);
    if (!record) {
        const error = new Error(`No cust_BGV record found for employee ID ${employeeId}`);
        error.status = 404;
        throw error;
    }
    const keyPath = getBgvRecordKeyPath(record);
    // Same call as the working Postman request:
    // POST /odata/v2/upsert  [{ "__metadata": {"uri": "cust_BGV"}, externalCode, effectiveStartDate, ...fields }]
    // Using the record's own effectiveStartDate updates that record instead of creating a new one.
    const body = [{
        __metadata: { uri: getConfiguredEntityPath() },
        externalCode: String(record.externalCode),
        effectiveStartDate: record.effectiveStartDate,
        ...fields
    }];
    let response;
    try {
        response = await axios.post(`${getODataBaseUrl()}/upsert`, body, {
            auth: {
                username: config.successFactors.username,
                password: config.successFactors.password
            },
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json"
            },
            params: { $format: "json" },
            timeout: 30000
        });
    } catch (error) {
        const status = error.response?.status;
        const responseMessage =
            error.response?.data?.error?.message?.value ||
            error.response?.data?.error?.message;
        throw new Error(
            `SuccessFactors cust_BGV update failed${status ? ` (HTTP ${status})` : ""}${responseMessage ? `: ${responseMessage}` : ""}`,
            { cause: error }
        );
    }

    // upsert answers HTTP 200 even when a row fails; the real result is per row.
    const upsertRows = Array.isArray(response?.data?.d)
        ? response.data.d
        : getODataObject(response?.data);
    const result = upsertRows[0];
    if (result && (String(result.status || "").toUpperCase() === "ERROR" ||
        (result.httpCode && Number(result.httpCode) >= 400))) {
        throw new Error(
            `SuccessFactors cust_BGV update failed (HTTP ${result.httpCode || "?"})${result.message ? `: ${result.message}` : ""}`
        );
    }
    return { record, keyPath, result };
}

// A picklist can hold the same label twice, e.g. "Parishram" as code 04
// (inactive, status "I") and code 4 (active, status "A"). SF accepts an
// inactive code without an error but does not keep or show it, so only
// active values are used. Values without a status are treated as active.
function getActivePicklistValues(values) {
    return values.filter(value => !value.status || String(value.status).toUpperCase() === "A");
}

// Code of a picklist value found by its label or code, e.g. picklist "V3",
// "Parishram" -> its externalCode. Returns "" when the picklist has no match
// or cannot be read.
async function findPicklistCode(picklistId, labelOrCode) {
    const wanted = normalizeLabel(labelOrCode);
    if (!picklistId || !wanted) return "";
    try {
        const response = await getSuccessFactorsResource("PickListValueV2", {
            $filter: `PickListV2_id eq '${escapeODataString(picklistId)}'`
        });
        const match = getActivePicklistValues(getODataObject(response.data)).find(value =>
            [value.externalCode, value.label_localized, value.label_defaultValue, value.label_en_US, value.label_en_GB]
                .some(label => normalizeLabel(label) === wanted)
        );
        return match ? String(match.externalCode) : "";
    } catch (error) {
        console.warn(`Picklist ${picklistId} lookup failed`, { message: error.message });
        return "";
    }
}

function normalizeLabel(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Finds the SF picklist code for a status label (e.g. Adamma "INITIATED"
// -> the cust_Status code whose label is "Initiated").
async function resolveBgvStatusCode(record, statusLabel) {
    const wanted = normalizeLabel(statusLabel);
    if (!wanted) return null;

    const map = config.vendor.sfStatusMap || {};
    for (const [label, code] of Object.entries(map)) {
        if (normalizeLabel(label) === wanted) return String(code);
    }

    let picklistId = config.vendor.sfStatusPicklistId;
    if (!picklistId && config.vendor.sfStatusNavigation) {
        try {
            const response = await getSuccessFactorsResource(
                `${getBgvRecordKeyPath(record)}/${config.vendor.sfStatusNavigation}`
            );
            picklistId = getODataObject(response.data)[0]?.PickListV2_id || "";
        } catch {
            picklistId = "";
        }
    }
    if (!picklistId) return null;

    const response = await getSuccessFactorsResource("PickListValueV2", {
        $filter: `PickListV2_id eq '${escapeODataString(picklistId)}'`
    });
    const match = getActivePicklistValues(getODataObject(response.data)).find(value =>
        [value.label_localized, value.label_defaultValue, value.label_en_US, value.label_en_GB, value.externalCode]
            .some(label => normalizeLabel(label) === wanted)
    );
    return match ? String(match.externalCode) : null;
}

async function getRecordsByExternalCode(entity, preferredId, fallbackId) {
    const candidateIds = [...new Set(
        [preferredId, fallbackId]
            .filter(value => value !== undefined && value !== null && String(value).trim())
            .map(String)
    )];

    if (candidateIds.length === 0) {
        return [];
    }

    const openFilters = [];
    for (const candidateId of candidateIds) {
        const escaped = escapeODataString(candidateId);
        openFilters.push(
            `externalCode eq '${escaped}'`,
            `personIdExternal eq '${escaped}'`,
            `cust_Employee_ID eq '${escaped}'`,
            `cust_EmployeeId eq '${escaped}'`,
            `employeeId eq '${escaped}'`
        );
    }

    const seenFilters = new Set();
    const filters = [];
    for (const filter of openFilters) {
        if (!seenFilters.has(filter)) {
            seenFilters.add(filter);
            filters.push(filter);
        }
    }

    for (const filter of filters) {
        try {
            const response = await getSuccessFactorsResource(entity, {
                $filter: filter
            });
            const records = getODataObject(response.data);
            if (records.length > 0) {
                return records;
            }
        } catch (error) {
            if (isInvalidPropertyFilterError(error)) {
                continue;
            }
            throw error;
        }
    }

    return [];
}

async function getEmployeeDocuments(employeeId, bgvRecordId) {
    const entityIds = [...new Set(
        [bgvRecordId, employeeId]
            .filter(value => value !== undefined && value !== null && value !== "")
            .map(String)
    )];
    if (entityIds.length === 0) {
        return [];
    }

    const documentEntityFilter = entityIds
        .map(id => `documentEntityId eq '${escapeODataString(id)}'`)
        .join(" or ");
    const response = await getSuccessFactorsResource("Attachment", {
        $filter:
            `documentEntityType eq 'cust_BGV' and (${documentEntityFilter})`
    });

    const attachments = getODataObject(response.data);
    const uniqueAttachments = new Map();

    for (const attachment of attachments) {
        if (attachment.attachmentId !== undefined && attachment.attachmentId !== null) {
            uniqueAttachments.set(String(attachment.attachmentId), attachment);
        }
    }

    return [...uniqueAttachments.values()]
        .map(attachment => {
            const attachmentId = String(attachment.attachmentId);

            return {
                id: attachmentId,
                attachmentId,
                type:
                    attachment.documentType ||
                    attachment.documentCategory ||
                    "BGV Document",
                file:
                    attachment.fileName ||
                    attachment.dmsFileName ||
                    `Attachment ${attachmentId}`,
                fileName:
                    attachment.fileName ||
                    attachment.dmsFileName ||
                    `Attachment ${attachmentId}`,
                mimeType: attachment.mimeType || "",
                downloadUrl:
                    `/api/employee/${encodeURIComponent(employeeId)}/attachments/${encodeURIComponent(attachmentId)}`
            };
        });
}

// True when SuccessFactors says the record or attachment slot simply does not
// exist: 404, or 400 with COE0028 "Record for entity ... does not exist".
// Such a section has no documents; it is not an error.
function isMissingRecordError(error) {
    const response = error.cause?.response || error.response;
    const status = response?.status;
    if (status === 404) return true;
    if (status !== 400) return false;
    const message = String(
        response?.data?.error?.message?.value ||
        response?.data?.error?.message ||
        error.message ||
        ""
    );
    return /COE0028|does not exist/i.test(message);
}

const EDUCATION_ATTACHMENT_SLOTS = [
    ["cust_Attachment1Nav", "Higher education"],
    ["cust_Attachment2Nav", "Education details 2"],
    ["cust_Attachment3Nav", "Education details 3"],
    ["cust_Attachment4Nav", "Education details 4"],
    ["cust_Attachment5Nav", "Education details 5"]
];

async function getEducationAttachments(employeeId) {
    if (!employeeId) {
        throw new Error("Employee ID is required to load education attachments");
    }

    // The selected employee ID is the cust_INDEDUCATION externalCode key.
    const educationRecordId = String(employeeId);
    const slotResults = await Promise.all(
        EDUCATION_ATTACHMENT_SLOTS.map(async ([navigation, type]) => {
            try {
                const response = await getSuccessFactorsResource(
                    `cust_INDEDUCATION('${escapeODataString(educationRecordId)}')/${navigation}`
                );
                return getODataObject(response.data).map((item, index) => ({
                    id: `${educationRecordId}-${navigation}-${item.attachmentId || item.fileName || index}`,
                    attachmentId: item.attachmentId ? String(item.attachmentId) : "",
                    type: item.fileName || item.dmsFileName || type,
                    section: "Education Details",
                    file: item.fileName || item.dmsFileName || `${type} ${index + 1}`,
                    fileName: item.fileName || item.dmsFileName || `${type} ${index + 1}`,
                    mimeType: item.mimeType || "application/octet-stream",
                    fileContent: item.fileContent || "",
                    fileExtension: item.fileExtension || ""
                }));
            } catch (error) {
                // SuccessFactors returns 404 when an optional attachment slot is empty,
                // and 400 (COE0028) when the employee has no education record at all.
                if (isMissingRecordError(error)) return [];
                throw error;
            }
        })
    );

    return slotResults.flat();
}

async function getNavigationAttachments(recordId, entity, slots) {
    if (!recordId) return [];

    const results = await Promise.all(slots.map(async ([navigation, type]) => {
        try {
            const response = await getSuccessFactorsResource(
                `${entity}('${escapeODataString(recordId)}')/${navigation}`
            );
            return getODataObject(response.data).map((item, index) => {
                const fileName = item.fileName || item.dmsFileName || `${type} ${index + 1}`;
                return {
                    id: `${recordId}-${navigation}-${item.attachmentId || fileName || index}`,
                    attachmentId: item.attachmentId ? String(item.attachmentId) : "",
                    type: item.fileName || item.dmsFileName || type,
                    section: "Previous Employment Details",
                    file: fileName,
                    fileName,
                    mimeType: item.mimeType || "application/octet-stream",
                    fileContent: item.fileContent || "",
                    fileExtension: item.fileExtension || ""
                };
            });
        } catch (error) {
            if (isMissingRecordError(error)) return [];
            throw error;
        }
    }));

    return results.flat();
}

async function getPersonalAttachments(personIdExternal) {
    if (!personIdExternal) return [];

    const response = await getSuccessFactorsResource("PerNationalId", {
        $filter: `personIdExternal eq '${escapeODataString(personIdExternal)}'`
    });
    const records = getODataObject(response.data);

    return Promise.all(records.filter(record => record.attachmentId).map(async (record, index) => {
        const attachmentId = String(record.attachmentId);
        const attachmentResponse = await getSuccessFactorsResource(
            `Attachment('${escapeODataString(attachmentId)}')`
        );
        const attachment = attachmentResponse.data?.d || {};
        const fileName = attachment.fileName || attachment.dmsFileName || `Personal document ${index + 1}`;
        return {
            id: `personal-${attachmentId}`,
            attachmentId,
            type: fileName,
            // National ID type from SF (e.g. "PAN", "ADN" for Aadhaar)
            cardType: record.cardType || "",
            section: "Personal Details",
            file: fileName,
            fileName,
            mimeType: attachment.mimeType || "application/octet-stream",
            fileContent: attachment.fileContent || ""
        };
    }));
}

async function getPreviousEmploymentAttachments(recordId, personIdExternal, bgvRecordId) {
    if (!recordId) return [];

    const records = await getRecordsByExternalCode(
        "cust_PreviousEmploymentDetails",
        recordId,
        personIdExternal,
        bgvRecordId
    );

    if (records.length === 0) {
        return [];
    }

    const slots = [
        ["cust_Attachment1Nav", "Previous employment attachment 1"],
        ["cust_Attachment2Nav", "Previous employment attachment 2"],
        ["cust_Attachment3Nav", "Previous employment attachment 3"],
        ["cust_Attachment4Nav", "Previous employment attachment 4"]
    ];

    const attachments = await Promise.all(
        records.map(record => {
            const externalCode = String(record.externalCode || record.id || record.personIdExternal || "");
            const recordKey = externalCode || String(record.cust_Employee_ID || record.cust_EmployeeId || "");
            if (!recordKey) {
                return [];
            }
            return getNavigationAttachments(recordKey, "cust_PreviousEmploymentDetails", slots);
        })
    );
    return attachments.flat();
}

async function getAdditionalAttachments(personIdExternal, previousEmploymentId, bgvRecordId) {
    const [personalResult, employmentResult] = await Promise.allSettled([
        getPersonalAttachments(personIdExternal),
        getPreviousEmploymentAttachments(previousEmploymentId, personIdExternal, bgvRecordId)
    ]);
    const documents = [
        ...(personalResult.status === "fulfilled" ? personalResult.value : []),
        ...(employmentResult.status === "fulfilled" ? employmentResult.value : [])
    ];
    const warnings = [];
    if (personalResult.status === "rejected") {
        warnings.push(`Personal documents: ${personalResult.reason.message}`);
    }
    if (employmentResult.status === "rejected") {
        warnings.push(`Previous employment documents: ${employmentResult.reason.message}`);
    }
    return { documents, warnings };
}

async function getAllEmployeeAttachments(educationRecordId, personIdExternal, previousEmploymentId) {
    const normalizedEducationRecordId = educationRecordId || personIdExternal || "";
    const normalizedPreviousEmploymentId = previousEmploymentId || personIdExternal || "";

    const results = await Promise.allSettled([
        getEducationAttachments(normalizedEducationRecordId),
        getPersonalAttachments(personIdExternal),
        getPreviousEmploymentAttachments(normalizedPreviousEmploymentId, personIdExternal, normalizedEducationRecordId)
    ]);
    const labels = ["Education documents", "Personal documents", "Previous employment documents"];
    const documents = [];
    const warnings = [];

    results.forEach((result, index) => {
        if (result.status === "fulfilled") {
            documents.push(...result.value);
        } else {
            warnings.push(`${labels[index]}: ${result.reason.message}`);
        }
    });

    return { documents, warnings };
}

async function getEmployeeAttachment(employeeId, attachmentId) {
    const employee = await findBgvRecordByEmployeeId(employeeId);

    if (!employee) {
        const error = new Error(
            `No cust_BGV record found for employee ID ${employeeId}`
        );
        error.status = 404;
        throw error;
    }

    const documents = await getEmployeeDocuments(
        employeeId,
        employee.externalCode
    );
    const document = documents.find(
        item => item.attachmentId === String(attachmentId)
    );

    if (!document) {
        const error = new Error(
            `Attachment ${attachmentId} is not associated with employee ${employeeId}`
        );
        error.status = 404;
        throw error;
    }

    const response = await getSuccessFactorsResource(
        `Attachment('${escapeODataString(attachmentId)}')`
    );
    const attachment = response.data?.d;

    if (!attachment?.fileContent) {
        throw new Error(
            `SuccessFactors did not return file content for attachment ${attachmentId}`
        );
    }

    return {
        fileName:
            attachment.fileName ||
            attachment.dmsFileName ||
            document.file,
        mimeType: attachment.mimeType || document.mimeType || "application/octet-stream",
        content: Buffer.from(attachment.fileContent, "base64")
    };
}

// cust_Status holds a picklist code ("02"); the label ("Initiated") comes
// from cust_StatusNav. Falls back to the code if the expand is not allowed.
function getStatusLabel(record) {
    const nav = record?.cust_StatusNav;
    const label = nav && typeof nav === "object" && !nav.__deferred
        ? (nav.label_localized || nav.label_defaultValue || nav.label_en_US || nav.label_en_GB)
        : "";
    return label || record?.cust_Status || "-";
}

// SF field that holds the vendor case ID ("BGV Profile Number").
// SF_CASE_ID_FIELD wins; else the first cust_BGV field named like
// ...ProfileNumber / ...ProfileNo / ...CaseID. "" when there is none.
const CASE_ID_FIELD_PATTERN = /^cust_.*(profile_?(number|no|num)|case_?id)$/i;
function getCaseIdField(record) {
    if (config.vendor.sfCaseIdField) return config.vendor.sfCaseIdField;
    if (!record || typeof record !== "object") return "";
    return Object.keys(record).find(key => CASE_ID_FIELD_PATTERN.test(key)) || "";
}

const VENDOR_KEYS = ["adamma", "parishram", "cfirst", "vibrant"];
const DEFAULT_VENDOR_CODES = { Adamma: "adamma", 4: "parishram", 3: "cfirst", 2: "vibrant" };
let vendorPicklistCache = { at: 0, values: [] };

// cust_Vendor code ("3") -> vendor key ("cfirst"), from SF_VENDOR_MAP,
// the V3 picklist labels, or the known codes.
async function getVendorKeyFromCode(code) {
    const value = String(code || "").trim();
    if (!value) return "";
    const fromMap = Object.entries(config.vendor.sfVendorMap || {})
        .find(([, mapped]) => String(mapped) === value);
    if (fromMap) return fromMap[0].trim().toLowerCase();

    const picklistId = config.vendor.sfVendorPicklistId;
    if (picklistId) {
        if (Date.now() - vendorPicklistCache.at > 10 * 60 * 1000) {
            try {
                const response = await getSuccessFactorsResource("PickListValueV2", {
                    $filter: `PickListV2_id eq '${escapeODataString(picklistId)}'`
                });
                vendorPicklistCache = { at: Date.now(), values: getActivePicklistValues(getODataObject(response.data)) };
            } catch (error) {
                console.warn(`Picklist ${picklistId} lookup failed`, { message: error.message });
                vendorPicklistCache = { at: Date.now(), values: [] };
            }
        }
        const entry = vendorPicklistCache.values.find(item => String(item.externalCode) === value);
        const label = normalizeLabel(
            entry?.label_localized || entry?.label_defaultValue || entry?.label_en_US || ""
        ).replace(/\s+/g, "");
        const key = VENDOR_KEYS.find(name => label.includes(name));
        if (key) return key;
    }
    return DEFAULT_VENDOR_CODES[value] || "";
}

function getAdammaCaseIdFromRemarks(remarks) {
    const match = String(remarks || "").match(/Adamma case ([^\s:]+)/i);
    return match && match[1] !== "(no" ? match[1] : "";
}

// Adamma case ID stored on the record: the dedicated field if configured
// (ADAMMA_SF_CASE_ID_FIELD), else cases saved earlier in cust_Remarks.
function getStoredAdammaCaseId(record) {
    const field = getCaseIdField(record);
    return (field && record?.[field] ? String(record[field]) : "") ||
        getAdammaCaseIdFromRemarks(record?.cust_Remarks);
}

// Vendor case stored on the record: case ID from the BGV Profile Number field
// and the vendor from cust_Vendor. Old Adamma cases are read from Remarks.
async function getStoredVendorCase(record) {
    // 1. The portal's own case store (case remembered at Submit / Refresh)
    const remembered = caseStore.getCase(record?.cust_Employee_ID);
    if (remembered?.caseId) {
        return { caseId: String(remembered.caseId), vendor: remembered.vendor || "" };
    }
    // 2. The SF case ID field, 3. old Adamma cases in Remarks
    const field = getCaseIdField(record);
    const caseId = field && record?.[field] ? String(record[field]).trim() : "";
    const vendor = await getVendorKeyFromCode(record?.[config.vendor.sfVendorField || "cust_Vendor"]);
    if (caseId) return { caseId, vendor };
    const adammaCaseId = getAdammaCaseIdFromRemarks(record?.cust_Remarks);
    return adammaCaseId ? { caseId: adammaCaseId, vendor: "adamma" } : { caseId: "", vendor };
}

async function getEmployees() {
    let response;
    try {
        response = await getSuccessFactorsResource(getConfiguredEntityPath(), {
            $expand: "cust_StatusNav",
            asOfDate: getBgvAsOfDate()
        });
    } catch (error) {
        if (error.cause?.response?.status !== 400) throw error;
        response = await getSuccessFactorsResource(getConfiguredEntityPath(), {
            asOfDate: getBgvAsOfDate()
        });
    }

    const results = getODataObject(response.data);
    const storedCases = await Promise.all(results.map(getStoredVendorCase));

    return results.map((employee, index) => ({
        id: employee.externalCode,

        employeeId: employee.cust_Employee_ID,

        name: employee.cust_EmployeeName || "-",

        manager: employee.cust_RM || "-",

        bu: employee.cust_BU || "-",

        client: employee.cust_CustomerLocation || "-",

        project: employee.cust_PrimaryProject || "-",

        externalCode: employee.externalCode,

        status: getStatusLabel(employee),

        statusCode: employee.cust_Status || "",

        vendor: employee.cust_Vendor || "",

        // Vendor case for the Refresh button and the background sync
        caseId: storedCases[index].caseId,
        caseVendor: storedCases[index].vendor,

        adammaCaseId: getStoredAdammaCaseId(employee)
    }));
}


function getSuccessFactorsUserName(user) {
    const fullName = getFirstValue(user, ["defaultFullName"]);
    if (fullName) return fullName;

    return [
        getFirstValue(user, ["firstName"]),
        getFirstValue(user, ["lastName"])
    ].filter(Boolean).join(" ");
}

function getExpandedRecord(value) {
    if (Array.isArray(value)) return value[0] || null;
    if (Array.isArray(value?.results)) return value.results[0] || null;
    return value && typeof value === "object" && !value.__deferred
        ? value
        : null;
}

function getBusinessUnitName(record) {
    return getFirstValue(record, [
        "name_localized",
        "name_defaultValue",
        "name",
        "name_en_US",
        "name_en_GB"
    ]);
}

async function findBusinessUnitByCode(code) {
    const response = await getSuccessFactorsResource("FOBusinessUnit", {
        $filter: `externalCode eq '${escapeODataString(code)}'`,
        $select: "externalCode,name,name_defaultValue,name_localized",
        asOfDate: getBgvAsOfDate(),
        $top: 1
    });

    return getODataObject(response.data).find(record =>
        String(record.externalCode ?? "") === String(code)
    ) || null;
}

async function findBusinessUnitByName(name) {
    const escapedName = escapeODataString(name);
    const response = await getSuccessFactorsResource("FOBusinessUnit", {
        $filter: `name eq '${escapedName}' or name_defaultValue eq '${escapedName}'`,
        $select: "externalCode,name,name_defaultValue,name_localized",
        asOfDate: getBgvAsOfDate(),
        $top: 20
    });

    return getODataObject(response.data).find(record =>
        getBusinessUnitName(record).toLowerCase() === String(name).trim().toLowerCase()
    ) || null;
}

async function findSuccessFactorsUser(userId) {
    const response = await getSuccessFactorsResource("User", {
        $filter: `userId eq '${escapeODataString(userId)}'`,
        $select: "userId,firstName,lastName,defaultFullName",
        $top: 1
    });
    const user = getODataObject(response.data).find(record =>
        String(record.userId ?? "") === String(userId)
    );
    return user || null;
}

async function searchSuccessFactorsUsers(query) {
    const searchTerm = String(query || "").trim();
    if (!searchTerm) return [];

    const response = await getSuccessFactorsResource("User", {
        $filter: `startswith(userId,'${escapeODataString(searchTerm)}')`,
        $select: "userId,firstName,lastName,defaultFullName",
        $orderby: "userId",
        $top: 20
    });

    return getODataObject(response.data)
        .filter(user => user.userId !== undefined && user.userId !== null)
        .map(user => ({
            employeeId: String(user.userId),
            name: getSuccessFactorsUserName(user)
        }));
}

async function getAllSuccessFactorsRecords(path, params, resourceLabel) {
    const records = [];
    let response = await getSuccessFactorsResource(path, {
        ...params
    });

    for (let page = 0; page < 1000; page += 1) {
        records.push(...getODataObject(response.data));
        const nextLink = response.data?.d?.__next;
        if (!nextLink) {
            return records;
        }

        const baseUrl = new URL(getODataBaseUrl());
        const pageUrl = new URL(nextLink, baseUrl);
        const entityPrefix = `${baseUrl.pathname.replace(/\/+$/, "")}/`;
        if (pageUrl.origin !== baseUrl.origin || !pageUrl.pathname.startsWith(entityPrefix)) {
            throw new Error("SuccessFactors returned an invalid User directory page URL");
        }

        const nextPath = pageUrl.pathname.slice(entityPrefix.length);
        const nextParams = Object.fromEntries(pageUrl.searchParams.entries());
        response = await getSuccessFactorsResource(nextPath, nextParams);
    }

    throw new Error(`SuccessFactors ${resourceLabel} directory exceeded the maximum page count`);
}

async function getSuccessFactorsUserDirectory() {
    const users = await getAllSuccessFactorsRecords("User", {
        $select: "userId,firstName,lastName,defaultFullName",
        $orderby: "userId",
        $top: 1000
    }, "User");
    let jobs;
    try {
        jobs = await getAllSuccessFactorsRecords("EmpJob", {
            $select: "userId,managerId,businessUnit,businessUnitNav/externalCode,businessUnitNav/name,businessUnitNav/name_defaultValue,businessUnitNav/name_localized",
            $expand: "businessUnitNav",
            asOfDate: getBgvAsOfDate(),
            $top: 1000
        }, "EmpJob");
    } catch (error) {
        if (error.cause?.response?.status !== 400) throw error;
        jobs = await getAllSuccessFactorsRecords("EmpJob", {
            $select: "userId,managerId,businessUnit",
            asOfDate: getBgvAsOfDate(),
            $top: 1000
        }, "EmpJob");
    }

    const userById = new Map(users
        .filter(user => user.userId !== undefined && user.userId !== null)
        .map(user => [String(user.userId), user]));
    const jobByUserId = new Map(jobs
        .filter(job => job.userId !== undefined && job.userId !== null)
        .map(job => [String(job.userId), job]));
    const businessUnitsByCode = new Map();
    const directory = [...userById.entries()].map(([employeeId, user]) => {
        const job = jobByUserId.get(employeeId);
        const businessUnitNav = getExpandedRecord(job?.businessUnitNav);
        const businessUnitCode =
            getFirstValue(job, ["businessUnit"]) ||
            getFirstValue(businessUnitNav, ["externalCode"]);
        const businessUnitName = getBusinessUnitName(businessUnitNav);
        if (businessUnitCode && businessUnitName) {
            businessUnitsByCode.set(businessUnitCode, businessUnitName);
        }

        return {
            employeeId,
            name: getSuccessFactorsUserName(user),
            managerId: getFirstValue(job, ["managerId"]),
            businessUnitCode,
            businessUnitName
        };
    });

    const unresolvedCodes = [...new Set(directory
        .filter(employee => employee.businessUnitCode && !employee.businessUnitName)
        .map(employee => employee.businessUnitCode))];
    const resolvedUnits = await Promise.all(unresolvedCodes.map(async code => [
        code,
        await findBusinessUnitByCode(code)
    ]));
    for (const [code, unit] of resolvedUnits) {
        const name = unit ? getBusinessUnitName(unit) : "";
        if (name) businessUnitsByCode.set(code, name);
    }

    return directory.map(employee => ({
        employeeId: employee.employeeId,
        name: employee.name,
        manager: getSuccessFactorsUserName(userById.get(employee.managerId)) || "",
        businessUnitCode: employee.businessUnitCode || "",
        businessUnit: employee.businessUnitName ||
            businessUnitsByCode.get(employee.businessUnitCode) ||
            "",
        client: "",
        status: "",
        profileNumber: "",
        project: ""
    }));
}

async function getEmployeeInitiationDetails(employeeId) {
    const employee = await findSuccessFactorsUser(employeeId);
    if (!employee) {
        const error = new Error(`Employee ID ${employeeId} was not found in SuccessFactors`);
        error.status = 404;
        throw error;
    }

    const employeeName = getSuccessFactorsUserName(employee);
    if (!employeeName) {
        const error = new Error(`SuccessFactors did not return a name for employee ID ${employeeId}`);
        error.status = 422;
        throw error;
    }

    const jobResponse = await getSuccessFactorsResource("EmpJob", {
        $filter: `userId eq '${escapeODataString(employeeId)}'`,
        $select: "userId,managerId,businessUnit,businessUnitNav/externalCode,businessUnitNav/name,businessUnitNav/name_defaultValue,businessUnitNav/name_localized",
        $expand: "businessUnitNav",
        asOfDate: getBgvAsOfDate(),
        $top: 1
    });
    const job = getODataObject(jobResponse.data)[0];
    const managerId = getFirstValue(job, ["managerId"]);
    const businessUnitNav = getExpandedRecord(job?.businessUnitNav);
    const businessUnitCode =
        getFirstValue(job, ["businessUnit"]) ||
        getFirstValue(businessUnitNav, ["externalCode"]);
    let businessUnitName = getBusinessUnitName(businessUnitNav);
    let managerName = "";

    if (businessUnitCode && !businessUnitName) {
        const businessUnit = await findBusinessUnitByCode(businessUnitCode);
        businessUnitName = businessUnit ? getBusinessUnitName(businessUnit) : "";
    }

    if (managerId) {
        try {
            const manager = await findSuccessFactorsUser(managerId);
            managerName = manager ? getSuccessFactorsUserName(manager) : "";
        } catch (error) {
            if (error.cause?.response?.status !== 404) throw error;
        }
    }

    return {
        employeeId: String(employee.userId),
        employeeName,
        managerName,
        businessUnitCode,
        businessUnitName
    };
}

async function createBgvEmployee({
    employeeId,
    employeeName,
    managerName,
    businessUnitName,
    businessUnitCode,
    client,
    primaryProject
}) {
    const selectedEmployeeId = String(employeeId || "").trim();
    const selectedPrimaryProject = String(primaryProject || "").trim();

    if (!selectedEmployeeId) {
        const error = new Error("Employee ID is required");
        error.status = 400;
        throw error;
    }

    const employee = await getEmployeeInitiationDetails(selectedEmployeeId);
    const selectedEmployeeName = String(employeeName ?? employee.employeeName).trim();
    const selectedManagerName = String(managerName ?? employee.managerName).trim();
    const selectedBusinessUnitName = String(businessUnitName ?? employee.businessUnitName).trim();
    let selectedBusinessUnitCode = String(businessUnitCode ?? employee.businessUnitCode).trim();

    if (selectedBusinessUnitName !== employee.businessUnitName) {
        const unit = await findBusinessUnitByName(selectedBusinessUnitName);
        selectedBusinessUnitCode = unit ? String(unit.externalCode || "") : "";
    }

    if (!selectedEmployeeName) {
        const error = new Error(`Employee name is required for employee ID ${selectedEmployeeId}`);
        error.status = 422;
        throw error;
    }

    if (!selectedBusinessUnitCode || !selectedBusinessUnitName) {
        const error = new Error(`SuccessFactors did not return a Business Unit code and name for employee ID ${selectedEmployeeId}`);
        error.status = 422;
        throw error;
    }

    const effectiveDate = getBgvAsOfDate();
    const [year, month, day] = effectiveDate.split("-").map(Number);
    const effectiveDateMillis = Date.UTC(year, month - 1, day);
    const entity = getConfiguredEntityPath();
    const uri = `${entity}(externalCode='${escapeODataString(selectedEmployeeId)}',effectiveStartDate=datetime'${effectiveDate}T00:00:00')`;
    const body = [{
        __metadata: { uri },
        externalCode: selectedEmployeeId,
        effectiveStartDate: `/Date(${effectiveDateMillis})/`,
        cust_Employee_ID: employee.employeeId,
        cust_EmployeeName: selectedEmployeeName,
        cust_BU: selectedBusinessUnitCode,
        cust_CustomerLocation: String(client || "").trim(),
        cust_PrimaryProject: selectedPrimaryProject,
        cust_RM: selectedManagerName
    }];

    let response;
    try {
        response = await axios.post(`${getODataBaseUrl()}/upsert`, body, {
            auth: {
                username: config.successFactors.username,
                password: config.successFactors.password
            },
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json"
            },
            params: { $format: "json" },
            timeout: 30000
        });
    } catch (error) {
        const status = error.response?.status;
        const responseMessage =
            error.response?.data?.error?.message?.value ||
            error.response?.data?.error?.message;
        throw new Error(
            `SuccessFactors cust_BGV creation failed${status ? ` (HTTP ${status})` : ""}${responseMessage ? `: ${responseMessage}` : ""}`,
            { cause: error }
        );
    }

    const upsertRows = Array.isArray(response?.data?.d)
        ? response.data.d
        : getODataObject(response?.data);
    const result = upsertRows[0];
    if (!result) {
        throw new Error("SuccessFactors did not confirm the employee creation");
    }
    if (String(result.status || "").toUpperCase() !== "OK" ||
        (result.httpCode && Number(result.httpCode) >= 400)) {
        throw new Error(
            `SuccessFactors cust_BGV creation failed (HTTP ${result.httpCode || "?"})${result.message ? `: ${result.message}` : ""}`
        );
    }

    return { employee, result };
}

async function getEmployeeDetails(employeeId) {
    const employee = await findBgvRecordByEmployeeId(employeeId);

    if (!employee) {
        throw new Error(
            `No cust_BGV record found for employee ID ${employeeId}`
        );
    }
    const documents = await getEmployeeDocuments(
        employeeId,
        employee.externalCode
    );

    return {
        employeeInfo: {
            id: employee.externalCode,
            employeeId: employee.cust_Employee_ID || employeeId,
            name: employee.cust_EmployeeName || "-",
            manager: employee.cust_RM || "-",
            bu: employee.cust_BU || "-",
            client: employee.cust_CustomerLocation || "-",
            project: employee.cust_PrimaryProject || "-",
            secondaryProject: employee.cust_SecondaryProject || "",
            joiningDate: employee.cust_DOJ || "-",
            phone: employee.cust_PhoneNumber || "-",
            email: employee.cust_CandidateEmail || "-",
            dob: employee.cust_DOB || "-",
            gender: employee.cust_Gender || "-",
            fatherName: getFirstValue(employee, ["cust_FatherName", "cust_Father_Name", "cust_Fathername"]),
            aadhaarNumber: getFirstValue(employee, ["cust_Aadharnumber", "cust_AadhaarNumber", "cust_AadharNumber", "cust_AadherNumber", "cust_Aadhaar"]),
            panNumber: getFirstValue(employee, ["cust_PANNumber", "cust_PanNumber", "cust_PAN", "cust_PanCard"]),
            adammaCaseId: getStoredAdammaCaseId(employee)
        },

        documents,

        // The employee's vendor case remembered by the portal (null if none):
        // vendor, caseId, refId, status, colour, remarks, dates
        vendorCase: caseStore.getCase(employee.cust_Employee_ID || employeeId),

        checks: [],

        successFactorsRecord: employee
    };
}

async function getCFirstCandidateSourceData(
    employeeId,
    educationRecordId,
    previousEmploymentId
) {
    const employee = await findBgvRecordByEmployeeId(employeeId);

    if (!employee) {
        throw new Error(
            `No cust_BGV record found for employee ID ${employeeId}`
        );
    }

    const personIdExternal = String(employee.cust_Employee_ID || employeeId);
    const externalCode = String(employee.externalCode || personIdExternal);
    const personFilter = `personIdExternal eq '${escapeODataString(personIdExternal)}'`;
    const [personalResponse, emailResponse, addressResponse, employmentResponse, educationResponse] =
        await Promise.all([
            getSuccessFactorsResource("PerPersonal", { $filter: personFilter }),
            getSuccessFactorsResource("PerEmail", {
                $filter: `${personFilter} and emailType eq '34402'`
            }),
            getSuccessFactorsResource("PerAddressDEFLT", { $filter: personFilter }),
            getRecordsByExternalCode(
                "cust_PreviousEmploymentDetails",
                previousEmploymentId,
                personIdExternal
            ),
            getRecordsByExternalCode(
                "cust_INDEDUCATION",
                educationRecordId,
                personIdExternal
            )
        ]);

    return {
        employee,
        externalCode,
        personal: getODataObject(personalResponse.data)[0] || {},
        responseEmail: getODataObject(emailResponse.data)[0] || {},
        addresses: getODataObject(addressResponse.data),
        employments: employmentResponse,
        educations: educationResponse
    };
}


module.exports = {
    getEmployees,
    searchSuccessFactorsUsers,
    getSuccessFactorsUserDirectory,
    getEmployeeInitiationDetails,
    createBgvEmployee,
    getEmployeeDetails,
    getEmployeeAttachment,
    getEducationAttachments,
    getAdditionalAttachments,
    getAllEmployeeAttachments,
    getCFirstCandidateSourceData,
    findBgvRecordByEmployeeId,
    updateBgvRecord,
    resolveBgvStatusCode,
    findPicklistCode,
    getCaseIdField,
    getStoredVendorCase
};